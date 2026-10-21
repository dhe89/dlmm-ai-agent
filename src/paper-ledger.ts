import type { PaperPosition } from "./domain.js";

export interface OpenPaperPositionInput {
  id: string;
  poolAddress: string;
  openedAt: string;
  initialCapitalUsd: number;
  entryPoolPrice: number;
}

export interface PaperLedgerPosition extends PaperPosition {
  currentValueUsd: number;
  lastMarkedAt: string;
}

export type PaperLedgerEvent =
  | {
      type: "position_opened";
      at: string;
      positionId: string;
      poolAddress: string;
      capitalUsd: number;
      entryPoolPrice: number;
    }
  | {
      type: "position_marked";
      at: string;
      positionId: string;
      previousValueUsd: number;
      currentValueUsd: number;
    }
  | {
      type: "position_closed";
      at: string;
      positionId: string;
      finalValueUsd: number;
      realizedPnlUsd: number;
    };

export interface PaperLedgerSummary {
  initialCapitalUsd: number;
  cashUsd: number;
  openPositionValueUsd: number;
  equityUsd: number;
  realizedPnlUsd: number;
  unrealizedPnlUsd: number;
  totalPnlUsd: number;
  openPositions: number;
  closedPositions: number;
}

export interface PaperLedgerState {
  schemaVersion: 1;
  startingCapitalUsd: number;
  cashBalanceUsd: number;
  positions: PaperLedgerPosition[];
  events: PaperLedgerEvent[];
}

/**
 * Deterministic in-memory paper ledger. It never signs or submits transactions.
 * Mark values are supplied by a valuation component; this class does not claim
 * that pool pair-price changes alone represent DLMM position value.
 */
export class PaperLedger {
  private readonly startingCapitalUsd: number;
  private cashBalanceUsd: number;
  private readonly positions = new Map<string, PaperLedgerPosition>();
  private readonly events: PaperLedgerEvent[] = [];

  constructor(initialCapitalUsd: number) {
    this.assertFiniteNonNegative(initialCapitalUsd, "initialCapitalUsd");
    if (initialCapitalUsd <= 0) {
      throw new Error("initialCapitalUsd must be greater than zero");
    }
    this.startingCapitalUsd = initialCapitalUsd;
    this.cashBalanceUsd = initialCapitalUsd;
  }

  openPosition(input: OpenPaperPositionInput): PaperLedgerPosition {
    if (!input.id.trim()) throw new Error("position id must not be empty");
    if (!input.poolAddress.trim()) throw new Error("poolAddress must not be empty");
    this.assertTimestamp(input.openedAt, "openedAt");
    this.assertFiniteNonNegative(input.initialCapitalUsd, "initialCapitalUsd");
    this.assertFiniteNonNegative(input.entryPoolPrice, "entryPoolPrice");
    if (input.initialCapitalUsd <= 0) {
      throw new Error("initialCapitalUsd must be greater than zero");
    }
    if (this.positions.has(input.id)) {
      throw new Error(`position ${input.id} already exists`);
    }
    if (input.initialCapitalUsd > this.cashBalanceUsd) {
      throw new Error("insufficient paper cash");
    }

    const position: PaperLedgerPosition = {
      id: input.id,
      poolAddress: input.poolAddress,
      openedAt: input.openedAt,
      initialCapitalUsd: input.initialCapitalUsd,
      entryPoolPrice: input.entryPoolPrice,
      status: "open",
      currentValueUsd: input.initialCapitalUsd,
      lastMarkedAt: input.openedAt
    };
    this.cashBalanceUsd = this.roundMoney(this.cashBalanceUsd - input.initialCapitalUsd);
    this.positions.set(input.id, position);
    this.events.push({
      type: "position_opened",
      at: input.openedAt,
      positionId: input.id,
      poolAddress: input.poolAddress,
      capitalUsd: input.initialCapitalUsd,
      entryPoolPrice: input.entryPoolPrice
    });
    return { ...position };
  }

  markPosition(positionId: string, capturedAt: string, currentValueUsd: number): PaperLedgerPosition {
    this.assertTimestamp(capturedAt, "capturedAt");
    this.assertFiniteNonNegative(currentValueUsd, "currentValueUsd");
    const position = this.requireOpenPosition(positionId);
    if (Date.parse(capturedAt) < Date.parse(position.lastMarkedAt)) {
      throw new Error("capturedAt cannot be earlier than the previous position timestamp");
    }

    const previousValueUsd = position.currentValueUsd;
    position.currentValueUsd = this.roundMoney(currentValueUsd);
    position.lastMarkedAt = capturedAt;
    this.events.push({
      type: "position_marked",
      at: capturedAt,
      positionId,
      previousValueUsd,
      currentValueUsd: position.currentValueUsd
    });
    return { ...position };
  }

  closePosition(positionId: string, closedAt: string, finalValueUsd: number): PaperLedgerPosition {
    this.assertTimestamp(closedAt, "closedAt");
    this.assertFiniteNonNegative(finalValueUsd, "finalValueUsd");
    const position = this.requireOpenPosition(positionId);
    if (Date.parse(closedAt) < Date.parse(position.lastMarkedAt)) {
      throw new Error("closedAt cannot be earlier than the previous position timestamp");
    }

    const realizedPnlUsd = this.roundMoney(finalValueUsd - position.initialCapitalUsd);
    position.currentValueUsd = this.roundMoney(finalValueUsd);
    position.lastMarkedAt = closedAt;
    position.status = "closed";
    this.cashBalanceUsd = this.roundMoney(this.cashBalanceUsd + finalValueUsd);
    this.events.push({
      type: "position_closed",
      at: closedAt,
      positionId,
      finalValueUsd: position.currentValueUsd,
      realizedPnlUsd
    });
    return { ...position };
  }

  exportState(): PaperLedgerState {
    return {
      schemaVersion: 1,
      startingCapitalUsd: this.startingCapitalUsd,
      cashBalanceUsd: this.cashBalanceUsd,
      positions: this.getPositions(),
      events: this.getEvents()
    };
  }

  /**
   * Rebuild a ledger from its durable event journal. Each event is checked
   * against the state produced by earlier events; replay fails closed on
   * impossible transitions or inconsistent recorded values.
   */
  static replay(initialCapitalUsd: number, events: readonly PaperLedgerEvent[]): PaperLedger {
    const ledger = new PaperLedger(initialCapitalUsd);

    for (const event of events) {
      if (!event || typeof event !== "object") {
        throw new Error("Invalid paper ledger event during replay");
      }

      if (event.type === "position_opened") {
        ledger.openPosition({
          id: event.positionId,
          poolAddress: event.poolAddress,
          openedAt: event.at,
          initialCapitalUsd: event.capitalUsd,
          entryPoolPrice: event.entryPoolPrice
        });
        continue;
      }

      const position = ledger.getPosition(event.positionId);
      if (!position || position.status !== "open") {
        throw new Error(`Cannot replay ${event.type}: position ${event.positionId} is not open`);
      }

      if (event.type === "position_marked") {
        if (Math.abs(position.currentValueUsd - event.previousValueUsd) > 0.000001) {
          throw new Error(`Cannot replay mark for ${event.positionId}: previous value does not match`);
        }
        ledger.markPosition(event.positionId, event.at, event.currentValueUsd);
        continue;
      }

      if (event.type === "position_closed") {
        const expectedPnl = ledger.roundMoney(event.finalValueUsd - position.initialCapitalUsd);
        if (Math.abs(expectedPnl - event.realizedPnlUsd) > 0.000001) {
          throw new Error(`Cannot replay close for ${event.positionId}: realized PnL does not match`);
        }
        ledger.closePosition(event.positionId, event.at, event.finalValueUsd);
        continue;
      }

      throw new Error("Unsupported paper ledger event during replay");
    }

    return ledger;
  }

  static restore(state: PaperLedgerState): PaperLedger {
    if (!state || state.schemaVersion !== 1) {
      throw new Error("Unsupported or invalid paper ledger state schema");
    }
    const ledger = new PaperLedger(state.startingCapitalUsd);
    ledger.assertFiniteNonNegative(state.cashBalanceUsd, "cashBalanceUsd");

    for (const position of state.positions) {
      if (!position || typeof position.id !== "string" || !position.id.trim()) {
        throw new Error("Invalid position in paper ledger state");
      }
      if (ledger.positions.has(position.id)) {
        throw new Error(`Duplicate position id in paper ledger state: ${position.id}`);
      }
      if (position.status !== "open" && position.status !== "closed") {
        throw new Error(`Invalid status for position ${position.id}`);
      }
      ledger.assertTimestamp(position.openedAt, "openedAt");
      ledger.assertTimestamp(position.lastMarkedAt, "lastMarkedAt");
      ledger.assertFiniteNonNegative(position.initialCapitalUsd, "initialCapitalUsd");
      ledger.assertFiniteNonNegative(position.entryPoolPrice, "entryPoolPrice");
      ledger.assertFiniteNonNegative(position.currentValueUsd, "currentValueUsd");
      if (!position.poolAddress.trim() || Date.parse(position.lastMarkedAt) < Date.parse(position.openedAt)) {
        throw new Error(`Invalid timestamps or pool address for position ${position.id}`);
      }
      ledger.positions.set(position.id, { ...position });
    }

    if (!Array.isArray(state.events)) throw new Error("Invalid events in paper ledger state");
    ledger.events.push(...state.events.map((event) => ({ ...event })));
    const openValue = [...ledger.positions.values()]
      .filter((position) => position.status === "open")
      .reduce((sum, position) => sum + position.currentValueUsd, 0);
    const calculatedCash = ledger.roundMoney(
      ledger.startingCapitalUsd -
      [...ledger.positions.values()].reduce((sum, position) => sum + position.initialCapitalUsd, 0) +
      [...ledger.positions.values()].filter((position) => position.status === "closed")
        .reduce((sum, position) => sum + position.currentValueUsd, 0)
    );
    if (calculatedCash < -0.000001 || Math.abs(calculatedCash - state.cashBalanceUsd) > 0.000001) {
      throw new Error("Paper ledger state violates cash accounting invariants");
    }
    if (![state.startingCapitalUsd, state.cashBalanceUsd, openValue].every(Number.isFinite)) {
      throw new Error("Paper ledger state contains non-finite accounting values");
    }
    // Restore the validated cash balance as well as the positions and events.
    ledger.cashBalanceUsd = state.cashBalanceUsd;
    return ledger;
  }

  getPosition(positionId: string): PaperLedgerPosition | undefined {
    const position = this.positions.get(positionId);
    return position ? { ...position } : undefined;
  }

  getPositions(): PaperLedgerPosition[] {
    return [...this.positions.values()].map((position) => ({ ...position }));
  }

  getEvents(): PaperLedgerEvent[] {
    return this.events.map((event) => ({ ...event }));
  }

  summary(): PaperLedgerSummary {
    const openPositions = [...this.positions.values()].filter((position) => position.status === "open");
    const closedPositions = [...this.positions.values()].filter((position) => position.status === "closed");
    const openPositionValueUsd = this.roundMoney(
      openPositions.reduce((sum, position) => sum + position.currentValueUsd, 0)
    );
    const realizedPnlUsd = this.roundMoney(
      closedPositions.reduce((sum, position) => sum + position.currentValueUsd - position.initialCapitalUsd, 0)
    );
    const unrealizedPnlUsd = this.roundMoney(
      openPositions.reduce((sum, position) => sum + position.currentValueUsd - position.initialCapitalUsd, 0)
    );
    const equityUsd = this.roundMoney(this.cashBalanceUsd + openPositionValueUsd);

    return {
      initialCapitalUsd: this.startingCapitalUsd,
      cashUsd: this.cashBalanceUsd,
      openPositionValueUsd,
      equityUsd,
      realizedPnlUsd,
      unrealizedPnlUsd,
      totalPnlUsd: this.roundMoney(equityUsd - this.startingCapitalUsd),
      openPositions: openPositions.length,
      closedPositions: closedPositions.length
    };
  }

  private requireOpenPosition(positionId: string): PaperLedgerPosition {
    const position = this.positions.get(positionId);
    if (!position) throw new Error(`position ${positionId} does not exist`);
    if (position.status !== "open") throw new Error(`position ${positionId} is already closed`);
    return position;
  }

  private assertTimestamp(value: string, name: string): void {
    if (!value.trim() || !Number.isFinite(Date.parse(value))) {
      throw new Error(`${name} must be a valid timestamp`);
    }
  }

  private assertFiniteNonNegative(value: number, name: string): void {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${name} must be a finite non-negative number`);
    }
  }

  private roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
  }
}

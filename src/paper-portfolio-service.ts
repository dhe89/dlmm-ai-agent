import { PaperLedger } from "./paper-ledger.js";
import { PaperLedgerStore } from "./paper-ledger-store.js";
import { markLedgerFromValuation } from "./paper-valuation.js";
import type { ValuationResult } from "./valuation.js";

export interface PaperPortfolioReport {
  mode: "paper-only";
  summary: ReturnType<PaperLedger["summary"]> & { returnPct: number };
  positions: ReturnType<PaperLedger["getPositions"]>;
}

// Serialize mutations by canonical state path across service instances in this process.
// This prevents two handlers/services from loading the same old snapshot and overwriting
// each other's changes. It is intentionally not a cross-process/distributed lock.
const mutationQueues = new Map<string, Promise<void>>();

export class PaperPortfolioService {
  constructor(private readonly store: PaperLedgerStore, private readonly initialCapitalUsd = 1_000) {
    if (!Number.isFinite(initialCapitalUsd) || initialCapitalUsd <= 0) throw new Error("initialCapitalUsd must be greater than zero");
  }
  async report(): Promise<PaperPortfolioReport> {
    const ledger = await this.store.load() ?? new PaperLedger(this.initialCapitalUsd);
    const summary = ledger.summary();
    return {
      mode: "paper-only",
      summary: { ...summary, returnPct: summary.totalPnlUsd / summary.initialCapitalUsd * 100 },
      positions: ledger.getPositions().filter((position) => position.status === "open")
    };
  }
  async history(): Promise<{ positions: ReturnType<PaperLedger["getPositions"]>; events: ReturnType<PaperLedger["getEvents"]> }> {
    const ledger = await this.store.load() ?? new PaperLedger(this.initialCapitalUsd);
    return { positions: ledger.getPositions(), events: ledger.getEvents() };
  }
  async open(input: { id: string; pool: string; capital: number; entryPrice: number; at?: string }) {
    return this.mutate((ledger) => ledger.openPosition({
      id: input.id,
      poolAddress: input.pool,
      openedAt: input.at ?? new Date().toISOString(),
      initialCapitalUsd: input.capital,
      entryPoolPrice: input.entryPrice
    }));
  }
  async mark(input: { id: string; value: number; at?: string }) {
    return this.mutate((ledger) => ledger.markPosition(input.id, input.at ?? new Date().toISOString(), input.value));
  }
  async close(input: { id: string; value: number; at?: string }) {
    return this.mutate((ledger) => ledger.closePosition(input.id, input.at ?? new Date().toISOString(), input.value));
  }
  async markFromValuation(input: { id: string; valuation: ValuationResult }) {
    return this.mutate((ledger) => markLedgerFromValuation(ledger, input.id, input.valuation));
  }
  private async mutate<T>(operation: (ledger: PaperLedger) => T): Promise<T> {
    const key = this.store.filePath;
    const previous = mutationQueues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => gate);
    mutationQueues.set(key, queued);

    await previous;
    try {
      const ledger = await this.store.load() ?? new PaperLedger(this.initialCapitalUsd);
      const result = operation(ledger);
      await this.store.save(ledger);
      return result;
    } finally {
      release();
      if (mutationQueues.get(key) === queued) mutationQueues.delete(key);
    }
  }
}

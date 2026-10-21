import type { PaperLedger, PaperLedgerPosition } from "./paper-ledger.js";
import type { ValuationResult } from "./valuation.js";

export interface LedgerMarkResult {
  position: PaperLedgerPosition;
  markedValueUsd: number;
  valuationStatus: "available";
}

/**
 * Applies a fully populated, fresh valuation to a paper position.
 *
 * The valuation's execution/network costs must be cumulative costs attributable
 * to this position as of capturedAt (not per-event costs). The marked value is
 * inventory value plus accrued fees less cumulative costs. Inventory PnL is
 * intentionally not added again because it is already reflected in inventoryValueUsd.
 */
export function markLedgerFromValuation(
  ledger: PaperLedger,
  positionId: string,
  valuation: ValuationResult
): LedgerMarkResult {
  if (valuation.status !== "available") {
    throw new Error(`Cannot mark paper position from ${valuation.status} valuation`);
  }
  if (
    valuation.inventoryValueUsd === undefined ||
    valuation.feesUsd === undefined ||
    valuation.executionCostsUsd === undefined ||
    valuation.networkCostsUsd === undefined ||
    valuation.netPnlUsd === undefined
  ) {
    throw new Error("Cannot mark paper position: valuation components are incomplete");
  }
  const values = [
    valuation.inventoryValueUsd,
    valuation.feesUsd,
    valuation.executionCostsUsd,
    valuation.networkCostsUsd,
    valuation.netPnlUsd
  ];
  if (!values.every(Number.isFinite) || values.some((value) => value < 0)) {
    throw new Error("Cannot mark paper position: valuation contains invalid amounts");
  }

  const markedValueUsd =
    valuation.inventoryValueUsd +
    valuation.feesUsd -
    valuation.executionCostsUsd -
    valuation.networkCostsUsd;
  if (!Number.isFinite(markedValueUsd) || markedValueUsd < 0) {
    throw new Error("Cannot mark paper position: resulting value is invalid");
  }

  const position = ledger.markPosition(positionId, valuation.capturedAt, markedValueUsd);
  return { position, markedValueUsd, valuationStatus: "available" };
}

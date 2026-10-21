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
  if (!Number.isFinite(Date.parse(valuation.capturedAt))) {
    throw new Error("Cannot mark paper position: capturedAt is invalid");
  }
  if (valuation.ageMs === undefined || !Number.isFinite(valuation.ageMs) || valuation.ageMs < 0 || valuation.ageMs > 60_000) {
    throw new Error("Cannot mark paper position: valuation age is missing, invalid, or exceeds the 60-second safety limit");
  }
  if (
    valuation.inventoryValueUsd === undefined ||
    valuation.inventoryPnlUsd === undefined ||
    valuation.feesUsd === undefined ||
    valuation.executionCostsUsd === undefined ||
    valuation.networkCostsUsd === undefined ||
    valuation.netPnlUsd === undefined
  ) {
    throw new Error("Cannot mark paper position: valuation components are incomplete");
  }
  const values = [
    valuation.inventoryValueUsd,
    valuation.inventoryPnlUsd,
    valuation.feesUsd,
    valuation.executionCostsUsd,
    valuation.networkCostsUsd,
    valuation.netPnlUsd
  ];
  if (
    !values.every(Number.isFinite) ||
    [valuation.inventoryValueUsd, valuation.feesUsd, valuation.executionCostsUsd, valuation.networkCostsUsd].some((value) => value < 0)
  ) {
    throw new Error("Cannot mark paper position: valuation contains invalid amounts");
  }
  if (Object.values(valuation.evidence).some((status) => status === "unavailable")) {
    throw new Error("Cannot mark paper position: valuation evidence is incomplete");
  }
  const expectedNetPnl = valuation.inventoryPnlUsd + valuation.feesUsd - valuation.executionCostsUsd - valuation.networkCostsUsd;
  if (Math.abs(expectedNetPnl - valuation.netPnlUsd) > 0.000001) {
    throw new Error("Cannot mark paper position: net PnL does not match valuation components");
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

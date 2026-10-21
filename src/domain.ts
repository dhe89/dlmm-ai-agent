export type TradingMode = "paper";

/**
 * Snapshot from the Meteora indexed Data API.
 * currentPrice is the pool's pair price as returned by Meteora; it is NOT
 * assumed to be USD-denominated. Active-bin data must be sourced separately.
 */
export interface MarketSnapshot {
  poolAddress: string;
  capturedAt: string;
  currentPrice: number;
  volume24hUsd?: number;
  tvlUsd?: number;
}

export interface PaperPosition {
  id: string;
  poolAddress: string;
  openedAt: string;
  initialCapitalUsd: number;
  entryPoolPrice: number;
  status: "open" | "closed";
}

export interface PnLBreakdown {
  feesUsd: number;
  inventoryPnlUsd: number;
  estimatedExecutionCostsUsd: number;
  estimatedNetworkCostsUsd: number;
  netPnlUsd: number;
}

export function calculateNetPnl(
  breakdown: Omit<PnLBreakdown, "netPnlUsd">
): PnLBreakdown {
  const values = [
    breakdown.feesUsd,
    breakdown.inventoryPnlUsd,
    breakdown.estimatedExecutionCostsUsd,
    breakdown.estimatedNetworkCostsUsd
  ];

  if (!values.every(Number.isFinite)) {
    throw new Error("PnL inputs must all be finite numbers");
  }

  return {
    ...breakdown,
    netPnlUsd:
      breakdown.feesUsd +
      breakdown.inventoryPnlUsd -
      breakdown.estimatedExecutionCostsUsd -
      breakdown.estimatedNetworkCostsUsd
  };
}

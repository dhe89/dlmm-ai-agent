export type TradingMode = "paper";

export interface MarketSnapshot {
  poolAddress: string;
  capturedAt: string;
  priceUsd: number;
  activeBinId: number;
  volume24hUsd?: number;
  tvlUsd?: number;
}

export interface PaperPosition {
  id: string;
  poolAddress: string;
  openedAt: string;
  initialCapitalUsd: number;
  entryPriceUsd: number;
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

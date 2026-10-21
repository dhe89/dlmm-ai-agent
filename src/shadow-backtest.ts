import type { MarketSnapshot } from "./domain.js";

export interface ShadowBacktestConfig {
  /** Number of prior observations used to form the fast average. */
  fastWindow: number;
  /** Number of prior observations used to form the slow average. */
  slowWindow: number;
  /** One-way modeled transaction cost in basis points. */
  costBps: number;
  /** Starting notional used for the synthetic price-series experiment. */
  initialCapitalUsd: number;
}

export interface ShadowEquityPoint {
  capturedAt: string;
  poolAddress: string;
  equityUsd: number;
  exposure: 0 | 1;
}

export interface ShadowBacktestResult {
  methodology: "pair-price-sma-crossover-proxy";
  warning: string;
  observations: number;
  trades: number;
  initialCapitalUsd: number;
  finalEquityUsd: number;
  totalReturnPct: number;
  /** Passive pair-price benchmark, marked to market with entry cost only. */
  buyHoldFinalEquityUsd: number;
  buyHoldReturnPct: number;
  excessReturnPct: number;
  maxDrawdownPct: number;
  winRatePct: number;
  costBpsPerSide: number;
  equityCurve: ShadowEquityPoint[];
}

function validateConfig(config: ShadowBacktestConfig): void {
  if (!Number.isInteger(config.fastWindow) || config.fastWindow < 1) {
    throw new Error("fastWindow must be a positive integer");
  }
  if (!Number.isInteger(config.slowWindow) || config.slowWindow <= config.fastWindow) {
    throw new Error("slowWindow must be an integer greater than fastWindow");
  }
  if (!Number.isFinite(config.costBps) || config.costBps < 0 || config.costBps >= 10_000) {
    throw new Error("costBps must be finite and in [0, 10000)");
  }
  if (!Number.isFinite(config.initialCapitalUsd) || config.initialCapitalUsd <= 0) {
    throw new Error("initialCapitalUsd must be finite and greater than zero");
  }
}

/**
 * Runs a deliberately simple, long/cash moving-average experiment on a pool's
 * pair-price series. It is a price-return proxy, NOT DLMM LP PnL: it excludes
 * bin inventory, fee accrual, range changes, and on-chain execution mechanics.
 *
 * Signals use only observations available before the next observation. A signal
 * formed at index i is applied to the price at i+1, preventing same-bar lookahead.
 */
export function runShadowBacktest(
  snapshots: readonly MarketSnapshot[],
  config: ShadowBacktestConfig
): ShadowBacktestResult {
  validateConfig(config);
  if (snapshots.length < config.slowWindow + 1) {
    throw new Error("insufficient observations for configured slowWindow");
  }

  const ordered = snapshots.map((snapshot) => ({ ...snapshot }))
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));

  const poolAddress = ordered[0]?.poolAddress;
  if (!poolAddress) throw new Error("no snapshots supplied");
  let previousTime = Number.NEGATIVE_INFINITY;
  for (const snapshot of ordered) {
    const time = Date.parse(snapshot.capturedAt);
    if (!Number.isFinite(time)) throw new Error("snapshot capturedAt must be valid");
    if (time <= previousTime) throw new Error("snapshot timestamps must be unique");
    if (snapshot.poolAddress !== poolAddress) throw new Error("all snapshots must belong to one pool");
    if (!Number.isFinite(snapshot.currentPrice) || snapshot.currentPrice <= 0) {
      throw new Error("snapshot currentPrice must be positive and finite");
    }
    previousTime = time;
  }

  const prices = ordered.map((snapshot) => snapshot.currentPrice);
  const average = (endExclusive: number, window: number): number => {
    let total = 0;
    for (let i = endExclusive - window; i < endExclusive; i += 1) total += prices[i]!;
    return total / window;
  };

  const costRate = config.costBps / 10_000;
  // Buy-and-hold is marked to market at the last observed price; no forced exit
  // is modeled, so only the initial entry cost is applied to this benchmark.
  const buyHoldFinalEquityUsd = config.initialCapitalUsd * (1 - costRate) * (prices.at(-1)! / prices[0]!);
  const buyHoldReturnPct = (buyHoldFinalEquityUsd / config.initialCapitalUsd - 1) * 100;
  let equity = config.initialCapitalUsd;
  let exposure: 0 | 1 = 0;
  let trades = 0;
  let completedTradeStartEquity: number | undefined;
  let wins = 0;
  let completedTrades = 0;
  let peak = equity;
  let maxDrawdown = 0;
  const equityCurve: ShadowEquityPoint[] = [{
    capturedAt: ordered[0]!.capturedAt,
    poolAddress,
    equityUsd: equity,
    exposure
  }];

  // At index i, calculate a signal from prices through i-1; apply it at i.
  for (let i = 1; i < ordered.length; i += 1) {
    let desiredExposure: 0 | 1 = exposure;
    if (i >= config.slowWindow) {
      const fast = average(i, config.fastWindow);
      const slow = average(i, config.slowWindow);
      desiredExposure = fast > slow ? 1 : 0;
    }

    if (desiredExposure !== exposure) {
      if (desiredExposure === 1) completedTradeStartEquity = equity;
      equity *= 1 - costRate;
      trades += 1;
      if (desiredExposure === 0 && completedTradeStartEquity !== undefined) {
        completedTrades += 1;
        if (equity > completedTradeStartEquity) wins += 1;
        completedTradeStartEquity = undefined;
      }
      exposure = desiredExposure;
    }

    const priceReturn = prices[i]! / prices[i - 1]! - 1;
    if (exposure === 1) equity *= 1 + priceReturn;
    if (!Number.isFinite(equity) || equity < 0) throw new Error("backtest equity became invalid");

    peak = Math.max(peak, equity);
    const drawdown = peak > 0 ? (peak - equity) / peak : 0;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
    equityCurve.push({
      capturedAt: ordered[i]!.capturedAt,
      poolAddress,
      equityUsd: equity,
      exposure
    });
  }

  if (exposure === 1 && completedTradeStartEquity !== undefined) {
    completedTrades += 1;
    if (equity > completedTradeStartEquity) wins += 1;
  }

  return {
    methodology: "pair-price-sma-crossover-proxy",
    warning: "Price-series proxy only; not DLMM LP PnL or a live-trading performance claim.",
    observations: ordered.length,
    trades,
    initialCapitalUsd: config.initialCapitalUsd,
    finalEquityUsd: equity,
    totalReturnPct: (equity / config.initialCapitalUsd - 1) * 100,
    buyHoldFinalEquityUsd,
    buyHoldReturnPct,
    excessReturnPct: (equity / config.initialCapitalUsd - 1) * 100 - buyHoldReturnPct,
    maxDrawdownPct: maxDrawdown * 100,
    winRatePct: completedTrades > 0 ? wins / completedTrades * 100 : 0,
    costBpsPerSide: config.costBps,
    equityCurve
  };
}

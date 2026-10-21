import type { MarketSnapshot } from "./domain.js";

export interface EmaBacktestConfig {
  fastWindow: number;
  slowWindow: number;
  costBps: number;
  initialCapitalUsd: number;
}

export interface EmaBacktestResult {
  methodology: "pair-price-ema-crossover-proxy";
  warning: string;
  observations: number;
  trades: number;
  initialCapitalUsd: number;
  finalEquityUsd: number;
  totalReturnPct: number;
  buyHoldFinalEquityUsd: number;
  buyHoldReturnPct: number;
  excessReturnPct: number;
  maxDrawdownPct: number;
  winRatePct: number;
  costBpsPerSide: number;
}

function validateConfig(config: EmaBacktestConfig): void {
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

function emaSeries(prices: readonly number[], window: number): Array<number | undefined> {
  const result: Array<number | undefined> = Array(prices.length).fill(undefined);
  if (prices.length < window) return result;
  let seed = 0;
  for (let i = 0; i < window; i += 1) seed += prices[i]!;
  let previous = seed / window;
  result[window - 1] = previous;
  const alpha = 2 / (window + 1);
  for (let i = window; i < prices.length; i += 1) {
    previous = prices[i]! * alpha + previous * (1 - alpha);
    result[i] = previous;
  }
  return result;
}

/** EMA crossover on a pair-price series only; it does not model DLMM LP inventory or fees. */
export function runEmaBacktest(
  snapshots: readonly MarketSnapshot[],
  config: EmaBacktestConfig
): EmaBacktestResult {
  validateConfig(config);
  if (snapshots.length < config.slowWindow + 1) {
    throw new Error("insufficient observations for configured slowWindow");
  }
  const ordered = snapshots.map(snapshot => ({ ...snapshot }))
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  const poolAddress = ordered[0]?.poolAddress;
  if (!poolAddress) throw new Error("no snapshots supplied");
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const snapshot of ordered) {
    const timestamp = Date.parse(snapshot.capturedAt);
    if (!Number.isFinite(timestamp)) throw new Error("snapshot capturedAt must be valid");
    if (timestamp <= previousTimestamp) throw new Error("snapshot timestamps must be unique");
    if (snapshot.poolAddress !== poolAddress) throw new Error("all snapshots must belong to one pool");
    if (!Number.isFinite(snapshot.currentPrice) || snapshot.currentPrice <= 0) {
      throw new Error("snapshot currentPrice must be positive and finite");
    }
    previousTimestamp = timestamp;
  }

  const prices = ordered.map(snapshot => snapshot.currentPrice);
  const fastEma = emaSeries(prices, config.fastWindow);
  const slowEma = emaSeries(prices, config.slowWindow);
  const costRate = config.costBps / 10_000;
  const buyHoldFinalEquityUsd = config.initialCapitalUsd * (1 - costRate) * (prices.at(-1)! / prices[0]!);
  const buyHoldReturnPct = (buyHoldFinalEquityUsd / config.initialCapitalUsd - 1) * 100;
  let equity = config.initialCapitalUsd;
  let exposure: 0 | 1 = 0;
  let trades = 0;
  let tradeStartEquity: number | undefined;
  let wins = 0;
  let completedTrades = 0;
  let peak = equity;
  let maxDrawdown = 0;

  for (let i = 1; i < ordered.length; i += 1) {
    let desiredExposure: 0 | 1 = exposure;
    const signalIndex = i - 1;
    if (fastEma[signalIndex] !== undefined && slowEma[signalIndex] !== undefined) {
      desiredExposure = fastEma[signalIndex]! > slowEma[signalIndex]! ? 1 : 0;
    }
    if (desiredExposure !== exposure) {
      if (desiredExposure === 1) tradeStartEquity = equity;
      equity *= 1 - costRate;
      trades += 1;
      if (desiredExposure === 0 && tradeStartEquity !== undefined) {
        completedTrades += 1;
        if (equity > tradeStartEquity) wins += 1;
        tradeStartEquity = undefined;
      }
      exposure = desiredExposure;
    }
    if (exposure === 1) equity *= prices[i]! / prices[i - 1]!;
    if (!Number.isFinite(equity) || equity < 0) throw new Error("backtest equity became invalid");
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? (peak - equity) / peak : 0);
  }
  if (exposure === 1 && tradeStartEquity !== undefined) {
    completedTrades += 1;
    if (equity > tradeStartEquity) wins += 1;
  }
  const totalReturnPct = (equity / config.initialCapitalUsd - 1) * 100;
  return {
    methodology: "pair-price-ema-crossover-proxy",
    warning: "Price-series EMA proxy only; not DLMM LP PnL or a live-trading performance claim.",
    observations: ordered.length,
    trades,
    initialCapitalUsd: config.initialCapitalUsd,
    finalEquityUsd: equity,
    totalReturnPct,
    buyHoldFinalEquityUsd,
    buyHoldReturnPct,
    excessReturnPct: totalReturnPct - buyHoldReturnPct,
    maxDrawdownPct: maxDrawdown * 100,
    winRatePct: completedTrades > 0 ? wins / completedTrades * 100 : 0,
    costBpsPerSide: config.costBps
  };
}

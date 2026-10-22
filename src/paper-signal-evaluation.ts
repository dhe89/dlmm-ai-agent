import type { MarketSnapshot } from "./domain.js";
import type { PaperSignal } from "./strategy-signal-journal.js";

export interface SignalEvaluationConfig {
  forwardSteps: number;
  costBpsPerSide: number;
}
export interface SignalEvaluationReport {
  methodology: "next-observation-pair-price-signal-proxy";
  warning: string;
  observations: number;
  evaluatedSignals: number;
  longSignals: number;
  cashSignals: number;
  meanForwardReturnPct: number;
  medianForwardReturnPct: number;
  hitRatePct: number;
  modeledStrategyReturnPct: number;
  buyHoldReturnPct: number;
  excessReturnPct: number;
  costBpsPerSide: number;
  forwardReturnsPct: number[];
}
function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a,b)=>a-b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid-1]! + sorted[mid]!) / 2;
}

/**
 * Evaluates a previously recorded LONG/CASH label against a future pair price.
 * Each signal is scored only against a later observation. It is a price proxy,
 * not a DLMM LP simulation and not a substitute for a chronological holdout.
 */
export function evaluatePaperSignals(
  snapshots: readonly MarketSnapshot[],
  signals: readonly { poolAddress: string; capturedAt: string; signal: PaperSignal }[],
  config: SignalEvaluationConfig
): SignalEvaluationReport {
  if (!Number.isInteger(config.forwardSteps) || config.forwardSteps < 1) throw new Error("forwardSteps must be a positive integer");
  if (!Number.isFinite(config.costBpsPerSide) || config.costBpsPerSide < 0 || config.costBpsPerSide >= 10_000) throw new Error("costBpsPerSide must be in [0, 10000)");
  if (snapshots.length < 2) throw new Error("at least two snapshots are required");
  const ordered = [...snapshots].sort((a,b)=>Date.parse(a.capturedAt)-Date.parse(b.capturedAt));
  const times = new Set<number>();
  for (const snapshot of ordered) {
    const time = Date.parse(snapshot.capturedAt);
    if (!Number.isFinite(time) || times.has(time)) throw new Error("snapshot timestamps must be valid and unique");
    times.add(time);
    if (!Number.isFinite(snapshot.currentPrice) || snapshot.currentPrice <= 0) throw new Error("snapshot prices must be positive and finite");
  }
  const poolAddress = ordered[0]!.poolAddress;
  if (ordered.some((snapshot)=>snapshot.poolAddress!==poolAddress)) throw new Error("all snapshots must belong to one pool");
  const priceByTime = new Map(ordered.map((snapshot,index)=>[snapshot.capturedAt,{index,price:snapshot.currentPrice}]));
  const returns: number[] = [];
  const strategyReturns: number[] = [];
  let longSignals = 0;
  let cashSignals = 0;
  const costRate = config.costBpsPerSide / 10_000;
  for (const item of signals) {
    if (item.poolAddress !== poolAddress) continue;
    if (item.signal === "WARMING_UP") continue;
    const start = priceByTime.get(item.capturedAt);
    if (!start) continue;
    const target = ordered[start.index + config.forwardSteps];
    if (!target) continue;
    const forwardReturn = target.currentPrice / start.price - 1;
    const pct = forwardReturn * 100;
    returns.push(pct);
    if (item.signal === "LONG") {
      longSignals += 1;
      strategyReturns.push(((1 - costRate) * (1 + forwardReturn) * (1 - costRate) - 1) * 100);
    } else {
      cashSignals += 1;
      strategyReturns.push(0);
    }
  }
  const last = ordered.at(-1)!;
  const first = ordered[0]!;
  const buyHoldReturnPct = ((1 - costRate) * last.currentPrice / first.currentPrice - 1) * 100;
  const modeledStrategyReturnPct = strategyReturns.length
    ? (strategyReturns.reduce((equity, value)=>equity*(1+value/100),1)-1)*100
    : 0;
  return {
    methodology: "next-observation-pair-price-signal-proxy",
    warning: "Research diagnostic only. Forward pair-price returns are not DLMM LP PnL; overlapping forward windows are not independent trades and this report is not a holdout profitability claim.",
    observations: ordered.length,
    evaluatedSignals: returns.length,
    longSignals,
    cashSignals,
    meanForwardReturnPct: returns.length ? returns.reduce((sum,value)=>sum+value,0)/returns.length : 0,
    medianForwardReturnPct: median(returns),
    hitRatePct: returns.length ? returns.filter(value=>value>0).length/returns.length*100 : 0,
    modeledStrategyReturnPct,
    buyHoldReturnPct,
    excessReturnPct: modeledStrategyReturnPct-buyHoldReturnPct,
    costBpsPerSide: config.costBpsPerSide,
    forwardReturnsPct: returns
  };
}

import type { MarketSnapshot } from "./domain.js";
import { runShadowBacktest, type ShadowBacktestResult } from "./shadow-backtest.js";
import { runEmaBacktest, type EmaBacktestResult } from "./ema-backtest.js";
import { runSmaParameterSweep, type StrategySweepConfig } from "./strategy-sweep.js";

export interface HoldoutValidationConfig extends Omit<StrategySweepConfig, "fastWindows" | "slowWindows"> {
  fastWindows: readonly number[];
  slowWindows: readonly number[];
  /** Chronological fraction used for parameter selection; must be strictly between 0 and 1. */
  trainFraction: number;
}

export interface HoldoutValidationResult {
  methodology: "chronological-train-holdout";
  warning: string;
  trainObservations: number;
  holdoutObservations: number;
  trainStart: string;
  trainEnd: string;
  holdoutStart: string;
  holdoutEnd: string;
  selectedFastWindow: number;
  selectedSlowWindow: number;
  trainingResult: ShadowBacktestResult;
  holdoutResult: ShadowBacktestResult;
  holdoutEmaResult: EmaBacktestResult;
  holdoutComparison: {
    smaExcessReturnPct: number;
    emaExcessReturnPct: number;
    smaMinusEmaReturnPct: number;
    lowerDrawdownStrategy: "SMA" | "EMA" | "tie";
  };
}

/** Selects SMA parameters on earlier data, then compares SMA and EMA on untouched later data using the same windows. */
export function validateSmaEmaOnHoldout(
  snapshots: readonly MarketSnapshot[],
  config: HoldoutValidationConfig
): HoldoutValidationResult {
  if (!Number.isFinite(config.trainFraction) || config.trainFraction <= 0 || config.trainFraction >= 1) {
    throw new Error("trainFraction must be finite and strictly between 0 and 1");
  }
  if (snapshots.length === 0) throw new Error("no snapshots supplied");
  const ordered = snapshots.map(snapshot => ({ ...snapshot }))
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  const poolAddress = ordered[0]!.poolAddress;
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
  const splitIndex = Math.floor(ordered.length * config.trainFraction);
  if (splitIndex < 1 || splitIndex >= ordered.length) {
    throw new Error("not enough observations to create chronological train and holdout segments");
  }
  const training = ordered.slice(0, splitIndex);
  const holdout = ordered.slice(splitIndex);
  const sweep = runSmaParameterSweep(training, {
    fastWindows: config.fastWindows,
    slowWindows: config.slowWindows,
    costBps: config.costBps,
    initialCapitalUsd: config.initialCapitalUsd
  });
  const selected = sweep[0]!;
  const backtestConfig = {
    fastWindow: selected.fastWindow,
    slowWindow: selected.slowWindow,
    costBps: config.costBps,
    initialCapitalUsd: config.initialCapitalUsd
  };
  const holdoutResult = runShadowBacktest(holdout, backtestConfig);
  const holdoutEmaResult = runEmaBacktest(holdout, backtestConfig);
  const lowerDrawdownStrategy = holdoutResult.maxDrawdownPct < holdoutEmaResult.maxDrawdownPct
    ? "SMA" : holdoutResult.maxDrawdownPct > holdoutEmaResult.maxDrawdownPct ? "EMA" : "tie";
  return {
    methodology: "chronological-train-holdout",
    warning: "SMA parameters are selected on training data only. SMA and EMA are compared on the untouched holdout with identical window sizes and costs. Both start cold; results are pair-price proxies, not DLMM LP PnL or a guarantee of future performance.",
    trainObservations: training.length,
    holdoutObservations: holdout.length,
    trainStart: training[0]!.capturedAt,
    trainEnd: training.at(-1)!.capturedAt,
    holdoutStart: holdout[0]!.capturedAt,
    holdoutEnd: holdout.at(-1)!.capturedAt,
    selectedFastWindow: selected.fastWindow,
    selectedSlowWindow: selected.slowWindow,
    trainingResult: selected.result,
    holdoutResult,
    holdoutEmaResult,
    holdoutComparison: {
      smaExcessReturnPct: holdoutResult.excessReturnPct,
      emaExcessReturnPct: holdoutEmaResult.excessReturnPct,
      smaMinusEmaReturnPct: holdoutResult.totalReturnPct - holdoutEmaResult.totalReturnPct,
      lowerDrawdownStrategy
    }
  };
}

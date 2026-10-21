import type { MarketSnapshot } from "./domain.js";
import { runShadowBacktest, type ShadowBacktestResult } from "./shadow-backtest.js";
import { runEmaBacktest, type EmaBacktestResult } from "./ema-backtest.js";
import { runSmaParameterSweep, type StrategySweepConfig } from "./strategy-sweep.js";

export interface WalkForwardConfig extends StrategySweepConfig {
  /** Fraction reserved for the initial training segment; the remainder is split into test folds. */
  initialTrainFraction: number;
  /** Number of chronological test segments. */
  folds: number;
}

export interface WalkForwardFold {
  fold: number;
  trainObservations: number;
  testObservations: number;
  trainStart: string;
  trainEnd: string;
  testStart: string;
  testEnd: string;
  selectedFastWindow: number;
  selectedSlowWindow: number;
  trainingResult: ShadowBacktestResult;
  testResult: ShadowBacktestResult;
  emaTestResult: EmaBacktestResult;
}

export interface WalkForwardResult {
  methodology: "expanding-window-walk-forward";
  warning: string;
  observations: number;
  folds: WalkForwardFold[];
  aggregateTestReturnPct: number;
  aggregateBuyHoldReturnPct: number;
  aggregateExcessReturnPct: number;
  worstFoldDrawdownPct: number;
  positiveReturnFolds: number;
  positiveReturnFoldPct: number;
  distinctParameterSets: number;
  parameterStabilityPct: number;
  aggregateEmaTestReturnPct: number;
  aggregateEmaExcessReturnPct: number;
  aggregateSmaMinusEmaReturnPct: number;
  emaPositiveReturnFolds: number;
  emaPositiveReturnFoldPct: number;
}

/**
 * Expanding-window walk-forward evaluation. Each fold selects parameters only
 * from observations preceding that fold, then evaluates on the next unseen
 * chronological segment. Each test segment starts cold; equity is reset per
 * fold, so aggregate return is the compounded return across independent test
 * periods, not a continuous portfolio simulation.
 */
export function runSmaWalkForward(
  snapshots: readonly MarketSnapshot[],
  config: WalkForwardConfig
): WalkForwardResult {
  if (!Number.isFinite(config.initialTrainFraction) ||
      config.initialTrainFraction <= 0 || config.initialTrainFraction >= 1) {
    throw new Error("initialTrainFraction must be finite and strictly between 0 and 1");
  }
  if (!Number.isInteger(config.folds) || config.folds < 2) {
    throw new Error("folds must be an integer of at least 2");
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
  const validFastWindows = config.fastWindows.filter(window => Number.isInteger(window) && window >= 1);
  const eligibleSlowWindows = config.slowWindows.filter(slow =>
    Number.isInteger(slow) && slow >= 1 && validFastWindows.some(fast => slow > fast)
  );
  if (eligibleSlowWindows.length === 0) {
    throw new Error("no valid SMA parameter combinations for this data window");
  }
  const minSlowWindow = Math.min(...eligibleSlowWindows);
  const initialTrainSize = Math.floor(ordered.length * config.initialTrainFraction);
  if (initialTrainSize < minSlowWindow + 1) {
    throw new Error("not enough observations in the initial training window for the SMA parameters");
  }
  const testCount = ordered.length - initialTrainSize;
  if (initialTrainSize < 1 || testCount < config.folds) {
    throw new Error("not enough observations for the requested walk-forward folds");
  }
  const baseFoldSize = Math.floor(testCount / config.folds);
  const remainder = testCount % config.folds;
  const folds: WalkForwardFold[] = [];
  let testStartIndex = initialTrainSize;

  for (let index = 0; index < config.folds; index += 1) {
    const size = baseFoldSize + (index < remainder ? 1 : 0);
    const train = ordered.slice(0, testStartIndex);
    const test = ordered.slice(testStartIndex, testStartIndex + size);
    const sweep = runSmaParameterSweep(train, {
      fastWindows: config.fastWindows,
      slowWindows: config.slowWindows,
      costBps: config.costBps,
      initialCapitalUsd: config.initialCapitalUsd
    });
    const selected = sweep[0]!;
    if (test.length < selected.slowWindow + 1) {
      throw new Error(`not enough observations in test fold ${index + 1} for selected slowWindow ${selected.slowWindow}`);
    }
    const testConfig = {
      fastWindow: selected.fastWindow,
      slowWindow: selected.slowWindow,
      costBps: config.costBps,
      initialCapitalUsd: config.initialCapitalUsd
    };
    const testResult = runShadowBacktest(test, testConfig);
    const emaTestResult = runEmaBacktest(test, testConfig);
    folds.push({
      fold: index + 1,
      trainObservations: train.length,
      testObservations: test.length,
      trainStart: train[0]!.capturedAt,
      trainEnd: train.at(-1)!.capturedAt,
      testStart: test[0]!.capturedAt,
      testEnd: test.at(-1)!.capturedAt,
      selectedFastWindow: selected.fastWindow,
      selectedSlowWindow: selected.slowWindow,
      trainingResult: selected.result,
      testResult,
      emaTestResult
    });
    testStartIndex += size;
  }

  const aggregateTestReturnPct =
    (folds.reduce((equity, fold) => equity * (1 + fold.testResult.totalReturnPct / 100), 1) - 1) * 100;
  const aggregateBuyHoldReturnPct =
    (folds.reduce((equity, fold) => equity * (1 + fold.testResult.buyHoldReturnPct / 100), 1) - 1) * 100;
  const positiveReturnFolds = folds.filter(fold => fold.testResult.totalReturnPct > 0).length;
  const aggregateEmaTestReturnPct =
    (folds.reduce((equity, fold) => equity * (1 + fold.emaTestResult.totalReturnPct / 100), 1) - 1) * 100;
  const emaPositiveReturnFolds = folds.filter(fold => fold.emaTestResult.totalReturnPct > 0).length;
  const parameterCounts = new Map<string, number>();
  for (const fold of folds) {
    const key = `${fold.selectedFastWindow}/${fold.selectedSlowWindow}`;
    parameterCounts.set(key, (parameterCounts.get(key) ?? 0) + 1);
  }
  const mostCommonParameterCount = Math.max(...parameterCounts.values());
  return {
    methodology: "expanding-window-walk-forward",
    warning: "Each test fold starts cold and resets notional; compounded test returns combine independent segments, not a continuous position. Pair-price proxy only, not DLMM LP PnL or a guarantee of future performance.",
    observations: ordered.length,
    folds,
    aggregateTestReturnPct,
    aggregateBuyHoldReturnPct,
    aggregateExcessReturnPct: aggregateTestReturnPct - aggregateBuyHoldReturnPct,
    worstFoldDrawdownPct: Math.max(...folds.map(fold => fold.testResult.maxDrawdownPct)),
    positiveReturnFolds,
    positiveReturnFoldPct: positiveReturnFolds / folds.length * 100,
    distinctParameterSets: parameterCounts.size,
    parameterStabilityPct: mostCommonParameterCount / folds.length * 100,
    aggregateEmaTestReturnPct,
    aggregateEmaExcessReturnPct: aggregateEmaTestReturnPct - aggregateBuyHoldReturnPct,
    aggregateSmaMinusEmaReturnPct: aggregateTestReturnPct - aggregateEmaTestReturnPct,
    emaPositiveReturnFolds,
    emaPositiveReturnFoldPct: emaPositiveReturnFolds / folds.length * 100
  };
}

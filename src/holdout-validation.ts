import type { MarketSnapshot } from "./domain.js";
import { runShadowBacktest, type ShadowBacktestResult } from "./shadow-backtest.js";
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
}

/**
 * Selects SMA parameters on an earlier chronological segment and evaluates the
 * selected pair on a later, untouched segment. The holdout backtest starts
 * cold (it does not carry training exposure/equity into the holdout), so its
 * first slowWindow observations serve as signal warm-up. This is a price proxy,
 * not a DLMM LP PnL simulation.
 */
export function validateSmaOnHoldout(
  snapshots: readonly MarketSnapshot[],
  config: HoldoutValidationConfig
): HoldoutValidationResult {
  if (!Number.isFinite(config.trainFraction) || config.trainFraction <= 0 || config.trainFraction >= 1) {
    throw new Error("trainFraction must be finite and strictly between 0 and 1");
  }

  const ordered = snapshots.map(snapshot => ({ ...snapshot }))
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
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
  const holdoutResult = runShadowBacktest(holdout, {
    fastWindow: selected.fastWindow,
    slowWindow: selected.slowWindow,
    costBps: config.costBps,
    initialCapitalUsd: config.initialCapitalUsd
  });

  return {
    methodology: "chronological-train-holdout",
    warning: "Single chronological holdout; the holdout backtest starts cold and needs signal warm-up. Results are a pair-price proxy, not DLMM LP PnL, and do not guarantee future performance.",
    trainObservations: training.length,
    holdoutObservations: holdout.length,
    trainStart: training[0]!.capturedAt,
    trainEnd: training.at(-1)!.capturedAt,
    holdoutStart: holdout[0]!.capturedAt,
    holdoutEnd: holdout.at(-1)!.capturedAt,
    selectedFastWindow: selected.fastWindow,
    selectedSlowWindow: selected.slowWindow,
    trainingResult: selected.result,
    holdoutResult
  };
}

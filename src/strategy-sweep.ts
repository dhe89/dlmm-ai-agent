import type { MarketSnapshot } from "./domain.js";
import { runShadowBacktest, type ShadowBacktestResult } from "./shadow-backtest.js";

export interface StrategySweepConfig {
  fastWindows: readonly number[];
  slowWindows: readonly number[];
  costBps: number;
  initialCapitalUsd: number;
}

export interface StrategySweepRow {
  fastWindow: number;
  slowWindow: number;
  result: ShadowBacktestResult;
}

/**
 * Compare SMA parameter combinations on one already-selected time series.
 * This is exploratory in-sample analysis, not a selection guarantee or
 * out-of-sample performance claim. Use a separate holdout period for validation.
 */
export function runSmaParameterSweep(
  snapshots: readonly MarketSnapshot[],
  config: StrategySweepConfig
): StrategySweepRow[] {
  if (config.fastWindows.length === 0 || config.slowWindows.length === 0) {
    throw new Error("fastWindows and slowWindows must not be empty");
  }
  if (config.fastWindows.length * config.slowWindows.length > 500) {
    throw new Error("parameter sweep is limited to 500 combinations");
  }
  const fastWindows = [...new Set(config.fastWindows)];
  const slowWindows = [...new Set(config.slowWindows)];
  for (const window of [...fastWindows, ...slowWindows]) {
    if (!Number.isInteger(window) || window < 1) {
      throw new Error("all windows must be positive integers");
    }
  }

  const results: StrategySweepRow[] = [];
  for (const fastWindow of fastWindows) {
    for (const slowWindow of slowWindows) {
      if (slowWindow <= fastWindow) continue;
      try {
        const result = runShadowBacktest(snapshots, {
          fastWindow,
          slowWindow,
          costBps: config.costBps,
          initialCapitalUsd: config.initialCapitalUsd
        });
        results.push({ fastWindow, slowWindow, result });
      } catch (error) {
        // Invalid combinations due to insufficient observations are skipped;
        // malformed data and mixed pools are still surfaced to the caller.
        if (error instanceof Error && error.message.startsWith("insufficient observations")) continue;
        throw error;
      }
    }
  }
  if (results.length === 0) throw new Error("no valid SMA parameter combinations for this data window");

  // Rank by excess return first, then lower drawdown, then simpler windows.
  results.sort((a, b) =>
    b.result.excessReturnPct - a.result.excessReturnPct ||
    a.result.maxDrawdownPct - b.result.maxDrawdownPct ||
    a.fastWindow - b.fastWindow ||
    a.slowWindow - b.slowWindow
  );
  return results;
}

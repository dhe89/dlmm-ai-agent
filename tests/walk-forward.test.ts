import { describe, expect, it } from "vitest";
import type { MarketSnapshot } from "../src/domain.js";
import { runSmaWalkForward } from "../src/walk-forward.js";

function series(prices: number[]): MarketSnapshot[] {
  return prices.map((currentPrice, index) => ({
    poolAddress: "pool-A",
    capturedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    currentPrice
  }));
}

describe("runSmaWalkForward", () => {
  it("evaluates chronological unseen folds with expanding training windows", () => {
    const snapshots = series(Array.from({ length: 40 }, (_, i) =>
      10 + Math.sin(i / 2) * 2 + i * 0.15
    ));
    const result = runSmaWalkForward(snapshots, {
      fastWindows: [2, 3],
      slowWindows: [4, 5],
      costBps: 10,
      initialCapitalUsd: 1000,
      initialTrainFraction: 0.5,
      folds: 2
    });
    expect(result.methodology).toBe("expanding-window-walk-forward");
    expect(result.folds).toHaveLength(2);
    expect(result.folds[0]!.trainObservations).toBe(20);
    expect(result.folds[1]!.trainObservations).toBeGreaterThan(result.folds[0]!.trainObservations);
    expect(result.folds[0]!.trainEnd < result.folds[0]!.testStart).toBe(true);
    expect(result.folds[0]!.testEnd < result.folds[1]!.testStart).toBe(true);
    expect(Number.isFinite(result.aggregateExcessReturnPct)).toBe(true);
    expect(result.positiveReturnFolds).toBeGreaterThanOrEqual(0);
    expect(result.positiveReturnFoldPct).toBeGreaterThanOrEqual(0);
    expect(result.distinctParameterSets).toBeGreaterThanOrEqual(1);
    expect(result.parameterStabilityPct).toBeGreaterThan(0);
    expect(result.parameterStabilityPct).toBeLessThanOrEqual(100);
    expect(Number.isFinite(result.aggregateEmaTestReturnPct)).toBe(true);
    expect(Number.isFinite(result.aggregateSmaMinusEmaReturnPct)).toBe(true);
    expect(result.folds[0]!.emaTestResult.observations).toBe(result.folds[0]!.testObservations);
    expect(result.emaPositiveReturnFoldPct).toBeGreaterThanOrEqual(0);
    expect(result.emaPositiveReturnFoldPct).toBeLessThanOrEqual(100);
  });

  it("rejects invalid fold counts, undersized data and test folds too short for SMA warm-up", () => {
    const config = {
      fastWindows: [1], slowWindows: [4], costBps: 0,
      initialCapitalUsd: 100, initialTrainFraction: 0.5, folds: 2
    };
    expect(() => runSmaWalkForward(series([1, 2, 3, 4, 5, 6]), {
      ...config, folds: 1
    })).toThrow(/at least 2/);
    expect(() => runSmaWalkForward(series([1, 2, 3, 4, 5, 6]), config))
      .toThrow(/insufficient observations|not enough observations/);
  });

  it("rejects mixed pools and invalid snapshot data before splitting folds", () => {
    const config = {
      fastWindows: [1], slowWindows: [3], costBps: 0,
      initialCapitalUsd: 100, initialTrainFraction: 0.5, folds: 2
    };
    const mixedPools = series(Array.from({ length: 20 }, (_, i) => i + 1)).map((snapshot, i) =>
      i === 15 ? { ...snapshot, poolAddress: "pool-B" } : snapshot
    );
    expect(() => runSmaWalkForward(mixedPools, config)).toThrow(/one pool/);
    const invalidPrice = series(Array.from({ length: 20 }, (_, i) => i + 1)).map((snapshot, i) =>
      i === 3 ? { ...snapshot, currentPrice: 0 } : snapshot
    );
    expect(() => runSmaWalkForward(invalidPrice, config)).toThrow(/positive and finite/);
  });

  it("fails clearly when a selected SMA window cannot warm up within a test fold", () => {
    const snapshots = series(Array.from({ length: 20 }, (_, i) => 10 + i));
    expect(() => runSmaWalkForward(snapshots, {
      fastWindows: [2], slowWindows: [5], costBps: 0,
      initialCapitalUsd: 100, initialTrainFraction: 0.5, folds: 3
    })).toThrow(/not enough observations in test fold/);
  });

  it("does not use future test data when selecting parameters for earlier folds", () => {
    const snapshots = series(Array.from({ length: 40 }, (_, i) => 10 + Math.sin(i / 2) * 2 + i * 0.15));
    const config = {
      fastWindows: [2, 3], slowWindows: [4, 5], costBps: 10,
      initialCapitalUsd: 1000, initialTrainFraction: 0.5, folds: 2
    };
    const baseline = runSmaWalkForward(snapshots, config);
    const changed = runSmaWalkForward(snapshots.map((snapshot, index) =>
      index >= 20 ? { ...snapshot, currentPrice: snapshot.currentPrice * 3 } : snapshot
    ), config);
    expect(changed.folds[0]!.selectedFastWindow).toBe(baseline.folds[0]!.selectedFastWindow);
    expect(changed.folds[0]!.selectedSlowWindow).toBe(baseline.folds[0]!.selectedSlowWindow);
    expect(changed.folds[0]!.trainingResult).toEqual(baseline.folds[0]!.trainingResult);
  });
});

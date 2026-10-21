import { describe, expect, it } from "vitest";
import type { MarketSnapshot } from "../src/domain.js";
import { validateSmaOnHoldout } from "../src/holdout-validation.js";

function series(prices: number[]): MarketSnapshot[] {
  return prices.map((currentPrice, index) => ({
    poolAddress: "pool-A",
    capturedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    currentPrice
  }));
}

describe("validateSmaOnHoldout", () => {
  it("selects parameters only on the earlier segment and reports later holdout metrics", () => {
    const snapshots = series([
      10, 9, 8, 9, 10, 12, 11, 13, 14, 12,
      15, 16, 15, 14, 13, 12, 11, 10, 11, 12,
      13, 14, 15, 16, 17, 18, 17, 19, 20, 21
    ]);
    const result = validateSmaOnHoldout(snapshots, {
      fastWindows: [2, 3],
      slowWindows: [4, 5],
      costBps: 10,
      initialCapitalUsd: 1000,
      trainFraction: 0.6
    });
    expect(result.methodology).toBe("chronological-train-holdout");
    expect(result.trainObservations).toBe(18);
    expect(result.holdoutObservations).toBe(12);
    expect(result.trainEnd < result.holdoutStart).toBe(true);
    expect(result.selectedSlowWindow).toBeGreaterThan(result.selectedFastWindow);
    expect(result.holdoutResult.observations).toBe(12);
    expect(result.holdoutEmaResult.observations).toBe(12);
    expect(Number.isFinite(result.holdoutComparison.smaMinusEmaReturnPct)).toBe(true);
    expect(["SMA", "EMA", "tie"]).toContain(result.holdoutComparison.lowerDrawdownStrategy);
    expect(result.warning).toContain("starts cold");
  });

  it("rejects invalid split fractions and segments too short for the requested windows", () => {
    expect(() => validateSmaOnHoldout(series([1, 2, 3, 4, 5, 6]), {
      fastWindows: [1], slowWindows: [3], costBps: 0,
      initialCapitalUsd: 100, trainFraction: 1
    })).toThrow(/strictly between 0 and 1/);
    expect(() => validateSmaOnHoldout(series([1, 2, 3, 4, 5, 6]), {
      fastWindows: [1], slowWindows: [4], costBps: 0,
      initialCapitalUsd: 100, trainFraction: 0.5
    })).toThrow(/insufficient observations|no valid SMA/);
  });

  it("does not allow holdout observations to leak into training selection", () => {
    const snapshots = series([10, 9, 8, 9, 10, 12, 11, 13, 14, 12, 15, 16]);
    const config = {
      fastWindows: [1, 2], slowWindows: [3, 4],
      costBps: 10, initialCapitalUsd: 1000, trainFraction: 0.5
    };
    const baseline = validateSmaOnHoldout(snapshots, config);
    const changedHoldout = snapshots.map((snapshot, index) =>
      index >= 6 ? { ...snapshot, currentPrice: snapshot.currentPrice * 10 } : snapshot
    );
    const changed = validateSmaOnHoldout(changedHoldout, config);
    expect(changed.selectedFastWindow).toBe(baseline.selectedFastWindow);
    expect(changed.selectedSlowWindow).toBe(baseline.selectedSlowWindow);
    expect(changed.trainingResult).toEqual(baseline.trainingResult);
  });
});

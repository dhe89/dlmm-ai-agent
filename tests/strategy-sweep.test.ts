import { describe, expect, it } from "vitest";
import type { MarketSnapshot } from "../src/domain.js";
import { runSmaParameterSweep } from "../src/strategy-sweep.js";

function series(prices: number[]): MarketSnapshot[] {
  return prices.map((currentPrice, index) => ({
    poolAddress: "pool-A",
    capturedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    currentPrice
  }));
}

describe("runSmaParameterSweep", () => {
  it("returns deterministic rankings with benchmark metrics", () => {
    const snapshots = series([10, 9, 8, 9, 10, 12, 11, 13, 14, 12, 15, 16]);
    const config = { fastWindows: [2, 3, 2], slowWindows: [4, 5], costBps: 10, initialCapitalUsd: 1000 };
    const first = runSmaParameterSweep(snapshots, config);
    const second = runSmaParameterSweep(snapshots, config);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
    expect(first.every(row => row.slowWindow > row.fastWindow)).toBe(true);
    expect(first[0]!.result).toHaveProperty("excessReturnPct");
  });

  it("rejects invalid or excessively large search spaces", () => {
    expect(() => runSmaParameterSweep(series([1, 2, 3, 4]), {
      fastWindows: [], slowWindows: [3], costBps: 0, initialCapitalUsd: 100
    })).toThrow(/must not be empty/);
    expect(() => runSmaParameterSweep(series([1, 2, 3, 4]), {
      fastWindows: [1], slowWindows: [1], costBps: 0, initialCapitalUsd: 100
    })).toThrow(/no valid SMA/);
    expect(() => runSmaParameterSweep(series([1, 2, 3, 4]), {
      fastWindows: Array.from({ length: 23 }, (_, i) => i + 1),
      slowWindows: Array.from({ length: 23 }, (_, i) => i + 1),
      costBps: 0, initialCapitalUsd: 100
    })).toThrow(/500 combinations/);
  });

  it("does not hide mixed-pool data errors", () => {
    const snapshots = series([1, 2, 3, 4, 5]).map((snapshot, index) =>
      index === 4 ? { ...snapshot, poolAddress: "pool-B" } : snapshot
    );
    expect(() => runSmaParameterSweep(snapshots, {
      fastWindows: [1], slowWindows: [3], costBps: 0, initialCapitalUsd: 100
    })).toThrow(/one pool/);
  });
});

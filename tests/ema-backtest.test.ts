import { describe, expect, it } from "vitest";
import type { MarketSnapshot } from "../src/domain.js";
import { runEmaBacktest } from "../src/ema-backtest.js";

function series(prices: number[]): MarketSnapshot[] {
  return prices.map((currentPrice, index) => ({
    poolAddress: "pool-A",
    capturedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    currentPrice
  }));
}

describe("runEmaBacktest", () => {
  it("returns deterministic cost-aware metrics and passive benchmark", () => {
    const snapshots = series([10, 9, 8, 9, 10, 12, 11, 13, 14, 12, 15, 16, 15, 17]);
    const config = { fastWindow: 2, slowWindow: 4, costBps: 10, initialCapitalUsd: 1000 };
    const first = runEmaBacktest(snapshots, config);
    expect(runEmaBacktest(snapshots, config)).toEqual(first);
    expect(first.methodology).toBe("pair-price-ema-crossover-proxy");
    expect(first.observations).toBe(snapshots.length);
    expect(Number.isFinite(first.excessReturnPct)).toBe(true);
    expect(first.maxDrawdownPct).toBeGreaterThanOrEqual(0);
  });

  it("rejects invalid windows, insufficient history, and mixed pools", () => {
    expect(() => runEmaBacktest(series([1, 2, 3, 4]), {
      fastWindow: 3, slowWindow: 2, costBps: 0, initialCapitalUsd: 100
    })).toThrow(/greater than fastWindow/);
    expect(() => runEmaBacktest(series([1, 2, 3, 4]), {
      fastWindow: 1, slowWindow: 4, costBps: 0, initialCapitalUsd: 100
    })).toThrow(/insufficient observations/);
    const mixed = series([1, 2, 3, 4, 5]).map((snapshot, index) =>
      index === 4 ? { ...snapshot, poolAddress: "pool-B" } : snapshot
    );
    expect(() => runEmaBacktest(mixed, {
      fastWindow: 1, slowWindow: 3, costBps: 0, initialCapitalUsd: 100
    })).toThrow(/one pool/);
  });

  it("rejects same-timestamp and non-positive price data", () => {
    const snapshots = series([1, 2, 3, 4, 5]);
    expect(() => runEmaBacktest([snapshots[0]!, { ...snapshots[1]!, capturedAt: snapshots[0]!.capturedAt }, snapshots[2]!], {
      fastWindow: 1, slowWindow: 2, costBps: 0, initialCapitalUsd: 100
    })).toThrow(/timestamps must be unique/);
    expect(() => runEmaBacktest(snapshots.map((snapshot, index) =>
      index === 3 ? { ...snapshot, currentPrice: 0 } : snapshot
    ), {
      fastWindow: 1, slowWindow: 3, costBps: 0, initialCapitalUsd: 100
    })).toThrow(/positive and finite/);
  });
});

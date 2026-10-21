import { describe, expect, it } from "vitest";
import { runShadowBacktest } from "../src/shadow-backtest.js";
import type { MarketSnapshot } from "../src/domain.js";

function series(prices: number[]): MarketSnapshot[] {
  return prices.map((currentPrice, index) => ({
    poolAddress: "pool-A",
    capturedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    currentPrice
  }));
}

const config = { fastWindow: 2, slowWindow: 3, costBps: 10, initialCapitalUsd: 1_000 };

describe("runShadowBacktest", () => {
  it("returns a deterministic proxy report with risk metrics and costs", () => {
    const result = runShadowBacktest(series([10, 9, 8, 9, 10, 12, 11, 13]), config);
    expect(result.methodology).toBe("pair-price-sma-crossover-proxy");
    expect(result.observations).toBe(8);
    expect(result.equityCurve).toHaveLength(8);
    expect(result.finalEquityUsd).toBeLessThanOrEqual(1_300);
    expect(result.maxDrawdownPct).toBeGreaterThanOrEqual(0);
    expect(result.warning).toMatch(/not DLMM LP PnL/);
  });

  it("does not use a signal formed on the same bar for that bar's return", () => {
    const result = runShadowBacktest(series([10, 10, 10, 10, 20]), {
      ...config, costBps: 0
    });
    // With slowWindow=3, the final price jump cannot be anticipated from that bar.
    expect(result.finalEquityUsd).toBe(1_000);
  });

  it("rejects insufficient, mixed-pool, duplicate-time, and invalid input", () => {
    expect(() => runShadowBacktest(series([1, 2, 3]), config)).toThrow(/insufficient/);
    expect(() => runShadowBacktest([
      ...series([1, 2, 3, 4]),
      { ...series([5])[0]!, poolAddress: "pool-B", capturedAt: new Date(Date.UTC(2026, 0, 1, 0, 4)).toISOString() }
    ], config)).toThrow(/one pool/);
    expect(() => runShadowBacktest([
      ...series([1, 2, 3, 4]),
      { ...series([5])[0]!, capturedAt: series([1])[0]!.capturedAt }
    ], config)).toThrow(/timestamps must be unique/);
    expect(() => runShadowBacktest(series([1, 2, 3, 4]), {
      ...config, slowWindow: 1
    })).toThrow(/greater than fastWindow/);
  });
});

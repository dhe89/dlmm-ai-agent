import { describe, expect, it } from "vitest";
import type { MarketSnapshot } from "../src/domain.js";
import { calculatePaperStrategySignal } from "../src/paper-strategy-runner.js";

function snapshots(prices: number[]): MarketSnapshot[] {
  return prices.map((currentPrice, index) => ({
    poolAddress: "pool-A",
    capturedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    currentPrice
  }));
}

describe("calculatePaperStrategySignal", () => {
  it("reports warming up until there are enough observations", () => {
    expect(calculatePaperStrategySignal(snapshots([1, 2]), 2, 3)).toEqual({
      signal: "WARMING_UP", fastAverage: null, slowAverage: null, observations: 2
    });
  });

  it("emits a long research signal when the fast average exceeds the slow average", () => {
    expect(calculatePaperStrategySignal(snapshots([1, 2, 3, 4]), 2, 3)).toMatchObject({
      signal: "LONG", fastAverage: 3.5, slowAverage: 3, observations: 4
    });
  });

  it("emits cash when the fast average does not exceed the slow average", () => {
    expect(calculatePaperStrategySignal(snapshots([4, 3, 2]), 2, 3)).toMatchObject({
      signal: "CASH", fastAverage: 2.5, slowAverage: 3, observations: 3
    });
  });

  it("rejects invalid windows and invalid pair prices", () => {
    expect(() => calculatePaperStrategySignal(snapshots([1, 2, 3]), 0, 2)).toThrow(/positive integer/);
    expect(() => calculatePaperStrategySignal(snapshots([1, 2, 3]), 3, 3)).toThrow(/smaller than/);
    expect(() => calculatePaperStrategySignal(snapshots([1, -2, 3]), 1, 2)).toThrow(/invalid pair prices/);
    const duplicateTimes = snapshots([1, 2, 3]).map((item, index) => ({ ...item, capturedAt: index === 2 ? item.capturedAt : "2026-01-01T00:00:00.000Z" }));
    expect(() => calculatePaperStrategySignal(duplicateTimes, 1, 2)).toThrow(/timestamps must be unique/);
  });

  it("validates incomplete warm-up history instead of masking bad data", () => {
    expect(() => calculatePaperStrategySignal(snapshots([-1]), 1, 3)).toThrow(/invalid pair prices/);
    expect(() => calculatePaperStrategySignal([{ ...snapshots([1])[0]!, capturedAt: "not-a-date" }], 1, 3)).toThrow(/invalid timestamps/);
  });

  it("rejects mixed-pool history so unrelated prices cannot contaminate a signal", () => {
    const mixed = snapshots([1, 2]).map((snapshot, index) => ({
      ...snapshot,
      poolAddress: index === 0 ? "pool-A" : "pool-B"
    }));
    expect(() => calculatePaperStrategySignal(mixed, 1, 3)).toThrow(/exactly one pool/);
  });

  it("rejects empty pool identifiers", () => {
    expect(() => calculatePaperStrategySignal([{ ...snapshots([1])[0]!, poolAddress: " " }], 1, 3)).toThrow(/empty pool address/);
  });
});

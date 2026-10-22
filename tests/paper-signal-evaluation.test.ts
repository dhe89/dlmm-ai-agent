import { describe, expect, it } from "vitest";
import { evaluatePaperSignals } from "../src/paper-signal-evaluation.js";
import type { MarketSnapshot } from "../src/domain.js";

const snapshots: MarketSnapshot[] = [100, 110, 105, 120, 90].map((currentPrice, index) => ({
  poolAddress: "pool-A",
  capturedAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  currentPrice
}));

describe("evaluatePaperSignals", () => {
  it("evaluates each signal only against a later observed price", () => {
    const result = evaluatePaperSignals(snapshots, [
      { poolAddress: "pool-A", capturedAt: snapshots[0]!.capturedAt, signal: "LONG" },
      { poolAddress: "pool-A", capturedAt: snapshots[1]!.capturedAt, signal: "CASH" },
      { poolAddress: "pool-A", capturedAt: snapshots[2]!.capturedAt, signal: "WARMING_UP" },
      { poolAddress: "other-pool", capturedAt: snapshots[0]!.capturedAt, signal: "LONG" }
    ], { forwardSteps: 1, costBpsPerSide: 10 });
    expect(result).toMatchObject({ observations: 5, evaluatedSignals: 2, longSignals: 1, cashSignals: 1 });
    expect(result.forwardReturnsPct[0]).toBeCloseTo(10);
    expect(result.forwardReturnsPct[1]).toBeCloseTo(-100 / 110 * 100);
  });

  it("rejects invalid prices, duplicate timestamps, and invalid costs", () => {
    expect(() => evaluatePaperSignals(snapshots, [], { forwardSteps: 0, costBpsPerSide: 10 })).toThrow(/forwardSteps/);
    expect(() => evaluatePaperSignals(snapshots, [], { forwardSteps: 1, costBpsPerSide: 10_000 })).toThrow(/costBpsPerSide/);
    expect(() => evaluatePaperSignals([{ ...snapshots[0]!, currentPrice: 0 }, snapshots[1]!], [], { forwardSteps: 1, costBpsPerSide: 0 })).toThrow(/positive and finite/);
    expect(() => evaluatePaperSignals([snapshots[0]!, { ...snapshots[1]!, capturedAt: snapshots[0]!.capturedAt }], [], { forwardSteps: 1, costBpsPerSide: 0 })).toThrow(/unique/);
  });

  it("returns an explicit zero-count report when no signal has a future observation", () => {
    const result = evaluatePaperSignals(snapshots.slice(0, 2), [
      { poolAddress: "pool-A", capturedAt: snapshots[1]!.capturedAt, signal: "LONG" }
    ], { forwardSteps: 2, costBpsPerSide: 0 });
    expect(result.evaluatedSignals).toBe(0);
    expect(result.hitRatePct).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { assertFreshMarketSnapshot } from "../src/market-data-validation.js";
import type { MarketSnapshot } from "../src/domain.js";

const now = "2026-10-21T12:00:00.000Z";
const snapshot: MarketSnapshot = {
  poolAddress: "Pool111",
  capturedAt: "2026-10-21T11:59:30.000Z",
  currentPrice: 2,
  volume24hUsd: 1_000,
  tvlUsd: 5_000
};

describe("assertFreshMarketSnapshot", () => {
  it("accepts a valid recent snapshot", () => {
    expect(() => assertFreshMarketSnapshot(snapshot, { now, maxAgeMs: 60_000 })).not.toThrow();
  });

  it("rejects stale and future snapshots", () => {
    expect(() => assertFreshMarketSnapshot(snapshot, {
      now,
      maxAgeMs: 1_000
    })).toThrow(/stale/);
    expect(() => assertFreshMarketSnapshot({
      ...snapshot,
      capturedAt: "2026-10-21T12:00:01.000Z"
    }, { now })).toThrow(/future/);
  });

  it("rejects invalid price, malformed timestamps, and invalid metrics", () => {
    expect(() => assertFreshMarketSnapshot({ ...snapshot, currentPrice: 0 }, { now }))
      .toThrow(/currentPrice/);
    expect(() => assertFreshMarketSnapshot({ ...snapshot, capturedAt: "bad" }, { now }))
      .toThrow(/valid timestamp/);
    expect(() => assertFreshMarketSnapshot({ ...snapshot, tvlUsd: -1 }, { now }))
      .toThrow(/tvlUsd/);
    expect(() => assertFreshMarketSnapshot(snapshot, { now, maxAgeMs: -1 }))
      .toThrow(/maxAgeMs/);
  });
});

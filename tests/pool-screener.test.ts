import { describe, expect, it } from "vitest";
import { screenPoolCandidates } from "../src/pool-screener.js";
import type { MarketSnapshot } from "../src/domain.js";

const now = "2026-10-21T10:00:30.000Z";
const base = {
  capturedAt: "2026-10-21T10:00:00.000Z",
  currentPrice: 1.25
};

function snapshot(overrides: Partial<MarketSnapshot> & Pick<MarketSnapshot, "poolAddress">): MarketSnapshot {
  return { ...base, ...overrides };
}

const config = {
  minTvlUsd: 100_000,
  minVolume24hUsd: 25_000,
  maxCandidates: 10,
  maxSnapshotAgeMs: 60_000
};

describe("screenPoolCandidates", () => {
  it("filters by minimum liquidity and volume, then ranks by turnover ratio", () => {
    const result = screenPoolCandidates([
      snapshot({ poolAddress: "pool-low-tvl", tvlUsd: 50_000, volume24hUsd: 100_000 }),
      snapshot({ poolAddress: "pool-low-volume", tvlUsd: 500_000, volume24hUsd: 10_000 }),
      snapshot({ poolAddress: "pool-a", tvlUsd: 200_000, volume24hUsd: 100_000 }),
      snapshot({ poolAddress: "pool-b", tvlUsd: 500_000, volume24hUsd: 100_000 })
    ], config, { now });

    expect(result.map((item) => item.poolAddress)).toEqual(["pool-a", "pool-b"]);
    expect(result.map((item) => item.rank)).toEqual([1, 2]);
    expect(result[0]?.volumeToTvlRatio).toBe(0.5);
  });

  it("excludes pools missing required USD metrics and deduplicates addresses", () => {
    const result = screenPoolCandidates([
      snapshot({ poolAddress: "pool-a", tvlUsd: 200_000, volume24hUsd: 100_000 }),
      snapshot({ poolAddress: "pool-a", tvlUsd: 300_000, volume24hUsd: 200_000 }),
      snapshot({ poolAddress: "pool-missing-volume", tvlUsd: 200_000 }),
      snapshot({ poolAddress: "pool-missing-tvl", volume24hUsd: 100_000 })
    ], config, { now });

    expect(result).toHaveLength(1);
    expect(result[0]?.tvlUsd).toBe(200_000);
  });

  it("does not let an ineligible duplicate suppress a later eligible pool", () => {
    const result = screenPoolCandidates([
      snapshot({ poolAddress: "pool-a" }),
      snapshot({ poolAddress: "pool-a", tvlUsd: 200_000, volume24hUsd: 100_000 })
    ], config, { now });

    expect(result).toHaveLength(1);
    expect(result[0]?.poolAddress).toBe("pool-a");
  });

  it("rejects stale snapshots and invalid screener configuration", () => {
    expect(() => screenPoolCandidates([
      snapshot({
        poolAddress: "pool-stale",
        capturedAt: "2026-10-21T09:00:00.000Z",
        tvlUsd: 200_000,
        volume24hUsd: 100_000
      })
    ], config, { now })).toThrow(/stale/);

    expect(() => screenPoolCandidates([], { ...config, maxCandidates: 0 }, { now }))
      .toThrow(/maxCandidates/);
  });

  it("uses deterministic tie-breakers and caps the candidate list", () => {
    const result = screenPoolCandidates([
      snapshot({ poolAddress: "pool-c", tvlUsd: 100_000, volume24hUsd: 50_000 }),
      snapshot({ poolAddress: "pool-b", tvlUsd: 100_000, volume24hUsd: 50_000 }),
      snapshot({ poolAddress: "pool-a", tvlUsd: 100_000, volume24hUsd: 50_000 })
    ], { ...config, maxCandidates: 2 }, { now });

    expect(result.map((item) => item.poolAddress)).toEqual(["pool-a", "pool-b"]);
  });
});

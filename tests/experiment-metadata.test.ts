import { describe, expect, it } from "vitest";
import type { MarketSnapshot } from "../src/domain.js";
import { buildExperimentMetadata } from "../src/experiment-metadata.js";

function series(): MarketSnapshot[] {
  return [0, 60, 180, 240].map((minute, index) => ({
    poolAddress: "pool-A",
    capturedAt: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
    currentPrice: index + 1
  }));
}

describe("buildExperimentMetadata", () => {
  it("creates stable input fingerprints and snapshot interval statistics", () => {
    const snapshots = series();
    const first = buildExperimentMetadata('{"sample":true}', snapshots);
    const second = buildExperimentMetadata('{"sample":true}', snapshots);
    expect(first).toEqual(second);
    expect(first.inputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.dataQuality.observations).toBe(4);
    expect(first.dataQuality.minIntervalSeconds).toBe(3600);
    expect(first.dataQuality.medianIntervalSeconds).toBe(3600);
    expect(first.dataQuality.maxIntervalSeconds).toBe(7200);
  });

  it("rejects mixed pools, duplicate timestamps and invalid prices", () => {
    expect(() => buildExperimentMetadata("x", [
      ...series().slice(0, 1),
      { ...series()[1]!, poolAddress: "pool-B" }
    ])).toThrow(/one pool/);
    expect(() => buildExperimentMetadata("x", [
      series()[0]!, { ...series()[0]!, currentPrice: 2 }
    ])).toThrow(/timestamps must be unique/);
    expect(() => buildExperimentMetadata("x", [
      { ...series()[0]!, currentPrice: Number.NaN }
    ])).toThrow(/positive and finite/);
  });
});

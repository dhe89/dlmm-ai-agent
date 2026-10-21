import { describe, expect, it } from "vitest";
import { parseHistoricalSnapshots } from "../src/historical-backtest.js";

describe("parseHistoricalSnapshots", () => {
  it("loads JSONL snapshots and collector-wrapped records", () => {
    const text = [
      JSON.stringify({ schemaVersion: 1, source: "test", poolAddress: "pool-A", capturedAt: "2026-01-01T00:00:00.000Z", currentPrice: 2 }),
      JSON.stringify({ snapshot: { poolAddress: "pool-A", capturedAt: "2026-01-01T00:01:00.000Z", currentPrice: 3, tvlUsd: 100, volume24hUsd: 25 } }),
      ""
    ].join("\n");
    expect(parseHistoricalSnapshots(text)).toEqual([
      { poolAddress: "pool-A", capturedAt: "2026-01-01T00:00:00.000Z", currentPrice: 2 },
      { poolAddress: "pool-A", capturedAt: "2026-01-01T00:01:00.000Z", currentPrice: 3, tvlUsd: 100, volume24hUsd: 25 }
    ]);
  });

  it("rejects malformed records with line numbers", () => {
    expect(() => parseHistoricalSnapshots("{}\nnot-json")).toThrow(/line 2/);
    expect(() => parseHistoricalSnapshots(JSON.stringify({ poolAddress: "", capturedAt: "2026-01-01", currentPrice: 1 }))).toThrow(/poolAddress/);
    expect(() => parseHistoricalSnapshots(JSON.stringify({ poolAddress: "pool-A", capturedAt: "bad-date", currentPrice: 1 }))).toThrow(/capturedAt/);
    expect(() => parseHistoricalSnapshots(JSON.stringify({ poolAddress: "pool-A", capturedAt: "2026-01-01", currentPrice: 0 }))).toThrow(/currentPrice/);
    expect(() => parseHistoricalSnapshots(JSON.stringify({ poolAddress: "pool-A", capturedAt: "2026-01-01", currentPrice: 1, tvlUsd: -1 }))).toThrow(/tvlUsd/);
    expect(() => parseHistoricalSnapshots(" \n ")).toThrow(/no snapshot records/);
  });
});

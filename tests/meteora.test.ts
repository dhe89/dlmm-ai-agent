import { describe, expect, it, vi } from "vitest";
import {
  MeteoraPoolCollector,
  normalizePool,
  toMarketSnapshot
} from "../src/collectors/meteora.js";

describe("normalizePool", () => {
  it("normalizes known pool fields without inventing missing values", () => {
    expect(normalizePool({
      address: "Pool111",
      name: "SOL-TEST",
      price: 12.5,
      active_bin_id: 42,
      volume_24h: 9000,
      tvl: 120000
    })).toEqual({
      address: "Pool111",
      name: "SOL-TEST",
      priceUsd: 12.5,
      activeBinId: 42,
      volume24hUsd: 9000,
      tvlUsd: 120000
    });
  });

  it("rejects rows without a pool address", () => {
    expect(normalizePool({ price: 1 })).toBeUndefined();
    expect(normalizePool(null)).toBeUndefined();
  });

  it("keeps optional fields absent when the source does not provide them", () => {
    expect(normalizePool({ address: "Pool111" })).toEqual({ address: "Pool111" });
  });
});

describe("MeteoraPoolCollector", () => {
  it("requests pools and returns retrieval metadata", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        data: [{ address: "Pool111", price: 2, active_bin_id: 7 }]
      }), { status: 200, headers: { "content-type": "application/json" } })
    );
    const collector = new MeteoraPoolCollector({
      baseUrl: "https://example.test",
      fetchImpl
    });

    const result = await collector.collectPools(10);

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("/pools?");
    expect(result.pools).toEqual([{
      address: "Pool111",
      priceUsd: 2,
      activeBinId: 7
    }]);
    expect(Number.isFinite(Date.parse(result.retrievedAt))).toBe(true);
  });

  it("rejects invalid page sizes", async () => {
    const collector = new MeteoraPoolCollector({ fetchImpl: vi.fn<typeof fetch>() });
    await expect(collector.collectPools(0)).rejects.toThrow(/pageSize/);
  });

  it("rejects HTTP errors", async () => {
    const collector = new MeteoraPoolCollector({
      baseUrl: "https://example.test",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("no", { status: 503 }))
    });
    await expect(collector.collectPools()).rejects.toThrow(/HTTP 503/);
  });

  it("rejects unexpected response structures", async () => {
    const collector = new MeteoraPoolCollector({
      baseUrl: "https://example.test",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ pools: [] }), { status: 200 })
      )
    });
    await expect(collector.collectPools()).rejects.toThrow(/expected a data array/);
  });
});

describe("toMarketSnapshot", () => {
  it("requires price, active bin, and a valid timestamp", () => {
    expect(toMarketSnapshot({ address: "Pool111" }, new Date().toISOString())).toBeUndefined();
    expect(toMarketSnapshot({
      address: "Pool111", priceUsd: 3, activeBinId: 99
    }, "not-a-date")).toBeUndefined();
  });

  it("creates a snapshot when required fields are present", () => {
    expect(toMarketSnapshot({
      address: "Pool111", priceUsd: 3, activeBinId: 99, tvlUsd: 500
    }, "2026-10-21T12:00:00.000Z")).toEqual({
      poolAddress: "Pool111",
      capturedAt: "2026-10-21T12:00:00.000Z",
      priceUsd: 3,
      activeBinId: 99,
      tvlUsd: 500
    });
  });
});

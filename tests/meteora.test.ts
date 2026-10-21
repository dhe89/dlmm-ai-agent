import { describe, expect, it, vi } from "vitest";
import {
  MeteoraPoolCollector,
  normalizePool,
  toMarketSnapshot
} from "../src/collectors/meteora.js";

describe("normalizePool", () => {
  it("normalizes the documented Meteora DLMM Data API fields", () => {
    expect(normalizePool({
      address: "Pool111",
      name: "SOL-TEST",
      current_price: 12.5,
      volume: { "24h": 9000, "1h": 1000 },
      tvl: 120000
    })).toEqual({
      address: "Pool111",
      name: "SOL-TEST",
      currentPrice: 12.5,
      volume24hUsd: 9000,
      tvlUsd: 120000
    });
  });

  it("does not treat a token price or undocumented active-bin field as pool data", () => {
    expect(normalizePool({
      address: "Pool111",
      token_x: { price: 4 },
      active_bin_id: 42
    })).toEqual({ address: "Pool111" });
  });

  it("rejects rows without a pool address", () => {
    expect(normalizePool({ current_price: 1 })).toBeUndefined();
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
        total: 1,
        pages: 1,
        current_page: 1,
        page_size: 10,
        data: [{
          address: "Pool111",
          name: "SOL-TEST",
          current_price: 2,
          volume: { "24h": 900 },
          tvl: 5000
        }]
      }), { status: 200, headers: { "content-type": "application/json" } })
    );
    const collector = new MeteoraPoolCollector({
      baseUrl: "https://example.test",
      fetchImpl
    });

    const result = await collector.collectPools(10);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const requestedUrl = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(requestedUrl.pathname).toBe("/pools");
    expect(requestedUrl.searchParams.get("page")).toBe("1");
    expect(requestedUrl.searchParams.get("page_size")).toBe("10");
    expect(requestedUrl.searchParams.get("sort_by")).toBe("volume_24h:desc");
    expect(result.pools).toEqual([{
      address: "Pool111",
      name: "SOL-TEST",
      currentPrice: 2,
      volume24hUsd: 900,
      tvlUsd: 5000
    }]);
    expect(Number.isFinite(Date.parse(result.retrievedAt))).toBe(true);
  });

  it("rejects invalid page sizes", async () => {
    const collector = new MeteoraPoolCollector({ fetchImpl: vi.fn<typeof fetch>() });
    await expect(collector.collectPools(0)).rejects.toThrow(/pageSize/);
  });

  it("rejects invalid timeout configuration", async () => {
    const collector = new MeteoraPoolCollector({
      timeoutMs: 0,
      fetchImpl: vi.fn<typeof fetch>()
    });
    await expect(collector.collectPools()).rejects.toThrow(/timeoutMs/);
  });

  it("rejects HTTP errors", async () => {
    const collector = new MeteoraPoolCollector({
      baseUrl: "https://example.test",
      maxRetries: 0,
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("no", { status: 503 }))
    });
    await expect(collector.collectPools()).rejects.toThrow(/HTTP 503/);
  });

  it("retries a rate-limited response with bounded backoff, then succeeds", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("slow down", {
        status: 429,
        headers: { "retry-after": "1" }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ address: "Pool111", current_price: 1 }] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      }));
    const sleepImpl = vi.fn(async (_milliseconds: number) => undefined);
    const collector = new MeteoraPoolCollector({
      baseUrl: "https://example.test",
      maxRetries: 2,
      sleepImpl,
      fetchImpl
    });

    const result = await collector.collectPools();

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleepImpl).toHaveBeenCalledWith(1_000);
    expect(result.pools).toEqual([{ address: "Pool111", currentPrice: 1 }]);
  });

  it("does not retry client errors and rejects invalid retry settings", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("bad request", { status: 400 }));
    const collector = new MeteoraPoolCollector({
      baseUrl: "https://example.test",
      sleepImpl: async () => undefined,
      fetchImpl
    });
    await expect(collector.collectPools()).rejects.toThrow(/HTTP 400/);
    expect(fetchImpl).toHaveBeenCalledOnce();

    expect(() => new MeteoraPoolCollector({ maxRetries: 6 })).toThrow(/maxRetries/);
    expect(() => new MeteoraPoolCollector({ retryBaseDelayMs: -1 })).toThrow(/retryBaseDelayMs/);
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

  it("rejects invalid JSON", async () => {
    const collector = new MeteoraPoolCollector({
      baseUrl: "https://example.test",
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("not-json", { status: 200 })
      )
    });
    await expect(collector.collectPools()).rejects.toThrow(/invalid JSON/);
  });
});

describe("toMarketSnapshot", () => {
  it("requires a documented pool price and a valid timestamp", () => {
    expect(toMarketSnapshot({ address: "Pool111" }, new Date().toISOString())).toBeUndefined();
    expect(toMarketSnapshot({
      address: "Pool111", currentPrice: 3
    }, "not-a-date")).toBeUndefined();
  });

  it("creates a snapshot without fabricating an active bin or USD price", () => {
    expect(toMarketSnapshot({
      address: "Pool111", currentPrice: 3, tvlUsd: 500
    }, "2026-10-21T12:00:00.000Z")).toEqual({
      poolAddress: "Pool111",
      capturedAt: "2026-10-21T12:00:00.000Z",
      currentPrice: 3,
      tvlUsd: 500
    });
  });
});

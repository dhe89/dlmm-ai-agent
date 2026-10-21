import type { MarketSnapshot } from "../domain.js";

const DEFAULT_BASE_URL = "https://dlmm.datapi.meteora.ag";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface MeteoraPoolCollectorOptions {
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Number of retries after the initial request. */
  maxRetries?: number;
  /** Exponential backoff base delay in milliseconds. */
  retryBaseDelayMs?: number;
  sleepImpl?: (milliseconds: number) => Promise<void>;
}

export interface MeteoraPoolSummary {
  address: string;
  name?: string;
  /** Pool pair price from the Data API; not assumed to be USD-denominated. */
  currentPrice?: number;
  volume24hUsd?: number;
  tvlUsd?: number;
}

export interface CollectionResult {
  source: string;
  retrievedAt: string;
  pools: MeteoraPoolSummary[];
}

/** Raw detail payload is preserved until the endpoint schema is verified. */
export interface PoolDetailResult {
  source: string;
  retrievedAt: string;
  requestedAddress: string;
  payload: Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function pickNumber(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const n = finiteNumber(record[key]);
    if (n !== undefined) return n;
  }
  return undefined;
}

function nestedNumber(record: Record<string, unknown>, parentKey: string, keys: string[]): number | undefined {
  const parent = asRecord(record[parentKey]);
  return parent ? pickNumber(parent, keys) : undefined;
}

/** Normalize documented Meteora DLMM Data API pool fields without inventing values. */
export function normalizePool(value: unknown): MeteoraPoolSummary | undefined {
  const row = asRecord(value);
  if (!row || typeof row.address !== "string" || row.address.trim() === "") return undefined;

  const volume24hUsd =
    nestedNumber(row, "volume", ["24h", "24H"]) ??
    pickNumber(row, ["volume_24h", "volume24hUsd"]);
  const tvlUsd = pickNumber(row, ["tvl", "tvlUsd"]);
  const currentPrice = pickNumber(row, ["current_price", "currentPrice"]);

  return {
    address: row.address,
    ...(typeof row.name === "string" ? { name: row.name } : {}),
    ...(currentPrice !== undefined ? { currentPrice } : {}),
    ...(volume24hUsd !== undefined ? { volume24hUsd } : {}),
    ...(tvlUsd !== undefined ? { tvlUsd } : {})
  };
}

export class MeteoraPoolCollector {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleepImpl: (milliseconds: number) => Promise<void>;

  constructor(options: MeteoraPoolCollectorOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 250;
    this.sleepImpl = options.sleepImpl ?? ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds))
    );
    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0 || this.maxRetries > 5) {
      throw new Error("maxRetries must be an integer between 0 and 5");
    }
    if (!Number.isFinite(this.retryBaseDelayMs) || this.retryBaseDelayMs < 0) {
      throw new Error("retryBaseDelayMs must be a finite non-negative number");
    }
  }

  async collectPools(pageSize = 20): Promise<CollectionResult> {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
      throw new Error("pageSize must be an integer between 1 and 1000");
    }
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("timeoutMs must be a positive finite number");
    }

    const url = new URL(`${this.baseUrl}/pools`);
    url.searchParams.set("page", "1");
    url.searchParams.set("page_size", String(pageSize));
    url.searchParams.set("sort_by", "volume_24h:desc");

    const response = await this.requestWithRetry(url.toString());

    if (!response.ok) {
      throw new Error(`Meteora API returned HTTP ${response.status}`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Meteora API returned invalid JSON");
    }

    const root = asRecord(payload);
    if (!root || !Array.isArray(root.data)) {
      throw new Error("Unexpected Meteora API response: expected a data array");
    }

    const pools = root.data.map(normalizePool).filter(
      (pool): pool is MeteoraPoolSummary => pool !== undefined
    );

    if (root.data.length > 0 && pools.length === 0) {
      throw new Error("Meteora response contained no valid pool addresses");
    }

    return {
      source: this.baseUrl,
      retrievedAt: new Date().toISOString(),
      pools
    };
  }
  /**
   * Fetch the official per-pool detail endpoint without assuming undocumented
   * fields exist. Keep the payload intact for schema inspection and validation.
   */
  async collectPoolDetails(poolAddress: string): Promise<PoolDetailResult> {
    if (!poolAddress.trim()) throw new Error("poolAddress must not be empty");
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error("timeoutMs must be a positive finite number");
    }

    const url = new URL(`${this.baseUrl}/pools/${encodeURIComponent(poolAddress)}`);
    const response = await this.requestWithRetry(url.toString());
    if (!response.ok) {
      throw new Error(`Meteora API returned HTTP ${response.status}`);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Meteora API returned invalid JSON");
    }

    const root = asRecord(payload);
    if (!root) {
      throw new Error("Unexpected Meteora pool detail response: expected an object");
    }
    const detail = asRecord(root.data) ?? root;
    if (typeof detail.address === "string" && detail.address !== poolAddress) {
      throw new Error("Meteora pool detail response address does not match request");
    }

    return {
      source: url.toString(),
      retrievedAt: new Date().toISOString(),
      requestedAddress: poolAddress,
      payload: root
    };
  }

  private async requestWithRetry(url: string): Promise<Response> {
    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let response: Response | undefined;
      let failure: unknown;
      try {
        response = await this.fetchImpl(url, {
          method: "GET",
          headers: { accept: "application/json" },
          signal: controller.signal
        });
      } catch (error) {
        failure = controller.signal.aborted
          ? new Error(`Meteora request timed out after ${this.timeoutMs}ms`)
          : new Error(`Meteora request failed: ${error instanceof Error ? error.message : "unknown error"}`);
      } finally {
        clearTimeout(timer);
      }

      if (response?.ok) return response;
      const retryableStatus = response !== undefined &&
        (response.status === 429 || response.status >= 500);
      const shouldRetry = attempt < this.maxRetries &&
        (failure !== undefined || retryableStatus);
      if (!shouldRetry) {
        if (failure !== undefined) throw failure;
        if (response) return response;
        throw new Error("Meteora request failed: unknown error");
      }

      const retryAfter = response?.headers.get("retry-after");
      const retryAfterSeconds = retryAfter !== null && retryAfter !== undefined
        ? Number(retryAfter)
        : Number.NaN;
      const retryDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
        ? Math.min(retryAfterSeconds * 1_000, 5_000)
        : Math.min(this.retryBaseDelayMs * (2 ** attempt), 5_000);
      await this.sleepImpl(retryDelay);
    }
  }

}

/**
 * Build a snapshot only when the official pool pair price is available.
 * The pool-list response does not expose active-bin ID, so it is not fabricated.
 */
export function toMarketSnapshot(
  pool: MeteoraPoolSummary,
  capturedAt: string
): MarketSnapshot | undefined {
  if (pool.currentPrice === undefined || !Number.isFinite(pool.currentPrice)) return undefined;
  if (!Number.isFinite(Date.parse(capturedAt))) return undefined;

  return {
    poolAddress: pool.address,
    capturedAt,
    currentPrice: pool.currentPrice,
    ...(pool.volume24hUsd !== undefined ? { volume24hUsd: pool.volume24hUsd } : {}),
    ...(pool.tvlUsd !== undefined ? { tvlUsd: pool.tvlUsd } : {})
  };
}

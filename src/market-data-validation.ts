import type { MarketSnapshot } from "./domain.js";

export interface MarketDataFreshnessOptions {
  now?: string | number | Date;
  maxAgeMs?: number;
}

/**
 * Fail-closed guard for strategy inputs. It validates basic numeric fields and
 * rejects stale/future snapshots; it does not claim that pair price is USD.
 */
export function assertFreshMarketSnapshot(
  snapshot: MarketSnapshot,
  options: MarketDataFreshnessOptions = {}
): void {
  const maxAgeMs = options.maxAgeMs ?? 60_000;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs < 0) {
    throw new Error("maxAgeMs must be a finite non-negative number");
  }

  const capturedAtMs = Date.parse(snapshot.capturedAt);
  if (!Number.isFinite(capturedAtMs)) {
    throw new Error("snapshot capturedAt must be a valid timestamp");
  }

  const nowMs = options.now instanceof Date
    ? options.now.getTime()
    : typeof options.now === "number"
      ? options.now
      : Date.parse(options.now ?? new Date().toISOString());
  if (!Number.isFinite(nowMs)) throw new Error("now must be a valid timestamp");
  if (capturedAtMs > nowMs) throw new Error("snapshot timestamp is in the future");
  if (nowMs - capturedAtMs > maxAgeMs) throw new Error("snapshot is stale");

  if (typeof snapshot.poolAddress !== "string" || !snapshot.poolAddress.trim()) {
    throw new Error("snapshot poolAddress must not be empty");
  }
  if (!Number.isFinite(snapshot.currentPrice) || snapshot.currentPrice <= 0) {
    throw new Error("snapshot currentPrice must be a positive finite number");
  }
  for (const [name, value] of [
    ["volume24hUsd", snapshot.volume24hUsd],
    ["tvlUsd", snapshot.tvlUsd]
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new Error(`snapshot ${name} must be finite and non-negative when provided`);
    }
  }
}

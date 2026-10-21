import type { MarketSnapshot } from "./domain.js";
import { assertFreshMarketSnapshot } from "./market-data-validation.js";

export interface PoolScreenerConfig {
  minTvlUsd: number;
  minVolume24hUsd: number;
  maxCandidates: number;
  maxSnapshotAgeMs?: number;
}

export interface PoolCandidate {
  poolAddress: string;
  capturedAt: string;
  currentPairPrice: number;
  tvlUsd: number;
  volume24hUsd: number;
  volumeToTvlRatio: number;
  rank: number;
}

function assertConfig(config: PoolScreenerConfig): void {
  if (!Number.isFinite(config.minTvlUsd) || config.minTvlUsd < 0) {
    throw new Error("minTvlUsd must be finite and non-negative");
  }
  if (!Number.isFinite(config.minVolume24hUsd) || config.minVolume24hUsd < 0) {
    throw new Error("minVolume24hUsd must be finite and non-negative");
  }
  if (!Number.isInteger(config.maxCandidates) || config.maxCandidates < 1 || config.maxCandidates > 1000) {
    throw new Error("maxCandidates must be an integer between 1 and 1000");
  }
  if (config.maxSnapshotAgeMs !== undefined &&
      (!Number.isFinite(config.maxSnapshotAgeMs) || config.maxSnapshotAgeMs < 0)) {
    throw new Error("maxSnapshotAgeMs must be finite and non-negative");
  }
}

/**
 * Deterministic discovery filter for shadow research, not a buy/sell signal.
 * Candidates lacking USD TVL or 24h volume are excluded rather than imputed.
 * Pair price is passed through as metadata only and is never treated as USD.
 */
export function screenPoolCandidates(
  snapshots: readonly MarketSnapshot[],
  config: PoolScreenerConfig,
  options: { now?: string | number | Date } = {}
): PoolCandidate[] {
  assertConfig(config);
  const eligible: Omit<PoolCandidate, "rank">[] = [];
  const seen = new Set<string>();

  for (const snapshot of snapshots) {
    assertFreshMarketSnapshot(snapshot, {
      ...(options.now !== undefined ? { now: options.now } : {}),
      ...(config.maxSnapshotAgeMs !== undefined ? { maxAgeMs: config.maxSnapshotAgeMs } : {})
    });
    const address = snapshot.poolAddress.trim();
    if (seen.has(address)) continue;

    if (snapshot.tvlUsd === undefined || snapshot.volume24hUsd === undefined) continue;
    if (snapshot.tvlUsd < config.minTvlUsd || snapshot.volume24hUsd < config.minVolume24hUsd) continue;
    if (snapshot.tvlUsd <= 0) continue;

    const volumeToTvlRatio = snapshot.volume24hUsd / snapshot.tvlUsd;
    if (!Number.isFinite(volumeToTvlRatio)) continue;
    seen.add(address);
    eligible.push({
      poolAddress: address,
      capturedAt: snapshot.capturedAt,
      currentPairPrice: snapshot.currentPrice,
      tvlUsd: snapshot.tvlUsd,
      volume24hUsd: snapshot.volume24hUsd,
      volumeToTvlRatio
    });
  }

  eligible.sort((a, b) =>
    b.volumeToTvlRatio - a.volumeToTvlRatio ||
    b.tvlUsd - a.tvlUsd ||
    a.poolAddress.localeCompare(b.poolAddress)
  );

  return eligible.slice(0, config.maxCandidates).map((candidate, index) => ({
    ...candidate,
    rank: index + 1
  }));
}

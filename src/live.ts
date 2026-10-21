import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { MeteoraPoolCollector, toMarketSnapshot } from "./collectors/meteora.js";
import { collectActiveBinSnapshot } from "./collectors/meteora-chain.js";
import { screenPoolCandidates } from "./pool-screener.js";

function parsePositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseNonNegativeNumber(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a finite non-negative number`);
  return parsed;
}

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  const argument = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return argument?.slice(prefix.length);
}

async function main(): Promise<void> {
  const limit = parsePositiveInteger(option("limit"), 20, "limit");
  if (limit > 1000) throw new Error("limit must not exceed 1000");

  const verifyDetails = option("details") === "true";
  const verifyBins = option("bins") === "true";
  const outputPath = resolve(option("output") ?? "data/local/meteora-pools.jsonl");
  const collector = new MeteoraPoolCollector();
  const result = await collector.collectPools(limit);
  if (result.pools.length === 0) {
    throw new Error("Meteora API returned no valid pools; refusing to write an empty snapshot batch");
  }

  let detailCheck: { poolAddress: string; topLevelKeys: string[]; dataKeys?: string[] } | undefined;
  let activeBinCheck: { poolAddress: string; activeBinId: number; binStep: number; binsReturned: number } | undefined;
  if (verifyDetails) {
    const firstPool = result.pools[0];
    if (!firstPool) throw new Error("Meteora returned no pool to verify details");
    const poolAddress = firstPool.address;
    const detail = await collector.collectPoolDetails(poolAddress);
    const payload = detail.payload;
    const data = payload.data;
    const dataRecord = typeof data === "object" && data !== null && !Array.isArray(data)
      ? data as Record<string, unknown>
      : undefined;
    detailCheck = {
      poolAddress,
      topLevelKeys: Object.keys(payload).sort(),
      ...(dataRecord ? { dataKeys: Object.keys(dataRecord).sort() } : {})
    };
    if (Object.keys(payload).length === 0) {
      throw new Error("Meteora pool detail endpoint returned an empty object");
    }
  }

  if (verifyBins) {
    const firstPool = result.pools[0];
    if (!firstPool) throw new Error("Meteora returned no pool to verify active-bin data");
    const binSnapshot = await collectActiveBinSnapshot(firstPool.address, { binsEachSide: 5 });
    activeBinCheck = {
      poolAddress: binSnapshot.poolAddress,
      activeBinId: binSnapshot.activeBinId,
      binStep: binSnapshot.binStep,
      binsReturned: binSnapshot.bins.length
    };
  }

  const capturedAt = result.retrievedAt;
  const snapshots = result.pools
    .map((pool) => toMarketSnapshot(pool, capturedAt))
    .filter((snapshot) => snapshot !== undefined);

  if (snapshots.length === 0) {
    throw new Error("Meteora returned pools but none had a usable current_price; no snapshots written");
  }

  const screening = option("screen") === "true"
    ? screenPoolCandidates(snapshots, {
        minTvlUsd: parseNonNegativeNumber(option("min-tvl-usd"), 100_000, "min-tvl-usd"),
        minVolume24hUsd: parseNonNegativeNumber(option("min-volume-24h-usd"), 25_000, "min-volume-24h-usd"),
        maxCandidates: parsePositiveInteger(option("max-candidates"), 10, "max-candidates"),
        maxSnapshotAgeMs: parseNonNegativeNumber(option("max-snapshot-age-ms"), 60_000, "max-snapshot-age-ms")
      }, { now: result.retrievedAt })
    : undefined;

  if (screening) {
    console.log(JSON.stringify({
      screening: {
        mode: "discovery-only",
        warning: "Candidates are not buy/sell signals; no transactions are executed.",
        criteria: {
          minTvlUsd: parseNonNegativeNumber(option("min-tvl-usd"), 100_000, "min-tvl-usd"),
          minVolume24hUsd: parseNonNegativeNumber(option("min-volume-24h-usd"), 25_000, "min-volume-24h-usd"),
          maxCandidates: parsePositiveInteger(option("max-candidates"), 10, "max-candidates"),
          maxSnapshotAgeMs: parseNonNegativeNumber(option("max-snapshot-age-ms"), 60_000, "max-snapshot-age-ms")
        },
        candidates: screening
      }
    }, null, 2));
  }

  const records = snapshots.map((snapshot) => JSON.stringify({
    schemaVersion: 1,
    source: result.source,
    ...snapshot
  })).join("\n") + "\n";

  await mkdir(dirname(outputPath), { recursive: true });
  await appendFile(outputPath, records, { encoding: "utf8", flag: "a" });

  console.log(JSON.stringify({
    status: "success",
    mode: "read-only",
    source: result.source,
    retrievedAt: result.retrievedAt,
    poolsReturned: result.pools.length,
    snapshotsWritten: snapshots.length,
    ...(detailCheck ? { detailCheck } : {}),
    ...(activeBinCheck ? { activeBinCheck } : {}),
    outputPath
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown live collection error");
  process.exitCode = 1;
});

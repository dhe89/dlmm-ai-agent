import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { MeteoraPoolCollector, toMarketSnapshot } from "./collectors/meteora.js";

function parsePositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
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

  const outputPath = resolve(option("output") ?? "data/local/meteora-pools.jsonl");
  const collector = new MeteoraPoolCollector();
  const result = await collector.collectPools(limit);
  if (result.pools.length === 0) {
    throw new Error("Meteora API returned no valid pools; refusing to write an empty snapshot batch");
  }

  const capturedAt = result.retrievedAt;
  const snapshots = result.pools
    .map((pool) => toMarketSnapshot(pool, capturedAt))
    .filter((snapshot) => snapshot !== undefined);

  if (snapshots.length === 0) {
    throw new Error("Meteora returned pools but none had a usable current_price; no snapshots written");
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
    outputPath
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown live collection error");
  process.exitCode = 1;
});

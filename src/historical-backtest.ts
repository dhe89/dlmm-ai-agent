import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { MarketSnapshot } from "./domain.js";
import { runShadowBacktest } from "./shadow-backtest.js";

export function parseHistoricalSnapshots(text: string): MarketSnapshot[] {
  const snapshots: MarketSnapshot[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (line.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      throw new Error(`invalid JSON on line ${index + 1}`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`snapshot record on line ${index + 1} must be an object`);
    }
    const record = parsed as Record<string, unknown>;
    const snapshot = record.snapshot !== undefined ? record.snapshot : record;
    if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) {
      throw new Error(`snapshot payload on line ${index + 1} must be an object`);
    }
    const candidate = snapshot as Record<string, unknown>;
    if (typeof candidate.poolAddress !== "string" || candidate.poolAddress.trim().length === 0) {
      throw new Error(`poolAddress missing on line ${index + 1}`);
    }
    if (typeof candidate.capturedAt !== "string" || !Number.isFinite(Date.parse(candidate.capturedAt))) {
      throw new Error(`capturedAt invalid on line ${index + 1}`);
    }
    if (typeof candidate.currentPrice !== "number" || !Number.isFinite(candidate.currentPrice) || candidate.currentPrice <= 0) {
      throw new Error(`currentPrice must be positive and finite on line ${index + 1}`);
    }
    for (const key of ["tvlUsd", "volume24hUsd"] as const) {
      const value = candidate[key];
      if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
        throw new Error(`${key} must be finite and non-negative on line ${index + 1}`);
      }
    }
    snapshots.push({
      poolAddress: candidate.poolAddress,
      capturedAt: candidate.capturedAt,
      currentPrice: candidate.currentPrice,
      ...(typeof candidate.tvlUsd === "number" ? { tvlUsd: candidate.tvlUsd } : {}),
      ...(typeof candidate.volume24hUsd === "number" ? { volume24hUsd: candidate.volume24hUsd } : {})
    });
  }
  if (snapshots.length === 0) throw new Error("input contains no snapshot records");
  return snapshots;
}

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((item) => item.startsWith(prefix))?.slice(prefix.length);
}

function numberOption(name: string, fallback: number): number {
  const raw = option(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a finite number`);
  return value;
}

async function main(): Promise<void> {
  const input = option("input");
  if (!input) throw new Error("required option: --input=path/to/snapshots.jsonl");
  const snapshots = parseHistoricalSnapshots(await readFile(resolve(input), "utf8"));
  const fastWindow = numberOption("fast-window", 5);
  const slowWindow = numberOption("slow-window", 20);
  const costBps = numberOption("cost-bps", 30);
  const initialCapitalUsd = numberOption("capital-usd", 1_000);
  const result = runShadowBacktest(snapshots, { fastWindow, slowWindow, costBps, initialCapitalUsd });
  console.log(JSON.stringify({
    reportType: "historical-shadow-backtest",
    input: resolve(input),
    firstCapturedAt: snapshots.reduce((a, b) => Date.parse(a.capturedAt) < Date.parse(b.capturedAt) ? a : b).capturedAt,
    lastCapturedAt: snapshots.reduce((a, b) => Date.parse(a.capturedAt) > Date.parse(b.capturedAt) ? a : b).capturedAt,
    config: { fastWindow, slowWindow, costBps, initialCapitalUsd },
    result
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Unknown historical backtest error");
    process.exitCode = 1;
  });
}

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { MeteoraPoolCollector } from "./collectors/meteora.js";
import type { MarketSnapshot } from "./domain.js";
import { parseHistoricalSnapshots } from "./historical-backtest.js";

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((item) => item.startsWith(prefix))?.slice(prefix.length);
}
function positiveInt(name: string, fallback: number): number {
  const raw = option(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`--${name} must be a positive integer`);
  return value;
}
function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
export function calculatePaperStrategySignal(snapshots: readonly MarketSnapshot[], fastWindow: number, slowWindow: number): {
  signal: "LONG" | "CASH" | "WARMING_UP";
  fastAverage: number | null;
  slowAverage: number | null;
  observations: number;
} {
  if (fastWindow >= slowWindow) throw new Error("--fast-window must be smaller than --slow-window");
  if (snapshots.length < slowWindow) return { signal: "WARMING_UP", fastAverage: null, slowAverage: null, observations: snapshots.length };
  const ordered = [...snapshots].sort((a,b)=>Date.parse(a.capturedAt)-Date.parse(b.capturedAt));
  const prices = ordered.map(x=>x.currentPrice);
  if (prices.some(x=>!Number.isFinite(x)||x<=0)) throw new Error("history contains invalid pair prices");
  const fastAverage = average(prices.slice(-fastWindow));
  const slowAverage = average(prices.slice(-slowWindow));
  return { signal: fastAverage > slowAverage ? "LONG" : "CASH", fastAverage, slowAverage, observations: prices.length };
}

async function main(): Promise<void> {
  const poolAddress = option("pool");
  if (!poolAddress?.trim()) throw new Error("required option: --pool=POOL_ADDRESS");
  const fastWindow = positiveInt("fast-window", 5);
  const slowWindow = positiveInt("slow-window", 20);
  if (fastWindow >= slowWindow) throw new Error("--fast-window must be smaller than --slow-window");
  const intervalSeconds = positiveInt("interval-seconds", 60);
  const iterations = positiveInt("iterations", 1);
  const historyPath = resolve(option("history") ?? "data/local/strategy-snapshots.jsonl");
  const signalPath = resolve(option("signals") ?? "data/local/strategy-signals.jsonl");
  const collector = new MeteoraPoolCollector();
  for (let i = 0; i < iterations; i += 1) {
    const result = await collector.collectPools(1000);
    const pool = result.pools.find((candidate) => candidate.address === poolAddress);
    if (!pool || pool.currentPrice === undefined || !Number.isFinite(pool.currentPrice) || pool.currentPrice <= 0) {
      throw new Error("requested pool is missing from the current Meteora response or has no valid pair price");
    }
    const snapshot: MarketSnapshot = {
      poolAddress,
      capturedAt: result.retrievedAt,
      currentPrice: pool.currentPrice,
      ...(pool.tvlUsd !== undefined ? { tvlUsd: pool.tvlUsd } : {}),
      ...(pool.volume24hUsd !== undefined ? { volume24hUsd: pool.volume24hUsd } : {})
    };
    await mkdir(dirname(historyPath), { recursive: true });
    await appendFile(historyPath, JSON.stringify(snapshot) + "\n", "utf8");
    let history: MarketSnapshot[] = [snapshot];
    try {
      history = parseHistoricalSnapshots(await readFile(historyPath, "utf8"))
        .filter((item) => item.poolAddress === poolAddress);
    } catch (error) {
      if (!(error instanceof Error && error.message.includes("no snapshot records"))) throw error;
    }
    const resultSignal = calculatePaperStrategySignal(history, fastWindow, slowWindow);
    const report = {
      reportType: "read-only-paper-strategy-signal",
      mode: "signal-only-no-execution",
      source: result.source,
      poolAddress,
      capturedAt: snapshot.capturedAt,
      config: { fastWindow, slowWindow, intervalSeconds },
      ...resultSignal,
      warning: "Pair-price SMA crossover proxy only; LONG/CASH is a research signal, not an LP valuation or instruction to execute a transaction."
    };
    await mkdir(dirname(signalPath), { recursive: true });
    await appendFile(signalPath, JSON.stringify(report) + "\n", "utf8");
    console.log(JSON.stringify(report));
    if (i + 1 < iterations) await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
  }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Unknown strategy runner error");
    process.exitCode = 1;
  });
}

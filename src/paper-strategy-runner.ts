import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { MeteoraPoolCollector } from "./collectors/meteora.js";
import type { MarketSnapshot } from "./domain.js";
import { parseHistoricalSnapshots } from "./historical-backtest.js";
import { buildPaperSignalJournalEntry, type PaperSignal } from "./strategy-signal-journal.js";

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

export interface PaperStrategyRunnerStatus {
  state: "running" | "healthy" | "retrying" | "stopped";
  poolAddress: string;
  checkedAt: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  nextRetryAt: string | null;
}

export async function persistPaperStrategyRunnerStatus(path: string, status: PaperStrategyRunnerStatus): Promise<void> {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(status, null, 2) + "\n", { encoding: "utf8", flag: "w" });
    await rename(temporary, target);
  } catch (error) {
    const { rm } = await import("node:fs/promises");
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function calculatePaperStrategySignal(snapshots: readonly MarketSnapshot[], fastWindow: number, slowWindow: number): {
  signal: "LONG" | "CASH" | "WARMING_UP";
  fastAverage: number | null;
  slowAverage: number | null;
  observations: number;
} {
  if (!Number.isInteger(fastWindow) || fastWindow < 1) throw new Error("--fast-window must be a positive integer");
  if (!Number.isInteger(slowWindow) || slowWindow < 2) throw new Error("--slow-window must be an integer greater than one");
  if (fastWindow >= slowWindow) throw new Error("--fast-window must be smaller than --slow-window");

  // Validate every supplied observation before the warm-up shortcut. Invalid
  // data must never be silently accepted just because the window is incomplete.
  const ordered = [...snapshots].sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  let previousTime = Number.NEGATIVE_INFINITY;
  let poolAddress: string | undefined;
  for (const snapshot of ordered) {
    if (!snapshot.poolAddress.trim()) throw new Error("history contains an empty pool address");
    if (poolAddress !== undefined && snapshot.poolAddress !== poolAddress) {
      throw new Error("history must contain snapshots for exactly one pool");
    }
    poolAddress = snapshot.poolAddress;
    const timestamp = Date.parse(snapshot.capturedAt);
    if (!Number.isFinite(timestamp)) throw new Error("history contains invalid timestamps");
    if (timestamp <= previousTime) throw new Error("history timestamps must be unique");
    previousTime = timestamp;
    if (!Number.isFinite(snapshot.currentPrice) || snapshot.currentPrice <= 0) {
      throw new Error("history contains invalid pair prices");
    }
  }

  if (ordered.length < slowWindow) {
    return { signal: "WARMING_UP", fastAverage: null, slowAverage: null, observations: ordered.length };
  }
  const prices = ordered.map((snapshot) => snapshot.currentPrice);
  const fastAverage = average(prices.slice(-fastWindow));
  const slowAverage = average(prices.slice(-slowWindow));
  return { signal: fastAverage > slowAverage ? "LONG" : "CASH", fastAverage, slowAverage, observations: prices.length };
}

export function validateStrategyHistoryCandidate(
  history: readonly MarketSnapshot[],
  snapshot: MarketSnapshot,
  fastWindow: number,
  slowWindow: number
): { history: MarketSnapshot[]; decision: ReturnType<typeof calculatePaperStrategySignal> } {
  const candidateHistory = [...history, snapshot];
  const decision = calculatePaperStrategySignal(candidateHistory, fastWindow, slowWindow);
  return { history: candidateHistory, decision };
}

/** Makes a retry idempotent only when the same timestamp has identical snapshot data. */
export function resolveStrategyHistoryCandidate(
  history: readonly MarketSnapshot[],
  snapshot: MarketSnapshot,
  fastWindow: number,
  slowWindow: number
): { history: MarketSnapshot[]; decision: ReturnType<typeof calculatePaperStrategySignal>; alreadyPersisted: boolean } {
  const existing = history.find((item) => item.capturedAt === snapshot.capturedAt);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(snapshot)) {
      throw new Error("snapshot timestamp already exists with different data");
    }
    return {
      history: [...history],
      decision: calculatePaperStrategySignal(history, fastWindow, slowWindow),
      alreadyPersisted: true
    };
  }
  const candidate = validateStrategyHistoryCandidate(history, snapshot, fastWindow, slowWindow);
  return { ...candidate, alreadyPersisted: false };
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
  const statusPath = resolve(option("status") ?? "data/local/strategy-runner-status.json");
  let lastSuccessAt: string | null = null;
  let lastError: string | null = null;
  const collector = new MeteoraPoolCollector();

  const forever = process.argv.slice(2).includes("--forever");
  // Preserve the last known successful observation across process restarts.
  try {
    const previousStatus = JSON.parse(await readFile(statusPath, "utf8")) as { lastSuccessAt?: unknown; lastError?: unknown };
    if (typeof previousStatus.lastSuccessAt === "string" && Number.isFinite(Date.parse(previousStatus.lastSuccessAt))) {
      lastSuccessAt = previousStatus.lastSuccessAt;
    }
    if (typeof previousStatus.lastError === "string") lastError = previousStatus.lastError;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      console.error(JSON.stringify({ event: "paper_strategy_status_restore_failed", error: error instanceof Error ? error.message : "Unknown status restore error" }));
    }
  }
  await persistPaperStrategyRunnerStatus(statusPath, { state: "running", poolAddress, checkedAt: new Date().toISOString(), lastSuccessAt, lastError, nextRetryAt: null });
  for (let i = 0; forever || i < iterations; i += 1) {
    try {
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
    // Validate the candidate together with existing history before persisting it.
    // A duplicate API timestamp or corrupted history must not poison the JSONL file.
    let history: MarketSnapshot[] = [];
    try {
      history = parseHistoricalSnapshots(await readFile(historyPath, "utf8"))
        .filter((item) => item.poolAddress === poolAddress);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    // A retry may reuse an identical persisted observation, but never overwrite
    // a timestamp collision whose data differs.
    const candidate = resolveStrategyHistoryCandidate(history, snapshot, fastWindow, slowWindow);
    if (!candidate.alreadyPersisted) {
      await mkdir(dirname(historyPath), { recursive: true });
      await appendFile(historyPath, JSON.stringify(snapshot) + "\n", "utf8");
    }
    const resultSignal = candidate.decision;
    let previousSignal: PaperSignal | null = null;
    let signalAlreadyRecorded = false;
    try {
      const priorLines = (await readFile(signalPath, "utf8")).split("\n").filter(Boolean);
      for (let lineIndex = priorLines.length - 1; lineIndex >= 0; lineIndex -= 1) {
        try {
          const prior = JSON.parse(priorLines[lineIndex]!) as { poolAddress?: unknown; capturedAt?: unknown; signal?: unknown };
          if (prior.poolAddress !== poolAddress) continue;
          if (prior.capturedAt === snapshot.capturedAt) signalAlreadyRecorded = true;
          if (previousSignal === null && (prior.signal === "LONG" || prior.signal === "CASH" || prior.signal === "WARMING_UP")) {
            previousSignal = prior.signal;
          }
        } catch { /* Ignore malformed historical journal lines; new record remains explicit. */ }
      }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    const transition = buildPaperSignalJournalEntry({ poolAddress, capturedAt: snapshot.capturedAt, fastWindow, slowWindow, decision: resultSignal, previousSignal });
    const report = {
      reportType: "read-only-paper-strategy-signal",
      mode: "signal-only-no-execution",
      source: result.source,
      poolAddress,
      capturedAt: snapshot.capturedAt,
      config: { fastWindow, slowWindow, intervalSeconds },
      ...resultSignal,
      previousSignal: transition.previousSignal,
      signalChanged: transition.changed,
      transition: transition.transition,
      warning: "Pair-price SMA crossover proxy only; LONG/CASH is a research signal, not an LP valuation or instruction to execute a transaction."
    };
    if (!signalAlreadyRecorded) {
      await mkdir(dirname(signalPath), { recursive: true });
      await appendFile(signalPath, JSON.stringify(report) + "\n", "utf8");
    }
    console.log(JSON.stringify({ ...report, signalAlreadyRecorded }));
    lastSuccessAt = snapshot.capturedAt;
    lastError = null;
    await persistPaperStrategyRunnerStatus(statusPath, { state: "healthy", poolAddress, checkedAt: new Date().toISOString(), lastSuccessAt, lastError, nextRetryAt: null });
    if (forever || i + 1 < iterations) await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown strategy runner error";
      lastError = errorMessage;
      const nextRetryAt = forever ? new Date(Date.now() + intervalSeconds * 1000).toISOString() : null;
      await persistPaperStrategyRunnerStatus(statusPath, { state: forever ? "retrying" : "stopped", poolAddress, checkedAt: new Date().toISOString(), lastSuccessAt, lastError: errorMessage, nextRetryAt });
      console.error(JSON.stringify({
        event: "paper_strategy_iteration_failed",
        iteration: i + 1,
        retrying: forever,
        error: errorMessage,
        at: new Date().toISOString()
      }));
      if (!forever) throw error;
      await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Unknown strategy runner error");
    process.exitCode = 1;
  });
}

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export interface PaperStrategyRunnerStatus {
  state: "running" | "healthy" | "retrying" | "stopped";
  poolAddress: string;
  checkedAt: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  nextRetryAt: string | null;
}

export type PaperStrategyRunnerHealth = {
  status: "not-configured" | "ok" | "stale" | "retrying" | "stopped" | "unhealthy";
  ageMs: number | null;
  staleAfterMs: number;
  runner: PaperStrategyRunnerStatus | null;
  error?: string;
};

/** Read-only monitor for the runner's atomically persisted status file. */
export async function getPaperStrategyRunnerHealth(
  path: string,
  nowMs = Date.now(),
  staleAfterMs = 5 * 60 * 1_000
): Promise<PaperStrategyRunnerHealth> {
  if (!Number.isFinite(nowMs)) throw new Error("nowMs must be finite");
  if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) throw new Error("staleAfterMs must be positive");
  const target = resolve(path);
  let raw: string;
  try {
    raw = await readFile(target, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "not-configured", ageMs: null, staleAfterMs, runner: null };
    }
    return {
      status: "unhealthy",
      ageMs: null,
      staleAfterMs,
      runner: null,
      error: error instanceof Error ? error.message : "runner status file could not be read"
    };
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: "unhealthy", ageMs: null, staleAfterMs, runner: null, error: "runner status file is not valid JSON" };
  }

  if (!isRunnerStatus(value)) {
    return { status: "unhealthy", ageMs: null, staleAfterMs, runner: null, error: "runner status file has an invalid shape" };
  }

  const ageMs = nowMs - Date.parse(value.checkedAt);
  if (ageMs < 0) {
    return { status: "unhealthy", ageMs, staleAfterMs, runner: value, error: "runner checkedAt is in the future" };
  }
  if (value.state === "stopped") return { status: "stopped", ageMs, staleAfterMs, runner: value };
  if (value.state === "retrying") return { status: "retrying", ageMs, staleAfterMs, runner: value };
  if (ageMs > staleAfterMs) return { status: "stale", ageMs, staleAfterMs, runner: value };
  return { status: "ok", ageMs, staleAfterMs, runner: value };
}

function isRunnerStatus(value: unknown): value is PaperStrategyRunnerStatus {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const status = value as Record<string, unknown>;
  const validTime = (input: unknown) => typeof input === "string" && input.trim().length > 0 && Number.isFinite(Date.parse(input));
  return (status.state === "running" || status.state === "healthy" || status.state === "retrying" || status.state === "stopped")
    && typeof status.poolAddress === "string" && status.poolAddress.trim().length > 0
    && validTime(status.checkedAt)
    && (status.lastSuccessAt === null || validTime(status.lastSuccessAt))
    && (status.lastError === null || typeof status.lastError === "string")
    && (status.nextRetryAt === null || validTime(status.nextRetryAt));
}

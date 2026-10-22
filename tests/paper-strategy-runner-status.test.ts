import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { persistPaperStrategyRunnerStatus, type PaperStrategyRunnerStatus } from "../src/paper-strategy-runner.js";

let directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
  directories = [];
});

describe("paper strategy runner status persistence", () => {
  it("atomically persists the latest runner state for monitoring", async () => {
    const directory = await mkdtemp(join(tmpdir(), "paper-runner-status-"));
    directories.push(directory);
    const path = join(directory, "nested", "status.json");
    const status: PaperStrategyRunnerStatus = {
      state: "healthy",
      poolAddress: "pool-A",
      checkedAt: "2026-10-22T10:00:00.000Z",
      lastSuccessAt: "2026-10-22T09:59:00.000Z",
      lastError: null,
      nextRetryAt: null
    };
    await persistPaperStrategyRunnerStatus(path, status);
    await expect(readFile(path, "utf8").then(JSON.parse)).resolves.toEqual(status);
  });

  it("replaces a previous status instead of leaving partial JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "paper-runner-status-"));
    directories.push(directory);
    const path = join(directory, "status.json");
    const base: PaperStrategyRunnerStatus = {
      state: "healthy", poolAddress: "pool-A", checkedAt: "2026-10-22T10:00:00.000Z",
      lastSuccessAt: "2026-10-22T10:00:00.000Z", lastError: null, nextRetryAt: null
    };
    await persistPaperStrategyRunnerStatus(path, base);
    const failed = { ...base, state: "retrying" as const, lastError: "temporary API error", nextRetryAt: "2026-10-22T10:01:00.000Z" };
    await persistPaperStrategyRunnerStatus(path, failed);
    await expect(readFile(path, "utf8").then(JSON.parse)).resolves.toEqual(failed);
  });
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getPaperStrategyRunnerHealth } from "../src/paper-runner-health.js";

let directories: string[] = [];
async function statusPath() {
  const directory = await mkdtemp(join(tmpdir(), "paper-runner-health-"));
  directories.push(directory);
  return join(directory, "status.json");
}
afterEach(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
  directories = [];
});

const status = {
  state: "healthy" as const,
  poolAddress: "pool-A",
  checkedAt: "2026-10-22T12:00:00.000Z",
  lastSuccessAt: "2026-10-22T12:00:00.000Z",
  lastError: null,
  nextRetryAt: null
};

describe("paper strategy runner health", () => {
  it("treats a missing status file as not configured", async () => {
    const path = await statusPath();
    await expect(getPaperStrategyRunnerHealth(path, Date.parse(status.checkedAt))).resolves.toMatchObject({
      status: "not-configured",
      runner: null,
      ageMs: null
    });
  });

  it("reports fresh status as ok and old status as stale", async () => {
    const path = await statusPath();
    await writeFile(path, JSON.stringify(status), "utf8");
    await expect(getPaperStrategyRunnerHealth(path, Date.parse(status.checkedAt) + 60_000)).resolves.toMatchObject({
      status: "ok",
      ageMs: 60_000,
      runner: status
    });
    await expect(getPaperStrategyRunnerHealth(path, Date.parse(status.checkedAt) + 301_000)).resolves.toMatchObject({
      status: "stale",
      ageMs: 301_000
    });
  });

  it("surfaces retrying and stopped states before freshness classification", async () => {
    const path = await statusPath();
    await writeFile(path, JSON.stringify({ ...status, state: "retrying", lastError: "network error" }), "utf8");
    await expect(getPaperStrategyRunnerHealth(path, Date.parse(status.checkedAt) + 999_000)).resolves.toMatchObject({ status: "retrying" });
    await writeFile(path, JSON.stringify({ ...status, state: "stopped" }), "utf8");
    await expect(getPaperStrategyRunnerHealth(path, Date.parse(status.checkedAt) + 999_000)).resolves.toMatchObject({ status: "stopped" });
  });

  it("fails closed on invalid JSON, invalid shapes, and future timestamps", async () => {
    const path = await statusPath();
    await writeFile(path, "{broken", "utf8");
    await expect(getPaperStrategyRunnerHealth(path)).resolves.toMatchObject({ status: "unhealthy", error: "runner status file is not valid JSON" });
    await writeFile(path, JSON.stringify({ ...status, poolAddress: "" }), "utf8");
    await expect(getPaperStrategyRunnerHealth(path)).resolves.toMatchObject({ status: "unhealthy", error: "runner status file has an invalid shape" });
    await writeFile(path, JSON.stringify({ ...status, checkedAt: "2099-01-01T00:00:00.000Z" }), "utf8");
    await expect(getPaperStrategyRunnerHealth(path, Date.parse("2026-10-22T12:00:00.000Z"))).resolves.toMatchObject({
      status: "unhealthy",
      error: "runner checkedAt is in the future"
    });
  });
});

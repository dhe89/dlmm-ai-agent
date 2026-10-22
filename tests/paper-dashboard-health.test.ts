import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getPaperDashboardHealth } from "../src/paper-dashboard.js";
import { PaperLedgerStore } from "../src/paper-ledger-store.js";

let directories: string[] = [];
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "paper-dashboard-health-"));
  directories.push(directory);
  return { directory, store: new PaperLedgerStore(join(directory, "ledger.json")) };
}
afterEach(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
  directories = [];
});

describe("paper dashboard health probe", () => {
  it("reports healthy when a new instance has no ledger yet", async () => {
    const { store } = await fixture();
    await expect(getPaperDashboardHealth(store)).resolves.toEqual({
      statusCode: 200,
      payload: { status: "ok", mode: "paper-only", persistence: "ok" }
    });
  });

  it("reports healthy when the persisted ledger can be restored", async () => {
    const { store } = await fixture();
    await store.save(new (await import("../src/paper-ledger.js")).PaperLedger(100));
    const health = await getPaperDashboardHealth(store);
    expect(health.statusCode).toBe(200);
    expect(health.payload.persistence).toBe("ok");
  });

  it("reports 503 when the ledger JSON is corrupt", async () => {
    const { directory, store } = await fixture();
    await writeFile(join(directory, "ledger.json"), "{broken", "utf8");
    const health = await getPaperDashboardHealth(store);
    expect(health.statusCode).toBe(503);
    expect(health.payload).toMatchObject({ status: "unhealthy", mode: "paper-only", persistence: "error" });
    expect(health.payload.error).toMatch(/not valid JSON/);
  });

  it("reports 503 when the state path cannot be read as a file", async () => {
    const { directory } = await fixture();
    const store = new PaperLedgerStore(directory);
    const health = await getPaperDashboardHealth(store);
    expect(health.statusCode).toBe(503);
    expect(health.payload.status).toBe("unhealthy");
  });
});

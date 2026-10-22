import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PaperLedgerStore } from "../src/paper-ledger-store.js";
import { PaperPortfolioService } from "../src/paper-portfolio-service.js";

let directories: string[] = [];
async function serviceFixture() {
  const directory = await mkdtemp(join(tmpdir(), "paper-portfolio-service-"));
  directories.push(directory);
  const store = new PaperLedgerStore(join(directory, "portfolio.json"));
  return { store, service: new PaperPortfolioService(store, 1_000) };
}
afterEach(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
  directories = [];
});

describe("PaperPortfolioService integration", () => {
  it("opens, marks, closes, and restores the same balances and event history", async () => {
    const { store, service } = await serviceFixture();
    expect((await service.report()).summary).toMatchObject({ cashUsd: 1_000, equityUsd: 1_000, totalPnlUsd: 0 });
    await service.open({ id: "pos-1", pool: "pool-A", capital: 250, entryPrice: 1.25, at: "2026-10-22T10:00:00.000Z" });
    expect((await service.report()).summary).toMatchObject({ cashUsd: 750, equityUsd: 1_000, openPositions: 1 });
    await service.mark({ id: "pos-1", value: 275, at: "2026-10-22T11:00:00.000Z" });
    expect((await service.report()).summary).toMatchObject({ cashUsd: 750, equityUsd: 1_025, unrealizedPnlUsd: 25, totalPnlUsd: 25, returnPct: 2.5 });
    await service.close({ id: "pos-1", value: 270, at: "2026-10-22T12:00:00.000Z" });

    const restarted = new PaperPortfolioService(store, 1_000);
    expect((await restarted.report()).summary).toMatchObject({
      cashUsd: 1_020, equityUsd: 1_020, realizedPnlUsd: 20, unrealizedPnlUsd: 0,
      totalPnlUsd: 20, openPositions: 0, returnPct: 2
    });
    const history = await restarted.history();
    expect(history.positions[0]?.status).toBe("closed");
    expect(history.events.map((event) => event.type)).toEqual(["position_opened", "position_marked", "position_closed"]);
  });

  it("does not save state when a position operation fails validation", async () => {
    const { store, service } = await serviceFixture();
    await expect(service.open({ id: "overspend", pool: "pool-A", capital: 1_500, entryPrice: 1, at: "2026-10-22T10:00:00.000Z" })).rejects.toThrow(/insufficient paper cash/);
    await expect(store.load()).resolves.toBeUndefined();
  });
});

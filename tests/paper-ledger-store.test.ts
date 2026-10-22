import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PaperLedger } from "../src/paper-ledger.js";
import { PaperLedgerStore } from "../src/paper-ledger-store.js";

const openedAt = "2026-10-21T10:00:00.000Z";
let temporaryDirectories: string[] = [];

async function createStore(): Promise<PaperLedgerStore> {
  const directory = await mkdtemp(join(tmpdir(), "dlmm-ledger-"));
  temporaryDirectories.push(directory);
  return new PaperLedgerStore(join(directory, "ledger.json"));
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
  temporaryDirectories = [];
});

describe("PaperLedgerStore", () => {
  it("returns undefined when no saved ledger exists", async () => {
    const store = await createStore();
    await expect(store.load()).resolves.toBeUndefined();
  });

  it("restores positions, event history, cash, and PnL after restart", async () => {
    const store = await createStore();
    const ledger = new PaperLedger(1_000);
    ledger.openPosition({
      id: "pos-1",
      poolAddress: "pool-A",
      openedAt,
      initialCapitalUsd: 250,
      entryPoolPrice: 1.25
    });
    ledger.markPosition("pos-1", "2026-10-21T11:00:00.000Z", 275);
    await store.save(ledger);

    const restored = await store.load();
    expect(restored).toBeDefined();
    expect(restored?.summary()).toEqual(ledger.summary());
    expect(restored?.getPositions()).toEqual(ledger.getPositions());
    expect(restored?.getEvents()).toEqual(ledger.getEvents());

    restored?.closePosition("pos-1", "2026-10-21T12:00:00.000Z", 270);
    expect(restored?.summary().cashUsd).toBe(1_020);
  });

  it("saves closed positions and does not realize their PnL twice on restore", async () => {
    const store = await createStore();
    const ledger = new PaperLedger(500);
    ledger.openPosition({
      id: "pos-1",
      poolAddress: "pool-A",
      openedAt,
      initialCapitalUsd: 200,
      entryPoolPrice: 2
    });
    ledger.closePosition("pos-1", "2026-10-21T11:00:00.000Z", 210);
    await store.save(ledger);

    const restored = await store.load();
    expect(restored?.summary()).toMatchObject({
      cashUsd: 510,
      realizedPnlUsd: 10,
      totalPnlUsd: 10,
      openPositions: 0,
      closedPositions: 1
    });
    expect(restored?.getEvents().filter((event) => event.type === "position_closed")).toHaveLength(1);
  });

  it("rejects a valid-looking snapshot whose positions disagree with the event journal", async () => {
    const store = await createStore();
    const ledger = new PaperLedger(500);
    ledger.openPosition({ id: "pos-1", poolAddress: "pool-A", openedAt, initialCapitalUsd: 200, entryPoolPrice: 2 });
    await store.save(ledger);
    const raw = JSON.parse(await readFile(store.filePath, "utf8")) as { positions: Array<{ currentValueUsd: number }> };
    raw.positions[0]!.currentValueUsd = 275;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(store.filePath, JSON.stringify(raw), "utf8");
    await expect(store.load()).rejects.toThrow(/do not match event journal/);
  });

  it("rejects corrupt JSON and snapshots that violate accounting invariants", async () => {
    const store = await createStore();
    await store.save(new PaperLedger(100));
    const raw = await readFile(store.filePath, "utf8");
    await expect(store.load()).resolves.toBeDefined();

    const corrupted = JSON.parse(raw) as Record<string, unknown>;
    corrupted.cashBalanceUsd = 999;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(store.filePath, JSON.stringify(corrupted), "utf8");
    await expect(store.load()).rejects.toThrow(/cash accounting invariants/);

    await writeFile(store.filePath, "{not-json", "utf8");
    await expect(store.load()).rejects.toThrow(/not valid JSON/);
  });
});

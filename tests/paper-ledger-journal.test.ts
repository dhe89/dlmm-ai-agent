import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PaperLedger } from "../src/paper-ledger.js";
import { PaperLedgerEventJournal } from "../src/paper-ledger-journal.js";

let temporaryDirectories: string[] = [];

async function createJournal(): Promise<PaperLedgerEventJournal> {
  const directory = await mkdtemp(join(tmpdir(), "dlmm-journal-"));
  temporaryDirectories.push(directory);
  return new PaperLedgerEventJournal(join(directory, "events.jsonl"));
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
  temporaryDirectories = [];
});

describe("PaperLedgerEventJournal", () => {
  it("returns an empty history when the journal does not exist", async () => {
    const journal = await createJournal();
    await expect(journal.readAll()).resolves.toEqual([]);
  });

  it("appends event batches as JSONL and preserves append order", async () => {
    const journal = await createJournal();
    const ledger = new PaperLedger(1_000);
    ledger.openPosition({
      id: "pos-1",
      poolAddress: "pool-A",
      openedAt: "2026-10-21T10:00:00.000Z",
      initialCapitalUsd: 250,
      entryPoolPrice: 1.25
    });
    ledger.markPosition("pos-1", "2026-10-21T11:00:00.000Z", 275);

    await journal.append(ledger.getEvents().slice(0, 1));
    await journal.append(ledger.getEvents().slice(1));
    await expect(journal.readAll()).resolves.toEqual(ledger.getEvents());

    const raw = await readFile(journal.filePath, "utf8");
    expect(raw.trimEnd().split("\n")).toHaveLength(2);
  });

  it("fails closed on malformed records and incomplete final writes", async () => {
    const journal = await createJournal();
    await writeFile(journal.filePath, '{"type":"unknown"}\n', "utf8");
    await expect(journal.readAll()).rejects.toThrow(/Invalid paper ledger journal record at line 1/);

    await writeFile(journal.filePath, '{"type":"position_opened"', "utf8");
    await expect(journal.readAll()).rejects.toThrow(/incomplete final record/);
  });

  it("rejects invalid events before writing them", async () => {
    const journal = await createJournal();
    await expect(journal.append([{
      type: "position_marked",
      at: "2026-10-21T11:00:00.000Z",
      positionId: "pos-1",
      previousValueUsd: 250,
      currentValueUsd: Number.NaN
    }])).rejects.toThrow(/currentValueUsd must be a finite non-negative number/);
    await expect(journal.readAll()).resolves.toEqual([]);
  });
});

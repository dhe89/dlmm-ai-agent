import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PaperLedger } from "../src/paper-ledger.js";
import { PaperLedgerStore } from "../src/paper-ledger-store.js";
import { copyPaperLedgerBackup } from "../src/paper-ledger-backup.js";

let directories: string[] = [];
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "paper-ledger-backup-"));
  directories.push(directory);
  return { directory, source: join(directory, "source.json"), backup: join(directory, "backup", "ledger.json"), restored: join(directory, "restored", "ledger.json") };
}
afterEach(async () => {
  await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
  directories = [];
});

describe("paper ledger backup", () => {
  it("copies only validated ledger state and restores equivalent accounting", async () => {
    const paths = await fixture();
    const ledger = new PaperLedger(1_000);
    ledger.openPosition({ id: "backup-pos", poolAddress: "pool-A", openedAt: "2026-10-22T10:00:00.000Z", initialCapitalUsd: 250, entryPoolPrice: 1.25 });
    ledger.markPosition("backup-pos", "2026-10-22T10:01:00.000Z", 275);
    await new PaperLedgerStore(paths.source).save(ledger);

    await copyPaperLedgerBackup(paths.source, paths.backup);
    await copyPaperLedgerBackup(paths.backup, paths.restored);

    const restored = await new PaperLedgerStore(paths.restored).load();
    expect(restored?.summary()).toEqual(ledger.summary());
    expect(restored?.getPositions()).toEqual(ledger.getPositions());
    expect(restored?.getEvents()).toEqual(ledger.getEvents());
  });

  it("refuses missing, corrupt, and same-path backups without modifying source", async () => {
    const paths = await fixture();
    await expect(copyPaperLedgerBackup(paths.source, paths.backup)).rejects.toThrow(/does not exist/);
    await writeFile(paths.source, "{broken", "utf8");
    await expect(copyPaperLedgerBackup(paths.source, paths.backup)).rejects.toThrow(/not valid JSON/);
    await expect(copyPaperLedgerBackup(paths.source, paths.source)).rejects.toThrow(/different paths/);
    await expect(readFile(paths.source, "utf8")).resolves.toBe("{broken");
  });
});

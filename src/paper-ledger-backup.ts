import { resolve } from "node:path";
import { PaperLedgerStore } from "./paper-ledger-store.js";

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((item) => item.startsWith(prefix))?.slice(prefix.length);
}

/** Copy a validated paper-ledger snapshot to or from a backup file. */
export async function copyPaperLedgerBackup(sourcePath: string, destinationPath: string): Promise<void> {
  const source = new PaperLedgerStore(sourcePath);
  const destination = new PaperLedgerStore(destinationPath);
  if (source.filePath === destination.filePath) {
    throw new Error("source and destination must be different paths");
  }
  const ledger = await source.load();
  if (!ledger) throw new Error(`source paper ledger does not exist: ${source.filePath}`);
  // load() validates JSON, schema, accounting invariants, and event-journal consistency
  // before the destination is replaced through the store's atomic snapshot writer.
  await destination.save(ledger);
}

async function main(): Promise<void> {
  const source = option("source");
  const destination = option("destination");
  if (!source || !destination) {
    throw new Error("Usage: npm run paper:backup -- --source=PATH --destination=PATH");
  }
  await copyPaperLedgerBackup(resolve(source), resolve(destination));
  console.log(JSON.stringify({ status: "ok", source: resolve(source), destination: resolve(destination), mode: "paper-only" }));
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1].replace(/\\/g, "/")) {
  main().catch((error) => {
    console.error(JSON.stringify({ status: "error", message: error instanceof Error ? error.message : "backup failed" }));
    process.exitCode = 1;
  });
}

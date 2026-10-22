import { readFile, rename, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { PaperLedger, type PaperLedgerState } from "./paper-ledger.js";

export class PaperLedgerStore {
  readonly filePath: string;

  constructor(filePath: string) {
    if (!filePath.trim()) throw new Error("filePath must not be empty");
    this.filePath = resolve(filePath);
  }

  async save(ledger: PaperLedger): Promise<void> {
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    const serialized = JSON.stringify(ledger.exportState(), null, 2) + "\n";

    try {
      await writeFile(temporaryPath, serialized, { encoding: "utf8", flag: "w" });
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      // Best-effort cleanup; preserve the original write/rename error.
      const { rm } = await import("node:fs/promises");
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async load(): Promise<PaperLedger | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return undefined;
      throw error;
    }

    let state: PaperLedgerState;
    try {
      state = JSON.parse(raw) as PaperLedgerState;
    } catch {
      throw new Error(`Paper ledger file is not valid JSON: ${this.filePath}`);
    }
    return PaperLedger.restore(state);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

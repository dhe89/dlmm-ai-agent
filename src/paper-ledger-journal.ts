import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { PaperLedgerEvent } from "./paper-ledger.js";

/**
 * Durable append-only JSONL journal for paper-ledger events.
 * A malformed/truncated record fails closed: callers must not silently replay
 * a partial history and mistake it for a complete trading record.
 */
export class PaperLedgerEventJournal {
  readonly filePath: string;

  constructor(filePath: string) {
    if (!filePath.trim()) throw new Error("filePath must not be empty");
    this.filePath = resolve(filePath);
  }

  async append(events: readonly PaperLedgerEvent[]): Promise<void> {
    if (events.length === 0) return;
    for (const event of events) assertValidEvent(event);

    await mkdir(dirname(this.filePath), { recursive: true });
    const lines = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
    await appendFile(this.filePath, lines, { encoding: "utf8", flag: "a" });
  }

  async readAll(): Promise<PaperLedgerEvent[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return [];
      throw error;
    }

    if (raw.length === 0) return [];
    const lines = raw.split("\n");
    // A complete JSONL journal always ends in a newline. A partial last record
    // can otherwise look like a valid prefix after a process or disk failure.
    if (lines[lines.length - 1] !== "") {
      throw new Error(`Paper ledger journal has an incomplete final record: ${this.filePath}`);
    }
    lines.pop();

    return lines.map((line, index) => {
      try {
        const event: unknown = JSON.parse(line);
        assertValidEvent(event);
        return event;
      } catch (error) {
        const reason = error instanceof Error ? error.message : "invalid record";
        throw new Error(`Invalid paper ledger journal record at line ${index + 1}: ${reason}`);
      }
    });
  }
}

function assertValidEvent(value: unknown): asserts value is PaperLedgerEvent {
  if (!value || typeof value !== "object") throw new Error("event must be an object");
  const event = value as Record<string, unknown>;
  if (typeof event.at !== "string" || !event.at.trim() || !Number.isFinite(Date.parse(event.at))) {
    throw new Error("event timestamp must be valid");
  }
  if (typeof event.positionId !== "string" || !event.positionId.trim()) {
    throw new Error("event positionId must not be empty");
  }

  switch (event.type) {
    case "position_opened":
      if (typeof event.poolAddress !== "string" || !event.poolAddress.trim()) {
        throw new Error("opened event poolAddress must not be empty");
      }
      assertNonNegativeFinite(event.capitalUsd, "capitalUsd");
      assertNonNegativeFinite(event.entryPoolPrice, "entryPoolPrice");
      break;
    case "position_marked":
      assertNonNegativeFinite(event.previousValueUsd, "previousValueUsd");
      assertNonNegativeFinite(event.currentValueUsd, "currentValueUsd");
      break;
    case "position_closed":
      assertNonNegativeFinite(event.finalValueUsd, "finalValueUsd");
      if (typeof event.realizedPnlUsd !== "number" || !Number.isFinite(event.realizedPnlUsd)) {
        throw new Error("realizedPnlUsd must be finite");
      }
      break;
    default:
      throw new Error("unsupported event type");
  }
}

function assertNonNegativeFinite(value: unknown, name: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number`);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

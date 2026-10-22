import { resolve } from "node:path";
import { PaperLedger } from "./paper-ledger.js";
import { PaperLedgerStore } from "./paper-ledger-store.js";

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((item) => item.startsWith(prefix))?.slice(prefix.length);
}

function numberOption(name: string, fallback?: number): number {
  const raw = option(name);
  if (raw === undefined) {
    if (fallback !== undefined) return fallback;
    throw new Error(`required option: --${name}=number`);
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a finite number`);
  return value;
}

function requiredOption(name: string): string {
  const value = option(name);
  if (value === undefined || value.trim() === "") throw new Error(`required option: --${name}=value`);
  return value;
}

async function main(): Promise<void> {
  const statePath = resolve(option("state") ?? "data/local/paper-portfolio.json");
  const action = option("action") ?? "status";
  const store = new PaperLedgerStore(statePath);
  let ledger = await store.load();

  if (!ledger) {
    if (action !== "init" && option("initial-capital") === undefined) {
      throw new Error(`No portfolio exists at ${statePath}. Initialize it with --action=init --initial-capital=1000.`);
    }
    ledger = new PaperLedger(numberOption("initial-capital", 1_000));
    await store.save(ledger);
  }

  const at = option("at") ?? new Date().toISOString();
  switch (action) {
    case "init":
    case "status":
      break;
    case "open":
      ledger.openPosition({
        id: requiredOption("id"),
        poolAddress: requiredOption("pool"),
        openedAt: at,
        initialCapitalUsd: numberOption("capital"),
        entryPoolPrice: numberOption("entry-price")
      });
      await store.save(ledger);
      break;
    case "mark":
      ledger.markPosition(requiredOption("id"), at, numberOption("value"));
      await store.save(ledger);
      break;
    case "close":
      ledger.closePosition(requiredOption("id"), at, numberOption("value"));
      await store.save(ledger);
      break;
    case "history":
      break;
    default:
      throw new Error(`Unsupported --action=${action}; use init, status, open, mark, close, or history.`);
  }

  const summary = ledger.summary();
  console.log(JSON.stringify({
    reportType: "paper-portfolio",
    mode: "paper-only",
    statePath,
    action,
    updatedAt: at,
    summary: {
      ...summary,
      returnPct: Number(((summary.totalPnlUsd / summary.initialCapitalUsd) * 100).toFixed(6))
    },
    positions: action === "history"
      ? ledger.getPositions()
      : ledger.getPositions().filter((position) => position.status === "open"),
    ...(action === "history" ? { events: ledger.getEvents() } : {}),
    warning: "Manual paper ledger only. Position marks must be supplied explicitly; this does not fetch prices, calculate DLMM LP fees, or execute trades."
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Unknown paper portfolio error");
    process.exitCode = 1;
  });
}

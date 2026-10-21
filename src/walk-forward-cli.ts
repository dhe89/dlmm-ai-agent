import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseHistoricalSnapshots } from "./historical-backtest.js";
import { runSmaWalkForward } from "./walk-forward.js";

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find(item => item.startsWith(prefix))?.slice(prefix.length);
}
function numberOption(name: string, fallback: number): number {
  const raw = option(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} must be a finite number`);
  return value;
}
function windowsOption(name: string, fallback: number[]): number[] {
  const raw = option(name);
  if (raw === undefined) return fallback;
  const values = raw.split(",").map(value => Number(value.trim()));
  if (values.some(value => !Number.isInteger(value) || value < 1)) {
    throw new Error(`--${name} must be a comma-separated list of positive integers`);
  }
  return values;
}
async function main(): Promise<void> {
  const input = option("input");
  if (!input) throw new Error("required option: --input=path/to/snapshots.jsonl");
  const snapshots = parseHistoricalSnapshots(await readFile(resolve(input), "utf8"));
  const config = {
    fastWindows: windowsOption("fast-windows", [3, 5, 8]),
    slowWindows: windowsOption("slow-windows", [10, 15, 20]),
    costBps: numberOption("cost-bps", 30),
    initialCapitalUsd: numberOption("capital-usd", 1_000),
    initialTrainFraction: numberOption("train-fraction", 0.5),
    folds: numberOption("folds", 3)
  };
  const result = runSmaWalkForward(snapshots, config);
  console.log(JSON.stringify({
    reportType: "historical-sma-walk-forward",
    input: resolve(input),
    config,
    result
  }, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Unknown walk-forward error");
    process.exitCode = 1;
  });
}

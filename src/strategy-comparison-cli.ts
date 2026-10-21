import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseHistoricalSnapshots } from "./historical-backtest.js";
import { runShadowBacktest } from "./shadow-backtest.js";
import { runEmaBacktest } from "./ema-backtest.js";
import { buildExperimentMetadata } from "./experiment-metadata.js";

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
async function main(): Promise<void> {
  const input = option("input");
  if (!input) throw new Error("required option: --input=path/to/snapshots.jsonl");
  const rawInput = await readFile(resolve(input), "utf8");
  const snapshots = parseHistoricalSnapshots(rawInput);
  const metadata = buildExperimentMetadata(rawInput, snapshots);
  const fastWindow = numberOption("fast-window", 5);
  const slowWindow = numberOption("slow-window", 20);
  const costBps = numberOption("cost-bps", 30);
  const initialCapitalUsd = numberOption("capital-usd", 1_000);
  const config = { fastWindow, slowWindow, costBps, initialCapitalUsd };
  const sma = runShadowBacktest(snapshots, config);
  const ema = runEmaBacktest(snapshots, config);
  console.log(JSON.stringify({
    reportType: "historical-sma-vs-ema-comparison",
    input: resolve(input),
    metadata,
    config,
    comparison: {
      sma: {
        methodology: sma.methodology,
        totalReturnPct: sma.totalReturnPct,
        excessReturnPct: sma.excessReturnPct,
        maxDrawdownPct: sma.maxDrawdownPct,
        trades: sma.trades,
        buyHoldReturnPct: sma.buyHoldReturnPct
      },
      ema: {
        methodology: ema.methodology,
        totalReturnPct: ema.totalReturnPct,
        excessReturnPct: ema.excessReturnPct,
        maxDrawdownPct: ema.maxDrawdownPct,
        trades: ema.trades,
        buyHoldReturnPct: ema.buyHoldReturnPct
      },
      warning: "SMA/EMA comparison uses pair-price proxies and one fixed parameter pair on the supplied history. This is not DLMM LP PnL and does not establish out-of-sample profitability."
    }
  }, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Unknown strategy comparison error");
    process.exitCode = 1;
  });
}

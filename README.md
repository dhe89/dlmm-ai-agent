# Meteora DLMM AI Agent

An experimental agent for researching Meteora DLMM strategies, starting with read-only live data and paper trading. The initial system is **simulation only**: no on-chain transactions and no real trading capital.

## Current status

- [x] Repository foundation, TypeScript runtime scaffold, and GitHub Actions CI
- [x] Unit tests for paper-only configuration, net-PnL arithmetic, and the read-only pool collector
- [x] Collector normalization aligned with the official Meteora DLMM Data API pool-list schema
- [x] Add a read-only live collector that appends timestamped pool snapshots to local JSONL storage
- [x] Verify live API availability and response compatibility in CI (live smoke test passes)
- [x] Store timestamped market snapshots with stale-data checks
- [x] Paper execution and position/event ledger
- [ ] Bin-level position and fee valuation model
- [x] Add a deterministic pair-price shadow backtest proxy with modeled costs and drawdown metrics\n- [ ] DLMM-specific strategy evaluation with authoritative position inventory and accrued fees

## Principles

1. **Paper trading first.** The system must not sign or submit transactions.
2. **No secrets in Git.** Never commit seed phrases, private keys, wallet files, or API credentials.
3. **Measure net results.** Separate fees, inventory/price PnL, estimated swaps/slippage, and operational costs.
4. **Keep experiments reproducible.** Record configuration, data window, assumptions, results, and conclusions.
5. **Do not assume profitability.** Simulated results are estimates and must be validated against real pool mechanics.
6. **Fail safely.** Stale or missing data must not silently produce a trading decision.
7. **Preserve units.** Meteora's `current_price` is represented as a pool pair price, not automatically as USD. The pool-list endpoint does not provide an active-bin ID; neither value may be fabricated.

## Data source

The read-only collector uses the Meteora DLMM Data API at `https://dlmm.datapi.meteora.ag` and its paginated `/pools` endpoint. Field normalization follows the official API schema. Unit tests use controlled fixtures and do not, by themselves, prove that the live service is reachable.

The current pool-list collector is discovery data only. The shadow backtest reports a passive buy-and-hold pair-price benchmark and excess return, but both remain price-series proxies. A separate authoritative source for active bin and position/bin-level liquidity state must be implemented before calculating realistic DLMM position PnL or making strategy decisions.

## Collect live market snapshots

The collector is read-only and does not connect a wallet or submit transactions. With Node.js 22 installed, run:

```bash
npm run collect:live -- --limit=20 --output=data/local/meteora-pools.jsonl
```

Each successful run appends JSON Lines records containing a schema version, source, retrieval timestamp, pool address, pair price, and any available volume/TVL fields. The default output path is `data/local/meteora-pools.jsonl`, which is ignored by Git. Do not interpret the pool pair price as USD. CI runs a small live API smoke test and writes its sample output to a temporary path rather than committing market data.

## Run a historical shadow backtest

The historical runner reads timestamped JSONL snapshots produced by the read-only collector. It validates every record and fails closed on malformed timestamps, non-positive pair prices, invalid metrics, duplicate timestamps, or mixed pools (the backtest engine enforces the final two constraints).

```bash
npm run backtest:historical -- --input=data/local/meteora-pools.jsonl --fast-window=5 --slow-window=20 --cost-bps=30 --capital-usd=1000
```

This command requires enough observations for the selected slow window. The output includes strategy return, drawdown, a passive buy-and-hold benchmark, and excess return. The default cost is a configurable illustrative assumption, not a verified Meteora execution cost. Collector snapshots are not automatically historical OHLCV candles: repeated live collection is required to build a time series, and irregular intervals can distort SMA interpretation. The pair-price result is not DLMM LP PnL.

## Compare SMA parameter combinations

The bounded parameter sweep compares multiple fast/slow SMA windows on the same input series and ranks results by excess return versus buy-and-hold, then drawdown. It is an in-sample exploratory tool; selecting the best row on the same data used for evaluation can overfit. Reserve a separate, later time period for holdout validation before trusting a parameter choice.

For repeated expanding-window evaluation, run:

```bash
npm run validate:walk-forward -- --input=data/local/meteora-pools.jsonl --fast-windows=3,5,8 --slow-windows=10,15,20 --train-fraction=0.5 --folds=3 --cost-bps=30 --capital-usd=1000
```

This selects SMA parameters from each fold's preceding history, then tests SMA and EMA on the next unseen segment using the same selected window pair and costs. Each test fold starts cold and resets notional; reported compounded returns combine independent test periods rather than simulating one continuously held portfolio. Every test segment must contain more observations than the selected slow window. The results remain pair-price proxies, not DLMM LP PnL. The JSON report includes a SHA-256 fingerprint of the exact input file and data-quality metadata (pool, observation count, date range, and minimum/median/maximum snapshot interval) so experiments can be reproduced and irregular sampling can be spotted. It flags snapshot cadence when the largest interval exceeds three times the median, the smallest interval is below one-third of the median, or the data has only one observation; these are heuristic warnings, not proof that the series is a regular candle feed. It reports positive-return fold frequency for both strategies, the number of distinct selected SMA parameter sets, parameter stability, and aggregate SMA-versus-EMA return differences.

The sweep module is available to import from `src/strategy-sweep.ts`. For a chronological holdout evaluation, use the CLI below. It chooses SMA windows using only the earlier training segment and evaluates both SMA and EMA on the later untouched holdout segment with the same selected windows and costs; both holdout runs start cold, so the segment needs enough observations for the slow window and signal warm-up.\n\n```bash\nnpm run validate:holdout -- --input=data/local/meteora-pools.jsonl --fast-windows=3,5,8 --slow-windows=10,15,20 --train-fraction=0.7 --cost-bps=30 --capital-usd=1000\n```\n\nDefaults are fast windows 3/5/8, slow windows 10/15/20, 70% training data, 30 bps per side, and $1,000 starting notional. The output reports training and holdout periods separately. This is a single holdout check; a single holdout is noisy and does not establish future profitability or DLMM LP PnL. For repeated expanding-window validation, use the walk-forward command below.

## Compare SMA and EMA strategies

Run a fixed-parameter comparison on the same historical snapshot file:

```bash
npm run compare:strategies -- --input=data/local/meteora-pools.jsonl --fast-window=5 --slow-window=20 --cost-bps=30 --capital-usd=1000
```

The report compares SMA and EMA crossover proxies using the same fast/slow windows, modeled costs, and passive buy-and-hold benchmark. It includes input SHA-256 and snapshot interval quality metadata. This comparison is intentionally fixed-parameter rather than selecting a winner on the full data set; use the separate holdout or walk-forward commands for chronological validation. Both strategies use pair-price returns only, not DLMM LP inventory, accrued fees, bin changes, or position-level execution costs.

## Inspect and manage a persistent paper portfolio

A basic command-line paper portfolio is available. It persists virtual cash, positions, marks, and event history to a local JSON file (ignored by Git). This is a manual ledger interface; it does not yet generate trading signals, fetch live marks, or value actual DLMM LP inventory and fees.

Initialize a $1,000 paper portfolio:

```bash
npm run paper:portfolio -- --action=init --initial-capital=1000
```

Show the portfolio summary and open positions:

```bash
npm run paper:portfolio
```

Open a virtual position (capital is allocated from paper cash):

```bash
npm run paper:portfolio -- --action=open --id=demo-1 --pool=POOL_ADDRESS --capital=100 --entry-price=1.25
```

Record a new manually supplied position value:

```bash
npm run paper:portfolio -- --action=mark --id=demo-1 --value=105
```

Close the virtual position at a manually supplied final value:

```bash
npm run paper:portfolio -- --action=close --id=demo-1 --value=103
```

View all open/closed positions and ledger events:

```bash
npm run paper:portfolio -- --action=history
```

Use `--state=path/to/portfolio.json` to select a different local state file. All amounts are illustrative USD notional values. Marks must be entered explicitly and are not inferred from the pool pair price. This CLI is a first usable paper-ledger step, not an automated strategy runner or a DLMM LP PnL engine.

## Development

- Node.js 22 in GitHub Actions
- TypeScript with strict compiler options
- Vitest unit tests
- `npm run typecheck`, `npm test`, and `npm run build`

See [docs/roadmap.md](docs/roadmap.md) and [docs/architecture.md](docs/architecture.md).

## Security

The repository is public. Keep `.env`, wallet material, RPC credentials, and all secrets out of version control. Use `.env.example` only for variable names and safe placeholders. Live on-chain execution remains out of scope.

## Disclaimer

This is research software, not financial advice. Paper-trading PnL is not a promise of live performance; fees, bin-level inventory, swap costs, slippage, transaction failures, and changing liquidity can materially affect real outcomes.

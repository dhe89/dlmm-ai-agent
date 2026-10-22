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

## Run the mobile-friendly paper portfolio dashboard

Start the local dashboard:

```bash
npm run paper:dashboard
```

Then open `http://127.0.0.1:8787` in a browser on the same computer. It displays paper cash, equity, realized/unrealized PnL, open positions, and recent event history. The **Fetch market data** button requests current read-only Meteora pool discovery data; it does not use pair prices to mark LP positions or produce automatic trading signals. Position open/mark/close actions remain virtual and persist to `data/local/paper-portfolio.json`.

The dashboard exposes `GET /api/health` for monitoring. It verifies that the persisted paper ledger can be loaded: healthy state returns HTTP 200 with `persistence: "ok"`; an unreadable or corrupted state returns HTTP 503. This is a lightweight persistence check, not a full external-data or strategy-health guarantee.

Configuration:
- `PAPER_DASHBOARD_HOST` defaults to `127.0.0.1` (local machine only).
- `PAPER_DASHBOARD_PORT` defaults to `8787`.
- `PAPER_STATE_PATH` defaults to `data/local/paper-portfolio.json`.

Portfolio mutation endpoints require `Content-Type: application/json`; this rejects simple form/text POSTs and reduces cross-site request-forgery exposure. It is not a substitute for HTTPS, authentication, or keeping the dashboard private. For security, keep the dashboard bound to localhost unless you have a specific protected deployment setup. Non-loopback binding requires both `PAPER_DASHBOARD_USERNAME` and `PAPER_DASHBOARD_PASSWORD`, enabling HTTP Basic Authentication; Basic Authentication does not encrypt traffic, so do not expose the server directly to the public internet. On a phone, use a trusted private network or VPN and HTTPS. This is a manual paper portfolio dashboard, not yet an automated strategy runner or validated DLMM LP valuation engine.

## Collect read-only paper strategy signals

The experimental signal runner collects repeated current pair-price observations for one selected pool and records a simple SMA crossover research signal. It does not open, mark, or close paper positions automatically.

Run one sample:

```bash
npm run paper:strategy -- --pool=POOL_ADDRESS --fast-window=5 --slow-window=20
```

Collect 100 samples one minute apart:

```bash
npm run paper:strategy -- --pool=POOL_ADDRESS --fast-window=5 --slow-window=20 --interval-seconds=60 --iterations=100
```

Run continuously until the process is stopped (for example with Ctrl+C):

```bash
npm run paper:strategy -- --pool=POOL_ADDRESS --fast-window=5 --slow-window=20 --interval-seconds=60 --forever
```

In continuous mode, an iteration failure is written as a structured error to stderr and the runner waits one interval before trying again. It does not emit a signal for a failed iteration; persistent invalid history still needs operator intervention. Without `--forever`, an iteration error exits non-zero so CI or a process supervisor can detect the failure.

Snapshots append to `data/local/strategy-snapshots.jsonl`; signal reports append to `data/local/strategy-signals.jsonl`. Override paths with `--history=...` and `--signals=...`. A machine-readable status file is atomically replaced at `data/local/strategy-runner-status.json` by default; override it with `--status=...`. It records runner state, last check time, last successful snapshot time, last error, and the scheduled retry time when applicable. Exact retries of an already-persisted snapshot are reused only when all snapshot fields match, and the runner avoids appending a second signal record for the same pool/timestamp. A timestamp collision with different data fails closed. Until there are at least `slow-window` observations the report says `WARMING_UP`. `LONG` and `CASH` are research labels from pair-price SMA only, not DLMM LP PnL, not a validated profitability claim, and not transaction instructions. This runner currently operates as a foreground process; it is not a hosted always-on service.

The signal journal also records the previous signal, whether the signal changed, and a transition label (`INITIAL`, `UNCHANGED`, or for example `CASH->LONG`). This makes it easier to review actual strategy state changes instead of treating every repeated poll as a new decision. It remains a research-only journal and does not trigger position changes.

## Paper signal evaluation and dashboard access

The codebase includes a testable forward-outcome evaluator in `src/paper-signal-evaluation.ts`. It compares recorded LONG/CASH labels with later observed pair prices and reports forward-return statistics plus matched-window strategy/benchmark diagnostics. It deliberately does not claim compounded live performance, and overlapping forward windows are not independent trades. Treat results as exploratory only; use chronological holdout data before drawing conclusions.

The dashboard API supports a validated valuation mark at `POST /api/portfolio/mark-valuation` with JSON `{"id":"position-id","valuation":{...ValuationResult}}`. The supplied valuation must include fresh evidence and internally consistent inventory/fee/cost/PnL components; stale or incomplete valuations are rejected. This endpoint is an integration point only: the project does not yet automatically fetch authoritative position-specific bin inventory, accrued fees, or token USD prices from a complete DLMM position data source. Do not fabricate these values or use the pool pair price as a substitute.

### Dashboard binding and authentication

By default, the dashboard binds to `127.0.0.1:8787` and is only reachable from the same computer. A non-loopback binding now requires both `PAPER_DASHBOARD_USERNAME` and `PAPER_DASHBOARD_PASSWORD`, which enables HTTP Basic Authentication.

Example environment configuration:

```bash
PAPER_DASHBOARD_HOST=0.0.0.0
PAPER_DASHBOARD_PORT=8787
PAPER_DASHBOARD_USERNAME=choose-a-user
PAPER_DASHBOARD_PASSWORD=use-a-long-unique-secret
```

Basic Authentication does not encrypt traffic. Do not expose this server directly to the public internet. For phone access, prefer a trusted private network or VPN and put the dashboard behind HTTPS; never commit credentials to Git or share them in logs. The dashboard remains paper-only.

### Access the dashboard from your phone (private network)

The simplest first setup is to run the dashboard on your computer and reach it from your phone through a private VPN such as Tailscale. This does not require hosting the app publicly, a database service, or real-time automation.

1. On the computer, install Node.js 20+ and clone the repository. Run `npm install`.
2. Start the dashboard with `PAPER_DASHBOARD_HOST=127.0.0.1 PAPER_DASHBOARD_PORT=8787 npm run paper:dashboard` (PowerShell: `$env:PAPER_DASHBOARD_HOST="127.0.0.1"; $env:PAPER_DASHBOARD_PORT="8787"; npm run paper:dashboard`).
3. Install Tailscale on both the computer and phone, sign in to the same private tailnet, and verify both devices appear online.
4. On the computer, publish the local dashboard only to your tailnet using Tailscale Serve: `tailscale serve --bg http://127.0.0.1:8787`. Follow the current Tailscale CLI output to get the HTTPS tailnet URL.
5. Open that HTTPS URL in the phone browser. Keep the computer awake and the dashboard process running while you use it.

The dashboard also exposes `GET /api/runner-health`, which reads the strategy runner status file and classifies it as `ok`, `stale`, `retrying`, `stopped`, `unhealthy`, or `not-configured`. The default status path is `data/local/strategy-runner-status.json`; set `PAPER_RUNNER_STATUS_PATH` if the runner writes elsewhere. The endpoint returns HTTP 503 for stale, retrying, stopped, or unhealthy states. A status is considered stale after five minutes without an updated check. The endpoint is diagnostic only and does not restart the runner or prove that market data is currently available.

You can make a validated backup or restore a snapshot using the `paper:backup` command. It validates the source ledger before writing the destination atomically:

```bash
npm run paper:backup -- --source=data/local/paper-portfolio.json --destination=backups/paper-portfolio.json
npm run paper:backup -- --source=backups/paper-portfolio.json --destination=data/local/paper-portfolio.json
```

Use distinct source and destination paths. Keep backup files private, outside the public repository, and preferably on separate persistent storage. This utility copies a single validated snapshot; it does not synchronize concurrent writes or replace an external database.

The dashboard's JSON state is stored locally at `data/local/paper-portfolio.json` by default; keep regular backups and do not commit local state. To stop private access, use `tailscale serve off`. Check `tailscale serve status` to confirm it is disabled. See the official [Tailscale Serve documentation](https://tailscale.com/docs/features/tailscale-serve) for current commands and HTTPS setup.

This is a private-network setup, not a production hosting deployment. Do not forward router ports, expose the dashboard directly to the public internet, or use plain HTTP Basic Authentication over an untrusted network. No actual wallet or on-chain signing is involved.

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

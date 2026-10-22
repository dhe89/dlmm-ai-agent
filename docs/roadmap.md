# Roadmap and test gates

## Milestone 0.1 — Repository foundation
- Document goals, security boundaries, and PnL definitions.
- Add TypeScript project configuration.
- Gate: files exist and no secrets are committed.

## Milestone 0.2 — Minimal runtime and tests
- Add a small typed domain model, configuration validation, logging, and unit-test setup.
- Gate: build, typecheck, and tests pass in CI.

## Milestone 0.3 — Read-only live data
- [x] Add a read-only collector for the official Meteora DLMM Data API `/pools` endpoint.
- [x] Align pool-list normalization with the published API schema.
- [x] Add mocked unit tests for normalization, invalid responses, and HTTP errors.
- [x] Verify live endpoint behavior from the CI/cloud runtime with a live smoke test.
- [x] Add append-only local JSONL snapshot persistence with source and retrieval timestamp.
- [x] Add bounded retries with exponential backoff for network failures, HTTP 429, and HTTP 5xx responses.
- [x] Add fail-closed validation for stale/future snapshots and invalid numeric fields.
- [x] Identify an authoritative source for active-bin IDs and bin-level liquidity state via the official Meteora DLMM SDK; position-specific fee state remains a separate input.
- Gate: real response samples are validated and saved with source and retrieval time; no transaction signing code.

## Milestone 0.4 — Paper ledger
- [x] Add deterministic ledger transitions for opening, marking, and closing virtual positions.
- [x] Track cash, open position value, equity, realized PnL, and unrealized PnL separately.
- [x] Test accounting invariants, overspending, duplicate IDs, timestamp order, and closed positions.
- [x] Add atomic JSON snapshot persistence and state restoration.
- [x] Test restart recovery, closed-position accounting, missing files, and corrupted snapshots.
- [x] Add durable append-only JSONL event journal with strict validation and incomplete-record detection.
- [x] Add deterministic replay with checks against prior values, position transitions, and realized PnL.
- Gate: deterministic tests cover ledger transitions, accounting invariants, and recovery.

## Milestone 0.5 — Fee and valuation model
- [x] Establish authoritative bin-level inputs and document the remaining position-specific data requirements.
- [x] Add conservative inventory valuation using decimal-adjusted token quantities and independently sourced USD marks.
- [x] Keep inventory PnL separate from position-specific fees and execution/network costs.
- [x] Add a pure helper to convert sourced raw token fee amounts into USD using token decimals and independent USD marks.
- [x] Distinguish measured, sourced, estimated, and unavailable values; unknown fees/costs are never silently treated as zero.
- [x] Fail closed for stale/future snapshots and invalid numeric inputs.
- [ ] Integrate authoritative position-specific accrued-fee data and validated cost estimates.
- Gate: unit tests cover in-range, out-of-range, price moves, and missing/stale data; net PnL remains unavailable until all required components are supplied.

## Milestone 0.6 — Shadow strategy evaluation
- [x] Add deterministic pool discovery screening using minimum USD TVL/volume and volume-to-TVL ranking.
- [x] Reject stale snapshots and exclude pools missing required USD metrics; do not infer pair price as USD.
- [x] Expose an opt-in read-only CLI screen over freshly collected live pool snapshots.
- [x] Add a deterministic, cost-aware pair-price SMA shadow backtest with no same-bar look-ahead.
- [ ] Validate strategies against a sufficiently long historical data set.
- [ ] Run strategies on live data without execution.
- [x] Compare the SMA proxy against a passive buy-and-hold pair-price benchmark, including excess return.
- [x] Add a fail-closed JSONL historical snapshot loader and reproducible CLI report.
- [x] Add a bounded, deterministic SMA parameter sweep ranked by excess return and drawdown.
- [x] Add chronological train/holdout validation that selects parameters on earlier data and evaluates them on a later segment without parameter-selection leakage.
- [x] Add expanding-window walk-forward validation with per-fold parameter selection and unseen test segments.
- [x] Record reproducible input fingerprints and snapshot interval quality statistics in walk-forward, fixed-parameter comparison, and chronological holdout reports.
- [x] Report positive-return fold frequency, selected-parameter diversity, and parameter stability.
- [x] Add a fixed-parameter SMA-versus-EMA comparison with matched costs, passive benchmark, and reproducible input fingerprint.
- [x] Compare SMA and EMA on chronological holdout and expanding-window walk-forward folds.
- [ ] Compare multiple active strategies with DLMM position-level PnL and record reproducible experiments.
- Gate: repeatable reports, no hidden look-ahead bias, and risk metrics alongside returns.

## Milestone 0.7 — Long-running deployment
- Only after tests pass, deploy a read-only/paper process to a free cloud VM if available.
- Gate: restart recovery, health checks, alerting, and bounded resource usage.

## Later milestones
- Historical backtesting and walk-forward validation.
- Quant scoring and market-regime classification.
- Independent risk engine and monitoring.
- Any live on-chain execution is out of scope until explicitly reviewed and separately approved.

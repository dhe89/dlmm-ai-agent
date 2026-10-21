# Roadmap and test gates

## Milestone 0.1 — Repository foundation
- Document goals, security boundaries, and PnL definitions.
- Add TypeScript project configuration.
- Gate: files exist and no secrets are committed.

## Milestone 0.2 — Minimal runtime and tests
- Add a small typed domain model, configuration validation, logging, and unit-test setup.
- Gate: build, typecheck, and tests pass locally and in CI.

## Milestone 0.3 — Read-only live data
- Identify official/reliable Meteora DLMM pool and position-related data sources.
- Add a collector with timestamps, retries, rate-limit handling, and stale-data checks.
- Gate: sample data is saved with source and retrieval time; no transaction signing code.

## Milestone 0.4 — Paper ledger
- Record virtual decisions, positions, and events.
- Gate: deterministic tests for open, update, close, and restart/recovery.

## Milestone 0.5 — Fee and valuation model
- Establish the available bin-level inputs and document all assumptions.
- Model fee accrual, inventory valuation, rebalance costs, and net PnL.
- Gate: test fixtures cover in-range, out-of-range, price moves, and missing/stale data.

## Milestone 0.6 — Shadow strategy evaluation
- Run strategies on live data without execution.
- Compare strategies and record experiments.
- Gate: repeatable reports and no hidden look-ahead bias.

## Milestone 0.7 — Long-running deployment
- Only after local tests pass, deploy a read-only/paper process to a free cloud VM if available.
- Gate: restart recovery, health checks, and bounded resource usage.

## Later milestones
- Backtesting and walk-forward validation.
- Quant scoring and market-regime classification.
- Risk engine and monitoring.
- Any live on-chain execution is out of scope until explicitly reviewed and separately approved.

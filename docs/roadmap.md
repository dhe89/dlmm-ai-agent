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
- [ ] Verify live endpoint behavior from the CI/cloud runtime (live smoke test added; awaiting a green run).
- [x] Add append-only local JSONL snapshot persistence with source and retrieval timestamp.
- [ ] Add bounded retry/backoff and rate-limit handling inside the collector.
- [ ] Add stale-data checks before any strategy consumes snapshots.
- [ ] Identify an authoritative source for active-bin IDs and bin-level liquidity/position state.
- Gate: real response samples are validated and saved with source and retrieval time; no transaction signing code.

## Milestone 0.4 — Paper ledger
- Record virtual decisions, positions, and events.
- Support deterministic open, update, close, and restart/recovery behavior.
- Gate: deterministic tests cover ledger transitions, accounting invariants, and recovery.

## Milestone 0.5 — Fee and valuation model
- Establish authoritative bin-level inputs and document all assumptions.
- Model fee accrual, inventory valuation, rebalance costs, and net PnL.
- Distinguish measured, sourced, estimated, and unavailable values.
- Gate: test fixtures cover in-range, out-of-range, price moves, and missing/stale data.

## Milestone 0.6 — Shadow strategy evaluation
- Run strategies on live data without execution.
- Compare strategies and record experiments.
- Gate: repeatable reports, no hidden look-ahead bias, and risk metrics alongside returns.

## Milestone 0.7 — Long-running deployment
- Only after tests pass, deploy a read-only/paper process to a free cloud VM if available.
- Gate: restart recovery, health checks, alerting, and bounded resource usage.

## Later milestones
- Historical backtesting and walk-forward validation.
- Quant scoring and market-regime classification.
- Independent risk engine and monitoring.
- Any live on-chain execution is out of scope until explicitly reviewed and separately approved.

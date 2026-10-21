# Architecture

## Data flow

1. **Data collector** obtains public pool/market data from supported Meteora/Solana endpoints.
2. **Data validation** checks timestamps, required fields, and staleness before any downstream use.
3. **Pool screener** applies deterministic filters and ranks a limited candidate set.
4. **Strategy engine** proposes a virtual position and its parameters.
5. **Paper execution** records virtual entries, exits, and rebalances only; it must not sign or send transactions.
6. **Position valuation** estimates inventory value, accrued fees, and estimated costs.
7. **Ledger/reporting** stores decisions and snapshots so results can be audited and compared.

## Paper ledger and recovery

The `PaperLedger` is an in-memory accounting component with explicit state export and validated restoration:
- Opening a position reserves cash equal to its allocated capital.
- Marking a position updates the externally supplied total valuation; it does not infer LP value from pair-price movement.
- Closing a position returns the supplied final valuation to cash and records realized PnL.
- Equity is cash plus the marked value of open positions.
- Realized and unrealized PnL are reported separately.
- `PaperLedgerStore` saves versioned JSON snapshots using a temporary file and atomic rename, then validates accounting invariants on load.
- Missing snapshots return no ledger; malformed JSON and inconsistent cash accounting fail closed.
- The current store is a snapshot mechanism, not yet an append-only event journal. Concurrent writers and crash-safe event replay are not yet supported.

The valuation supplied to `markPosition` and `closePosition` must be produced by a separately validated valuation model. Until bin-level composition and fee mechanics are available, these values are test inputs or explicitly labeled estimates, not verified DLMM PnL.

## Initial safety invariants

- Default mode is `paper`.
- `ENABLE_ONCHAIN_EXECUTION=false` is a hard configuration guard, not a prompt-level instruction.
- No wallet keypair is needed for the initial paper-trading milestones.
- Reject stale/incomplete market data rather than guessing.
- Persist the inputs and assumptions used for every simulated fill and valuation.
- Label estimates clearly; do not present estimated fee accrual as a verified on-chain claim.

## PnL definitions

The reporting layer should show components separately:
- **Fees:** estimated fee income attributable to the simulated position.
- **Inventory/price PnL:** change in the value of the position's token inventory versus its entry valuation.
- **Estimated execution costs:** hypothetical swap fees, slippage, and rebalance costs where applicable.
- **Network costs:** estimated only when a simulated action would plausibly incur them.
- **Net PnL:** fees + inventory/price PnL - estimated execution costs - estimated network costs.

Avoid double-counting fees or inventory value. A simple token-price change alone is not a valid DLMM LP PnL calculation.

## Known limitation

A credible DLMM simulator needs bin-level position composition and fee mechanics, not just pool APR or token price. The official indexed Data API exposes pool, OHLCV, position, and PnL endpoints, but the exact authoritative fields needed for a position-level simulator must be validated before using them. Until then, any simplified model must be marked as an approximation and must not be treated as live-trading evidence.

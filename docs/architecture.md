# Architecture (initial)

## Data flow

1. **Data collector** obtains public pool/market data from supported Meteora/Solana endpoints.
2. **Data validation** checks timestamps, required fields, and staleness before any downstream use.
3. **Pool screener** applies deterministic filters and ranks a limited candidate set.
4. **Strategy engine** proposes a virtual position and its parameters.
5. **Paper execution** records virtual entries, exits, and rebalances only; it must not sign or send transactions.
6. **Position valuation** estimates inventory value, accrued fees, and estimated costs.
7. **Ledger/reporting** stores decisions and snapshots so results can be audited and compared.

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

A credible DLMM simulator needs bin-level position composition and fee mechanics, not just pool APR or token price. We will verify which data can be sourced reliably before implementing the valuation model. Until then, any simplified model must be marked as an approximation and must not be treated as live-trading evidence.

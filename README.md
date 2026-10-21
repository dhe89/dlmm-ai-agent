# Meteora DLMM AI Agent

An experimental agent for researching Meteora DLMM strategies, starting with live-data paper trading. The first milestone is **simulation only**: no on-chain transactions and no real trading capital.

## Current status

- [x] Repository initialized with project goals and safety boundaries
- [ ] Runtime scaffold and automated tests
- [ ] Live market-data collector
- [ ] Paper execution and position ledger
- [ ] Fee, inventory-value, and net-PnL model
- [ ] Strategy evaluation and reporting

## Principles

1. **Paper trading first.** The initial system must not sign or submit transactions.
2. **No secrets in Git.** Never commit seed phrases, private keys, wallet files, or API credentials.
3. **Measure net results.** Separate fees, inventory/price PnL, estimated swaps/slippage, and operational costs.
4. **Keep experiments reproducible.** Record configuration, data window, assumptions, results, and conclusions.
5. **Do not assume profitability.** Simulated results are estimates and must be validated against real pool mechanics.
6. **Fail safely.** Stale or missing data must not silently produce a trading decision.

## Planned milestones

See [docs/roadmap.md](docs/roadmap.md) and [docs/architecture.md](docs/architecture.md).

## Development

The project will use Node.js and TypeScript to align with the Solana/Meteora ecosystem. Runtime setup and tests will be added in the next milestone.

## Security

The repository is public. Keep `.env`, wallet material, RPC credentials, and all secrets out of version control. Use `.env.example` only for variable names and safe placeholders.

## Disclaimer

This is research software, not financial advice. Paper-trading PnL is not a promise of live performance; fees, bin-level inventory, swap costs, slippage, transaction failures, and changing liquidity can materially affect real outcomes.

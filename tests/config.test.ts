import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { calculateNetPnl } from "../src/domain.js";

describe("loadConfig", () => {
  it("defaults safely to paper mode with on-chain execution disabled", () => {
    const config = loadConfig({});
    expect(config.tradingMode).toBe("paper");
    expect(config.enableOnchainExecution).toBe(false);
  });

  it("rejects attempts to enable on-chain execution", () => {
    expect(() =>
      loadConfig({ TRADING_MODE: "paper", ENABLE_ONCHAIN_EXECUTION: "true" })
    ).toThrow(/On-chain execution is disabled/);
  });

  it("rejects non-paper trading mode", () => {
    expect(() => loadConfig({ TRADING_MODE: "live" })).toThrow(
      /Only TRADING_MODE=paper/
    );
  });

  it("rejects invalid log levels", () => {
    expect(() => loadConfig({ LOG_LEVEL: "verbose" })).toThrow(
      /LOG_LEVEL must be/
    );
  });
});

describe("calculateNetPnl", () => {
  it("calculates net PnL without mixing fees and inventory value", () => {
    expect(
      calculateNetPnl({
        feesUsd: 2.5,
        inventoryPnlUsd: -1.2,
        estimatedExecutionCostsUsd: 0.3,
        estimatedNetworkCostsUsd: 0.1
      })
    ).toEqual({
      feesUsd: 2.5,
      inventoryPnlUsd: -1.2,
      estimatedExecutionCostsUsd: 0.3,
      estimatedNetworkCostsUsd: 0.1,
      netPnlUsd: 0.9
    });
  });

  it("rejects non-finite PnL inputs", () => {
    expect(() =>
      calculateNetPnl({
        feesUsd: Number.NaN,
        inventoryPnlUsd: 0,
        estimatedExecutionCostsUsd: 0,
        estimatedNetworkCostsUsd: 0
      })
    ).toThrow(/finite numbers/);
  });
});

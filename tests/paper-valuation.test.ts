import { describe, expect, it } from "vitest";
import { PaperLedger } from "../src/paper-ledger.js";
import { markLedgerFromValuation } from "../src/paper-valuation.js";
import type { ValuationResult } from "../src/valuation.js";

const openedAt = "2026-10-21T10:00:00.000Z";

function valuation(overrides: Partial<ValuationResult> = {}): ValuationResult {
  return {
    status: "available",
    capturedAt: "2026-10-21T10:01:00.000Z",
    ageMs: 0,
    rangeStatus: "in-range",
    inventoryValueUsd: 90,
    inventoryPnlUsd: -10,
    feesUsd: 3,
    executionCostsUsd: 1,
    networkCostsUsd: 1,
    netPnlUsd: -9,
    evidence: {
      inventory: "sourced",
      fees: "sourced",
      executionCosts: "estimated",
      networkCosts: "measured",
      netPnl: "estimated"
    },
    unavailableReasons: [],
    ...overrides
  };
}

describe("markLedgerFromValuation", () => {
  it("marks ledger at inventory value plus fees minus cumulative costs", () => {
    const ledger = new PaperLedger(200);
    ledger.openPosition({
      id: "pos-1",
      poolAddress: "pool-A",
      openedAt,
      initialCapitalUsd: 100,
      entryPoolPrice: 1
    });

    const result = markLedgerFromValuation(ledger, "pos-1", valuation());

    expect(result.markedValueUsd).toBe(91);
    expect(result.position.currentValueUsd).toBe(91);
    expect(ledger.summary()).toMatchObject({
      cashUsd: 100,
      openPositionValueUsd: 91,
      equityUsd: 191,
      unrealizedPnlUsd: -9,
      totalPnlUsd: -9
    });
  });

  it("rejects stale or incomplete valuations without changing the ledger", () => {
    const ledger = new PaperLedger(200);
    ledger.openPosition({
      id: "pos-1",
      poolAddress: "pool-A",
      openedAt,
      initialCapitalUsd: 100,
      entryPoolPrice: 1
    });

    expect(() => markLedgerFromValuation(
      ledger, "pos-1", valuation({ status: "stale", inventoryValueUsd: undefined })
    )).toThrow(/stale/);
    expect(() => markLedgerFromValuation(
      ledger, "pos-1", valuation({ feesUsd: undefined })
    )).toThrow(/incomplete/);
    expect(ledger.summary().equityUsd).toBe(200);
  });

  it("rejects impossible negative marked value and non-finite amounts", () => {
    const ledger = new PaperLedger(200);
    ledger.openPosition({
      id: "pos-1",
      poolAddress: "pool-A",
      openedAt,
      initialCapitalUsd: 100,
      entryPoolPrice: 1
    });

    expect(() => markLedgerFromValuation(
      ledger, "pos-1", valuation({ inventoryValueUsd: 1, feesUsd: 0, executionCostsUsd: 5, networkCostsUsd: 0, netPnlUsd: -15 })
    )).toThrow(/resulting value/);
    expect(() => markLedgerFromValuation(
      ledger, "pos-1", valuation({ inventoryValueUsd: Number.POSITIVE_INFINITY })
    )).toThrow(/invalid amounts/);
    expect(ledger.summary().equityUsd).toBe(200);
  });
});

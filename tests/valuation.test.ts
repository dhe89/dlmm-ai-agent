import { describe, expect, it } from "vitest";
import { valueInventory } from "../src/valuation.js";

const inventory = {
  amountX: 2,
  amountY: 10,
  tokenXPriceUsd: 100,
  tokenYPriceUsd: 1,
  costBasisUsd: 180,
  capturedAt: "2026-10-21T10:00:00.000Z"
};

describe("valueInventory", () => {
  it("values both inventories in USD and keeps inventory PnL separate from fees", () => {
    const result = valueInventory({
      inventory,
      now: "2026-10-21T10:00:10.000Z",
      rangeStatus: "in-range"
    });
    expect(result.status).toBe("available");
    expect(result.inventoryValueUsd).toBe(210);
    expect(result.inventoryPnlUsd).toBe(30);
    expect(result.feesUsd).toBeUndefined();
    expect(result.netPnlUsd).toBeUndefined();
    expect(result.evidence.fees).toBe("unavailable");
    expect(result.rangeStatus).toBe("in-range");
    expect(result.unavailableReasons).toContain("Position-specific accrued fees are unavailable");
  });

  it("calculates net PnL only when fees and both cost categories are supplied", () => {
    const result = valueInventory({
      inventory,
      now: "2026-10-21T10:00:10.000Z",
      feesUsd: { value: 5, evidence: "sourced" },
      executionCostsUsd: { value: 2, evidence: "estimated" },
      networkCostsUsd: { value: 1, evidence: "measured" }
    });
    expect(result.netPnlUsd).toBe(32);
    expect(result.evidence.netPnl).toBe("estimated");
    expect(result.unavailableReasons).toEqual([]);
  });

  it("returns stale without reporting valuation numbers for old marks", () => {
    const result = valueInventory({
      inventory,
      now: "2026-10-21T10:02:00.000Z",
      maxAgeMs: 60_000,
      feesUsd: { value: 0, evidence: "sourced" },
      executionCostsUsd: { value: 0, evidence: "measured" },
      networkCostsUsd: { value: 0, evidence: "measured" }
    });
    expect(result.status).toBe("stale");
    expect(result.inventoryValueUsd).toBeUndefined();
    expect(result.netPnlUsd).toBeUndefined();
    expect(result.evidence.inventory).toBe("unavailable");
  });

  it("supports out-of-range inventory without pretending it has no value", () => {
    const result = valueInventory({
      inventory,
      now: inventory.capturedAt,
      rangeStatus: "out-of-range"
    });
    expect(result.status).toBe("available");
    expect(result.inventoryValueUsd).toBe(210);
    expect(result.rangeStatus).toBe("out-of-range");
  });

  it("rejects invalid amounts, prices, costs, and future timestamps", () => {
    expect(() => valueInventory({
      inventory: { ...inventory, amountX: -1 },
      now: inventory.capturedAt
    })).toThrow(/amountX/);
    expect(() => valueInventory({
      inventory: { ...inventory, tokenXPriceUsd: Number.NaN },
      now: inventory.capturedAt
    })).toThrow(/tokenXPriceUsd/);
    expect(() => valueInventory({
      inventory,
      now: inventory.capturedAt,
      feesUsd: { value: -1, evidence: "sourced" }
    })).toThrow(/feesUsd/);
    expect(() => valueInventory({
      inventory,
      now: "2026-10-20T10:00:00.000Z"
    })).toThrow(/future/);
  });
});

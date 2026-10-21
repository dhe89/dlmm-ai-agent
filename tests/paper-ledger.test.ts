import { describe, expect, it } from "vitest";
import { PaperLedger } from "../src/paper-ledger.js";

const openedAt = "2026-10-21T10:00:00.000Z";

describe("PaperLedger", () => {
  it("allocates capital and keeps equity unchanged when opening a position", () => {
    const ledger = new PaperLedger(1_000);
    ledger.openPosition({
      id: "pos-1",
      poolAddress: "pool-A",
      openedAt,
      initialCapitalUsd: 250,
      entryPoolPrice: 1.25
    });

    expect(ledger.summary()).toMatchObject({
      initialCapitalUsd: 1_000,
      cashUsd: 750,
      openPositionValueUsd: 250,
      equityUsd: 1_000,
      totalPnlUsd: 0,
      openPositions: 1,
      closedPositions: 0
    });
  });

  it("marks positions and separates unrealized from realized PnL", () => {
    const ledger = new PaperLedger(1_000);
    ledger.openPosition({
      id: "pos-1",
      poolAddress: "pool-A",
      openedAt,
      initialCapitalUsd: 250,
      entryPoolPrice: 1.25
    });

    ledger.markPosition("pos-1", "2026-10-21T11:00:00.000Z", 275);

    expect(ledger.summary()).toMatchObject({
      cashUsd: 750,
      openPositionValueUsd: 275,
      equityUsd: 1_025,
      realizedPnlUsd: 0,
      unrealizedPnlUsd: 25,
      totalPnlUsd: 25
    });
  });

  it("releases final value on close and records realized PnL exactly once", () => {
    const ledger = new PaperLedger(1_000);
    ledger.openPosition({
      id: "pos-1",
      poolAddress: "pool-A",
      openedAt,
      initialCapitalUsd: 250,
      entryPoolPrice: 1.25
    });
    ledger.markPosition("pos-1", "2026-10-21T11:00:00.000Z", 275);
    ledger.closePosition("pos-1", "2026-10-21T12:00:00.000Z", 270);

    expect(ledger.summary()).toMatchObject({
      cashUsd: 1_020,
      openPositionValueUsd: 0,
      equityUsd: 1_020,
      realizedPnlUsd: 20,
      unrealizedPnlUsd: 0,
      totalPnlUsd: 20,
      openPositions: 0,
      closedPositions: 1
    });
    expect(ledger.getEvents().map((event) => event.type)).toEqual([
      "position_opened",
      "position_marked",
      "position_closed"
    ]);
  });

  it("rejects duplicate positions, overspending, and closing a closed position", () => {
    const ledger = new PaperLedger(100);
    const position = {
      id: "pos-1",
      poolAddress: "pool-A",
      openedAt,
      initialCapitalUsd: 80,
      entryPoolPrice: 1
    };
    ledger.openPosition(position);

    expect(() => ledger.openPosition(position)).toThrow(/already exists/);
    expect(() => ledger.openPosition({
      ...position,
      id: "pos-2",
      initialCapitalUsd: 30
    })).toThrow(/insufficient paper cash/);

    ledger.closePosition("pos-1", "2026-10-21T11:00:00.000Z", 80);
    expect(() => ledger.closePosition("pos-1", "2026-10-21T12:00:00.000Z", 80))
      .toThrow(/already closed/);
  });

  it("rejects invalid values and out-of-order timestamps without changing the ledger", () => {
    const ledger = new PaperLedger(100);
    expect(() => new PaperLedger(0)).toThrow(/greater than zero/);
    expect(() => ledger.openPosition({
      id: "pos-1",
      poolAddress: "pool-A",
      openedAt,
      initialCapitalUsd: Number.NaN,
      entryPoolPrice: 1
    })).toThrow(/finite non-negative/);

    ledger.openPosition({
      id: "pos-1",
      poolAddress: "pool-A",
      openedAt,
      initialCapitalUsd: 50,
      entryPoolPrice: 1
    });
    expect(() => ledger.markPosition("pos-1", "2026-10-21T09:00:00.000Z", 60))
      .toThrow(/earlier than the previous/);
    expect(ledger.summary().equityUsd).toBe(100);
  });

  it("returns copies so callers cannot mutate ledger state", () => {
    const ledger = new PaperLedger(100);
    const position = ledger.openPosition({
      id: "pos-1",
      poolAddress: "pool-A",
      openedAt,
      initialCapitalUsd: 50,
      entryPoolPrice: 1
    });
    position.currentValueUsd = 999;

    expect(ledger.getPosition("pos-1")?.currentValueUsd).toBe(50);
  });
});

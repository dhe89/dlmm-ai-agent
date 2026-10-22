import { describe, expect, it } from "vitest";
import { buildPaperSignalJournalEntry } from "../src/strategy-signal-journal.js";

describe("buildPaperSignalJournalEntry", () => {
  const base = {
    poolAddress: "pool-A",
    capturedAt: "2026-10-22T10:00:00.000Z",
    fastWindow: 5,
    slowWindow: 20,
    decision: { signal: "LONG" as const, fastAverage: 2, slowAverage: 1.8, observations: 25 }
  };

  it("records the first observed signal as an initial transition", () => {
    expect(buildPaperSignalJournalEntry(base)).toMatchObject({
      previousSignal: null, changed: true, transition: "INITIAL", signal: "LONG"
    });
  });

  it("records an unchanged signal without inventing a transition", () => {
    expect(buildPaperSignalJournalEntry({ ...base, previousSignal: "LONG" })).toMatchObject({
      previousSignal: "LONG", changed: false, transition: "UNCHANGED"
    });
  });

  it("records a transition when the signal changes", () => {
    expect(buildPaperSignalJournalEntry({ ...base, previousSignal: "CASH" })).toMatchObject({
      previousSignal: "CASH", changed: true, transition: "CASH->LONG"
    });
  });

  it("validates pool, timestamp and windows", () => {
    expect(() => buildPaperSignalJournalEntry({ ...base, poolAddress: " " })).toThrow(/poolAddress/);
    expect(() => buildPaperSignalJournalEntry({ ...base, capturedAt: "invalid" })).toThrow(/timestamp/);
    expect(() => buildPaperSignalJournalEntry({ ...base, fastWindow: 20 })).toThrow(/greater than fastWindow/);
  });
});

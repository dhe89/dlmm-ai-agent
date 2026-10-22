export type PaperSignal = "LONG" | "CASH" | "WARMING_UP";

export interface PaperSignalDecision {
  signal: PaperSignal;
  fastAverage: number | null;
  slowAverage: number | null;
  observations: number;
}

export interface PaperSignalJournalEntry extends PaperSignalDecision {
  reportType: "paper-signal-transition";
  poolAddress: string;
  capturedAt: string;
  previousSignal: PaperSignal | null;
  changed: boolean;
  transition: string;
  fastWindow: number;
  slowWindow: number;
}

export function buildPaperSignalJournalEntry(input: {
  poolAddress: string;
  capturedAt: string;
  fastWindow: number;
  slowWindow: number;
  decision: PaperSignalDecision;
  previousSignal?: PaperSignal | null;
}): PaperSignalJournalEntry {
  if (!input.poolAddress.trim()) throw new Error("poolAddress must not be empty");
  if (!Number.isFinite(Date.parse(input.capturedAt))) throw new Error("capturedAt must be a valid timestamp");
  if (!Number.isInteger(input.fastWindow) || input.fastWindow < 1) throw new Error("fastWindow must be a positive integer");
  if (!Number.isInteger(input.slowWindow) || input.slowWindow <= input.fastWindow) throw new Error("slowWindow must be greater than fastWindow");
  const previousSignal = input.previousSignal ?? null;
  const changed = previousSignal !== input.decision.signal;
  const transition = previousSignal === null
    ? "INITIAL"
    : changed
      ? `${previousSignal}->${input.decision.signal}`
      : "UNCHANGED";
  return {
    reportType: "paper-signal-transition",
    poolAddress: input.poolAddress,
    capturedAt: input.capturedAt,
    fastWindow: input.fastWindow,
    slowWindow: input.slowWindow,
    ...input.decision,
    previousSignal,
    changed,
    transition
  };
}

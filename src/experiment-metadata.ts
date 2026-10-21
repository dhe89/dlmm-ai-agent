import { createHash } from "node:crypto";
import type { MarketSnapshot } from "./domain.js";

export interface SnapshotDataQuality {
  poolAddress: string;
  observations: number;
  firstCapturedAt: string;
  lastCapturedAt: string;
  minIntervalSeconds: number | null;
  medianIntervalSeconds: number | null;
  maxIntervalSeconds: number | null;
}

export interface ExperimentMetadata {
  inputSha256: string;
  dataQuality: SnapshotDataQuality;
}

/** Create stable provenance metadata for reproducible historical experiments. */
export function buildExperimentMetadata(
  rawInput: string,
  snapshots: readonly MarketSnapshot[]
): ExperimentMetadata {
  if (snapshots.length === 0) throw new Error("cannot create experiment metadata without snapshots");
  const ordered = snapshots.map(snapshot => ({ ...snapshot }))
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  const poolAddress = ordered[0]!.poolAddress;
  const times: number[] = [];
  for (const snapshot of ordered) {
    const timestamp = Date.parse(snapshot.capturedAt);
    if (!Number.isFinite(timestamp)) throw new Error("snapshot capturedAt must be valid");
    if (snapshot.poolAddress !== poolAddress) throw new Error("experiment metadata requires one pool");
    if (!Number.isFinite(snapshot.currentPrice) || snapshot.currentPrice <= 0) {
      throw new Error("snapshot currentPrice must be positive and finite");
    }
    times.push(timestamp);
  }
  const intervals = times.slice(1).map((time, index) => {
    const seconds = (time - times[index]!) / 1000;
    if (seconds <= 0) throw new Error("snapshot timestamps must be unique");
    return seconds;
  }).sort((a, b) => a - b);
  const median = intervals.length === 0 ? null :
    intervals.length % 2 === 1
      ? intervals[Math.floor(intervals.length / 2)]!
      : (intervals[intervals.length / 2 - 1]! + intervals[intervals.length / 2]!) / 2;

  return {
    inputSha256: createHash("sha256").update(rawInput, "utf8").digest("hex"),
    dataQuality: {
      poolAddress,
      observations: ordered.length,
      firstCapturedAt: ordered[0]!.capturedAt,
      lastCapturedAt: ordered.at(-1)!.capturedAt,
      minIntervalSeconds: intervals.length ? intervals[0]! : null,
      medianIntervalSeconds: median,
      maxIntervalSeconds: intervals.length ? intervals.at(-1)! : null
    }
  };
}

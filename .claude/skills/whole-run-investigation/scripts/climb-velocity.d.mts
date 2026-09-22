/** Declarations for `climb-velocity.mjs`. */
import type { BatteryReading, QueryRow, ReadOptions, Structure } from "../classifier/query-complexity.d.mts";

export interface Placement {
  rate: number;
  lo: number;
  hi: number;
}

export interface Counts {
  /** Verified cases whose verdict was true. Only these enter a rate. */
  passed: number;
  /** Cases an accepted artifact reached the correctness model for, passed or failed. */
  verified: number;
  /** The solver ran and submitted nothing the wall accepted. */
  unaccepted: number;
  nonResult: number;
}

export interface Battery {
  runId: string;
  dir: string;
  createdAt: string | null;
  claimed: boolean;
  reading: BatteryReading;
  counts: Counts;
  placement: Placement | null;
}

export interface Drift {
  /** Median relative movement over the public numbers both batteries carry at the same task. */
  median: number;
  moved: number;
}

/** Which correctness-model files outside `brief.json` and `tasks.json` changed digest. Names only:
 *  no verdict reads this, because a digest cannot separate a requirement from a comment. */
export interface SourceMoves {
  changed: string[];
  added: string[];
  removed: string[];
  unchanged: number;
  /** Files read in the later battery, the denominator `unchanged` counts against. */
  read: number;
}

export interface Edge {
  from: string;
  to: string;
  verdict: "restated" | "adjusted" | "narrowed" | "widened" | "eased" | "escalated";
  novelty: { mean: number; units: number } | null;
  drift: Drift;
  delta: Structure;
  /** Null when neither battery's bundle is on disk to digest. */
  source: SourceMoves | null;
  outcome: "unobservable" | { passed: number; verified: number; placement: Placement | null };
}

export interface VelocityReport {
  schema: string;
  campaign: string;
  model: Record<string, string | boolean>;
  batteries: Battery[];
  edges: Edge[];
}

/** A number only when two verified batteries supply a rate change; otherwise the reason there is none. */
export type Velocity =
  | { perBattery: number; rate: number; batteriesToBand: number }
  | { reason: string; rate?: number; perBattery?: number; toBand?: number };

export declare const VELOCITY_SCHEMA: string;
export declare const RESTATED_COSINE: number;
/** The two files the task-side rows already read, and so the two `sourceMovesOf` leaves alone. */
export declare const SCORED_BUNDLE_FILES: ReadonlySet<string>;

/** Every other correctness-model file of one version directory, with its digest. */
export declare function correctnessDigests(dir: string): Map<string, string>;
/** Which of those files moved between two version directories, or null when neither holds any. */
export declare function sourceMovesOf(beforeDir: string, afterDir: string): SourceMoves | null;

export declare function wilson(passes: number, n: number): Placement | null;
export declare function outcomesOf(campaign: string): Map<string, Counts>;
export declare function batteriesOf(
  campaign: string,
): { runId: string; dir: string; createdAt: string | null; claimed: boolean }[];
/** Reads only the two fields it compares, so a caller may hand it rows it built itself. */
export type DriftRows = { rows: Pick<QueryRow, "taskId" | "numerics">[] };
export declare function numericDriftOf(before: DriftRows, after: DriftRows): Drift;
export declare function readCampaign(campaign: string, options?: ReadOptions): Promise<VelocityReport>;
/** Reads each battery's verified count, and its placement only when that count is above zero. */
export declare function velocityOf(
  report: { batteries: { counts: Pick<Counts, "verified">; placement?: Placement | null }[] },
  band?: [number, number],
): Velocity;
/** The rank of the highest tier a battery's checks reach, or null when it declares none. */
export declare function topTierOf(checkTiers: Record<string, number>): number | null;
/** Reads the tier histograms and the structural deltas only, so a caller may hand it plain readings. */
export declare function verdictOf(
  before: { checkTiers: Record<string, number> },
  after: { checkTiers: Record<string, number> },
  novelty: { mean: number; units: number } | null,
  delta: Structure,
  drift: Drift,
): Edge["verdict"];
/** Ends with the newest edge's reading, which needs no measured battery. */
export declare function render(report: VelocityReport, band?: [number, number]): string;

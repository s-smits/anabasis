import type { JsonObject } from "#src/meta/json-shape.ts";

export interface WeeklyRun {
  key: string;
  projectId: string | undefined;
  runId: string | undefined;
  campaignId: string | undefined;
  lifecycle: string;
  invalid?: boolean;
  conflict?: boolean;
  copies?: string[];
  durationMinutes: number | null;
  archive: { synthesisPath: string };
  deterministic: {
    denominator: {
      total: number;
      verified: number;
      passed: number;
      failed: number;
      unaccepted: number;
      nonResults: number;
    };
    batteries: {
      total: number;
      verified: number;
      inBand: number;
      saturated: number;
      nonSaturated: number;
      nonSaturatedVerified: number;
      nonSaturatedFamilies: number;
    };
    movement: {
      candidatePromoted: number;
      climbPromoted: number;
      lastAuthoringOrdinal: number | null;
      submits: {
        compared: number | null;
        moved: number | null;
        stalled: number | null;
        unchangedTree: number | null;
      };
      iterationsMoved: number | null;
    };
    difficultyThresholds: { band: number[]; minLevelN: number };
    scanRuleIds: string[];
  };
}

export interface RankedRun extends WeeklyRun {
  seat: number;
  selectedBecause: string[];
}

export interface LunaTask {
  name: string;
  runKey: string | null;
  task: string;
}

export function weekWindow(input: { now: string; timeZone?: string; week?: string }): {
  timeZone: string;
  week: string;
  start: string;
  end: string;
  membership: string;
};

export function partitionByDuration<T extends WeeklyRun>(
  runs: T[],
  minDurationMinutes?: number,
): {
  completed: T[];
  durationInvalid: T[];
  short: T[];
  admitted: T[];
  unfinished: T[];
};

export function rankFinalists<T extends WeeklyRun>(
  runs: T[],
  top?: number,
): {
  selected: Array<T & RankedRun>;
  overflow: T[];
};

export function buildLunaPlan<T extends WeeklyRun>(selected: T[]): LunaTask[];
export function admittedLunaPlan<T extends WeeklyRun>(selected: T[], top?: number): LunaTask[];
export function deduplicateRuns<T extends WeeklyRun>(
  copies: T[],
): Array<
  T & {
    conflict: boolean;
    invalid: boolean;
    copies: string[];
  }
>;

export function bindSynthesis(run: WeeklyRun, entries?: Array<JsonObject>): JsonObject;

export function bindPublishedSyntheses<T extends WeeklyRun>(
  repo: string,
  selected: T[],
  census?: T[],
): Array<
  T & {
    synthesisFailure?: string;
  }
>;

export function deterministicFacts(input: {
  run: WeeklyRun;
  snapshotStatus: JsonObject;
  metrics: JsonObject;
  scan: JsonObject;
  scorecard: JsonObject;
}): JsonObject;

export function buildReport(input: JsonObject): JsonObject;
export const WEEKLY_SELECTION_SCHEMA: string;
export const DETERMINISTIC_CLI_VIEWS: readonly string[];

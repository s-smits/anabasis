#!/usr/bin/env bun
// How big is this run, and what did the deterministic read say. Two questions, one reader.
//
// `wri.ts scope` and `wri.ts brief` are its commands.
//
// The scope runs before the lanes and sizes the run from its own recorded bytes, so the read covers
// a fifteen-hour three-epoch run and a forty-minute probe differently without anyone guessing.
// The brief runs after them and renders one bounded digest of every capture, which is what a reader
// opens instead of the lane output: a lane short enough is quoted whole, a long one is pointed at.
// Nothing here decides anything. The tier picks a default lane set and names a starting number of
// paid lanes; `--lanes` and `--all` still select whatever the reader asks for.

import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { basename, join } from "#src/meta/path.ts";
import { isString, type JsonValue } from "#src/meta/json-shape.ts";
import { readEpochRecord } from "#src/author/campaign-epoch.ts";
import { TERMINAL_FILE } from "#src/run/controller-lineage.ts";
import { readCaseCounts } from "#tools/runs/evidence.ts";
import type { RunLocation } from "#tools/runs/discover.ts";
import { openRecordedRun } from "#skills/main/run.ts";
import {
  type DigestTrigger,
  jsonText,
  laneTriggers,
  OVERVIEW_FILE,
  readJsonAsOrNull,
  REVIEW_STATE_FILE,
  type ScanFinding,
  SNAPSHOT_STATUS_FILE,
} from "./run-overview.ts";
import { HARDWARE_TRIGGER } from "./hardware-target.ts";

export const BRIEF_SCHEMA = "wri-brief/v1";

/** A capture at or under this many lines is quoted whole; a longer one shows its head and its
 *  path. Every lane but `snapshot` came in under 60 lines across the recorded campaigns. */
export const LANE_LINES = 60;

export type Tier = "probe" | "standard" | "deep";

/** What sizes a run: its elapsed hours, its epochs, its batteries and whether any case scored. */
export interface ScopeSize {
  hours: number;
  epochs: number | null;
  batteries: number;
  scored: boolean;
}

/** The tier a run's size picks, with the lane set it starts from and why. */
export interface TierReading {
  tier: Tier;
  lanes: string[] | null;
  semanticLanes: number;
  why: string;
}

export interface CaseScope {
  verified: number;
  unaccepted: number;
  nonResult: number;
}

export interface BatteryScope extends CaseScope {
  battery: string;
}

/** One run's scope, as `wri.ts scope` prints it. */
export interface RunScope extends TierReading {
  schema: typeof BRIEF_SCHEMA;
  campaign: string;
  runId: string;
  startedAt: string | null;
  endedAt: string | null;
  live: boolean;
  hours: number;
  epochs: number | null;
  batteries: BatteryScope[];
  cases: CaseScope;
  terminal: { outcome: string; reason: string } | null;
  controllerError: string | null;
}

export interface ScopeOptions {
  now?: number;
}

export interface LaneSuggestion {
  lane: number;
  triggers: string[];
}

export interface LaneSuggestions {
  lanes: LaneSuggestion[];
  defaulted: boolean;
  sessions: string;
}

/** One step of the read, as `wri-review.json` records it. */
export interface BriefStep {
  label: string;
  ok?: boolean | null;
  exitCode?: number | null;
  skipped?: string;
  wrote?: string;
}

/** A view this read's snapshot needed and did not produce: the view with its recorded status, the
 *  status file itself when the snapshot left none readable, or the snapshot's exit when it failed
 *  with every view in place. */
export interface SnapshotGap {
  label: string;
  status: string;
}

/** `snapshot-status.json` as the brief reads it: each view, and whether the snapshot needs it. */
interface SnapshotViews {
  views?: { label?: JsonValue; status?: JsonValue; required?: JsonValue }[];
}

/** The overview as the brief reads it. */
interface OverviewFile {
  digestTriggers?: DigestTrigger[];
  scanFindings?: ScanFinding[];
}

/** `wri-review.json` as the brief reads it. A review recorded before the read resolved its
 *  measured checkout carries no reader and no scope, and is sized here. */
interface ReviewState {
  campaign: string;
  runId: string;
  repo?: string | null;
  chosen?: string;
  passed?: string[];
  scope?: RunScope;
  steps?: BriefStep[] | null;
}

/** The lanes that read recorded campaign bytes alone. The other five open the measured checkout or
 *  an archive, which is work worth doing once a battery has scored something. */
export const CAMPAIGN_LANES = [
  "climb",
  "yield",
  "posture",
  "timeline",
  "walls",
  "handoff",
  "gates",
  "target",
];

/** The lanes a tier launches when no digest trigger picks any. Each tier keeps the set below it
 *  and adds to it, so a deeper read never drops a question a shallower one would have asked. */
const PROBE_DEFAULT = [5, 8, 12, 25];
const STANDARD_DEFAULT = [...PROBE_DEFAULT, 1, 9, 14, 24];
export const DEFAULT_LANES = {
  probe: PROBE_DEFAULT,
  standard: STANDARD_DEFAULT,
  deep: [...STANDARD_DEFAULT, 2, 6, 10, 11, 13, 22],
};

/** The lanes every read of a tier opens, triggered or not, because the battery is the Builder's own
 *  exam whatever the digest says: whether it asks what the request asks, and what the Builder's
 *  reference and tools prove. No trigger can fire for a question every run leaves open. */
export const STANDING_LANES = {
  probe: [31, 34],
  standard: [31, 33, 34, 37],
  deep: [31, 32, 33, 34, 37],
};

/** How many semantic lanes each tier starts with, out of the lanes the catalogue declares: the
 *  default set and the standing lanes together. */
export const SEMANTIC_LANES = {
  probe: DEFAULT_LANES.probe.length + STANDING_LANES.probe.length,
  standard: DEFAULT_LANES.standard.length + STANDING_LANES.standard.length,
  deep: DEFAULT_LANES.deep.length + STANDING_LANES.deep.length,
};

/**
 * The semantic lanes each digest trigger starts, by the trigger's exact text before the first
 * colon. A trigger row the digest prints with a qualifier after that text still matches, because
 * the match is on the leading text. A trigger absent here is a lead with no lane of its own. A
 * suffixed trigger starts the lane its suffix names first, and may start a lane the catalogue added
 * after the suffix was written; an unsuffixed trigger names its lanes here alone.
 */
export const LANE_FOR_TRIGGER = new Map([
  ["VERSION TOOLCHAIN IS A SYMLINK (lane 2)", [2]],
  ["VERSION TOOLCHAIN DANGLING (lane 2)", [2, 35]],
  ["WRAPPER-ONLY TOOL DIGEST (lane 2)", [2]],
  ["UNTRIPPED IN SHIPPING", [5, 6]],
  ["PERFECT BATTERY OVER AIM (lane 5)", [5, 35]],
  ["REACH-ONLY CHECKS (lane 6)", [6]],
  ["REHEARSAL NOT-RUN (lane 9)", [9]],
  ["CLIMB FLAT (lane 10)", [10, 36]],
  // The digest of a run whose source predates the climb lane's CLIMB FLAT still prints this.
  ["OFF-AIM STREAK (lane 10)", [10, 36]],
  ["SUBMITTED BYTES NEVER REHEARSED (lane 11)", [11]],
  ["FINDINGS WITHOUT OWNER (lane 14)", [14]],
  ["ADVISORY FINDING RECURS UNROUTED (lane 14)", [14]],
  ["CENSUS WITH DISAGREEMENT (lane 16)", [16, 32]],
  ["REPEATED CONDITION (lane 20)", [20]],
  ["UNREACHED CHANGED SAFEGUARDS (lane 21)", [21]],
  ["MODEL-VISIBLE SURFACE CHANGED (lane 21)", [21]],
  ["CHECK TOOL IN SOLVER TRACE (lane 23)", [23]],
  ["CHECK CODE IN SOLVER REACH (lane 34)", [34, 23]],
  ["REVIEW TURNS EXCEED SOLVER TURNS (lane 24)", [24]],
  ["EXPLICIT ALLOWANCE WAIT (lane 24)", [24]],
  ["DECISION ON CENSORED BATTERY (lane 24)", [24]],
  ["MEMORY OVER READ CAP (lane 26)", [26]],
  ["GATE STALL (lane 27)", [27]],
  ["GATE CLEARED WITHOUT EDIT (lane 27)", [27]],
  ["BELOW-BAR GATE FIRED (lane 27)", [27]],
  ["UNLEDGERED REFUSAL CODE (lane 27)", [27]],
  ["REVIEW HOLD CHAIN (lane 27)", [27]],
  ["CEILING ENDED RUN (lane 27)", [27]],
  ["EVALUATION CORRECTION REPLAY CANDIDATE (lane 28)", [28]],
  ["FAMILY UNMOVED all-fail", [38]],
  [HARDWARE_TRIGGER, [29, 30]],
]);

/** The lanes a grouped trigger starts, empty when the catalogue starts none from it. */
export function lanesForTrigger(name: string): number[] {
  for (const [trigger, lanes] of LANE_FOR_TRIGGER) {
    if (name === trigger || name.startsWith(`${trigger} `)) return lanes;
  }
  return [];
}

/** This run's case counts by battery, through the shared case-count owner. A later battery's rows
 *  carry the run id with its canonical iteration suffix (`…-i02`), which `isControllerBatteryRunId`
 *  joins; the exact value names the battery. A torn record refuses the scope rather than sizing a run from part of it. */
function batteryRows(location: RunLocation): Map<string, CaseScope> {
  const counts = readCaseCounts(location);
  if (counts.unreadable !== null) throw new Error(`case record unreadable: ${counts.unreadable}`);
  return new Map(
    counts.batteries.map(({ runId: battery, tally }) => [
      battery,
      { verified: tally.verified, unaccepted: tally.unaccepted, nonResult: tally.nonResults },
    ]),
  );
}

/**
 * Which lanes to read and roughly how many paid lanes the run earns. A run whose batteries never
 * scored has nothing for the lanes that open the measured checkout, and a long multi-epoch run has
 * more distinct questions than a probe does. Both ends stay a default the reader can override.
 */
export function tierOf({ hours, epochs, batteries, scored }: ScopeSize): TierReading {
  if (!scored) {
    return {
      tier: "probe",
      lanes: CAMPAIGN_LANES,
      semanticLanes: SEMANTIC_LANES.probe,
      why: "no scored case yet, so the lanes that open the measured checkout have nothing to read",
    };
  }
  if (hours >= 12 || (epochs ?? 0) >= 3 || batteries >= 3) {
    return {
      tier: "deep",
      lanes: null,
      semanticLanes: SEMANTIC_LANES.deep,
      why: `${hours.toFixed(1)} h, ${epochs ?? "?"} epoch(s), ${batteries} batteries`,
    };
  }
  if (hours < 2) {
    return {
      tier: "probe",
      lanes: CAMPAIGN_LANES,
      semanticLanes: SEMANTIC_LANES.probe,
      why: `${hours.toFixed(1)} h of recorded run`,
    };
  }
  return {
    tier: "standard",
    lanes: null,
    semanticLanes: SEMANTIC_LANES.standard,
    why: `${hours.toFixed(1)} h, ${epochs ?? "?"} epoch(s), ${batteries} batteries`,
  };
}

/** Size one run from its opening, its epochs and its own case rows. A run with no terminal is
 *  live, and its elapsed time is measured to now, which is a reading of this moment. */
export function runScope(campaign: string, runId: string, { now = Date.now() }: ScopeOptions = {}): RunScope {
  const { opening, controller, controllerError, controllerDir, openingPath } = openRecordedRun(
    campaign,
    runId,
  );
  const startedAt = isString(opening.writtenAt) ? opening.writtenAt : null;
  const recorded = controller?.state === "recorded" ? controller : null;
  const endedAt = recorded?.writtenAt ?? null;
  const hours = ((endedAt === null ? now : Date.parse(endedAt)) - Date.parse(startedAt ?? "")) / 3_600_000;
  const batteries = batteryRows({
    runId,
    slug: basename(campaign),
    campaignDir: campaign,
    openingPath,
    terminalPath: join(controllerDir, TERMINAL_FILE),
  });
  const cases = { verified: 0, unaccepted: 0, nonResult: 0 };
  for (const counts of batteries.values()) {
    cases.verified += counts.verified;
    cases.unaccepted += counts.unaccepted;
    cases.nonResult += counts.nonResult;
  }
  const epochs = readEpochRecord(campaign)?.epochs.length ?? null;
  const scope = { hours, epochs, batteries: batteries.size, scored: cases.verified > 0 };
  return {
    schema: BRIEF_SCHEMA,
    campaign,
    runId,
    startedAt,
    endedAt,
    live: controller?.state === "unfinished",
    hours,
    epochs,
    batteries: [...batteries].map(([id, counts]) => ({ battery: id, ...counts })),
    cases,
    terminal: recorded === null ? null : { outcome: recorded.outcome, reason: recorded.terminalReason },
    controllerError,
    ...tierOf(scope),
  };
}

export function renderScope(scope: RunScope): string {
  const counts = `${scope.cases.verified} verified, ${scope.cases.unaccepted} unaccepted, ${scope.cases.nonResult} non-result`;
  const when = scope.live
    ? `live, ${scope.hours.toFixed(1)} h so far`
    : `ended after ${scope.hours.toFixed(1)} h`;
  const recordedEnd =
    scope.terminal === null
      ? "no terminal recorded"
      : `${scope.terminal.outcome ?? "?"} — ${scope.terminal.reason ?? "no reason recorded"}`;
  const end =
    scope.controllerError === null
      ? recordedEnd
      : `controller evidence refused by its strict reader: ${scope.controllerError}`;
  return [
    `${scope.runId}  [${scope.tier}]`,
    `  campaign ${scope.campaign}`,
    `  started ${scope.startedAt}, ${when}`,
    `  ${scope.epochs ?? "?"} campaign epoch(s), ${scope.batteries.length} batter(ies), ${counts}`,
    ...scope.batteries.map(
      (row) =>
        `    ${row.battery}: ${row.verified} verified, ${row.unaccepted} unaccepted, ${row.nonResult} non-result`,
    ),
    `  terminal: ${end}`,
    `  scope: ${scope.tier} — ${scope.why}`,
    `    lanes ${scope.lanes === null ? "all" : scope.lanes.join(",")}; about ${scope.semanticLanes} semantic lanes once this read names the questions`,
  ].join("\n");
}

/** The semantic lanes the grouped triggers start, each with the triggers that argue for it, in
 *  lane order, and the `launch --sessions` spec that names them. The tier's standing lanes join
 *  every spec as `standing (<tier>)`. When no trigger starts a lane the spec also names the tier's
 *  default set, and `defaulted` says so. */
export function laneSuggestions(triggers: readonly DigestTrigger[], tier: Tier): LaneSuggestions {
  const byLane = new Map<number, string[]>();
  for (const row of triggers) {
    for (const lane of lanesForTrigger(row.name)) byLane.set(lane, [...(byLane.get(lane) ?? []), row.name]);
  }
  const defaulted = byLane.size === 0;
  const standing = `standing (${tier})`;
  for (const lane of STANDING_LANES[tier]) byLane.set(lane, [...(byLane.get(lane) ?? []), standing]);
  const lanes = [...byLane.keys()].sort((a, b) => a - b);
  const sessions = defaulted ? [...new Set([...DEFAULT_LANES[tier], ...lanes])].sort((a, b) => a - b) : lanes;
  return {
    // Every lane listed is a key of the map, so the fallback never applies.
    lanes: lanes.map((lane) => ({ lane, triggers: byLane.get(lane) ?? [] })),
    defaulted,
    sessions: sessions.join(","),
  };
}

/**
 * What the snapshot lane this review recorded failed to produce, in the order it lists its views:
 * every view it needs that did not come out `ok`, or its status file when that is absent or torn,
 * or its exit when it failed with every view in place. Empty when the review read no snapshot, or
 * read it whole. A view the snapshot marks `required: false` is the overview's to list, and no gap.
 */
export function snapshotGaps(reviewDir: string, steps: readonly BriefStep[]): SnapshotGap[] {
  const snapshot = steps.find((row) => row.label === "snapshot");
  if (snapshot === undefined || snapshot.skipped !== undefined) return [];
  const path = join(reviewDir, "snapshot", SNAPSHOT_STATUS_FILE);
  if (!existsSync(path)) return [{ label: SNAPSHOT_STATUS_FILE, status: "absent" }];
  const views = readJsonAsOrNull<SnapshotViews | null>(path)?.views;
  if (!Array.isArray(views)) return [{ label: SNAPSHOT_STATUS_FILE, status: "unreadable" }];
  const gaps = views
    .filter((view) => view.status !== "ok" && view.required !== false)
    .map((view) => ({ label: jsonText(view.label ?? null), status: jsonText(view.status ?? null) }));
  if (gaps.length > 0 || snapshot.ok === true) return gaps;
  return [{ label: "snapshot", status: `exit ${snapshot.exitCode ?? "?"}` }];
}

/** The gap that keeps `view`'s leads out of this brief: the view's own, or the status file's. */
const gapOf = (gaps: readonly SnapshotGap[], view: string): SnapshotGap | undefined =>
  gaps.find((gap) => gap.label === view || gap.label === SNAPSHOT_STATUS_FILE);

/** The leads by name and count. A lead whose snapshot view is missing says so in place of its rows,
 *  so a failed digest never reads as a digest that raised nothing. */
function flagged(
  triggers: readonly DigestTrigger[],
  findings: readonly ScanFinding[],
  missing: { digest: SnapshotGap | undefined; scan: SnapshotGap | undefined },
): string {
  const rules = new Map<JsonValue | undefined, number>();
  for (const finding of findings) rules.set(finding.rule, (rules.get(finding.rule) ?? 0) + 1);
  const skipped = (name: string, gap: SnapshotGap | undefined): string[] =>
    gap === undefined ? [] : [`  ${name}: skipped: snapshot view ${gap.label} ${gap.status}`];
  const quiet =
    triggers.length + rules.size === 0 && missing.digest === undefined && missing.scan === undefined;
  return [
    "== flagged by the deterministic lanes",
    ...skipped("digest", missing.digest),
    ...triggers.map(
      (row) =>
        `  digest ${row.name} x${row.rows}${row.examples[0] === undefined ? "" : `: ${row.examples[0]}`}`,
    ),
    ...skipped("scan", missing.scan),
    ...[...rules].map(([rule, count]) => `  scan ${rule === undefined ? rule : jsonText(rule)} x${count}`),
    ...(quiet ? ["  no digest trigger or scan finding"] : []),
  ].join("\n");
}

/** The digest's own capitalised trigger rows, the in-process lanes' trigger rows and the scan
 *  findings, by name and count, then the lanes those triggers start. All are leads a deterministic
 *  lane already produced; the brief repeats none of its reasoning. A snapshot view this read did
 *  not produce contributes no stale rows from an earlier read, only the line that says it failed. */
function pressing(
  reviewDir: string,
  scope: RunScope,
  steps: readonly BriefStep[],
  gaps: readonly SnapshotGap[],
): string[] {
  const overview = readJsonAsOrNull<OverviewFile | null>(join(reviewDir, OVERVIEW_FILE));
  const fromLanes = laneTriggers(reviewDir, steps);
  if (overview === null && fromLanes.length === 0 && gaps.length === 0) return [];
  const missing = { digest: gapOf(gaps, "digest"), scan: gapOf(gaps, `${scope.runId}-scan`) };
  const triggers = [
    ...(missing.digest === undefined && Array.isArray(overview?.digestTriggers)
      ? overview.digestTriggers
      : []),
    ...fromLanes,
  ];
  const findings =
    missing.scan === undefined && Array.isArray(overview?.scanFindings) ? overview.scanFindings : [];
  const { tier } = scope;
  const suggested = laneSuggestions(triggers, tier);
  return [
    flagged(triggers, findings, missing),
    [
      "== lanes the triggers start",
      ...suggested.lanes.map((row) => `  lane ${row.lane}: ${row.triggers.join("; ")}`),
      ...(suggested.defaulted
        ? [
            `  no trigger starts a lane; the ${tier} default set with its standing lanes is ${suggested.sessions}`,
          ]
        : []),
      `  launch --sessions ${suggested.sessions}`,
    ].join("\n"),
  ];
}

/** One bounded block per lane the read ran, plus the skips and failures, which are facts about the
 *  read rather than about the run. */
function laneBlocks(reviewDir: string, steps: readonly BriefStep[]): string[] {
  const blocks: string[] = [];
  for (const step of steps) {
    const capture = join(reviewDir, `${step.label}.txt`);
    if (step.skipped !== undefined) {
      blocks.push(`== ${step.label}\n  skipped: ${step.skipped}`);
      continue;
    }
    if (!existsSync(capture)) {
      blocks.push(
        `== ${step.label}\n  ${step.ok === true ? (step.wrote ?? "ran") : `failed with exit ${step.exitCode}`}`,
      );
      continue;
    }
    const lines = readFileSync(capture, "utf8").replace(/\n+$/, "").split("\n");
    const failed = (step.exitCode ?? null) === null ? "failed" : `exit ${step.exitCode}`;
    const head = step.ok === true ? "" : `  (${failed}; read below as far as it got)\n`;
    const body =
      lines.length <= LANE_LINES
        ? lines.join("\n")
        : `${lines.slice(0, LANE_LINES).join("\n")}\n  … ${lines.length - LANE_LINES} more lines in ${capture}`;
    blocks.push(`== ${step.label}  (${lines.length} lines)\n${head}${body}`);
  }
  return blocks;
}

export function renderBrief(reviewDir: string): string {
  const state = readJsonAsOrNull<ReviewState | null>(join(reviewDir, REVIEW_STATE_FILE));
  if (state === null) {
    throw new Error(`no ${REVIEW_STATE_FILE} under ${reviewDir}; run \`wri.ts read\` first`);
  }
  const scope = state.scope ?? runScope(state.campaign, state.runId);
  const readers =
    state.repo === undefined || state.repo === null
      ? []
      : [
          `  readers ${state.repo} (${state.chosen ?? "--repo"})`,
          ...(state.passed ?? []).map((reason) => `    passed over ${reason}`),
        ];
  const steps = state.steps ?? [];
  const gaps = snapshotGaps(reviewDir, steps);
  // A failed view heads the brief, before any lane, so no reader takes a partial read for a whole one.
  const incomplete =
    gaps.length === 0
      ? []
      : [
          [
            "== SNAPSHOT INCOMPLETE",
            ...gaps.map((gap) => `  ${gap.label}: ${gap.status}`),
            "  every lane that does not read these views was read; the ones that do say so below",
          ].join("\n"),
        ];
  return [
    [renderScope(scope), ...readers].join("\n"),
    ...incomplete,
    "",
    ...laneBlocks(reviewDir, steps),
    "",
    ...pressing(reviewDir, scope, steps, gaps),
  ].join("\n\n");
}

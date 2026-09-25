#!/usr/bin/env bun
// How big is this run, and what did the deterministic read say. Two questions, one reader.
//
// `wri.mjs scope` and `wri.mjs brief` are its commands.
//
// The scope runs before the lanes and sizes the run from its own recorded bytes, so the read covers
// a fifteen-hour three-epoch run and a forty-minute probe differently without anyone guessing.
// The brief runs after them and renders one bounded digest of every capture, which is what a reader
// opens instead of the lane output: a lane short enough is quoted whole, a long one is pointed at.
// Nothing here decides anything. The tier picks a default lane set and names a starting number of
// paid lanes; `--lanes` and `--all` still select whatever the reader asks for.

import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { readJsonFileOrNull } from "#src/meta/completed-json.ts";
import { readEpochRecord } from "#src/author/campaign-epoch.ts";
import { readCaseCounts } from "#tools/runs/evidence.ts";
import { openRecordedRun } from "#skills/main/run.ts";

export const BRIEF_SCHEMA = "wri-brief/v1";

/** A capture at or under this many lines is quoted whole; a longer one shows its head and its
 *  path. Every lane but `snapshot` came in under 60 lines across the recorded campaigns. */
export const LANE_LINES = 60;

/** The lanes that read recorded campaign bytes alone. The other five open the measured checkout or
 *  an archive, which is work worth doing once a battery has scored something. */
export const CAMPAIGN_LANES = ["climb", "yield", "posture", "timeline", "walls", "handoff"];

/** How many semantic lanes each tier starts with, out of the 26 the catalogue declares. */
export const SEMANTIC_LANES = { probe: 4, standard: 8, deep: 14 };

/** The lanes a tier launches when no digest trigger picks any. Each tier keeps the set below it
 *  and adds to it, so a deeper read never drops a question a shallower one would have asked. */
const PROBE_DEFAULT = [5, 8, 12, 25];
const STANDARD_DEFAULT = [...PROBE_DEFAULT, 1, 9, 14, 24];
export const DEFAULT_LANES = {
  probe: PROBE_DEFAULT,
  standard: STANDARD_DEFAULT,
  deep: [...STANDARD_DEFAULT, 2, 6, 10, 11, 13, 22],
};

/**
 * The semantic lanes each digest trigger starts, by the trigger's exact text before the first
 * colon. A trigger row the digest prints with a qualifier after that text still matches, because
 * the match is on the leading text. A trigger absent here is a lead with no lane of its own. Every
 * suffixed trigger names its own lane; the one unsuffixed trigger argues for two.
 */
export const LANE_FOR_TRIGGER = new Map([
  ["VERSION TOOLCHAIN IS A SYMLINK (lane 2)", [2]],
  ["VERSION TOOLCHAIN DANGLING (lane 2)", [2]],
  ["WRAPPER-ONLY TOOL DIGEST (lane 2)", [2]],
  ["UNTRIPPED IN SHIPPING", [5, 6]],
  ["PERFECT BATTERY OVER AIM (lane 5)", [5]],
  ["REACH-ONLY CHECKS (lane 6)", [6]],
  ["REHEARSAL NOT-RUN (lane 9)", [9]],
  ["OFF-AIM STREAK (lane 10)", [10]],
  ["TARGET MISSED (lane 10)", [10]],
  ["SUBMITTED BYTES NEVER REHEARSED (lane 11)", [11]],
  ["REHEARSAL CONTRADICTS TARGET (lane 11)", [11]],
  ["FINDINGS WITHOUT OWNER (lane 14)", [14]],
  ["ADVISORY FINDING RECURS UNROUTED (lane 14)", [14]],
  ["CENSUS WITH DISAGREEMENT (lane 16)", [16]],
  ["REPEATED CONDITION (lane 20)", [20]],
  ["UNREACHED CHANGED SAFEGUARDS (lane 21)", [21]],
  ["MODEL-VISIBLE SURFACE CHANGED (lane 21)", [21]],
  ["CHECK TOOL IN SOLVER TRACE (lane 23)", [23]],
  ["REVIEW TURNS EXCEED SOLVER TURNS (lane 24)", [24]],
  ["EXPLICIT ALLOWANCE WAIT (lane 24)", [24]],
  ["DECISION ON CENSORED BATTERY (lane 24)", [24]],
  ["MEMORY OVER READ CAP (lane 26)", [26]],
]);

/** The lanes a grouped trigger starts, empty when the catalogue starts none from it. */
export function lanesForTrigger(name) {
  for (const [trigger, lanes] of LANE_FOR_TRIGGER) {
    if (name === trigger || name.startsWith(`${trigger} `)) return lanes;
  }
  return [];
}

/** This run's case counts by battery, through the shared case-count owner. A later battery's rows
 *  carry the run id with its canonical iteration suffix (`…-i02`), which `isControllerBatteryRunId`
 *  joins; the exact value names the battery. A torn record refuses the scope rather than sizing a run from part of it. */
function batteryRows(campaign, runId) {
  const counts = readCaseCounts({ campaignDir: campaign, runId });
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
export function tierOf({ hours, epochs, batteries, scored }) {
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
export function runScope(campaign, runId, { now = Date.now() } = {}) {
  const { opening, controller, controllerError } = openRecordedRun(campaign, runId);
  const startedAt = typeof opening.writtenAt === "string" ? opening.writtenAt : null;
  const recorded = controller?.state === "recorded" ? controller : null;
  const endedAt = recorded?.writtenAt ?? null;
  const hours = ((endedAt === null ? now : Date.parse(endedAt)) - Date.parse(startedAt ?? "")) / 3_600_000;
  const batteries = batteryRows(campaign, runId);
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

export function renderScope(scope) {
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
 *  lane order, and the `launch --sessions` spec that names them. When no trigger starts a lane the
 *  spec names the tier's default set instead, and `defaulted` says so. */
export function laneSuggestions(triggers, tier) {
  const byLane = new Map();
  for (const row of triggers) {
    for (const lane of lanesForTrigger(row.name)) byLane.set(lane, [...(byLane.get(lane) ?? []), row.name]);
  }
  const lanes = [...byLane.keys()].sort((a, b) => a - b);
  const defaulted = lanes.length === 0;
  const sessions = defaulted ? [...DEFAULT_LANES[tier]].sort((a, b) => a - b) : lanes;
  return {
    lanes: lanes.map((lane) => ({ lane, triggers: byLane.get(lane) })),
    defaulted,
    sessions: sessions.join(","),
  };
}

/** The digest's own capitalised trigger rows and the scan findings, by name and count, then the
 *  lanes those triggers start. All are leads the snapshot lane already produced; the brief repeats
 *  none of its reasoning. */
function pressing(reviewDir, tier) {
  const overview = readJsonFileOrNull(join(reviewDir, "overview.json"));
  if (overview === null) return [];
  const triggers = Array.isArray(overview.digestTriggers) ? overview.digestTriggers : [];
  const findings = Array.isArray(overview.scanFindings) ? overview.scanFindings : [];
  const rules = new Map();
  for (const finding of findings) rules.set(finding.rule, (rules.get(finding.rule) ?? 0) + 1);
  const suggested = laneSuggestions(triggers, tier);
  return [
    [
      "== flagged by the snapshot lane",
      ...triggers.map(
        (row) =>
          `  digest ${row.name} x${row.rows}${row.examples[0] === undefined ? "" : `: ${row.examples[0]}`}`,
      ),
      ...[...rules].map(([rule, count]) => `  scan ${rule} x${count}`),
      ...(triggers.length + rules.size === 0 ? ["  no digest trigger or scan finding"] : []),
    ].join("\n"),
    [
      "== lanes the triggers start",
      ...suggested.lanes.map((row) => `  lane ${row.lane}: ${row.triggers.join("; ")}`),
      ...(suggested.defaulted
        ? [`  no trigger starts a lane; the ${tier} default set is ${suggested.sessions}`]
        : []),
      `  launch --sessions ${suggested.sessions}`,
    ].join("\n"),
  ];
}

/** One bounded block per lane the read ran, plus the skips and failures, which are facts about the
 *  read rather than about the run. */
function laneBlocks(reviewDir, steps) {
  const blocks = [];
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
    const head = step.ok === true ? "" : `  (exit ${step.exitCode}; read below as far as it got)\n`;
    const body =
      lines.length <= LANE_LINES
        ? lines.join("\n")
        : `${lines.slice(0, LANE_LINES).join("\n")}\n  … ${lines.length - LANE_LINES} more lines in ${capture}`;
    blocks.push(`== ${step.label}  (${lines.length} lines)\n${head}${body}`);
  }
  return blocks;
}

export function renderBrief(reviewDir) {
  const state = readJsonFileOrNull(join(reviewDir, "wri-review.json"));
  if (state === null) throw new Error(`no wri-review.json under ${reviewDir}; run \`wri.mjs read\` first`);
  const scope = runScope(state.campaign, state.runId);
  return [
    renderScope(scope),
    "",
    ...laneBlocks(reviewDir, state.steps ?? []),
    "",
    ...pressing(reviewDir, scope.tier),
  ].join("\n\n");
}

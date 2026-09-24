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

/** The lanes that read recorded campaign bytes alone. The other six open the measured checkout or
 *  an archive, which is work worth doing once a battery has scored something. */
export const CAMPAIGN_LANES = ["climb", "yield", "posture", "timeline", "walls"];

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
      semanticLanes: 2,
      why: "no scored case yet, so the lanes that open the measured checkout have nothing to read",
    };
  }
  if (hours >= 12 || (epochs ?? 0) >= 3 || batteries >= 3) {
    return {
      tier: "deep",
      lanes: null,
      semanticLanes: 8,
      why: `${hours.toFixed(1)} h, ${epochs ?? "?"} epoch(s), ${batteries} batteries`,
    };
  }
  if (hours < 2) {
    return {
      tier: "probe",
      lanes: CAMPAIGN_LANES,
      semanticLanes: 2,
      why: `${hours.toFixed(1)} h of recorded run`,
    };
  }
  return {
    tier: "standard",
    lanes: null,
    semanticLanes: 4,
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

/** The digest's own capitalised trigger rows and the scan findings, by name and count. Both are
 *  leads the snapshot lane already produced; the brief repeats neither's reasoning. */
function pressing(reviewDir) {
  const overview = readJsonFileOrNull(join(reviewDir, "overview.json"));
  if (overview === null) return [];
  const triggers = Array.isArray(overview.digestTriggers) ? overview.digestTriggers : [];
  const findings = Array.isArray(overview.scanFindings) ? overview.scanFindings : [];
  const rules = new Map();
  for (const finding of findings) rules.set(finding.rule, (rules.get(finding.rule) ?? 0) + 1);
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
    ...pressing(reviewDir),
  ].join("\n\n");
}

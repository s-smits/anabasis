#!/usr/bin/env bun
// How big is this run, and what did the deterministic read say. Two questions, one reader.
//
//   bun brief.mjs scope <campaign dir> --run <runId> [--json]
//   bun brief.mjs show  --out <absolute review dir>
//
// `scope` runs before the lanes and sizes the run from its own recorded bytes, so the read covers
// a fifteen-hour three-epoch run and a forty-minute probe differently without anyone guessing.
// `show` runs after them and renders one bounded digest of every capture, which is what a reader
// opens instead of the lane output: a lane short enough is quoted whole, a long one is pointed at.
// Nothing here decides anything. The tier picks a default lane set and names a starting number of
// paid lanes; `--lanes` and `--all` still select whatever the reader asks for.

import { existsSync, readFileSync, readdirSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { isAbsolute, join, resolve } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { readJsonFileOrNull } from "#src/meta/completed-json.ts";

export const BRIEF_SCHEMA = "wri-brief/v1";

/** A capture at or under this many lines is quoted whole; a longer one shows its head and its
 *  path. Every lane but `snapshot` came in under 60 lines across the recorded campaigns. */
export const LANE_LINES = 60;

/** The lanes that read recorded campaign bytes alone. The other six open the measured checkout or
 *  an archive, which is work worth doing once a battery has scored something. */
export const CAMPAIGN_LANES = ["climb", "yield", "posture", "timeline", "walls"];

/** The recorded kind of one case row, in the closed order AGENTS.md sets: a typed environment
 *  failure first, then an attempt that reached no accepted submission, then a scored case. */
export function caseKind(row) {
  if (row.runtimeNonResult === true) return "nonResult";
  if (row.truthOk === null || row.truthOk === undefined) return "unaccepted";
  return "verified";
}

/** Case rows this run owns, by battery. A later battery's rows carry the run id with its own
 *  suffix (`…-i02`), so the prefix is the join and the exact value names the battery. */
function batteryRows(campaign, runId) {
  const path = join(campaign, "case-record.jsonl");
  if (!existsSync(path)) return new Map();
  const batteries = new Map();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const row = asRecord(capturedJsonParse(line)?.row);
    if (!row || !isString(row.runId) || !row.runId.startsWith(runId)) continue;
    const found = batteries.get(row.runId) ?? { verified: 0, unaccepted: 0, nonResult: 0 };
    found[caseKind(row)] += 1;
    batteries.set(row.runId, found);
  }
  return batteries;
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
  const dir = join(campaign, "controller", runId);
  const opening = readJsonFileOrNull(join(dir, "opening.json"));
  if (opening === null) throw new Error(`no readable opening.json under ${dir}`);
  const terminal = readJsonFileOrNull(join(dir, "terminal.json"));
  const startedMs = Date.parse(opening.writtenAt ?? "");
  const endedAt = terminal === null ? null : (terminal.writtenAt ?? null);
  const hours = ((endedAt === null ? now : Date.parse(endedAt)) - startedMs) / 3_600_000;
  const batteries = batteryRows(campaign, runId);
  const cases = { verified: 0, unaccepted: 0, nonResult: 0 };
  for (const counts of batteries.values()) {
    cases.verified += counts.verified;
    cases.unaccepted += counts.unaccepted;
    cases.nonResult += counts.nonResult;
  }
  const listedEpochs = readJsonFileOrNull(join(campaign, "epochs.json"))?.epochs;
  const epochs = Array.isArray(listedEpochs) ? listedEpochs.length : null;
  const scope = { hours, epochs, batteries: batteries.size, scored: cases.verified > 0 };
  return {
    schema: BRIEF_SCHEMA,
    campaign,
    runId,
    startedAt: opening.writtenAt ?? null,
    endedAt,
    live: endedAt === null,
    hours,
    epochs,
    batteries: [...batteries].map(([id, counts]) => ({ battery: id, ...counts })),
    cases,
    terminal:
      terminal === null
        ? null
        : { outcome: terminal.outcome ?? null, reason: terminal.terminalReason ?? null },
    ...tierOf(scope),
  };
}

export function renderScope(scope) {
  const counts = `${scope.cases.verified} verified, ${scope.cases.unaccepted} unaccepted, ${scope.cases.nonResult} non-result`;
  const when = scope.live
    ? `live, ${scope.hours.toFixed(1)} h so far`
    : `ended after ${scope.hours.toFixed(1)} h`;
  const end =
    scope.terminal === null
      ? "no terminal recorded"
      : `${scope.terminal.outcome ?? "?"} — ${scope.terminal.reason ?? "no reason recorded"}`;
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

/** The review directories under a root, newest first, for a reader who kept several. */
export function reviewsUnder(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => existsSync(join(root, name, "wri-review.json")))
    .sort()
    .toReversed();
}

function main() {
  const [command, ...rest] = Bun.argv.slice(2);
  const positional = rest[0] !== undefined && !rest[0].startsWith("--") ? rest.shift() : null;
  const value = (name) => {
    const index = rest.indexOf(`--${name}`);
    return index === -1 ? null : (rest[index + 1] ?? null);
  };
  if (command === "scope" && positional !== null) {
    const scope = runScope(resolve(positional), value("run") ?? "");
    console.log(rest.includes("--json") ? JSON.stringify(scope, null, 2) : renderScope(scope));
    return;
  }
  if (command === "show") {
    const out = value("out");
    if (out === null || !isAbsolute(out)) throw new Error("--out must be an absolute review directory");
    console.log(renderBrief(resolve(out)));
    return;
  }
  console.error(
    "usage: brief.mjs scope <campaign dir> --run <runId> [--json] | brief.mjs show --out <absolute review dir>",
  );
  runtimeProcess.exit(2);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(`brief: ${errorMessage(error)}`);
    runtimeProcess.exit(1);
  }
}

// What each slot of a run was doing along the run clock, and where it stopped making progress.
//
// `posture` already answers "which posture dominated this session, and does the corpus say that
// posture precedes a refusal". This asks a different question: at which minute, in which recorded
// phase, did a slot lose the thread. Three slots reach one clock by three routes, none of them a
// guess and none of them an order join:
//
//   builder  a prose row's `atMs` is relative to its own session. The session's absolute start is
//            its execution record's last write minus how long it ran, which `prose-input.mjs`
//            publishes as `startedMs`.
//   built    a solve turn carries a turn number and no timestamp. A solver unit is therefore placed
//            by its case's recorded solve window and never claims a minute inside it.
//   review   an authoring review's id is a UUIDv7 minted when that review started, so the identity
//            carries the time. Each review is attributed to the Builder session whose window
//            contains it; one that falls in no session window stays unattributed.
//
// Classification has one owner, `prose-classify.mjs`. This module places its units on the clock and
// runs its consecutive-stretch detector; it decides no pass, sets no score and states no cause.
// The review slot is read for repetition rather than posture: the thirteen anchors were written for
// authoring prose, and a reviewer restating a finding nobody acted on is the reading that matters
// there.
//
//   bun run-narrative.mjs <campaign dir> --run <runId> [--json] [--out <file>]
import { existsSync, readdirSync } from "#src/meta/filesystem.ts";
import { join, resolve } from "#src/meta/path.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import {
  DEFAULTS,
  DRIFT_RUN,
  classifyTarget,
  consecutive,
  cosine,
  driftRuns,
  modelEmbed,
} from "./prose-classify.mjs";
import { isString } from "#src/meta/json-shape.ts";
import { readJsonFile, writeJsonFile } from "#src/meta/completed-json.ts";

export const NARRATIVE_SCHEMA = "wri-run-narrative/v1";
/** Two finding claims at or above this cosine say the same thing in different words. Measured on
 *  campaign 3fd52f9e-4: 54 claims, 1264 cross-review pairs, median 0.636 and p95 0.843, so
 *  unrelated findings are nowhere near. Every one of the six highest pairs is the same defect
 *  restated — the same rounding, the same unenforced `jointCandidates`, the same writer that cannot
 *  carry the design — and they run from 0.939 to 0.970. A 0.97 cut caught one of the six; 0.93
 *  catches all six and admits 12 pairs in 1264, so the rare false positive is a review to read, not
 *  a decision. */
export const RESTATED_COSINE = 0.93;
const AUTHORING_RE =
  /^authoring-([0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-epoch-review\.json$/i;

const VALUE_FLAGS = new Set(["--run", "--out", "--min-margin", "--drift-run"]);

const stamp = (ms) => (ms === null ? null : new Date(ms).toISOString());

/** The millisecond a UUIDv7 was minted, which is its leading 48 bits. */
export function uuidV7Ms(uuid) {
  const hex = uuid.replace(/-/g, "");
  return Number.parseInt(hex.slice(0, 12), 16);
}

function dominant(units) {
  const counts = new Map();
  for (const unit of units) counts.set(unit.class, (counts.get(unit.class) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null;
}

/** One stretch, carrying where it sits rather than what caused it. `atMs` is the first unit's own
 *  time when the slot has one, and the window's start when it does not. */
function stretch(found, units, where, slot, window) {
  const first = units[found.from];
  const last = units[found.to];
  return {
    slot,
    where,
    kind: found.kind,
    length: found.length,
    classes: found.classes,
    from: { sequence: first.sequence ?? null, turn: first.turn ?? null, atMs: first.atMs ?? null },
    to: { sequence: last.sequence ?? null, turn: last.turn ?? null, atMs: last.atMs ?? null },
    atMs: first.atMs ?? window.startedMs ?? null,
    window,
  };
}

/** Builder prose, grouped by authoring session and placed by that session's absolute start. */
function builderSlot(posture, run) {
  const captures = new Map(
    posture.input.captures.map((capture) => [`${capture.epoch}\u0000${capture.session}`, capture]),
  );
  const groups = new Map();
  for (const row of posture.rows) {
    const key = `${row.epoch}\u0000${row.session}`;
    const capture = captures.get(key);
    const startedMs = capture?.startedMs ?? null;
    const group = groups.get(key) ?? {
      epoch: row.epoch,
      session: row.session,
      where: `${row.epoch}/s${String(row.session).padStart(2, "0")}`,
      anchor: startedMs === null ? "unanchored" : "execution-record",
      startedMs,
      endedMs: capture?.endedMs ?? null,
      units: [],
    };
    group.units.push({
      sequence: row.sequence,
      turn: row.turn,
      offsetMs: row.atMs,
      atMs: startedMs === null ? null : startedMs + row.atMs,
      kind: row.kind,
      class: row.class,
      margin: row.margin,
      lowMargin: row.lowMargin,
    });
    groups.set(key, group);
  }
  const sessions = [...groups.values()].sort((a, b) => (a.startedMs ?? 0) - (b.startedMs ?? 0));
  const drift = [];
  for (const session of sessions) {
    session.dominant = dominant(session.units);
    session.drift = driftRuns(session.units, { run });
    for (const found of session.drift) {
      drift.push(
        stretch(found, session.units, session.where, "builder", {
          startedMs: session.startedMs,
          endedMs: session.endedMs,
        }),
      );
    }
  }
  return { sessions, units: sessions.reduce((sum, session) => sum + session.units.length, 0), drift };
}

/** Solver prose, grouped by case. A turn has no recorded time, so the case window is the placement
 *  and the turn number is the location inside it. */
function builtSlot(posture, run) {
  if (posture.solves === null) return { cases: [], units: 0, drift: [] };
  const windows = new Map((posture.solveInput.cases ?? []).map((entry) => [entry.taskId, entry]));
  const groups = new Map();
  for (const row of posture.solveRows) {
    const group = groups.get(row.taskId) ?? {
      taskId: row.taskId,
      family: row.family,
      outcome: row.outcome,
      units: [],
    };
    group.units.push({
      sequence: null,
      turn: row.turn,
      atMs: null,
      kind: row.kind,
      class: row.class,
      margin: row.margin,
      lowMargin: row.lowMargin,
    });
    groups.set(row.taskId, group);
  }
  const cases = [...groups.values()]
    .map((group) => {
      const entry = windows.get(group.taskId);
      const startedMs = Date.parse(entry?.startedAt ?? "");
      const endedMs = Date.parse(entry?.endedAt ?? "");
      return {
        ...group,
        startedMs: Number.isFinite(startedMs) ? startedMs : null,
        endedMs: Number.isFinite(endedMs) ? endedMs : null,
      };
    })
    .sort((a, b) => (a.startedMs ?? 0) - (b.startedMs ?? 0));
  const drift = [];
  for (const entry of cases) {
    entry.dominant = dominant(entry.units);
    entry.drift = driftRuns(entry.units, { run });
    for (const found of entry.drift) {
      drift.push(
        stretch(found, entry.units, entry.taskId, "built", {
          startedMs: entry.startedMs,
          endedMs: entry.endedMs,
        }),
      );
    }
  }
  return { cases, units: cases.reduce((sum, entry) => sum + entry.units.length, 0), drift };
}

function reviewRecords(campaign, sessions) {
  const dir = join(campaign, "analysis");
  if (!existsSync(dir)) return [];
  const records = [];
  for (const name of readdirSync(dir)) {
    const match = AUTHORING_RE.exec(name);
    if (match === null) continue;
    const atMs = uuidV7Ms(match[1]);
    const owner = sessions.find(
      (session) =>
        session.startedMs !== null &&
        session.endedMs !== null &&
        atMs >= session.startedMs &&
        atMs <= session.endedMs,
    );
    if (owner === undefined) continue;
    const value = readJsonFile(join(dir, name));
    const findings = (Array.isArray(value.findings) ? value.findings : []).filter((finding) =>
      isString(finding?.claim),
    );
    records.push({
      reviewId: `authoring-${match[1]}`,
      atMs,
      where: owner.where,
      status: isString(value.status) ? value.status : null,
      probes: Array.isArray(value.probes) ? value.probes.length : 0,
      findings: findings.map((finding) => ({
        kind: isString(finding.kind) ? finding.kind : null,
        owner: finding.proposedOwner ?? null,
        claim: finding.claim,
      })),
    });
  }
  return records.sort((a, b) => a.atMs - b.atMs);
}

/** Reviews in the order they ran, with each finding marked a repeat of the earliest review that
 *  already made it. A reviewer that keeps restating a claim the build never acted on is the review
 *  slot's own version of losing the thread. */
async function reviewSlot(campaign, sessions, embedder, run) {
  const records = reviewRecords(campaign, sessions);
  const claims = records.flatMap((record) => record.findings.map((finding) => finding.claim));
  const vectors = claims.length === 0 ? [] : await embedder(claims);
  const units = [];
  let at = 0;
  for (const record of records) {
    record.units = record.findings.map((finding) => {
      const vector = vectors[at];
      const earlier = units.findLast((unit) => cosine(vector, unit.vector) >= RESTATED_COSINE);
      at += 1;
      const unit = {
        sequence: units.length + 1,
        turn: null,
        atMs: record.atMs,
        reviewId: record.reviewId,
        kind: finding.kind,
        owner: finding.owner,
        vector,
        class: earlier === undefined ? "new-finding" : "restated-finding",
        repeatOf: earlier?.reviewId ?? null,
        lowMargin: false,
      };
      units.push(unit);
      return unit;
    });
    record.repeats = record.units.filter((unit) => unit.class === "restated-finding").length;
  }
  const found = consecutive(units, (unit) => unit.class === "restated-finding", run);
  const drift = found.map((entry) =>
    stretch({ ...entry, kind: "restated" }, units, "review", "review", {
      startedMs: records[0]?.atMs ?? null,
      endedMs: records.at(-1)?.atMs ?? null,
    }),
  );
  for (const record of records) for (const unit of record.units) delete unit.vector;
  return { reviews: records.map(({ findings: _findings, ...record }) => record), units: units.length, drift };
}

export async function buildNarrative({
  campaign,
  runId,
  embed,
  minMargin = DEFAULTS.minMargin,
  batchSize = DEFAULTS.batchSize,
  run = DRIFT_RUN,
}) {
  if (!isSafePathSegment(runId)) throw new Error("invalid run selector");
  const root = resolve(campaign);
  const embedder = embed ?? (await modelEmbed(batchSize));
  const posture = await classifyTarget(root, { embed: embedder, minMargin, runId });
  if (posture.state !== "classified") {
    return {
      schema: NARRATIVE_SCHEMA,
      runId,
      state: posture.state,
      reason: `the run has no classifiable prose (${posture.state})`,
      slots: null,
      drift: [],
    };
  }
  const builder = builderSlot(posture, run);
  const built = builtSlot(posture, run);
  const review = await reviewSlot(root, builder.sessions, embedder, run);
  const drift = [...builder.drift, ...built.drift, ...review.drift].sort(
    (a, b) => (a.atMs ?? 0) - (b.atMs ?? 0),
  );
  return {
    schema: NARRATIVE_SCHEMA,
    runId,
    state: "classified",
    model: posture.model,
    calibration: { ...posture.calibration, driftRun: run, restatedCosine: RESTATED_COSINE },
    evidence: posture.evidence,
    slots: { builder, built, review },
    drift,
    limits: [
      "A low-margin stretch says the classifier could not read that prose, not that the model was lost; the two stretch kinds are separate claims.",
      "A solve turn carries no recorded time, so a solver stretch is placed by its case window and located by turn, never by minute.",
      "A restated finding is prose the reviewer repeated; whether the build should have acted on it is not a reading this module makes.",
    ],
  };
}

function renderSlot(title, entries, key) {
  const lines = [];
  for (const entry of entries) {
    const window =
      entry.startedMs === null
        ? "no recorded window"
        : `${stamp(entry.startedMs)}${entry.endedMs === null ? "" : ` +${Math.round((entry.endedMs - entry.startedMs) / 600) / 100} min`}`;
    lines.push(
      `  ${entry[key]}: ${entry.units.length} unit(s), dominant ${entry.dominant ?? "none"}, ${window}`,
    );
  }
  return lines.length === 0 ? [] : [`${title}:`, ...lines];
}

export function renderNarrative(narrative) {
  if (narrative.state !== "classified") return `run ${narrative.runId}: ${narrative.reason}`;
  const { builder, built, review } = narrative.slots;
  const lines = [
    `run ${narrative.runId}: ${builder.units} Builder units, ${built.units} solver units, ${review.units} review findings; drift run ${narrative.calibration.driftRun}`,
    ...renderSlot("builder sessions", builder.sessions, "where"),
    ...renderSlot("solver cases", built.cases, "taskId"),
  ];
  if (review.reviews.length > 0) {
    lines.push("reviews:");
    for (const entry of review.reviews) {
      lines.push(
        `  ${entry.reviewId} at ${stamp(entry.atMs)} in ${entry.where}: ${entry.status}, ${entry.units.length} findings, ${entry.repeats} restated, ${entry.probes} probes`,
      );
    }
  }
  lines.push(
    "",
    narrative.drift.length === 0
      ? `no stretch of ${narrative.calibration.driftRun} consecutive units`
      : `${narrative.drift.length} stretch(es) of ${narrative.calibration.driftRun} or more:`,
  );
  for (const entry of narrative.drift) {
    const where =
      entry.from.atMs === null
        ? `turns ${entry.from.turn} to ${entry.to.turn}`
        : `${stamp(entry.from.atMs)} to ${stamp(entry.to.atMs)}`;
    const phase = entry.phase === undefined || entry.phase === null ? "" : ` [phase ${entry.phase}]`;
    lines.push(
      `  ${entry.slot} ${entry.where} ${entry.kind} x${entry.length}, ${where}${phase}: ${entry.classes.join(" → ")}`,
    );
  }
  return lines.join("\n");
}

function arg(name) {
  const index = runtimeProcess.argv.indexOf(`--${name}`);
  return index >= 0 ? runtimeProcess.argv[index + 1] : undefined;
}

/**
 * The `<campaign dir> --run <runId>` a report script is invoked with, or `usage` and exit 2 when
 * either is missing. An argument after one of `valueFlags` is that flag's value, not the campaign.
 */
export function campaignRunArgs(valueFlags, usage) {
  const argv = runtimeProcess.argv.slice(2);
  const runId = arg("run");
  const campaign = argv.find(
    (value, index) => !value.startsWith("--") && !valueFlags.has(argv[index - 1] ?? ""),
  );
  if (campaign === undefined || runId === undefined) {
    console.error(usage);
    runtimeProcess.exit(2);
  }
  return { campaign, runId };
}

/** Write a report to `--out` when one is named, then print it as JSON under `--json` or rendered. */
export function emitReport(report, render) {
  const out = arg("out");
  if (out !== undefined) writeJsonFile(resolve(out), report);
  console.log(runtimeProcess.argv.includes("--json") ? JSON.stringify(report, null, 2) : render(report));
}

async function main() {
  const { campaign, runId } = campaignRunArgs(
    VALUE_FLAGS,
    "usage: run-narrative.mjs <campaign dir> --run <runId> [--json] [--out <file>] [--drift-run N]",
  );
  const drift = arg("drift-run");
  const narrative = await buildNarrative({
    campaign,
    runId,
    ...keyIfDefined("run", drift === undefined ? undefined : Number(drift)),
  });
  emitReport(narrative, renderNarrative);
}

if (import.meta.main) await main();

// Where a run's wall-clock went, read from `observability/<runId>.jsonl` — the recorded stream no
// other lane opens. Phase spans, the longest gaps between consecutive rows, prompts by role, the
// hooks that actually activated, steering by authority and settled iterations. Rows only: an
// absent row proves nothing about behaviour, and a gap is elapsed time, not a stall diagnosis.
//
// `--classify` adds the embedding reading: what each slot was doing minute by minute, and every
// stretch of consecutive units where a slot stopped progressing, resolved to the phase the run held
// at that moment. Without it the lane loads no model and stays deterministic.
//
//   bun timeline.mjs <campaign> --run <runId> [--classify] [--json] [--out <file>]
import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { join, resolve } from "#src/meta/path.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { sha256 } from "#src/meta/digest.ts";
import { readObservationFile } from "#tools/outcome/query.ts";
import {
  buildNarrative,
  campaignRunArgs,
  emitReport,
  renderNarrative,
} from "../classifier/run-narrative.mjs";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";

export const TIMELINE_SCHEMA = "wri-run-timeline/v1";
const STALLS = 5;
const VALUE_FLAGS = new Set(["--run", "--out"]);

const minutes = (ms) => Math.round(ms / 600) / 100;

/** Every observation file this run owns: its own, plus each battery the terminal binds to it. */
function streams(campaign, runId) {
  const ids = [runId];
  const terminal = join(campaign, "controller", runId, "terminal.json");
  let scope = "live-root-only; battery binding unavailable";
  if (existsSync(terminal)) {
    const value = readJsonFile(terminal);
    const iterations = Array.isArray(value.iterations) ? value.iterations : [];
    for (const iteration of iterations) {
      for (const id of Array.isArray(iteration.batteryRunIds) ? iteration.batteryRunIds : []) {
        if (!isString(id) || !isSafePathSegment(id) || ids.includes(id)) continue;
        ids.push(id);
      }
    }
    scope = "terminal-exact";
  }
  const inputs = [];
  const rows = [];
  for (const id of ids) {
    const path = join(campaign, "observability", `${id}.jsonl`);
    if (!existsSync(path)) {
      inputs.push({ runId: id, sha256: null, issue: null });
      continue;
    }
    const digest = sha256(readFileSync(path));
    try {
      const read = readObservationFile(path, campaign);
      inputs.push({ runId: id, sha256: digest, issue: null });
      rows.push(...read);
    } catch (error) {
      // A stream this reader will not accept is a file the lane cannot use, not a failed read: an
      // older campaign carries an earlier observation schema, and refusing the whole timeline over
      // it loses the streams that are readable.
      inputs.push({ runId: id, sha256: digest, issue: errorMessage(error) });
    }
  }
  rows.sort((a, b) => Date.parse(String(a.at)) - Date.parse(String(b.at)) || a.seq - b.seq);
  return { rows, inputs, scope };
}

/** One entry per phase, carrying the time the run held it and the states it passed through. The
 *  interval between two rows belongs to the phase of the earlier one, which is the last phase the
 *  run is recorded in; the final row closes no interval. */
function phases(rows) {
  const held = new Map();
  let current = null;
  for (const [index, row] of rows.entries()) {
    if (isString(row.phase)) current = row.phase;
    if (current === null) continue;
    const entry = held.get(current) ?? {
      phase: current,
      rows: 0,
      heldMs: 0,
      states: {},
      firstAt: row.at,
      lastAt: row.at,
    };
    entry.rows += 1;
    entry.lastAt = row.at;
    const next = rows[index + 1];
    if (next !== undefined) entry.heldMs += Date.parse(String(next.at)) - Date.parse(String(row.at));
    if (isString(row.state)) entry.states[row.state] = (entry.states[row.state] ?? 0) + 1;
    held.set(current, entry);
  }
  return [...held.values()]
    .map(({ heldMs, ...entry }) => ({ ...entry, elapsedMinutes: minutes(heldMs) }))
    .sort((a, b) => b.elapsedMinutes - a.elapsedMinutes);
}

/** The longest gaps between consecutive rows: elapsed time with the row the run sat behind. */
function stalls(rows) {
  const gaps = [];
  let phase = null;
  for (const [index, row] of rows.entries()) {
    if (isString(row.phase)) phase = row.phase;
    const next = rows[index + 1];
    if (next === undefined) continue;
    gaps.push({
      afterSeq: row.seq,
      at: row.at,
      minutes: minutes(Date.parse(String(next.at)) - Date.parse(String(row.at))),
      phase,
      after: isString(row.summary) ? row.summary : row.type,
    });
  }
  return gaps.sort((a, b) => b.minutes - a.minutes).slice(0, STALLS);
}

/** One entry per recorded phase change, which is what places any other evidence in a phase: a
 *  Builder stretch or a solve window carries a time, and the phase the run held at that time is the
 *  last transition at or before it. */
function transitions(rows) {
  const marks = [];
  for (const row of rows) {
    if (!isString(row.phase) || row.phase === marks.at(-1)?.phase) continue;
    marks.push({ phase: row.phase, at: row.at, atMs: Date.parse(String(row.at)) });
  }
  return marks;
}

/** The phase the run was recorded in at `atMs`, or null when it sits before the first row. */
export function phaseAt(marks, atMs) {
  if (atMs === null) return null;
  return marks.findLast((mark) => mark.atMs <= atMs)?.phase ?? null;
}

/** Count rows by a key, keeping the first row's descriptive fields and summing its `chars`. */
function tally(rows, key, make) {
  const seen = new Map();
  for (const row of rows) {
    const entry = seen.get(key(row)) ?? { ...make(row), count: 0, chars: 0 };
    entry.count += 1;
    entry.chars += isNumber(row.chars) ? row.chars : 0;
    seen.set(key(row), entry);
  }
  return [...seen.values()].sort((a, b) => b.count - a.count);
}

export function buildTimeline({ campaign, runId }) {
  if (!isSafePathSegment(runId)) throw new Error("invalid run selector");
  const { rows, inputs, scope } = streams(resolve(campaign), runId);
  if (rows.length === 0) {
    return {
      schema: TIMELINE_SCHEMA,
      runId,
      state: "unavailable",
      scope,
      inputs,
      reason:
        inputs.find((input) => input.issue !== null)?.issue ?? "no observation row is recorded for this run",
      rows: 0,
    };
  }
  const first = String(rows[0].at);
  const last = String(rows.at(-1).at);
  const prompts = rows.filter((row) => row.type === "prompt-ingested");
  const hooks = rows.filter((row) => isString(row.hookType));
  const steering = rows.filter((row) => row.type === "steering-ingested");
  return {
    schema: TIMELINE_SCHEMA,
    runId,
    state: "recorded",
    scope,
    inputs,
    rows: rows.length,
    window: { from: first, to: last, elapsedMinutes: minutes(Date.parse(last) - Date.parse(first)) },
    phases: phases(rows),
    transitions: transitions(rows),
    stalls: stalls(rows),
    prompts: tally(
      prompts,
      (row) => `${row.contract}/${row.role}`,
      (row) => ({ contract: row.contract ?? null, role: row.role ?? null }),
    ),
    hooks: tally(
      hooks,
      (row) => `${row.hookType}/${row.label}/${row.state}`,
      (row) => ({
        hookType: row.hookType,
        label: row.label ?? null,
        state: row.state ?? null,
        reason: row.reason ?? null,
      }),
    ),
    steering: tally(
      steering,
      (row) => `${row.authority}/${row.focusOwner}`,
      (row) => ({ authority: row.authority ?? null, owner: row.focusOwner ?? null }),
    ),
    iterations: rows
      .filter((row) => row.type === "iteration-settled")
      .map((row) => ({ ordinal: row.ordinal ?? null, outcome: row.outcome ?? null, at: row.at })),
    limits: [
      "Elapsed time between two rows is what the run took, not where it was blocked; read the phase and the next recorded row.",
      "Only recorded rows are counted. An absent hook, steering or prompt row proves no absent behaviour.",
    ],
  };
}

/** The same clock, read for meaning instead of elapsed time: what each slot was doing and where it
 *  stopped progressing, with every stretch resolved to the phase the run held at that moment. The
 *  embedding model loads here and nowhere else in this lane. */
export async function classifyTimeline(timeline, { campaign, runId, embed, run }) {
  const narrative = await buildNarrative({
    campaign,
    runId,
    ...keyIfDefined("embed", embed),
    ...keyIfDefined("run", run),
  });
  if (narrative.state !== "classified") return { ...timeline, narrative };
  const marks = timeline.state === "recorded" ? timeline.transitions : [];
  return {
    ...timeline,
    narrative: {
      ...narrative,
      drift: narrative.drift.map((entry) => ({ ...entry, phase: phaseAt(marks, entry.atMs) })),
    },
  };
}

function section(title, lines) {
  return lines.length === 0 ? [] : [`${title}:`, ...lines.map((line) => `  ${line}`)];
}

export function renderTimeline(timeline) {
  if (timeline.state !== "recorded") return `run ${timeline.runId}: ${timeline.reason} (${timeline.scope})`;
  return [
    `run ${timeline.runId}: ${timeline.rows} rows, ${timeline.window.from} to ${timeline.window.to} (${timeline.window.elapsedMinutes} min, ${timeline.scope})`,
    ...section(
      "phases, by time held",
      timeline.phases.map(
        (row) =>
          `${row.phase}: ${row.elapsedMinutes} min over ${row.rows} rows (${
            Object.entries(row.states)
              .map(([state, count]) => `${state} ${count}`)
              .join(", ") || "no state"
          })`,
      ),
    ),
    ...section(
      "longest gaps",
      timeline.stalls.map(
        (row) =>
          `${row.minutes} min in ${row.phase ?? "no phase"} after seq ${row.afterSeq} at ${row.at}: ${row.after}`,
      ),
    ),
    ...section(
      "prompts ingested",
      timeline.prompts.map((row) => `${row.contract}/${row.role}: ${row.count} prompts, ${row.chars} chars`),
    ),
    ...section(
      "hooks",
      timeline.hooks.map(
        (row) =>
          `${row.hookType} ${row.label} ${row.state} x${row.count}${row.reason === null ? "" : `: ${row.reason}`}`,
      ),
    ),
    ...section(
      "steering",
      timeline.steering.map(
        (row) => `${row.authority}${row.owner === null ? "" : ` to ${row.owner}`}: ${row.count}`,
      ),
    ),
    ...section(
      "iterations settled",
      timeline.iterations.map((row) => `${row.ordinal}: ${row.outcome} at ${row.at}`),
    ),
    ...(timeline.narrative === undefined
      ? []
      : [
          "",
          "what each slot was doing:",
          ...renderNarrative(timeline.narrative)
            .split("\n")
            .map((line) => `  ${line}`),
        ]),
  ].join("\n");
}

async function main() {
  const { campaign, runId } = campaignRunArgs(
    VALUE_FLAGS,
    "usage: timeline.mjs <campaign dir> --run <runId> [--classify] [--json] [--out <file>]",
  );
  const recorded = buildTimeline({ campaign, runId });
  const timeline = runtimeProcess.argv.includes("--classify")
    ? await classifyTimeline(recorded, { campaign, runId })
    : recorded;
  emitReport(timeline, renderTimeline);
}

if (import.meta.main) await main();

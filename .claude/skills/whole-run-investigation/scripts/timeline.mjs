// Where a run's wall-clock went, read from `observability/<runId>.jsonl` — the recorded stream no
// other lane opens. Phase spans, the longest gaps between consecutive rows, prompts by role, the
// hooks that actually activated, steering by authority and settled iterations. Rows only: an
// absent row proves nothing about behaviour, and a gap is elapsed time, not a stall diagnosis.
// Each of the longest gaps carries the one recorded cause that overlaps it, where one does: a
// Builder turn retry whose recorded wait covers the gap and whose reason is the provider's own
// allowance clause, a `harness_trial` call in flight across it, or an authoring review timed
// inside it. Lane 24 reads the gaps; a gap with no overlapping record stays `unattributed`.
//
// `--classify` adds the embedding reading: what each slot was doing minute by minute, and every
// stretch of consecutive units where a slot stopped progressing, resolved to the phase the run held
// at that moment. Without it the lane loads no model and stays deterministic.
//
//   bun wri.mjs timeline <target> [--run <runId>] [--classify] [--json] [--out <abs file>]
import { existsSync, readFileSync, readdirSync } from "#src/meta/filesystem.ts";
import { basename, join, resolve } from "#src/meta/path.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { sha256 } from "#src/meta/digest.ts";
import { readObservationFile } from "#tools/outcome/query.ts";
import { buildNarrative, renderNarrative } from "../classifier/run-narrative.mjs";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import { readControllerEvidence } from "#src/run/controller-evidence.ts";
import { campaignEpochs } from "#src/author/campaign-epoch.ts";
import { readExecutionEvidenceDetails } from "#tools/outcome/builder-execution-facts.ts";
import { PROVIDER_ALLOWANCE } from "#src/correctness-bundle/runtime-blocker.ts";

export const TIMELINE_SCHEMA = "wri-run-timeline/v1";
const STALLS = 5;
/** The share of a gap a recorded wait must cover before the gap is attributed to it. */
const WAIT_COVER = 0.8;

const minutes = (ms) => Math.round(ms / 600) / 100;

/** Every observation file this run owns: its own, plus each battery its recorded terminal binds
 *  to it. A terminal the controller reader refuses binds nothing, and the scope says why. */
function streams(campaign, runId) {
  const ids = [runId];
  let scope;
  try {
    const controller = readControllerEvidence(campaign, runId);
    if (controller.state === "recorded") {
      for (const id of controller.batteryRunIds) if (!ids.includes(id)) ids.push(id);
      scope = "terminal-exact";
    } else {
      scope = `live-root-only; controller evidence ${controller.state}`;
    }
  } catch (error) {
    scope = `live-root-only; controller evidence refused: ${errorMessage(error)}`;
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

/**
 * The recorded intervals a gap can be attributed to, across every epoch's execution records and
 * authoring reviews. A session's window is `writtenAt` back through `durationMs`, and a custom
 * call sits at its `startedAtMs` offset inside it. A turn retry records how long it waited and
 * why, but not when, so it is placed on its session window alone.
 */
function causeSources(campaign) {
  const waits = [];
  const trials = [];
  for (const epochDir of campaignEpochs(campaign)) {
    const read = readExecutionEvidenceDetails(epochDir);
    read.records.forEach((record, index) => {
      if (!isString(record.writtenAt) || !isNumber(record.durationMs)) return;
      const end = Date.parse(record.writtenAt);
      const start = end - record.durationMs;
      const where = `${basename(epochDir)} session ${read.sessions[index] ?? index + 1}`;
      for (const row of Array.isArray(record.turnRetries) ? record.turnRetries : []) {
        if (!isNumber(row.waitMs)) continue;
        waits.push({
          start,
          end,
          waitMs: row.waitMs,
          explicit: PROVIDER_ALLOWANCE.test(String(row.reason)),
          where,
        });
      }
      for (const call of Array.isArray(record.customCalls) ? record.customCalls : []) {
        if (call?.tool !== "harness_trial" || !isNumber(call.startedAtMs)) continue;
        const at = start + call.startedAtMs;
        trials.push({ start: at, end: at + (isNumber(call.durationMs) ? call.durationMs : 0), where });
      }
    });
  }
  const analysis = join(campaign, "analysis");
  const reviews = existsSync(analysis)
    ? readdirSync(analysis)
        .map((name) => /^authoring-([0-9a-f-]{36})-epoch-review\.json$/.exec(name)?.[1])
        .filter((id) => id !== undefined)
        .map((id) => Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16))
    : [];
  return { waits, trials, reviews };
}

const overlaps = (interval, from, to) => interval.start <= to && interval.end >= from;

/** The one recorded cause a gap is attributed to, in the order a reader would check them. */
function causeOf(gap, sources) {
  const from = Date.parse(String(gap.at));
  const to = from + gap.minutes * 60_000;
  const wait = sources.waits.find((row) => overlaps(row, from, to) && row.waitMs >= WAIT_COVER * (to - from));
  if (wait !== undefined) {
    return `${wait.explicit ? "explicit allowance wait" : "turn retry wait"} of ${minutes(wait.waitMs)} min recorded in ${wait.where}`;
  }
  const trial = sources.trials.find((row) => overlaps(row, from, to));
  if (trial !== undefined) return `harness_trial rehearsal in flight (${trial.where})`;
  const review = sources.reviews.find((at) => at >= from && at <= to);
  if (review !== undefined) return `authoring review timed at ${new Date(review).toISOString()}`;
  return "unattributed";
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
  const sources = causeSources(resolve(campaign));
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
    stalls: stalls(rows).map((gap) => ({ ...gap, cause: causeOf(gap, sources) })),
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
      (row) => `${row.authority}/${row.owner}`,
      (row) => ({ authority: row.authority ?? null, owner: row.owner ?? null }),
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
 *  embedding model loads here and nowhere else in this lane.
 *  @template T
 *  @param {T} timeline
 *  @param {{ campaign: string, runId: string, embed?: (texts: string[]) => Promise<number[][]>, run?: number }} options */
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
          `${row.minutes} min in ${row.phase ?? "no phase"} after seq ${row.afterSeq} at ${row.at}: ${row.after} · cause: ${row.cause}`,
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

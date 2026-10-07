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
//   bun wri.ts timeline <target> [--run <runId>] [--classify] [--json] [--out <abs file>]
import { existsSync, readFileSync, readdirSync } from "#src/meta/filesystem.ts";
import { join, resolve } from "#src/meta/path.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { sha256 } from "#src/meta/digest.ts";
import { readObservationFile } from "#tools/outcome/query.ts";
import { buildNarrative, renderNarrative } from "../classifier/run-narrative.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { isNumber, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { readControllerEvidence } from "#src/run/controller-evidence.ts";
import { campaignEpochs } from "#src/author/campaign-epoch.ts";
import { readExecutionEvidenceDetails } from "#tools/outcome/builder-execution-facts.ts";
import { PROVIDER_ALLOWANCE } from "#src/correctness-bundle/runtime-blocker.ts";
import { jsonText } from "./run-overview.ts";

/** One recorded observation row, as `readObservationFile` returns it. */
export type ObservationRow = Record<string, JsonValue>;

/** One observation file the timeline read, or the reason it could not use it. */
export interface StreamInput {
  runId: string;
  sha256: string | null;
  issue: string | null;
}

/** The time a phase was held, with the states it passed through. */
export interface PhaseRow {
  phase: string;
  rows: number;
  states: Record<string, number>;
  firstAt: JsonValue | undefined;
  lastAt: JsonValue | undefined;
  elapsedMinutes: number;
}

/** One of the longest gaps between consecutive rows. */
export interface Gap {
  afterSeq: JsonValue | undefined;
  at: JsonValue | undefined;
  minutes: number;
  phase: string | null;
  after: JsonValue | undefined;
}

/** One recorded phase change. */
export interface PhaseMark {
  phase: string;
  at: JsonValue | undefined;
  atMs: number;
}

/** The observation rows a run owns, the files they came from and how they were bound. */
interface StreamRead {
  rows: ObservationRow[];
  inputs: StreamInput[];
  scope: string;
}

interface Interval {
  start: number;
  end: number;
  where: string;
}

interface Wait extends Interval {
  waitMs: number;
  explicit: boolean;
}

interface CauseSources {
  waits: Wait[];
  trials: Interval[];
  reviews: number[];
}

/** Which run of which campaign the timeline reads. */
export interface TimelineInput {
  campaign: string;
  runId: string;
}

export type Timeline = ReturnType<typeof buildTimeline>;

/** What `classifyTimeline` needs besides the timeline itself. */
export interface ClassifyOptions {
  campaign: string;
  runId: string;
  embed?: (texts: string[]) => Promise<number[][]>;
  run?: number;
}

/** A timeline as `renderTimeline` prints it, with or without the embedding reading. */
export type TimelineView = Timeline & { narrative?: Parameters<typeof renderNarrative>[0] };

export const TIMELINE_SCHEMA = "wri-run-timeline/v1";
const STALLS = 5;
/** The share of a gap a recorded wait must cover before the gap is attributed to it. */
const WAIT_COVER = 0.8;
/** Whether a phase row settles its span rather than opening or holding it. */
const SETTLED = new Set(["completed", "failed"]);

const minutes = (ms: number): number => Math.round(ms / 600) / 100;

/** The text `String(value)` gives a recorded field, which may be absent. */
const textOf = (value: JsonValue | undefined): string =>
  value === undefined ? "undefined" : jsonText(value);
/** The row's `seq`, which `readObservationFile` has already proved is a number. */
const seqOf = (row: ObservationRow): number => (isNumber(row.seq) ? row.seq : Number.NaN);

/** Every observation file this run owns: its own, plus each battery its recorded terminal binds
 *  to it. A terminal the controller reader refuses binds nothing, and the scope says why. */
function streams(campaign: string, runId: string): StreamRead {
  const ids = [runId];
  let scope: string;
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
  const inputs: StreamInput[] = [];
  const rows: ObservationRow[] = [];
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
  rows.sort((a, b) => Date.parse(textOf(a.at)) - Date.parse(textOf(b.at)) || seqOf(a) - seqOf(b));
  return { rows, inputs, scope };
}

/**
 * The phase the run holds after each row. A phase row is the last word, except for a span nested
 * under another phase's span, which is how an authoring review runs inside the build: its rows
 * carry `phase: "analyse"` and the build span's id as `parentId`. While it runs the run holds its
 * phase, and once it settles the run is back in the enclosing phase, so the Builder authoring that
 * follows reads as build and not as analysis.
 */
function heldPhases(rows: readonly ObservationRow[]): Array<string | null> {
  const spanPhase = new Map<string, string>();
  let current: string | null = null;
  return rows.map((row) => {
    if (!isString(row.phase)) return current;
    const enclosing = isString(row.parentId) ? spanPhase.get(row.parentId) : undefined;
    if (row.type === "phase-transition" && isString(row.id)) spanPhase.set(row.id, row.phase);
    const nested = row.type === "phase-transition" && enclosing !== undefined && enclosing !== row.phase;
    current = nested && isString(row.state) && SETTLED.has(row.state) ? enclosing : row.phase;
    return current;
  });
}

/** One entry per phase, carrying the time the run held it and the states it passed through. The
 *  interval between two rows belongs to the phase held after the earlier one; the final row closes
 *  no interval. A row's state counts under its own phase, which a settled nested span has left. */
function phases(rows: readonly ObservationRow[]): PhaseRow[] {
  const held = new Map<string, PhaseRow & { heldMs: number }>();
  const entryOf = (phase: string, row: ObservationRow) => {
    const entry = held.get(phase) ?? {
      phase,
      rows: 0,
      heldMs: 0,
      states: {},
      firstAt: row.at,
      lastAt: row.at,
      elapsedMinutes: 0,
    };
    held.set(phase, entry);
    return entry;
  };
  const after = heldPhases(rows);
  for (const [index, row] of rows.entries()) {
    const current = after[index] ?? null;
    if (isString(row.phase) && isString(row.state)) {
      const own = entryOf(row.phase, row);
      own.states[row.state] = (own.states[row.state] ?? 0) + 1;
    }
    if (current === null) continue;
    const entry = entryOf(current, row);
    entry.rows += 1;
    entry.lastAt = row.at;
    const next = rows[index + 1];
    if (next !== undefined) entry.heldMs += Date.parse(textOf(next.at)) - Date.parse(textOf(row.at));
  }
  return [...held.values()]
    .map(({ heldMs, ...entry }) => ({ ...entry, elapsedMinutes: minutes(heldMs) }))
    .sort((a, b) => b.elapsedMinutes - a.elapsedMinutes);
}

/** The longest gaps between consecutive rows: elapsed time with the row the run sat behind. */
function stalls(rows: readonly ObservationRow[]): Gap[] {
  const gaps: Gap[] = [];
  const after = heldPhases(rows);
  for (const [index, row] of rows.entries()) {
    const phase = after[index] ?? null;
    const next = rows[index + 1];
    if (next === undefined) continue;
    gaps.push({
      afterSeq: row.seq,
      at: row.at,
      minutes: minutes(Date.parse(textOf(next.at)) - Date.parse(textOf(row.at))),
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
function causeSources(campaign: string): CauseSources {
  const waits: Wait[] = [];
  const trials: Interval[] = [];
  for (const epoch of campaignEpochs(campaign)) {
    const read = readExecutionEvidenceDetails(join(campaign, epoch));
    read.records.forEach((record, index) => {
      if (!isString(record.writtenAt) || !isNumber(record.durationMs)) return;
      const end = Date.parse(record.writtenAt);
      const start = end - record.durationMs;
      const where = `${epoch} session ${read.sessions[index] ?? index + 1}`;
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

const overlaps = (interval: Interval, from: number, to: number): boolean =>
  interval.start <= to && interval.end >= from;

/** The one recorded cause a gap is attributed to, in the order a reader would check them. */
function causeOf(gap: Gap, sources: CauseSources): string {
  const from = Date.parse(textOf(gap.at));
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
function transitions(rows: readonly ObservationRow[]): PhaseMark[] {
  const marks: PhaseMark[] = [];
  const after = heldPhases(rows);
  for (const [index, row] of rows.entries()) {
    const phase = after[index];
    if (phase === null || phase === undefined || phase === marks.at(-1)?.phase) continue;
    marks.push({ phase, at: row.at, atMs: Date.parse(textOf(row.at)) });
  }
  return marks;
}

/** The phase the run was recorded in at `atMs`, or null when it sits before the first row. */
export function phaseAt(marks: readonly PhaseMark[], atMs: number | null): string | null {
  if (atMs === null) return null;
  return marks.findLast((mark) => mark.atMs <= atMs)?.phase ?? null;
}

/** Count rows by a key, keeping the first row's descriptive fields and summing its `chars`. */
function tally<T extends object>(
  rows: readonly ObservationRow[],
  key: (row: ObservationRow) => string,
  make: (row: ObservationRow) => T,
): Array<T & { count: number; chars: number }> {
  const seen = new Map<string, T & { count: number; chars: number }>();
  for (const row of rows) {
    const entry = seen.get(key(row)) ?? { ...make(row), count: 0, chars: 0 };
    entry.count += 1;
    entry.chars += isNumber(row.chars) ? row.chars : 0;
    seen.set(key(row), entry);
  }
  return [...seen.values()].sort((a, b) => b.count - a.count);
}

export function buildTimeline({ campaign, runId }: TimelineInput) {
  if (!isSafePathSegment(runId)) throw new Error("invalid run selector");
  const { rows, inputs, scope } = streams(resolve(campaign), runId);
  if (rows.length === 0) {
    return {
      schema: TIMELINE_SCHEMA,
      runId,
      state: "unavailable" as const,
      scope,
      inputs,
      reason:
        inputs.find((input) => input.issue !== null)?.issue ?? "no observation row is recorded for this run",
      rows: 0,
    };
  }
  const first = textOf(rows[0]?.at);
  const last = textOf(rows.at(-1)?.at);
  const sources = causeSources(resolve(campaign));
  const prompts = rows.filter((row) => row.type === "prompt-ingested");
  const hooks = rows.filter((row) => isString(row.hookType));
  const steering = rows.filter((row) => row.type === "steering-ingested");
  return {
    schema: TIMELINE_SCHEMA,
    runId,
    state: "recorded" as const,
    scope,
    inputs,
    rows: rows.length,
    window: { from: first, to: last, elapsedMinutes: minutes(Date.parse(last) - Date.parse(first)) },
    phases: phases(rows),
    transitions: transitions(rows),
    stalls: stalls(rows).map((gap) => ({ ...gap, cause: causeOf(gap, sources) })),
    prompts: tally(
      prompts,
      (row) => `${textOf(row.contract)}/${textOf(row.role)}`,
      (row) => ({ contract: row.contract ?? null, role: row.role ?? null }),
    ),
    hooks: tally(
      hooks,
      (row) => `${textOf(row.hookType)}/${textOf(row.label)}/${textOf(row.state)}`,
      (row) => ({
        hookType: row.hookType,
        label: row.label ?? null,
        state: row.state ?? null,
        reason: row.reason ?? null,
      }),
    ),
    steering: tally(
      steering,
      (row) => `${textOf(row.authority)}/${textOf(row.owner)}`,
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
 *  embedding model loads here and nowhere else in this lane. */
export async function classifyTimeline<T extends Timeline>(
  timeline: T,
  { campaign, runId, embed, run }: ClassifyOptions,
) {
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

function section(title: string, lines: readonly string[]): string[] {
  return lines.length === 0 ? [] : [`${title}:`, ...lines.map((line) => `  ${line}`)];
}

export function renderTimeline(timeline: TimelineView): string {
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
          `${row.minutes} min in ${row.phase ?? "no phase"} after seq ${textOf(row.afterSeq)} at ${textOf(row.at)}: ${textOf(row.after)} · cause: ${row.cause}`,
      ),
    ),
    ...section(
      "prompts ingested",
      timeline.prompts.map(
        (row) => `${textOf(row.contract)}/${textOf(row.role)}: ${row.count} prompts, ${row.chars} chars`,
      ),
    ),
    ...section(
      "hooks",
      timeline.hooks.map(
        (row) =>
          `${textOf(row.hookType)} ${textOf(row.label)} ${textOf(row.state)} x${row.count}${row.reason === null ? "" : `: ${textOf(row.reason)}`}`,
      ),
    ),
    ...section(
      "steering",
      timeline.steering.map(
        (row) =>
          `${textOf(row.authority)}${row.owner === null ? "" : ` to ${textOf(row.owner)}`}: ${row.count}`,
      ),
    ),
    ...section(
      "iterations settled",
      timeline.iterations.map((row) => `${textOf(row.ordinal)}: ${textOf(row.outcome)} at ${textOf(row.at)}`),
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

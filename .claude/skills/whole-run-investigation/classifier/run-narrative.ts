// What each slot of a run was doing along the run clock, and where it stopped making progress.
//
// `posture` already answers "which posture dominated this session, and what did it say before each
// submit". This asks a different question: at which minute, in which recorded
// phase, did a slot lose the thread. Three slots reach one clock by three routes, none of them a
// guess and none of them an order join:
//
//   builder  a prose row's `atMs` is relative to its own session. The session's absolute start is
//            its execution record's last write minus how long it ran, which `prose-input.ts`
//            publishes as `startedMs`.
//   built    a solve turn carries a turn number and no timestamp. A solver unit is therefore placed
//            by its case's recorded solve window and never claims a minute inside it.
//   review   an authoring review's id is a UUIDv7 minted when that review started, so the identity
//            carries the time. Each review is attributed to the Builder session whose window
//            contains it; one that falls in no session window stays unattributed.
//
// Classification has one owner, `prose-classify.ts`. This module places its units on the clock and
// runs its consecutive-stretch detector; it decides no pass, sets no score and states no cause.
// The review slot is read for repetition rather than posture: the thirteen anchors were written for
// authoring prose, and a reviewer restating a finding nobody acted on is the reading that matters
// there.
//
//   bun run-narrative.ts <campaign dir> --run <runId> [--json] [--out <file>]
import { existsSync, readdirSync } from "#src/meta/filesystem.ts";
import { join, resolve } from "#src/meta/path.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { exitWith, parseOrDie, requiredOption } from "#skills/main/cli.ts";
import {
  DEFAULTS,
  DRIFT_RUN,
  classifyTarget,
  consecutive,
  cosine,
  dominant,
  driftRuns,
  modelEmbed,
} from "./prose-classify.ts";
import type { ClassifiedPosture, DriftStretch, Embed, LabelledUnit, Stretch } from "./prose-classify.ts";
import { isRecord, isString } from "#src/meta/json-shape.ts";
import type { JsonObject, JsonValue } from "#src/meta/json-shape.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";
import { emitReport as emitTo } from "#skills/main/output.ts";

/** A group's place on the run clock; either end may be unrecorded. */
export interface ClockWindow {
  startedMs: number | null;
  endedMs: number | null;
}

/** Where one unit sits, as a stretch's two ends report it. */
export interface UnitPoint {
  sequence?: number | null;
  turn?: number | null;
  atMs?: number | null;
}

/** One stretch on the run clock. `phase` is added by `timeline.ts` once the run's phases are known. */
export interface NarrativeStretch {
  slot: string;
  where: string;
  kind: string;
  length: number;
  classes: string[];
  from: { sequence: number | null; turn: number | null; atMs: number | null };
  to: { sequence: number | null; turn: number | null; atMs: number | null };
  atMs: number | null;
  window: ClockWindow;
  phase?: string | null;
}

interface SlotLabel {
  kind: string;
  class: string;
  margin: number;
  lowMargin: boolean;
}

/** A Builder prose unit, placed by its session's absolute start. */
export interface BuilderUnit extends SlotLabel {
  sequence: number;
  turn: number;
  offsetMs: number;
  atMs: number | null;
}

/** A solver unit: a turn inside its case window, never a minute. */
export interface SolverUnit extends SlotLabel {
  sequence: null;
  turn: number;
  atMs: null;
}

interface OpenGroup<U> extends ClockWindow {
  where: string;
  units: U[];
}

/** A group once its units have been read for dominance and drift. */
export type ReadGroup<G> = G & { dominant: string | null; drift: DriftStretch[] };

interface GroupSpec<R, U, G> {
  slot: string;
  run: number;
  keyOf: (row: R) => string;
  open: (row: R) => G;
  unit: (row: R, group: G) => U;
}

interface SlotReading<G> {
  groups: ReadGroup<G>[];
  units: number;
  drift: NarrativeStretch[];
}

interface ReviewFinding {
  defect: boolean;
  owner: JsonValue;
  claim: string;
}

interface ReviewRecord {
  reviewId: string;
  atMs: number;
  where: string;
  status: string | null;
  probes: number;
  findings: ReviewFinding[];
}

/** One review finding on the clock, marked new or a restatement of an earlier review's. */
export interface ReviewUnit {
  sequence: number;
  turn: null;
  atMs: number;
  reviewId: string;
  defect: boolean;
  owner: JsonValue;
  class: "new-finding" | "restated-finding";
  repeatOf: string | null;
  lowMargin: false;
}

type ScoredUnit = ReviewUnit & { vector: number[] };

/** One review as the narrative reports it: its units and how many of them restate an earlier claim. */
export interface ReviewRow {
  reviewId: string;
  atMs: number;
  where: string;
  status: string | null;
  probes: number;
  units: ReviewUnit[];
  repeats: number;
}

/** The review slot: reviews in the order they ran, and the stretches of restated findings. */
export interface ReviewSlot {
  reviews: ReviewRow[];
  units: number;
  drift: NarrativeStretch[];
}

/** What `buildNarrative` takes: `embed` is injected by tests, and the CLI loads the pinned model. */
export interface BuildNarrativeOptions {
  campaign: string;
  runId: string;
  embed?: Embed | undefined;
  minMargin?: number;
  batchSize?: number;
  run?: number;
}

export type Narrative = Awaited<ReturnType<typeof buildNarrative>>;

interface RenderEntry extends ClockWindow {
  units: readonly object[];
  dominant: string | null;
}

/** The report options a campaign script adds beside `--run`, `--out` and `--json`. */
export interface ExtraOptions {
  values?: string[];
  flags?: string[];
}

export type ReportArgs = ReturnType<typeof parseOrDie>;

/** A report script's campaign, run and parsed arguments. */
export interface CampaignRunArgs {
  campaign: string;
  runId: string;
  args: ReportArgs;
}

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

const stamp = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/** The millisecond a UUIDv7 was minted, which is its leading 48 bits. */
export function uuidV7Ms(uuid: string): number {
  const hex = uuid.replace(/-/g, "");
  return Number.parseInt(hex.slice(0, 12), 16);
}

/** One stretch, carrying where it sits rather than what caused it. `atMs` is the first unit's own
 *  time when the slot has one, and the window's start when it does not. */
function stretch(
  found: Stretch & { kind: string },
  units: readonly UnitPoint[],
  where: string,
  slot: string,
  window: ClockWindow,
): NarrativeStretch {
  const first = units[found.from];
  const last = units[found.to];
  if (first === undefined || last === undefined) {
    throw new Error(`stretch ${found.from}..${found.to} runs past ${units.length} units`);
  }
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

/** Units grouped by `keyOf`, each group opened once with its own clock window, ordered by that
 *  window and searched for stretches. Builder prose groups by authoring session and is placed by
 *  that session's absolute start; solver prose groups by case, and since a turn has no recorded
 *  time the case window is the placement and the turn number the location inside it. */
function groupSlot<R, U extends LabelledUnit & UnitPoint, G extends OpenGroup<U>>(
  rows: readonly R[],
  { slot, run, keyOf, open, unit }: GroupSpec<R, U, G>,
): SlotReading<G> {
  const groups = new Map<string, G>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key) ?? open(row);
    group.units.push(unit(row, group));
    groups.set(key, group);
  }
  const ordered = [...groups.values()].sort((a, b) => (a.startedMs ?? 0) - (b.startedMs ?? 0));
  const drift: NarrativeStretch[] = [];
  const read: ReadGroup<G>[] = [];
  for (const group of ordered) {
    const found = driftRuns(group.units, { run });
    read.push({ ...group, dominant: dominant(group.units), drift: found });
    const window = { startedMs: group.startedMs, endedMs: group.endedMs };
    for (const entry of found) drift.push(stretch(entry, group.units, group.where, slot, window));
  }
  return { groups: read, units: read.reduce((sum, group) => sum + group.units.length, 0), drift };
}

const labelOf = (row: SlotLabel): SlotLabel => ({
  kind: row.kind,
  class: row.class,
  margin: row.margin,
  lowMargin: row.lowMargin,
});
const parsedMs = (value: string | null | undefined): number | null => {
  const ms = Date.parse(value ?? "");
  return Number.isFinite(ms) ? ms : null;
};

function builderSlot(posture: ClassifiedPosture, run: number) {
  const captures = new Map(
    posture.input.captures.map((capture) => [`${capture.epoch}\u0000${capture.session}`, capture]),
  );
  const keyOf = (row: { epoch: string; session: number }): string => `${row.epoch}\u0000${row.session}`;
  const { groups, ...rest } = groupSlot(posture.rows, {
    slot: "builder",
    run,
    keyOf,
    open: (row) => {
      const capture = captures.get(keyOf(row));
      const startedMs = capture?.startedMs ?? null;
      const units: BuilderUnit[] = [];
      return {
        epoch: row.epoch,
        session: row.session,
        where: `${row.epoch}/s${String(row.session).padStart(2, "0")}`,
        anchor: startedMs === null ? "unanchored" : "execution-record",
        startedMs,
        endedMs: capture?.endedMs ?? null,
        units,
      };
    },
    unit: (row, group): BuilderUnit => ({
      sequence: row.sequence,
      turn: row.turn,
      offsetMs: row.atMs,
      atMs: group.startedMs === null ? null : group.startedMs + row.atMs,
      ...labelOf(row),
    }),
  });
  return { sessions: groups, ...rest };
}

function builtSlot(posture: ClassifiedPosture, run: number) {
  if (posture.solves === null) return { cases: [], units: 0, drift: [] };
  const recorded = "cases" in posture.solveInput ? posture.solveInput.cases : [];
  const windows = new Map(recorded.map((entry) => [entry.taskId, entry]));
  const { groups, ...rest } = groupSlot(posture.solveRows, {
    slot: "built",
    run,
    keyOf: (row) => row.taskId,
    open: (row) => {
      const units: SolverUnit[] = [];
      return {
        taskId: row.taskId,
        where: row.taskId,
        family: row.family,
        outcome: row.outcome,
        startedMs: parsedMs(windows.get(row.taskId)?.startedAt),
        endedMs: parsedMs(windows.get(row.taskId)?.endedAt),
        units,
      };
    },
    unit: (row): SolverUnit => ({ sequence: null, turn: row.turn, atMs: null, ...labelOf(row) }),
  });
  return { cases: groups.map(({ where: _where, ...entry }) => entry), ...rest };
}

function findingsOf(value: JsonObject): ReviewFinding[] {
  return (Array.isArray(value.findings) ? value.findings : []).flatMap((finding) =>
    isRecord(finding) && isString(finding.claim)
      ? [{ defect: finding.defect === true, owner: finding.owner ?? null, claim: finding.claim }]
      : [],
  );
}

function reviewRecords(
  campaign: string,
  sessions: readonly (ClockWindow & { where: string })[],
): ReviewRecord[] {
  const dir = join(campaign, "analysis");
  if (!existsSync(dir)) return [];
  const records: ReviewRecord[] = [];
  for (const name of readdirSync(dir)) {
    const match = AUTHORING_RE.exec(name);
    if (match === null) continue;
    const id = match[1] ?? "";
    const atMs = uuidV7Ms(id);
    const owner = sessions.find(
      (session) =>
        session.startedMs !== null &&
        session.endedMs !== null &&
        atMs >= session.startedMs &&
        atMs <= session.endedMs,
    );
    if (owner === undefined) continue;
    const value = readJsonFile(join(dir, name));
    if (value === null) throw new Error(`${name} holds null; cannot read its findings`);
    const fields: JsonObject = isRecord(value) ? value : {};
    records.push({
      reviewId: `authoring-${id}`,
      atMs,
      where: owner.where,
      status: isString(fields.status) ? fields.status : null,
      probes: Array.isArray(fields.probes) ? fields.probes.length : 0,
      findings: findingsOf(fields),
    });
  }
  return records.sort((a, b) => a.atMs - b.atMs);
}

/** Reviews in the order they ran, with each finding marked a repeat of the earliest review that
 *  already made it. A reviewer that keeps restating a claim the build never acted on is the review
 *  slot's own version of losing the thread. Each record gains its units and repeat count here, after
 *  `reviewRecords` built it. */
async function reviewSlot(
  campaign: string,
  sessions: readonly (ClockWindow & { where: string })[],
  embedder: Embed,
  run: number,
): Promise<ReviewSlot> {
  const records = reviewRecords(campaign, sessions);
  const claims = records.flatMap((record) => record.findings.map((finding) => finding.claim));
  const vectors = claims.length === 0 ? [] : await embedder(claims);
  const units: ScoredUnit[] = [];
  const scored: (ReviewRecord & { units: ScoredUnit[]; repeats: number })[] = [];
  let at = 0;
  for (const record of records) {
    const own = record.findings.map((finding) => {
      const vector = vectors[at];
      if (vector === undefined) throw new Error(`the embedder returned no vector for claim ${at}`);
      const earlier = units.findLast((unit) => cosine(vector, unit.vector) >= RESTATED_COSINE);
      at += 1;
      const unit: ScoredUnit = {
        sequence: units.length + 1,
        turn: null,
        atMs: record.atMs,
        reviewId: record.reviewId,
        defect: finding.defect,
        owner: finding.owner,
        vector,
        class: earlier === undefined ? "new-finding" : "restated-finding",
        repeatOf: earlier?.reviewId ?? null,
        lowMargin: false,
      };
      units.push(unit);
      return unit;
    });
    scored.push({
      ...record,
      units: own,
      repeats: own.filter((unit) => unit.class === "restated-finding").length,
    });
  }
  const found = consecutive(units, (unit) => unit.class === "restated-finding", run);
  const drift = found.map((entry) =>
    stretch({ ...entry, kind: "restated" }, units, "review", "review", {
      startedMs: records[0]?.atMs ?? null,
      endedMs: records.at(-1)?.atMs ?? null,
    }),
  );
  const reviews = scored.map(({ findings: _findings, units: own, repeats, ...record }) => ({
    ...record,
    units: own.map(({ vector: _vector, ...unit }) => unit),
    repeats,
  }));
  return { reviews, units: units.length, drift };
}

export async function buildNarrative({
  campaign,
  runId,
  embed,
  minMargin = DEFAULTS.minMargin,
  batchSize = DEFAULTS.batchSize,
  run = DRIFT_RUN,
}: BuildNarrativeOptions) {
  if (!isSafePathSegment(runId)) throw new Error("invalid run selector");
  const root = resolve(campaign);
  const embedder = embed ?? (await modelEmbed(batchSize));
  const posture = await classifyTarget(root, { embed: embedder, minMargin, runId });
  if (posture.state !== "classified") {
    const none: NarrativeStretch[] = [];
    return {
      schema: NARRATIVE_SCHEMA,
      runId,
      state: posture.state,
      reason: `the run has no classifiable prose (${posture.state})`,
      slots: null,
      drift: none,
    };
  }
  const builder = builderSlot(posture, run);
  const built = builtSlot(posture, run);
  const review = await reviewSlot(root, builder.sessions, embedder, run);
  const drift: NarrativeStretch[] = [...builder.drift, ...built.drift, ...review.drift].sort(
    (a, b) => (a.atMs ?? 0) - (b.atMs ?? 0),
  );
  return {
    schema: NARRATIVE_SCHEMA,
    runId,
    state: "classified" as const,
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

function renderSlot<K extends string>(
  title: string,
  entries: readonly (RenderEntry & Record<K, string>)[],
  key: K,
): string[] {
  const lines: string[] = [];
  for (const entry of entries) {
    const window =
      entry.startedMs === null
        ? "no recorded window"
        : `${String(stamp(entry.startedMs))}${entry.endedMs === null ? "" : ` +${Math.round((entry.endedMs - entry.startedMs) / 600) / 100} min`}`;
    lines.push(
      `  ${entry[key]}: ${entry.units.length} unit(s), dominant ${entry.dominant ?? "none"}, ${window}`,
    );
  }
  return lines.length === 0 ? [] : [`${title}:`, ...lines];
}

export function renderNarrative(narrative: Narrative): string {
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
        `  ${entry.reviewId} at ${String(stamp(entry.atMs))} in ${entry.where}: ${String(entry.status)}, ${entry.units.length} findings, ${entry.repeats} restated, ${entry.probes} probes`,
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
        ? `turns ${String(entry.from.turn)} to ${String(entry.to.turn)}`
        : `${String(stamp(entry.from.atMs))} to ${String(stamp(entry.to.atMs))}`;
    const phase = entry.phase === undefined || entry.phase === null ? "" : ` [phase ${entry.phase}]`;
    lines.push(
      `  ${entry.slot} ${entry.where} ${entry.kind} x${entry.length}, ${where}${phase}: ${entry.classes.join(" → ")}`,
    );
  }
  return lines.join("\n");
}

/**
 * The `<campaign dir> --run <runId>` a report script is invoked with, parsed strictly beside the
 * `--out <file>` and `--json` every report takes and the script's own `extra` options.
 */
export function campaignRunArgs(script: string, extra: ExtraOptions = {}): CampaignRunArgs {
  const die = exitWith(script);
  const args = parseOrDie(die, {
    values: ["run", "out", ...(extra.values ?? [])],
    flags: ["json", ...(extra.flags ?? [])],
    positionals: 1,
  });
  const campaign = args.positionals[0] ?? "";
  return { campaign, runId: requiredOption(die, args.single)("run"), args };
}

/** Write a report to `--out` when one is named, then print it as JSON under `--json` or rendered. */
export function emitReport<T>(report: T, render: (report: T) => string, args: ReportArgs): void {
  const out = args.single.get("out");
  emitTo(report, { json: args.flags.has("json"), out: out === undefined ? null : resolve(out), render });
}

async function main(): Promise<void> {
  const { campaign, runId, args } = campaignRunArgs("run-narrative", { values: ["drift-run"] });
  const drift = args.single.get("drift-run");
  const narrative = await buildNarrative({
    campaign,
    runId,
    ...keyIfDefined("run", drift === undefined ? undefined : Number(drift)),
  });
  emitReport(narrative, renderNarrative, args);
}

if (import.meta.main) await main();

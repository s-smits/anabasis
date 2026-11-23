/**
 * Campaign comparison folds (`src/kernel/reports.ts`): derives the current reference harness
 * (`referenceOf`), each comparison's latest report at its first-reported index (`lastReports`),
 * paired task readings (`pairsReported`), held-out task pool partitions (`poolOf`), and practice
 * release order (`releaseOrder`). Passes settled as wrong (`history.ts`) count as failures everywhere.
 */
import { asRecord, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import {
  carriedBy,
  draw,
  type Measures,
  objectiveRuleIn,
  type Paired,
  pairsOf,
  pointsOf,
  differenceOf,
  gapAgainst,
} from "./compare.ts";
import { failWrongPasses, wrongPasses, wrongPassesIn } from "./history.ts";
import type { LogEvent } from "./log.ts";
import { providerFailed, windowEnded } from "./solve.ts";
import { passed, ranUnder, rejected, standsOf } from "./solves.ts";
import { READINGS_IN_A_ROW, howOftenValid } from "./size.ts";
import { taskSets } from "./task.ts";

/** A comparison's last report, placed in the log where its first report stands. */
export interface Reported {
  readonly session: string;
  readonly index: number;
  readonly data: JsonObject;
}

/** What a task's author hears of it: how often the reference harness answered it validly in the
 *  last comparison that scored it (every solve, some, none); that the last comparison was between
 *  two other harnesses, so nothing of the reference's is on record; or that it was set aside. */
export type Outcome =
  | "reference-every"
  | "reference-some"
  | "reference-none"
  | "earlier-reference"
  | "disputed";

/** Who won a task the last time it was compared with the reference harness on one side, as its
 *  author hears it (`poolOf`, standings). */
export interface Standing {
  /** The reference or the other side, or null for a tie. */
  readonly won: "reference" | "other" | null;
  /** The measure that decided the win (`carriedBy`), or null for a tie. */
  readonly by: keyof Measures | null;
}

/** How one comparison read one task, from that comparison's last report. */
interface TaskReading {
  /** The report's index in the log. */
  readonly index: number;
  /** Its position among every pair of every report, in the order the reports are read. */
  readonly order: number;
  /** Whether each counted solve on each side was valid. */
  readonly old: readonly boolean[];
  readonly fresh: readonly boolean[];
  /** The side the reference harness stood on, or null where it stood on neither. */
  readonly reference: "old" | "fresh" | null;
  /** Whose solve a limit cut short in this comparison (`taskRecords`): one of the reference
   *  harness's, which is all its author may hear about (rule 3), only another harness's, or none. */
  readonly cut: "reference" | "other" | "none";
  /** The side that won the task in this comparison's tally, or null for a tie. */
  readonly won: "old" | "fresh" | null;
  /** The measure that decided the win (`carriedBy`), or null for a tie. */
  readonly by: keyof Measures | null;
  /** Whether a better objective value than the reference's own answers is on record, from its
   *  own answers or its author's (`gapAgainst`): false under the gap floor, and where the reference
   *  stood on neither side. */
  readonly room: boolean;
}

/**
 * Everything the log says about one task, gathered once so that the pool and the release read the
 * same facts: while each read the log for itself, their arithmetic had to be mended four times.
 * `taskRecords` fills it in, which is why some fields are writable.
 */
interface TaskRecord {
  readonly version: string;
  /** Whether the task is held out now. */
  readonly held: boolean;
  /** The last event at which a person kept it held (`task.state`), or -1. */
  keptAt: number;
  /** The best evidence that the task can be answered. `independent` means a valid answer that does
   *  not depend on the candidate harness: an author's (`task.feasible`), a reference solve that an
   *  older log's gate counted, or a valid solve by a current or former reference. `known` means
   *  only a candidate harness has answered it. The practice allowance and the wait for a person read
   *  only `independent`, so neither moves with which held-out task a candidate won (rule 3). */
  validAnswer: "independent" | "known" | "none";
  /** The best objective value of an author's answer on record (`task.feasible`), or null where
   *  none carries one (`informative`, `compare.ts`). */
  best: number | null;
  /** Each comparison that tallied the task, in report order. */
  readonly tallied: TaskReading[];
  /** The last report that set the task aside on a rejection, or -1, and the position (as
   *  `TaskReading.order` counts) where it was first set aside. */
  asideAt: number;
  asideOrder: number;
  /** The last report that set it aside on a rejection of the reference's own solve that stands
   *  unearned, unless a person labelled it earned in that settling, or -1 (`poolOf`, doubted). */
  doubtedAt: number;
}

/** A dollar cap: the billed dollars a comparison, or a Builder session on its own, may spend
 *  (`billedFor`), and the reserve each solve is held at before it starts. */
export interface Cap {
  readonly dollars: number;
  readonly reserve: number;
}

/**
 * How many moves in a row without a gain end a campaign. The same number bounds supply: Examiner
 * sessions in a row that held out no task, and comparisons of one harness that left no room.
 * Three ended campaigns before their tasks were measured, so the operator chose to err towards
 * more Builder iterations; six stands until a campaign that climbs shows what the figure should be.
 */
export const PATIENCE = 6;
/** The ways a solve ends at one of its own limits: time, model turns or context. The investigation
 *  reads each as a miss at a limit (`tools/wri/time.ts`); the pool reads all but a used-up turn
 *  budget as a cut whose answer is unknown (`taskRecords`). */
export const AT_A_LIMIT: ReadonlySet<unknown> = new Set(["wall-ended", "turns-ended", "context-ended"]);
/** How a session of any seat ends when something outside it stopped it half done: the provider or
 *  the host crashed it, or a stop killed it. */
export const INTERRUPTED: ReadonlySet<unknown> = new Set(["killed", "crashed"]);
const REPORTED = "comparison.reported";
const PROMOTED = "harness.promoted";
const STARTED = "comparison.started";
const BUILD_FINISHED = "build.finished";
/** Whether a cap can hold anything: both its dollars and its reserve are positive numbers. A value
 *  typed with a dollar sign reads as no number, and a session run under it would refuse no solve. */
export function capHolds({ dollars, reserve }: Cap): boolean {
  return [dollars, reserve].every((amount) => Number.isFinite(amount) && amount > 0);
}

/**
 * Each comparison's last report, in the order the comparisons first reported. Old logs may hold
 * ladder readings (`ladder`: the starter read against a new reference on tasks
 * held apart, retired since). They are not steps, starter comparisons or evidence of room, so only
 * `"all"` returns them, for what they show of the reference's solves (`taskRecords`) and for the
 * sessions they name.
 */
export function lastReports(events: readonly LogEvent[], read: "all" | "current" = "current"): Reported[] {
  const found = new Map<string, Reported>();
  for (const [index, { kind, data }] of events.entries()) {
    if (kind !== REPORTED || !isString(data.session) || (data.ladder === true && read !== "all")) continue;
    // A map keeps the position of a key's first entry, which is the comparison's first report.
    found.set(data.session, { session: data.session, index: found.get(data.session)?.index ?? index, data });
  }
  return [...found.values()];
}

/** Each non-ladder comparison session started in `events`, in the order it first began. */
export function startedComparisons(events: readonly LogEvent[]): string[] {
  const seen = new Set<string>();
  for (const { kind, data } of events) {
    if (kind === STARTED && data.ladder !== true && isString(data.session)) seen.add(data.session);
  }
  return [...seen];
}

/**
 * The digest of the harness the last whole Builder session left, or null while none has changed
 * one: the next session starts there unless the operator names another. A killed or crashed
 * session is passed over, except for a snapshot it froze before the interruption. A session that
 * finished whole without changing its parent took its snapshots back: a Builder that compared B,
 * restored its parent and finished left the parent, not B, unless B was promoted meanwhile, since
 * the reference stands whatever the session left.
 */
export function latestBuilt(events: readonly LogEvent[]): string | null {
  const undone = new Set(
    events.flatMap(({ kind, data }) =>
      kind === BUILD_FINISHED && data.changed === false && !INTERRUPTED.has(data.ended) ? [data.session] : [],
    ),
  );
  const made = new Set(events.flatMap(({ kind, data }) => (kind === PROMOTED ? [data.harness] : [])));
  const left = events.findLast(
    ({ kind, data }) =>
      ((kind === "build.checkpoint" && (!undone.has(data.session) || made.has(data.harness))) ||
        (kind === BUILD_FINISHED && data.changed === true && !INTERRUPTED.has(data.ended))) &&
      isString(data.harness),
  )?.data.harness;
  return isString(left) ? left : null;
}

/**
 * The digest of the harness the operator last promoted, or null while none has been, in which case
 * the reference is the starter. A promotion is an event the operator authorised
 * (`tools/d2/promote.ts`); one that names the starter returns the campaign to it.
 */
export function promoted(events: readonly LogEvent[]): string | null {
  const harness = events.findLast(({ kind }) => kind === PROMOTED)?.data.harness;
  return isString(harness) ? harness : null;
}

/** The ending and reason on the log's last event, or null: a campaign that carried on has none. */
export function endedOf(events: readonly LogEvent[]) {
  const last = events.at(-1);
  if (last?.kind !== "campaign.ended" || !isString(last.data.ending)) return null;
  return { ending: last.data.ending, why: isString(last.data.why) ? last.data.why : "" };
}

export const endingOf = (events: readonly LogEvent[]): string | null => endedOf(events)?.ending ?? null;

/** The campaign's reference: the last promoted harness, else its recorded starter, else the old
 *  side of the first report where an older log names no starter. */
export function referenceOf(events: readonly LogEvent[]): string | null {
  const current = promoted(events);
  if (current !== null) return current;
  const reports = lastReports(events);
  const harness = reports.map(({ data }) => data.starter).find(isString) ?? reports[0]?.data.old;
  return isString(harness) ? harness : null;
}

/**
 * The comparisons that measured `harness` as the new side: each one's id, the harness it was read
 * against and its reading. A promotion rests on these, and the operator sees them before one is
 * recorded.
 */
export function comparedAs(events: readonly LogEvent[], harness: string) {
  return lastReports(events).flatMap(({ session, data }) =>
    data.fresh === harness && isString(data.old) && isString(data.reading)
      ? [{ comparison: session, against: data.old, reading: data.reading }]
      : [],
  );
}

/**
 * Whether a comparison left the reference harness anything to improve on. `room` where at least
 * one task was informative for it (`informative`, `compare.ts`); `too-hard` where neither side
 * answered any task validly in any solve; `none` otherwise, where every task it failed is one
 * nobody has answered, so there is nothing to practise on. `side` is the reference's side of the
 * report: `old` when the comparison was made against it, and `fresh` in the comparison it was
 * promoted on, which stands until one made against it reads the tasks.
 */
export function roomOf(report: JsonObject, side: "old" | "fresh" = "old"): "none" | "too-hard" | "room" {
  const valid = asRecord(report.valid);
  const informativeCount = asRecord(valid?.informative)?.[side];
  if (!isNumber(informativeCount) || informativeCount > 0) return "room";
  const anyValid = (counts: unknown) =>
    Array.isArray(counts) && counts.some((n, at) => at > 0 && isNumber(n) && n > 0);
  return anyValid(valid?.old) || anyValid(valid?.fresh) ? "none" : "too-hard";
}

/** The patience the campaign opened with (`--patience`), or `PATIENCE`. */
export function patienceOf(events: readonly LogEvent[]): number {
  const named = events.findLast(({ kind }) => kind === "campaign.opened")?.data.patience;
  return isNumber(named) ? named : PATIENCE;
}

/**
 * The pairs a comparison's last report tallied, rebuilt as the comparison found them: from the log
 * up to its first report, so a task released, refused or disputed since still counts as the scored
 * task it was, under the report's own harnesses and setting, with each side cut to the solves it
 * asked for. Empty for a report that compared nothing. Passes a person settled as wrong count as
 * that side's fails.
 */
export function pairsReported(
  events: readonly LogEvent[],
  report: Reported,
  sides: "both" | "old" | "fresh" = "both",
): Paired[] {
  const { session, index, data } = report;
  const { old, fresh, setting, solves } = data;
  const versions = Array.isArray(data.versions) ? data.versions.filter(isString) : [];
  if (data.scored === null || !isString(old) || !isString(fresh) || !isString(setting) || !isNumber(solves)) {
    return [];
  }
  const opened = events.find(({ kind, data: start }) => kind === STARTED && start.session === session);
  const oldNoiseLog = opened?.data.noise === true;
  const halved = sides !== "both" && !oldNoiseLog;
  if ((sides === "fresh" && oldNoiseLog) || (halved && solves % 2 !== 0)) return [];
  const halves = oldNoiseLog || halved ? ("mirrored" as const) : undefined;
  const selfSide = sides === "both" ? null : sides === "old" ? old : fresh;
  const pairing = {
    old: selfSide ?? old,
    fresh: selfSide ?? fresh,
    setting,
    comparison: session,
    objective: objectiveRuleIn(data),
    halves,
  };
  const wrong = wrongPasses(asRecord(asRecord(data.settled)?.passes) ?? {});
  const perSide = halved ? solves / 2 : solves;
  return pairsOf(failWrongPasses(events.slice(0, index + 1), wrong), versions, pairing, perSide).pairs;
}

/** The tasks to which `place` gives a position, sorted by that position. */
function orderedBy(
  records: readonly TaskRecord[],
  place: (record: TaskRecord) => number | undefined,
): string[] {
  return records
    .flatMap((record) => {
      const at = place(record);
      return at === undefined ? [] : [[record.version, at] as const];
    })
    .toSorted((one, other) => one[1] - other[1])
    .map(([version]) => version);
}

/** The position of the first of `readings` once there are at least `READINGS_IN_A_ROW.unsolved`
 *  of them, or undefined while there are fewer. */
function runStart(readings: readonly TaskReading[]): number | undefined {
  return readings.length >= READINGS_IN_A_ROW.unsolved ? readings[0]?.order : undefined;
}

/** Every task the log holds a state, a solve or a report of, as a `TaskRecord`, and the held-out
 *  tasks in the order they were held out. */
export function taskRecords(events: readonly LogEvent[]) {
  const heldOut = taskSets(events).held;
  const held = new Set(heldOut);
  const records = new Map<string, TaskRecord>();
  const recordOf = (version: string): TaskRecord => {
    const found = records.get(version);
    if (found !== undefined) return found;
    const made: TaskRecord = {
      version,
      held: held.has(version),
      keptAt: -1,
      validAnswer: "none",
      best: null,
      tallied: [],
      asideAt: -1,
      asideOrder: Number.POSITIVE_INFINITY,
      doubtedAt: -1,
    };
    records.set(version, made);
    return made;
  };
  /** Each solve's last recorded turn payload, by the solve's id. */
  const lastTurn = new Map<string, JsonObject>();
  // Every harness that has been the reference: a former reference's valid answer still counts as a
  // reference's after a promotion, so a task it answered never goes to a person as possibly
  // infeasible.
  const references = new Set<unknown>([referenceOf(events)]);
  for (const [index, { kind, data }] of events.entries()) {
    if (kind === "solve.turn" && isString(data.solve)) {
      lastTurn.set(data.solve, data);
      continue;
    }
    if (kind === PROMOTED) {
      references.add(data.harness);
      references.add(data.from);
      continue;
    }
    if (!isString(data.version)) continue;
    if (kind === "task.state" && data.state === "held") recordOf(data.version).keptAt = index;
    const referenceValidAtGate = kind === "task.gate" ? asRecord(data.reference)?.valid : undefined;
    if (kind === "task.feasible" || (isNumber(referenceValidAtGate) && referenceValidAtGate > 0)) {
      recordOf(data.version).validAnswer = "independent";
    }
    if (kind !== "task.feasible") continue;
    const { measure, direction } = asRecord(data.objective) ?? {};
    if (!isNumber(measure)) continue;
    const record = recordOf(data.version);
    record.best = (direction === "lower" ? Math.min : Math.max)(measure, record.best ?? measure);
  }
  /** Solves cut short by a wall-clock or context-window limit (`solveKey`; full model-turn budgets are not cuts unless the last turn hit a window or provider error). */
  const cut = new Set<string>();
  const wrong = wrongPassesIn(events);
  /** Each comparison's rejected solves, keyed as `solveKey` keys them. */
  const rejectedIn = new Map<string, string[]>();
  for (const solve of ranUnder(events)) {
    const { task, limits, harness } = solve.under;
    const { comparison } = solve.start;
    const kind = solve.ending?.kind;
    if (passed(solve) === true && !wrong.has(solve.id)) {
      const record = recordOf(task);
      record.validAnswer =
        references.has(harness) || record.validAnswer === "independent" ? "independent" : "known";
    }
    if (!isString(comparison)) continue;
    const turn = lastTurn.get(solve.id);
    const last = {
      stopReason: isString(turn?.stopReason) ? turn.stopReason : null,
      errorMessage: isString(turn?.error) ? turn.error : null,
    };
    const ranOutOfTurns =
      kind === "turns-ended" && isNumber(limits.modelTurns) && !(windowEnded(last) || providerFailed(last));
    const key = solveKey(comparison, task, harness);
    if (AT_A_LIMIT.has(kind) && !ranOutOfTurns) cut.add(key);
    if (rejected(solve.ending)) rejectedIn.set(key, [...(rejectedIn.get(key) ?? []), solve.id]);
  }
  addReportReadings(events, recordOf, { cut, rejectedIn });
  return { records: [...records.values()], held: heldOut };
}

/** One key for a task under one harness in one comparison. */
function solveKey(comparison: string, task: string, harness: string): string {
  return `${comparison} ${task} ${harness}`;
}

/** The reports' part of `taskRecords`: each comparison's last report adds one reading to every task
 *  it tallied and marks the tasks it set aside, in report order, old ladder readings included. */
function addReportReadings(
  events: readonly LogEvent[],
  recordOf: (version: string) => TaskRecord,
  { cut, rejectedIn }: { cut: ReadonlySet<string>; rejectedIn: ReadonlyMap<string, readonly string[]> },
): void {
  const reference = referenceOf(events);
  const stands = standsOf(events);
  let order = 0;
  for (const report of lastReports(events, "all")) {
    const { index, session, data } = report;
    const side = data.fresh === reference ? "fresh" : data.old === reference ? "old" : null;
    for (const pair of pairsReported(events, report)) {
      const { task, old, fresh } = pair;
      const cutOn = (harness: unknown): boolean =>
        isString(harness) && cut.has(solveKey(session, task, harness));
      const score = differenceOf(pair);
      const referenceCut = side !== null && cutOn(data[side]);
      order += 1;
      recordOf(task).tallied.push({
        index,
        order,
        old,
        fresh,
        reference: side,
        cut: referenceCut ? "reference" : cutOn(data.old) || cutOn(data.fresh) ? "other" : "none",
        won: score > 0 ? "fresh" : score < 0 ? "old" : null,
        by: carriedBy(pointsOf(pair)),
        // An objective gap under the floor decides no pair, so it leaves no room.
        room: side !== null && gapAgainst(pair, side, [recordOf(task).best]),
      });
    }
    for (const task of Array.isArray(data.aside) ? data.aside.filter(isString) : []) {
      order += 1;
      const record = recordOf(task);
      record.asideAt = index;
      record.asideOrder = Math.min(record.asideOrder, order);
      const harness = side === null ? undefined : data[side];
      const own = isString(harness) ? (rejectedIn.get(solveKey(session, task, harness)) ?? []) : [];
      if (own.some((solve) => stands.get(solve) !== "earned")) record.doubtedAt = index;
    }
  }
}

/**
 * Partition held-out tasks and derive Examiner feedback from a single pass over the log:
 * - `scorable`: held-out tasks not excluded by `awaiting` or `doubted`, split into `retained`
 *   (`exhausted` tasks plus tasks held out before the latest promotion) and `frontier` (the rest).
 * - `awaiting`: held-out tasks lacking any `independent` valid answer that the reference failed in
 *   `READINGS_IN_A_ROW.unsolved` comparisons (excluding reference-cut solves) since last kept.
 * - `doubted`: held-out tasks whose latest report set them aside with an unearned reference rejection.
 * - `exhausted`: scorable tasks where the reference's newest `READINGS_IN_A_ROW.easy` uncapped
 *   readings were valid on every solve with no objective headroom (`gapAgainst`).
 * - `practiceFrontier` / `practicePool`: current-epoch held-out candidates for practice release.
 * - `feasible`, `bests`, `outcomes`, `standings`: reference-only task facts exposed to the Examiner (rule 3).
 */
export function poolOf(events: readonly LogEvent[]) {
  const { records, held } = taskRecords(events);
  const heldRecords = records.filter((record) => record.held);
  const awaiting = orderedBy(heldRecords, ({ validAnswer, keptAt, tallied }) =>
    validAnswer === "independent"
      ? undefined
      : runStart(
          tallied.filter(
            ({ reference: side, index, cut }) => side !== null && index >= keptAt && cut !== "reference",
          ),
        ),
  );
  const easy = orderedBy(heldRecords, ({ tallied }) => {
    const readings = tallied.filter(({ reference, cut }) => reference !== null && cut !== "reference");
    const open = readings.findLastIndex(
      (reading) => howOftenValid(referenceSolves(reading)) !== "every" || reading.room,
    );
    return readings.length - 1 - open >= READINGS_IN_A_ROW.easy ? readings.at(-1)?.order : undefined;
  });
  const doubted = orderedBy(heldRecords, ({ doubtedAt, keptAt, tallied }) =>
    doubtedAt > keptAt && doubtedAt > (tallied.at(-1)?.index ?? -1) ? doubtedAt : undefined,
  );
  const leftOut = new Set([...awaiting, ...doubted]);
  const heldBeforePromotion = new Set(beforePromotion(events).held);
  const exhausted = easy.filter((task) => !leftOut.has(task));
  const retained = new Set([
    ...exhausted,
    ...held.filter((task) => heldBeforePromotion.has(task) && !leftOut.has(task)),
  ]);
  const doubtedSet = new Set(doubted);
  const scorable = held.filter((task) => !leftOut.has(task));
  const practiceOut = new Set([...easy, ...leftOut]);
  const firstSeen = ({ tallied, asideOrder }: TaskRecord) =>
    Math.min(tallied[0]?.order ?? asideOrder, asideOrder);
  return {
    scorable,
    frontier: scorable.filter((task) => !retained.has(task)),
    practiceFrontier: held.filter((task) => !heldBeforePromotion.has(task) && !practiceOut.has(task)),
    // What a practice release draws from: current-epoch held tasks not in doubt. Tasks held
    // before the latest promotion stay held for regression scoring rather than filling post-promotion
    // practice. Doubt is read from the reference's own solves alone, so which task another harness
    // won moves nothing here (rule 3).
    practicePool: held.filter((task) => !heldBeforePromotion.has(task) && !doubtedSet.has(task)),
    awaiting,
    doubted,
    exhausted,
    retained: [...retained],
    feasible: new Set(
      records.flatMap(({ version, validAnswer }) => (validAnswer === "none" ? [] : [version])),
    ),
    bests: new Map(records.flatMap(({ version, best }) => (best === null ? [] : [[version, best] as const]))),
    outcomes: new Map(records.toSorted((one, other) => firstSeen(one) - firstSeen(other)).flatMap(outcomeOf)),
    standings: new Map(records.flatMap(standingOf)),
  };
}

/** The reference harness's own solves of a task in one comparison, or none where it stood on
 *  neither side. */
function referenceSolves({ reference, old, fresh }: TaskReading): readonly boolean[] {
  return reference === "old" ? old : reference === "fresh" ? fresh : [];
}

/** How often the reference answered a task validly in one comparison, or null where it stood on
 *  neither side. */
function referenceValidity(reading: TaskReading): "every" | "some" | "none" | null {
  return reading.reference === null ? null : howOftenValid(referenceSolves(reading));
}

/** What a task's author hears of it (`poolOf`, outcomes), or nothing where no report read it. */
function outcomeOf(record: TaskRecord): [string, Outcome][] {
  const { version } = record;
  const last = lastReading(record);
  if (last === null) return [];
  if (last === "aside") return [[version, "disputed"]];
  const side = referenceValidity(last);
  return [[version, side === null ? "earlier-reference" : `reference-${side}`]];
}

/** Who won a task the last time it was compared with the reference (`poolOf`, standings), or
 *  nothing where its last reading had no reference side or set it aside. */
function standingOf(record: TaskRecord): [string, Standing][] {
  const last = lastReading(record);
  if (last === null || last === "aside" || last.reference === null) return [];
  const { reference, won, by } = last;
  return [[record.version, { won: won === null ? null : won === reference ? "reference" : "other", by }]];
}

/** Task sets held and released just before the latest promotion, or empty before any promotion. */
function beforePromotion(events: readonly LogEvent[]) {
  const promotedAt = events.findLastIndex(({ kind }) => kind === PROMOTED);
  return taskSets(events.slice(0, Math.max(0, promotedAt)));
}

/**
 * Select `count` tasks from `pool` for practice release (`tools/d2/prepare.ts`), in priority order:
 * 1. Current-epoch tasks the reference answered validly in no solve across `READINGS_IN_A_ROW.unsolved`
 *    or more comparisons (`unanswered`).
 * 2. The first half (rounded down) of remaining current-epoch tasks where the reference failed a
 *    solve or left objective headroom (`room`) in its latest reading (`failed`).
 * 3. A seeded draw (`draw`) over the remaining tasks in `pool`.
 * Depends only on reference solves and author answers so candidate performance never crosses the wall (rule 3).
 */
export function releaseOrder(
  events: readonly LogEvent[],
  pool: readonly string[],
  count: number,
  seed: string,
): [string, string][] {
  const { records } = taskRecords(events);
  const { released } = taskSets(events);
  const prior = beforePromotion(events);
  const priorEpoch = new Set([...prior.held, ...prior.released]);
  const eligible = records.filter(
    ({ held, version }) => !priorEpoch.has(version) && (held || released.includes(version)),
  );
  const inPool = (versions: readonly string[]) => versions.filter((version) => pool.includes(version));
  const unanswered = orderedBy(eligible, ({ tallied }) => {
    const own = tallied.filter(({ reference }) => reference !== null);
    return own.some((reading) => referenceValidity(reading) !== "none") ? undefined : runStart(own);
  });
  const failed = orderedBy(eligible, (record) => {
    const last = lastReading(record);
    if (last === null || last === "aside" || last.reference === null) return undefined;
    return last[last.reference].some((valid) => !valid) || last.room ? last.order : undefined;
  }).filter((version) => !unanswered.includes(version));
  const releasedFirst = inPool([...unanswered, ...failed.slice(0, Math.floor(failed.length / 2))]);
  const rest = pool.filter((version) => !releasedFirst.includes(version) && !failed.includes(version));
  const chosen = [
    ...releasedFirst.slice(0, count),
    ...draw(rest, Math.min(rest.length, Math.max(0, count - releasedFirst.length)), seed),
  ];
  return chosen.map((version) => {
    const why = unanswered.includes(version)
      ? ": the reference harness answered it in no solve of two comparisons, and it is"
      : failed.includes(version)
        ? ": the reference harness failed it in the last comparison, or a better answer on record left it room, and it is"
        : ":";
    return [version, why];
  });
}

/** The reading a task's outcome, standing and release come from: the last comparison that tallied
 *  it, `"aside"` where a later report set it aside, or null where no report did either. */
function lastReading({ tallied, asideAt }: TaskRecord): TaskReading | "aside" | null {
  const last = tallied.at(-1);
  if (last === undefined) return asideAt === -1 ? null : "aside";
  return asideAt > last.index ? "aside" : last;
}

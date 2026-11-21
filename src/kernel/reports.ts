/**
 * What the comparisons on record say about a campaign: which harness is the reference, how each
 * comparison read, where each held-out task stands and what its author may hear of it (`poolOf`),
 * and which tasks a practice release takes first (`releaseOrder`).
 *
 * A comparison ends in a `comparison.reported` event under its id (a round's session id, or a
 * standalone comparison's own). A person's settling writes the same id's report again, so a
 * comparison is read from its last report but keeps the place of its first: a settling made weeks
 * later does not move a comparison behind the ones run since. A comparison's solves are the ones
 * whose start names it (`compare.ts`).
 *
 * The reference harness is the one comparisons are made against: the Starter Built Harness until
 * the operator promotes another, then the one last promoted (`promoted`). The Builder carries on
 * from the harness its last session left (`latestBuilt`), whether or not that session's comparison
 * read a step.
 *
 * Pass labels a person settled as wrong count as fails everywhere here (`history.ts`), so a wrong
 * pass is neither a valid answer on record nor a win in a reported pair. The patience a campaign
 * keeps is `patienceOf`'s; the stop rule that counts against it is admission's (`stopRule`).
 *
 * Nothing here decides a comparison or makes a solve.
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
import { tracesIn } from "./trace.ts";

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

/**
 * The digest of the harness the last whole Builder session left, or null while none has changed
 * one: the next session starts there unless the operator names another. A killed or crashed
 * session is passed over, except for a snapshot it froze before the interruption. A session that
 * finished whole without changing its parent took its snapshots back: a Builder that compared B,
 * restored its parent and finished left the parent, not B.
 */
export function latestBuilt(events: readonly LogEvent[]): string | null {
  const undone = new Set(
    events.flatMap(({ kind, data }) =>
      kind === BUILD_FINISHED && data.changed === false && !INTERRUPTED.has(data.ended) ? [data.session] : [],
    ),
  );
  const left = events.findLast(
    ({ kind, data }) =>
      ((kind === "build.checkpoint" && !undone.has(data.session)) ||
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
  const reports = lastReports(events);
  const harness =
    promoted(events) ?? reports.map(({ data }) => data.starter).find(isString) ?? reports[0]?.data.old;
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
 *
 * With `sides` set to "old" or "fresh", that side's harness is read against itself instead (an
 * A/A control): its solves of each task are split into two halves mirrored in time, and "old" is
 * the reference's A/A (`noise`, `comparison.ts`). Empty where a side's solves do not split evenly.
 * A report of two solves a side written before the mirror ran across tasks (`pairsOf`) recorded an
 * older split, so this can differ from that report's own `noise`, which stays as written. An older
 * `--noise` log holds only the reference's A/A, on its first mirrored half.
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
  for (const [index, { kind, data }] of events.entries()) {
    if (!isString(data.version)) continue;
    if (kind === "task.state" && data.state === "held") recordOf(data.version).keptAt = index;
    const referenceValidAtGate = kind === "task.gate" ? asRecord(data.reference)?.valid : undefined;
    if (kind === "task.feasible" || (isNumber(referenceValidAtGate) && referenceValidAtGate > 0)) {
      recordOf(data.version).validAnswer = "independent";
    }
    const { measure, direction } = asRecord(data.objective) ?? {};
    if (kind !== "task.feasible" || !isNumber(measure)) continue;
    const record = recordOf(data.version);
    record.best = (direction === "lower" ? Math.min : Math.max)(measure, record.best ?? measure);
  }
  /**
   * The solves a limit cut short, keyed by comparison, task and harness (`solveKey`): what such a
   * solve would have answered is unknown (rule 7). A deadline runs on the host's clock, which load
   * moves, and a full context is no number the solver is told, so neither says anything about the
   * task. A solve that used every model turn its condition names is the opposite case: the solver
   * is told the turns left on every tool result, so using them all without an answer is the
   * budget's verdict, as a wrong answer is. Counting those as cuts once kept unanswerable tasks in
   * the draw for good, scored again and again as a tie of two fails. A turn budget ended by the
   * provider window or a provider failure on the last turn (older logs record those as
   * `turns-ended` too) still counts as a cut.
   */
  const cut = new Set<string>();
  /** Each solve's last recorded turn, by the solve's id. */
  const lastTurn = new Map(
    tracesIn(events).flatMap((trace) =>
      trace.seat === "solve" && trace.part === "turn" ? [[trace.id, trace]] : [],
    ),
  );
  // Every harness that has been the reference: a former reference's valid answer still counts as a
  // reference's after a promotion, so a task it answered never goes to a person as possibly
  // infeasible.
  const references = new Set([
    referenceOf(events),
    ...events.flatMap(({ kind, data }) => (kind === PROMOTED ? [data.harness, data.from] : [])),
  ]);
  const wrong = wrongPassesIn(events);
  /** Each comparison's rejected solves, keyed as `solveKey` keys them. */
  const rejectedIn = new Map<string, string[]>();
  for (const solve of ranUnder(events)) {
    const { task, limits, harness } = solve.under;
    const { comparison } = solve.start;
    const kind = solve.ending?.kind;
    const turn = lastTurn.get(solve.id);
    const last = { stopReason: turn?.stopReason, errorMessage: turn?.error };
    const interrupted = windowEnded(last) || providerFailed(last);
    const ranOutOfTurns = kind === "turns-ended" && isNumber(limits.modelTurns) && !interrupted;
    if (passed(solve) === true && !wrong.has(solve.id)) {
      const record = recordOf(task);
      record.validAnswer =
        references.has(harness) || record.validAnswer === "independent" ? "independent" : "known";
    }
    if (isString(comparison) && AT_A_LIMIT.has(kind) && !ranOutOfTurns) {
      cut.add(solveKey(comparison, task, harness));
    }
    if (isString(comparison) && rejected(solve.ending)) {
      const key = solveKey(comparison, task, harness);
      rejectedIn.set(key, [...(rejectedIn.get(key) ?? []), solve.id]);
    }
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
 * Where each held-out task stands, and what its author may hear of each task a comparison read.
 * Every reader of a task's state reads it here, from one pass over the log.
 *
 * **Scorable** tasks are the held-out ones not taken out for review or doubt, in the order they
 * were held out. They split into **retained** and **frontier**: the step reads both, the supply
 * counts only the frontier (`supplyOf`, `admission.ts`).
 *
 * **Awaiting** tasks go to a person as possibly infeasible. Nothing on record answers them
 * validly, and two comparisons in which no limit cut a solve short (counted from the last time a
 * person kept the task) gave no valid answer either. Such a task ties whatever the harnesses are
 * and costs solves at every comparison. It may be hard, wrongly checked, or impossible, and only a
 * person can tell the last apart, so it leaves the scored set until it is labelled
 * (`tools/d2/prepare.ts`). Two guards keep a short budget from sending an answerable task there:
 * an independent valid answer (`TaskRecord.validAnswer`) settles the question for good, and a
 * comparison where a limit cut one of the task's solves short is not counted. A solve that used
 * every model turn was not cut, and its comparison counts. A label that keeps the task holds it
 * again and restarts the count; a label that calls it infeasible refuses it.
 *
 * **Doubted** tasks leave the scored set and the practice allowance too: the last comparison that
 * read the task set it aside, and a rejection of the reference's own solve there stands unearned
 * (ruled a check defect, unclear or not ruled) with no person's label calling it earned. Drawn
 * again, such tasks were set aside again and their solves and rulings paid for nothing. A settling
 * that labels the rejection earned returns the task, as does a person keeping it afterwards. Only
 * the reference's own rejections count: a candidate's moves nothing the Builder is told (rule 3).
 * Only the log page reads the list.
 *
 * **Exhausted** tasks are the ones the reference has been read easy on: its newest
 * `READINGS_IN_A_ROW.easy` readings of the task were each valid in every one of its own solves,
 * with no room by the objective (`gapAgainst`: its own measures and its author's, never the other
 * harness's). A reading counts only where no limit cut the reference's own solve short. Only the
 * reference's solves count because the frontier sets the size the Builder is told, which must not
 * move with which task the other harness failed (rule 3). The rule uses every, some and none rather
 * than a ratio, so it reads the same at any number of solves, and it is re-derived against
 * whichever harness is the reference now, so a promotion resets it at once.
 *
 * **Retained** tasks are the exhausted ones plus every task held out before the last promotion:
 * those were written for the harness it replaced, and the comparison that chose the new reference
 * read them, so drawing them again as frontier would let its starter comparison confirm it on its
 * own draw. Retained tasks stay scorable, so a harness that breaks what the reference answers
 * still shows its losses; reported apart they show a regression. **Frontier** is the rest.
 *
 * Scorable tasks include a family's siblings; families are reported beside the test
 * (`compared`'s `families`) and decide nothing.
 *
 * **Feasible** tasks are the versions with any valid answer on record, under any harness and at
 * any limits. It is the one fact an author may hear beside an outcome that names no side: it tells
 * a task the reference never answers apart from one nobody has answered. **Bests** are the best
 * objective value of an author's answer on record for each task that carries one, so a task the
 * reference answers alike every time can still leave room (`informative`, `compare.ts`).
 *
 * **Outcomes** give each task some comparison scored or set aside, by version, how the reference
 * did in the last such comparison: valid in every counted solve, in some, or in none. An author
 * may hear this because without it they would hear nothing, and
 * v1 found that authors write towards a difficulty zone. Only the reference's side is read: which
 * other harness was compared and what it answered are not the author's to hear. The outcome comes
 * from the last report whatever setting id it carries, since a campaign runs at one setting and the
 * id also names the host's code, which moves with the tree's commit. The reference's side is the
 * one `TaskReading.reference` names; a comparison between two other harnesses (a standalone one, or
 * one made before a third was promoted) gives `earlier-reference`.
 *
 * **Standings** give, by version, who won each task the last time it was compared with the
 * reference on one side, and on which measure (`Standing`). They come from the same reading as the
 * outcome (`lastReading`), so the two always agree; a task last compared between two other harnesses,
 * or last set aside, has none.
 */
export function poolOf(events: readonly LogEvent[]) {
  const { records, held } = taskRecords(events);
  const heldRecords = records.filter((record) => record.held);
  const awaiting = orderedBy(heldRecords, ({ validAnswer, keptAt, tallied }) =>
    runStart(
      tallied.filter(({ index, cut }) => validAnswer !== "independent" && index >= keptAt && cut === "none"),
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
  const promotedAt = events.findLastIndex(({ kind }) => kind === PROMOTED);
  const heldBeforePromotion = new Set(taskSets(events.slice(0, Math.max(0, promotedAt))).held);
  const exhausted = easy.filter((task) => !leftOut.has(task));
  const inherited = held.filter((task) => heldBeforePromotion.has(task) && !leftOut.has(task));
  const retained = [...new Set([...exhausted, ...inherited])];
  const scorable = held.filter((task) => !leftOut.has(task));
  // The practice allowance also leaves out a task with no independent valid answer that the
  // reference failed in two comparisons. Unlike `awaiting`, only the reference's own cut solves
  // pass a comparison over, so the allowance reads nothing of the other harness (rule 3).
  const practiceOut = new Set([
    ...easy,
    ...doubted,
    ...orderedBy(heldRecords, ({ validAnswer, keptAt, tallied }) =>
      validAnswer === "independent"
        ? undefined
        : runStart(
            tallied.filter(
              ({ reference: side, index, cut }) => side !== null && index >= keptAt && cut !== "reference",
            ),
          ),
    ),
  ]);
  const firstSeen = ({ tallied, asideOrder }: TaskRecord) =>
    Math.min(tallied[0]?.order ?? asideOrder, asideOrder);
  return {
    scorable,
    frontier: scorable.filter((task) => !retained.includes(task)),
    practiceFrontier: held.filter((task) => !heldBeforePromotion.has(task) && !practiceOut.has(task)),
    // What a practice release draws from. Doubt is read from the reference's own solves alone, so
    // which task another harness won moves nothing here (rule 3).
    practicePool: held.filter((task) => !doubted.includes(task)),
    awaiting,
    doubted,
    exhausted,
    retained,
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

/**
 * The `count` tasks of `pool` a practice release takes, each with the reason, in the order taken.
 *
 * First come the tasks the reference never answered: held-out tasks it gave no valid answer in
 * `READINGS_IN_A_ROW.unsolved` or more comparisons it stood in, whether or not a limit cut them
 * short. They are what a Builder session has to work on, when every released task already passes.
 * A task only another harness answered goes too, since letting another harness's answer keep it
 * off the list would tell the Builder which held-out task its harness won (rule 3).
 *
 * Next, half (rounded down) of the tasks the reference failed or left room on in its last reading:
 * a task whose last scored result has a failed reference solve, or where an answer of its own or
 * its author's on record beats it by at least the gap floor (`room`). In an objective domain every
 * solve is valid, so room is the only way such a task reaches this list. Half are kept back so the
 * comparison keeps tasks it can untie; rounding up once released the only failed task of one. The
 * half is drawn from the whole reading, released tasks included, so repeated one-task releases
 * keep the same half held. Disputed and refused tasks have no place in it.
 *
 * The rest is the contract's seeded draw over every task neither list holds, those the reference
 * answers every time included, since a practice pass still reports the objective's measure. Room
 * is read from the reference's own solves and its author's answers only, never another harness's,
 * so which held-out task a new harness won changes nothing the Builder reads (rule 3). The release
 * in `tools/d2/prepare.ts` calls this.
 */
export function releaseOrder(
  events: readonly LogEvent[],
  pool: readonly string[],
  count: number,
  seed: string,
): [string, string][] {
  const { records } = taskRecords(events);
  const { released } = taskSets(events);
  const eligible = records.filter(({ held, version }) => held || released.includes(version));
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

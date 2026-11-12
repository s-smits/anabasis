/**
 * What the comparisons on record say of a campaign: whether it should stop, each report read as it
 * was found, the one place each held-out task has and what its author may hear of it (`poolOf`),
 * the tasks a release takes first (`releaseOrder`), and what the log holds of billed dollars.
 *
 * A comparison ends in a `comparison.reported` event under an id, a round's session id or a standalone
 * comparison's own id (`src/campaign/round.ts`). A person's settling writes the same id's report once
 * more, so a comparison is read by its last report, and it stands in the log where its first one does:
 * a settling made weeks later moves no comparison behind the ones run since. Every fold here starts
 * from those. A comparison's solves are the ones whose start names it (`compare.ts`).
 *
 * The harness a comparison is made against is the reference harness: the Starter Built Harness
 * until the operator promotes another, and from then on the one last promoted (`promoted`). The
 * choice is the operator's and the record is the log's (`7f0add79:docs/plan.md`, Phase 6). A Builder goes
 * on from the harness its last session left (`latestBuilt`), step or none.
 * Practice priority reads each task's last scored or disputed result, as its outcome does.
 * Its allowance keeps a reference-only frontier in this same fold (rule 3).
 *
 * The improvement patience a campaign keeps is `patienceOf`'s; the stop rule that counts it is
 * admission's (`stopRule`, `src/campaign/admission.ts`). Reported pairs and known valid answers
 * read history's view of a person's pass labels, so a pass labelled wrong counts as valid in
 * neither.
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
import { failWrongPasses, proposalsOf, wrongPasses, wrongPassesIn } from "./history.ts";
import type { LogEvent } from "./log.ts";
import { providerFailed, windowEnded } from "./solve.ts";
import { passed, ranUnder, rejected, standsOf } from "./solves.ts";
import { RUNS, spreadOf } from "./size.ts";
import { taskSets } from "./task.ts";
import { tracesIn } from "./trace.ts";

/** A comparison's last report, with where the comparison stands in the log: at its first report. */
export interface Reported {
  readonly session: string;
  readonly index: number;
  readonly data: JsonObject;
}

/** What a task's author hears of it: how the reference harness did on it in the last comparison
 *  that scored it (every solve valid, some, none); that the last comparison that scored it was
 *  made between two other harnesses, so nothing of the reference's own is on record for it; or
 *  that it was set aside. */
export type Outcome =
  | "reference-every"
  | "reference-some"
  | "reference-none"
  | "earlier-reference"
  | "disputed";

/** How a task's last comparison with the reference harness on a side went, as its author hears it
 *  (`poolOf`, standings). */
export interface Standing {
  /** The harness that won the task there, the reference or the other side, null for a tie. */
  readonly won: "reference" | "other" | null;
  /** The measure that carried a win there (`carriedBy`), null for a tie. */
  readonly by: keyof Measures | null;
}

/** One comparison's reading of a task, as the comparison's last report tallied it. */
interface TalliedIn {
  /** The index of the report in the log. */
  readonly index: number;
  /** Its place among every pair of every report, in the order the reports are read. */
  readonly order: number;
  /** Each side's counted solves: valid or not, as the pair holds them. */
  readonly old: readonly boolean[];
  readonly fresh: readonly boolean[];
  /** The side the campaign's reference harness stood on, or null where it was neither. */
  readonly reference: "old" | "fresh" | null;
  /** Whose solve of the task a limit cut short in this comparison (`taskRecords`): one of the reference
   *  harness's own, which is all its author hears (rule 4), only another harness's, or none. */
  readonly cut: "reference" | "other" | "none";
  /** The side that won the task in this comparison's tally (`tally`), or null for a tie. */
  readonly won: "old" | "fresh" | null;
  /** The measure that carried the win (`carriedBy`), null for a tie. */
  readonly by: keyof Measures | null;
  /** Whether the reference harness's answers left an objective gap there, against its own and its
   *  author's (`gapAgainst`); false under the floor (`ROOM`), and where it stood on neither side. */
  readonly room: boolean;
}

/**
 * What a log holds of one task, for every reader of its state: the pool and the release are predicates
 * over it, since while each read the log for itself their arithmetic was mended four times
 * (`7f0add79:docs/simplify.md`, C1). Filled by `taskRecords`, which is why its fields are not
 * read-only.
 */
interface TaskRecord {
  readonly version: string;
  /** Whether the task is held out now. */
  readonly held: boolean;
  /** The last event at which a person kept it held (`task.state`), or -1. */
  keptAt: number;
  /** The valid answer on record. `independent` is one known apart from the other harness: an
   *  author's answer (`task.feasible`), an earlier log's gate recording that a reference solve under
   *  `try_task` gave one, which reveals no answer, or a valid solve of a harness that is or was the
   *  reference; the practice allowance and the wait for a person read only this evidence. `known` is
   *  a valid solve of another harness alone. */
  validAnswer: "independent" | "known" | "none";
  /** The best measure by the objective of an author's answer on record (`task.feasible`), or null
   *  where none carries one (`informative`, `compare.ts`; 19 October). */
  best: number | null;
  /** Each comparison whose last report tallied it, in the order the comparisons reported. */
  readonly tallied: TalliedIn[];
  /** The last report that set it aside on a rejection, or -1, and its place among every pair
   *  and every task set aside, as `TalliedIn.order` counts them, where it was first set aside. */
  asideAt: number;
  asideOrder: number;
  /** The last report that set it aside on a rejection of the reference harness's own that stands
   *  unearned there, by a person's label where its settling holds one, or -1 (`poolOf`, doubted). */
  doubtedAt: number;
}

/** A dollar cap: the billed dollars a comparison, or a Builder session by itself, may hold
 *  (`billedFor`, a session's whole span), and what each solve is held at before it starts. */
export interface Cap {
  readonly dollars: number;
  readonly reserve: number;
}

/**
 * The default improvement patience bounds moves without a gain. The same value bounds supply patience:
 * Examiner sessions in a row that held out no task and comparisons of one harness that left no room.
 * The plan's three ended every campaign of 9 and 10 October before its tasks were measured, and the
 * operator set the development phase to err towards more iterations of the Builder than fewer: six,
 * until a campaign climbs and the figure can be read from its record.
 */
export const PATIENCE = 6;
/** The ways a solve ends at a limit of its own: its time, its model turns or its context. The
 *  investigation reads every one as a miss at a limit (`tools/wri/time.ts`); the pool reads all but
 *  one as a cut whose answer is not known (`taskRecords`). */
export const AT_A_LIMIT: ReadonlySet<unknown> = new Set(["wall-ended", "turns-ended", "context-ended"]);
/** How a session of any seat ends when it was cut and left half its work: the provider or host
 *  crashed it, or a stop killed it. */
export const CUT: ReadonlySet<unknown> = new Set(["killed", "crashed"]);
const REPORTED = "comparison.reported";
const PROMOTED = "harness.promoted";
const STARTED = "comparison.started";
const BUILD_FINISHED = "build.finished";
/** Whether a cap can hold anything: its dollars and its reserve are numbers above nothing. One
 *  typed with a dollar sign reads as no number, and a session run under it would refuse no solve
 *  (the third review, row F43). */
export function capHolds({ dollars, reserve }: Cap): boolean {
  return [dollars, reserve].every((amount) => Number.isFinite(amount) && amount > 0);
}

/**
 * Each comparison's last report in a log, in the order the comparisons first reported. A log of
 * 14 to 16 October may hold readings of the ladder (`ladder`), the starter against a new reference
 * after a promotion on tasks held apart, retired on 16 October: they are no step, no starter comparison and
 * no room, and only `"all"` reads them, for what they found of the reference's solves of tasks now
 * held out (`taskRecords`) and for the sessions they name.
 */
export function lastReports(events: readonly LogEvent[], read: "all" | "current" = "current"): Reported[] {
  const found = new Map<string, Reported>();
  for (const [index, { kind, data }] of events.entries()) {
    if (kind !== REPORTED || !isString(data.session) || (data.ladder === true && read !== "all")) continue;
    // A map keeps the place of a key's first entry, which is the comparison's first report.
    found.set(data.session, { session: data.session, index: found.get(data.session)?.index ?? index, data });
  }
  return [...found.values()];
}

/**
 * The harness the last whole Builder session left, by its digest, or null while none has changed
 * one. It is where the next session starts unless the operator names another: after a comparison
 * without a step the Builder continues from its latest harness (`7f0add79:docs/plan.md`, Phase 5). A session
 * that was killed or that crashed is passed over, except for a harness snapshot already frozen inside
 * its live conversation: that version was kept before the interruption. A session that finished whole
 * on its parent took its snapshots back: a Builder that compared B, restored its parent and finished
 * left the parent, and until 29 October the next session opened on B (a GPT audit, from source).
 */
export function latestBuilt(events: readonly LogEvent[]): string | null {
  const undone = new Set(
    events.flatMap(({ kind, data }) =>
      kind === BUILD_FINISHED && data.changed === false && !CUT.has(data.ended) ? [data.session] : [],
    ),
  );
  const left = events.findLast(
    ({ kind, data }) =>
      ((kind === "build.checkpoint" && !undone.has(data.session)) ||
        (kind === BUILD_FINISHED && data.changed === true && !CUT.has(data.ended))) &&
      isString(data.harness),
  )?.data.harness;
  return isString(left) ? left : null;
}

/**
 * The harness the operator last promoted to be the reference, by its digest, or null while none
 * has been: the reference harness is then the starter. A promotion is an event the operator
 * authorised (`tools/d2/promote.ts`), and one that names the starter returns the campaign to it.
 */
export function promoted(events: readonly LogEvent[]): string | null {
  const harness = events.findLast(({ kind }) => kind === PROMOTED)?.data.harness;
  return isString(harness) ? harness : null;
}

/** The ending the log's last event carries and its reason, or null: a campaign that went on has none. */
export function endedOf(events: readonly LogEvent[]) {
  const last = events.at(-1);
  if (last?.kind !== "campaign.ended" || !isString(last.data.ending)) return null;
  return { ending: last.data.ending, why: isString(last.data.why) ? last.data.why : "" };
}

export const endingOf = (events: readonly LogEvent[]): string | null => endedOf(events)?.ending ?? null;

/** The campaign's reference: last promoted, otherwise its recorded starter, or the first old
 *  side where an earlier log names no starter. */
export function referenceOf(events: readonly LogEvent[]): string | null {
  const reports = lastReports(events);
  const harness =
    promoted(events) ?? reports.map(({ data }) => data.starter).find(isString) ?? reports[0]?.data.old;
  return isString(harness) ? harness : null;
}

/**
 * The comparisons that measured `harness` as their new harness, as their last reports hold them:
 * each one's id, the harness it was read against and how it read. It is what a promotion rests
 * on, and what the operator is shown before one is recorded.
 */
export function comparedAs(events: readonly LogEvent[], harness: string) {
  return lastReports(events).flatMap(({ session, data }) =>
    data.fresh === harness && isString(data.old) && isString(data.reading)
      ? [{ comparison: session, against: data.old, reading: data.reading }]
      : [],
  );
}

/**
 * What room a comparison's report shows a harness to gain in (`7f0add79:docs/plan.md`, "How move 7
 * decides"): `room` where a task was informative for the reference harness (`informative`,
 * `compare.ts`: valid on some solves and not all, two valid answers apart by the objective past its
 * margin, or valid on none where a valid answer to it is on record), `too-hard` where neither
 * harness was valid on any solve and no task has a valid answer on record, and `none` otherwise,
 * the tasks it fails in every solve that nobody answered among them, which leave it nothing to
 * practise on. `side` is the reference's side of the report: `old` in a comparison made against
 * it, and `fresh` in the one it was promoted on, which stands until one against it reads the tasks.
 */
export function roomOf(report: JsonObject, side: "old" | "fresh" = "old"): "none" | "too-hard" | "room" {
  const valid = asRecord(report.valid);
  const told = asRecord(valid?.informative)?.[side];
  if (!isNumber(told) || told > 0) return "room";
  const anyValid = (counts: unknown) =>
    Array.isArray(counts) && counts.some((n, at) => at > 0 && isNumber(n) && n > 0);
  return anyValid(valid?.old) || anyValid(valid?.fresh) ? "none" : "too-hard";
}

/** The improvement patience and supply patience as the opening records them (`--patience`), or `PATIENCE`. */
export function patienceOf(events: readonly LogEvent[]): number {
  const named = events.findLast(({ kind }) => kind === "campaign.opened")?.data.patience;
  return isNumber(named) ? named : PATIENCE;
}

/**
 * The pairs a comparison's last report tallied, read as the comparison found them: from the log up
 * to its first report, so a task released, refused or disputed since is still the scored task it
 * was, under the report's own two harnesses and setting, counting the comparison's own solves, and
 * each side cut to the solves it asked for (in an older `--noise` log, the reference's first
 * mirrored half, `halves`). None for a report that compared nothing, or before a solve named its
 * comparison. Its settled wrong passes count as that side's fails.
 *
 * With `sides` "old" or "fresh", that side's harness is read against itself instead, its solves of
 * each task split into halves mirrored in time: "old" is the reference's A/A as a report of this
 * tree reads it (`noise`, `comparison.ts`). A report of two solves a side written before the mirror
 * ran on from one task to the next (`pairsOf`) recorded the earlier split, so this fold can differ
 * from that report's own `noise`, which stays as written. A fold over solves already paid for, none
 * where a side's solves do not split evenly; in an older `--noise` log only the reference's A/A, on
 * its two mirrored halves.
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
  const begun = events.find(({ kind, data: start }) => kind === STARTED && start.session === session);
  const legacy = begun?.data.noise === true;
  const split = sides !== "both" && !legacy;
  if ((sides === "fresh" && legacy) || (split && solves % 2 !== 0)) return [];
  const halves = legacy || split ? ("mirrored" as const) : undefined;
  const itself = sides === "both" ? null : sides === "old" ? old : fresh;
  const pairing = {
    old: itself ?? old,
    fresh: itself ?? fresh,
    setting,
    comparison: session,
    objective: objectiveRuleIn(data),
    halves,
  };
  const wrong = wrongPasses(asRecord(asRecord(data.settled)?.passes) ?? {});
  const each = split ? solves / 2 : solves;
  return pairsOf(failWrongPasses(events.slice(0, index + 1), wrong), versions, pairing, each).pairs;
}

/** The tasks `place` gives a place, in the order of their places: the first pair that
 *  put each on the list. */
function placed(records: readonly TaskRecord[], place: (record: TaskRecord) => number | undefined): string[] {
  return records
    .flatMap((record) => {
      const at = place(record);
      return at === undefined ? [] : [[record.version, at] as const];
    })
    .toSorted((one, other) => one[1] - other[1])
    .map(([version]) => version);
}

/** Where `RUNS.unsolved` or more of `runs` first stood, or undefined where they are fewer. */
function runOf(runs: readonly TalliedIn[]): number | undefined {
  return runs.length >= RUNS.unsolved ? runs[0]?.order : undefined;
}

/** Every task a log holds a state, a solve or a report of, each as `TaskRecord` reads it, and the
 *  held-out ones in the order they were held out. */
export function taskRecords(events: readonly LogEvent[]) {
  const heldOut = taskSets(events).held;
  const held = new Set(heldOut);
  const records = new Map<string, TaskRecord>();
  const of = (version: string): TaskRecord => {
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
    if (kind === "task.state" && data.state === "held") of(data.version).keptAt = index;
    const tried = kind === "task.gate" ? asRecord(data.reference)?.valid : undefined;
    if (kind === "task.feasible" || (isNumber(tried) && tried > 0)) {
      of(data.version).validAnswer = "independent";
    }
    const { measure, direction } = asRecord(data.objective) ?? {};
    if (kind !== "task.feasible" || !isNumber(measure)) continue;
    const record = of(data.version);
    record.best = (direction === "lower" ? Math.min : Math.max)(measure, record.best ?? measure);
  }
  /**
   * Each comparison's tasks a solve of which a limit cut short, by harness, as `cutIn` names them:
   * what that solve would have answered is not known (rule 7). The deadline is the host's clock, which
   * a loaded host moves, and a full context is no number the solver is told: neither says anything
   * of the task. A solve that ends `turns-ended` under the model turns its condition names
   * (`--solve-model-turns`) is the opposite case. The turns are the budget's unit, told to the
   * solver on every tool result, and using them all without an answer is the budget's verdict that
   * the harness did not answer the task within it, as a wrong answer is. Read as a cut until
   * 19 October, it kept a task no solve answers in the draw for good: in the rehearsals sim-turns
   * and sim-turns2, 706 of 1,144 scripted solves ended so, and each such task was scored again as a
   * tie of two fails. `turns-ended` arises only where the condition names a number (`spent`,
   * `src/solver/run.ts`), so a campaign without one reads as before. One whose last recorded turn
   * the window ended (`windowEnded`), or the provider failed (`providerFailed`), stays a cut: a log
   * written before 19 October, or 14 October, holds such solves as `turns-ended`, and they read as
   * they did.
   */
  const cut = new Set<string>();
  /** Each solve's last recorded turn, by the solve's id. */
  const lastTurn = new Map(
    tracesIn(events).flatMap((each) =>
      each.seat === "solve" && each.part === "turn" ? [[each.id, each]] : [],
    ),
  );
  // Every harness that has been the reference: a former one's valid answer stays a reference's
  // after a promotion, so a task it answered never goes to a person as possibly infeasible.
  const references = new Set([
    referenceOf(events),
    ...events.flatMap(({ kind, data }) => (kind === PROMOTED ? [data.harness, data.from] : [])),
  ]);
  const wrong = wrongPassesIn(events);
  /** Each comparison's rejected solves, by task and harness, as `cutIn` names them. */
  const rejectedIn = new Map<string, string[]>();
  for (const solve of ranUnder(events)) {
    const { task, limits, harness } = solve.under;
    const { comparison } = solve.start;
    const kind = solve.ending?.kind;
    const turn = lastTurn.get(solve.id);
    const last = { stopReason: turn?.stopReason, errorMessage: turn?.error };
    const interrupted = windowEnded(last) || providerFailed(last);
    const budgeted = kind === "turns-ended" && isNumber(limits.modelTurns) && !interrupted;
    if (passed(solve) === true && !wrong.has(solve.id)) {
      const record = of(task);
      record.validAnswer =
        references.has(harness) || record.validAnswer === "independent" ? "independent" : "known";
    }
    if (isString(comparison) && AT_A_LIMIT.has(kind) && !budgeted) cut.add(cutIn(comparison, task, harness));
    if (isString(comparison) && rejected(solve.ending)) {
      const key = cutIn(comparison, task, harness);
      rejectedIn.set(key, [...(rejectedIn.get(key) ?? []), solve.id]);
    }
  }
  tallyReports(events, of, { cut, rejectedIn });
  return { records: [...records.values()], held: heldOut };
}

/** A task under one harness in a comparison, as one key. */
function cutIn(comparison: string, task: string, harness: string): string {
  return `${comparison} ${task} ${harness}`;
}

/** The reports' part of `taskRecords`: each comparison's last report gives every task it tallied
 *  one reading and marks the ones it set aside, in the order the reports and their pairs are read,
 *  an old ladder's among them. */
function tallyReports(
  events: readonly LogEvent[],
  of: (version: string) => TaskRecord,
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
        isString(harness) && cut.has(cutIn(session, task, harness));
      const score = differenceOf(pair);
      const referenceCut = side !== null && cutOn(data[side]);
      order += 1;
      of(task).tallied.push({
        index,
        order,
        old,
        fresh,
        reference: side,
        cut: referenceCut ? "reference" : cutOn(data.old) || cutOn(data.fresh) ? "other" : "none",
        won: score > 0 ? "fresh" : score < 0 ? "old" : null,
        by: carriedBy(pointsOf(pair)),
        // An objective gap under the floor decides no pair, so it leaves no room.
        room: side !== null && gapAgainst(pair, side, [of(task).best]),
      });
    }
    for (const task of Array.isArray(data.aside) ? data.aside.filter(isString) : []) {
      order += 1;
      const record = of(task);
      record.asideAt = index;
      record.asideOrder = Math.min(record.asideOrder, order);
      const harness = side === null ? undefined : data[side];
      const own = isString(harness) ? (rejectedIn.get(cutIn(session, task, harness)) ?? []) : [];
      if (own.some((solve) => stands.get(solve) !== "earned")) record.doubtedAt = index;
    }
  }
}

/**
 * The one place each held-out task has, and what its author may hear of each task a comparison
 * read: `scorable`, one a family, or `awaiting` a person's label, with
 * the `exhausted` among the `retained` and the `retained` among the scorable. Every reader of a task's state reads it
 * here, off one pass over the log.
 *
 * **Awaiting task review** are the tasks that go to a person as possibly infeasible: no solve on record gave a
 * valid answer to them, and two comparisons that gave their solves room gave none either
 * (`7f0add79:docs/plan.md`, Phase 2). A task with no valid answer ties whatever the harnesses are and costs
 * its solves at every comparison. It may be hard, it may be wrongly checked, or it may have no
 * valid answer at all, and only a person can tell the third: on an infeasible task every rejection
 * is a true fail, correctly, every time. So it leaves the scored set until it is labelled
 * (`tools/d2/prepare.ts`).
 *
 * Two things keep a budget from sending a task with a known valid answer there. Under a five-minute deadline three
 * tasks of one campaign had no valid answer from either harness, and every solve of the same
 * three had been valid at two hours; a second comparison at that deadline would have taken them out
 * of the scored set as possibly infeasible.
 *
 * - An author's, a room solve's or a current or former reference's valid answer settles it for
 *   good, at any limits: the task stays and ties where a budget is too short. A candidate's does
 *   not, since which task it won moved the frontier the Builder is told (rule 3, 31 October).
 * - A comparison in which a limit cut a solve of the task short (`taskRecords`: its deadline or its
 *   context) is not counted for it. What that solve would have answered is not known. A task cut
 *   at every comparison so never goes to a person on this rule, and stays a tie the reports show.
 *   A solve that used every model turn its condition names was not cut: the budget's unit ended
 *   it, as a wrong answer ends one, and such a comparison counts.
 *
 * What neither covers is an answer rushed under a told budget and rejected: with no valid answer
 * on record such a comparison counts, since nothing in the log tells a rushed answer from a
 * finished one.
 *
 * A label that keeps a task is a `task.state` event that holds it once more, and the two
 * comparisons are then counted from that label on; a label that calls it infeasible refuses it,
 * and a refused task is no held-out task.
 *
 * **Doubted** tasks leave the scored set and the practice allowance in the same way: the last
 * comparison that read the task set it aside, and a rejection there of the reference harness's own
 * stands unearned, ruled a check defect or unclear or not ruled, with no person's label of it
 * earned in that comparison's settling. Drawn again, such a task was set aside again and its solves
 * and rulings paid for nothing: esp32 PR569's g-1 and g-2 ruled one task's check defective four
 * times each, and four campaigns redrew a task set aside (Referee audit, 5 November). A settling
 * that labels the reference's rejections earned returns it, and so does a person who keeps it
 * (`task.state`) after that comparison. Only the reference's own rejections count, as for the
 * exhausted tasks: a candidate's rejection that stands unearned moves nothing the Builder is told
 * (rule 3). The list (`doubted`) is read by the log page alone.
 *
 * **Exhausted** are the tasks the reference harness has been read easy on (`poolOf`), and they
 * leave the frontier for the retained set (`scoredSet`). The readings are the comparisons it stood
 * in of the task, on whichever side, each without a solve of its own a limit cut, and only its own
 * solves count: the frontier sets the size the Builder is told and admission reads, so it may not
 * move with which held-out task the other harness failed (rule 3). From 29 to 30 October the other
 * side's solves were pooled in, and two campaigns of equal tallies told the Builder different sizes
 * (the v0.9.0 review); a task a later harness breaks still scores as a retained task. A task is
 * easy once its newest `RUNS.easy` readings in a row were each valid in every solve, with no
 * room by the objective, where a better answer would be there for the next harness to reach: room
 * from the reference's own measures or its author's (`gapAgainst`, `compare.ts`), never the other
 * harness's, which until the v0.9.0 review moved the size with which task it bettered. The words are every, some and none, as its author hears them, so the
 * rule reads the same at any count of solves, and no ratio of solves pools across readings. The
 * fold is read against whatever harness is the reference at the time, so a promotion re-derives it
 * at once. Until 29 October one reading valid in every solve closed a task.
 *
 * Exhausted tasks stay scorable as retained tasks (`retained`), so a harness that breaks what the
 * reference answers still shows its losses: left out whole, the set would hold no task the new
 * harness could lose. The Examiner hears such a task's outcome as any other's (`outcomes`); in the
 * counts by family it stands where its last comparison's tally puts it (`standings`).
 *
 * **Retained** are the exhausted tasks, and since 16 October every held task admitted before the last
 * promotion that the promoted harness has stood in no comparison of: those tasks were written for
 * the harness it replaced, and it was promoted on their like: drawn as frontier they padded each
 * epoch's first comparisons with ties (buffer-159-opus, 16 October). Reported apart they show a
 * regression, which is what the epochs before the newest were kept in the draw for. **Frontier** is the rest of the scorable
 * tasks, which the step reads with the retained ones, and what the supply counts (`supplyOf`,
 * `admission.ts`).
 *
 * **Scorable** holds one task a family, a frontier task before a retained one and of each the first
 * held; a task that names no family is a family of its own. A family's tasks share a construction
 * and their results move together: over sixty days of Opus campaigns (read 12 November) a jobstat
 * comparison scored 16 tasks of 4.7 families, and of 55 promotions with a starter comparison the 18
 * that read a step at one task a family were confirmed 13 times, the other 37 12 times.
 *
 * **Known valid answers** are recorded for task versions: a solve's, under any harness
 * and at any limits, an author's answer the host saw pass on the task under its own id
 * (`task.feasible`), or a reference solve's under `try_task` in an earlier log, which its gate counted. It is the one
 * fact an author may hear beside a task's outcome that names no side: a task the reference
 * answers in no solve is then told apart from one nobody has answered. **Bests** are the best
 * measure by the objective an author's answer on record took of each, where its `task.feasible`
 * carries one: a task the reference answers alike in every solve still leaves room where one is
 * better than all of its answers (`informative`, `compare.ts`; 19 October).
 *
 * **Outcomes** hold each task some comparison scored or set aside, by task version, from the last
 * comparison that did: how the reference harness did on it, valid in every one of its counted
 * solves, in some, or in none. The plan lets a task's author hear this of each task
 * (`7f0add79:docs/plan.md`, Phase 2): without a stronger solve the author would otherwise hear nothing, and
 * a difficulty zone or a target count is what v1 found an author writes towards. The reading is of
 * the reference's side alone: which other harness was compared, and what it answered on that
 * task, are not the author's. Who won it reaches the author apart (`standings`). An outcome that named a winner told the author nothing of where the room was:
 * after a starter comparison a task the reference and the starter both failed read as one with no valid
 * answer, which the author's prompt says measures nothing (`7f0add79:docs/simplify.md`, F3). A task no
 * comparison has scored has no outcome.
 *
 * An outcome is the last report's of the task, whatever the setting id the report carries: a
 * campaign runs at one setting (`tools/d2/setting.ts`), and the id names the host's code too,
 * which a tree moved to a new commit changes.
 *
 * The reference's side is the one `TalliedIn.reference` names: `old` in a comparison made against
 * it, and `fresh` in one that measured it as the new harness, as the comparison a promotion rests
 * on did, whose old side is the harness the promoted one replaced. A comparison of two harnesses
 * neither of which is the reference, a standalone comparison named against another digest or one made before
 * a promotion of a third, is `earlier-reference`.
 *
 * **Standings** hold how each task's last comparison with the reference harness on a side went,
 * by task version (`Standing`): who won and on which measure. It is read from the record the
 * outcome is read from (`lastRead`), so the two agree by construction. A task last compared
 * between two other harnesses, or set aside there, has none.
 * Told apart is the comparison's own tally (`tally`, `compare.ts`), so under an objective two
 * valid answers can be told apart.
 */
export function poolOf(events: readonly LogEvent[]) {
  const { records, held } = taskRecords(events);
  const heldRecords = records.filter((record) => record.held);
  const awaiting = placed(heldRecords, ({ validAnswer, keptAt, tallied }) =>
    runOf(
      tallied.filter(({ index, cut }) => validAnswer !== "independent" && index >= keptAt && cut === "none"),
    ),
  );
  // Easy: the newest `RUNS.easy` readings in a row valid in every solve of the reference, with no
  // room by the objective.
  const spent = placed(heldRecords, ({ tallied }) => {
    const readings = tallied.filter(({ reference, cut }) => reference !== null && cut !== "reference");
    const open = readings.findLastIndex((reading) => spreadOf(ownOf(reading)) !== "every" || reading.room);
    return readings.length - 1 - open >= RUNS.easy ? readings.at(-1)?.order : undefined;
  });
  const doubted = placed(heldRecords, ({ doubtedAt, keptAt, tallied }) =>
    doubtedAt > keptAt && doubtedAt > (tallied.at(-1)?.index ?? -1) ? doubtedAt : undefined,
  );
  const out = new Set([...awaiting, ...doubted]);
  const promotedAt = events.findLastIndex(({ kind }) => kind === PROMOTED);
  const before = new Set(taskSets(events.slice(0, Math.max(0, promotedAt))).held);
  const reference = referenceOf(events);
  const stood = new Set(
    lastReports(events, "all").flatMap(({ data }) =>
      (data.old === reference || data.fresh === reference) && Array.isArray(data.versions)
        ? data.versions.filter(isString)
        : [],
    ),
  );
  const unstood = held.filter((task) => before.has(task) && !out.has(task) && !stood.has(task));
  const older = [...new Set([...spent.filter((task) => !out.has(task)), ...unstood])];
  // One task a family: its first held that is not an older one, or its first.
  const families = new Map(proposalsOf(events).map(({ version, family }) => [version, family ?? version]));
  const scorable = [
    ...Map.groupBy(
      held.filter((task) => !out.has(task)),
      (task) => families.get(task) ?? task,
    ).values(),
  ].flatMap((kin) => kin.find((task) => !older.includes(task)) ?? kin.slice(0, 1));
  const retained = older.filter((task) => scorable.includes(task));
  // Practice's allowance also leaves out a task with no independent valid answer that the reference
  // answered in none of two comparisons: unlike `awaiting`, only the reference's own cut solves pass
  // a comparison over, so the allowance reads nothing of the other harness (rule 3).
  const practiceOut = new Set([
    ...spent,
    ...doubted,
    ...placed(heldRecords, ({ validAnswer, keptAt, tallied }) =>
      validAnswer === "independent"
        ? undefined
        : runOf(
            tallied.filter(
              ({ reference: side, index, cut }) => side !== null && index >= keptAt && cut !== "reference",
            ),
          ),
    ),
  ]);
  const first = ({ tallied, asideOrder }: TaskRecord) =>
    Math.min(tallied[0]?.order ?? asideOrder, asideOrder);
  return {
    scorable,
    frontier: scorable.filter((task) => !retained.includes(task)),
    practiceFrontier: held.filter(
      (task) => !(before.has(task) && !stood.has(task)) && !practiceOut.has(task),
    ),
    // What a practice release draws from: a rejection the reference's own solve left in doubt reads
    // the reference alone, so which task another harness won moves nothing here (rule 3).
    practicePool: held.filter((task) => !doubted.includes(task)),
    awaiting,
    doubted,
    exhausted: retained.filter((task) => spent.includes(task)),
    retained,
    feasible: new Set(
      records.flatMap(({ version, validAnswer }) => (validAnswer === "none" ? [] : [version])),
    ),
    bests: new Map(records.flatMap(({ version, best }) => (best === null ? [] : [[version, best] as const]))),
    outcomes: new Map(records.toSorted((one, other) => first(one) - first(other)).flatMap(outcomeOf)),
    standings: new Map(records.flatMap(standingOf)),
  };
}

/** The reference harness's own solves of a task in one comparison, empty where it stood on neither side. */
function ownOf({ reference, old, fresh }: TalliedIn): readonly boolean[] {
  return reference === "old" ? old : reference === "fresh" ? fresh : [];
}

/** The reference's side of one comparison of a task, as its outcome reads it. */
function sideOf(tallied: TalliedIn): "every" | "some" | "none" | null {
  return tallied.reference === null ? null : spreadOf(ownOf(tallied));
}

/** What a task's author hears of it (`poolOf`, outcomes), or nothing where no report read it. */
function outcomeOf(record: TaskRecord): [string, Outcome][] {
  const { version } = record;
  const last = lastRead(record);
  if (last === null) return [];
  if (last === "aside") return [[version, "disputed"]];
  const side = sideOf(last);
  return [[version, side === null ? "earlier-reference" : `reference-${side}`]];
}

/** How a task's last comparison went for its author (`poolOf`, standings), or nothing where no
 *  report read it against the reference or the last set it aside. */
function standingOf(record: TaskRecord): [string, Standing][] {
  const last = lastRead(record);
  if (last === null || last === "aside" || last.reference === null) return [];
  const { reference, won, by } = last;
  return [[record.version, { won: won === null ? null : won === reference ? "reference" : "other", by }]];
}

/**
 * The `count` held-out tasks of `pool` a release takes, each with why, in the order they are
 * taken. A task no reference solve answered in two comparisons goes to the Builder before the draw:
 * it is what a session has to work on, where every released task passes. Then the tasks the reference
 * harness failed in the last comparison, half of them rounded down, so that the comparison keeps
 * tasks it can untie: rounded up, one failed task of one was released, which on jobstat exams with no
 * objective took 3 of the 7 tasks that untied in 180 (4 November), and released more than the half
 * of the tasks with room that `AGENTS.md` allows. The rest is the contract's draw over every task neither list holds, those the
 * reference answered in every solve among them: such a task still teaches through the objective's
 * measure a practice pass returns. From 16 to 20 October the draw left them out, and so withheld
 * the tasks the objective left room on: after r3's third, fourth and fifth promotions 12, 18 and 22
 * frontier tasks were held, with room to release 6, 12 and 16, and none could be drawn. Reading
 * that room here would read the other harness's answers and its author's (`informative`), so which
 * held-out task a new harness won would change what is released, which the Builder reads (rule 3):
 * the release reads the reference's own solves alone. The release in `tools/d2/prepare.ts` calls it.
 *
 * The tasks the reference failed are the ones whose last scored result says it failed
 * a solve, excluding a later dispute or comparison between other harnesses, as a task's outcome
 * does: the tasks that leave the reference room are the ones a Builder has to work on, and on
 * 10 October three campaigns each ran three sessions after a promotion on practice tasks the
 * promoted harness passed, and changed nothing.
 *
 * A task the reference answered in every solve of its last reading still leaves it room where an
 * answer of its own or its author's on record is better by the objective by at least the floor
 * (`room`, `gapAgainst`), and it is put first beside the failed ones, since in an objective
 * domain every solve is valid (seven buffer campaigns, 21 October). The other harness's answers stay out of `room`, so which held-out task it won moves no release (rule 3).
 *
 * The tasks the reference never answered are the held-out ones it gave no valid answer in
 * `RUNS.unsolved` or more comparisons it stood in, cut at a limit or not, unlike `poolOf`'s `awaiting`:
 * on 10 October one campaign held four to five of ten while its Builder passed every practice task.
 * Until 26 October any harness's valid answer took a task off this list, so a release told the
 * Builder which held-out task its harness won (rule 3). A task only the other harness answered now
 * goes to practice too, and leaves the exam.
 * The failed half is drawn from the whole reading, including tasks already released: repeated
 * one-task releases must leave the same half held (26 October). Disputed and refused tasks have
 * no place in that half.
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
  const among = (versions: readonly string[]) => versions.filter((version) => pool.includes(version));
  const unanswered = placed(eligible, ({ tallied }) => {
    const own = tallied.filter(({ reference }) => reference !== null);
    return own.some((reading) => sideOf(reading) !== "none") ? undefined : runOf(own);
  });
  const failed = placed(eligible, (record) => {
    const last = lastRead(record);
    if (last === null || last === "aside" || last.reference === null) return undefined;
    return last[last.reference].some((valid) => !valid) || last.room ? last.order : undefined;
  }).filter((version) => !unanswered.includes(version));
  const first = among([...unanswered, ...failed.slice(0, Math.floor(failed.length / 2))]);
  const rest = pool.filter((version) => !first.includes(version) && !failed.includes(version));
  const chosen = [
    ...first.slice(0, count),
    ...draw(rest, Math.min(rest.length, Math.max(0, count - first.length)), seed),
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

/** The record a task's outcome, its standing and its release are read from: the last comparison that tallied
 *  it, `"aside"` where a later report set it aside, or null where no report did either. */
function lastRead({ tallied, asideAt }: TaskRecord): TalliedIn | "aside" | null {
  const last = tallied.at(-1);
  if (last === undefined) return asideAt === -1 ? null : "aside";
  return asideAt > last.index ? "aside" : last;
}

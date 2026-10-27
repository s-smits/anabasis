/**
 * What the comparisons on record say of a campaign: whether it should stop, each report read as it
 * was found, the one place each held-out task has and what its author may hear of it (`poolOf`),
 * the tasks a release takes first (`releaseOrder`), and what the log holds of billed dollars.
 *
 * A comparison ends in a `comparison.reported` event under an id, a round's session id or a
 * checkpoint's own (`src/campaign/round.ts`). A person's settling writes the same id's report once
 * more, so a comparison is read by its last report, and it stands in the log where its first one
 * does: a settling made weeks later moves no comparison behind the ones run since. Every fold here
 * starts from those. A comparison's solves are the ones whose start names it (`compare.ts`).
 *
 * The harness a comparison is made against is the reference harness: the Starter Built Harness
 * until the operator promotes another, and from then on the one last promoted (`promoted`). The
 * choice is the operator's and the record is the log's (`7f0add79:docs/plan.md`, Phase 6). A Builder goes
 * on from the harness its last session left (`latestBuilt`), step or none.
 * Practice priority reads each task's last scored or disputed result, as its outcome does.
 * Its allowance keeps a reference-only frontier in this same fold (26 October, rule 3).
 *
 * The stop rule is the plan's: as many moves in a row that could have shown a gain and showed none
 * as the campaign's patience (`stopRule`, `patienceOf`).
 * The Referee triage of 20 October found unresolved practice rejections counted as failures;
 * those are set aside here too, rather than evidence that a Builder declined an established fail.
 *
 * Nothing here decides a comparison or makes a solve.
 */
import { asRecord, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import {
  carriedBy,
  closedTo,
  draw,
  type Measures,
  objectiveRuleIn,
  type Paired,
  pairsOf,
  roomLeft,
  tally,
} from "./compare.ts";
import type { LogEvent } from "./log.ts";
import { providerFailed, windowEnded } from "./solve.ts";
import { passed, practiceRan, ranUnder, rejectionAside } from "./solves.ts";
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
 *  that it was set aside. Until 16 October a task the draw left out was told `exhausted`. */
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
  /** The room by the objective the reference harness's answers left there, against its own and its
   *  author's (`roomLeft`), and 0 under the floor (`ROOM`). */
  readonly room: number | null;
}

/** A task's last comparisons with the reference harness on a side, newest first, each as the
 *  outcome reads the reference's side, with whether a limit cut one of its own solves there; and
 *  how many of the newest closed the task in a row as its author may hear it (`poolOf`, histories):
 *  every solve valid and no answer of the reference's own or its author's better by the floor
 *  (`room`). The other harness's measures stay out, so the count reads the same with
 *  `exam-results` off whatever that harness measured; the frontier's `closed` reads them. */
export interface History {
  readonly reads: readonly { readonly valid: "every" | "some" | "none"; readonly cut: boolean }[];
  readonly closedRun: number;
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
  /** Whether a limit cut a solve of the task in this comparison short (`taskRecords`). */
  readonly cut: boolean;
  /** Whether one of the reference harness's own solves of it did: all its author hears (rule 4). */
  readonly referenceCut: boolean;
  /** Whether the reference harness closed the task in this comparison (`closedTo`): valid in every
   *  solve, and no valid answer better than one of its own by the objective. False where it stood
   *  on neither side. */
  readonly closed: boolean;
  /** The side that won the task in this comparison's tally (`tally`), or null for a tie. */
  readonly won: "old" | "fresh" | null;
  /** The measure that carried the win (`carriedBy`), null for a tie. */
  readonly by: keyof Measures | null;
  /** The room by the objective the reference harness's answers left there, against its own and its
   *  author's (`roomLeft`), and 0 under the floor (`ROOM`), where it leaves none; null where it
   *  stood on neither side. */
  readonly room: number | null;
}

/**
 * What a log holds of one task, for every reader of its state: the pool and the release are
 * predicates over it, since while each read the log for itself their arithmetic was mended four
 * times (`7f0add79:docs/simplify.md`, C1). Filled by `taskRecords`, which is why its fields are not read-only.
 */
interface TaskRecord {
  readonly version: string;
  /** Whether the task is held out now. */
  readonly held: boolean;
  /** The last event at which a person kept it held (`task.state`), or -1. */
  keptAt: number;
  /** Feasibility independent of the other harness: an author's proof, a gate's valid solve,
   *  or a valid solve of the current reference. The practice allowance reads only this evidence. */
  referenceFeasible: boolean;
  /** A solve's valid answer on record, or `task.feasible` records a passing author answer, or its
   *  gate says a reference solve under `try_task` gave a valid answer, which answers nothing. */
  feasible: boolean;
  /** The best measure by the objective of an author's answer on record (`task.feasible`), or null
   *  where none carries one (`informative`, `compare.ts`; 19 October). */
  best: number | null;
  /** Each comparison whose last report tallied it, in the order the comparisons reported. */
  readonly tallied: TalliedIn[];
  /** The last report that set it aside on a rejection, or -1, and its place among every pair
   *  and every task set aside, as `TalliedIn.order` counts them, where it was first set aside. */
  asideAt: number;
  asideOrder: number;
}

/** A dollar cap: the billed dollars a comparison, or a Builder session by itself, may hold
 *  (`billedFor`, a session's whole span), and what each solve is held at before it starts. */
export interface Cap {
  readonly dollars: number;
  readonly reserve: number;
}

/**
 * The campaign's patience, where its opening names none: the moves in a row that could have shown
 * a gain and showed none before the stop rule ends it, and move 7's bound on Examiner sessions in
 * a row that held out no task and on comparisons of one harness that left no room. The plan's
 * three ended every campaign of 9 and 10 October before its tasks were measured, and the operator
 * set the development phase to err towards more iterations of the Builder than fewer: six, until
 * a campaign climbs and the figure can be read from its record.
 */
export const PATIENCE = 6;
/** Comparisons without a valid answer after which a task with none on record goes to a person. */
const UNSOLVED_RUN = 2;
/** How many comparisons of a task's history its author hears (`poolOf`, histories). */
const HISTORY = 3;
/** The ways a solve ends at a limit of its own: its time, its model turns or its context. The
 *  investigation reads every one as a miss at a limit (`tools/wri/time.ts`); the pool reads all but
 *  one as a cut whose answer is not known (`taskRecords`). */
export const AT_A_LIMIT: ReadonlySet<unknown> = new Set(["wall-ended", "turns-ended", "context-ended"]);
const STEP = "step";
/** How a Builder session ends when it was cut and left half a session's work. */
const CUT: ReadonlySet<unknown> = new Set(["killed", "crashed"]);
const REPORTED = "comparison.reported";
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
 * after a promotion on tasks held apart, retired on 16 October: they are no step, no control and
 * no room, and only `all` reads them, for what they found of the reference's solves of tasks now
 * held out (`taskRecords`) and for the sessions they name.
 */
export function lastReports(events: readonly LogEvent[], all = false): Reported[] {
  const found = new Map<string, Reported>();
  for (const [index, { kind, data }] of events.entries()) {
    if (kind !== REPORTED || !isString(data.session) || (data.ladder === true && !all)) continue;
    // A map keeps the place of a key's first entry, which is the comparison's first report.
    found.set(data.session, { session: data.session, index: found.get(data.session)?.index ?? index, data });
  }
  return [...found.values()];
}

/**
 * The harness the last whole Builder session left, by its digest, or null while none has changed
 * one. It is where the next session starts unless the operator names another: after a comparison
 * without a step the Builder continues from its latest harness (`7f0add79:docs/plan.md`, Phase 5). A session
 * that was killed or that crashed is passed over, except for a checkpoint already frozen inside
 * its live conversation: that version was kept before the interruption.
 */
export function latestBuilt(events: readonly LogEvent[]): string | null {
  const left = events.findLast(
    ({ kind, data }) =>
      (kind === "build.checkpoint" ||
        (kind === BUILD_FINISHED && data.changed === true && !CUT.has(data.ended))) &&
      isString(data.harness),
  )?.data.harness;
  return isString(left) ? left : null;
}

/**
 * The harness the operator last promoted to be the reference, by its digest, or null while none
 * has been: the reference harness is then the starter. A promotion is an event the operator
 * confirmed (`tools/d2/promote.ts`), and one that names the starter returns the campaign to it.
 */
export function promoted(events: readonly LogEvent[]): string | null {
  const harness = events.findLast(({ kind }) => kind === "harness.promoted")?.data.harness;
  return isString(harness) ? harness : null;
}

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
 *
 * Until 12 October room was read by shares of valid solves (the reference at most three in four,
 * and not both harnesses under one in four), which counted a task the reference failed in every
 * solve as room (10 October) and an objective's spread not at all (the plan's section 4b, one
 * definition for the Examiner's `try_task` and the table).
 */
export function roomOf(report: JsonObject, side: "old" | "fresh" = "old"): "none" | "too-hard" | "room" {
  const valid = asRecord(report.valid);
  const told = asRecord(valid?.informative)?.[side];
  if (!isNumber(told) || told > 0) return "room";
  const anyValid = (counts: unknown) =>
    Array.isArray(counts) && counts.some((n, at) => at > 0 && isNumber(n) && n > 0);
  return anyValid(valid?.old) || anyValid(valid?.fresh) ? "none" : "too-hard";
}

/** The campaign's patience as its opening records it (`--patience`), or `PATIENCE`. */
export function patienceOf(events: readonly LogEvent[]): number {
  const named = events.findLast(({ kind }) => kind === "campaign.opened")?.data.patience;
  return isNumber(named) ? named : PATIENCE;
}

/** Established practice failures, shared by the stop rule and the next move. */
export function practiceFailures(events: readonly LogEvent[]) {
  return practiceRan(events).filter(
    (solve) => solve.ending?.outcome === "fail" && !rejectionAside(events, solve),
  );
}

/**
 * The plan's stop rule over a log: how many moves could have shown a gain, how many of them have
 * passed since the last step, and whether that is the campaign's patience (`7f0add79:docs/plan.md`, row
 * F48; `patienceOf`).
 *
 * A move that counts is one of two. The first is a harness a Builder session changed, compared
 * with one reference, where the comparison tallied a task and left room (`roomOf`), or read a step.
 * Such a pair counts once, where it first reported, and showed a gain where any of its comparisons
 * read a step, which promotes it: three readings of one harness are one harness. The count is of
 * the epoch, the moves since the last promotion, so a step restarts it. On 9 October one harness
 * compared with the starter three times, each time on more tasks, stopped a campaign. Until
 * 19 October a reading under the trigger counted as a gain too, since it bought the repeat.
 *
 * The second is a whole session that left its harness as it was, where a practice solve of the
 * session failed: it was shown a failure and declined it. A session whose every practice solve
 * passed, or that ran none, had nothing to work on, which is a fault of the supply and no evidence about the domain: all ten campaigns of
 * 9 and 10 October stopped on three such sessions after a promotion, each practising on tasks the
 * promoted harness passed (`7f0add79:docs/plan.md`, row F52).
 *
 * What does not count: a comparison of two harnesses no session made, which a control and a
 * reading of the reference against itself are; one stopped on its check defects, cut by its cap,
 * or with every task set aside, which tested nothing; and one that left no room, whose answer is
 * other tasks and no other harness. Every comparison on record is read, whatever the setting id
 * it carries, since the id names the host's code and a tree moved to a new commit changes it.
 */
export function stopRule(events: readonly LogEvent[]) {
  const practised = practiceFailures(events);
  /** The harnesses a whole session changed or a live one froze at a checkpoint, where each session began, and the whole sessions that left
   *  their harness as it was after a practice solve of theirs failed. */
  const built = new Set<unknown>();
  const began = new Map<unknown, number>();
  const idle: { index: number; step: boolean }[] = [];
  for (const [index, { kind, data }] of events.entries()) {
    if (kind === "build.started") began.set(data.session, index);
    if (kind === "build.checkpoint" && isString(data.harness)) built.add(data.harness);
    if (kind !== BUILD_FINISHED) continue;
    if (data.changed === true && !CUT.has(data.ended) && isString(data.harness)) built.add(data.harness);
    if (data.changed !== false || CUT.has(data.ended)) continue;
    const from = began.get(data.session) ?? -1;
    const shown = practised.some((solve) => solve.started > from && solve.started < index);
    if (shown) idle.push({ index, step: false });
  }
  /** Each pair of a harness and a reference, where it first reported, and whether any of its
   *  comparisons read a step or left room. */
  const pairs = new Map<string, { index: number; step: boolean; counts: boolean }>();
  for (const { index, data } of lastReports(events)) {
    const { old, fresh, versions } = data;
    const tallied = asRecord(data.scored) !== null && Array.isArray(versions) && versions.length > 0;
    if (!tallied || !isString(fresh) || !built.has(fresh)) continue;
    const pair = `${fresh} ${isString(old) ? old : ""}`;
    const was = pairs.get(pair);
    const step = was?.step === true || data.reading === STEP;
    pairs.set(pair, { index: was?.index ?? index, step, counts: step || roomOf(data) === "room" });
  }
  const moves = [...pairs.values().filter(({ counts }) => counts), ...idle].toSorted(
    (one, other) => one.index - other.index,
  );
  // A promotion starts an epoch, whose patience is its own.
  const epochAt = events.findLastIndex(({ kind }) => kind === "harness.promoted");
  const epoch = moves.filter(({ index }) => index > epochAt);
  const sinceStep = epoch.length - 1 - epoch.findLastIndex(({ step }) => step);
  return { checkpoints: moves.length, sinceStep, stop: sinceStep >= patienceOf(events) };
}

/**
 * The pairs a comparison's last report tallied, read as the comparison found them: from the log up
 * to its first report, so a task released, refused or disputed since is still the scored task it
 * was, under the report's own two harnesses and setting, counting the comparison's own solves, and
 * each side cut to the solves it asked for: in a log written with `--noise` (until 13 October),
 * the reference's first mirrored half (`halves`). None for a report that compared nothing, or
 * before a solve named its comparison.
 */
export function pairsReported(events: readonly LogEvent[], report: Reported): Paired[] {
  const { session, index, data } = report;
  const { old, fresh, setting, solves } = data;
  const versions = Array.isArray(data.versions) ? data.versions.filter(isString) : [];
  if (data.scored === null || !isString(old) || !isString(fresh) || !isString(setting) || !isNumber(solves)) {
    return [];
  }
  const begun = events.find(({ kind, data: start }) => kind === STARTED && start.session === session);
  const halves = begun?.data.noise === true ? ("mirrored" as const) : undefined;
  const sides = {
    old,
    fresh,
    setting,
    comparison: session,
    objective: objectiveRuleIn(data),
    halves,
  };
  return pairsOf(events.slice(0, index + 1), versions, sides, solves).pairs;
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

/** Where the `UNSOLVED_RUN` or more of `runs` first stood, or undefined where they are fewer. */
function runOf(runs: readonly TalliedIn[]): number | undefined {
  return runs.length >= UNSOLVED_RUN ? runs[0]?.order : undefined;
}

/** Every task a log holds a state, a solve or a report of, each as `TaskRecord` reads it, and the
 *  held-out ones in the order they were held out. */
function taskRecords(events: readonly LogEvent[]) {
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
      referenceFeasible: false,
      feasible: false,
      best: null,
      tallied: [],
      asideAt: -1,
      asideOrder: Number.POSITIVE_INFINITY,
    };
    records.set(version, made);
    return made;
  };
  for (const [index, { kind, data }] of events.entries()) {
    if (!isString(data.version)) continue;
    if (kind === "task.state" && data.state === "held") of(data.version).keptAt = index;
    const tried = kind === "task.gate" ? asRecord(data.reference)?.valid : undefined;
    if (kind === "task.feasible" || (isNumber(tried) && tried > 0)) {
      of(data.version).feasible = true;
      of(data.version).referenceFeasible = true;
    }
    const { measure, direction } = asRecord(data.objective) ?? {};
    if (kind !== "task.feasible" || !isNumber(measure)) continue;
    const record = of(data.version);
    const beaten =
      direction === "lower" ? measure < (record.best ?? Infinity) : measure > (record.best ?? -Infinity);
    if (beaten) record.best = measure;
  }
  /**
   * Each comparison's tasks a solve of which a limit cut short, by harness, as `cutIn` names them:
   * what that solve would have answered is not known (rule 7). The wall is the host's clock, which
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
  const reference = referenceOf(events);
  for (const solve of ranUnder(events)) {
    const { task, limits, harness } = solve.under;
    const { comparison } = solve.start;
    const kind = solve.ending?.kind;
    const turn = lastTurn.get(solve.id);
    const last = { stopReason: turn?.stopReason, errorMessage: turn?.error };
    const interrupted = windowEnded(last) || providerFailed(last);
    const budgeted = kind === "turns-ended" && isNumber(limits.modelTurns) && !interrupted;
    if (passed(solve) === true) {
      of(task).feasible = true;
      if (harness === reference) of(task).referenceFeasible = true;
    }
    if (isString(comparison) && AT_A_LIMIT.has(kind) && !budgeted) cut.add(cutIn(comparison, task, harness));
  }
  tallyReports(events, of, cut);
  return { records: [...records.values()], held: heldOut };
}

/** A task under one harness in a comparison, as one key. */
function cutIn(comparison: string, task: string, harness: string): string {
  return `${comparison} ${task} ${harness}`;
}

/** The reports' part of `taskRecords`: each comparison's last report gives every task it tallied
 *  one reading and marks the ones it set aside, in the order the reports and their pairs are read.
 *  An old ladder's reading is one of them: its tasks are held out since 16 October, and what it
 *  found of the reference's solves of them is what the pool and the Examiner read. */
function tallyReports(
  events: readonly LogEvent[],
  of: (version: string) => TaskRecord,
  cut: ReadonlySet<string>,
): void {
  const reference = referenceOf(events);
  let order = 0;
  for (const report of lastReports(events, true)) {
    const { index, session, data } = report;
    const side = data.fresh === reference ? "fresh" : data.old === reference ? "old" : null;
    for (const pair of pairsReported(events, report)) {
      const { task, old, fresh } = pair;
      const cutOn = (harness: unknown): boolean =>
        isString(harness) && cut.has(cutIn(session, task, harness));
      const { wins, losses } = tally([pair]);
      // Room under the floor decides no pair and holds no draft, so its author is told none.
      const left = side === null ? null : roomLeft(pair, side, [of(task).best]);
      order += 1;
      of(task).tallied.push({
        index,
        order,
        old,
        fresh,
        reference: side,
        cut: cutOn(data.old) || cutOn(data.fresh),
        referenceCut: side !== null && cutOn(data[side]),
        closed: side !== null && closedTo(pair, side, of(task).best),
        won: wins > 0 ? "fresh" : losses > 0 ? "old" : null,
        by: carriedBy(pair),
        room: left,
      });
    }
    for (const task of Array.isArray(data.aside) ? data.aside.filter(isString) : []) {
      order += 1;
      const record = of(task);
      record.asideAt = index;
      record.asideOrder = Math.min(record.asideOrder, order);
    }
  }
}

/**
 * The one place each held-out task has, and what its author may hear of each task a comparison
 * read: `scorable`, in the order the tasks were held out, or `awaiting` a person's label, with
 * the `exhausted` among the `retained` and the `retained` among the scorable. Every reader of a task's state reads it
 * here, off one pass over the log.
 *
 * **Awaiting** are the tasks that go to a person as possibly infeasible: no solve on record gave a
 * valid answer to them, and two comparisons that gave their solves room gave none either
 * (`7f0add79:docs/plan.md`, Phase 2). A task with no valid answer ties whatever the harnesses are and costs
 * its solves at every comparison. It may be hard, it may be wrongly checked, or it may have no
 * valid answer at all, and only a person can tell the third: on an infeasible task every rejection
 * is a true fail, correctly, every time. So it leaves the scored set until it is labelled
 * (`tools/d2/prepare.ts`).
 *
 * Two things keep a budget from sending a feasible task there. Under a five-minute wall three
 * tasks of one campaign had no valid answer from either harness, and every solve of the same
 * three had been valid at two hours; a second comparison at that wall would have taken them out
 * of the scored set as possibly infeasible.
 *
 * - A valid answer anywhere on record settles the question for good: under any harness, in any
 *   comparison or outside one, at any limits. Such a task is feasible, stays in the set and ties
 *   where a budget is too short for it, which costs solves and biases nothing.
 * - A comparison in which a limit cut a solve of the task short (`taskRecords`: its wall or its
 *   context) is not counted for it. What that solve would have answered is not known. A task cut
 *   at every comparison so never goes to a person on this rule, and stays a tie the reports show.
 *   A solve that used every model turn its condition names was not cut: the budget's unit ended
 *   it, as a wrong answer ends one, and since 19 October such a comparison counts.
 *
 * What neither covers is an answer rushed under a told budget and rejected: with no valid answer
 * on record such a comparison counts, since nothing in the log tells a rushed answer from a
 * finished one.
 *
 * A label that keeps a task is a `task.state` event that holds it once more, and the two
 * comparisons are then counted from that label on; a label that calls it infeasible refuses it,
 * and a refused task is no held-out task.
 *
 * **Exhausted** are the tasks the reference harness answered validly in every solve of the last
 * comparison it stood in of them, on whichever side, and they leave the frontier for the retained
 * set (`scoredSet`). The fold is read again against whatever harness is the
 * reference at the time, so a promotion re-derives it at once: the comparisons the promoted
 * harness won before its promotion count. Such a task can only tie again at that budget or be
 * lost, unless the comparison carried an objective by which a valid answer, its own or the other
 * side's, was better than one of the reference's (`closedTo`, `compare.ts`): a better answer is
 * then there for the next harness to reach. Until 19 October any two answers told apart kept it
 * open, the reference's own wins among them, so a harness promoted on the objective stood on a
 * frontier of the tasks it had already won. Every one in the set is a task a step cannot be read on: on the operator's host (9 and
 * 10 October) a harness came one win short of a step three times with most of its tasks tied, and
 * one promoted harness and the starter tied 10 of 10 twice. The reference's own answers close a
 * task, since its answers are what the next harness has to match: closed only where both
 * harnesses answered it, a task the new harness lost stayed in the draw, and in the simulated
 * climb of 10 October three comparisons in a row read 2-0-6 and 3-0-5 on a scored set of eight
 * and the campaign stopped one win short. They stay scorable as retained tasks (`retained`), so
 * that a harness that breaks what the reference answers still shows its losses: left out whole,
 * the set would hold no task the new harness could lose. Until 16 October two thirds of them left
 * the draw by the contract's hash, never to be read again under that reference, where one reading
 * of four solves had closed them, and a later reading reopens some (below). The Examiner hears
 * such a task's outcome as any other's (`outcomes`); in the counts by family it stands where its
 * last comparison's tally puts it (`standings`). Since 15 October the reference's last reading of a task decides, where two closed
 * comparisons had: a promotion's repeat drew fresh tasks, so a promoted harness had stood once in
 * the tasks it was promoted on, closed 50 of 51 in four campaigns' logs, and the next comparisons
 * tied on them. A later reading that leaves a task open opens it again, as 3 of 34 rechecks did,
 * and one where a limit cut a solve of the reference's says neither (rule 7).
 *
 * **Retained** are the exhausted tasks, and since 16 October every held task gated before the last
 * promotion that the promoted harness has stood in no comparison of: those tasks were written for
 * the harness it replaced, and it was promoted on their like. Drawn as frontier they padded each
 * epoch's first comparisons with ties: in buffer-159-opus 0665c78b answered 9 such tasks 4 of 4,
 * 8ee38f97 59 of 60 solve-sets on the epoch before its own, and 18 of 18 in g-4 to g-7 tied with
 * both sides valid in every solve. Reported apart they show a regression, which is what the
 * epochs before the newest were kept in the draw for. **Frontier** is the rest of the scorable
 * tasks, which the step reads with the retained ones, and what the supply counts (`supplyOf`,
 * `admission.ts`).
 *
 * **Feasible** are the task versions a valid answer is on record for: a solve's, under any harness
 * and at any limits, an author's answer the host saw pass on the task under its own id
 * (`task.feasible`), or a reference solve's under `try_task`, which its gate counts. It is the one
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
 * task, are not the author's. Who won it reaches the author apart, unless the campaign's term
 * `exam-results` is off (`standings`). An outcome that named a winner told the author nothing of where the room was:
 * after a control a task the reference and the starter both failed read as one with no valid
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
 * neither of which is the reference, a checkpoint named against another digest or one made before
 * a promotion of a third, is `earlier-reference`.
 *
 * **Standings** hold how each task's last comparison with the reference harness on a side went,
 * by task version (`Standing`): who won, on which measure, and the room the reference's answers
 * left. It is read from the record the outcome is read from (`lastRead`), so the two agree by
 * construction. A task last compared between two other harnesses, or set aside there, has none.
 * Told apart is the comparison's own tally (`tally`, `compare.ts`), so under an objective two
 * valid answers can be told apart.
 *
 * **Histories** hold, for each task the reference stood in two comparisons or more of, the same
 * reading of the reference's side for each of its last `HISTORY` such comparisons, newest first,
 * with whether a limit cut one of the reference's own solves there, and how many of the newest closed it in a row
 * (`History`). An outcome is one comparison's: told the last alone, an author could not tell a task the
 * reference answered once from one it answers every time running, nor which of the tasks it
 * answers is the older. Three readings are a short run, and the sentence rule 6 asks for stands
 * beside them in the author's prompt. The words are the outcome's own, every, some or none, and
 * no count of valid solves (AGENTS.md, section 3); a solve a limit cut is named apart, as rule 7
 * keeps it apart from a wrong answer.
 */
export function poolOf(events: readonly LogEvent[]) {
  const { records, held } = taskRecords(events);
  const heldRecords = records.filter((record) => record.held);
  const awaiting = placed(heldRecords, ({ feasible, keptAt, tallied }) =>
    runOf(tallied.filter(({ index, cut }) => !feasible && index >= keptAt && !cut)),
  );
  const spent = placed(heldRecords, ({ tallied }) => {
    const last = tallied.findLast(({ reference, referenceCut }) => reference !== null && !referenceCut);
    return last?.closed === true ? last.order : undefined;
  });
  const out = new Set(awaiting);
  const promotedAt = events.findLastIndex(({ kind }) => kind === "harness.promoted");
  const before = new Set(taskSets(events.slice(0, Math.max(0, promotedAt))).held);
  const reference = referenceOf(events);
  const stood = new Set(
    lastReports(events, true).flatMap(({ data }) =>
      (data.old === reference || data.fresh === reference) && Array.isArray(data.versions)
        ? data.versions.filter(isString)
        : [],
    ),
  );
  const unstood = held.filter((task) => before.has(task) && !out.has(task) && !stood.has(task));
  const retained = [...new Set([...spent, ...unstood])];
  const scorable = held.filter((task) => !out.has(task));
  // Practice keeps a conservative sweep using reference-only feasibility, limits and objective
  // room. The comparison frontier also reads the other harness and cannot set a public count.
  const practiceOut = placed(heldRecords, ({ referenceFeasible, keptAt, tallied }) => {
    const own = tallied.filter((reading) => reading.reference !== null);
    const last = own.findLast(({ referenceCut }) => !referenceCut);
    if (last !== undefined && sideOf(last) === "every" && (last.room ?? 0) === 0) return last.order;
    return referenceFeasible
      ? undefined
      : runOf(own.filter(({ index, referenceCut }) => index >= keptAt && !referenceCut));
  });
  const first = ({ tallied, asideOrder }: TaskRecord) =>
    Math.min(tallied[0]?.order ?? asideOrder, asideOrder);
  return {
    scorable,
    frontier: scorable.filter((task) => !retained.includes(task)),
    practiceFrontier: held.filter(
      (task) => !(before.has(task) && !stood.has(task)) && !practiceOut.includes(task),
    ),
    awaiting,
    exhausted: spent,
    retained,
    feasible: new Set(records.flatMap(({ version, feasible }) => (feasible ? [version] : []))),
    bests: new Map(records.flatMap(({ version, best }) => (best === null ? [] : [[version, best] as const]))),
    outcomes: new Map(records.toSorted((one, other) => first(one) - first(other)).flatMap(outcomeOf)),
    standings: new Map(records.flatMap(standingOf)),
    histories: new Map(records.flatMap(historyOf)),
  };
}

/** The reference's side of one comparison of a task, as its outcome reads it. */
function sideOf({ reference, old, fresh }: TalliedIn): "every" | "some" | "none" | null {
  if (reference === null) return null;
  const own = reference === "old" ? old : fresh;
  const valid = own.filter(Boolean).length;
  return valid === own.length ? "every" : valid === 0 ? "none" : "some";
}

/** A task's last comparisons with the reference harness on a side, newest first (`poolOf`,
 *  histories), or nothing where it stood in fewer than two: one is the outcome already. */
function historyOf(record: TaskRecord): [string, History][] {
  const stood = record.tallied.filter(({ reference }) => reference !== null).toReversed();
  if (stood.length < 2) return [];
  let closedRun = 0;
  for (const tallied of stood) {
    if (sideOf(tallied) !== "every" || (tallied.room ?? 0) > 0) break;
    closedRun += 1;
  }
  const reads = stood.slice(0, HISTORY).flatMap((tallied) => {
    const valid = sideOf(tallied);
    return valid === null ? [] : [{ valid, cut: tallied.referenceCut }];
  });
  return [[record.version, { reads, closedRun }]];
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
  const { reference, won, by, room } = last;
  return [
    [record.version, { won: won === null ? null : won === reference ? "reference" : "other", by, room }],
  ];
}

/**
 * The `count` held-out tasks of `pool` a release takes, each with why, in the order they are
 * taken. A task no reference solve answered in two comparisons goes to the Builder before the draw:
 * it is what a session has to work on, where every released task passes. Then the tasks the reference
 * harness failed in the last comparison, half of them rounded up, so that the comparison keeps
 * tasks it can untie. The rest is the contract's draw over every task neither list holds, those the
 * reference answered in every solve among them: such a task still teaches through the objective's
 * measure a practice pass returns. From 16 to 20 October the draw left them out, and so withheld
 * the tasks the objective left room on: after r3's third, fourth and fifth promotions 12, 18 and 22
 * frontier tasks were held, with room to release 6, 12 and 16, and none could be drawn. Reading
 * that room here would read the other harness's answers and its author's (`bettered`), so which
 * held-out task a new harness won would change what is released, which the Builder reads (rule 3):
 * the release reads the reference's own solves alone. The release in `tools/d2/prepare.ts` calls it.
 *
 * The tasks the reference failed are the ones whose last scored result says it failed
 * a solve, excluding a later dispute or comparison between other harnesses, as a task's outcome
 * does: the tasks that leave the reference room are the ones a Builder has to work on, and on
 * 10 October three campaigns each ran three sessions after a promotion on practice tasks the
 * promoted harness passed, and changed nothing. Until 16 October a task it answered in some
 * solves was no failure, though it leaves room as one it never answered does, and half rounded
 * down released no task where one had failed: between buffer-159-opus's two promotions its
 * Builder's practice passed 10 of 10.
 *
 * A task the reference answered in every solve of its last reading still leaves it room where an
 * answer of its own or its author's on record is better by the objective by at least the floor
 * (`room`, `roomLeft`), and it is put first beside the failed ones. Until 21 October it went to the
 * draw: in an objective domain every solve is valid, so in seven buffer campaigns every release
 * after a first promotion was the draw alone while the frontier held 4 to 21 tasks with room. The
 * other harness's answers stay out of `room`, so which held-out task it won moves no release (rule 3).
 *
 * The tasks the reference never answered are the held-out ones it gave no valid answer in
 * `UNSOLVED_RUN` or more comparisons it stood in, cut at a limit or not, unlike `poolOf`'s `awaiting`:
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
    return last[last.reference].some((valid) => !valid) || (last.room ?? 0) > 0 ? last.order : undefined;
  }).filter((version) => !unanswered.includes(version));
  const first = among([...unanswered, ...failed.slice(0, Math.ceil(failed.length / 2))]);
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

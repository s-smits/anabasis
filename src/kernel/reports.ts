/**
 * What the comparisons on record say of a campaign: whether it should stop, each report read as it
 * was found, the one place each held-out task has and what its author may hear of it (`poolOf`),
 * the tasks a release takes first (`releaseOrder`), and what the log holds of billed dollars.
 *
 * A comparison ends in a `comparison.reported` event under an id, a round's session id or a
 * checkpoint's own (`src/builder/round.ts`). A person's settling writes the same id's report once
 * more, so a comparison is read by its last report, and it stands in the log where its first one
 * does: a settling made weeks later moves no comparison behind the ones run since. Every fold here
 * starts from those. A comparison's solves are the ones whose start names it (`compare.ts`).
 *
 * The harness a comparison is made against is the reference harness: the Starter Built Harness
 * until the operator promotes another, and from then on the one last promoted (`promoted`). The
 * choice is the operator's and the record is the log's (`docs/plan.md`, Phase 6). A Builder goes
 * on from the harness its last session left (`latestBuilt`), step or none.
 * Practice priority reads each task's last scored or disputed result, as its outcome does.
 *
 * The stop rule is the plan's: as many moves in a row that could have shown a gain and showed none
 * as the campaign's patience (`stopRule`, `patienceOf`).
 *
 * Nothing here decides a comparison or makes a solve.
 */
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import {
  closedTo,
  draw,
  objectiveRuleIn,
  type Paired,
  pairsOf,
  tally,
  TRIGGER,
  triggered,
} from "./compare.ts";
import type { LogEvent } from "./log.ts";
import { passed, practiceRan, ranUnder, solvesIn } from "./solves.ts";
import { taskSets } from "./task.ts";

/** A session or a solve that began and has no end on record: the comparison its start names (a
 *  solve's), and the dollars its turns and compactions metered (`unfinished`). */
interface Unfinished {
  readonly comparison: JsonValue | undefined;
  readonly session: JsonValue | undefined;
  dollars: number;
}

/** A comparison's last report, with where the comparison stands in the log: at its first report. */
export interface Reported {
  readonly session: string;
  readonly index: number;
  readonly data: JsonObject;
}

/** What a task's author hears of it: how the reference harness did on it in the last comparison
 *  that scored it (every solve valid, some, none); that the last comparison that scored it was
 *  made between two other harnesses, so nothing of the reference's own is on record for it; that
 *  it was set aside; or that it is no longer scored. */
export type Outcome =
  | "reference-every"
  | "reference-some"
  | "reference-none"
  | "earlier-reference"
  | "disputed"
  | "exhausted";

/** Where a task stands in the counts its author hears (`poolOf`): told apart, and by which
 *  side; tied with both sides valid in every solve; tied with neither valid in any, with a valid
 *  answer on record (`feasible`) or without; tied otherwise; or set aside. `solves` is the solves
 *  a side it rests on, null for a task set aside. */
export interface Standing {
  readonly cell:
    | "other-won"
    | "reference-won"
    | "tied-every"
    | "tied-none-known"
    | "tied-none"
    | "tied-mixed"
    | "aside";
  readonly solves: number | null;
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
  /** Whether a solve of the task in this comparison ended at a limit (`AT_A_LIMIT`). */
  readonly cut: boolean;
  /** Whether the reference harness closed the task in this comparison (`closedTo`): valid in every
   *  solve, and no two valid answers the objective told apart. False where it stood on neither side. */
  readonly closed: boolean;
  /** The side that won the task in this comparison's tally (`tally`), or null for a tie. */
  readonly won: "old" | "fresh" | null;
}

/**
 * What a log holds of one task, for every reader of its state: the pool and the release are
 * predicates over it, since while each read the log for itself their arithmetic was mended four
 * times (`docs/simplify.md`, C1). Filled by `taskRecords`, which is why its fields are not read-only.
 */
interface TaskRecord {
  readonly version: string;
  /** Whether the task is held out now. */
  readonly held: boolean;
  /** The last event at which a person kept it held (`task.state`), or -1. */
  keptAt: number;
  /** Whether a solve on record gave it a valid answer, under any harness and at any limits. */
  answered: boolean;
  /** `answered`, or `task.feasible` records a passing author answer, or its gate says a reference
   *  solve under `try_task` gave a valid answer, which answers nothing. */
  feasible: boolean;
  /** Each comparison whose last report tallied it, in the order the comparisons reported. */
  readonly tallied: TalliedIn[];
  /** The last report that set it aside on a rejection, or -1, and its place among every pair
   *  and every task set aside, as `TalliedIn.order` counts them, where it was first set aside. */
  asideAt: number;
  asideOrder: number;
}

/** A dollar cap: the billed dollars a comparison, or a Builder session by itself, may hold
 *  (`billedFor`), and what each solve is held at before it starts. */
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
/** The ways a solve ends at a limit of its own: its time, its model turns or its context. Such an
 *  ending says the budget was short, and nothing of whether the task has a valid answer. */
export const AT_A_LIMIT: ReadonlySet<unknown> = new Set(["wall-ended", "turns-ended", "context-ended"]);
const STEP = "step";
/** How a Builder session ends when it was cut and left half a session's work. */
const CUT: ReadonlySet<unknown> = new Set(["killed", "crashed"]);
const REPORTED = "comparison.reported";
const BUILD_FINISHED = "build.finished";
/** Each kind of start whose turns and compactions are billed where no end is on record, with the
 *  field that names the session or the solve in all four events: a Builder's session, an
 *  Examiner's three kinds and a solve attempt. */
const METERED = [
  { of: "build", id: "session" },
  { of: "exam", id: "session" },
  { of: "draft", id: "session" },
  { of: "repair", id: "session" },
  { of: "solve", id: "solve" },
] as const;
/** The events that carry what their own model turns were billed, in a `billed` field: the end of
 *  each of those, and a reviewer's reading. */
const BILLED: ReadonlySet<string> = new Set([
  ...METERED.map(({ of }) => `${of}.finished`),
  "referee.finding",
  "diagnosis.recorded",
]);

/** Whether a cap can hold anything: its dollars and its reserve are numbers above nothing. One
 *  typed with a dollar sign reads as no number, and a session run under it would refuse no solve
 *  (the third review, row F43). */
export function capHolds({ dollars, reserve }: Cap): boolean {
  return [dollars, reserve].every((amount) => Number.isFinite(amount) && amount > 0);
}

/** Each comparison's last report in a log, in the order the comparisons first reported. */
export function lastReports(events: readonly LogEvent[]): Reported[] {
  const found = new Map<string, Reported>();
  for (const [index, { kind, data }] of events.entries()) {
    if (kind !== REPORTED || !isString(data.session)) continue;
    // A map keeps the place of a key's first entry, which is the comparison's first report.
    found.set(data.session, { session: data.session, index: found.get(data.session)?.index ?? index, data });
  }
  return [...found.values()];
}

/**
 * The harness the last whole Builder session left, by its digest, or null while none has changed
 * one. It is where the next session starts unless the operator names another: after a comparison
 * without a step the Builder continues from its latest harness (`docs/plan.md`, Phase 5). A session
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
 * What room a comparison's report shows a harness to gain in, as the process reads it
 * (`docs/plan.md`, "How move 7 decides"): `room` where a task was informative for the reference
 * harness (`informative`, `compare.ts`: valid on some solves and not all, or two of its valid
 * answers apart by the objective past its margin), `too-hard` where neither harness was valid on
 * any solve, and `none` otherwise, the tasks it fails in every solve among them, which leave it
 * nothing to practise on. `side` is the reference's side of the report: `old` in a comparison
 * made against it, and `fresh` in the one it was promoted on, which is the reading the tasks
 * have after a promotion until a comparison against the new reference reads them again.
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

/**
 * The plan's stop rule over a log: how many moves could have shown a gain, how many of them have
 * passed since the last step, and whether that is the campaign's patience (`docs/plan.md`, row
 * F48; `patienceOf`).
 *
 * A move that counts is one of two. The first is a harness a Builder session changed, compared
 * with one reference, where the comparison tallied a task and left room (`roomOf`), or read
 * under the trigger. Such a pair counts once, where it first reported, and reads as its last
 * comparison: a step its repeat does not read again was one draw, and three repeats of one
 * harness are one harness that showed no gain. On 9 October one harness compared with the starter
 * three times, each time on more tasks, stopped a campaign. The second is a whole session that
 * left its harness as it was, where a practice solve of the session failed: it was shown a failure
 * and declined it. A session whose every practice solve passed, or that ran none, had nothing to
 * work on, which is a fault of the supply and no evidence about the domain: all ten campaigns of
 * 9 and 10 October stopped on three such sessions after a promotion, each practising on tasks the
 * promoted harness passed (`docs/plan.md`, row F52).
 *
 * What does not count: a comparison of two harnesses no session made, which a control and a
 * reading of the reference against itself are; one stopped on its check defects, cut by its cap,
 * or with every task set aside, which tested nothing; and one that left no room, whose answer is
 * other tasks and no other harness. Every comparison on record is read, whatever the setting id
 * it carries, since the id names the host's code and a tree moved to a new commit changes it.
 */
export function stopRule(events: readonly LogEvent[]) {
  const practised = practiceRan(events);
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
    const shown = practised.some(
      ({ started, ending }) => started > from && started < index && ending?.outcome === "fail",
    );
    if (shown) idle.push({ index, step: false });
  }
  // The campaign's trigger as its opening records it (`--trigger`, a string), or `TRIGGER`.
  const named = asRecord(events.findLast(({ kind }) => kind === "campaign.opened")?.data.terms)?.trigger;
  const parsed = isString(named) ? Number(named) : Number.NaN;
  const trigger = Number.isFinite(parsed) ? parsed : TRIGGER;
  /** Each pair of a harness and a reference, where it first reported and as it last read. */
  const pairs = new Map<string, { index: number; step: boolean; counts: boolean }>();
  for (const { index, data } of lastReports(events)) {
    const { old, fresh, versions } = data;
    const tallied = asRecord(data.scored) !== null && Array.isArray(versions) && versions.length > 0;
    if (!tallied || !isString(fresh) || !built.has(fresh)) continue;
    const pair = `${fresh} ${isString(old) ? old : ""}`;
    // A reading under the trigger showed a gain too: it bought the repeat.
    const step = data.reading === STEP || triggered(data, trigger);
    pairs.set(pair, {
      index: pairs.get(pair)?.index ?? index,
      step,
      counts: step || roomOf(data) === "room",
    });
  }
  const moves = [...pairs.values().filter(({ counts }) => counts), ...idle].toSorted(
    (one, other) => one.index - other.index,
  );
  const sinceStep = moves.length - 1 - moves.findLastIndex(({ step }) => step);
  return { checkpoints: moves.length, sinceStep, stop: sinceStep >= patienceOf(events) };
}

/**
 * The pairs a comparison's last report tallied, read as the comparison found them: from the log up
 * to its first report, so a task released, refused or disputed since is still the scored task it
 * was, under the report's own two harnesses and setting, counting the comparison's own solves, and
 * each side cut to the solves it asked for (under `--noise`, the reference's first mirrored half,
 * `halves`). None for a report that compared nothing, or before a solve named its comparison.
 */
export function pairsReported(events: readonly LogEvent[], report: Reported): Paired[] {
  const { session, index, data } = report;
  const { old, fresh, setting, solves } = data;
  const versions = Array.isArray(data.versions) ? data.versions.filter(isString) : [];
  if (data.scored === null || !isString(old) || !isString(fresh) || !isString(setting) || !isNumber(solves)) {
    return [];
  }
  const begun = events.find(
    ({ kind, data: start }) => kind === "comparison.started" && start.session === session,
  );
  const halves = begun?.data.noise === true ? ("mirrored" as const) : undefined;
  const sides = { old, fresh, setting, comparison: session, objective: objectiveRuleIn(data), halves };
  return pairsOf(events.slice(0, index + 1), versions, sides, solves).pairs;
}

/** The held-out tasks `place` gives a place, in the order of their places: the first pair that
 *  put each on the list. */
function placed(records: readonly TaskRecord[], place: (record: TaskRecord) => number | undefined): string[] {
  return records
    .flatMap((record) => {
      const at = record.held ? place(record) : undefined;
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
      answered: false,
      feasible: false,
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
    if (kind === "task.feasible" || (isNumber(tried) && tried > 0)) of(data.version).feasible = true;
  }
  /** Each comparison's tasks a solve of which ended at a limit, as `cutIn` names them. */
  const cut = new Set<string>();
  for (const solve of ranUnder(events)) {
    const { task } = solve.under;
    const { comparison } = solve.start;
    if (passed(solve) === true) Object.assign(of(task), { answered: true, feasible: true });
    if (isString(comparison) && AT_A_LIMIT.has(solve.ending?.kind)) cut.add(cutIn(comparison, task));
  }
  tallyReports(events, of, cut);
  return { records: [...records.values()], held: heldOut };
}

/** A task in a comparison, as one key. */
function cutIn(comparison: string, task: string): string {
  return `${comparison} ${task}`;
}

/** The reports' part of `taskRecords`: each comparison's last report gives every task it tallied
 *  one reading and marks the ones it set aside, in the order the reports and their pairs are read. */
function tallyReports(
  events: readonly LogEvent[],
  of: (version: string) => TaskRecord,
  cut: ReadonlySet<string>,
): void {
  const reference = referenceOf(events);
  let order = 0;
  for (const report of lastReports(events)) {
    const { index, session, data } = report;
    const side = data.fresh === reference ? "fresh" : data.old === reference ? "old" : null;
    for (const pair of pairsReported(events, report)) {
      const { task, old, fresh } = pair;
      const { wins, losses } = tally([pair]);
      order += 1;
      of(task).tallied.push({
        index,
        order,
        old,
        fresh,
        reference: side,
        cut: cut.has(cutIn(session, task)),
        closed: side !== null && closedTo(pair, side),
        won: wins > 0 ? "fresh" : losses > 0 ? "old" : null,
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
 * read: `scorable`, in the order the tasks were held out, `awaiting` a person's label, or
 * `exhausted`, with the `retained` among the scorable. Every reader of a task's state reads it
 * here, off one pass over the log.
 *
 * **Awaiting** are the tasks that go to a person as possibly infeasible: no solve on record gave a
 * valid answer to them, and two comparisons that gave their solves room gave none either
 * (`docs/plan.md`, Phase 2). A task with no valid answer ties whatever the harnesses are and costs
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
 * - A comparison in which a solve of the task ended at a limit (`AT_A_LIMIT`) is not counted for
 *   it. That solve was cut, and what it would have answered is not known. A task that is cut at
 *   every comparison so never goes to a person on this rule, and stays a tie the reports show.
 *
 * What neither covers is an answer rushed under a told budget and rejected: with no valid answer
 * on record such a comparison counts, since nothing in the log tells a rushed answer from a
 * finished one.
 *
 * A label that keeps a task is a `task.state` event that holds it once more, and the two
 * comparisons are then counted from that label on; a label that calls it infeasible refuses it,
 * and a refused task is no held-out task.
 *
 * **Exhausted** are the tasks the reference harness answered validly in every solve of
 * `UNSOLVED_RUN` or more comparisons, on whichever side it stood, but for a third of them, and
 * they are left out of the scored set (`scoredSet`). The fold is read again against whatever harness is the
 * reference at the time, so a promotion re-derives it at once: the comparisons the promoted
 * harness won before its promotion count. Such a task can only tie again at that budget or be
 * lost, unless the comparison carried an objective that told two valid answers of it apart
 * (`closedTo`, `compare.ts`): a task the objective still separates is not closed, since the next harness can
 * win it. Every one in the set is a task a step cannot be read on: on the operator's host (9 and
 * 10 October) a harness came one win short of a step three times with most of its tasks tied, and
 * one promoted harness and the starter tied 10 of 10 twice. The reference's own answers close a
 * task, since its answers are what the next harness has to match: closed only where both
 * harnesses answered it, a task the new harness lost stayed in the draw, and in the simulated
 * climb of 10 October three comparisons in a row read 2-0-6 and 3-0-5 on a scored set of eight
 * and the campaign stopped one win short. A third of them stays in the draw by the contract's
 * hash, a comparison's retained set (`retained`), so that a harness that breaks what the
 * reference answers still shows its losses: left out whole, the set would hold no task the new
 * harness could lose. The Examiner is told a task is exhausted, as that task's outcome
 * (`outcomes`); in the counts by family it stands where its last comparison's tally puts it
 * (`standings`).
 *
 * **Feasible** are the task versions a valid answer is on record for: a solve's, under any harness
 * and at any limits, an author's answer the host saw pass on the task under its own id
 * (`task.feasible`), or a reference solve's under `try_task`, which its gate counts. It is the one
 * fact an author may hear beside a task's outcome that names no side: a task the reference
 * answers in no solve is then told apart from one nobody has answered.
 *
 * **Outcomes** hold each task some comparison scored or set aside, by task version, from the last
 * comparison that did: how the reference harness did on it, valid in every one of its counted
 * solves, in some, or in none. The plan lets a task's author hear this of each task
 * (`docs/plan.md`, Phase 2): without a stronger solve the author would otherwise hear nothing, and
 * a difficulty zone or a target count is what v1 found an author writes towards. The reading is of
 * the reference's side alone: which other harness was compared, and what it answered on that
 * task, are not the author's. What the other side did reaches the author only as counts by family
 * (`standings`). An outcome that named a winner told the author nothing of where the room was:
 * after a control a task the reference and the starter both failed read as one with no valid
 * answer, which the author's prompt says measures nothing (`docs/simplify.md`, F3). A task no
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
 * **Standings** hold where each task some comparison scored or set aside stands in the counts its
 * author hears, by task version (`Standing`; why, in `src/examiner/record.ts`). It is read from the
 * record the outcome is read from (`lastRead`), so the counts and the lines agree by construction.
 * A task last compared between two other harnesses has an outcome and no standing. Told apart is
 * the comparison's own tally (`tally`, `compare.ts`), so under an objective two valid answers can
 * be told apart, and a tie with both sides valid in every solve is one the objective did not break.
 */
export function poolOf(events: readonly LogEvent[]) {
  const { records, held } = taskRecords(events);
  const awaiting = placed(records, ({ feasible, keptAt, tallied }) =>
    runOf(tallied.filter(({ index, cut }) => !feasible && index >= keptAt && !cut)),
  );
  const spent = placed(records, ({ tallied }) => runOf(tallied.filter(({ closed }) => closed)));
  const contract = events.find(({ kind }) => kind === "checker.read")?.data.contract;
  const kept = new Set(
    draw(spent, Math.ceil(spent.length / 3), `${isString(contract) ? contract : ""}:kept`),
  );
  const exhausted = spent.filter((task) => !kept.has(task));
  const out = new Set([...awaiting, ...exhausted]);
  const first = ({ tallied, asideOrder }: TaskRecord) =>
    Math.min(tallied[0]?.order ?? asideOrder, asideOrder);
  return {
    scorable: held.filter((task) => !out.has(task)),
    awaiting,
    exhausted,
    retained: spent.filter((task) => kept.has(task)),
    feasible: new Set(records.flatMap(({ version, feasible }) => (feasible ? [version] : []))),
    outcomes: new Map(
      records
        .toSorted((one, other) => first(one) - first(other))
        .flatMap((record) => outcomeOf(record, exhausted)),
    ),
    standings: new Map(records.flatMap(standingOf)),
  };
}

/** What a task's author hears of it (`poolOf`, outcomes), or nothing where no report read it. */
function outcomeOf(record: TaskRecord, exhausted: readonly string[]): [string, Outcome][] {
  const { version } = record;
  const last = lastRead(record);
  if (last === null) return [];
  if (last === "aside") return [[version, "disputed"]];
  if (exhausted.includes(version)) return [[version, "exhausted"]];
  if (last.reference === null) return [[version, "earlier-reference"]];
  const own = last[last.reference];
  const valid = own.filter(Boolean).length;
  return [
    [version, valid === own.length ? "reference-every" : valid === 0 ? "reference-none" : "reference-some"],
  ];
}

/** Where a task stands in the counts its author hears (`poolOf`, standings), or nothing where no
 *  report read it against the reference. */
function standingOf(record: TaskRecord): [string, Standing][] {
  const last = lastRead(record);
  if (last === null) return [];
  if (last === "aside") return [[record.version, { cell: "aside", solves: null }]];
  const { reference, won, old, fresh } = last;
  if (reference === null) return [];
  const both = [...old, ...fresh];
  const none = record.feasible ? "tied-none-known" : "tied-none";
  const tied = both.every(Boolean) ? "tied-every" : both.some(Boolean) ? "tied-mixed" : none;
  const cell = won === null ? tied : won === reference ? "reference-won" : "other-won";
  return [[record.version, { cell, solves: old.length }]];
}

/**
 * The `count` held-out tasks of `pool` a release takes, each with why, in the order they are
 * taken. A task no solve answered in two comparisons goes to the Builder before the draw
 *: it is what a session has to work on, where every released task passes.
 * Then the tasks the reference harness failed in the last comparison, half of them at most, so
 * that the comparison keeps tasks it can untie. The rest is the contract's
 * draw, over the tasks neither list holds, so that the draw cannot release the half kept back.
 * The release in `tools/d2/prepare.ts` calls it.
 *
 * The tasks the reference failed are the held-out ones whose last scored result says it answered
 * none, excluding a later dispute or comparison between other harnesses, as a task's outcome
 * does: the tasks that leave the reference room are the ones a Builder has to work on, and on
 * 10 October three campaigns each ran three sessions after a promotion on practice tasks the
 * promoted harness passed, and changed nothing.
 *
 * The tasks no solve answered are the held-out ones without a valid answer in `UNSOLVED_RUN` or
 * more comparisons, cut at a limit or not. On 10 October one campaign held four to five such tasks
 * of ten while its last three Builder sessions passed every practice task and changed nothing.
 * `poolOf`'s `awaiting` is the question to a person, which leaves out a task cut at a limit; this
 * leaves nothing out, since a task cut twice is as much beyond the harness as one answered wrongly
 * twice. A valid answer anywhere on record settles it either way.
 */
export function releaseOrder(
  events: readonly LogEvent[],
  pool: readonly string[],
  count: number,
  seed: string,
): [string, string][] {
  const { records } = taskRecords(events);
  const among = (versions: readonly string[]) => versions.filter((version) => pool.includes(version));
  const unanswered = among(
    placed(records, ({ answered, tallied }) => (answered ? undefined : runOf(tallied))),
  );
  const failed = among(
    placed(records, (record) => {
      const last = lastRead(record);
      if (last === null || last === "aside" || last.reference === null) return undefined;
      const own = last[last.reference];
      return own.length > 0 && !own.some(Boolean) ? last.order : undefined;
    }),
  ).filter((version) => !unanswered.includes(version));
  const first = [...unanswered, ...failed.slice(0, Math.floor(failed.length / 2))];
  const rest = pool.filter((version) => !first.includes(version) && !failed.includes(version));
  const chosen = [
    ...first.slice(0, count),
    ...draw(rest, Math.min(rest.length, Math.max(0, count - first.length)), seed),
  ];
  return chosen.map((version) => {
    const why = unanswered.includes(version)
      ? ": no solve answered it in two comparisons, and it is"
      : failed.includes(version)
        ? ": the reference harness failed it in the last comparison, and it is"
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

/**
 * The billed dollars a log holds for comparison `id`: every attempt of a solve whose start names
 * it, every reviewer's reading of such a solve, and, where a Builder session ran under the same id
 * (a round), everything billed from that session's start to its end, which is the session's own
 * turns, its practice solves and their reviewers. What another comparison or session billed since
 * is not this one's, so a comparison gone on from its log after others ran is held to its own
 * spend. A solve of the comparison with no end on record, killed or still running, is counted by
 * what its turns and compactions have metered so far (`unfinished`); a solve still running is held
 * besides at a cap's reserve, which is what its sum may come to (`src/builder/round.ts`). A live
 * Builder's turns are counted as they are metered, then replaced by its final sum.
 */
export function billedFor(events: readonly LogEvent[], id: string): number {
  const { session, comparison } = billedParts(events, id);
  return session + comparison;
}

/** Every billed dollar a log holds, whoever billed it: what a campaign's total budget is held
 *  against (`docs/plan.md`, row F49). A start the log holds no end of was killed before it could
 *  sum its turns, and is billed by what it metered (`unfinished`). */
export function billedAll(events: readonly LogEvent[]): number {
  const summed = events.reduce(
    (sum, { kind, data }) => (BILLED.has(kind) && isNumber(data.billed) ? sum + data.billed : sum),
    0,
  );
  return unfinished(events).reduce((sum, { dollars }) => sum + dollars, summed);
}

/** The backend's price of one usage, `cost.total`, or nothing where it holds none. */
function costOf(usage: JsonValue | undefined): number {
  const total = asRecord(asRecord(usage)?.cost)?.total;
  return isNumber(total) ? total : 0;
}

/**
 * Every session and solve that began and never ended on record, with the dollars it metered: the
 * run was killed from outside, so no `finished` event summed them, and the cap and the total read 0
 * for what was spent. A turn's `usage.cost.total` is the backend's price of that turn, and the
 * sum over a session's or a solve's turns is what its end carries as `billed`: equal to five
 * decimals on every session and solve of one campaign of 10 October; a Builder session of another,
 * killed at its seventh turn the same day, had metered 0.12 dollars that nothing summed. A
 * compaction of pi's loop is billed in the end's sum too, and its summary's price is on its
 * `*.compacted` event (`loopCompaction`, `src/solve/run.ts`), so it is counted here as well.
 */
function unfinished(events: readonly LogEvent[]): Unfinished[] {
  return METERED.flatMap(({ of, id }) => {
    const ended = new Set(events.flatMap(({ kind, data }) => (kind === `${of}.finished` ? [data[id]] : [])));
    const open = new Map<JsonValue | undefined, Unfinished>();
    for (const { kind, data } of events) {
      if (kind === `${of}.started` && !ended.has(data[id])) {
        open.set(data[id], {
          comparison: data.comparison,
          session: of === "build" ? data.session : undefined,
          dollars: 0,
        });
      }
      const found = open.get(data[id]);
      if (found === undefined) continue;
      if (kind === `${of}.turn`) found.dollars += costOf(data.usage);
      if (kind === `${of}.compacted` && Array.isArray(data.usages)) {
        found.dollars += data.usages.reduce((sum: number, usage) => sum + costOf(usage), 0);
      }
    }
    return [...open.values()];
  });
}

/** The same sum in its two parts: what the Builder session under `id` billed, and what the
 *  comparison under it did. A reader of a round tells them apart (`src/builder/handover.ts`). A
 *  solve with no end on record whose start names the comparison is in the second part
 *  (`unfinished`). */
export function billedParts(events: readonly LogEvent[], id: string) {
  const own = new Set(solvesIn(events).flatMap((solve) => (solve.start.comparison === id ? [solve.id] : [])));
  const at = (kind: string) => events.findIndex((event) => event.kind === kind && event.data.session === id);
  const [opened, closed] = [at("build.started"), at(BUILD_FINISHED)];
  const billed = { session: 0, comparison: 0 };
  for (const [index, { kind, data }] of events.entries()) {
    if (!BILLED.has(kind) || !isNumber(data.billed)) continue;
    const inSession = opened !== -1 && index >= opened && (closed === -1 || index <= closed);
    if (inSession) billed.session += data.billed;
    else if (isString(data.solve) && own.has(data.solve)) billed.comparison += data.billed;
  }
  for (const { comparison, session, dollars } of unfinished(events)) {
    if (session === id) billed.session += dollars;
    else if (comparison === id) billed.comparison += dollars;
  }
  return billed;
}

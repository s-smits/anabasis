/**
 * What the comparisons on record say of a campaign: whether it should stop, each report read as it
 * was found, the tasks a person has to read before they are scored again, the one outcome of a task
 * its author may hear, and what the log holds of billed dollars.
 *
 * A comparison ends in a `comparison.reported` event under an id, a round's session id or a
 * checkpoint's own (`src/builder/round.ts`). A person's settling writes the same id's report once
 * more, so a comparison is read by its last report, and it stands in the log where its first one
 * does: a settling made weeks later moves no comparison behind the ones run since. Every fold here
 * starts from those. A comparison's solves are the ones whose start names it (`compare.ts`).
 *
 * The harness a comparison is made against is the reference harness: the Starter Built Harness
 * until the operator promotes another, and from then on the one last promoted (`promoted`). The
 * choice is the operator's and the record is the log's (`docs/plan.md`, Phase 6): until
 * 2026-10-09 a promotion was a flag on one command, and the next command without it was read
 * against the starter again. A Builder goes on from the harness its last session left
 * (`latestBuilt`), step or none.
 *
 * The stop rule is the plan's: three moves in a row that could have shown a gain and showed none
 * (`stopRule`). Until 2026-10-09 it pooled a gain in pass-rate points over three sessions, which
 * measured the thing the plan no longer scores by (`docs/plan.md`, Tuning).
 *
 * Nothing here decides a comparison or makes a solve.
 */
import { asRecord, isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import { draw, type Paired, pairings, pairsOf } from "./compare.ts";
import type { LogEvent } from "./log.ts";
import { passed, practiceRan, ranUnder, solvesIn } from "./solves.ts";
import { taskSets } from "./task.ts";

/** A comparison's last report, with where the comparison stands in the log: at its first report. */
interface Reported {
  readonly session: string;
  readonly index: number;
  readonly data: JsonObject;
}

/** What a task's author may hear of it: that one of the two harnesses won it, that it was a tie
 *  between valid answers, that no solve of the last comparison gave a valid answer, or that a
 *  rejection of an answer to it is not settled. Never which harness, and never a count. */
export type Outcome = "won" | "tie" | "no-valid-answer" | "disputed" | "exhausted" | "earlier-setting";

/** A dollar cap: the billed dollars a comparison, or a Builder session by itself, may hold
 *  (`billedFor`), and what each solve is held at before it starts. */
export interface Cap {
  readonly dollars: number;
  readonly reserve: number;
}

/** Moves without a gain at which the plan stops the campaign. */
/**
 * The campaign's patience, where its opening names none: the moves in a row that could have shown
 * a gain and showed none before the stop rule ends it, and move 7's bound on Examiner sessions in
 * a row that held out no task and on comparisons of one harness that left no room. The plan's
 * three ended every campaign of 9 and 10 October before its tasks were measured, and the operator
 * set the development phase to err towards more iterations of the Builder than fewer
 * (10 October): six, until a campaign climbs and the figure can be read from its record.
 */
export const PATIENCE = 6;
/** The shares of valid solves by which the process reads room (`roomOf`): the reference harness
 *  above `full` leaves none, and both harnesses below `empty` are held by tasks too hard for the
 *  budget. The two fractions are the plan's proposal, and the operator's to set. */
export const ROOM = { full: 3 / 4, empty: 1 / 4 } as const;
/** Comparisons without a valid answer after which a task with none on record goes to a person. */
const UNSOLVED_RUN = 2;
/** The ways a solve ends at a limit of its own: its time, its model turns or its context. Such an
 *  ending says the budget was short, and nothing of whether the task has a valid answer. */
const AT_A_LIMIT: ReadonlySet<unknown> = new Set(["wall-ended", "turns-ended", "context-ended"]);
const STEP = "step";
/** How a Builder session ends when it was cut and left half a session's work. */
const CUT: ReadonlySet<unknown> = new Set(["killed", "crashed"]);
const REPORTED = "comparison.reported";
const BUILD_FINISHED = "build.finished";
/** The events that carry what their own model turns were billed, in a `billed` field: a solve
 *  attempt, a Builder or an Examiner session, and a reviewer's reading. */
const BILLED: ReadonlySet<string> = new Set([
  "solve.finished",
  BUILD_FINISHED,
  "exam.finished",
  "draft.finished",
  "referee.finding",
  "diagnosis.recorded",
]);
/** Each kind of start its turns are billed by where no end is on record, with the field that
 *  names the session or the solve in all three events. */
const TURNS = [
  { started: "build.started", finished: BUILD_FINISHED, turn: "build.turn", id: "session" },
  { started: "exam.started", finished: "exam.finished", turn: "exam.turn", id: "session" },
  { started: "draft.started", finished: "draft.finished", turn: "draft.turn", id: "session" },
  { started: "solve.started", finished: "solve.finished", turn: "solve.turn", id: "solve" },
] as const;

/** Whether a cap can hold anything: its dollars and its reserve are numbers above nothing. One
 *  typed with a dollar sign reads as no number, and until 2026-10-09 a session by itself ran
 *  under it with no solve refused (the third review, row F43). */
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
 * that was killed or that crashed froze half a session's work and is passed over.
 */
export function latestBuilt(events: readonly LogEvent[]): string | null {
  const left = events.findLast(
    ({ kind, data }) =>
      kind === BUILD_FINISHED && data.changed === true && isString(data.harness) && !CUT.has(data.ended),
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

/** A harness's share of valid solves, from a report's count of its tasks by how many of their
 *  solves were valid, over every scored task; null where the report holds no such count. */
function validShare(counts: unknown): number | null {
  if (!Array.isArray(counts) || counts.length < 2 || !counts.every(isNumber)) return null;
  const tasks = counts.reduce((sum, each) => sum + each, 0);
  const valid = counts.reduce((sum, each, solves) => sum + each * solves, 0);
  return tasks === 0 ? null : valid / (tasks * (counts.length - 1));
}

/**
 * The share of its solves on which the harness on `side` of a comparison was valid, by its report:
 * at the limits the comparison ran under, or with `turns` at the shorter budget of that many of
 * the model's turns it was also read at. Null where the report holds no such count.
 *
 * The share is over every scored task, the ones no solve answered counted as failed. Until
 * 10 October those were left out, on the reading that a task neither harness answered is hard
 * for both or has no valid answer and says nothing of room: an Examiner pressing its tasks to
 * the margin had written two of seven with no valid answer (2026-10-09). The simulated climb of
 * 10 October showed the cost: after a promotion the Examiner wrote six tasks the promoted
 * harness fails, the control read it valid on every task it answered, with the six left out, and
 * four comparisons read "no room" and ended the campaign with no Builder session on tasks that
 * were the room itself. A task the reference harness fails is room whether or not the starter
 * answers it; one with no valid answer at all goes to a person after two comparisons
 * (`awaitingLabel`), and the Examiner's `try_answer` is for writing none.
 */
export function validAt(report: JsonObject, side: "old" | "fresh", turns?: number): number | null {
  const rows = Array.isArray(report.budgets) ? report.budgets.map(asRecord) : [];
  const row =
    turns === undefined ? report : rows.find((each) => each?.turns === turns && each.seconds === undefined);
  return validShare(asRecord(row?.valid)?.[side]);
}

/**
 * What room a comparison's report shows a harness to gain in, as the process reads it
 * (`docs/plan.md`, "How move 7 decides"): `none` where the reference harness was valid on more
 * than three solves in four, so that its tasks could mostly only tie; `too-hard` where neither
 * harness was valid on one solve in four; and `room` otherwise, and for a report that holds no
 * count of valid solves. `turns` reads the same at a shorter budget the comparison was read at.
 */
export function roomOf(report: JsonObject, turns?: number): "none" | "too-hard" | "room" {
  const [old, fresh] = [validAt(report, "old", turns), validAt(report, "fresh", turns)];
  if (old === null || fresh === null) return "room";
  if (old > ROOM.full) return "none";
  return old < ROOM.empty && fresh < ROOM.empty ? "too-hard" : "room";
}

/**
 * The plan's stop rule over a log: how many moves could have shown a gain, how many of them have
 * passed since the last step, and whether that is the campaign's patience (`docs/plan.md`, row
 * F48; `patienceOf`).
 *
 * A move that counts is one of two. The first is a harness a Builder session changed, compared
 * with one reference under the campaign's setting, where the comparison tallied a task and left
 * room (`roomOf`). Such a pair counts once, where it first reported, and reads as its last
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
 * or with every task set aside, which tested nothing; one that left no room, whose answer is
 * another budget or other tasks and no other harness; and whatever stands before the last
 * comparison under another setting, since no comparison is read across two. A harness set against
 * the starter after it was compared with another reference is that comparison's reading against
 * the starter (`starter-unread`), and no move of its own.
 */
/** The campaign's patience as its opening records it (`--patience`), or `PATIENCE`. */
export function patienceOf(events: readonly LogEvent[]): number {
  const named = events.findLast(({ kind }) => kind === "campaign.opened")?.data.patience;
  return isNumber(named) ? named : PATIENCE;
}

export function stopRule(events: readonly LogEvent[]) {
  const built = new Set(
    events.flatMap(({ kind, data }) =>
      kind === BUILD_FINISHED && data.changed === true && isString(data.harness) ? [data.harness] : [],
    ),
  );
  const tallied = lastReports(events).filter(
    ({ data }) =>
      asRecord(data.scored) !== null &&
      Array.isArray(data.versions) &&
      data.versions.length > 0 &&
      isString(data.fresh) &&
      built.has(data.fresh),
  );
  const setting = tallied.at(-1)?.data.setting;
  const from = (tallied.findLast(({ data }) => data.setting !== setting)?.index ?? -1) + 1;
  /** The harnesses already compared with a reference that is not the starter. */
  const referenced = new Set<unknown>();
  /** Each pair of a harness and a reference, where it first reported and as it last read. */
  const pairs = new Map<string, { index: number; step: boolean; counts: boolean }>();
  for (const { index, data } of tallied) {
    const { old, fresh, starter } = data;
    if (index < from) continue;
    if (old !== starter) referenced.add(fresh);
    else if (referenced.has(fresh)) continue;
    const pair = `${isString(fresh) ? fresh : ""} ${isString(old) ? old : ""}`;
    const step = data.reading === STEP;
    pairs.set(pair, {
      index: pairs.get(pair)?.index ?? index,
      step,
      counts: step || roomOf(data) === "room",
    });
  }
  const practised = practiceRan(events);
  const idle = events.flatMap(({ kind, data }, index) => {
    if (kind !== BUILD_FINISHED || data.changed !== false || CUT.has(data.ended) || index < from) return [];
    const began = events.findLastIndex(
      (event, at) => at < index && event.kind === "build.started" && event.data.session === data.session,
    );
    const shown = practised.some(
      ({ started, ending }) => started > began && started < index && ending?.outcome === "fail",
    );
    return shown ? [{ index, step: false }] : [];
  });
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
 * each side cut to the solves a side it asked for. None for a report that compared nothing, and
 * none for a comparison made before a solve's start named its comparison (2026-10-09).
 */
export function pairsReported(events: readonly LogEvent[], report: Reported): Paired[] {
  const { session, index, data } = report;
  const { old, fresh, setting, solves } = data;
  const versions = Array.isArray(data.versions) ? data.versions.filter(isString) : [];
  if (!isString(old) || !isString(fresh) || !isString(setting) || !isNumber(solves)) return [];
  const sides = { old, fresh, setting, comparison: session };
  return whole(pairsOf(events.slice(0, index + 1), versions, sides).pairs, solves).pairs;
}

/** The task versions comparison `id` got a valid answer to, under any of its harnesses: the two of
 *  its test, the reference harness's further solves where it was read against itself, and the
 *  starter's. */
export function answered(events: readonly LogEvent[], id: string): Set<string> {
  return new Set(
    ranUnder(events).flatMap((solve) =>
      solve.start.comparison === id && passed(solve) === true ? [solve.under.task] : [],
    ),
  );
}

/** Each pair cut to its first `solves` solves a side, and the tasks that have fewer. A reference
 *  harness read against itself is solved twice as often, and a comparison gone on from its log can
 *  leave a task one solve over on a side; a tally needs as many of each. */
export function whole(pairs: readonly Paired[], solves: number) {
  const enough = ({ old, fresh }: Paired) => old.length >= solves && fresh.length >= solves;
  const cut = <T>(list: readonly T[] = []) => list.slice(0, solves);
  return {
    pairs: pairs.flatMap((pair): Paired[] => {
      if (!enough(pair)) return [];
      const { task, old, fresh, solves: named, used } = pair;
      return [
        {
          task,
          old: cut(old),
          fresh: cut(fresh),
          solves: { old: cut(named?.old), fresh: cut(named?.fresh) },
          used: { old: cut(used?.old), fresh: cut(used?.fresh) },
        },
      ];
    }),
    short: pairs.flatMap((pair) => (enough(pair) ? [] : [pair.task])),
  };
}

/** Whether no solve of a pair gave a valid answer. */
export function unsolved({ old, fresh }: Paired): boolean {
  return ![...old, ...fresh].some(Boolean);
}

/**
 * The tasks that go to a person as possibly infeasible, by version: no solve on record gave a valid
 * answer to them, and two comparisons that gave their solves room gave none either
 * (`docs/plan.md`, Phase 2). A task with no valid answer ties whatever the harnesses are and costs
 * its solves at every comparison. It may be hard, it may be wrongly checked, or it may have no
 * valid answer at all, and only a person can tell the third: on an infeasible task every rejection
 * is a true fail, correctly, every time (the review of 2026-10-09, finding 10). So it leaves the
 * scored set until it is labelled (`tools/d2/prepare.ts`).
 *
 * Two things keep a budget from sending a feasible task there, which the rule did until
 * 2026-10-09. Under a five-minute wall three of buffer's tasks had no valid answer from either
 * harness, and every solve of the same three had been valid at two hours; a second comparison at
 * that wall would have taken them out of the scored set as possibly infeasible.
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
 */
/**
 * The held-out tasks the reference harness answered validly in every solve of `UNSOLVED_RUN` or
 * more comparisons under the campaign's last setting, but for a third of them: exhausted, and
 * left out of the scored set from then on (`scoredSet`), until the setting or the reference
 * changes. Such a task can only tie again at that budget or be lost, and every one in the set is
 * a task a step cannot be read on: on the operator's host (9 and 10 October) a harness came one
 * win short of a step three times with most of its tasks tied, and t-10's promoted harness and
 * the starter tied 10 of 10 twice. Until 10 October both harnesses had to answer the task, so a
 * task the reference answered and a new harness lost never closed; the simulated climb of that
 * day kept drawing such tasks, three comparisons in a row read 2-0-6 and 3-0-5 on a scored set
 * of eight, and the campaign stopped one win short. The reference's own answers close a task,
 * since its answers are what the next harness has to match. A third of them stays in
 * the draw, by the contract's hash, so that a harness that breaks what the reference answers
 * still shows its losses: left out whole, the set would hold no task the new harness could lose.
 * The Examiner is told a task is exhausted, which is one outcome a task and no count
 * (`outcomesOf`).
 */
export function exhausted(events: readonly LogEvent[]): string[] {
  const reports = lastReports(events);
  const setting = reports.at(-1)?.data.setting;
  // The reference harness: the one last promoted, or the one the first report was made against.
  const reference = promoted(events) ?? reports[0]?.data.old;
  const runs = new Map<string, number>();
  // Its own answers, on whichever side it stood: the old one of a comparison made against it,
  // the fresh one where it was read as the new harness before its promotion.
  for (const report of reports.filter(({ data }) => data.setting === setting)) {
    const side = report.data.fresh === reference ? "fresh" : report.data.old === reference ? "old" : null;
    if (side === null) continue;
    for (const pair of pairsReported(events, report)) {
      const own = pair[side];
      if (own.length > 0 && own.every(Boolean)) runs.set(pair.task, (runs.get(pair.task) ?? 0) + 1);
    }
  }
  const held = new Set(taskSets(events).held);
  const spent = [...runs].flatMap(([task, run]) => (run >= UNSOLVED_RUN && held.has(task) ? [task] : []));
  const contract = events.find(({ kind }) => kind === "checker.read")?.data.contract;
  const kept = new Set(
    draw(spent, Math.ceil(spent.length / 3), `${isString(contract) ? contract : ""}:kept`),
  );
  return spent.filter((task) => !kept.has(task));
}

export function awaitingLabel(events: readonly LogEvent[]): string[] {
  const kept = new Map<string, number>();
  for (const [index, { kind, data }] of events.entries()) {
    if (kind === "task.state" && data.state === "held" && isString(data.version)) {
      kept.set(data.version, index);
    }
  }
  const ran = ranUnder(events);
  const feasible = new Set(ran.flatMap((solve) => (passed(solve) === true ? [solve.under.task] : [])));
  const made = (comparison: string, task: string) => `${comparison} ${task}`;
  const cut = new Set(
    ran.flatMap((solve) => {
      const { comparison } = solve.start;
      return isString(comparison) && AT_A_LIMIT.has(solve.ending?.kind)
        ? [made(comparison, solve.under.task)]
        : [];
    }),
  );
  const runs = new Map<string, number>();
  for (const report of lastReports(events)) {
    for (const { task } of pairsReported(events, report)) {
      const counted =
        !feasible.has(task) && report.index >= (kept.get(task) ?? -1) && !cut.has(made(report.session, task));
      if (counted) runs.set(task, (runs.get(task) ?? 0) + 1);
    }
  }
  return [...runs].flatMap(([task, run]) => (run >= UNSOLVED_RUN ? [task] : []));
}

/**
 * The held-out tasks no solve has answered in `UNSOLVED_RUN` or more comparisons, cut at a limit
 * or not: what a Builder has to work on, where it is given them. A proposal for the operator, made
 * on 10 October after t-5 (subset sum) held four to five such tasks of ten while its last three
 * Builder sessions passed every practice task and changed nothing, and t-4, t-9 and t-10 stopped
 * the same way after a promotion. `awaitingLabel` is the question to a person, which leaves out a
 * task cut at a limit; this leaves nothing out, since a task cut twice is as much beyond the
 * harness as one answered wrongly twice. A valid answer anywhere on record settles it either way.
 */
/**
 * The held-out tasks the reference harness failed in the last reported comparison: a solve under
 * the comparison's reference side that ended as a fail, and no valid one of its on that task
 * there. With `unansweredTwice` it is what a release takes before the contract's draw: the tasks
 * that leave the reference room are the ones a Builder has to work on, and on 10 October t-4,
 * t-9 and t-10 each ran three sessions after a promotion on practice tasks the promoted harness
 * passed, and changed nothing. Half of them at most are released at once (`tools/d2/prepare.ts`),
 * so that the comparison keeps tasks it can untie.
 */
export function referenceFailed(events: readonly LogEvent[]): string[] {
  const last = lastReports(events).at(-1);
  const old = last?.data.old;
  if (last === undefined || !isString(old)) return [];
  const own = ranUnder(events).filter(
    (solve) => solve.start.comparison === last.session && solve.under.harness === old,
  );
  const valid = new Set(own.flatMap((solve) => (passed(solve) === true ? [solve.under.task] : [])));
  const failed = new Set(
    own.flatMap((solve) =>
      passed(solve) === false && !valid.has(solve.under.task) ? [solve.under.task] : [],
    ),
  );
  const held = new Set(taskSets(events).held);
  return [...failed].filter((task) => held.has(task));
}

export function unansweredTwice(events: readonly LogEvent[]): string[] {
  const ran = ranUnder(events);
  const feasible = new Set(ran.flatMap((solve) => (passed(solve) === true ? [solve.under.task] : [])));
  const runs = new Map<string, number>();
  for (const report of lastReports(events)) {
    for (const { task } of pairsReported(events, report)) {
      if (!feasible.has(task)) runs.set(task, (runs.get(task) ?? 0) + 1);
    }
  }
  const held = new Set(taskSets(events).held);
  return [...runs].flatMap(([task, run]) => (run >= UNSOLVED_RUN && held.has(task) ? [task] : []));
}

/**
 * The outcome of each task some comparison scored or set aside, by task version, from the last
 * comparison that did under the setting the last report was made under. The plan lets a task's
 * author hear this and no more (`docs/plan.md`, Phase 2): without a stronger solve the author
 * would otherwise hear nothing, and a difficulty zone or a count is what v1 found an author
 * writes towards. A task no comparison has scored has no outcome. A tie with a valid answer in it
 * is a tie between valid answers on both sides, since a task ties when both harnesses gave as
 * many. A tie the test's own solves left without a valid answer is still no "no valid answer"
 * where another solve of the comparison gave one (`answered`).
 *
 * An outcome is of a setting: on 10 October t-10's five tasks tied at 10 turns and read "won" at
 * 3 without a byte of them changing, and the Examiner that heard "won" was told no budget. A task
 * whose last report stands under another setting than the last report's is `earlier-setting`: it
 * was compared, and not under the budget the campaign now compares at.
 */
export function outcomesOf(events: readonly LogEvent[]): Map<string, Outcome> {
  const outcomes = new Map<string, Outcome>();
  const spent = new Set(exhausted(events));
  const reports = lastReports(events);
  const setting = reports.at(-1)?.data.setting;
  for (const report of reports) {
    const now = report.data.setting === setting;
    const valid = answered(events, report.session);
    for (const pair of pairsReported(events, report)) {
      const won = pairings(pair);
      const tied = valid.has(pair.task) ? "tie" : "no-valid-answer";
      const outcome = spent.has(pair.task) ? "exhausted" : won.fresh === won.old ? tied : "won";
      outcomes.set(pair.task, now ? outcome : "earlier-setting");
    }
    const aside = Array.isArray(report.data.aside) ? report.data.aside.filter(isString) : [];
    for (const task of aside) outcomes.set(task, now ? "disputed" : "earlier-setting");
  }
  return outcomes;
}

/**
 * The billed dollars a log holds for comparison `id`: every attempt of a solve whose start names
 * it, every reviewer's reading of such a solve, and, where a Builder session ran under the same id
 * (a round), everything billed from that session's start to its end, which is the session's own
 * turns, its practice solves and their reviewers. What another comparison or session billed since
 * is not this one's, so a comparison gone on from its log after others ran is held to its own
 * spend. A solve still running has written no sum yet, which is what a cap's reserve is for
 * (`src/builder/round.ts`).
 */
export function billedFor(events: readonly LogEvent[], id: string): number {
  const { session, comparison } = billedParts(events, id);
  return session + comparison;
}

/** Every billed dollar a log holds, whoever billed it: what a campaign's total budget is held
 *  against (`docs/plan.md`, row F49). A start the log holds no end of was killed before it could
 *  sum its turns, and is billed by them (`unfinishedTurns`). */
export function billedAll(events: readonly LogEvent[]): number {
  const summed = events.reduce(
    (sum, { kind, data }) => (BILLED.has(kind) && isNumber(data.billed) ? sum + data.billed : sum),
    0,
  );
  return summed + unfinishedTurns(events);
}

/**
 * The dollars of every turn of a session or a solve that began and never ended on record: the run
 * was killed from outside, so no `finished` event summed them, and the cap and the total read 0
 * for what was spent. A turn's `usage.cost.total` is the backend's price of that turn, and the
 * sum over a session's or a solve's turns is what its end carries as `billed`: equal to five
 * decimals on every session and solve of t-2 (10 October). t-5's b-1, killed at its seventh turn
 * the same day, had metered 0.12 dollars that nothing summed, and three solves of its g-1 were
 * cut the same way.
 */
function unfinishedTurns(events: readonly LogEvent[]): number {
  let dollars = 0;
  for (const { started, finished, turn, id } of TURNS) {
    const ended = new Set(events.flatMap(({ kind, data }) => (kind === finished ? [data[id]] : [])));
    const begun = new Set(
      events.flatMap(({ kind, data }) => (kind === started && !ended.has(data[id]) ? [data[id]] : [])),
    );
    for (const { kind, data } of events) {
      if (kind !== turn || !begun.has(data[id])) continue;
      const total = asRecord(asRecord(data.usage)?.cost)?.total;
      if (isNumber(total)) dollars += total;
    }
  }
  return dollars;
}

/** The same sum in its two parts: what the Builder session under `id` billed, and what the
 *  comparison under it did. A reader of a round tells them apart (`src/builder/handover.ts`). */
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
  return billed;
}

/**
 * `GET /api/move?key=&move=`: one step's detail. A session's own turns and calls (an Examiner's in
 * the exam tier only) and a Builder session's practice solves; a comparison's terms (`fixedIn`),
 * its scored tasks with each side's solves (`pairsReported`) and the tasks it set aside, or before
 * its report the tasks its start fixed with their solves so far. A round runs a Builder session and
 * its comparison under one id, so a move is named by its start's place in the log (`Move.index`);
 * an id is taken where it names exactly one move.
 */
import { fixedIn, predicted, type Report, reported } from "../../../../src/campaign/comparison.ts";
import { carriedBy, type Measures, pointsOf, testedSet } from "../../../../src/kernel/compare.ts";
import type { Ran } from "../../../../src/kernel/solves.ts";
import { taskSets } from "../../../../src/kernel/task.ts";
import { blockingOf } from "../../../../src/kernel/verify.ts";
import { isNumber, isString } from "../../../../src/meta/json-shape.ts";
import { keyIfDefined } from "../../../../src/meta/optional-key.ts";
import {
  isRejection,
  type Move,
  type MoveDetail,
  type Outcome,
  type Query,
  type ScoredTask,
  type Sensitivity,
  type SolveDetail,
  type SolveRow,
  type Tier,
} from "../models.ts";
import { Unanswerable, type Reading } from "./context.ts";
import { type Log, once, practiceIn, proposalsIn, ranIn, solvedIn, verdictsIn } from "./folds.ts";
import { campaignAt } from "./logs.ts";
import { barsIn, movesIn, outcomeOf, ownSolves, pairsIn, steppedOf } from "./moves.ts";
import { examTier, rulingOf, sessionTrace, solveRow, solveTrace } from "./trace.ts";
import { rulingWithheld } from "./withheld.ts";

type ComparisonMove = Extract<Move, { readonly step: "comparison" }>;

/** A task's rulings are withheld for the first of these that holds of one of its rejections. */
const WITHHELD_ORDER = ["report", "label"] as const;

/** The move `named` names: the one starting at that place in the log, else the one move of that id;
 *  an id naming two is refused with both places. */
function moveNamed(log: Log, named: string): Move {
  const moves = movesIn(log);
  if (/^\d+$/u.test(named)) {
    const at = moves.find((move) => String(move.index) === named);
    if (at === undefined) throw new Unanswerable(404, `no move starts at event ${named} in this campaign`);
    return at;
  }
  const found = moves.filter((move) => move.id === named);
  const [move, ...others] = found;
  if (move === undefined) throw new Unanswerable(404, `no move ${named} in this campaign`);
  if (others.length === 0) return move;
  const places = found.map((each) => `the ${each.step} at ${String(each.index)}`).join(" and ");
  throw new Unanswerable(
    400,
    `${named} names ${String(found.length)} moves, ${places}: name one by its place`,
  );
}

const ranByIdIn = once((log) => new Map(ranIn(log).map((solve) => [solve.id, solve])));
const taskIdsIn = once((log) => new Map(proposalsIn(log).map(({ version, taskId }) => [version, taskId])));

function scoredTasks(log: Log, move: ComparisonMove, tier: Tier): ScoredTask[] {
  const solves = ranByIdIn(log);
  const ids = taskIdsIn(log);
  const rows = (named: readonly Ran[]) => named.map((solve) => solveRow(log, solve, tier));
  const byId = (named: readonly string[]) => rows(named.flatMap((id) => solves.get(id) ?? []));
  const scoredTask = (
    task: string,
    outcome: Outcome | null,
    [old, fresh]: readonly [SolveRow[], SolveRow[]],
    carried: keyof Measures | null = null,
  ): ScoredTask => {
    const reasons = new Set(
      [...old, ...fresh].flatMap((row) => (isRejection(row) ? [rulingWithheld(log, row.id, task)] : [])),
    );
    return {
      task,
      taskId: ids.get(task) ?? null,
      outcome,
      withheld: WITHHELD_ORDER.find((why) => reasons.has(why)) ?? null,
      carried,
      old,
      fresh,
    };
  };
  const report = reported(log.events, move.id);
  if (report === null) {
    return (fixedIn(log.events, move.id)?.tasks ?? []).map((task) =>
      scoredTask(task, null, [
        rows(ownSolves(log, move.id, task, move.old)),
        rows(ownSolves(log, move.id, task, move.fresh)),
      ]),
    );
  }
  const tallied = (pairsIn(log).get(move.id) ?? []).map((pair) =>
    scoredTask(
      pair.task,
      outcomeOf(pair),
      [byId(pair.solves?.old ?? []), byId(pair.solves?.fresh ?? [])],
      carriedBy(pointsOf(pair)),
    ),
  );
  // A task set aside is in no pair: its solves are the comparison's on it under each side, cut to its
  // solves a side as a pair is.
  const aside = report.aside.map((task) => {
    const side = (harness: string) => rows(ownSolves(log, move.id, task, harness, move.solves));
    return scoredTask(task, "aside", [side(move.old), side(move.fresh)]);
  });
  return [...tallied, ...aside];
}

function sensitivityOf(report: Report): Sensitivity | null {
  const { scored, frontier, valid, noise, families, overlap } = report;
  if (scored === null) return null;
  const untied = Object.values(families ?? {}).map(({ frontier: { wins, losses } }) => wins + losses);
  // The set the step was read on: the scored tasks, or the frontier in an older report; untied on the
  // scores the step reads (`steppedOf`).
  const test = testedSet(scored, frontier);
  const { wins, losses } = test === null ? { wins: 0, losses: 0 } : steppedOf(test).tally;
  return {
    frontier:
      test?.falseRate === undefined
        ? null
        : { untied: wins + losses, detectable: test.detectable ?? null, falseRate: test.falseRate },
    informative: valid?.informative ?? null,
    unsolved: scored.unsolved,
    flagged: report.flagged.length,
    points: report.points ?? null,
    overlap: overlap === null ? null : { with: overlap.with, tasks: overlap.tasks.length },
    billed: report.billed,
    noise: noise === null ? null : { flips: noise.flips, detectable: noise.detectable ?? null },
    families:
      families === null
        ? null
        : { count: untied.filter((each) => each > 0).length, largest: Math.max(0, ...untied) },
  };
}

export function moveAnswer(reading: Reading, query: Query<"move">): MoveDetail {
  const { log, issues } = campaignAt(reading, query.key);
  const move = moveNamed(log, query.move);
  const { tier } = reading;
  if (move.step !== "comparison") {
    const trace =
      move.step === "builder" || examTier(tier)
        ? sessionTrace(log, move.id, move.step === "builder" ? "build" : "exam")
        : null;
    // A Builder session's practice solves are those that started inside its window, as `campaignOf`
    // counts them; cut at its first move, an open session would list far fewer than its head reads.
    const solves =
      move.step === "builder"
        ? ranIn(log).flatMap((solve) =>
            practiceIn(log).has(solve.id) && solve.started > move.index && solve.started < move.until
              ? [solveRow(log, solve, tier)]
              : [],
          )
        : [];
    return {
      tier,
      issues,
      kind: "session",
      move,
      ...keyIfDefined("turns", trace?.turns),
      ...keyIfDefined("calls", trace?.calls),
      solves,
    };
  }
  const bar = barsIn(log).find((each) => each.id === move.id);
  if (bar === undefined) throw new Error(`comparison ${move.id} has no bar`);
  const fixed = fixedIn(log.events, move.id);
  const report = reported(log.events, move.id);
  return {
    tier,
    issues,
    kind: "comparison",
    move,
    bar,
    terms: {
      old: move.old,
      fresh: move.fresh,
      starter: fixed?.starter ?? null,
      setting: bar.setting,
      solves: move.solves,
      cap: move.cap,
      modelTurns: move.modelTurns,
      objective: fixed?.objective ?? null,
      prediction: predicted(log.events, move.id),
    },
    sensitivity: report === null ? null : sensitivityOf(report),
    tasks: scoredTasks(log, move, tier),
  };
}

export function solveAnswer(reading: Reading, query: Query<"solve">): SolveDetail {
  const { log, issues } = campaignAt(reading, query.key);
  const solve = solvedIn(log).get(query.id);
  if (solve === undefined) throw new Unanswerable(404, `no solve ${query.id} in this campaign`);
  const { tier } = reading;
  const row = solveRow(log, solve, tier);
  const then = taskSets(log.events, solve.started - 1);
  const practised = then.released.includes(row.task) && practiceIn(log).has(solve.id);
  const exam = examTier(tier);
  const judged = verdictsIn(log).get(solve.id);
  const withheld = rulingWithheld(log, solve.id, row.task);
  const [load] = Array.isArray(solve.start.load) ? solve.start.load : [];
  const verdict =
    judged === undefined
      ? null
      : {
          kind: judged.kind,
          answer: judged.answer ?? null,
          fault: judged.fault,
          refusedBy: [...blockingOf(judged.checker)],
        };
  return {
    tier,
    issues,
    solve: row,
    heldOut: then.held.includes(row.task),
    withheld: isRejection(row) ? withheld : null,
    model: isString(solve.start.model) ? solve.start.model : null,
    effort: isString(solve.start.effort) ? solve.start.effort : null,
    load: isNumber(load) ? load : null,
    ...keyIfDefined("trace", exam || practised ? solveTrace(log, solve.id) : undefined),
    ...keyIfDefined("verdict", exam ? verdict : undefined),
    ...keyIfDefined("ruling", exam && withheld === null ? rulingOf(log, solve.id) : undefined),
  };
}

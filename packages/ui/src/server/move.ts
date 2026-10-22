/**
 * `GET /api/move?key=&move=`: one step's detail. A session's: its own turns and calls (an Examiner
 * session's in the exam tier only) and a Builder session's practice solves. A comparison's: its
 * terms (`fixedIn`), its scored tasks with each side's solves (`pairsReported`) and the tasks it
 * set aside. A comparison with no report yet lists the tasks
 * its start fixed and their solves so far, with no outcome: for a campaign that runs, that is the
 * comparison being made.
 *
 * A round runs a Builder session and the comparison after it under one id (`tools/d2/round.ts`),
 * and the campaigns on record ran as rounds, so a move is named by the place of its start in the
 * log (`Move.index`). An id is taken where it names exactly one move; one that names two is refused
 * with the places of both.
 */
import { fixedIn, predicted, type Report, reported } from "../../../../src/campaign/comparison.ts";
import { passed, type Ran } from "../../../../src/kernel/solves.ts";
import { keyIfDefined } from "../../../../src/meta/optional-key.ts";
import type { Move, MoveDetail, Outcome, Query, ScoredTask, Sensitivity, SolveRow, Tier } from "../models.ts";
import { Unanswerable, type Reading } from "./context.ts";
import { type Log, practiceIn, proposalsIn, ranIn } from "./folds.ts";
import { campaignAt } from "./logs.ts";
import { barsIn, endOf, movesIn, outcomeOf, pairsIn } from "./moves.ts";
import { examTier, sessionTrace, solveRow } from "./trace.ts";
import { rulingWithheld } from "./withheld.ts";

type ComparisonMove = Extract<Move, { readonly step: "comparison" }>;

/** A task's rulings are withheld for the first of these that holds of one of its rejections. */
const WITHHELD_ORDER = ["report", "label"] as const;

/** The move `named` names: the one that starts at that place in the log, else the one move of that
 *  id. An id that names two is refused with both places. */
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

/** The comparison's own solves of `task` under `harness`, in the order they started: where `solves`
 *  is a number, its first that many that ended in a pass or a fail, as a pair counts them (`pairsOf`,
 *  `src/kernel/compare.ts`), so that a control's further arm stays out of the reference's side. */
function ownSolves(log: Log, move: ComparisonMove, task: string, harness: string, solves?: number): Ran[] {
  const own = ranIn(log)
    .filter(
      (solve) =>
        solve.start.comparison === move.id && solve.under.task === task && solve.under.harness === harness,
    )
    .toSorted((one, other) => one.started - other.started);
  if (solves === undefined) return own;
  return own.filter((solve) => passed(solve) !== null).slice(0, solves);
}

/** A comparison's tasks with each side's solves: the scored ones and the ones it set aside, or,
 *  before it reports, every task its start fixed. */
function scoredTasks(log: Log, move: ComparisonMove, tier: Tier): ScoredTask[] {
  const solves = new Map(ranIn(log).map((solve) => [solve.id, solve]));
  const ids = new Map(proposalsIn(log).map(({ version, taskId }) => [version, taskId]));
  const rows = (named: readonly Ran[]) => named.map((solve) => solveRow(log, solve, tier));
  const byId = (named: readonly string[]) => rows(named.flatMap((id) => solves.get(id) ?? []));
  // A task's rulings are withheld where the ruling of any of its rejections is.
  const scoredTask = (
    task: string,
    outcome: Outcome | null,
    old: SolveRow[],
    fresh: SolveRow[],
  ): ScoredTask => {
    const reasons = new Set(
      [...old, ...fresh].flatMap((row) =>
        row.ending?.outcome === "fail" && row.ending.kind === "rejected"
          ? [rulingWithheld(log, row.id, task)]
          : [],
      ),
    );
    return {
      task,
      taskId: ids.get(task) ?? null,
      outcome,
      withheld: WITHHELD_ORDER.find((why) => reasons.has(why)) ?? null,
      old,
      fresh,
    };
  };
  const report = reported(log.events, move.id);
  if (report === null) {
    return (fixedIn(log.events, move.id)?.tasks ?? []).map((task) =>
      scoredTask(
        task,
        null,
        rows(ownSolves(log, move, task, move.old)),
        rows(ownSolves(log, move, task, move.fresh)),
      ),
    );
  }
  const tallied = (pairsIn(log).get(move.id) ?? []).map((pair) =>
    scoredTask(pair.task, outcomeOf(pair), byId(pair.solves?.old ?? []), byId(pair.solves?.fresh ?? [])),
  );
  // A task set aside is in no pair: its solves are the comparison's on it, under each side, cut to
  // its solves a side as a pair is.
  const aside = report.aside.map((task) => {
    const side = (harness: string) => rows(ownSolves(log, move, task, harness, move.solves));
    return scoredTask(task, "aside", side(move.old), side(move.fresh));
  });
  return [...tallied, ...aside];
}

/** What a comparison's report says beside its test, read as counts and shares: no task is named.
 *  Null for a report that compared nothing. */
function sensitivityOf(report: Report): Sensitivity | null {
  const { scored, frontier, valid, noise, families, overlap } = report;
  if (scored === null) return null;
  const untied = Object.values(families ?? {}).map(({ frontier: { wins, losses } }) => wins + losses);
  // The set the step was read on: the scored tasks, or the frontier in a report before 20 October.
  const test = scored.falseRate === undefined ? frontier : scored;
  return {
    frontier:
      test?.falseRate === undefined
        ? null
        : { untied: test.wins + test.losses, detectable: test.detectable ?? null, falseRate: test.falseRate },
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
    const end = endOf(log, move);
    // A Builder session's practice solves are the ones that started inside its record, as
    // `campaignOf` counts them.
    const solves =
      move.step === "builder"
        ? ranIn(log).flatMap((solve) =>
            practiceIn(log).has(solve.id) && solve.started > move.index && solve.started <= end
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

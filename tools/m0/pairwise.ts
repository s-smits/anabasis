/**
 * Phase 0 of the plan: the pairwise comparison, run once on answers that are already paid for.
 *
 *   bun tools/m0/pairwise.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc \
 *     --old c01 --new c08 --quantity mass --path '$.mass' [--direction minimise] \
 *     [--relative 0.01] [--absolute 0]
 *
 * A stored sweep holds the same tasks solved under one harness a cycle. This sets two cycles
 * against each other as a round would set two harnesses: each task once, every solve of the new
 * cycle paired with every solve of the old, a valid answer over a rejected one and of two valid
 * answers the one that reports the better value, past the margin (`src/kernel/compare.ts`). It
 * prints each task's pairings, the tally with the sign test's p, and for each cycle how far the
 * value moves between repeated valid solves of one task, which is the noise the plan's margin has
 * to clear.
 *
 * What it can show is that the comparison runs on real answers and where they report the value.
 * It cannot show that the comparison separates two harnesses: the stored tasks set a limit and
 * never asked for the best design, so their solvers were not looking for one (`docs/plan.md`,
 * Phase 0). An answer is valid by v1's recorded verdict, which `regrade.ts` holds this verifier to;
 * a solve v1's verifier did not decide is left out. Where the two cycles solved a task unequally
 * often, the first so many of each are compared, so neither side has more chances.
 *
 * No solve, no model and no verifier run. It needs the stored sweep on disk.
 */
import { type Paired, pairings, scored } from "#src/kernel/compare.ts";
import { contractHash, type Objective, objectiveValue } from "#src/kernel/contract.ts";
import type { JsonValue } from "#src/meta/json-shape.ts";
import { parseArgs } from "#src/meta/process.ts";
import { median } from "#src/meta/tally.ts";
import { storedAnswer, sweepRows } from "./stored-sweep.ts";

/** One stored solve as the comparison reads it. */
export interface StoredSolve {
  readonly cycle: string;
  readonly taskId: string;
  readonly solve: string;
  readonly valid: boolean;
  readonly answer: JsonValue | undefined;
}

/**
 * The pairs of two cycles: each task both solved, with as many solves of each as the lesser side
 * has, in the order the sweep lists them, and the tasks left out because one cycle has no decided
 * solve of them.
 */
export function cyclePairs(
  solves: readonly StoredSolve[],
  cycles: { readonly old: string; readonly fresh: string },
  objective: Objective,
) {
  const of = (cycle: string, taskId: string) =>
    solves.filter((solve) => solve.cycle === cycle && solve.taskId === taskId);
  const tasks = [...new Set(solves.map(({ taskId }) => taskId))];
  const sides = tasks.map((task) => {
    const [before, after] = [of(cycles.old, task), of(cycles.fresh, task)];
    const count = Math.min(before.length, after.length);
    return { task, old: before.slice(0, count), fresh: after.slice(0, count) };
  });
  const value = ({ valid, answer }: StoredSolve) => (valid ? objectiveValue(objective, answer) : null);
  const pairs: Paired[] = sides.flatMap(({ task, old, fresh }) =>
    old.length === 0
      ? []
      : [
          {
            task,
            old: old.map(({ valid }) => valid),
            fresh: fresh.map(({ valid }) => valid),
            solves: { old: old.map(({ solve }) => solve), fresh: fresh.map(({ solve }) => solve) },
            values: { old: old.map(value), fresh: fresh.map(value) },
          },
        ],
  );
  return { pairs, unpaired: sides.flatMap(({ task, old }) => (old.length === 0 ? [task] : [])) };
}

/**
 * How far the reported value moves between repeated valid solves of one task under one cycle: for
 * each task with two or more such values, the spread as a share of the larger one. The median over
 * those tasks is the figure a margin is set against; null where no task was solved validly twice.
 */
export function repeatSpread(solves: readonly StoredSolve[], cycle: string, objective: Objective) {
  const byTask = Map.groupBy(
    solves.filter((solve) => solve.cycle === cycle && solve.valid),
    ({ taskId }) => taskId,
  );
  const spreads = [...byTask.values()].flatMap((own) => {
    const values = own.flatMap(({ answer }) => objectiveValue(objective, answer) ?? []);
    const [least, most] = [Math.min(...values), Math.max(...values)];
    return values.length < 2 || most === 0 ? [] : [(most - least) / Math.abs(most)];
  });
  return {
    tasks: spreads.length,
    median: median(spreads),
    most: spreads.length === 0 ? null : Math.max(...spreads),
  };
}

function main(): void {
  const { values } = parseArgs({
    options: {
      root: { type: "string" },
      sweep: { type: "string" },
      old: { type: "string" },
      new: { type: "string" },
      quantity: { type: "string" },
      path: { type: "string" },
      direction: { type: "string", default: "minimise" },
      relative: { type: "string", default: "0.01" },
      absolute: { type: "string", default: "0" },
    },
  });
  const { root, sweep, old, quantity, path } = values;
  const fresh = values.new;
  if (
    root === undefined ||
    sweep === undefined ||
    old === undefined ||
    fresh === undefined ||
    quantity === undefined ||
    path === undefined
  ) {
    throw new Error("name --root, --sweep, --old, --new, --quantity and --path");
  }
  const objective: Objective = {
    quantity,
    // SAFETY: the contract's own check refuses any other word just below.
    direction: values.direction as Objective["direction"],
    path,
    verifiedBy: "unverified: a stored sweep's checks were not asked to verify it",
    margin: { absolute: Number(values.absolute), relative: Number(values.relative) },
  };
  contractHash({ answerFormat: { type: "object" }, conventions: "", rules: [], scope: "", objective });
  const solves: StoredSolve[] = sweepRows(root, sweep).flatMap((row) =>
    row.expected === null || (row.cycle !== old && row.cycle !== fresh)
      ? []
      : [
          {
            cycle: row.cycle,
            taskId: row.taskId,
            solve: row.solve,
            valid: row.expected.kind === "pass",
            answer: storedAnswer(row),
          },
        ],
  );
  const { pairs, unpaired } = cyclePairs(solves, { old, fresh }, objective);
  const said = (list: readonly (number | null)[] | undefined) =>
    (list ?? []).map((value) => (value === null ? "-" : String(value))).join(" ");
  for (const pair of pairs) {
    const won = pairings(pair, objective);
    console.log(
      `${pair.task}: ${old} [${said(pair.values?.old)}] against ${fresh} [${said(pair.values?.fresh)}]: ${fresh} wins ${String(won.fresh)} pairings, ${old} ${String(won.old)}`,
    );
  }
  const valid = solves.filter((solve) => solve.valid);
  const reported = valid.filter(({ answer }) => objectiveValue(objective, answer) !== null).length;
  console.log(
    JSON.stringify(
      {
        tasks: pairs.length,
        unpaired,
        validAnswers: valid.length,
        reportingTheValue: reported,
        byObjective: scored(pairs, objective),
        byValidityAlone: scored(pairs),
        repeatSpread: {
          [old]: repeatSpread(solves, old, objective),
          [fresh]: repeatSpread(solves, fresh, objective),
        },
      },
      null,
      2,
    ),
  );
}

if (import.meta.main) main();

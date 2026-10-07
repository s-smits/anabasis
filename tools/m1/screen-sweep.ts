/**
 * D1's budget arm, dry-run on a stored sweep: set B and C from the sweep's passes, then count the
 * tasks the bracket would supply. No model session runs; the stored solves stand in.
 *
 *   bun tools/m1/screen-sweep.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc
 *
 * D1 solves each task three times on one harness. A cycle sweep solved each task once on each of
 * several harness states, so every three of its cycles stand in for D1's three solves. A task is
 * supply when one of its three passes within four budgets and one fails within one, as D1's first
 * prediction counts it. `admit-sweep.ts` replays the screening itself.
 *
 * Both dollar readings run, v1's billed figure and this meter's, each with its own B. A stored solve
 * ran uncut, so one that passed above four budgets is read as the cut it would have been.
 */
import { type Budget, type Solve, calibrate, passesWithin, STRONGER_BUDGETS } from "#src/kernel/bracket.ts";
import { parseArgs } from "#src/meta/process.ts";
import { type Priced, pricedRows, solveOf, sweepRows } from "../m0/stored-sweep.ts";

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    sweep: { type: "string" },
  },
});

/** Each task's solves by cycle. */
type Sweep = ReadonlyMap<string, ReadonlyMap<string, Solve>>;

function byTask(priced: readonly Priced[], reading: "v1" | "meter"): Sweep {
  const tasks = new Map<string, Map<string, Solve>>();
  for (const solve of priced) {
    const cycles = tasks.get(solve.row.taskId) ?? new Map<string, Solve>();
    cycles.set(solve.row.cycle, solveOf(solve, reading));
    tasks.set(solve.row.taskId, cycles);
  }
  return tasks;
}

/** Tasks one of whose solves in `cycles` passes within four budgets and one fails within one. */
function supply(sweep: Sweep, cycles: readonly string[], budget: Budget): number {
  return [...sweep.values()].filter((byCycle) => {
    const solves = cycles.flatMap((cycle) => byCycle.get(cycle) ?? []);
    return (
      solves.some((solve) => passesWithin(solve, budget, STRONGER_BUDGETS)) &&
      solves.some((solve) => !passesWithin(solve, budget, 1))
    );
  }).length;
}

function report(name: string, sweep: Sweep, cycles: readonly string[]): void {
  const solves = [...sweep.values()].flatMap((byCycle) => [...byCycle.values()]);
  const budget = calibrate(solves);
  console.log(`${name}: B $${budget.dollars.toFixed(2)}, C ${budget.cpuSeconds.toFixed(0)} CPU s`);
  const passing = (budgets: number) => solves.filter((solve) => passesWithin(solve, budget, budgets)).length;
  console.log(
    `  of ${solves.length} solves, ${solves.filter((solve) => solve.passed).length} pass, ` +
      `${passing(STRONGER_BUDGETS)} within four budgets, ${passing(1)} within one`,
  );
  const threes = cycles.map((left) => cycles.filter((cycle) => cycle !== left));
  for (const three of threes) {
    console.log(`  supply on ${three.join(",")}: ${supply(sweep, three, budget)} of ${sweep.size} tasks`);
  }
}

const root = values.root;
const name = values.sweep;
if (root === undefined || name === undefined) throw new Error("name --root and --sweep");
const { rows } = sweepRows(root, name);
const { priced, unpriced } = pricedRows(rows);
for (const row of unpriced) console.log(`left out, no recorded cost: ${row.cycle} ${row.taskId}`);
const cycles = [...new Set(rows.map((row) => row.cycle))].sort();
report("billed", byTask(priced, "v1"), cycles);
report("metered", byTask(priced, "meter"), cycles);

# Synthetic logs

A recorded log holds only the patterns its run happened to produce. To ask what a reader does with
another, build it in memory and pass it to the reader: unit testing on constructed inputs, with no
model, nothing written, in seconds.

```sh
S=.claude/skills/system-path-simulation/scripts/synthetic.ts
bun $S --list                          # the examples
bun $S pool                            # run one by name
bun $S <scratchpad>/my-scenario.ts     # run your own
bun $S pool --tree <another worktree>  # under another tree's readers
```

## The kit

A scenario default-exports one function of the `Kit` that `scripts/synthetic.ts` provides:

- `log()` appends events in the shapes the writers produce: `hold(task, {valid, solves}?)`,
  `refuse(task, valid)`, `release(task)`, `feasible(task)`, `compare(session, {old, fresh,
  starter?}, tasks, {terms?, reported?})`, `promote(harness, from, comparison)`, and `add(kind,
  data)` for anything else. Solves are letters, `P` valid, `F` rejected and ruled earned, `W` cut by
  the deadline, `N` no answer, so a task reads `"PP/PF"`, or `{ solves: "PP/PP", objective: [10, 10,
  5, 5] }` with lower measures better.
- `compare` writes the start, the solves and the report the tree computes from them (`compared`,
  `src/campaign/comparison.ts`), so tally, reading, `valid` and room are the tree's own. `terms`
  overrides the level or objective; `reported` overlays fields to plant a contradiction no writer
  would produce.
- `readers` holds the tree's `reports`, `size`, `record`, `decide`, `move` and `comparison`; any other
  module is `await import(join(kit.tree, "src/..."))`. `table(header, rows)` prints rows.

```ts
import type { Scenario } from "<repo>/.claude/skills/system-path-simulation/scripts/synthetic.ts";

const scenario: Scenario = ({ log, readers }) => {
  const built = log().hold("t").compare("b-1", { old: "h1", fresh: "h2" }, { t: "PP/FP" });
  console.log(readers.reports.poolOf(built.events).outcomes.get("t"));
};
export default scenario;
```

Start from the nearest example (`pool`, `examiner` or `decision`) and change its constants. For an
event the kit lacks, copy its writer's shape from `src/` or from `test/decide.test.ts` and
`test/reports.test.ts`, and add a method if it will be needed again.

## What to try

Write the outcomes first (rule 1), then build the smallest log that tells them apart.

- **One constant changed** (`RUNS` or `SIZE` in `src/kernel/size.ts`, a floor, a weight) in a copied
  tree, one scenario under both with `--tree`: a reader that does not move holds its own copy.
- **Threshold edges**: below, at and above; a streak broken by one fail; ties at the gap floor.
- **Two readers of one fact** should agree (rule 12), and two logs differing only in what a seat must
  not learn should give byte-identical seat messages (rule 3).
- **Sides that switch** across a promotion: does a reader follow the reference or the column?
- **What a seat is told** (`record.heard`, the Builder's opening, `move.decidedLine`), the next move
  and endings (`decide` after each state), old event kinds (section 5, habit 4), and scale.

## Limits

Only the readers you call run, so command joins are a [rehearsal](rehearsal.md) and model behaviour
a [live seat](live-seat.md). The events are hand-built, so they prove what a reader does with these
shapes; when a reading surprises you, check the writer before the reader. The events never reach a
seed or campaign folder (rule 3), and a pattern that matters to a change goes into its owning test
(rule 9).

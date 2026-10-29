# Synthetic logs

A reader of the log turns events into a step: a task becomes easy, a move is named, the Examiner is
told a count, a campaign ends. A recorded log holds only the patterns its run happened to produce.
When the question is whether a reader turns some *other* pattern into the step you expect, build
that pattern in memory and hand it to the reader. No model runs, nothing is written, and the answer
takes seconds.

```sh
S=.claude/skills/system-path-simulation/scripts/synthetic.ts
bun $S --list                          # the examples in the script
bun $S pool                            # run one by name
bun $S <scratchpad>/my-scenario.ts     # run your own
bun $S pool --tree <another worktree>  # the same scenario under another tree's readers
```

## The kit

`scripts/synthetic.ts` gives a scenario a `Kit`:

- `log()`, a builder that appends the events each campaign writer would, in the shapes the readers
  read: `hold(task, {valid, solves}?)`, `refuse(task, valid)`, `release(task)`, `feasible(task)`,
  `compare(session, {old, fresh, starter?}, {task: "PP/PF"}, reported?)` and
  `promote(harness, from, comparison)`. Each side's solves are letters: `P` valid, `F` rejected
  and ruled earned, `W` cut by the deadline, `N` no answer. `add(kind, data)` appends any other
  event, and `reported` overrides any field of the report (`reading`, `aside`, `scored`, ...).
- `readers`: the tree's `reports`, `size`, `record` (what the Examiner hears), `decide` and `move`,
  already loaded. Any other module of the tree is `await import(join(kit.tree, "src/..."))`.
- `table(header, rows)` prints rows.

A scenario file default-exports one function of the kit:

```ts
import type { Scenario } from "<repo>/.claude/skills/system-path-simulation/scripts/synthetic.ts";

const scenario: Scenario = ({ log, readers }) => {
  const built = log().hold("t").compare("b-1", { old: "h1", fresh: "h2" }, { t: "PP/FP" });
  console.log(readers.reports.poolOf(built.events).outcomes.get("t"));
};
export default scenario;
```

The script holds three examples, each meant to be copied and tuned: `pool` (how the task pool sorts
tasks by their readings), `examiner` (what the Examiner hears after a promotion) and `decision` (the
move the table names for a log under a plan). Start from the nearest one, change its constants, and
read the output again. When a builder method is missing for an event you need, find the event's
writer in `src/` and copy the shape it writes, or the test that builds it (`test/decide.test.ts`
and `test/reports.test.ts` build most kinds by hand). Then add the method to the kit if the next
question will need it too.

## What to try

Put your prediction in a file first (rule 1), then build the smallest log that can miss it.

- **A count changed in one place.** Copy the tree to a scratch worktree, change one constant
  (`RUNS` or `SIZE` in `src/kernel/size.ts`, a floor, a weight), and run one scenario under both
  trees with `--tree`. Every line that differs follows from that constant. A reader that does not
  move is reading its own copy of the count.
- **Edges of a threshold.** One reading below it, at it and above it. Readings in a row broken
  by one fail. Ties at the objective gap floor. A task cut by the deadline beside one that failed.
- **Two readers of one fact.** Build one log and ask every reader that should agree: the
  frontier and the history the Examiner hears, the release and the practice frontier, the view's
  move and the stop rule. A disagreement is a rule 12 finding.
- **The wall.** Build two logs that differ only in something a seat must not learn (which held
  task another harness won, a hidden value) and compare what that seat's reader returns,
  byte for byte. Rule 3 is the reason, and `test/builder.test.ts` shows the same idea at scale.
- **Sides that switch.** A harness that was `fresh` in one comparison and `old` in the next, a
  promotion between readings, the starter as neither side. Does each reader follow the reference
  harness, or the column?
- **What a seat is told.** Build the position and print the message: `record.heard` for the
  Examiner, the Builder's opening or status text, `move.decidedLine` for the view. Read the text a
  model would read, as section 13 of `AGENTS.md` asks for a sentence of a prompt.
- **The next move.** Walk a log through several states (prepared, compared, stepped, promoted,
  out of room) and print `decide` after each, as a campaign would. Tune the plan's terms (patience,
  target, level) and watch which row changes.
- **Endings.** Supply patience over roomless readings, improvement patience over moves with no
  gain, a budget spent, three crashed sessions: does the campaign end where its rule says, and not
  one move earlier?
- **Old logs.** An event kind no command writes now, or a field an older writer left out: does
  today's reader still read it (section 5, habit 4)?
- **Scale.** A thousand tasks or fifty comparisons, timed, when a reader is suspected of being slow.

## What it cannot say

- Only the readers you call run. No command, wall, solve, model or Referee. Whether the commands
  join is a [rehearsal](rehearsal.md), and what a model does with the message is a
  [live seat](live-seat.md).
- The events are hand-built, so they prove what the reader does with *these* shapes. A shape no
  writer produces can mislead: when a reading surprises you, check the writer before the reader.
- They stay in memory. Rule 3 of the skill keeps hand-built events out of every seed and campaign
  folder, and the kit writes none.
- A pattern that reads right here and matters to a change goes into the change's owning test, as
  rule 9 asks.

## What it settled

On 29 October it read the task pool at two solves a side on #516's tree, and again on a scratch tree
with `SIZE.solves` at 4 and `RUNS.easy` and `RUNS.unsolved` at 3. On #516 two readings each valid
in every solve made a task easy and one did not. Two readings with no valid solve sent a task to
review, unless the deadline cut them or an answer was on record. A later harness valid in one solve
of two kept the task on the comparison frontier, while practice still called it easy. On the
scratch tree each threshold moved to three readings in every reader. The `examiner` example then
showed the Examiner's summary following the new reference across a promotion, which no log of the
time held.

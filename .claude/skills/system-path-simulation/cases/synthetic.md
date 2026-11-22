# Synthetic logs

Recorded campaign logs contain only the event sequences that past runs happened to encounter. To
test how a reader handles an arbitrary or rare event pattern, construct the log in memory and pass
it directly to the reader: deterministic unit testing on synthetic inputs, with no model calls and
no disk writes, completing in seconds.

```sh
S=.claude/skills/system-path-simulation/scripts/synthetic.ts
bun $S --list                          # list built-in example scenarios
bun $S pool                            # run a built-in scenario by name
bun $S <scratchpad>/my-scenario.ts     # run a custom scenario file
bun $S pool --tree <another worktree>  # evaluate under another worktree's readers
```

## The kit

Each scenario default-exports a function accepting the `Kit` supplied by `scripts/synthetic.ts`:

- `log()` builds an event stream matching production writer schemas: `hold(task, {valid, solves}?)`,
  `refuse(task, valid)`, `release(task)`, `feasible(task)`, `compare(session, {old, fresh,
  starter?}, tasks, {terms?, reported?})`, `promote(harness, from, comparison)`, and `add(kind,
  data)` for any other event kind. Solves are encoded as single characters (`P` valid, `F` rejected
  and ruled earned, `W` cut by deadline, `N` no answer), so a task entry looks like `"PP/PF"` or
  `{ solves: "PP/PP", objective: [10, 10, 5, 5] }` where lower objective values are better.
- `compare` emits the comparison start, solve events, and the report computed by the tree's own
  logic (`compared`, `src/campaign/comparison.ts`), ensuring tallies, readings, `valid` counts, and
  headroom match production calculations. `terms` overrides the significance level or objective;
  `reported` overlays fields to inject contradictions that no real writer would emit.
- `readers` exposes the tree's `reports`, `size`, `record`, `decide`, `move`, and `comparison`
  modules; load any other module via `await import(join(kit.tree, "src/..."))`. `table(header,
  rows)` formats tabular output.

```ts
import type { Scenario } from "<repo>/.claude/skills/system-path-simulation/scripts/synthetic.ts";

const scenario: Scenario = ({ log, readers }) => {
  const built = log().hold("t").compare("b-1", { old: "h1", fresh: "h2" }, { t: "PP/FP" });
  console.log(readers.reports.poolOf(built.events).outcomes.get("t"));
};
export default scenario;
```

Start from the closest built-in example (`pool`, `examiner`, or `decision`) and modify its
parameters. For an event kind not yet wrapped by the kit, copy the writer's shape from `src/` or
from `test/decide-explore.test.ts` and `test/wall-practice.test.ts`, and add a helper method if it
will be reused.

## What to test

Pre-register the rival outcomes first (rule 1), then construct the minimal synthetic log that
discriminates among them:

- **Single-constant perturbations**: modify one constant (`READINGS_IN_A_ROW` or `SIZE` in
  `src/kernel/size.ts`, a floor, or a weight) in a second worktree and run the same scenario under
  both trees with `--tree`; any reader whose output does not shift is holding a duplicate constant.
- **Boundary conditions**: test immediately below, at, and above thresholds, streaks broken by a
  single failure, and ties at the gap floor.
- **Single-owner and wall invariants**: verify that two readers of the same fact agree (`AGENTS.md`,
  rule 12), and that two logs differing only in hidden exam-side data produce byte-identical seat
  messages (rule 3).
- **Role swaps across promotions**: verify whether a reader tracks the reference harness by digest
  rather than assuming a fixed column position.
- **Seat views and backward compatibility**: inspect rendered seat messages (`record.heard`, the
  Builder opening, `move.decidedLine`), decision-table transitions (`decide`), legacy event kinds
  (`AGENTS.md`, section 5, habit 4), and scaling behaviour.

## Limits

Synthetic logs exercise only the readers invoked by the scenario; command joins require a
[rehearsal](rehearsal.md) and model behaviour requires a [live seat](live-seat.md). Because events
are constructed by hand, they verify reader behaviour on those exact shapes; when a reading looks
unexpected, check the production writer schema before faulting the reader. Synthetic events never
touch a seed or campaign directory (rule 3), and any pattern relevant to a production change must
be codified in its owning test under `test/` (rule 9).

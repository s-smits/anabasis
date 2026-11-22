# Before and after

A passing test demonstrates only that a change satisfies the test's own conditions. Running the
exact same input at the commit without the change and at the commit with it establishes that the
change itself caused the observed shift and left unrelated behaviour intact: a controlled ablation
with the commit as the single variable (rule 5), applicable to any simulation case.

## The two commits

| The change | Before | After |
| --- | --- | --- |
| One commit in a pull request | `<sha>~1` | `<sha>` |
| A whole pull request | the head of the pull request beneath it | its head |
| A fix to something a run showed | the run's commit (`bun run runs source <name>`) | the fixing commit |

A pair spanning multiple pull requests confounds their individual effects: either state the
confounding explicitly or split the comparison.

## The two arms

```sh
git worktree add --detach ../anabasis-before-<what> <before>
git worktree add --detach ../anabasis-after-<what> <after>
# in each: bun install --frozen-lockfile
```

Log readers accept the same logs by campaign name. When seeding, cut one seed in each worktree from
the same source campaign and cut event, named `sim-<what>-before` and `sim-<what>-after` (the
registry forbids duplicate campaign names across worktrees).

| Layer | Run in both arms | Read |
| --- | --- | --- |
| A test | the after commit's hostile test, also copied into the before worktree (`git show <after>:<test path>`), so the test file is identical and only production code differs | fails before and passes after for a reason other than a missing import |
| A reader | `runs view`, `wri.ts read --log`, `runs pulse`, `runs replay`, `close.ts --to <dir>` | count of changed output lines across how many logs |
| A decision | `bun tools/d2/harness-builder.ts --name <seed> --dry-run` | the decision row, chosen move, and input facts |
| A path | `bun run runs rehearse` with one script | readings, campaign endings, and event counts by kind |
| The command wall | `scripts/wall-probe.ts <before> <after>`, running one battery of shell commands under each tree's sandbox wall without a model | commands whose exit code or output changed: newly refused or newly permitted operations |
| A model seat | `scripts/live-seat.ts start` on each seed, with operator authorisation for both | one sample per arm; a difference is only a lead unless forced by the change. For repeated rounds, use [optimize](optimize.md) |

Run each reader twice per arm before diffing to filter out jitter from wall-clock time, host load,
or transient process state, and exclude the line reporting the tree's host code digest (which
differs by construction). Modifying code executed during a solve changes the condition's `host`
digest while leaving `sandbox` unchanged, since `sandbox` hashes the sandbox profile and platform
(`codeOf`, `tools/d2/campaign.ts`). When the source run already executed at the `before` commit,
its existing recording can serve as the baseline arm so only the `after` arm needs seating: seed
from the most recent run at that commit, cut immediately before the session or ruling of interest,
and document any remaining differences such as effort level or login.

Cut a paired comparison at a point where no Examiner session is open; otherwise, report the pair as
confounded whenever the arms' counts of `task.state` or `campaign.waited` events after the cut
diverge, because asynchronous Examiner admissions and host load then perturb one arm independently.

## Reading the difference

Pre-register the intended effect and rival outcomes before either arm runs (rule 1): the target
effect, a null effect, and potential unmentioned side effects. Evaluate every changed output line
against those outcomes. Any unmentioned side effect is a finding, and an expected line that failed
to move indicates the change never reached its execution path (`unreached`; see
`run-improvement-campaign`, "The pass"). In the pull request's **Validation and limits** section,
record both commits, the layer tested, the input, and which pre-registered outcome matched.

## Before a landing

The operator may ask to simulate the highest-impact changes on an open stack before landing (two by
default). Inspect the stack (`bun .claude/skills/stack-pr/scripts/stack.ts`) and prioritise changes
in descending order of risk: first anything affecting what a model seat reads, may execute, or is
held to; next anything altering comparison scoring or refusal logic; lastly readers and tooling,
which replays or unit tests already settle. Simulate only what the pull requests left unproved. Run
each change as the `after` arm in a detached worktree at that pull request's head (never in its
working tree, an active run's tree, or on its branch), recording all pre-registered outcomes in a
single file. If a defect appears in or beneath a simulated pull request, fix it in the introducing
commit with the operator's authorisation and replay the pull requests above it (`stack-pr`, section
8); rerun the live seat only if the fix alters what the seat measures. Report one verdict per
simulated change, followed by a single recommendation on whether the stack is ready to land.

Clean up worktrees with `/usr/bin/trash ../anabasis-before-<what> ../anabasis-after-<what>` and
`git worktree prune`.

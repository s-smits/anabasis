# Before and after

A passing test shows a change works under the test's conditions. Only the same input run at the
commit without the change and at the commit with it shows that the change alone moved the result and
that nothing else moved: an ablation with the commit as the one variable (rule 5), around any case.

## The two commits

| The change | Before | After |
| --- | --- | --- |
| One commit in a pull request | `<sha>~1` | `<sha>` |
| A whole pull request | the head of the pull request beneath it | its head |
| A fix to something a run showed | the run's commit (`bun run runs source <name>`) | the fixing commit |

A pair that spans several pull requests mixes their changes: say so, or split it.

## The two arms

```sh
git worktree add --detach ../anabasis-before-<what> <before>
git worktree add --detach ../anabasis-after-<what> <after>
# in each: bun install --frozen-lockfile
```

Readers take the same logs by name. A seed is cut in each fork from the same source and cut, as
`sim-<what>-before` and `sim-<what>-after`, since the registry refuses one name in two worktrees.

| Layer | Run in both arms | Read |
| --- | --- | --- |
| A test | the after commit's hostile test, also in the before worktree (write it there from `git show <after>:<test path>`), so the test file is the same and only the production files differ | it fails before and passes after, for a reason other than a missing import |
| A reader | `runs view`, `wri.ts read --log`, `runs pulse`, `runs replay`, `close.ts --to <dir>` | the moved lines, counted, over how many logs |
| A decision | `bun tools/d2/harness-builder.ts --name <seed> --dry-run` | the row, the move and the facts it read |
| A path | `bun run runs rehearse` with one script | readings, endings, event counts by kind |
| A model seat | `scripts/live-seat.ts start` on each seed, on the operator's word for both | one draw an arm; a difference is a lead unless the change forces it. Repeated rounds are [optimize](optimize.md) |

Run each reader twice per arm before diffing, since time, load and process state differ from run to
run, and leave the line that names the tree's host code out of the diff, since it differs by
construction. A change to code a solve runs moves the condition's `host` digest and leaves `sandbox`
alone, which digests the wall's profile and platform (`codeOf`, `tools/d2/campaign.ts`). Where the source run's recording already stands at the before commit, it is the before arm and
only the after arm is seated: seed from the newest run that stood there, cut right before the session
or ruling in question, and name every other difference, such as effort or login.

## Reading the difference

Write the intent and the outcomes that could each happen before either arm runs (rule 1): the named
effect, no effect, and a side effect the pull request does not mention. Read every moved line
against them; a side effect is a finding, and a line that should have moved and did not means the
change never reached its link (`unreached`, run-improvement-campaign, "The pass"). The pull
request's "Validation and limits" names both commits, the layer, the input, and which outcome the
result matched.

## Before a landing

The operator may ask for the open stack's most important changes to be simulated, two by default.
Read the stack (`bun .claude/skills/stack-pr/scripts/stack.ts`) and rank its changes: first what a
model seat reads, may do or is held to; then what a comparison counts or refuses; last readers and
tooling, which a replay or test settles. Simulate only what the pull request left unproved. Each runs as the after arm
in a detached worktree at the head of the pull request that makes it, never in its own worktree, a
run's or on its branch, with one file of outcomes for all of them. A defect found in or below a
simulated pull request is fixed in the commit that brought it, on the operator's word, and the pull
requests above are replayed (stack-pr, section 8); rerun the seat only if the fix changes
what it measures. Report one result per change, then one line on whether the stack should land as it
is.

Clean up with `/usr/bin/trash ../anabasis-before-<what> ../anabasis-after-<what>` and `git worktree
prune`.

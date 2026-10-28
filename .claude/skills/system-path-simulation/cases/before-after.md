# Before and after

A pull request says what its change does. This case checks that claim against the code without the
change: the same input goes through two forks, one at the commit before the change and one at the
commit that makes it, so the commit is the one variable (rule 5). A test that passes after the
change shows the change works under the test's conditions. Only the two arms side by side show that
the change, and nothing else, moved the result, and that every line that should not move stayed
put.

It wraps another case: a replay, a dry run, a rehearsal or a live seat, run twice. Take the smallest
layer that shows the change, as for any case.

## Which commit is "before"

| The change | Before | After |
| --- | --- | --- |
| One commit inside a pull request | its parent, `<sha>~1` | `<sha>` |
| A whole pull request | the head of the pull request beneath it, which is what the stack would land without it | its head |
| A fix to something a run showed | the commit the run executed, from its receipt (`bun run runs source <name>`) | the fixing commit |

Name both commits in the result. A comparison across more than one pull request mixes their
changes: say so, or split it into one pair per pull request.

## Make the two arms

```sh
git worktree add --detach ../anabasis-before-<what> <before>
git worktree add --detach ../anabasis-after-<what> <after>
# in each: bun install --frozen-lockfile
```

Give both arms the same input. A reader takes the same logs by name or path, and the registry finds
a log from either fork. A seed is cut once in each fork from the same source at the same cut, under
two names, because the registry refuses a name two worktrees hold, and a seat's root is named by
its campaign and session, so two live arms under one name on one host refuse the second's root
(`claimRoot`, `src/wall/seat-root.ts`; 27 October):
`bun run runs seed --from <campaign folder> --name sim-<what>-before` in the one and `-after` in
the other, with the same cut flags. A script (`--held`, `--starter`, `--supply`) is the same in both.

## By layer

| Layer | Run in both arms | Read |
| --- | --- | --- |
| A test | the change's hostile test. In the after fork, take the production files back to before (`git checkout <before> -- <paths>`) and run the test again, so the test is the same file in both runs | it fails without the change and passes with it. A test that fails before only because it imports what the change adds proves nothing |
| A reader | `runs view <name>`, `wri.ts read --log <log>`, `runs replay [<name>]`, `close.ts --to <dir>` over the same logs | the lines that moved, counted, over how many logs |
| A decision | `bun tools/d2/harness-builder.ts --name <seed> --dry-run` on the seed of each arm | the table's row and move, and the facts it read |
| A path | `bun run runs rehearse` with the same script on each arm's seed | the readings, the endings and the count of each event kind (`wri.ts read`) |
| A model seat | `scripts/live-seat.ts start` from each arm's seed, on the operator's word for both seats | one draw per arm (rule 6 of `AGENTS.md`): a difference is a lead unless it is one the change forces. Rounds of pairs that tune a prompt until a count moves are [optimize](optimize.md) |

Before diffing a reader's output, run each arm twice. A reader that prints the time, the load or a
process's state differs from itself, and those lines are no effect of the change. On 21 October
`runs view` of the retired #306 fork on the Linux runner printed 23 lines twice alike at `7adfd387`
(#306) and twice alike at `7d77a65a` (#329), and the two arms matched each other: the stack between
them left that log's view unchanged.

A model seat costs twice. Where the source run's recording already stands at the before commit,
that recording is the before arm (`cases/stack.md`, step 3) and only the after arm is seated.

## Read the difference

1. **Predict both sides first** (rule 1): each line or event that should move, and each that must
   not. A change to a gate predicts what the gate holds and refuses at the cut; a reader predicts
   the lines it rewrites.
2. **Every moved line is accounted for.** It is the change's effect, named in the pull request, or
   it is a finding: a side effect the body does not mention.
3. **A line that should have moved and did not** means the change never reached its link, the word
   `unreached` of run-improvement-campaign, section 7. Find where the path stops before claiming the
   change works.
4. **The pull request carries the result**: the two commits, the layer, the input, and what moved
   against what was predicted, in its "Validation and limits".

## Clean up

Trash both forks, with the seeds inside them, once the result is written (rule 10):
`/usr/bin/trash ../anabasis-before-<what> ../anabasis-after-<what>`, then `git worktree prune`.

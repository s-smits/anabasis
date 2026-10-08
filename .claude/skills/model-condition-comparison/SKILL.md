---
name: model-condition-comparison
description: "Compare recorded Anabasis v2 rounds that ran under different Builders, solvers, efforts or source commits, or plan such a comparison before launch. Use when the operator asks whether one model builds or solves better than another, sets two rounds or two arms side by side, or wants a harness change that must hold under more than one solver. One reader of the logs, the grid that gives each cause its own cell, and what each count can and cannot say."
---

# Model condition comparison

A condition is everything that could change a solve's result, and the log records one for every
solve (`condition.recorded`): contract, harness, task, solver model and effort, compaction, limits,
the host's code by content. Two solves compare when their conditions differ in the one thing being
compared. A round is given two things more, a Builder and a parent harness.

```sh
bun run runs compare <name> [<name> ...]
```

It reads the named rounds' logs in every worktree and starts nothing. A name is matched as
`bun run runs pulse` matches it: `abl25` takes the four rounds whose names hold it. Every Builder
session of a log is a round, named `<log>:<session>` where a log holds more than one. A session
that has started no solve is left out, with a line saying so.

## Two rounds with two Builders do not compare two models

A Builder makes its own harness. A round with Builder A and solver A beside a round with Builder B
and solver B ends on two harnesses under two solvers, so their fresh sides differ by the Builder and
by the solver at once. The reader says `not comparable in one variable: Builder, solver moved
together`, and no count under that line belongs to either model.

What two such rounds share is where they started. Their old sides are one harness under two
solvers, and read `comparable in solver`. Two rounds given the same are `replicas`: their old sides
differ by solve noise, their fresh sides by that and by what each Builder session made. Rounds whose
contract or anchor set differs are `not-comparable`, and the reader counts nothing for them.

## The grid

Give each cause a cell. The flags are `tools/d2/round.ts`'s, and each cell starts through
`bun run runs launch` (launch-run), which keeps its flags and commit. Every cell keeps the same `--root`,
`--sweep`, `--cycle` and `--bundle`, which fix the contract and the anchor's draw, the same limits,
and one commit. Name `--builder-effort` and `--solver-effort` in every cell: both default to high.

| cell | launch | read |
| --- | --- | --- |
| own A | `--name a --session a-1 --builder A --solver A` | fresh side: A's harness under A |
| own B | `--name b --session b-1 --builder B --solver B` | fresh side: B's harness under B |
| cross | `--name a --session a-x --builder A --parent <A's kept digest> --solver B` | old side: A's harness under B |
| replica | an own cell again, under another `--name` | how far two rounds given the same differ |

`--parent` takes a digest from the campaign's own `states/`, so the cross round is a later session of
A's log. The reader names the two `a:a-1` and `a:a-x` and pairs A's fresh harness with the cross
round's old one by digest: one harness, the solver alone moved. That pair is the solver's effect on
A's harness. B's harness against A's under solver B is own B's fresh side against the cross round's
old side: the reader does not pair those, so read the two rounds' `anchor` count lines.

## Before launch

Write one prediction for each pair of cells before any round spends: the variable that moves, the
direction, and the count that would refute it. Resolve each afterwards as `sufficed`, `partial`,
`refuted` or `untriggered`. A prediction no recorded count could refute is not one.

A round started with `bun run runs launch` keeps its launch line and its commit in
`launch-<session>.json` beside the log, and its report holds the target it asked for. The reader
says both from there. A round started by hand, or on source from before 2026-10-08, has neither:
the reader then says `a target its log does not hold`, and a commit `where its worktree stands
now`, which nothing confirms. `--solves` and `--anchor-floor` are in `anchor.scored`.

## Read a round

1. **`harness`.** A fresh harness that `declares no artifact-writer` fails every solve at
   `no-answer`, since submit takes only an answer one prepared. That is a harness that cannot answer,
   and it says nothing of its solver. Three of the four Sol Builders of 2026-10-08 kept one
   (abl25-sa, abl20-sa, abl20-sb): abl25-sa's anchor reads 4 fail `no-answer` and lost 0 to 4.
2. **`reported`.** A report scored on no task could not step, whatever its Builder made. Every one
   of that day's eight rounds was launched with `--target 0 --solves 1 --anchor-floor 1`, so each
   `no-step` is the launch's, and each anchor is one solve a side on four tasks. Their logs do not
   hold the target: it was read from the processes' arguments while they ran.
3. **The counts.** Each set's solves by harness: passes, fails by kind, non-results by kind and
   `unfinished`, each apart. A non-result is no measurement. Take no rate over one.

## Read a pair

Each pair of harnesses is counted on the anchor, a task once, by which round passed it more often.

- **`<round> ahead`.** Open that task's solves in the other round (`verdict`, then its `solve.call`s)
  for the first wrong step before naming a cause.
- **`both pass`.** The task cannot tell the two apart. When most are, the set is too easy for these
  solvers: abl25-sb passed 9 solves of 9, and its anchor read `not-tested` with no informative task.
- **`both fail`.** Look at the task and its checks before either solver.
- **`level`.** With several solves a side, as many passes each and not all or none.
- **`unresolved`.** A round has no pass or fail on the task, or fewer than the other. No reading.

## Do not conclude

- **That a model is better, from own A against own B.** Only the old sides and the cross cell hold
  the harness still.
- **That `comparable in solver` is the model alone.** Solver is model, effort and compaction
  together: abl25's Opus solved at medium and its Sol at xhigh.
- **Anything from a difference the replicas show too.** abl25-a and abl25-b were given the same, and
  their old sides differ on 1 anchor task of 4. The four Opus against Sol pairs differ on 1 or 2 of
  4, Sol ahead each time. One solve a side on four tasks cannot hold those apart.
- **That two arms differ by one change because one was meant.** `comparable in source` names the
  variable. abl25 and abl20 stand 16 commits apart, and for those rounds the commits printed are
  where the worktrees stand now: the log holds the host's code by content and no commit. Only a
  launch receipt puts a round's commit on record.
- **That a change serves every solver because it serves the pool.** A harness change is admitted
  when its effect is not negative under each measured solver, read one solver at a time. A harness
  never branches on the model that solves it.

Report in this order: the rounds as the reader says them, the verdict for each pair, the counts,
the predictions resolved, and what stays unmeasured. A claim names its condition: "harness e0045538
passed 4 anchor solves of 4 under Sol at xhigh in each of two rounds, and 3 and 2 of 4 under Opus at
medium, one solve a task", never "Sol is better".

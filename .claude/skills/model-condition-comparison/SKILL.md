---
name: model-condition-comparison
description: "Compare recorded Anabasis v2 rounds that ran under different Builders, solvers, efforts or source commits, or plan such a comparison before launch. Use when the operator asks whether one model builds or solves better than another, sets two rounds or two arms side by side, or wants a harness change that must hold under more than one solver. One reader of the logs, the grid that gives each cause its own cell, and what each count can and cannot say."
---

# Model condition comparison

A condition is everything that could change a solve's result, and the log records one for every
solve (`condition.recorded`): contract, harness, task, solver model and effort, compaction, limits,
the host's code by content. Two solves compare when their conditions differ in the one thing being
compared. A round is given three things more: a Builder, the harness its session starts from, and
the reference harness the one it leaves is compared with.

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

What two such rounds share is what they were compared with. Their reference sides are one harness
under two solvers, and read `comparable in solver`. Two rounds given the same are `replicas`: their
reference sides differ by solve noise, their fresh sides by that and by what each Builder session
made. Rounds whose contract differs, or that scored no task in common, are `not-comparable`, and
the reader counts nothing for them.

Every comparison solves its two harnesses afresh, side by side, and counts no solve made before
it began. So the solves of two rounds were made apart, and this reader sets them beside each other
without that guard. To compare two kept harnesses properly, run one comparison of the two:
`tools/d2/checkpoint.ts --reference <digest> --new <digest>`.

## The grid

Give each cause a cell. The flags are `tools/d2/round.ts`'s, and each cell starts through
`bun run runs launch` (launch-run), which keeps its flags and commit. Every cell keeps the same `--root`,
`--sweep`, `--cycle` and `--bundle`, which fix the contract and the scored set's draw, the same
limits, `--target` and `--solves`, and one commit. Name `--builder-effort` and `--solver-effort` in every cell: both default to high.

| cell | launch | read |
| --- | --- | --- |
| own A | `--name a --session a-1 --builder A --solver A` | fresh side: A's harness under A |
| own B | `--name b --session b-1 --builder B --solver B` | fresh side: B's harness under B |
| cross | `--name a --session a-x --builder A --reference <A's kept digest> --solver B` | reference side: A's harness under B |
| replica | an own cell again, under another `--name` | how far two rounds given the same differ |

`--reference` takes a digest from the campaign's own `states/`, so the cross round is a later
session of A's log. The reader names the two `a:a-1` and `a:a-x` and pairs A's fresh harness with
the cross round's reference by digest: one harness, the solver alone moved. That pair is the
solver's effect on A's harness. B's harness against A's under solver B is own B's fresh side
against the cross round's reference side: the reader does not pair those, so read the two rounds'
`scored` count lines.

## Before launch

Write one prediction for each pair of cells before any round spends: the variable that moves, the
direction, and the count that would refute it. Resolve each afterwards as `sufficed`, `partial`,
`refuted` or `untriggered`. A prediction no recorded count could refute is not one.

A round started with `bun run runs launch` keeps its launch line and its commit in
`launch-<session>.json` beside the log, and its report holds the target it asked for. The reader
says both from there. A round started by hand, or on source from before 2026-10-08, has neither:
the reader then says `a target its log does not hold`, and a commit `where its worktree stands
now`, which nothing confirms. The solves a side, the level, the budgets and the cap are in the
round's `comparison.started`.

## Read a round

1. **`harness`.** The line says the tools the fresh harness declares, by kind. In a round run
   before 2026-10-09 a harness that declares no `artifact-writer` failed every solve at `no-answer`,
   since submit then took only an answer one had prepared. That is a harness that could not answer,
   and it says nothing of its solver. Three of the four Sol Builders of 2026-10-08 kept one
   (abl25-sa, abl20-sa, abl20-sb): abl25-sa's four solves ended `no-answer` and lost 0 to 4. Since
   that day the answer is a file the host reads at submit, and a harness declares no writer.
2. **`reported`.** A report that tallied no task could not step, whatever its Builder made. Every
   one of that day's eight rounds was launched to score no task, so each `no-step` was the
   launch's. A comparison that tallies none now reads `not-scored`, and a launch that could read
   no step is refused.
3. **The counts.** Each set's solves by harness: passes, fails by kind, non-results by kind and
   `unfinished`, each apart. A non-result is no measurement. Take no rate over one.

## Read a pair

Each pair of harnesses is counted on the tasks both rounds scored, a task once, by which round's
harness gave a valid answer more often.

- **`<round> ahead`.** Open that task's solves in the other round (`verdict`, then its `solve.call`s)
  for the first wrong step before naming a cause.
- **`both pass`.** The task cannot tell the two apart. When most are, the set is too easy for these
  solvers: abl25-sb passed 9 solves of 9, and no task of its told its two harnesses apart.
- **`both fail`.** Look at the task and its checks before either solver.
- **`level`.** With several solves a side, as many passes each and not all or none.
- **`unresolved`.** A round did not tally the task: it was short of its solves or set aside on a
  rejection nobody had ruled a true fail. No reading.

## Do not conclude

- **That a model is better, from own A against own B.** Only the reference sides and the cross cell
  hold the harness still.
- **That `comparable in solver` is the model alone.** Solver is model, effort and compaction
  together: abl25's Opus solved at medium and its Sol at xhigh.
- **Anything from a difference the replicas show too.** abl25-a and abl25-b were given the same, and
  their reference sides differ on 1 task of 4. The four Opus against Sol pairs differ on 1 or 2 of
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
passed 4 solves of 4 under Sol at xhigh in each of two rounds, and 3 and 2 of 4 under Opus at
medium, one solve a task", never "Sol is better".

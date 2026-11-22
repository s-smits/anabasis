# Rehearsal

A rehearsal runs a campaign, Builder session, or standalone comparison on a seed with every seat
scripted on pi's faux provider and without a Referee. Below the seat layer, it executes the exact
production path, verifying whether commands join cleanly and what a campaign state of a given size
is statistically capable of reading. A scripted solver executes a single command inside the sandbox
wall, namely the `printf` call that writes its answer (or `write` when its harness omits the
shell), so a rehearsal exercises wall changes only for checks and that single write; domain-specific
toolchains under the wall remain the responsibility of wall tests. Because scripted seats never
throw, crashes and provider rate limits are investigated via recorded logs and `test/host.test.ts`.

## Seed

```sh
bun run runs seed --from <campaign folder> --points
bun run runs seed --from <campaign folder> --name sim-<what> [--before <session> | --events <n>] [--as-ran]
```

`--points` lists valid cut indices without writing anything: each session start, Builder session
end, comparison report with its reading, promotion, starter comparison start, and Referee ruling
start with its solve, each paired with its event index. Passing `--events <index>` cuts immediately
before that event, whereas `--events <index + 1>` cuts immediately after it. `--before <session>`
retains everything preceding a Builder or Examiner session; omitting both flags copies the entire
log. Always cut from a quiescent log for repeatability. Older trees predating `--points` still
accept `--events`: list cut points from a newer tree and pass the resulting index there.

By default, the seed is placed in the current worktree and runs under that worktree's source code.
To reproduce a state under the exact code the source run executed, pass `--as-ran`: `seed` locates
a tree matching the code digest from the last condition before the cut (`treeAsRan`,
`tools/runs/seed.ts`), reusing the source run's own worktree if `runs retire` has not removed it
(after seven idle days) and it remains at that digest, or otherwise creating a detached worktree at
the launch commit covering the cut. A run resumed at a newer commit explains why its own worktree
may no longer match an early cut. If no tree matches the recorded digest (for instance, a launch
from a dirty tree), `seed` refuses and prints both digests. Both `rehearse` and `live-seat.ts
start` emit a `code:` line indicating whether the executing tree matches the seed's source code; in
a before-and-after ablation, the `after` arm is expected to differ.

Inspect the task sets printed by `seed`: a seed with zero held-out tasks scores nothing. To vary
practice tasks, cut before the first release and run
`bun tools/d2/prepare.ts <pack flags> --name sim-<what> --practice 2`.

## Forms

```sh
# sessions, then a standalone comparison of the latest harness against the reference
bun run runs rehearse --name sim-<what> --session b-2 --no-comparison
bun run runs rehearse --name sim-<what> --id g2 --new latest [--held pass:pass]
# a campaign
bun run runs rehearse --name sim-<what> [--held old:new] [--starter pass|fail|none] [--supply N]
```

`rehearse` dispatches to a Builder session (`--no-comparison`), a standalone comparison (`--id`),
or by default the full campaign loop, accepting their standard flags minus the three model flags
and `--cap`. Any recorded campaign setting remains binding. A second session requires a fresh
`--session` identifier and builds on the previous session's harness.

## The scripts

- **Builder**: appends one line to the harness guide inside its walled shell and exits, branching
  from `--parent latest`, so one edit from a given parent yields a deterministic harness digest.
- **Solver**: `pass` submits an answer previously accepted by the checks, `fail` submits one
  previously rejected, and `none` submits no answer. `--held old:new` assigns behaviour to the
  reference and candidate harnesses, while `--starter` configures the Starter when it is neither
  side. Answers are drawn from the drafted exam's controls, the seed's recorded verdicts
  (`answersOf`), and the source campaign (`draftedSource`); a missing answer causes a stray exit
  with code 1.
- **Examiner**: in a campaign, `scriptedExaminer` proposes subsequent tasks from the source campaign
  followed by up to `--supply N` copies of answered tasks.

A scripted `fail` sets its task aside until `tools/d2/settle.ts` labels it. Because admission gates
are bypassed during rehearsal, a passing rehearsal does not establish whether a paid launch would
be admitted.

## What scripts read as

The table below assumes four frontier tasks, two solves per side, `--level 0.10`, and no objective
difference (as in `test/round.test.ts`). At the default significance level of 0.02, a `step`
requires at least six untied tasks all won by the candidate (`sweepOf`, `src/kernel/compare.ts`),
so smaller frontier pools read `no-step` at best.

| script | reading | why |
| --- | --- | --- |
| `--held none:pass` (default) | `step`, `valid.old` 4/0/0, `valid.fresh` 0/0/4 | four wins give p = 0.0625 |
| `--held pass:pass` | `no-step` | four ties |
| `--held none:none` | `no-step`, `unsolved` 4 | after two comparisons each task awaits an infeasibility label (`poolOf`) |
| `--held fail:pass` | `not-scored`, `aside` 4 tasks, `counted` 4-0; `step` once `settle.ts` labels each `earned` | unruled rejections |
| a Builder edit that does not land | `no-change` | the harness froze to its parent's digest |
| a campaign with `--held none:pass --starter pass --supply 40` | repeated promotions | each `step` promotes automatically outside `--hitl` |

`valid` tallies tasks with zero, one, and two valid solves (`Valid`, `src/campaign/comparison.ts`).
`check-defects` requires a Referee and cannot be triggered by a rehearsal. A manually invoked
comparison round does not emit `harness.promoted`.

## Reading the output

`rehearse` prints the comparison report, stop-rule state, and per-harness valid-solve counts,
followed by whether execution matched the script (exit 0) or diverged (exit 1, naming each stray).
On a stray, inspect the solve's `solve.call` and `verdict` events to distinguish a script fault
from a product fault (rule 7). Afterwards, run the downstream readers that inspect live campaigns,
as command joins can fail after the report is written:

```sh
bun run runs pulse sim-<what>
bun run runs view sim-<what>
bun tools/wri/wri.ts read --log .ana/d2/sim-<what>/log.jsonl
```

## Kill and resume

`test/campaign-kill.test.ts` verifies crash recovery for the fixture pack at six points. To test
another seed, launch the rehearsal in the background, send `kill -9` mid-run, and invoke the same
command again: after `build.finished` the campaign resumes from the log, whereas a kill inside the
Builder session consumes that session ID. `bun run runs stop sim-<what>` lists orphaned sandbox
roots from interrupted solves and sessions, and with `--yes` releases them (`leftOpen`,
`releaseRoot`); it inspects only events written after the seed cut.

## Planting a condition for a reader

Scripted rehearsals can inject the exact edge case a diagnostic reader is meant to detect. For
example, `--held fail:pass` plants rejections exclusively under the reference, which the
investigation reader should flag as `SET ASIDE BY SIDE` and `READING MOVES WITH THE SET-ASIDE`. A
reader that remains silent on its own planted condition is a `blocking` defect in the reader.

`test/runs-rehearse.test.ts` tests seed refusals and verifies that scripted solves refuse any
campaign lacking `seed.json`. A passing rehearsal proves sandbox behaviour only on the operating
system where it ran.

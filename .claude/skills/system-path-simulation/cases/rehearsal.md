# Rehearsal

A round, session, standalone comparison or campaign on a seed, with every seat scripted on pi's
faux provider and no Referee. Everything under the seats is the paid path, so it answers whether
commands join and what a position of a given size can read at all.

## Seed

```sh
bun run runs seed --from <campaign folder> --name sim-<what> [--before <session> | --events <n>]
```

Run it in the worktree whose source should run. `--before <session>` keeps what preceded a Builder
or Examiner session, `--events <n>` the first n events, and neither the whole log. A log at rest
gives a repeatable cut. Read the sets it prints: a seed with no held-out task scores nothing. For
other practice tasks, cut before the first release and run `bun tools/d2/prepare.ts <pack flags>
--name sim-<what> --practice 2`.

## Forms

```sh
# a round
bun run runs rehearse <pack flags> --name sim-<what> --session r-1 \
  --target 6 --level 0.02 --minutes 10 --turns 10 [--held old:new] [--starter pass|fail|none] [--supply N]
# sessions, then a standalone comparison of the latest harness against the reference
bun run runs rehearse <pack flags> --name sim-<what> --session b-2 --no-comparison
bun run runs rehearse <pack flags> --name sim-<what> --id g2 --new latest [--held pass:pass]
# a campaign
bun run runs rehearse --name sim-<what> --campaign [--held ...] [--starter ...] [--supply N]
```

`rehearse` dispatches to the round, the session (`--no-comparison`), the standalone comparison
(`--id`) or the campaign command (`--campaign`), and takes their flags less the three that name a
model and with no `--cap`. Pack flags are omitted for a drafted exam, and a recorded setting still
binds. A second round takes another `--session` and builds on the first's harness.

## The scripts

- **Builder**: appends one line to the guide through its walled shell and finishes, from `--parent
  latest`, so one edit from one parent gives one digest.
- **Solver**: `pass` submits an answer the checks accepted on record, `fail` one they rejected, and
  `none` no answer. `--held old:new` sets this for the reference and the new harness; `--starter` for
  the starter where it is neither side. Answers come from the sweep, pack controls and the seed's
  verdicts (`answersOf`), or for a drafted exam from the source campaign (`draftedSource`); a missing
  one is a stray with exit 1.
- **Examiner**: with `--campaign` over a drafted-exam seed, `scriptedExaminer` proposes the source's
  later tasks, then up to `--supply N` copies of answered ones; over a stored pack there is none.

A scripted `fail` sets its task aside until `tools/d2/settle.ts` labels it. Admission is bypassed,
so a rehearsal says nothing of whether a paid start would be admitted.

## What scripts read as

With four frontier tasks, two solves a side, `--level 0.10` and no objective difference, as in
`test/round.test.ts`. At the default 0.02 a step needs six untied tasks, all won (`sweepOf`,
`src/kernel/compare.ts`), so fewer frontier tasks read `no-step` at best.

| script | reading | why |
| --- | --- | --- |
| `--held none:pass` (default) | `step`, `valid.old` 4/0/0, `valid.fresh` 0/0/4 | four wins give p 0.0625 |
| `--held pass:pass` | `no-step` | four ties |
| `--held none:none` | `no-step`, `unsolved` 4 | after two comparisons each task waits for a label (`poolOf`) |
| `--held fail:pass` | `not-scored`, `aside` 4 tasks, `counted` 4-0; `step` once `settle.ts` labels each `earned` | rejections nobody ruled |
| a Builder edit that does not land | `no-change` | the harness froze to its parent's digest |
| `--campaign --held none:pass --starter pass --supply 40`, drafted-exam seed | repeated promotions | a `step` promotes outside `--hitl` |

`valid` counts tasks at zero, one and two valid solves (`Valid`, `src/campaign/comparison.ts`).
`check-defects` needs a Referee and is out of reach. A hand-run round writes no `harness.promoted`.

## Reading it

It prints the report, the stop rule and each harness's tasks by valid solves, then whether the
rehearsal went as scripted (exit 0) or not (exit 1, each stray named). For a stray, read the solve's
`solve.call` and `verdict` and decide whether the script or the path is at fault (rule 7). Then run
the readers a real run meets, since a join can break after the report:

```sh
bun run runs pulse sim-<what>
bun run runs view sim-<what>
bun tools/wri/wri.ts read --log .ana/d2/sim-<what>/log.jsonl
```

## Kill and resume

Start it in the background, `kill -9` it part-way, and run the same command again: after
`build.finished` it resumes from the log, and a kill inside the Builder session spends that session's
id. `bun run runs stop sim-<what>` names the roots left by unfinished solves and sessions, and with
`--yes` releases them (`leftOpen`, `releaseRoot`); it reads only what the seed wrote after its cut.

## Plant a condition for a reader

A script can plant exactly what a reader exists to notice. `--held fail:pass` plants rejections under
the reference alone, which the investigation's reader should name as `SET ASIDE BY SIDE` and
`READING MOVES WITH THE SET-ASIDE`. A reader silent on its own planted condition is a `blocking`
finding against the reader.

`test/runs-rehearse.test.ts` holds the seed and scripts; a rehearsal that passes proves only its own
platform's wall.

# Rehearsal

A rehearsal runs a campaign, Builder session, or standalone comparison on a seed with every seat scripted on pi's faux provider (including `scriptedJudge` on judged contracts) and without an Auditor. Below the seat layer, it executes the exact production path, verifying command joins, endings, and what a campaign state of a given size can statistically read. Because a scripted solver executes only a single `printf` (or `write`) inside the sandbox wall and scripted seats never throw, domain toolchains under the wall are verified by wall tests (`wall-probe.ts`, `test/solve-sandbox.test.ts`) and crashes/rate limits by `test/host.test.ts`.

## Seed and forms

```sh
bun run runs seed --from <campaign folder> --points
bun run runs seed --from <campaign folder> --name sim-<what> [--before <session-or-comparison> | --events <n>] [--as-ran]
```

`--points` lists valid cut indices without writing anything, including session starts, `build.checkpoint`, `build.finished`, every `comparison.started`, comparison readings, promotions, reverts, and Referee reviews. `--events <index>` cuts immediately before that event (`<index + 1>` cuts after it); `--before <id>` cuts immediately before a Builder, Examiner, draft, or comparison (`g-<n>`) start; omitting both copies the full quiescent log. `--as-ran` locates or checks out a worktree matching the code digest from the last condition before the cut (`treeAsRan`, `tools/runs/seed.ts`); both `rehearse` and `live-seat.ts start` emit a `code:` line indicating whether the executing tree matches the seed's source code. A seed with zero frontier tasks scores nothing; to vary practice tasks, cut before the first release and run `bun tools/campaign/prepare.ts <pack flags> --name sim-<what> --practice 2`.

```sh
bun run runs rehearse --name sim-<what> --session b-2 --no-comparison                              # Builder session
bun run runs rehearse --name sim-<what> --id g-sim --new latest [--held pass:pass]                 # standalone comparison
bun run runs rehearse --name sim-<what> [--held old:new] [--starter pass|fail|none] [--supply N]   # campaign
```

`rehearse` accepts standard flags minus model flags and `--cap`, preserving recorded campaign settings.

## Script behaviours and expected readings

- **Builder**: appends one line to the harness guide inside its walled shell and exits from `--parent latest`, yielding a deterministic harness digest. Calls `examine` once on a frontier-overlap refusal.
- **Solver**: `pass` submits a previously accepted answer, `fail` submits a previously rejected answer (setting the task aside until `tools/campaign/settle.ts` labels it), and `none` submits nothing (`answersOf`, `draftedSource`; missing answers exit 1). `--held old:new` configures reference and candidate arms; `--starter` configures the Starter.
- **Examiner**: `scriptedExaminer` proposes subsequent tasks from the source campaign followed by up to `--supply N` copies of answered tasks.
- **Judge**: on judged contracts, `scriptedJudge` deterministically votes by answer digest so swapped orders agree.

Assuming four frontier tasks, two solves per side, `--level 0.10`, and no objective difference (`test/round.test.ts`; at the default 0.02 level a `step` requires at least six untied wins via `sweepOf`, `src/kernel/compare.ts`):

| script | reading | why |
| --- | --- | --- |
| `--held none:pass` (default) | `step`, `valid.old` 4/0/0, `valid.fresh` 0/0/4 | four wins give p = 0.0625 |
| `--held pass:pass` | `no-step` | four ties |
| `--held none:none` | `no-step`, `unsolved` 4 | after two comparisons each task awaits an infeasibility label (`poolOf`) |
| `--held fail:pass` | `not-scored`, `aside` 4 tasks, `counted` 4-0; `step` once `settle.ts` labels each `earned` | unruled rejections |
| a Builder edit that does not land | `no-change` | the harness froze to its parent's digest |
| `--held none:pass --starter pass --supply 40` | repeated promotions | each `step` promotes automatically outside `--hitl` |

`valid` tallies tasks with zero, one, and two valid solves (`Valid`, `src/campaign/comparison.ts`). Because paid launch admission gates are bypassed during rehearsal, a passing rehearsal does not establish paid launch admission.

## Downstream readers and crash recovery

`rehearse` fails (exit 1) if any scripted solve strays or if the rehearsed campaign ends on `environment`. After it prints `"the rehearsal went as scripted"`, verify downstream readers:

```sh
bun run runs view sim-<what>
bun tools/wri/wri.ts read --log .ana/d2/sim-<what>/log.jsonl
```

To test crash recovery (`test/campaign-kill.test.ts`), send `kill -9` mid-run and re-invoke the command (resuming from the log after `build.finished`, or consuming the session ID if killed inside a Builder session). `bun run runs stop sim-<what> [--yes]` lists and releases orphaned sandbox roots written after the seed cut (`unreleasedSandboxes`, `releaseRoot`). Scripted rehearsals can also plant edge cases for diagnostic readers (e.g. `--held fail:pass` must trigger `SET ASIDE BY SIDE` and `READING MOVES WITH THE SET-ASIDE`). `test/runs-rehearse.test.ts` tests seed refusals.

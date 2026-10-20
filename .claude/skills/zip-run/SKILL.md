---
name: zip-run
description: "Zip recorded Anabasis v2 runs for handover at a chosen depth (--light, --medium, --verbose). Use when the operator asks to zip, bundle, archive or send a run, a round, its log, its harness or \"everything the model saw\", or names a size cap. One command, three cumulative levels, any number of runs, a README, a reading guide and a MANIFEST inside every zip."
---

# Zip a run

One command makes the bundle, and the level decides how deep it reaches.

```sh
bun run runs zip [<name> ...] --light|--medium|--verbose [--out <zip>] [--max-mb N] [--note <file>] [--from <host>]
```

A run on another host is zipped there and brought back: `--from <host>` names a host of `ANA_HOSTS`
(`bun --env-file=.env.runs run runs zip <name> --medium --from <host>`), and the level chooses its
files as it does here. Bring a run to this machine this way to read it; `bun run runs move` is for
going on with a campaign elsewhere. A live run's log is cut at its last whole line.

A name is a round (`.ana/d2/<name>/`) or a live solve (`.ana/live/<name>.jsonl`) in any worktree of
the repository, matched as `bun run runs pulse` matches it: `abl25` takes the four rounds whose
names hold it. No name takes every run. The zip lands at `--out`, by default
`./<names>-<level>.zip`; put it in the session scratchpad and send it with `SendUserFile`.

## Pick the level from the request

| operator says | level | measured on the twenty runs of 2026-10-08 |
| --- | --- | --- |
| "the log", "what happened", "under 2 MB", handover to a reviewing model | `--light` | 4.7 MB, 188 files (1.7 MB for one arm's four rounds) |
| "why was this answer refused", "the checker", "what the harness installed" | `--medium` | 5.7 MB, 342 files |
| "everything", "what the model was told", "the prompts" | `--verbose` | 11.0 MB, 1,712 files |

Light is refused over 2 MB a run, and `--max-mb` sets any other cap. When a cap refuses, name fewer
runs or choose a lighter level. Do not strip files by hand inside a zip.

## What each level holds

Levels are cumulative. A v2 run is its log, so every level holds each run's whole `log.jsonl`: every
gate, session, turn, tool call, verdict and reading.

- **light** adds what the log names by digest only: each harness a session kept
  (`states/<digest>/`, less a checker copy) and the brief.
- **medium** adds the checker (`checks/`, or `exams/<digest>/` for an exam the campaign drafted,
  and the `correctness-model/` a harness holds when its
  Builder was given one) and the toolchain's own files (`states/tree-*`).
- **verbose** adds whatever else the round's folder holds, and the tracked `src`, `tools`, `docs`
  and `package.json` of each worktree at its commit. The prompts are rendered by that source and are
  not in the log.

Never held, at any level: installed packages, caches and built bundles (`node_modules`,
`.bundle-snapshots`, a pip target), a link, and a file named like a secret. `MANIFEST.json` names
each under `left`. No file is left for its size, since a long round's log is the run: the command
prints each group's size, and the cap is the whole zip's.

## What goes with it

`README.md` opens every zip: the runs with their commit and ending, the groups with their sizes and
what was left. `GUIDE.md` is `tools/runs/zip-guide.md` as it stands: how to read a bundle, in what
order, what it cannot answer and what not to conclude from it. Edit the guide, not the script, to
change what a recipient is told. `MANIFEST.json` lists every file with its size and group.

Pass your own reading with `--note`: it rides as `NOTES.md`, and the guide tells the recipient to
check it against the log. Say there what the README cannot know: which runs were still going, which
arm differs from which and by what commit, and which readings you do not believe yet.

A run with "no ending in the log" was still running when zipped, or is of a kind that reports none.
A worktree "with uncommitted changes" ran source the zip's commit does not fully name.

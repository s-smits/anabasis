---
name: zip-run
description: "Zip recorded Anabasis v2 runs for handover at a chosen depth (--light, --medium, --verbose). Use when the operator asks to zip, bundle, archive or send a run, a round, its log, its harness or \"everything the model saw\", or names a size cap. One command, three cumulative levels, any number of runs, a README, a reading guide and a MANIFEST inside every zip."
---

# Zip a run

One command makes the bundle, and the level decides how deep it reaches.

```sh
bun run runs zip [<name> ...] --light|--medium|--verbose [--out <zip>] [--max-mb N] [--note <file>] [--from <host>]
```

A normal zip discovers matching campaigns on every configured host, fetches their folders into
the existing archive and bundles them here, with local notes supported. A failed refresh refuses
the zip. For a toolchain whose case-sensitive filenames cannot be copied here, zip on its own
machine instead: `--from <host>` names a host of `ANA_HOSTS`
(`bun --env-file=.env.runs run runs zip <name> --medium --from <host>`), and the level chooses its
files as it does here. `--note` cannot be combined with `--from`. Bring a run to this machine
this way to read it; `bun run runs move` is for going on with a campaign elsewhere. A live run's
log is cut at its last whole line.

A name matches campaigns (`.ana/d2/<name>/`) or live solves (`.ana/live/<name>.jsonl`) in any
worktree of the repository, and the campaigns of the archive (`data/runs/<here or host>/<name>/`,
where `runs retire` and `runs fetch` put them) whose names no worktree holds, by substring as
`bun run runs pulse` does. With no names it takes
every run. The zip lands at `--out`, by default `./<names>-<level>.zip`, or
`./runs-<level>.zip` with no names. Put it in the session scratchpad and deliver its path.

## Pick the level from the request

| operator says | level |
| --- | --- |
| "the log", "what happened", "under 2 MB", handover to a reviewing model | `--light` |
| "why was this answer refused", "the checker", "what the harness installed" | `--medium` |
| "everything", "what the model was told", "the prompts" | `--verbose` |

Light defaults to a cap of 2 MiB times the number of chosen runs, on the compressed zip as a
whole. Medium and verbose have no default cap. `--max-mb` replaces the cap, in MiB. When a cap
refuses, name fewer runs, choose a lighter level or raise the cap within the operator's limit.
Do not strip files by hand inside a zip.

## What each level holds

Levels are cumulative. A v2 run is its log, so every level holds each run's whole `log.jsonl`: every
gate, session, turn, tool call, verdict and reading.

- **light** holds the log, launch receipts and output, each harness a session kept
  (`states/<digest>/`, less a checker copy), the brief and Builder memory (`memory/`).
- **medium** adds the checker (`checks/`, or `exams/<digest>/` for an exam the campaign drafted,
  and the `correctness-model/` a harness holds when its
  Builder was given one), the toolchain's own files (`states/tree-*`), and each solve's and
  session's trace as an ATIF v1.8 trajectory under `trajectories/`, the format Harbor's viewer and
  the agents of Harbor's benchmarks read. They are written from the log and hold nothing it lacks.
- **verbose** adds whatever else the campaign's folder holds, and the tracked `src`, `tools`,
  `docs` and `package.json` at each worktree's current `HEAD`. Compare that commit with the launch
  receipts: it may differ from the source a run used. That source holds the prompt templates.

Never held, at any level: installed packages, caches and built bundles (`node_modules`,
`.bundle-snapshots`, a pip target), a link out of the run's folder, and a file matched by the
secret-name filter (`SECRET`, `tools/runs/zip.ts`). A relative link within the run's folder is
kept as a link at the level of its target, so a harness's `.toolchain` link is held from medium.
`MANIFEST.json` names exclusions under `left`. No file is left for its size: the command prints
each group's size, and the cap is the whole zip's.

## What goes with it

`README.md` opens every zip: the runs with their commit and ending, the groups with their sizes and
what was left. `GUIDE.md` is `tools/runs/zip-guide.md` as it stands: how to read a bundle, in what
order, what it cannot answer and what not to conclude from it. Edit the guide, not the script, to
change what a recipient is told. `MANIFEST.json` lists every file with its size and group.

Pass your own reading with `--note`: it rides as `NOTES.md`, and the guide tells the recipient to
check it against the log. Say there what the README cannot know: which runs were still going, which
arm differs from which and by what commit, and which readings you do not believe yet.

A run with "no ending in the log" may be live, stopped without an ending, or of a kind that
reports none. "With uncommitted changes" in the README describes the worktree when zipped;
the receipts record whether each launch was clean.

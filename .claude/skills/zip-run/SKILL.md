---
name: zip-run
description: "Zip recorded Anabasis runs for handover at a chosen depth (--light, --medium, --verbose). Use when the operator asks to zip, bundle, archive or send a run, a round, its log, its harness or \"everything the model saw\", or names a size cap. Every zip holds a README, a reading guide and a MANIFEST."
---

# Zip a run

```sh
bun run runs zip [<name> ...] --light|--medium|--verbose [--out <zip>] [--max-mb N] [--note <file>] [--from <host>]
                 [--latest N] [--minPromotions N] [--minTime 2h] [--since WHEN] [--until WHEN]
```

Names match by substring, as in `bun run runs pulse`, against campaigns (`.ana/d2/<name>/`), live
solves (`.ana/live/<name>.jsonl`) and archived runs (`data/runs/<host>/<name>/`); no name takes
every run. The command fetches matches from every configured host first and refuses if that fails.

`--latest N`, `--minPromotions N`, `--minTime 2h`, `--since WHEN` and `--until WHEN` choose the runs
instead of naming them: campaigns on any host, seeds and live solves left out, with at least that
many `harness.promoted` events and at least that long from the first event to the last (`s`, `m`,
`h` or `d`), the N whose last event is newest. `--since` and `--until` keep the campaigns whose record overlaps that window
(a run live during it counts although it began earlier); `WHEN` is a date (`2026-11-06`, UTC), a
date with a time and a zone (`2026-11-06T12:00Z`) or how long ago (`36h`). Names given beside them
narrow the candidates. Each record is read to choose and only the chosen come whole; it refuses when
none passes. The default file is `latest20-<level>.zip`, or `picked-<level>.zip` without `--latest`.

Where case-sensitive names cannot be copied here, zip on the run's machine with `--from <host>`
(`bun --env-file=.env.runs run runs zip <name> --medium --from <host>`, no `--note`). Put the zip in
the scratchpad and deliver its path; `bun run runs move` is for continuing a campaign elsewhere.

| the request | level |
| --- | --- |
| "the log", "what happened", "under 2 MB", a reviewing model | `--light` |
| "the checker", "why was this refused", "what the harness installed" | `--medium` |
| "everything", "the prompts", "what the model was told" | `--verbose` |

Levels are cumulative, and each holds every run's whole `log.jsonl`, traces included. **Light** adds
receipts, output, kept harnesses (`states/<digest>/`), the brief and `memory/`, capped at 2 MiB per
run. **Medium** adds the checker (`checks/` or `exams/<digest>/`) and toolchain trees
(`states/tree-*`). **Verbose** adds the rest of the folder and the tracked `src`, `tools`, `docs`
and `package.json` at each worktree's current `HEAD`, which may differ from the run's commit.

`--max-mb` replaces the cap; when it refuses, take fewer runs or a lighter level rather than
stripping files by hand. Packages, caches, outward links and files matching `SECRET`
(`tools/runs/zip.ts`) are never held and are listed under `left` in `MANIFEST.json`.

`README.md` gives each run's commit and ending, and `GUIDE.md` copies `tools/runs/zip-guide.md`,
the file to edit to change what a recipient is told. `--note` rides as `NOTES.md`: say which runs
were still going, how arms differ, and which readings you doubt.

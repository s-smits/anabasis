---
name: zip-run
description: "Package recorded Anabasis runs for handover at a chosen depth (`--light`, `--medium`, `--verbose`). Use when the operator asks to zip, bundle, archive, or send a run, round, log, harness, or full model context, or specifies a size cap. Every archive includes a `README.md`, a `GUIDE.md`, and a `MANIFEST.json`."
---

# Zip a run

```sh
bun run runs zip [<name> ...] --light|--medium|--verbose [--out <zip>] [--max-mb N] [--note <file>] [--from <host>]
                 [--latest N] [--minPromotions N] [--minTime 2h] [--since WHEN] [--until WHEN]
```

Run names match by substring, as in `bun run runs pulse`, across active campaigns (`.ana/d2/<name>/`), live solves (`.ana/live/<name>.jsonl`), and archived runs (`data/runs/<host>/<name>/`); omitting names selects all runs. The command fetches matching records from every configured host first and refuses to proceed if fetching fails.

Selection flags (`--latest N`, `--minPromotions N`, `--minTime 2h`, `--since WHEN`, and `--until WHEN`) filter campaigns across all hosts without requiring explicit names, excluding seeds and standalone live solves. `--minPromotions` requires at least `N` `harness.promoted` events; `--minTime` requires at least the specified duration between the first and last events (`s`, `m`, `h`, or `d`); `--latest N` selects the `N` campaigns with the most recent final event. `--since` and `--until` retain campaigns whose activity overlaps the specified window (including runs that began earlier and remained active during the window), where `WHEN` is a UTC date (`2026-11-06`), an ISO timestamp (`2026-11-06T12:00Z`), or a relative duration (`36h`). Providing names alongside these flags narrows the candidate set. The command inspects each record to filter and fetches only the selected campaigns in full; it refuses if no campaign matches. The default output filename is `latest20-<level>.zip`, or `picked-<level>.zip` when `--latest` is omitted.

When case-sensitive filenames cannot be copied onto the local filesystem, package the archive directly on the remote host with `--from <host>` (`bun --env-file=.env.runs run runs zip <name> --medium --from <host>`, without `--note`). Write the archive to the scratch directory and report its path; use `bun run runs move` ([run-management](../run-management/SKILL.md)) instead when relocating a campaign to continue running elsewhere, and use [oracle-handover](../oracle-handover/SKILL.md) when pairing the zip with a structured `REVIEW.md` task document or open-PR bundle for an external reviewer.

| Request | Level |
| --- | --- |
| "the log", "what happened", "under 2 MB", or input for a reviewing model | `--light` |
| "the checker", "why was this refused", or "what the harness installed" | `--medium` |
| "everything", "the prompts", or "what the model was told" | `--verbose` |

Depth levels are cumulative, and every level includes each run's complete `log.jsonl` (including solver traces). **Light** adds launch receipts, command output, kept harnesses (`states/<digest>/`), the brief, and `memory/`, capped at 2 MiB per run. **Medium** adds the verification checks (`checks/` or `exams/<digest>/`), toolchain trees (`states/tree-*`), and submitted deliverable files (`states/deliverables/`). **Verbose** adds the remainder of the campaign directory together with the tracked `src`, `tools`, `docs`, and `package.json` at each worktree's current `HEAD`, which may differ from the commit the run originally executed.

`--max-mb` overrides the size cap; if the command refuses due to size, select fewer runs or a lighter depth level rather than stripping files by hand. Installed packages, caches, symlinks pointing outside the run directory, and files matching `SECRET` (`tools/runs/zip.ts`) are never included and are listed under `left` in `MANIFEST.json`.

`README.md` summarises each run's commit and ending, and `GUIDE.md` is copied from `tools/runs/zip-guide.md`, which is the file to edit when changing recipient instructions. `--note` is bundled as `NOTES.md`; use it to note which runs were still active, how experimental arms differ, and which readings remain in doubt.

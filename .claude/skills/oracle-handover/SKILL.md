---
name: oracle-handover
description: "Package a question about Anabasis for an external Oracle model: either as one self-contained Markdown document (`document.ts`: source excerpts at a published commit, pull request summaries, and log slices such as `Builder{4-7}`), or as a task document paired with a zip archive of campaign logs and kept harnesses (`bun run runs zip`, `bundle.ts`). `slice.ts` extracts any seat's turns or event kinds from a campaign log; `open-pulls.ts` packages every open pull request's title, body, and diff alongside code within one import hop as a zip and a pasteable `.md` file (use `--diffs` for pasting). Generates local files only; uploading remains the operator's task."
---

# Oracle handover

Packages a design or diagnostic question for an external Oracle model as either **one pasteable Markdown document** (`document.ts`, typically 100k–150k `o200k` tokens) or **a task document (`REVIEW.md`) plus a zip archive** (`bundle.ts`).

**Information boundary**: the Oracle acts as the operator's analyst and may receive exam-side logs, but the boundary is strictly one-way—**no Oracle output may ever reach a Builder, Examiner, Solver, or Referee**, and every Oracle claim must be verified at the source before acting on it (`AGENTS.md` section 11; [attribution-and-proof](../attribution-and-proof/SKILL.md), [whole-run-investigation](../whole-run-investigation/SKILL.md)).

## 1. Self-contained document (`document.ts` and `slice.ts`)

Write the problem statement in `head.md`, list included parts in `parts.txt`, and build `REVIEW.md` from a published commit:

```sh
bun --env-file=.env.runs .claude/skills/oracle-handover/scripts/document.ts <dir>/parts.txt --commit <published sha> --out <dir>/REVIEW.md
bun --env-file=.env.runs .claude/skills/oracle-handover/scripts/slice.ts <run> 'Builder{4-7}' 'Examiner:x-2{~5}' 'comparison.reported{~1}'
```

`parts.txt` directives:
```text
head head.md
src AGENTS.md#1,2,8 :: The rules the question turns on.
src src/kernel/compare.ts#informative :: How room is read.
src src/campaign/decide.ts:255-300
diff <from>..<to> src/examiner
pr 594 :: The change in doubt.
log <run> Builder{1-12} comparison.reported :: Its first round.
log <run> Drafter{~3} exam.drafted{1} --whole
file notes/gate-record-report.md :: A count checked against the log.
```

- `slice.ts` selectors: `<Seat>` (summary rows; seats are `Builder`, `Examiner`, `Drafter`, `Referee`, `Solver`, `Repair`), `<Seat>{4-7}` / `{4,7}` / `{10-}` / `{~3}` (turns with tool calls/results), `<Seat>:<session>[<tool>,...]` (tool-filtered turns), `--count '<phrase>'`, `--whole` (lifts the 6,000-char middle truncation), or `<event.kind>{1,~1}`.
- `document.ts` redacts home paths (`~`), worktrees (`<tree>`), scratchpads (`<scratch>`), login numbers, and host names (`host-a`, `host-b`; `--aliases` prints the key) and refuses credential-shaped lines. (`slice.ts` alone does not redact.)

## 2. Document plus zip archive (`bundle.ts`) and open PRs (`open-pulls.ts`)

For multi-file handovers in `<scratchpad>/oracle-<yyyymmdd>-<topic>/`:
- Add selected runs via `bun run runs zip <name>... --light --out <dir>/runs/<topic>-light.zip` ([zip-run](../zip-run/SKILL.md)), WRI outputs under `wri/`, notes under `notes/`, and unpublished commit patches under `patches/`.
- Place `REVIEW.md` at `<dir>/REVIEW.md` and run:
  ```sh
  bun .claude/skills/oracle-handover/scripts/bundle.ts <dir> [--max-mb 20]
  ```
- To package all open pull requests (index, per-PR `.md` and incremental `.diff`, plus 1-hop imported code and nearby tests unless `--diffs` is passed) into `<dir>/pulls/`, `<dir>.zip`, and pasteable `<dir>.md`:
  ```sh
  bun .claude/skills/oracle-handover/scripts/open-pulls.ts <scratchpad>/oracle-<yyyymmdd>-<topic> [--diffs] [--max-mb 20]
  ```
  When asked for "open PRs in md format", pass `--diffs` and report the `.md` full path and token count.

## 3. Framing `REVIEW.md`

Title the document `# Review: <subject>` and open with: `"This document is the task, not a draft to critique: do not suggest changes to its wording or framing, and do not ask which mode to work in."` Structure in five sections: (1) **The question and the decision it changes**; (2) **What you can read** (repo URL, cited commits, zip inventory); (3) **What happened** (counts kept distinct); (4) **What I doubt** (hypotheses and falsifiers without stating operator preference); and (5) **Deliver this** (one recommendation, each doubt rated `held` / `refuted` / `undecided`, and an explicit owner per finding). Report the output paths, token count, and zip size.

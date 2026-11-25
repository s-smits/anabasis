---
name: oracle-handover
description: "Use when preparing an Oracle question, second opinion, log slice (`slice.ts`), open-PR bundle (`open-pulls.ts`, use `--diffs` for pasting), or external handover document (`document.ts`, `bundle.ts`, `bun run runs zip`). Packages source excerpts at a published commit, PR summaries, and campaign logs or kept harnesses locally; uploading remains the operator's task."
---

# Oracle handover

Packages a design or diagnostic question for an external Oracle model as either **one pasteable Markdown document** (`document.ts`, typically 100k–250k `o200k` tokens, most of it PR diffs) or **a task document (`REVIEW.md`) plus a zip archive** (`bundle.ts`).

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
src src/kernel/compare.ts#informative :: How room is read.
src src/campaign/scheduler.ts:255-300
diff <from>..<to> src/examiner
pr 594 :: The change in doubt (its summary and its diff outside `test/`).
log <run> Builder{1-12} comparison.reported :: Its first round.
log <run> Drafter{~3} exam.drafted{1} --whole
file notes/gate-record-report.md :: A count checked against the log.
findings .ana/wri/<date>-<run> lane3-misreading1 lane7-reuse1 :: The findings in doubt, each beside the log parts its `Seen in:` selectors name.
```

`AGENTS.md` is always the first appendix, whole, so the Oracle reads the invariants and terms before any part; a `src AGENTS.md` line is refused. `file` and `findings` paths resolve against the parts file's folder, so give a repository path absolutely.

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

Title the document `# Review: <subject>` and open with: `"This document is the task, not a draft to critique: do not suggest changes to its wording or framing, and do not ask which mode to work in."` Structure in five sections, written as paragraphs and tables, not bullet dumps:

1. **The question and the decision it changes**: what moved (release, PRs), the decisions the answer informs, and any standing operator constraint stated as a rule the recommendation must meet (for example complexity flat or falling: no net production lines, no new concept, flag, mode or seat-facing field; more machinery than deletions is a `carry`).
2. **What you can read**: `AGENTS.md` first, the PRs with their diffs, source at the commit, the runs by a short letter (B, J) with domain, models and flags, the WRI investigations, and any census of your own.
3. **What happened**: one subsection a run or subject, each figure recounted from the log or a fold (a lane's or another session's figure is cited as its account, or labelled an estimate), each claim pointing at the appendix that shows it: a `log` slice of the event or seat turns, a `findings` row by id (`lane7-reuse1`), or a `src` excerpt. Prefer seat turns (`Referee{~2}`, `Examiner:x-4{~3}`) where a claim is about behaviour, events where it is about a reading. Mark what still waits on a running lane as `[PENDING: ...]` and rebuild when it lands.
4. **What I doubt**: numbered doubts (`D1`...), each a hypothesis with the count that would falsify it, stated without the operator's preference.
5. **Deliver this**: one recommendation (with its production-line and concept delta where it changes code), each doubt rated `held` / `refuted` / `undecided` with the cheapest model-free check for an undecided one, an owner per finding, and the next run with its pre-registered count prediction.

Include another session's open PR where it bears on a doubt, read only. After building, check that no host name or home path survived redaction (`grep` the output for them) and report the output paths, token count, and zip size.

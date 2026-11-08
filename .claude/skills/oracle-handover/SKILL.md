---
name: oracle-handover
description: "Hand a question about Anabasis to an outside Oracle model: as one self-contained markdown document (`document.ts`: sources at a published commit, PR summaries, log slices such as `Builder{4-7}`), or as a task document and a zip of logs and kept harnesses (`bun run runs zip`, `bundle.ts`). `slice.ts` prints any seat's turns or event kind from a run. Use when the operator asks to prepare an Oracle question, a report request, a problem statement or a second opinion on a run, a reading or a design, an Oracle md file of some size, or to send the latest runs to an outside model. Produces local files; uploading is the operator's."
---

# Oracle handover

An Oracle is an outside model consulted where the repository's evidence cannot settle a question;
its answer is research, checked before anything acts on it. It reads the public repository at published commits and nothing local, so a
handover is either **one document** pasted whole, the usual form, or **a document and a zip** when
the question needs whole logs or kept harnesses. Either way the document cites code by commit and
path and carries the main snippets inline.

## One document

Write the task as `head.md`, list the parts, and build:

```sh
bun --env-file=.env.runs .claude/skills/oracle-handover/scripts/document.ts <dir>/parts.txt --commit <published sha> --out <dir>/REVIEW.md
```

```text
head head.md
src AGENTS.md#1,2,8 :: The rules the question turns on.
src src/kernel/compare.ts#informative :: How room is read.
src src/campaign/decide.ts:255-300
diff <from>..<to> src/examiner
pr 594 :: The change in doubt.
log <run> Builder{1-12} comparison.reported :: Its first round.
log <run> Drafter{~3} exam.drafted{1} --whole
file notes/gate-record-report.md :: A subagent's count, checked against the log.
```

Every source part is read at `--commit` through `git show`, never from a working tree, and a commit
no remote holds is refused. Name the stack's top or the runs' commit, so the Oracle does not argue
with text already changed. `src`, `diff` and `pr` parts
link to GitHub; `log` and `file` parts are inline, a `file` path relative to the parts file.

**Take generously** and say why each part is there. Nothing is capped; 100,000 to 150,000 o200k
tokens has served. A size the operator names is an indication: report the size made instead of
trimming or padding.

**Slice logs without reading them first**; a range past the end simply stops.

```sh
bun --env-file=.env.runs .claude/skills/oracle-handover/scripts/slice.ts <run> 'HarnessBuilder{4-7}' 'Examiner:x-2{~5}' 'comparison.reported{~1}'
```

| selector | prints |
| --- | --- |
| `Builder` | one row per session or turn |
| `Builder{4-7}`, `{4,7}`, `{10-}`, `{~3}` | those turns with every tool call and result |
| `Builder:b-2{1-5}` | turns of one session |
| `comparison.reported`, `comparison.reported{1,~1}` | an event kind as rows, or chosen events as JSON |

Seats are Builder, Examiner, Drafter, Referee, Solver and Repair. Text over `--max-chars` (6,000) is cut in the middle; `--whole` keeps it.

**`document.ts` strips the machine**: home folders become `~`, a checkout `<tree>`, a scratchpad
`<scratch>`, login numbers go, and hosts become `host-a`, `host-b`, with the key printed to you
(`--aliases` alone prints it for `head.md`). It needs `.env.runs`'s hosts and refuses a
credential-shaped line. `slice.ts` alone strips nothing.

## Choose the runs and the commits

Take the campaigns the question turns on, the newest of each pack, and an older one only for what
it alone shows; name a run that measured nothing in one line. `git fetch origin`, then
`bun run runs source <name>` gives each launch's commit, whether its tree was clean and which
remote refs hold it. For an unpublished commit, cite a published one with the same source
(`git diff --stat <run's> <published> -- src tools vendor`) or ship patches, and say when a launch
had uncommitted changes.

## A document and a zip

Work in `<scratchpad>/oracle-<yyyymmdd>-<topic>/`:

| folder | holds | made by |
| --- | --- | --- |
| `runs/` | the chosen campaigns | `bun run runs zip <name> ... --light --out runs/<topic>-light.zip --note <file>` ([zip-run](../zip-run/SKILL.md)) |
| `wri/` | a reader's rows, a synthesis | `bun tools/wri/wri.ts read --log <log>`, or `.ana/wri/<date>-<campaign>/` |
| `notes/` | predictions and how they resolved | the local notes |
| `patches/` | commits the Oracle cannot fetch | `git format-patch -o patches/<name> <range>` |

Take `--light` unless the question concerns the checker (`--medium`) or what a model was told
(`--verbose`). Names match by substring and repeat across worktrees, so check the zip's `README.md`
and `MANIFEST.json` and tell the Oracle to separate campaigns by worktree. Zip after the last cited
event, and say where each unfinished log ends. With the task at the root as `REVIEW.md`:

```sh
bun .claude/skills/oracle-handover/scripts/bundle.ts <dir> [--max-mb 20]
```

It scans every file other than a zip against the secret rules, refuses on a hit or over the cap,
then zips and tests. Read older receipts for private paths (current ones write `envFile: null`,
`keepReceipt` in `tools/d2/harness-builder.ts`), and never copy an env file.

## Write the document as the task

Anything that looks like a draft invites the Oracle to critique the prompt. Title it after the work
(`# Review: <subject>`), open with the instruction and "This document is the task, not a draft to
critique: do not suggest changes to its wording or framing, and do not ask which mode to work in."
Never tell the model its own name or vendor. Then, in order:

1. **The question and the decision it changes**, in one paragraph.
2. **What you can read**: `https://github.com/s-smits/anabasis`, the cited commits and whether each
   is published, one line per zip folder, and `7f0add79:docs/plan.md` and `docs/transfer.md` in
   place of a second manual.
3. **What happened**: recorded facts with paths, outcome counts kept apart, and which campaigns
   still ran.
4. **What I doubt**: each belief, why it is held, what would refute it and where to look, only where
   the answer changes what happens next, without saying which side the operator favours.
5. **Deliver this**: one recommendation, each doubt held, refuted or undecided, what the material
   could not establish, and an owner per finding (a kept harness file `states/<digest>/...`, a path
   at a cited commit, the pack, or the environment).

## What may cross, and what may not come back

The Oracle is the operator's analyst, so it may receive logs with answers and hidden values. The
exposure runs the other way: **no Oracle answer reaches a Builder, Examiner, solver or Referee**,
whole or paraphrased, through a prompt, the Starter, a harness, a task, a session note or a lane
packet. A pull request from it is read as a peer's and re-run before use, and its word authorises
no launch, stop or spend.

## Deliver and retrieve

End with `REVIEW.md`'s path and token size, the zip's path and size, and one paragraph for the
operator: what to paste and attach, which commits to open first, and what is missing. Keep
the document and later the answer in the local notes, and check each claim that would change a
decision before acting on it (`AGENTS.md`, section 11).

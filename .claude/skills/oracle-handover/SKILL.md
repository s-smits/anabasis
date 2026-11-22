---
name: oracle-handover
description: "Package a question about Anabasis for an external Oracle model: either as one self-contained Markdown document (`document.ts`: source excerpts at a published commit, pull request summaries, and log slices such as `Builder{4-7}`), or as a task document paired with a zip archive of campaign logs and kept harnesses (`bun run runs zip`, `bundle.ts`). `slice.ts` extracts any seat's turns or event kinds from a campaign log; `open-pulls.ts` packages every open pull request's title, body, and diff alongside code within one import hop as a zip and a pasteable `.md` file (use `--diffs` for pasting, as full code runs to millions of tokens). Use when asked to prepare an Oracle question, report request, problem statement, or second opinion on a run, reading, or design, an Oracle Markdown file of a given size, or to export recent runs or open pull requests as a zip or Markdown file. Generates local files only; uploading remains the operator's task."
---

# Oracle handover

An Oracle is an external model consulted when local repository evidence alone cannot settle a
design or diagnostic question. Treat its response strictly as research to verify before acting on
it. Because an Oracle can read only the public repository at published commits and has no access to
local state, package each handover either as **one self-contained document** pasted directly (the
default) or as **a task document plus a zip archive** when full campaign logs or kept harnesses are
required. In both cases, cite code by published commit and path and inline the key snippets.

## One self-contained document

Write the problem statement in `head.md`, declare the included parts in `parts.txt`, and build the
document:

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

Every `src` entry is extracted from `--commit` via `git show` rather than the working tree, and any
commit absent from the remote is refused. Pin the stack top or the runs' launch commit so the
Oracle does not evaluate stale code. `src`, `diff`, and `pr` sections link to GitHub; `log` and
`file` sections are inlined, with `file` paths resolved relative to `parts.txt`.

**Include context generously** and explain why each part is present. There is no hard cap; 100,000
to 150,000 `o200k` tokens has worked well in practice. Treat any target size named by the operator
as a guideline: report the resulting token count accurately rather than artificially padding or
trimming.

**Slice logs directly without reading them in full first**; ranges extending past the end of the
log truncate cleanly.

```sh
bun --env-file=.env.runs .claude/skills/oracle-handover/scripts/slice.ts <run> 'HarnessBuilder{4-7}' 'Examiner:x-2{~5}' 'comparison.reported{~1}'
```

| selector | prints |
| --- | --- |
| `Builder` | one summary row per session or turn |
| `Builder{4-7}`, `{4,7}`, `{10-}`, `{~3}` | those turns with every tool call and result |
| `Builder:b-2{1-5}` | turns of one specific session |
| `comparison.reported`, `comparison.reported{1,~1}` | an event kind as summary rows, or selected events as JSON |

Supported seat names are `Builder`, `Examiner`, `Drafter`, `Referee`, `Solver`, and `Repair`. Text
exceeding `--max-chars` (default 6,000) is truncated in the middle unless `--whole` is passed.

**`document.ts` redacts host-specific details**: home directories become `~`, worktrees `<tree>`,
scratchpads `<scratch>`, login numbers are stripped, and hosts are aliased as `host-a`, `host-b`,
printing the alias key for your reference (`--aliases` prints the key alone for drafting
`head.md`). It reads host names from `.env.runs` and refuses any line resembling a credential.
Running `slice.ts` directly performs no redaction.

## Selecting runs and commits

Include the campaigns directly relevant to the question, typically the newest campaign per pack,
adding older runs only when they exhibit a phenomenon absent from newer ones; note any run that
produced no measurement in a single line. Run `git fetch origin`, then `bun run runs source <name>`
to obtain each launch commit, tree cleanliness, and remote visibility. For an unpublished commit,
either cite a published commit with identical source
(`git diff --stat <run's> <published> -- src tools vendor`) or attach patch files, and always
disclose if a launch ran from a dirty tree.

## Document plus zip archive

Assemble multi-file handovers in `<scratchpad>/oracle-<yyyymmdd>-<topic>/`:

| folder | holds | made by |
| --- | --- | --- |
| `runs/` | selected campaigns | `bun run runs zip <name> ... --light --out runs/<topic>-light.zip --note <file>` ([zip-run](../zip-run/SKILL.md)) |
| `wri/` | reader tables and syntheses | `bun tools/wri/wri.ts read --log <log>`, or `.ana/wri/<date>-<campaign>/` |
| `notes/` | pre-registered predictions and outcomes | local notes |
| `patches/` | commits unavailable on the remote | `git format-patch -o patches/<name> <range>` |

Use `--light` by default unless the question requires checker details (`--medium`) or full model
prompts (`--verbose`). Because campaign names match by substring and can recur across worktrees,
inspect the generated `README.md` and `MANIFEST.json` and instruct the Oracle to distinguish
campaigns by worktree. Generate the zip after the last cited event, and document the last event
index of any in-progress log. Place `REVIEW.md` at the folder root and bundle:

```sh
bun .claude/skills/oracle-handover/scripts/bundle.ts <dir> [--max-mb 20]
```

`bundle.ts` scans every non-zip file against the secret rules, refuses on any secret match or size
overflow, then builds and verifies the zip archive. Inspect historical launch receipts for private
paths (current receipts record `envFile: null` via `keepReceipt` in `tools/d2/harness-builder.ts`),
and never copy an env file.

## Packaging open pull requests

For a full stack review or a question hinging on open stack changes, export all open pull requests
together:

```sh
bun .claude/skills/oracle-handover/scripts/open-pulls.ts <scratchpad>/oracle-<yyyymmdd>-<topic> [--diffs] [--max-mb 20]
```

This creates `pulls/` inside the target folder and writes an adjacent zip archive as `bundle.ts`
does. `README.md` indexes each stack chain bottom first; each pull request receives a `.md` file
(title, head, base, state, body, and changed files, matching a `pr` part) and a `.diff` against the
head beneath it, so a chain's diffs compose cleanly from `main` to the top. `code/<top>/` includes,
at each chain's top commit, every modified file, its direct imports, and neighbouring tests
following the gate's dependency rule (one import hop, three for UI tests). Note that this includes
callees and nearby tests rather than upstream callers: include any required caller explicitly in
the document as a `src` part. Passing `--diffs` omits `code/`.

Alongside the zip, `<folder>.md` concatenates the same content for pasting: the index, each pull
request under its title with per-file diff headings, and (without `--diffs`) each code file under
its path. On a large stack (~25 pull requests and ~160 changed files), full code yields roughly a
2.3 MB zip and ~2.2M tokens in `.md`, whereas `--diffs` keeps the `.md` around ~312k tokens
suitable for pasting. Consequently, when asked for "the open PRs in md format", pass `--diffs` and
return the `.md` path and size. Because `open-pulls.ts` queries GitHub live, run it after the
latest relevant push and cite the stack top's commit in the document. Add `REVIEW.md` and any run
archives to the same folder and re-bundle with `bundle.ts`.

## Framing the document as the task

Anything resembling a rough draft prompts an external model to critique the prompt rather than
solve the problem. Title the document after the investigation (`# Review: <subject>`) and open with
the directive: "This document is the task, not a draft to critique: do not suggest changes to its
wording or framing, and do not ask which mode to work in." Never address the model by its name or
vendor. Structure the body in five sections:

1. **The question and the decision it changes**, stated in one paragraph.
2. **What you can read**: `https://github.com/s-smits/anabasis`, cited commits with publication
   status, a one-line inventory of each zip folder, and references to `7f0add79:docs/plan.md` and
   `docs/transfer.md` rather than writing a redundant manual.
3. **What happened**: recorded facts with file paths, outcome counts kept distinct, and which
   campaigns are still running.
4. **What I doubt**: each hypothesis, why it is currently held, what observation would refute it,
   and where to look, limited to doubts that change the next decision and phrased without revealing
   which side the operator favours.
5. **Deliver this**: one concrete recommendation, each doubt rated held, refuted, or undecided,
   what the supplied evidence could not settle, and an explicit owner for every finding (a kept
   harness file `states/<digest>/...`, a source path at a cited commit, the pack, or the
   environment).

## Information boundary

The Oracle acts as the operator's analyst and may therefore receive logs containing answers and
hidden exam values. The boundary is strictly one-way: **no Oracle output may ever reach a Builder,
Examiner, solver, or Referee**, whether verbatim or paraphrased, through a prompt, the Starter, a
harness, a task, a session note, or a lane packet. Treat any code or pull request inspired by an
Oracle as untrusted peer work that must be independently verified and re-run, and remember that an
Oracle never authorises a launch, stop, or spend.

## Delivery and follow-up

Conclude by reporting the path and token count of `REVIEW.md`, the path and size of any zip
archive, and one short paragraph for the operator specifying what to paste or attach, which commits
to inspect first, and what remains missing. Archive both the handover document and the Oracle's
reply in local notes, and independently verify any claim that would alter a decision before acting
on it (`AGENTS.md`, section 11).

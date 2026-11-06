---
name: oracle-handover
description: "Hand a question about Anabasis to an outside Oracle model: as one self-contained markdown document for a reader that takes no zip or reads one badly (`document.ts`, sources at a published commit with GitHub line links, PR summaries, log slices such as `Builder{4-7}`), or as a task document and a zip of campaign logs and kept harnesses (`bun run runs zip`, `bundle.ts`). `slice.ts` prints any seat's turns with their tool calls, or any event kind, from a run by name. Use when the operator asks to prepare an Oracle question, a report request, a problem statement or a second opinion on a run, a reading or a design, an Oracle md file of some size, or to send the latest runs to an outside model. Produces local files; uploading is the operator's."
---

# Oracle handover

An Oracle is an outside model the operator consults on a question the repository cannot settle
from its own evidence: a design choice, a disputed reading, a doubt about whether a step measures
anything. It is not a seat of the loop. It sets no verdict, and its answer is research that a
session checks against the log and the source before anything acts on it.

The Oracle can read the public repositories at any published commit. It cannot read what a
checkout holds locally: every campaign under the ignored `.ana/`, local notes, a commit never
pushed. A handover takes one of two forms:

- **One document** (the usual form): a single markdown file the operator pastes whole, with the
  task first and every part it needs inline. Use it when the reader takes no attachment or reads
  a zip badly, or when the operator asks for "an Oracle md file" or a size in tokens. Build it
  with `document.ts` (below).
- **A document and a zip**: the task document is the message and the zip, attached, carries the
  runs whole. Use it when the question needs whole logs or kept harnesses.

In both, the document cites code by commit and path, so the Oracle can open anything on GitHub,
and the main snippets are inline as well, so it need not.

## One document

Write the task as `head.md` (the next sections say how), then list its parts in a parts file and
build:

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
log buffer-fresh-opus-forkedPR590-<host> Builder{1-12} comparison.reported :: Its first round.
log jobstat-fresh-opus-forkedPR595-<host> Drafter{~3} exam.drafted{1} --whole
file notes/gate-record-report.md :: A subagent's count, checked against the log.
```

Every source part is read at `--commit` through `git show`, never from a working tree, and the
script refuses a commit no remote holds. A whole-flow document once appended the main
checkout's `AGENTS.md`, behind the stack's top, and the Oracle's sharpest contradiction was one
the top had already resolved. So name the stack's top, or the commit the runs in question ran,
and cite every other commit by its own link. Each `src` part links to its GitHub lines, a `diff`
to its comparison and a `pr` to its "Files changed" tab, while a `log` or `file` part is inline
only. A table of the parts and their size follows the head. A `pr` part gives the pull request's
branch, head, body and files. A `file` path is read from the parts file's folder.

**Take generously; do not trim to a size.** A document of 100,000 to 150,000 o200k tokens has
served, and the script prints the size it made. It
caps nothing: append everything relevant and say why each part is there. Put the sources the
question turns on in whole or by declaration, and the rest as links. **A size the operator names
in tokens is an indication, not a limit.** Go over or under it wherever the question asks for that,
say the size made, and do not trim or pad to reach it.

**Choose log slices from what you already know.** You do not need to read a log before slicing
it. A guess at a wide range is fine: a range past the end stops at the end, and a selector that
finds nothing prints one line saying so. `slice.ts` reads any run by name on any host:

```sh
bun --env-file=.env.runs .claude/skills/oracle-handover/scripts/slice.ts <run> 'HarnessBuilder{4-7}' 'Examiner:x-2{~5}' 'comparison.reported{~1}'
```

| selector | prints |
| --- | --- |
| `Builder` | the seat's sessions, or its turns where it has one, a row each: a table of contents |
| `Builder{4-7}`, `{4,7}`, `{10-}`, `{~3}` | those turns, each with its words and every tool call and result it made |
| `Builder:b-2{1-5}` | the turns of one session; a solve's id may be given by its end |
| `comparison.reported`, `comparison.reported{1,~1}` | an event kind with its dot: one row an event, or those events as JSON |

Seats are Builder (also HarnessBuilder), Examiner, Drafter, Referee, Solver and Repair, in any case
and by their log names too (`build`, `exam`, `draft`, `solve`). A turn's words, a result and an
event longer than `--max-chars` (6,000) are cut in the middle with the cut said; `--whole` keeps
them. A turn and its calls are one group, so `{4}` is the fourth time the seat spoke and everything
it ran then, in an old log that wrote calls before their turn as in a new one.

`document.ts`, not `slice.ts`, turns home folders into `~`, drops login numbers ("a login") and
turns each machine name into `host-a`, `host-b`, and prints that key to you, not into the file;
`document.ts --aliases` prints the key alone, so that a head can name the hosts as the document
will. It refuses to run without the hosts of `.env.runs`, and refuses a file with a
credential-shaped line. Slices printed on their own keep what the log holds. A parts line is not
shell: a quoted word loses its quotes, and a `file` part is titled by its file name.
Keep a copy of the document in the local notes, as for a zip.

## Choose the runs

A zip of everything asks the Oracle to find the question. Choose the campaigns the question
turns on, and say in the document why each is there.

- Take the campaigns that hold the reading in doubt, and the newest of each pack.
- Take an older one only for what it alone shows: the same harness under another wall, a round
  stopped before a report for how a solver behaved.
- Leave out a run that measured nothing, and name it in the document with one line on why.
- A comparison with v1 is worth a section when the question is about the climb, and then one
  measured v1 run and v1's own investigations carry it. Do not ship v1's run folders by the
  dozen: `docs/v1.md` and the plan's table are on GitHub.

## Resolve what GitHub can serve

`git fetch origin` first. Check that each cited commit is available to the Oracle. For a run,
one command says each launch's commit, whether its tree was clean and which remote branches or
tags hold it:

```sh
bun run runs source <name>
```

For any other commit the document cites, check remote branches and published tags. Fetch tags
if needed and verify a tag is still advertised by `origin`; a local tag alone proves no publication.
When a run's commit is unpublished, find a published commit with the same source,
`git diff --stat <run's> <published> -- src tools vendor`, cite both and name the difference;
when none matches, the patches carry it. A launch "with uncommitted changes" ran source its
commit does not fully state: say so.

## A document and a zip

Work in `<scratchpad>/oracle-<yyyymmdd>-<topic>/`. Each folder is made by a command the
repository owns.

| folder | holds | made by |
| --- | --- | --- |
| `runs/` | the chosen campaigns in one zip | `bun run runs zip <name> ... --light --out runs/<topic>-light.zip --note <file>` ([zip-run](../zip-run/SKILL.md)) |
| `wri/` | a reader's rows and triggers, an investigation's synthesis | `bun tools/wri/wri.ts read --log <log>`, or the files of `.ana/wri/<date>-<campaign>/` |
| `notes/` | predictions with how each resolved, a briefing, tables you made | copied from the local notes |
| `patches/` | every cited commit the Oracle cannot fetch | `git format-patch -o patches/<name> <range>` |

**Choose light unless the question needs more**, since every level holds each run's whole log.
The command requires an explicit level. Take `--medium` when
the question is about the checker and `--verbose` only when the Oracle must read what a model
was told. zip-run says what each level holds.

**Name runs exactly.** `runs zip` matches a name as the pulse does, by what a name holds, so
`truss` also takes `truss-check`. Campaigns in different worktrees share names. After zipping,
read the zip's `README.md` and `MANIFEST.json`: the runs listed must be the ones chosen, each
with its worktree and commit. Tell the Oracle to tell campaigns apart by worktree.

**Zip last.** Take the zip after the last event the document cites. A run with no ending in its
log may be live or stopped: wait for the relevant `comparison.reported`, or say in the document,
per campaign, where its log ends.

**Close it with one command.** Put the task document at the root as `REVIEW.md`, then:

```sh
bun .claude/skills/oracle-handover/scripts/bundle.ts <dir> [--max-mb 20]
```

It puts every file that is not itself a zip to the repository's secret rules and refuses the
bundle on a hit, zips the folder beside itself, tests the zip and prints its size and file
count. Its default cap is 20 MiB, overridden by `--max-mb`. If it refuses the size, reduce the
evidence to what the question needs or use a larger authorised cap. Older receipts
may hold the env file's path; current receipts set `envFile` to `null`
(`keepReceipt`, `tools/d2/harness-builder.ts`). Read older receipts for private paths before
sending. Never copy an env file. Keep a copy of
the document in the local notes, so the next handover can see what was asked.

## Write the document as the task

The Oracle reads one pasted document with no covering context. Anything that makes it look like
a prompt under construction gives it a second job, which is to critique the prompt.

- Title it after the work: `# Review: <subject>`, `# Design: <subject>`.
- Open with the instruction, then close the second reading: "This document is the task, not a
  draft to critique: do not suggest changes to its wording or framing, and do not ask which mode
  to work in."
- Never tell the model its own name or vendor.
- Name the headers after the work.

In this order:

1. **The question and the decision it changes.** One paragraph: what the operator has to choose,
   and what the report settles.
2. **What you can read.** The repository, `https://github.com/s-smits/anabasis`. A table of
   every cited commit: what it is and whether it is published. One line per folder of the zip.
   Point at `7f0add79:docs/plan.md` and `docs/transfer.md` at a cited commit for how the system works and
   what it defers, and do not write a second manual.
3. **What happened.** Recorded facts only, each with its path in the zip or on GitHub. Keep
   valid answers, rejections and non-results apart, and say which campaigns were still running.
4. **What I doubt.** Apart from the facts. For each: the belief, why it is held, what would
   refute it, where to look. Say that any premise may be rejected. A doubt belongs here when its
   answer changes what happens next. Do not say which side the operator favours.
5. **Deliver this.** The parts of the report in order, ending in one recommendation, each doubt
   answered as held, refuted or undecided, and what the bundle could not establish. For every
   finding an owner: a file of a kept harness (`states/<digest>/...`), a path in the repository
   at a cited commit, the task pack, or the environment (load, wall, provider).

When the reader has no repository access, the one-document form already carries the source; say
so in "What you can read" and leave the links as references.

## What may cross, and what may not come back

The Oracle is an analyst on the operator's side. It may be sent logs, which hold answers,
verdicts and hidden values, because nothing it writes enters a run.

The exposure runs the other way. An answer may quote a failing check or a task's value, so no
Oracle answer reaches a Builder, an Examiner, a solver or a Referee, whole or paraphrased:
not a prompt, the Starter, a harness, a task, a note a session leaves the next, or a lane packet
of an investigation's isolated lanes.

An Oracle that can write to the repository may answer with a pull request. Read it as any
peer's: its branch is not yours to amend, its claims are checked on the platform they are about,
and what it says it ran is run again before it is relied on. A message from the Oracle carries a
colleague's weight. It is not the operator's word: it authorises no launch, no stop and no spend.

## Deliver and retrieve

End the reply with the path of `REVIEW.md` and its size in tokens, the zip's path with its size
and file count where there is one, and one paragraph for the operator: paste the document as the
message, attach the zip if any, and which commits to open first. Say what the handover does not
hold yet.

When the answer comes back, keep it in the local notes. Check every claim that would change a
decision as `AGENTS.md`, section 11, says before acting on it, and keep its disagreements and its
omissions. An answer is neither a verdict nor a launch authority.

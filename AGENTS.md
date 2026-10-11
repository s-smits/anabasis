# AGENTS.md

The working contract for coding agents in this repository: Claude Code, Codex and their subagents.
`CLAUDE.md` is a symlink to this file, so both read the same text.

This file holds what stays true from one pull request to the next: what the system is for, who
decides what, how a result is read, and how to write code here that passes its checks the first
time. It holds no queue and no status. Those have other owners:

| Question | Owner |
| --- | --- |
| What is designed, in what order, and how far each part has got | the plan of record; `docs/plan.md` is the repository's copy |
| What came over from v1, and what was replaced or dropped | `docs/transfer.md` |
| What v1 measured, and why it did not climb | `docs/v1.md` |
| What the code does today | the source at the stack's head, and the head comment of each module |
| How a procedure is carried out: stacking, launching, reading a run, wording a claim | the skill that owns it, under `.claude/skills/` (sections 10 and 11) |

Newer evidence wins where one of them disagrees with this file. A sentence here whose mechanism
has left the source is dead text: say so, and correct it in the change that found it.

Do the task. Given ambiguity, take the most reasonable reading, say which one you took, and carry
authorised work through implementation, checks and delivery. Ask only for a decision that is the
operator's (section 3 lists them) or a permission that is missing, and ask with the reviewable
result ready.

## 1. What Anabasis v2 does

One query names one technical domain. A campaign builds one **harness** for it: the guide and the
programs with which a solving model answers that domain's tasks. Every mechanism in the repository
serves one question:

> Is the new harness better than the reference harness, for this solver, on tasks neither was
> built on?

A comparison in code answers it. Both harnesses solve the same held-out tasks afresh, under the
same limits. A hidden check program decides whether each answer is valid. Each task is then a win,
a loss or a tie for the new harness, and a one-sided sign test over the tasks reads a **step** or
none.

```text
                        OPERATOR   freezes the exam, sets the dollar cap, labels answers blind
                            │
   EXAM SIDE                │                      BUILD SIDE
   Examiner (model)         │                      Builder (model)
     writes tasks           │                        edits harness/, practises on released
   Contract                 │                        tasks, ends with a frozen harness version
     public rules, format   │                              │
   Check program + engines  │                              ▼
     hidden from every      │                      Solver (model: pi's coding agent)
     solving model          │                        reads the task, the rules, the guide;
        │                   │                        writes answer.json and submits
        ▼                   ▼                              │
   held-out tasks ───► COMPARISON (code): reference harness and new harness, the same tasks,
                       fresh solves, one setting, terms logged before the first solve
                            │
                       VERIFIER (code + checks)   pass │ fail │ faulty │ non-result
                       REFEREE (model)            rules every rejection before it counts
                            │
                       tally of wins, losses and ties ──► sign test ──► reading
                            │
                       THE LOG   one append-only file a campaign; every state is a view of it
```

### Two sides and one wall

The exam side knows what a right answer is. The build side tries to produce right answers. The
value of the measurement is that the second never learns the first, so the wall between them is
the system's main asset.

What crosses from the exam side to the build side is a closed list:

- the contract's public rules, its scope and conventions, the answer format and, where the check
  program declares one, the objective: the quantity and which way is better;
- the public part of each **released** (practice) task;
- for a practice solve: its ending's outcome and kind, the solver's trace, the Diagnoser's
  reading and, where the contract states an objective, the measure the verifier took of a valid
  answer;
- for each comparison: the tally and the reading, with no task named.

Nothing else crosses: no held-out task, no trace of one, no check, no hidden value, no list of the
checks that refused an answer, and none of the Referee's reasons. Section 8 states this as a rule.

### What changed from v1

v1 is the public repository `s-smits/anabasis`. Much of `src/meta`, `src/verify`, `tools/loc` and
`tools/oxlint` was copied from it, so its words still appear in comments. A comment there that
cites "AGENTS.md rule N" means v1's file, whose rules were numbered otherwise. The design around
the copied code is different.

| v1 | v2 |
| --- | --- |
| The Builder wrote the harness, the tasks and the checks | The Examiner writes tasks, the check program is fixed, and the Builder writes the harness only |
| A harness was scored on its own Builder's test set, as a pass rate | Two harnesses are compared on held-out tasks, as wins against losses |
| Every task carried an answer its author had found | No reference answers. A task is held out on the shape of its package |
| A candidate passed a submit gate before it was measured | No gate on a harness. `check_harness` says whether it opens, and the comparison says whether it is better |
| Difficulty was steered with a band, levels and staged test sizes | One fixed compute budget for both harnesses. No band and no levels |
| A harness declared its own limits in `agent/config.yaml` | The host sets every limit, and that file is not read |
| A controller loop chose build, measure, rebuild or stop | One table over the log names the move that follows, and one command makes it (section 4). It chooses no content |
| Runs lived in `campaigns/` and `domains/` with opening, terminal and claim files | One log a campaign, under `.ana/d2/<name>/` |

Words v1 used that have no meaning here: battery, epoch, climb, band, level, witness, F2, census,
submit gate, claim, adoption, veto. Do not bring them back in new text. Two survive with a narrow
meaning: a **cycle** and a **sweep** name a stored v1 run that a campaign takes its pack from
(`--sweep`, `--cycle`), and **bundle** names that pack's directory (`--bundle`).

## 2. The stance: code owns the conditions, models own the content

Anabasis v2 is a workflow on the outside with free agents inside its steps. The split is the
philosophy of the system, and most design questions are settled by asking on which side of it a
decision falls.

| Code decides | A model decides |
| --- | --- |
| Which move may start, and every refusal | What a harness contains: its programs, its guide, its tools |
| Every limit of a solve and of a session | How a task is solved |
| The condition a solve runs under, and its identity | What a new task asks, within the contract |
| Whether an answer is valid | Whether a rejection was right (a ruling, with its required evidence) |
| The comparison, the tally and the test | Why a practice solve failed (advice only) |
| What crosses the wall | Which failure to work on, and what to change |
| The dollar cap and what is charged to it | |
| The log: what is recorded, and its order | |

Code keeps the first column because a model cannot observe those facts, or because the model is
the subject of the decision, or because the value must stay identical between the two sides of a
comparison. Models keep the second because nothing in code can reason about a domain it has not
seen.

Six consequences guide a change:

1. **Give a model facts and never a course.** The host tells an agent what happened: a tally, an
   ending, a limit and how much of it is used. It does not tell the agent what to write. A v1
   campaign that was told a three-stage course changed only its published magnitudes for four test
   sets in a row.
2. **Give an author no target.** The Examiner is told one outcome for each task and no zone, share
   or count. v1 measured why: an author told a zone, a share or a count wrote towards it, and one
   told each answer's distance from its limit moved the limits. Since 10 October it is told the
   budget every solve is held to, as a fact and not a target: a task that tells two harnesses
   apart is one a better method answers within that budget and a worse one does not, which
   nobody can write without knowing it, and ten campaigns' tasks tied without it.
3. **Keep the Builder free.** It may change or rewrite anything in the harness. One limit stands:
   nothing in a harness returns a finished answer for a task. Do not add a second limit in a
   prompt or a check. Both harnesses run under one budget, and that budget prices whatever a
   harness does.
4. **Do not let code choose content because reasoning about it is hard.** Code may validate a
   declared structure. A classifier in code that decides what a harness or a task should contain
   is a model's decision made badly.
5. **Do not let a model hold a condition.** A model's reply never sets a score, a limit, an
   identity or a route. Where a model's output enters a decision (a ruling), code states what
   evidence the output must carry, and refuses it otherwise.
6. **Where in doubt, allow, and allow the whole.** A wall keeps three things: the exam side's
   hidden values, the operator's credentials, and one seat's files from another seat's. Whatever
   is none of the three is allowed, by the simplest rule that says so: reads open by default with
   the protected roots closed by name, and one root a seat, readable and writable whole. Do not
   grant a seat a list of subfolders inside its root, a path a command, or a file where the folder
   would do: each narrower grant is one more policy to keep true on two operating systems. On the
   record of 9 and 10 October a grant that was too narrow ended solves by the dozen, and no
   recorded solve or session read a hidden value through one that was too wide: a denial that
   named each worktree ended 12 solves in a row as `sandbox-crash` once two of them were removed,
   and a probe's folder under a shared parent ended 56 (`docs/plan.md`, rows B10, B12 and B17).
   Narrow a grant only where two would collide, as two solves writing one path in a shared `/tmp`
   did, or where the wider one opens one of the three. A wall is probed by one command run
   through the launch a seat's commands use, and need not prove its own identity. At #185 the
   source is short of this: three writable folders a command, and a probe through a launch no
   seat uses (`docs/simplify.md`, phase 4).

## 3. The seats

Each seat has one job and a closed view. "Reads" is what the host hands it; "never" is what the
wall keeps from it.

| Seat | Job | Reads | Never | Source |
| --- | --- | --- | --- | --- |
| **Examiner** (model) | Writes task instances against a fixed contract and check program. For a campaign that opens from a prompt it first drafts that exam: the rules with their sources, the answer format, one check a rule, examples and controls | The contract, the operator's brief, the budget every solve is held to, examples, and one outcome for each task of the campaign; the checks, through `try_answer`, on an instance with an answer of its own. When it drafts: the operator's prompt, and what the host's reading found in each draft | A target, a harness's name, a count of solves. It makes no solve of the exam's | `src/examiner/` |
| **Builder** (model) | Edits `harness/` in its home and ends with a frozen harness version | The public rules and the objective, practice tasks, practice results with their measures and traces, diagnoses, each comparison's tally, its own notes | A held-out task or its trace, a check, a hidden value, which checks refused an answer | `src/builder/` |
| **Solver** (model) | Answers one task: pi's coding agent with `read`, `bash`, `edit`, `write` and `submit` | The task's public part, the public rules, the harness's guide and programs, its limits and how much it has used | The checks and the hidden values | `src/solve/` |
| **Verifier** (code) | Runs every applicable check on one answer, each in a fresh cell inside the OS wall | The answer, the task, the check program, the installed engines | n/a | `src/kernel/verify.ts`, `src/verify/` |
| **Referee** (model) | Rules each rejection `earned`, `check-defect` or `unclear` before it counts | The verifier's side only: the task with hidden values, the rules, the answer, the refusing checks, the check program | The harness, the solver's trace, the Builder | `src/review/referee.ts` |
| **Diagnoser** (model) | Names the first wrong step of one failed practice solve, and what would refute that | The public task, the public rules, the answer, the trace, the guide the solve ran under and how much of its limits it used, for released tasks only | Hidden values, the check program, which checks refused | `src/review/diagnoser.ts` |
| **Host** (code) | Everything in the first column of section 2 | The log | n/a | `src/kernel/`, `tools/` |
| **Operator** (person) | See below | Every report and refusal | n/a | n/a |

The tools of each model seat, as its source names them:

- Examiner: `propose_tasks`, `read_example`, `try_answer`, `bash`, `read`, `write`, `finish`.
  `try_answer` runs the checks on an instance with an answer of the Examiner's own and keeps
  nothing; the shell is a walled home of its own, empty at the session's start, and nothing in
  it enters the exam but through `propose_tasks`. In the session that drafts an exam:
  `draft_exam`, `finish`.
- Builder: `read`, `bash`, `edit`, `write`, `practice`, `read_trace`, `read_opening`,
  `check_harness`, `preview_harness`, `reset_harness`, `finish`.
- Solver: `read`, `bash`, `edit`, `write`, `submit`. Its answer is the file `answer.json`.
- Referee: `probe_check`, `read_check_program`, `record_ruling`.
- Diagnoser: `read_trace`, `record_diagnosis`.

### What waits for the operator

Seven decisions wait for the operator's word, each time. Someone outside the loop has to fix the
exam, pay for it, and own what cannot be undone:

- freezing or refusing the contract and the check program, and admitting a check by name
  (`accept.ts --freeze`, `--admit`). The operator writes none of it;
- labelling drawn rejections blind;
- the dollar cap, and which provider account spends;
- saying whether a task that nobody answers is infeasible;
- promoting a harness to reference (`tools/d2/promote.ts --harness <digest> --yes`). The rule
  names the harness (section 7), and another one takes the operator's reason (`--despite`);
- changing what a solver is given or told: the starter, the shell, the limits of a campaign;
- stopping a live run.

Bring each as one question, with the evidence and a recommendation, and go on with whatever does
not depend on the answer. A continuing instruction ("keep going", "launch the next one")
authorises work inside its scope and none of these seven.

Write "a person" only for a duty in the list above. Four more were the operator's until
9 October and have an owner in code since: the setting and the reference are events a command
reads (`campaign.setting`, `harness.promoted`), the stop rule refuses the next comparison
(section 7), and the next step is named by a table and launched by one command (section 4).

Two of the seven can be given once for a campaign in place of each time: `--unattended` on that
command freezes an exam whose reading holds no fault, and promotes the harness the rule names.
It is the operator's flag, and a session never adds it of its own accord. Whether it becomes the
default is the operator's open decision (`docs/plan.md`, row F29).

The operator types nothing into a Builder session. Every message a Builder reads is built by the
host from the contract, the practice tasks, the practice results and the tallies.

### The harness

A harness is a directory with one purpose for each part (`HARNESS.md`, which a Builder is handed
beside it, gives the shapes with a worked example):

| Part | Purpose |
| --- | --- |
| `agent/tools-spec.json` | Selects which of pi's coding tools the solver has |
| `.toolchain/` | The programs, which the solver runs by name from its shell |
| `agent/BUILT_AGENTS.md` | The guide: words about the programs and the tools, read once a task in the solver's system prompt |
| `agent/tools.ts` | Tools of the harness's own, which the solver has beside pi's tools; each call runs alone under the wall. Whether a computation is a program, a tool or both is the Builder's choice, told what each costs a solve (until 10 October a prompt told it to leave the list empty while the solver had the shell, a second limit of the kind section 2 forbids) |

A harness is named by its digest, so a change to any part is another harness, and no solve under
the old one counts for the new. The **Starter Built Harness** is pi's coding agent as pi releases
it, with no guide and no domain program (`src/solve/starter.ts`). Every campaign starts from it,
it is the first reference harness, and it stays the fixed lower reference after a promotion.

## 4. The Harness Builder

Two names are easy to confuse, and new text keeps them apart:

- The **Harness Builder** is the owner of one campaign: it takes the query and returns the
  harness. It is the whole of the workflow in section 2.
- The **Builder** is the inner agent that edits the harness.

Older comments and `docs/plan.md`'s list of terms use "Harness Builder" for the inner agent. Do not
copy that use.

The Harness Builder's controller is in the repository in three parts. The campaign's state is
one reading of its log (`campaignOf`, `src/builder/handover.ts`): each step's handover and the
moves that may start next, which `bun run runs view <name>` prints. The move that follows is one
function of the log and the campaign's opening (`decide`, `src/builder/decide.ts`): the plan's
decision table, which returns one move with its reason, or an ending. And one command makes that
move by the command an operator would run, reads the log again, and goes on until the campaign
ends (`tools/d2/harness-builder.ts`, section 6). The setting, the reference and every refusal
stay the log's and one admission's. The skill `run-improvement-campaign` remains the procedure
for a session that runs a campaign with the operator: it reads the same table.

One designed part of it is absent: one Builder conversation across sessions (`docs/plan.md`,
row F27).

The design has two layers, as v1's had:

- **A controller in code.** It holds the campaign's state and names the next move: reading the
  exam, setting the tasks apart, an Examiner session, a Builder session, a comparison, another
  budget, a promotion, or an ending. It owns the setting, the reference and every refusal, so
  that no flag is typed twice and no command starts past a refusal. It chooses nothing about the
  content of a harness or a task.
- **The Builder's view.** The inner agent is told what happened and never what to write.

What the Harness Builder reads of each step is its handover, never its content:

| Step | Handover |
| --- | --- |
| Set-up | Tasks held, released and waiting for a label; whether the checker was read, and its faults |
| Examiner session | Tasks proposed and accepted, and the cost |
| Builder session | The harness version it left, practice solves used, fails open or repaired, and the cost |
| Comparison | Its terms, the tally and the reading, each harness's share of valid answers, rejections ruled or set aside, and the cost |
| Rulings and labels | Counts by kind, and whether the bar for the reviewer is cleared |
| Next move | What may start now, what is refused, and why |

All of it is in the log already. One limit holds whatever is built: the Harness Builder may read
every step, and what it passes to the Builder stays the closed list of section 1. An overarching
agent that knew which held-out tasks were lost, and wrote freely to the agent that edits the
harness, would be v1's fault by another route. v1's Builder saw and wrote everything; one of its
harnesses passed 75 of 75 of its own tasks and 2 of 23 of a shared set.

A session that runs the loop stands where the controller stands, so the limit binds it. It
reads handovers from the log, it types nothing into a Builder session, and its reports reach no
Builder, Examiner, Referee or Diagnoser. The controller's own reasons (`campaign.move`,
`campaign.ended`) are the operator's to read and enter no seat's message.

The Builder's side is meant to be one conversation for the whole campaign, kept by compaction as
v1 kept it. Both of v1's compaction modes are in the source: under the Claude backend the CLI
compacts at a pinned window (`SWEEP_COMPACT_WINDOW`, `src/backends/claude.ts`), and for the other
backends pi's loop compacts (`src/backends/pi-compaction.ts`). Each compaction is logged
(`build.compacted`, `solve.compacted`, `exam.compacted`). What a session has when the conversation
is lost is in the source too: the notes it carries (`src/builder/memory.ts`), and the list of
failed practice solves with each comparison's tally (`src/builder/past.ts`). At PR #80 every
session is that case, since a session opens a new conversation.

When you build towards the Harness Builder, take v1's four lessons with it:

1. Code states the fact, and the model chooses the response.
2. One reading of the log, rendered once for each reader through its own filter. Until
   21 September v1's Builder received one test set through four readers, and they disagreed: 20
   of 25 in one paragraph and 0 of 5 in the next.
3. The standing facts are restated where the agent reads, so a compaction needs no signal. Every
   tool result of a Builder ends with the turn it is in, the session time used and the practice
   solves left (`usedLine`, `src/builder/prompt.ts`); a turn that ends without a call is answered
   with the goal and the same facts (`continuation`); and `read_opening` serves the opening
   message again. In the seven Builder sessions on record on 9 October every one of 365 turns
   ended in a tool call, so a message sent only between turns was never sent.
4. The wall is a test and no convention: rule 3 of section 8 states it.

## 5. The log

A campaign's record is one append-only JSONL file, `.ana/d2/<name>/log.jsonl`, one event a line
(`src/kernel/log.ts`). Every state and every report is a view over it, and nothing else is stored
as truth.

- An append is written and synced before it returns. A read refuses a torn or unknown line.
- A task's state (`held`, `released`, `refused`, `disputed`) is a fold over the log
  (`src/kernel/task.ts`). So are the pairs of a comparison (`src/kernel/compare.ts`), the stop
  rule and the tasks waiting for a label (`src/kernel/reports.ts`), and the dollars billed.
- A **condition** is everything that could change a solve's result, as one content-addressed
  record (`src/kernel/condition.ts`): the contract, the harness, the task version, the model and
  its effort, the price table, the runtime's packages, the compaction mode, the tool trees and the
  sandbox policy. Two solves are comparable only when their conditions differ in the one thing
  compared.
- A solve's trace is in the log (`solve.turn`, `solve.call`), as are a Builder session's and an
  Examiner session's own turns and calls.

Four habits follow:

1. **Add no second store.** A fact a command needs later is an event, and the command reads it
   back. A file beside the log that holds state is a second history.
2. **Add no second reader of one fact.** Find the fold that already reads it and call that.
3. **Never edit a log, and never write an event by hand.** A log with a hand-written line records
   a history that did not happen.
4. **An old event kind stays readable.** The source keeps no compatibility paths (section 12.3), and
   the log is the one exception, because a log is evidence: `EVENT_KINDS` still lists kinds that
   no command writes, so that an earlier log reads.

`.ana/` is ignored by Git and lies inside the repository, which every solve's, every Builder's and
every Examiner's wall denies, with the repository's other worktrees (`worktreesOf`,
`tools/d2/campaign.ts`): a campaign runs from a worktree kept for it, and until 10 October a
shell in a sibling worktree could read its log. The log holds hidden values and the checks' verdicts, so it never leaves the exam
side: not into a prompt, not into a pull request, not into a paste.

## 6. A campaign's commands

A campaign runs as a sequence of commands over one log. Each names the campaign (`--name`) and
the pack it opens over: a stored one, by four flags together (`--root --sweep --cycle --bundle`),
or none, for a campaign that opened from a prompt and whose exam its own log drafted
(`packNamed`, `tools/d2/campaign.ts`). The head comment of each file is its manual and lists its
flags.

| Order | Command | What it puts in the log |
| --- | --- | --- |
| 0 | `bun tools/d1b/draft.ts --name <name> --session d-1 --examiner <model>` | For a campaign that opened from a prompt: the session in which an Examiner drafts its exam, and the draft that stood, whole (`exam.drafted`). The host reads each draft without a model before it stands |
| 1 | `bun tools/c/accept.ts ... [--admit <checks>] [--freeze]` | What the check program was seen to do (`checker.read`), and the operator's word that the contract and that version stand (`contract.frozen`) |
| 2 | `bun tools/d2/prepare.ts ... [--practice N] [--tasks <ids>]` | The pack's tasks held out and the practice tasks released. `--tasks` confirms each named task against today's verifier and writes nothing: a comparison names its scored tasks itself |
| 3 | `bun tools/d1b/examine.ts ... --session x-1 --examiner <model>` | Further held-out tasks, written by an Examiner session |
| 4 | `bun tools/d2/round.ts ... --session b-1 --builder <model>` | A Builder session, then the comparison of the harness it left with the reference |
| 4 | `bun tools/d2/session.ts ... --session b-2 --builder <model>` | A Builder session with no comparison after it, under a dollar cap of its own. The plan's checkpoint is several of these and then one comparison |
| 4 | `bun tools/d2/checkpoint.ts ... --id g2` | One comparison of two harnesses the campaign keeps, with no Builder session |
| 5 | `bun tools/d2/settle.ts ... --session b-1 [--passes N]` | A person's labels for the rejections a comparison set aside, and its report once more; with `--passes`, the person's labels of N answers that passed, drawn by the comparison's id (`pass.labelled`), which change no reading |
| 6 | `bun tools/d2/promote.ts --name <name> --harness <digest> --yes` | The operator's word that a kept harness is the reference harness from there on (`harness.promoted`). Without `--yes` it says what the log holds of that harness and records nothing. A harness the rule would not promote takes `--despite "<why>"` |
| 6 | `bun tools/d2/import.ts --name <name> --harness <dir> [--note "<why>"]` | The operator's word that a harness built elsewhere, another campaign's handover or one written by hand, is one this campaign keeps (`harness.imported`): it is kept under its digest as a session keeps one, and `--parent`, `--reference` and `promote.ts` then name it. It is no session, so `latest` is unmoved |
| 7 | `bun tools/d2/close.ts ... --to <dir>` | Nothing. It writes what the campaign hands over, outside the repository: the reference harness as a directory that stands by itself, the public rules, and the closing report |
| all | `bun tools/d2/harness-builder.ts ... --budget <dollars> --builder <model> --examiner <model> --reviewer <model>` | What the campaign runs by, once (`campaign.opened`); then each move the table names, made by the command of its row above and recorded with its reason (`campaign.move`); and how the campaign ended (`campaign.ended`) |

The last row is the Harness Builder's controller. It asks `decide` for the one move that follows,
prints it, makes it, and reads the log again. `--dry-run` prints the move and makes none,
`--moves N` makes at most that many, and `--unattended` is the operator's word, given once, for
the freeze and the promotion (section 3). Without it a campaign still runs once every fault of
its checks is admitted: a reading with no fault left stands by itself, and the freeze is the
operator's word over a reading that has faults; and a step read twice is then reported and not
promoted, and the campaign waits there for `promote.ts`. To end a campaign that runs at a move
of your choosing, leave it a word (`tools/d2/word.ts --stop`): `--moves` counts moves, which the
table names as it goes. Its budget is one total: each move's cap is what is
left of `--budget` once every billed dollar in the log is taken off, and the campaign ends on its
budget where less is left than one solve is held at, or than the next comparison would bill by
what the last one under its setting did (`afforded`, `src/builder/decide.ts`): a comparison the
cap cuts tallies nothing. It ends in one of six ways, and the log's
last event says which: `budget`, `stop`, `exam`, `no-room`, `environment` or `operator`. With
`--handover <dir>` it then writes what it hands over (row 7): the harness is copied whole, with
the programs a kept state names by a link, and has to open there as the harness it was kept as.
The closing report is a view of the log, names no task and holds no check, and says what was
audited and what was not: what the Referee ruled, what a person's labels settled, and what a
person read of the answers that passed (`settle.ts --passes`, `src/review/passes.ts`), or that
nobody did.

A move that solves waits for the host: a Builder session and a comparison start once the
one-minute load is at or under the cores, and the command says once that it waits. `--loaded`
starts them all the same, as it does for a launch.

The operator steers a campaign that runs by leaving it a word (`tools/d2/word.ts`), which is one
event in its log (`campaign.word`): `--stop "<why>"` ends it there with the ending `operator`,
`--tasks "<why>"` has an Examiner session write other tasks before anything else is built or
compared, and `--budget <dollars>` sets its total from there on. The controller reads a word at
the next move's boundary and never inside a move (`pendingWords`, `src/builder/word.ts`), it
waits for none, and the event that acts on a word names it (`answers`), so each takes effect once. A stop followed by the same command is a
pause. A word reaches no seat: no Builder, Examiner, solver or reviewer reads it or its reason.

The opening (`campaign.opened`) keeps what the campaign runs by, so that its command goes on by
its name alone: the total, the full limit, the seats, and the terms of its moves
as a command last named them (`TERMS`, `src/builder/opening.ts`), which are a session's limits,
a comparison's size, the practice tasks, and a solve's wall and prompts until the setting is
recorded. A term no command named is its move's default. A flag that names another setting than
the campaign's record is refused with both, as every command refuses it.

Practice follows the supply, and the outcomes. One release takes at most half of what is held,
so a campaign that opens on a few tasks releases fewer than `--practice` names. Before a Builder
session the table has more released where tasks were held out since the last release, and after
a control that read room (section 7) it has as many again released. A release takes first the
tasks no solve answered in two comparisons, then half of the tasks the reference harness failed
in the last comparison, and the rest by the contract's draw (`tools/d2/prepare.ts`): the tasks
that leave the reference room are what a Builder has to work on, and until 10 October it
practised on tasks it passed. A task that a comparison scored before its release keeps that
comparison's solves on the exam side: a Builder is shown its practice solves only
(`practiceRan`, `src/kernel/solves.ts`). Before a comparison the campaign holds as many scorable
tasks as the comparison scores (`--target`), or the Examiner writes more first.

It opens a campaign over a stored pack, or from a prompt (`--prompt "<text>"` or `--prompt-file`,
with `--solver`): the opening then holds the prompt, and the first move is the draft of row 0.
A draft stands once the host's reading without a model finds no fault in it: its shape, a source
on every rule, one check a rule, every control through the checks twice, and the smallest answer
the format allows refused on every example (`draftReading`, `tools/d2/exam.ts`). What the reading
cannot say is whether a rule is the field's and its source real. Every check of a drafted exam is
its author's own computation, since nothing installs an engine of the field for a campaign, so
its acceptance reading holds one fault a check and the campaign ends on its exam there, once:
the log then holds `campaign.ended` with the ending `exam`, and the command prints the `--admit`
line to run. It goes on when the operator admits the checks by name: the command run again with
`--admit <checks>`, which is rule 10's word and the operator's, reads the exam again and goes
past that ending. `--prompt-file <path>` takes the prompt from a file, for a shell that cannot
carry it whole.

Start a round, a checkpoint, a Builder session by itself or an Examiner session through the
launcher, which reads the log and the host first and refuses a run that cannot report anything
(`tools/runs/launch.ts`). `--no-comparison` says that the flags are a session's by itself:

```text
bun run runs launch [--env-file FILE] [--loaded] [--dry-run] [--no-comparison] <the command's own flags>
bun run runs rehearse [--no-comparison] <the flags of tools/d2/round.ts that name no model>
bun run runs rehearse --campaign <the flags of tools/d2/harness-builder.ts that name no model>
bun run runs view <name> [the flags of a launch]
bun run runs pulse | stop <name> | compare | replay | seed | zip
```

The launcher refuses, among others: a log with no held-out task; a comparison that would leave
fewer untied tasks than a step takes at its level; a comparison with no `--cap`; an id whose
comparison has reported; a checker that nobody has read; a campaign the stop rule has stopped,
unless `--past-stop "<why>"` gives the operator's reason; a host whose load is over its cores,
unless `--loaded` says that its times will not be compared.

Whether a comparison may start is one function's to say (`admission`, `src/builder/admission.ts`).
The launcher asks it before it spawns anything, and a round or a checkpoint asks it again before
its first event, so a command started by hand is refused where a launch of it would be. What goes
on unasked is what the log holds the start of, of its own kind: a comparison that began, or a
session that began, and the launcher reads the same answer. A command writes nothing before its
last refusal: the admission's, then the comparison's own terms, and only then an override of the
stop rule and the campaign's setting. What only a host or an id can refuse stays with the
launcher. A rehearsal is exempt by name: its seats are scripts, which are paid nothing.

The setting of a campaign is recorded once in its log, as the event `campaign.setting`
(`tools/d2/setting.ts`): who solves and under which limits, which four flags name (`--solver`,
`--solver-effort`, `--solve-minutes`, `--solve-model-turns`), and which tasks
are scored (`--tasks` or `--target`). The first command that begins a comparison records what it
names, with the defaults for the rest. From then on a command that names nothing runs under the
record, and one whose flag names another is refused, by the command and by the launcher, unless
`--new-setting` gives the operator's word that the campaign's setting changes there. A campaign
whose solves were made before a setting was recorded has one all the same, the one its last
test-side solves ran under, and the first record is held to it in the same way (`firstRecord`).
A solver that is another model, at another effort or under other limits is another solver, and no
solve on record then counts.

Defaults worth knowing: 12 scored tasks (`--target`), 2 solves a side (`--solves`), level 0.10
(`--level`) and trigger 0.25 (`--trigger`), an objective margin of 0.01 (`--margin`), a stop past 3 tasks with a check defect (`--defects`), a patience of 6 (`--patience`),
a reserve of 10 dollars a solve
(`--reserve`), `--parent latest`, `--reference promoted`, which is the harness last promoted and
the starter until one is; a Builder session of 240 minutes, 300
turns and 24 practice solves; a solve of 120 minutes and 24 prompts, with the model's own turns
unlimited until `--solve-model-turns` names a number.

Two of them need a word for a small campaign. The reserve is what one solve is held at before it
starts, and a campaign ends where less of its total is left than that: set `--reserve` to about
what one solve of the solver bills, which the log of any earlier campaign under the same solver
says (`solve.finished.billed`). With `claude-api/claude-sonnet-5-5` at high on tasks a program
answers, 10 October: a solve 0.01 to 0.05 dollars, a Builder session 0.02 to 0.25, an Examiner
session 0.12, a draft 0.15 to 0.19, and a campaign of two comparisons of 5 or 6 tasks at 2 or 3
solves a side 2 to 5 dollars in all. A campaign runs at one budget, the model's turns and the
minutes its setting names (`--solve-model-turns`, `--solve-minutes`): until 11 October a ladder
of shorter budgets was read beside it (`--ladder`), and it went with `docs/simplify.md`, package
A. One flag line that ran a small campaign from a prompt to a typed ending on 10 October, for a
first campaign to start from, less the `--ladder 6,4,3,2` it carried then:

```text
bun tools/d2/harness-builder.ts --name t-9 --prompt-file <file> --budget 6 --reserve 0.05 \
  --builder claude-api/claude-sonnet-5-5 --examiner claude-api/claude-sonnet-5-5 \
  --reviewer claude-api/claude-sonnet-5-5 --solver claude-api/claude-sonnet-5-5 --solver-effort high \
  --solve-minutes 8 --solve-model-turns 10 --solves 2 --target 8 --practice 3 \
  --minutes 20 --turns 60 --practice-solves 6 --exam-tasks 10 --unattended
```

An Examiner session ends when the Examiner calls `finish`, which it may at any count, as much as
at `--exam-tasks`: on 10 October every session held out two to four tasks and finished of its own
accord. A campaign that runs is ended by a word (`tools/d2/word.ts --stop`), read at the next
boundary; `bun run runs stop` ends a run the launcher started.

## 7. How a comparison is read

`src/kernel/compare.ts`, `src/builder/round.ts` and `src/builder/comparison.ts` own this, and their
head comments are the full account. The short form follows.

**Terms first.** A comparison writes `comparison.started` before its first solve: its two
harnesses, its setting, its scored tasks, its solves a side, its level, its dollar cap and, where
given, its prediction (`--predict`). One continued from its log
keeps those terms, and one asked for again on other terms is refused. The scored tasks are
`--target` of the held-out ones, the newest epoch's first and within an epoch drawn by the
contract's hash, less two kinds the draw leaves out: a task with no valid answer after two comparisons, until a person labels it
(`awaitingLabel`), and one both harnesses answered in every solve of two comparisons under the
setting, which can only tie again or be lost (`exhausted`). A third of the latter stays in by
the same hash, so that a harness that breaks what the reference answers still shows its losses.
The Examiner is told such a task is exhausted.

**Fresh solves.** Each scored task is solved under each harness, afresh, the two harnesses taking
the first place in turn. A solve counts only when its start names the comparison. No earlier solve
of either harness is reused, because a condition names the host's code, which changes between
comparisons, and one frozen draw of the reference's solves would bias every later reading.

**How a solve ends** (`src/kernel/solve.ts`), and its part in a pair:

| Ending | Kinds | In a pair |
| --- | --- | --- |
| pass | | Valid. It beats an answer that is not valid, and is even with another valid one unless the comparison fixed an objective and one is the better by it |
| fail | `rejected`, once the rejection is ruled a true fail | Not valid |
| fail | `wall-ended`, `turns-ended`, `context-ended`, `no-answer` | Not valid. There is nothing to recompute, so no ruling is needed |
| fail | `broken-harness` | Not valid. The harness is what is compared, and one that cannot open answers nothing |
| fail | `rejected`, ruled a check defect or unclear, or waiting for a person | The task is set aside for both harnesses |
| non-result | `provider`, `sandbox-crash`, `killed`, `moved-files`, `check`, `verifier` | No measurement. It is solved again and is in no pair |

**The tally.** Every solve of the new harness is paired with every solve of the reference on the
same task. The harness that wins more pairs wins the task; otherwise the task is a tie. Ties leave
the test. Where the check program declares an **objective**, a quantity its evaluator computes of a
valid answer with a direction (`brief.objective`, `objective(request)`, verified after the checks
pass: `OBJECTIVE`, `src/kernel/verify.ts`), two valid answers in a pair are compared by it, and
the better by more than the margin (`--margin`, 0.01 of the larger magnitude) wins the pair
(`ObjectiveRule`, `src/kernel/compare.ts`). Validity is read first, so no refused answer is ever
the better one. The objective is public, in the contract and the solver's resources, and the
report says how many tallied tasks it decided (`objective.decided`). The rule is a term of the
comparison, fixed at its start; a check program that declares none pairs on validity alone. A one-sided sign test reads wins against losses, in two stages: a comparison whose
tally is at or under the trigger (0.25: 2 to 0, 4 to 1, 5 to 2, 7 to 3) buys the repeat and
promotes nothing, and the step and its repeat read together, wins and losses summed, clear the
level (0.10: 4 to 0, 6 to 1, 7 to 2, 9 to 3), the repeat having untied a task and won at least as
many as it lost (`readTwice`, `src/kernel/compare.ts`). A reading under the trigger counts for the
stop rule as a move that showed a gain. Both terms are recorded in the campaign's opening, so a
campaign reads by its own rule whatever the tree's default.

**The reading** is one of seven words (`Reading`, `src/builder/comparison.ts`):

| Reading | Meaning |
| --- | --- |
| `step` | The test cleared its level, with at least as many wins as losses against the starter |
| `no-step` | A test was made and did not clear its level |
| `below-starter` | The new harness beat a promoted reference and still loses to the starter |
| `starter-unread` | The test cleared its level, and the starter's own solves are incomplete |
| `not-scored` | No task was tallied, or the cap cut the test short. Nothing was tested |
| `check-defects` | The comparison stopped on its check defects |
| `no-change` | The session left nothing new to compare |

`not-scored` and `no-step` are different results. Eight rounds on 8 October scored no task and
were recorded as `no-step` eight times, for over 220 dollars, before the two were named apart.

**Rejections.** A rejected answer counts as not valid only once the Referee has ruled it `earned`.
A ruling of `check-defect` or `unclear`, or no ruling, sets the task aside for both harnesses. A
person's labels then settle it, and a label stands over a ruling. Past `--defects` tasks with a
check defect or a check that could not run, the comparison stops, since the check program then
needs its owner before more is spent.

**The budget.** The binding unit is the model's own turns, told to the solver on every tool result
and enforced (`--solve-model-turns`; a solve that uses them without an answer ends `turns-ended`).
A time limit on each command bounds a turn. The prompts a solver is given before a solve stops
with no answer are every solve's, v1's cap on nudges (`LIMITS.turns`), and bound no solve on
record. A comparison is read at the one budget its solves were told. Until 11 October
`--budget turns=40` read the same solves again at a shorter budget, which is a reading of a
solver told the longer one, and the CPU seconds of a solve's commands were reported beside the
turns: the meter counted only the children a command waited for and read zero under Bubblewrap.
Both went with the ladder (`docs/simplify.md`, A2 and A3).

**Beside the test.** The report holds how each harness did by itself (`valid`: on how many tasks
every solve, some or none were valid). `--noise` reads the
reference against itself on separate solves; it should read no step, and its tie share is the
noise every comparison has to exceed.

**The dollar cap.** `--cap` is required. Before each solve the billed dollars of the comparison
are summed from the log, and the solve does not start when a reserve for it and for every solve
in flight would pass the cap.

**After the test.** A comparison that wrote its report is finished: run again, it returns that
report. The stop rule is as many moves in a row that could have shown a gain and showed none as
the campaign's patience (`stopRule`, `src/kernel/reports.ts`; `--patience`, six by default while
the system is built, since every campaign of 9 and 10 October ended on the plan's three before
its tasks were measured). A move that counts is a harness a session changed, once
against one reference and read by the last comparison of the two under the campaign's setting,
where that comparison tallied a task and left room; or a session that left its harness as it
was. A repeat, a control, a comparison that scored nothing or left no room, and whatever was
compared under an earlier setting do not count. A comparison leaves no room where the reference
harness was valid on more than three solves in four, or neither harness on one in four (`roomOf`):
its answer is another budget or other tasks. The next comparison or session is then refused,
unless the operator gives a reason to go on (`--past-stop`), which is logged as
`stop.overridden`. A task with no valid answer in two comparisons goes to a person as
possibly infeasible, unless a valid answer for it stands anywhere on record, a solve's or the
one the host saw its author's `try_answer` pass before the proposal (`task.proposed.feasible`),
or a limit cut its solves (`awaitingLabel`). Promotion is the operator's `promote.ts --yes`, which writes
`harness.promoted`. A comparison that names no `--reference` is made against the harness last
promoted, and one that names a digest is made against that harness and promotes nothing.

**What follows a reading** is move 7's to say (`decide`, `src/builder/decide.ts`), and the view
prints it as its last line. A step is one draw: the same two harnesses are compared again. The
reference is read against itself beside the first comparison under a setting and stands for the
ones after it, until the reference is another harness or tasks were held out since (`noiseRead`). A step read twice, where the new harness won at least as many tasks as it lost
against the starter, names the harness to promote (`unpromoted` says why another is not). No step with room sends the
Builder to build again, once the next comparison has tasks to untie: where the reference harness
answered too many of them in every solve, the Examiner writes tasks first, since a changed harness
can only tie again on those (t-2, 10 October: 3-0-2 on 5 tasks, two unchanged sessions and a
stop), and tasks written since the comparison are compared on before anything is built (t-3, the
same day: four written, two unchanged sessions and a stop before any comparison on them). A
comparison without room changes the tasks before the budget: the Examiner writes tasks the
reference harness fails, and a promotion sends it to write them too, since the next epoch's tasks
are the ones the harness now the reference fails. Until 10 October the budget came first, and
what t-10 climbed was the turn count: a harness that answered in 2 turns where the starter took
3, on tasks both answered at the full limit. Since 11 October there is no budget to fall back
to: a campaign runs at the one its setting names, a comparison in which the reference answered
nearly everything or neither harness answered sends the Examiner for other tasks, and as many
Examiner sessions in a row as the campaign's patience that hold out none end it. The ladder, the
readings at shorter budgets, the budget rule and the return to a budget went with
`docs/simplify.md`, package A: every step a rung read on record was on tasks both harnesses
answered at the full limit, which measures set-up time and not method, and a reading at a
shorter budget is of a solver that was told the longer one (on 9 October the starter answered 0
of 10 solves read at two turns, and 10 of 10 once it was told two). The two ways to room are the
tasks and the objective. Where no session has left a harness but
the reference, as after a promotion, tasks held out since the last comparison are read by a
control before a Builder session is paid for: the starter compared with the reference on them,
which says whether they leave the reference room; with room the Builder builds, on practice
brought up from those tasks, and without it the tasks change again (t-4, t-9 and t-10,
10 October, each built three times here on practice the promoted harness passed, and stopped
with the tasks unmeasured). It ends `no-room` after more comparisons of one harness without
room than its patience, or as many Examiner sessions in a row that held out no task. The two
shares of `roomOf` are the plan's proposal and the operator's to set.

## 8. Rules

Cite a rule by its number in a pull request or a review.

1. **The comparison decides, and nothing else does.** A harness is better when a comparison reads
   a step. A practice result, a Builder's account, a diagnosis, a reviewer's opinion and a passing
   test suite say nothing about which harness is better, and none of them may set or adjust a
   reading.

2. **Only the Examiner writes the exam, and nobody coaches it.** No person and no other agent
   writes or repairs a rule, a check or a task. That includes you: never hand-edit a pack, a check
   program, a task, a kept harness or a log to make a command pass. A defect that shows across
   domains is fixed in the host, a prompt or the contract code. A check ruled defective goes back
   to its author. For a campaign that opens from a prompt the Examiner drafts the exam once,
   before its first task, and the host holds each draft to a reading without a model; no seat
   repairs a check afterwards (section 9 lists it).

3. **Nothing crosses the wall but the closed list of section 1.** The test is exact: a change to
   a hidden value, to a check, or to which held-out task was won must leave every message a
   Builder or a solver reads byte-identical. For a Builder that test is in the suite
   (`test/builder.test.ts`, "what crosses to the Builder"): two campaigns that differ in every
   such detail, one session over each, and every context and every file of its home compared. A
   change that touches such a message says in its pull request how it checked this. Withholding is a property of everything an agent can read:
   prompts, tool descriptions, tool results and files in its home.

4. **Terms are fixed before the first solve and never moved after a result.** The tasks, the
   solves a side, the level, the cap and the prediction are logged first. Do not top up a set
   that a dispute thinned, or rerun a finished comparison on other terms.

5. **Both sides are solved afresh under one setting.** No stored solve stands in for a side.

6. **One solve is weak evidence.** The same harness fails a task once and passes it the next
   time: in v1's record a fail repeated on the same bytes 5 times in 21. A fail, a win or a loss
   counts when repeated solves support it. Say so wherever a single result is shown to an agent.

7. **A non-result is never a pass or a fail.** A provider failure, a sandbox crash, a kill, a
   check that threw and a verifier that could not decide are typed, solved again where the solve's
   side failed, and counted nowhere. A broken harness is the opposite case and is the harness's
   own fail: a non-result there would be rerun into the same break and the harness would leave the
   score with it. An environment failure belongs to the environment's owner, never to an author.

8. **A rejection counts only once it is ruled, and a hand label stands over a ruling.** In v1,
   36 of 47 rehearsal misses came from a faulty check or instrument. The passes were sound: 5 of
   1,411 were overturned.

9. **No reference answers, no stronger solver, no agent built to find answers.** A check verifies
   a property, which is easier than finding an answer, so a check can be right on a task nobody
   has solved. v1's solver matched whatever its author's side found.

10. **No agent writes an instrument.** The facts a check compares come from the field's own tool:
    an analysis engine, a compiler, a simulator, installed and pinned by digest. Nothing in the
    system writes or edits one. A check whose author's own computation decides it is listed as a
    fault until the operator admits it by name (`--admit`), which is meant for plain arithmetic on
    the answer.

11. **The host owns every limit.** A harness, a prompt or a file that asks for a longer wall, more
    turns or more disk changes nothing.

12. **One owner for each decision and one reading for each fact.** Before adding a check, a flag
    or a reader, find the one that exists. Where two places decide the same thing, the pull request
    that notices it names both and removes one.

13. **Add machinery only on evidence, and remove what pays no rent.** A mechanism is built when a
    live result shows the need for it. On 8 October, 37 pull requests were stacked while one small
    live round had run. A gate earns its place by changing a decision correctly; given the choice,
    remove or widen a gate before adding a wall. Map each new concept as
    `owner → live reader → decision it changes → evidence → hostile test`, and drop it when a link
    is missing. The change that supersedes a mechanism retires it: a pull request that gives a
    decision a new owner, makes one rule the fallback of another, or answers a failed run with a
    row, a threshold or a sentence deletes what it replaces in the same change, or names under
    "Not done" what still reads the old path. Of the 122 pull requests measured on the stack
    from #57 to #185, 3 left `src` smaller (#88, #90, #127), and each generation of a mechanism
    stood beside the one before it (`docs/simplify.md`).

14. **Stop when nothing can be learned.** A launch that cannot give a result is refused before it
    is paid for. A comparison that tested nothing says `not-scored`. A comparison of non-results
    gives an operational result and no result about a harness. Do not remeasure a dead provider
    because budget remains.

15. **Explicit credit exhaustion is an ordinary interruption.** When a provider reports that a
    login is out of credit or at its session limit, keep what was recorded and classify the
    affected work from its events. A generic 429, a timeout or a crash is not that report:
    investigate the failure itself.

## 9. Status, evidence and claims

`.claude/skills/attribution-and-proof/SKILL.md` owns what one reading may be said to show, and the
form of its report. This section holds what applies to every statement, in a pull request as much
as after a run.

### The ladder

The words "built" and "done" are not used for status. A part stands on one level, and a statement
about it names the level:

| Level | Meaning |
| --- | --- |
| Planned | In the plan only |
| Present in source | In the tree at a named commit, with its live reader |
| Proved without a model | A test with its nearest hostile case, a replay of recorded logs, or a rehearsal on a seed |
| Exercised live | An event in a real run's log shows that the mechanism did its work there |
| Shown in an outcome | A reading that moved, repeated once on fresh solves |
| Withdrawn | Analysis, a review or a run showed that it does not work. The entry stays, with the reason |

None stands in for the next. The four middle levels are the skill's, and the plan uses the same
words since its revision 358. The plan keeps the level of each part, and a pull request names
what it moves: in `docs/plan.md` that is the level column of the fix plan. Keep no second status list: not in this file, not in a new file, not in a
code comment.

Read at PR #80 (`d878c1b`), four designed parts were absent from the source, and three still
are. Check the plan and the head before relying on this list, and delete a line here in the
change that makes it false:

- the Judge: the Referee has a probe and no shell, reads the check program, and is unmeasured
  against hand labels. No seat reads an answer that passed: a person reads a drawn few
  (`settle.ts --passes`);
- a repairer for the check program, and an engine behind a drafted one: the Examiner drafts an
  exam for a campaign that opens from a prompt (section 6), no seat repairs a check, and every
  check of a drafted exam is its author's own computation, which waits for the operator's
  `--admit`;
- one Builder conversation across sessions.

### Evidence

```text
events in a campaign's log  >  a fold over the log  >  source and tests  >  a command's printed line
                            >  a pull request's text  >  an agent's account
```

- A prompt assertion proves text, a type proves a shape, and a test proves the conditions it
  tested. None of them proves that a model behaves better.
- A rehearsal (`bun run runs rehearse`) seats a script in each model seat. It proves that the path
  runs and writes its events, and nothing about a model.
- A test suite that passes on one operating system says nothing of the other. The OS wall has two
  mechanisms, Seatbelt and Bubblewrap, and each is exercised only on its own platform.
- A Referee's ruling and a Diagnoser's account are a model's output. Keep them apart from the
  verifier's verdict and from a fact of the environment.
- A session report or a subagent's report is a lead. Check a finding against the source before
  acting on it or repeating it.

A negative claim about capability, such as "nothing checks X" or "the launcher does not refuse Y",
is the most expensive kind to get wrong, because every later reader compensates for a defect that
may not exist. Make one only with the named symbol, its call sites and a check run in the same
turn.

### What may be claimed

| Claim | Requires |
| --- | --- |
| A step | A comparison that read `step`, named with its condition: the setting, the tasks, the solves a side, the level, the budget and the starter it was read on. One comparison is one draw, so a step is repeated on fresh solves, with the reference read against itself (`--noise`), before the word is used without qualification or anything is promoted |
| No step | The same naming, and the size of the test. `no-step` says that a test of this size found no gain. It says nothing about equality |
| A mechanism | The event it writes, in a live run's log, where its trigger occurred |
| A refusal | The refusal's text. It establishes its own condition and nothing about the answers |
| Which part of a harness did it | A checkpoint against the control `programs-of:<digest>`, which is the starter with that harness's installed programs alone |

`step` says that under one condition the new harness gave a valid answer on more tasks than the
reference, by more than the level leaves to chance. It does not say that the harness is better
under another wall, budget, solver or host, or that the solver designs better: a harness that
installs an engine the public rules name saves a solver its set-up time, and under a short wall
that reads as a step.

Keep the counts apart in every sentence: valid answers; rejected answers, by ruling; solves that
ended with no answer, by how they ended; non-results; and tasks set aside for a label. A rate has
a denominator, and the tasks left out of it are named beside it. Results are never compared
across campaigns, and never across two settings.

## 10. Runs with a real model

A run with a real model spends the operator's money and needs the operator's word for that run. A
launch request authorises one command and no second run beside it. The skills own the procedure:

| When | Skill, under `.claude/skills/` |
| --- | --- |
| Deciding what to run next, and reading what a run showed | `run-improvement-campaign` |
| Testing a path before spend | `system-path-simulation` |
| Starting or stopping a run | `launch-run` |
| Wording a claim afterwards | `attribution-and-proof` |
| Doubting a reading, or asking what a fail was | `whole-run-investigation` |
| Setting recorded rounds side by side | `model-condition-comparison` |
| Handing runs, or a question, to someone outside | `zip-run`, `oracle-handover` |

What holds in all of them:

1. **The worktree is the condition.** A run executes the source of the worktree it started in.
   Launch from a clean worktree at a published commit, kept for that run alone. Do not edit
   `src/` there while the run lives, and never move a campaign's folder to another worktree.
2. **Prove the path first, without a model**: a dry run of the launch
   (`bun run runs launch --dry-run`), a replay for a changed reader (`bun run runs replay`), a
   rehearsal over a seed for a changed round (`bun run runs seed`, `bun run runs rehearse`).
3. **Put one prediction on record before the first solve** (`--predict`), written so that a
   recorded count settles it. One written after the first solve started is a description. The
   campaign command takes no `--predict`, since its comparisons are the table's: a prediction for
   a campaign is written in the ledger of the session that launches it, before the first solve.
4. **One or two rounds at a time on one host.** A wall counts the clock, and a loaded host moves
   every solve's time.
5. **Never open, print or copy the file passed as `--env-file`**, and name no account or
   credential path in anything that is published.
6. **Do not stop a run to fix it.** Work found while a run lives is work for the next launch.
7. **Read the log's events and the report before any agent's prose**, and resolve the prediction
   as held or falsified with the count that settled it.
8. **Report every attempt that started as spent**, the unsuccessful ones included.

A solve and a Builder session run on either host, behind Seatbelt on macOS and Bubblewrap on Linux:
nine Builder sessions and 308 solves finished on a Linux test host on 9 October. The disk cap holds
on macOS, where a sparse image is mounted at the root of each solve and each Builder session. On
Linux nothing caps a solve, a Builder session or an Examiner session: each runs its commands
under the command wall, which binds its root from the host's disk and mounts no tmpfs there; the
head comment of `src/verify/disk-cap.ts` says so (`docs/simplify.md`, F6). When the required wall
is unavailable the result is a typed non-result, never an unconfined run. Each wall is probed once
a process before its first use, by one command launched as a seat's commands are (`runWalled`): a
canary in the repository and its first other worktree's `package.json`, which the probe never
writes, are refused to it, and a file it writes in its own folder reads back. A probe that does not
hold refuses the start with its lines (`walledBase`, `src/solve/command.ts`); until 10 October the
probe ran in the test suite alone, and until 11 October it ran v1's launch, which no seat runs.

## 11. Working in the repository

### Runtime and commands

Bun 1.4.2 only, as `package.json` pins it, for every task including one-off inspection. No Node,
npm or npx. `src/meta` wraps the few Node surfaces Bun lacks (section 12.8).

| Command | What it does |
| --- | --- |
| `bun run typecheck` | `tsc --noEmit` over `src`, `tools`, `vendor` and `test` |
| `bun run lint` | Oxlint, type-aware, with the two repository plugins and the not-slop ledger applied. `-- --strict` makes plugin findings fail the run |
| `bun run format` / `format:check` | Biome writes, or checks |
| `bun run test -- <paths...>` | The suite through its wrapper. Never bare `bun test` |
| `bun run simplify` | The whole-tree scans, as a census to read |
| `bun run not-slop` | The ledger of answered findings: status, `-- answer <id> "<why>"`, `-- prune` |
| `bun run commit:check` | By hand before a commit: author email, format and lint of staged files, the slop report, the secret scan |
| `bun run secrets` | The secret scan |
| `bun run runs <verb>` | `pulse`, `launch`, `stop`, `rehearse`, `seed`, `compare`, `replay`, `zip` |
| `bun .claude/skills/stack-pr/scripts/stack.ts` | The open stack: every edge, and the top |
| `bun tools/loc/source-policy.ts` | The size and unused-export policy. No package script, CI job or hook runs it (section 12.10) |

There is no composed gate script and no installed Git hook. The gate is what CI runs, in this
order, and you run it yourself before delivery. Then read a strict lint for the files you changed:

```sh
bun run typecheck && bun run lint && bun run format:check && bun run test
bun run lint -- --strict
```

Run one suite at a time; two overlapping suites each take about twice as long. While editing, run
the owning test files only: `bun run test -- test/compare.test.ts`. The wrapper refuses a named
path that does not exist, because Bun would treat it as a filter and silently run its neighbours.

CI (`.github/workflows/ci.yml`) has two jobs. `darwin` on macOS 15 runs typecheck, lint, the
format check and the suite. `linux` on an Ubuntu VM installs Bubblewrap and runs the suite. In a
container without user namespaces the tests that need the wall fail. Name those in the pull
request as failures that are there without the change, and do not call the suite green.

### What you never touch

- `.ana/`: campaign logs, kept harnesses, launch receipts. Read them through the readers; never
  edit, move or commit them.
- A pack, a check program or a kept harness, by rule 2.
- `.env`, `.accounts/` and any credential. Never copy one from another checkout to make a command
  start.
- `vendor/`: `pi-coding-agent` and `pi-claude-bridge` are copies of upstream. A local change is
  marked in place and kept small. Biome and Oxlint both leave `vendor` alone.
- Installed dependencies: no patches, and no edits under `node_modules`.

### The stack and pull requests

`.claude/skills/stack-pr/SKILL.md` owns this procedure. Read it before you branch and again
before you push. v2's work is one linear stack of open pull requests, each based on the branch
below it, and several sessions write to it at once. What it comes to:

- **Read the stack every time**: before `git worktree add`, before opening a pull request, and
  before a push that rewrites a branch. `bun .claude/skills/stack-pr/scripts/stack.ts` prints the
  edges and the top; where `gh` has no GraphQL, `gh api repos/<owner>/<repo>/pulls` gives the same
  edges. The top is the end of the longest chain, which need not be the highest number. State no
  fact about the repository without the commit you read it at.
- **A new subject is a new pull request on the top.** The same subject as one of your own open
  pull requests is appended to it. Documentation and skills go on the stack too, with the row of
  `docs/transfer.md` that the change moves.
- **Another session's pull request is never yours to change**, whatever the fix. A pull request
  with children takes new commits only.
- **One worktree a pull request**, from the top, pinned by commit, with its own
  `bun install --frozen-lockfile`. Never branch in a worktree a run was launched from. Never use
  `git stash`: it is shared between worktrees.
- **Every commit passes alone.** Fold a fix into the unpublished commit it corrects. Run
  `bun run commit:check` before each commit.
- **Push your own branch**, never `main`, never with `--no-verify`. A rewrite of a published
  branch takes `--force-with-lease` on the head you last saw.
- **Merging is the operator's call**, and so is a restack of the whole stack.

A commit's subject is one imperative sentence that states the finished change: "Refuse a
comparison on a checker nobody has read". Its body says what was wrong and what happens instead,
with the counts that show it. It never narrates a revert.

A pull request's body, as the stack's bodies read:

```text
Stacked on #<n>.
Why                    what was wrong, in plain words, with the recorded number that made the case
What changes           one line a finished change
On the recorded logs   where a reader changed: what it now says of campaigns already run
Not done               what was left out on purpose
Checked                each step of each CI job, where it ran, the head's short commit, the counts;
                       a failure that is there without the change is named as such
```

Name what misbehaves: the launcher, a round, a reader, the Builder. The file that holds it goes in
the evidence beneath. A change with no defect behind it says so in one line. Rewrite the body
after every push that changes the pull request.

### Reviews and subagents

Launch parallel subagents from the current session in one message, one bounded task each, with no
coordinator. Each prompt names its authority, the exact paths and commit, the observed facts, the
question and the required output, and says read-only unless the operator asked for changes. Give a
reviewer the code and not your conclusion. Check every finding you act on against the source.

## 12. Code that passes the first time

Most lint findings here are preventable by habit. This section is the habit: write to it from the
first line, and the round trip through the linter mostly disappears.

### 12.1 Compiler and formatter

- TypeScript, `strict`, with `noUncheckedIndexedAccess` (an indexed read is `T | undefined`),
  `exactOptionalPropertyTypes` (`{ k: undefined }` and `{}` are different values),
  `noUnusedLocals` and `noUnusedParameters`. Target and library ES2025, modules NodeNext.
- Imports carry the `.ts` extension. Files under `src` and `vendor` import one another by
  relative path. Elsewhere an import that climbs three or more directories uses the aliases of
  `package.json` (`#src/…`, `#tools/…`, `#skills/…`), and one or two levels stay relative.
- Biome formats: two spaces, width 110, double quotes. Do not align or wrap by hand; run
  `bun run format`.
- `tsc` does not include `.claude/`, so a skill script is checked by lint and by its tests
  (`test/skill-scripts.test.ts`, `test/meta-cli.test.ts`).

### 12.2 How lint runs

`bun run lint` runs Oxlint over `src`, `tools`, `test` and `.claude` with `--deny-warnings` and
`--report-unused-disable-directives`, type-aware. Two repository plugins ride along: `ana`
(39 rules) and `anti-slop` (17 rules). Every enabled rule in `.oxlintrc.json` is an error.

- **Plugin findings fail the run only in strict mode**: `bun run lint -- --strict`,
  `ANA_LINT_STRICT=1`, or a clone with `git config ana.lintStrict true`. A plain run holds you to
  Oxlint's own rules and counts the rest. Work in strict mode: CI's lint step is strict, and a
  strict run reports nothing since 10 October (the 11 findings that stood from PR #80 were
  cleared, one answered in the ledger). Add none, and say in your pull request that the strict
  run is clean.
- Extra arguments go to Oxlint. Fifteen rules carry a fixer, marked [fix] below, which Oxlint's
  `--fix` applies; `tools/oxlint/FIXER-DECISIONS.md` says why the others report only.
- **Never turn a rule off**: no new `"off"` in `.oxlintrc.json`, for the tree, a glob or a file,
  and no `oxlint-disable` comment for a plugin rule (`ana/no-inline-slop-answer` refuses it).
- **When a finding is wrong about a site**, the answer depends on the rule
  (`tools/oxlint/not-slop-ledger.ts`):

  | The rule is | The answer |
  | --- | --- |
  | a plugin rule with a fixer | Tune the rule's source, so that the legitimate shape passes and every case it caught still fails, with a fixture for each side. The ledger refuses these rules |
  | a plugin rule without a fixer, or a `tree/` scan | Tune the rule, or answer the site: `bun run not-slop -- answer <id> "<a reason a reviewer can check>"` |
  | a core Oxlint rule | Fix the code. An exception is a fact about the code, written beside it as an `oxlint-disable` comment with the reason; an unused one fails the lint |

  A ledger row that no longer names a finding fails a strict lint, and `bun run not-slop -- prune`
  removes it.

### 12.3 The habits

The left column is what the hand writes first. The right column is what passes.

```ts
// A nullable string, number or boolean is no condition (typescript/strict-boolean-expressions).
// A plain string, a plain number and `Row | undefined` pass as they are.
if (name)      // string | undefined   →  if (hasText(name))        // src/meta/text.ts
if (count)     // number | undefined   →  if ((count ?? 0) !== 0)   // or count !== undefined
if (flag)      // boolean | undefined  →  if (flag === true)
name || "x"    // string | undefined   →  name ?? "x"               // textOr(name, "x") if "" falls back too
if (items.length)              →  if (items.length > 0)     // unicorn/explicit-length-check
if (maybe?.length)             →  if ((maybe?.length ?? 0) > 0)
const n = +text; "" + n; !!x   →  Number(text); String(n); x !== undefined

// The positive case first (unicorn/no-negated-condition, eslint/no-else-return)
if (!ok) { a } else { b }      →  if (ok) { b } else { a }
a !== b ? x : y                →  a === b ? y : x
if (c) { return a } else { return b }   →  if (c) return a;  return b;

// Types stay honest
x as T                         →  a predicate, `satisfies`, or a parse; else  // SAFETY: <what you checked>
x as unknown as T              →  parse at the boundary (capturedJsonParse + a predicate, parseJsonAs<T>)
value!                         →  a guard: if (value === undefined) throw …
typeof x === "string"          →  isString(x)               // src/meta/json-shape.ts
Record<string, unknown>        →  JsonObject, or OpenRecord for an open view
function f(input: unknown)     →  declare the type, or prove it in the body
function f(): unknown          →  return the parsed type
function f(options: object)    →  a named interface
function close(log, true)      →  close(log, "failed")      // a union of two string literals

// JSON, errors, optional keys, the runtime: each has one owner in src/meta
JSON.parse(text)               →  capturedJsonParse(text)   // JsonValue until checked
JSON.stringify(v)              →  capturedJsonStringify(v)
e instanceof Error ? e.message : String(e)   →  errorMessage(e)
throw new Error("x")  in catch →  throw new Error("x", { cause })
...(v === undefined ? {} : { k: v })         →  ...keyIfDefined("k", v)
import { readFileSync } from "node:fs"       →  the same name from src/meta/filesystem.ts
new Promise((r) => setTimeout(r, ms))        →  Bun.sleep(ms), or wait on the condition

// Arrays
xs.filter(p).map(f)            →  xs.flatMap((x) => (p(x) ? [f(x)] : []))
xs.map(f).filter(Boolean)      →  xs.flatMap((x) => f(x) ?? [])
xs.filter(p).length > 0        →  xs.some(p)
xs.some((x) => x === "lit")    →  xs.includes("lit")
xs[xs.length - 1]              →  xs.at(-1)
const ys = xs.reverse()        →  const ys = xs.toReversed()
numbers.sort()                 →  numbers.toSorted((a, b) => a - b)   // a string[] sorts bare
for (const x of xs) if (p(x)) return x;      →  return xs.find(p)
for (const k of Object.keys(o)) … o[k]       →  for (const [k, v] of Object.entries(o))

// Promises
void promise; promise;         →  await it, return it, or .catch it
xs.forEach(async (x) => …)     →  for (const x of xs) await …   // or Promise.all(xs.map(…))
```

And in words:

- **Lay a file out** as imports, then types and interfaces, then module constants, then functions.
- **Nest at most three deep.** Guard and return early; split a function that does two things.
- **A ternary has at most three cases along its tail**, with nothing nested in a test or a first
  arm. Name the inner one in a `const`.
- **A function takes at most five parameters**, none a bare boolean, none typed `object`. It
  shadows no outer name and reassigns no parameter.
- **Write no helper for one caller.** A non-exported function of two statements with one caller
  is inlined; a function that only forwards its parameters is a second name; a `const` that
  renames an expression and is read once is that expression.
- **Give a repeated thing one owner.** A string of six or more characters spelled four times in a
  file becomes a named constant; an object literal of three or more properties spelled three times
  becomes one function.
- **Export only what another file imports.** A name with no reader outside its file loses its
  `export`.
- **Name things for their role.** No name carries the word "shape" (`taskShape`), and no
  production name carries "legacy".
- **Keep no compatibility path** in source: no `v1 || v2` reader, no migration branch, no shim. A
  reader that meets an older version refuses it. The log's event kinds are the one exception
  (section 5).
- **Sizes**: a file at most 800 nonblank lines, a function at most 115.

Before a commit: `bun run format && bun run typecheck && bun run lint -- --strict`, the nearby
tests, then `bun run commit:check`. Before handing back: `bun run simplify`.

### 12.4 The `ana` rules

A test file is anything under `test/` or named `*.test.*`. Exemptions live inside each rule.

**Structure**

- `declarations-before-the-first-function` [fix]: imports, types, module constants, then
  functions. A constant whose initialiser calls something or reads below stays where it is.
- `no-inline-schema-literal`: a table of three or more constant entries built inside a function
  moves to module scope under a name. Tests are exempt.
- `no-deep-nesting`: a statement four levels inside its function is an error. `if`, loops,
  `switch` and `catch` count. A guard does not: an `if` without `else`, of at most three
  statements, that ends in `return`, `continue`, `break` or `throw`.
- `no-tangled-ternary`: at most three cases, growing along the tail only.
- `no-single-caller-helper`: inline a non-exported function with one caller and a short body: at
  most two statements and five lines where it is called in an expression, three and seven where
  the call is a statement. It yields where the inline would push the caller past 115 lines.
- `no-pass-through-wrapper`: a body that only forwards its parameters. Adding a default, a
  narrowing or a fixed argument makes it a real function.
- `no-single-use-const-chain`: three or more `const`s, each read once by the next statement, are
  one expression. A comment or a type annotation ends the chain.
- `no-renaming-temporary` [fix]: `const rows = bundle.rows;` read once below is `bundle.rows`. A
  binding read inside a closure, after the function has tested that path, is exempt: it keeps
  the narrowing.
- `no-alias-restating-return`: a type alias used only as one function's return type is
  `ReturnType<typeof f>`, or nothing.

**Branches**

- `no-arms-differing-in-one-term`: two arms that are the same text but for one value are one arm
  with the condition at that value.
- `prefer-condition-over-boolean-returns` [fix]: `if (c) return true; return false;` is
  `return c;`.
- `prefer-const-conditional` [fix]: `let x; if (c) x = a; else x = b;` is `const x = c ? a : b`.
  A default followed by an override is `const w = o.w ?? D`.
- `prefer-lookup-over-equality-chain`: three or more `if (x === "lit") return …` arms are a table,
  `{…} as const satisfies Record<Kind, …>`.
- `no-positional-boolean-parameter`: take a union of two string literals. Tests are exempt.
- `no-side-effect-in-predicate`: no mutation inside a `filter`, `find`, `some` or `every`
  callback. Deduplicate with `new Map(rows.map((r) => [r.id, r]))`, or write the loop.

**Arrays and loops**

- `prefer-find-over-loop` [fix], `prefer-some-over-filter-length` [fix],
  `prefer-includes-over-some-equals` [fix], `prefer-flatmap-over-map-filter`,
  `prefer-entries-over-keys-lookup`: the rewrites of 12.3.
- `no-inline-block-reducer`: a `.reduce` with an inline block body is a hidden loop. Write the
  `for…of`.

**Calls**

- `no-argument-already-carried` [fix]: `f(bundle, bundle.findings)` passes one value twice. Read
  the part inside `f`.
- `no-transposed-argument`: two same-typed arguments passed in the other order than the
  parameters are named. Fix whichever side is wrong.
- `no-property-read-on-function`: a property read off a local function is `undefined`, and
  usually a missed rename.

**Repetition**

- `no-repeated-string-literal` [fix]: six or more characters, four spellings in a file (ten in a
  test). Import sources, object keys and bare tags are exempt.
- `no-thrice-spelled-object`: three or more properties, three spellings (five in a test).

**Types**

- `no-unknown-union`: `Row | unknown` is `unknown`. Write the real type.
- `unproven-unknown-parameter`: an `unknown` parameter is proved in the body, by a predicate, a
  narrowing guard or a hand-off to a prover (`is…`, `as…`, `assert…`, `parse…`, `errorMessage`).
  Passing it straight on proves nothing.
- `require-type-for-null-default`: JavaScript files only.

**Owners**

- `no-hand-rolled-error-render` [fix]: `errorMessage(e)` and `asError(e)`.
- `require-captured-json-runtime` [fix]: in `src`, no ambient `JSON.parse`, `JSON.stringify` or
  `structuredClone`.
- `require-meta-runtime-import` [fix]: no `node:` import outside `src/meta`. Seven have a wrapper
  there, and the fixer moves them: `node:fs`, `node:fs/promises`, `node:path`, `node:os`,
  `node:net`, `node:module` and `node:assert/strict`. Any other, `node:crypto` for one, is
  reported with no fix: use what `src/meta` already offers (`sha256` for a hash), or add a
  wrapper there. Tests and `.claude` are exempt.
- `prefer-key-if-defined` [fix]: `...keyIfDefined("k", v)` inside the literal, in place of a
  guarded assignment after it.
- `no-hand-rolled-sleep`: no `setTimeout` promise. Wait on the condition, or `Bun.sleep`.
- `no-lifetime-outside-owner`: a file that spawns a child and kills it is a second owner of
  process lifetime beside `stageCommandIsolation` (`src/verify/solve-command-isolation.ts`).
  Signal through `killProcessGroup` or `terminateAndReapProcessGroupId`
  (`src/meta/subprocess.ts`). Tests are exempt.
- `no-inline-slop-answer`: no disable comment for a plugin rule. Use the ledger.
- `no-hand-spelled-git`, `no-hand-spelled-tree-root` [fix], `no-hand-read-argv`: see 12.8.

### 12.5 The `anti-slop` rules

- `no-array-filter-map`: one `flatMap` in place of `filter().map()`.
- `no-chained-type-assertions`: no `x as unknown as T`.
- `no-conditional-empty-object-spread`: no `...(ok ? { k } : {})`. Use `keyIfDefined` or `keysIf`.
- `no-known-value-widening`: no annotation wider than the value states. Keep the inference, or use
  `satisfies`.
- `no-module-mocking`: inject through a real interface.
- `no-object-parameters`: no parameter typed `object`.
- `no-reduce-accumulator-copy`: no copy of the accumulator at every step. Mutate a local and
  return it.
- `no-reflect-apply`, `no-reflect-get`: typed calls and typed access.
- `no-runtime-typeof`: the predicates of `src/meta/json-shape.ts`. `typeof x === "undefined"` is
  allowed.
- `no-shape-in-symbol-names`: no name with the word "shape", "shapes" or "shaped" in it.
- `no-unknown-returns`, `no-unknown-type-aliases`: no `unknown` going out, as a return type or
  behind an alias.
- `no-unsafe-dictionary-type`: no `Record<string, unknown>` or `Record<string, any>`.
- `no-widen-then-assert`: do not declare a value wide and assert it back.
- `prefer-subpath-import` [fix]: the aliases of 12.1.
- `require-safety-comment-for-type-assertion`: every `as T` except `as const` carries a comment
  directly before the assertion or its statement, stating the invariant you checked:

```ts
// SAFETY: isManifest validated this two lines above.
const manifest = parsed as Manifest;
```

### 12.6 Core rules that trip most

- `typescript/strict-boolean-expressions`: a nullable string, number or boolean in a condition.
  The rewrites head 12.3.
- `typescript/no-floating-promises` with `ignoreVoid: false`: `void p` does not satisfy it.
- `typescript/no-misused-promises`: no async callback where a sync one is expected.
- `typescript/no-unsafe-*` and `no-explicit-any`: parse `any` before use.
- `typescript/no-non-null-assertion`: guard.
- `typescript/switch-exhaustiveness-check`: name every member of the union. A `default` does not
  satisfy it.
- `typescript/restrict-template-expressions`: no object or array inside `${}`. Render it first.
- `typescript/require-array-sort-compare`: a comparator for anything but strings. Where the order
  of strings is recorded or hashed, pass `compareCodeUnits`, as the source does.
- `typescript/prefer-nullish-coalescing`: `??` wherever the left side can be null or undefined.
  `||` survives only where it cannot.
- `typescript/only-throw-error`, `eslint/preserve-caught-error`: throw `Error`s, with the cause.
- `eslint/max-params` 5, `no-shadow`, `no-param-reassign`, `no-else-return`, `no-empty` (an empty
  `catch` needs a comment), `no-implicit-coercion`, `curly` for a body that spans lines.
- `unicorn/no-negated-condition`, `no-lonely-if`, `prefer-at`, `no-array-reverse` (where the
  result is used), `prefer-set-has`, `explicit-length-check`.
- `import/no-cycle`: move the shared piece down into a module both sides import.

`typescript/no-unnecessary-type-parameters` is off on purpose: `parseJsonAs<T>` and its kin carry
a contract the caller declares.

### 12.7 Rule pairs that pull against each other

Each pair has one spelling that satisfies both.

| The pair | The spelling |
| --- | --- |
| Tangled ternary against negated condition | Name the inner ternary in a `const`. Do not invert the outer test |
| Single-caller helper against thrice-spelled object or lookup chain | By count: at two uses inline, at three extract |
| Boolean parameter, `object` parameter and `max-params` | A string-literal union, or a named interface |
| Key-if-defined, empty-object spread and `exactOptionalPropertyTypes` | `keyIfDefined`, `keyIfNotNull` or `keysIf` |
| Filter-map against map-filter | `flatMap` returning `[]` |
| Strict-boolean against nullish-coalescing | `(n ?? 0) > 0`, with a `!== undefined` guard where later lines need the narrowing |
| Renaming temporary against a narrowing | A `const` read in a closure below a guard is exempt. Keep it |
| Deep nesting against function length | A guard is free for depth. When guards run out, split the function |

### 12.8 The owners in `src/meta`

Each runtime surface has one owner. Import from it; add a missing member beside the others.

| Need | Owner | Names |
| --- | --- | --- |
| Files | `filesystem.ts` | the `node:fs` surface; `mkdir`, `mkdtemp`, `readdir` and `rm` are the promise versions |
| Paths | `path.ts`, `path-containment.ts`, `path-segment.ts` | `join`, `resolve`…; `containsPath`; `isSafePathSegment` |
| The OS | `os.ts` | `tmpdir`, `homedir`, `loadavg`, `availableParallelism` |
| The process | `process.ts` | `runtimeProcess` in place of `process`, `parseArgs`, `capturedSpawn` |
| Subprocesses | `subprocess.ts` | `runSync`, `runTextSyncOrThrow`, `killProcessGroup`, `terminateAndReapProcessGroupId` |
| Host binaries | `host-tool.ts` | `hostTool("git")` |
| JSON in and out | `json-runtime.ts` | `capturedJsonParse`, `parseJsonAs<T>`, `capturedJsonStringify`, `capturedStructuredClone` |
| JSON types and predicates | `json-shape.ts` | `JsonValue`, `JsonObject`, `OpenRecord`, `isString`, `isNumber`, `isBoolean`, `isRecord`, `asRecord`, `isFunction` |
| Canonical JSON and hashes | `stable-json.ts`, `digest.ts` | `stableJson`, `canonicalJson`, `sameJsonValue`, `hashJsonValue`, `compareCodeUnits`; `sha256`, `sha256OfFile` |
| Caught values | `runtime-values.ts` | `errorMessage`, `asError`, `errorCode` |
| Optional keys | `optional-key.ts` | `keyIfDefined`, `keyIfNotNull`, `keysIf` |
| Text | `text.ts`, `bounded-text.ts` | `hasText`, `textOr`, `plural`; `boundText` |
| Counting and pooling | `tally.ts`, `pool.ts` | `countBy`, `median`; `pooled` |

Four `ana` rules name owners in their messages. Since 10 October every one they name is in this
tree (a fifth, `no-hand-read-controller-evidence`, named a v1 run's `opening.json` and
`terminal.json` and was removed: a v2 run is its log, opened through `tools/runs/`):

| Rule | It names | Here |
| --- | --- | --- |
| `no-hand-read-argv` | `.claude/skills/main/cli.ts` | Present. A skill script declares a `runCommand` spec, or passes its arguments to `parseOrDie` or `parseCommandOrDie`. The commands under `tools/` are outside the rule and parse with `parseArgs` from `#src/meta/process.ts` |
| `no-hand-spelled-git` | `.claude/skills/main/git.ts` for skills (`gitOutput`, `gitText`, `gitMaybe`); for `src`, no owner yet, and the message says that one belongs in `src/meta` beside `host-tool.ts` | Present. `src` spawns no git on 10 October, and the first site that does writes the owner there and adds it to the rule's `src` scope. `tools/` and tests are outside the rule |
| `no-hand-spelled-tree-root` | `campaignRoot()` and `campaignDir()` for `campaigns/`, `defaultProductDir()` for `domains/` | `src/meta/campaign-root.ts` is present, and v2 keeps a campaign under `.ana/d2/<name>` (`tools/d2/campaign.ts`) |
| `no-lifetime-outside-owner` | `stageCommandIsolation` (`src/verify/solve-command-isolation.ts`), `killProcessGroup` and `terminateAndReapProcessGroupId` (`src/meta/subprocess.ts`) | Present. The owner and its reader are the two files the rule exempts |

If a rule reports on your code and names an owner that is absent, do not obey a remedy that
does not exist. Retune the rule's source to v2's owner with a fixture for each side, in the same
change, as 12.2 allows.

### 12.9 The whole-tree scans

`bun run simplify` prints shapes that span files (`tools/oxlint/tree-findings.ts`). They report and
never block; `bun run commit:check` prints the ones on your changed lines. Treat each row as a
question, repair the true ones, and answer a false one in the ledger as `tree/<kind>`.

| Kind | Repair |
| --- | --- |
| `orphan-module`, `test-only-module`, `test-only-export` | Delete the code with its test, or wire it into a live path |
| `unread-field`, `unread-forward`, `unproduced-set-member` | Delete it, with the branch that handled it |
| `single-reader-export` | Move the one export into its one reader |
| `copied-block` | One owner for the block |
| `identity-without-owner` | One constant for the name |
| `superseded-schema-tag`, `compatibility-path` | Drop the old reader |
| `rule-without-fixture` | Add the fixture |
| `filesystem-import-budget` | None. It is a register: a file keeps its count of `filesystem.ts` imports, and a change adds at most one |

### 12.10 The size policy

`tools/loc/source-policy.ts` holds a file to 800 nonblank lines and a function to 115, over `src`,
`tools` and `vendor`, measured after formatting. It also reports an `export` that no other file
names, where a name spelled in a comment counts as a reader. `source-policy.json` lists
exceptions and is empty.

At PR #80 no package script, CI job or hook runs it, and run by hand it reports findings of all
three kinds in the existing tree: files over 800 lines, functions over 115, and unused exports.
Hold every new or rewritten file and function to the ceilings, add no finding, and do not add an
entry to `source-policy.json` to pass. There is no complexity gate in v2.

### 12.11 Per-path overrides

`.oxlintrc.json` changes the rules on three paths. `test/**` turns off `no-unsafe-*`,
`no-non-null-assertion`, `no-explicit-any` and `await-thenable`. `.claude/**/*.ts` turns off the
first three. `tools/oxlint/anti-slop/**` turns off `ana/no-inline-slop-answer` and lets a
`default` arm make a `switch` exhaustive. Two blocks that named trees v2 does not have,
`**/src/backends/oauth/**` and `packages/ui/**`, went on 10 October. These lists only shrink:
never add a file to one, and never widen a glob to take in the file you are editing.

### 12.12 Tests

- `bun:test`, in `test/`, one flat directory, named for the module they hold:
  `test/compare.test.ts` for `src/kernel/compare.ts`.
- Keep the positive case and the nearest hostile case in the smallest owning file. Add the case
  that is missing, and say in the pull request that the test fails when the change is removed.
- A test's name is a sentence about the system: "passes the plan's smallest wins at 0.10 and
  nothing one win short of them".
- No module mocks; inject through an interface. No fixed sleeps; wait on
  `Promise.withResolvers()` or poll with a deadline. Do not raise a timeout to hide a slow test.
- A model seat in a test is a script. `test/fixtures/` holds a fake Claude CLI and recorded SDK
  streams.
- A lint rule's fixture marks every declaration `// REPORT <why>` or `// ADMITTED <why>`
  (`test/helpers/oxlint-rule-fixture.ts`), so one text states both halves of the rule.
- A test that proves an export nothing else calls is what `tree/test-only-export` reports. Test
  the live path.

### 12.13 Adding or changing a lint rule

A rule lives in `tools/oxlint/ana/rules/<name>.ts`, is registered in `tools/oxlint/ana/index.ts`
and in `.oxlintrc.json` as `"error"`, and has a fixture test. Its head comment carries the
argument: the shape, its cost, what was measured and when, each exemption with the site that
forced it, and whether it fixes and why. A rule enters only when, at every site it reports, some
spelling passes every other rule; a rule whose remedy another rule refuses ends up switched off.
`tools/oxlint/FIXER-DECISIONS.md` states when a rule may carry a fixer, and
`tools/oxlint/BASELINE.md` and `SHAPE-RULESET.md` hold the measurements. Measure through
`bun run lint -c <one-rule config>`, never raw `oxlint`: a config without the type-aware option
reports zero and says nothing.

## 13. Writing

Plain, understated European English, in commits, pull requests, comments, prompts and messages to
the operator.

- State what changed and what remains, with exact results: "12 cases passed, 0 failed". No
  "robust", "bulletproof" or "10x", no celebration, no emoji, no exclamation marks.
- Say what a thing is. Prefer "one owner instead of five" to a sentence built on a negation and
  its correction.
- Separate what you verified from what you inferred, and say when a check was skipped. Every pull
  request says what was left undone and where each check ran.
- Use the fixed terms of section 14 with one meaning each. Suffix an ambiguous name with what it
  belongs to: "the Builder session b-2", "comparison g2", "the buffer campaign".
- A head comment explains why the code is as it is: the defect it answers, the record that showed
  it, and the date. It is the module's manual; keep it true in the change that alters the code.
- A prompt for an agent states facts and limits, each once, in the place that owns it: the system
  prompt for what holds all session, the opening message for the campaign's state, a tool result
  for what that call found. When the same interface failure recurs, fix the schema or the tool
  and do not add another sentence.
- A date is absolute: "9 October". Words such as "yesterday" go stale in a record.

## 14. Terms and map

### Terms

| Term | Meaning |
| --- | --- |
| Campaign | Everything run for one query: one domain, one contract, one check program, one log |
| Contract | The one public document: the rules, each with an id, and the answer format |
| Check | A hidden program that tests one rule on one answer and returns pass or reject |
| Instrument | The field's own tool that computes the facts a check compares |
| Control | An answer with a known label, used to test a check. The do-nothing answer, the smallest the format allows, is one for every task |
| Held-out task | A task the Builder never sees. Only held-out tasks are scored |
| Practice task | A task released to the Builder. Once released it is never scored |
| Valid answer | An answer that passes every check, submitted within the limits |
| Rejection | An answer at least one check rejects: a true fail when the answer is wrong, a check defect when it was right |
| Hand label | A person's verdict on one rejection: `earned`, `check-defect` or `unclear`; or on one answer that passed: `sound`, `wrong` or `unclear` |
| Reference harness | The harness a new one is compared with: the starter until a step is promoted |
| Comparison | Both harnesses solve the same held-out tasks; each task is a win, a loss or a tie |
| Round | One Builder session followed by one comparison. A session may also run by itself, with no comparison after it |
| Checkpoint | One comparison of two kept harnesses, with no session |
| Step | A comparison in which the new harness wins significantly more tasks than it loses |
| Setting | Who solves, under which limits, and which tasks are scored: recorded once in the log (section 6) |
| Condition | Everything that could change a solve's result, as one record with an id |
| Session | One bounded stretch of an agent's work: a Builder's ends with a frozen harness version |
| Trace | The record of one solve: every model turn and every tool call with its result |

### Map

```text
src/kernel/     the log, tasks, conditions, the verifier's contract, the comparison, the reports
src/solve/      one solve: the starter, the prompt, the command wall's tools, the answer file
src/builder/    a Builder session, its tools, prompt, notes and what it is told of the past; the round,
                and what the log holds of a comparison (comparison); whether a comparison may start
                (admission); the one reading of a campaign (handover);
                the move that follows from a log (decide) and the reading of the log it is asked
                of (ground), what a campaign runs by (opening), and the words the operator left
                it (word)
src/examiner/   an Examiner session, its prompt, and the outcomes it is told; the session that drafts
                an exam from a prompt (draft)
src/review/     the Referee, the Diagnoser, the probe, agreement with hand labels
src/verify/     the OS wall: Seatbelt, Bubblewrap, the disk cap, what each actor may read
src/backends/   the three model backends as one pi collection, and compaction
src/meta/       the owners of every runtime surface (section 12.8)
tools/c/        the check program: accept, carry, rejections, repaired
tools/d1b/      examine, draft
tools/d2/       campaign, setting, prepare, round, session, checkpoint, settle, promote, import; exam,
                which stages a drafted exam as a pack; close, which writes what a campaign hands
                over; harness-builder, which runs a campaign move after move; and word, which
                leaves the operator's word for one that runs
tools/runs/     launch, stop, rehearse, seed, pulse, view, compare, replay, zip
tools/wri/      the whole-run investigation's reader of one log: its folds and the exam side's lanes
                (folds), the other lanes, the rows and the overview (read)
tools/oxlint/   the two lint plugins, the ledger, the whole-tree scans
tools/runtime/  the lint and test wrappers, the commit check
tools/loc/      the size and unused-export policy
vendor/         pi-coding-agent and pi-claude-bridge, copied
docs/           the plan, the transfer ledger, the account of v1
.claude/skills/ the procedures (section 10), stack-pr, and main/ with the skill scripts' argument
                parser and git helper
.ana/           campaign logs and kept harnesses; ignored, and never edited by hand
```

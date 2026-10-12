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
| A prompt handed whole to another session: an audit, a review | `docs/prompts.md` |
| Where v2 stood at PR #91 and PR #168, with the three reviews of 9 October | `docs/plan-history.md` |
| What the code does today | the source at the stack's head, and the head comment of each module |
| How a procedure is carried out: stacking, launching, reading a run, wording a claim | the skill that owns it, under `.claude/skills/` (sections 10 and 11) |
| How code is written here so that it passes its checks the first time | `tools/oxlint/HABITS.md` (section 12) |

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
a loss or a tie for the new harness by its difference in pair wins, and a one-sided paired
sign-flip test over the tasks reads a **step** or none.

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
                       tally of wins, losses and ties ──► sign-flip test ──► reading
                            │
                       THE LOG   one append-only file a campaign; every state is a view of it
```

### The five success factors

Anabasis v2 is a training loop in which the thing trained is a harness and the loss is measured
by running a fixed model. Read that way its success factors are the ones every learning system
has: a training signal that carries information, a held-out set the learner cannot see, an
evaluation no noisier than the effect it looks for, labels that are correct, and a result that
transfers. Every session, pull request and run is judged against the five below, and a change
that moves none of them says what it moves instead. Each is a question, how it is measured and
its bar; the recorded values are the plan's (`docs/plan.md`, "Goal and the five factors"), and
nowhere else.

**1. Supply: is there gradient?** A comparison registers a difference only on a task where one
harness answers and the other does not. A task the reference solves in every attempt is a solved
example, and one nobody has solved is an unlearnable one: neither carries signal, and a scored
set made of them reads "no room" whatever the new harness is. The informative tasks lie between:
the reference answers them sometimes, or never while another harness has. In most learning the
data is fixed and the model moves; here the solver is fixed and the Examiner keeps the exam at
its frontier, told one outcome a task and nothing else. Measured as the informative tasks in a
comparison's scored set. Bar: at least four before each comparison starts. It binds first,
because every other number is undefined without it.

**2. Climb: does the learner improve?** The one quantity the system exists to move is the
reference harness. A promotion, a harness that beats the reference on held-out tasks by more
than chance allows, twice, on fresh solves, is one step of descent; a climb is several. Measured
as promotions a campaign, with the pairs the starter loses in each epoch beside it, which rise as
the reference improves. Bar: two promotions in one real campaign, the starter losing more pairs
after the second than after the first, then the same in a second domain. One step shows that the
loop can move; two show that it can move from where it moved to.

**3. Honesty: what is the false-positive rate of the test?** A test at level 0.10 is designed to
crown a winner between two equal harnesses about one time in ten, and the design value is a claim
until it is measured on the real solver, whose variance is unknown: the same harness fails a task
once and passes it next time. The measurement is an A/A test, built as the test is: the
reference's solves of a task split into two halves mirrored in time, tallied and tested as a
comparison is (`src/builder/comparison.ts`). At four solves a side every comparison carries one, on
the solves its test reads, two against two; at fewer, `--noise` on a checkpoint solves the
reference twice as often for it, a slot being the reference, the new harness and the reference
again (`src/builder/round.ts`). A step there is a false positive by construction. Its earlier solves against its later ones are kept apart as the drift, and how often
two of its solves of a task disagree as the flip rate. Bar: no step in the ten controls after the
six on record. Ten controls still bound the rate loosely. The same control gives the tie share, the
floor a real comparison has to beat before its wins mean anything. A campaign makes many promotion
attempts under one reference, and the level misstates even one: an attempt is two readings, and
at 0.10 the rule promotes equal harnesses 5.8% of the time on 24 untied tasks (`falseRate`,
`src/kernel/compare.ts`). Every reading prints that rate at its own margins, and a campaign's
opening says the union bound over its patience's attempts and the campaign command refuses one
past 10% (`openingLines`, `src/kernel/size.ts`): at 24 tasks, 0.10 and a patience of six that is
34.8%, so such a campaign names a patience of one or a level of 0.02. The climb reads what the attempts risk together as they come: one attempt's
rate bounded off pairs of controls read by the promotion rule, at 95% one-sided, or the level by
design before two controls, summed over the attempts (`falsePromotion`, `src/builder/climb.ts`).

**4. Verdicts: are the labels correct?** Validity is decided by a check program nobody has
audited against the field, and a check that rejects a right answer is label noise: in v1, 36 of
47 rehearsal misses came from a faulty check or instrument. The Referee is the noise filter
(`src/review/referee.ts`). It runs once for each answer a check rejects inside a comparison,
before the rejection counts, and never on a pass, a solve a limit cut or a crash; first the host
replays the checks on the logged answer, and a verdict that does not repeat is a check defect
ruled by the host. It reads the task with its hidden values, the public rules, the answer, the
rejecting checks with the fields each reads, the check program's source, a valid answer for the
task where one is on record, and a probe that changes one field and reruns the checks; never the
harness, the trace or anything the Builder wrote. It records one ruling (`referee.finding`):
`earned` must name the rule broken and the field that breaks it, both cited by a rejecting check;
`check-defect` must cite a probe that decided both sides on a field the check reads; `unclear` is
what is left, and a ruling without its evidence is refused. `earned` counts as a loss; the other
two set the task aside for both harnesses, so a broken check scores nobody. The Referee is a
model and is measured by agreement with a person who labels the same rejections blind
(`tools/d2/settle.ts`, `src/review/agreement.ts`): a three-by-three table of label against
ruling, read as two rates. Bar: on at least ten labels a kind, three in four of the rejections a
person calls a check defect caught, at most one in ten of those a person calls earned voided, and
three passes a comparison read by a person, since no seat reads an answer that passed.

**5. Worth: how large is the effect, does it transfer, and what did it cost?** A significant
step is not necessarily a useful one. Three numbers from one report say what a promotion is
worth: the effect size, the reference's share of valid answers on held-out tasks against the new
harness's at the full limit; transfer, the same harness on tasks written after it was frozen,
which is the only reading that separates learning the domain from learning the exam; and the
cost, in dollars and Builder sessions, of a promotion. None has a bar. Setting the three is the
operator's decision, and until it is made no promotion is called a result worth having.

Left out on purpose: the wall between the two sides is a correctness property, tested in the
suite as a byte-identical message under a changed hidden value, and is not optimised; the
Builder's practice results are excluded by rule 1, since a learner's score on its own training
set is the overfitting signal and not the metric; cost stands inside factor 5, since a cheap
system that does not climb has no cost worth reporting. The five are ordered by where they bind:
without supply there is no gradient, without climb no result, without honesty and verdicts no
result that can be believed, and without worth none that can be used.

### Two sides and one wall

The exam side knows what a right answer is. The build side tries to produce right answers. The
value of the measurement is that the second never learns the first, so the wall between them is
the system's main asset.

What crosses from the exam side to the build side is a closed list:

- the contract's public rules, its scope and conventions, the answer format and, where the check
  program declares one, the objective: the quantity and which way is better;
- the public part of each **released** (practice) task;
- for a practice solve: its ending's outcome and kind, the solver's trace and, where the
  contract states an objective, the measure the verifier took of a valid answer;
- for each comparison: the tally and the reading, with no task named.

Nothing else crosses: no held-out task, no trace of one, no check, no hidden value, no list of the
checks that refused an answer, and none of the Referee's reasons. Section 8 states this as a rule.

### What changed from v1

v1 is this repository's history before v2 took it over on 11 October 2026. Its last tree is
`5bc9988`, and `git show 5bc9988:<path>` reads a v1 file. v1 was itself built in a private
repository, harness-builder-v4, and published here as a squashed history, so a v1 commit that
`docs/transfer.md` cites, such as `7af7315`, is not in this one. Much of `src/meta`, `src/verify`,
`tools/loc` and `tools/oxlint` was copied from it at `3f93d06`, so its words still appear in
comments. A comment there that cites "AGENTS.md rule N" means v1's file, whose rules were
numbered otherwise. The design around the copied code is different.

| v1 | v2 |
| --- | --- |
| The Builder wrote the harness, the tasks and the checks | The Examiner writes tasks, the check program is fixed, and the Builder writes the harness only |
| A harness was scored on its own Builder's test set, as a pass rate | Two harnesses are compared on held-out tasks, as wins against losses |
| Every task carried an answer its author had found | No reference answers. A task is held out on the shape of its package and, where the host can have the reference harness solve it, only where some and not all of three fresh solves of it are valid (`try_task`); those solves are never scored |
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
| The comparison, the tally and the test | Why a practice solve failed, read from its trace |
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
2. **Give an author no target.** The Examiner is told no zone, share or target count. v1 measured
   why: an author told a zone, a share or a count wrote towards it, and one told each answer's
   distance from its limit moved the limits. It is told facts. Since 10 October it is told the
   budget every solve is held to, as a fact and not a target: a task that tells two harnesses
   apart is one a better method answers within that budget and a worse one does not, which
   nobody can write without knowing it, and ten campaigns' tasks tied without it. Since
   11 October, on the operator's decision of that day, it is told beside each task's one outcome
   the tasks counted by family, read from the same comparisons: how many were told apart and which
   side won them, how many tied with both harnesses valid in every solve, how many tied with
   neither valid in any and of those how many have a valid answer on record, how many tied
   otherwise and how many were set aside, with the solves a side they rest on and no number to
   reach (`src/examiner/record.ts`). Until then it heard one outcome a task and no count, and could
   not tell a tie that left no room from one nobody could answer. The other harness's result on
   any one task is still not told. The decision is untested, and two recorded counts would speak
   against it (`docs/plan.md`, row F60): the tasks the next Examiner sessions hold out falling
   more than three in four into one family where the exam held two or more, or the share of
   scored tasks tied with both harnesses valid in every solve not falling between the last
   comparison before a session was told counts and the comparison after the third such session.
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
   through the launch a seat's commands use, and need not prove its own identity. The source
   holds both on `main` at `524c589`: a seat's commands write one root, but for the host's own
   folder in it (`SolveDirs`, `src/solve/command.ts`; PR #203), and each policy is probed once a
   process by one command run as every command of a seat is run (`walledBase` and `probeWall`,
   the same file; PR #197).

## 3. The seats

Each seat has one job and a closed view. "Reads" is what the host hands it; "never" is what the
wall keeps from it.

| Seat | Job | Reads | Never | Source |
| --- | --- | --- | --- | --- |
| **Examiner** (model) | Writes task instances against a fixed contract and check program. For a campaign that opens from a prompt it first drafts that exam: the rules with their sources, the answer format, one check a rule, examples and controls | The contract, the operator's brief, the budget every solve is held to, examples, one outcome for each task of the campaign and whether a valid answer to it is on record, those tasks counted by family (since 11 October), what the last session said at its `finish`, and the home that session left; the checks, through `try_answer`, on an instance with an answer of its own. When it drafts: the operator's prompt, what the host's reading found in each draft, and a walled home of its own, empty at its start | A target, a harness's name, the other harness's result on any one task, a count of a task's valid solves beyond every, some or none, but how many of the reference harness's three solves of its own draft task were valid (`try_task`), and nothing else of those solves. It makes no solve of the exam's | `src/examiner/` |
| **Builder** (model) | Edits `harness/` in its home and ends with a frozen harness version | The public rules and the objective, practice tasks, practice results with their measures and traces, each comparison's tally, its own notes | A held-out task or its trace, a check, a hidden value, which checks refused an answer | `src/builder/` |
| **Solver** (model) | Answers one task: pi's coding agent with `read`, `bash`, `edit`, `write` and `submit` | The task's public part, the public rules, the harness's guide and programs, its limits and how much it has used | The checks and the hidden values | `src/solve/` |
| **Verifier** (code) | Runs every applicable check on one answer, each in a fresh cell inside the OS wall | The answer, the task, the check program, the installed engines | n/a | `src/kernel/verify.ts`, `src/verify/` |
| **Referee** (model) | Rules each rejection `earned`, `check-defect` or `unclear` before it counts | The verifier's side only: the task with hidden values, the rules, the answer, the refusing checks, the check program | The harness, the solver's trace, the Builder | `src/review/referee.ts` |
| **Host** (code) | Everything in the first column of section 2 | The log | n/a | `src/kernel/`, `tools/` |
| **Operator** (person) | See below | Every report and refusal | n/a | n/a |

The tools of each model seat, as its source names them:

- Examiner: `propose_tasks`, or `try_task` where the host can have the reference harness solve a
  draft task, `read_example`, `try_answer`, `bash`, `read`, `write`, `finish`. `try_answer` runs
  the checks on an instance with an answer of the Examiner's own and keeps nothing; the shell is a
  walled home of its own, empty at the session's start, and nothing in it enters the exam but
  through that one gate. In the session that drafts an exam:
  `draft_exam`, `bash`, `read`, `write`, `finish`, the shell the same kind of walled home
  (`src/examiner/shell.ts`), and nothing in it enters the exam but through `draft_exam`.
- Builder: `read`, `bash`, `edit`, `write`, `practice`, `read_trace`, `read_opening`,
  `check_harness`, `preview_harness`, `reset_harness`, `finish`.
- Solver: `read`, `bash`, `edit`, `write`, `submit`. Its answer is the file `answer.json`.
- Referee: `probe_check`, `read_check_program`, `record_ruling`.

Until 11 October a Diagnoser named the first wrong step of each failed practice solve for the
Builder; 20 of 20 of its readings named the solver, and the seat went (`docs/simplify.md`, E1).
A log of before keeps its `diagnosis.*` events.

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

Two of the seven are given once, for every campaign: the campaign command freezes an exam whose
reading holds no fault, and promotes the harness the rule names, without waiting. A campaign runs
unattended to a typed ending, as a goal runs until it is met (operator, 12 October, deciding
`docs/plan.md` row F29). `--attended` takes both back to the operator's word for one campaign,
which keeps it until `--no-attended`.
Admitting a check that has a fault, and going on past the stop rule, still take the word each time
(`--admit`, `--past-stop`).

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
one reading of its log (`campaignOf`, `src/builder/handover.ts`): each step's handover, which
`bun run runs view <name>` prints. The move that follows is one
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
| Next move | The one move the plan's table names, and its reason |

All of it is in the log already. One limit holds whatever is built: the Harness Builder may read
every step, and what it passes to the Builder stays the closed list of section 1. An overarching
agent that knew which held-out tasks were lost, and wrote freely to the agent that edits the
harness, would be v1's fault by another route. v1's Builder saw and wrote everything; one of its
harnesses passed 75 of 75 of its own tasks and 2 of 23 of a shared set.

A session that runs the loop stands where the controller stands, so the limit binds it. It
reads handovers from the log, it types nothing into a Builder session, and its reports reach no
Builder, Examiner or Referee. The controller's own reasons (`campaign.move`,
`campaign.ended`) are the operator's to read and enter no seat's message.

The Builder's side is meant to be one conversation for the whole campaign, kept by compaction as
v1 kept it. Both of v1's compaction modes are in the source: under the Claude backend the CLI
compacts at a pinned window (`SWEEP_COMPACT_WINDOW`, `src/backends/claude.ts`), and for the other
backends pi's loop compacts (`src/backends/pi-compaction.ts`). Each compaction is logged
(`build.compacted`, `solve.compacted`, `exam.compacted`). What a session has when the conversation
is lost is in the source too: the notes it carries (`src/builder/memory.ts`), and the list of
failed practice solves with each comparison's tally (`src/builder/past.ts`). On `main` at
`524c589` (11 October) every session is that case, since a session opens a new conversation: its
loop starts from the system prompt and the opening message alone (`src/builder/session.ts`).

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
4. **An old event kind stays readable.** The source keeps no compatibility paths (`tools/oxlint/HABITS.md`, 12.3), and
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
| 5 | `bun tools/d2/settle.ts ... --session b-1` | The comparison's packet: up to ten of its rejected answers and three of its answers that passed, drawn uniformly by its id, blind to ruling and harness. Answered, the person's labels and the report once more; a pass's label changes no reading. Until it is answered the report says `unsettled`, and no promotion waits for it |
| 6 | `bun tools/d2/promote.ts --name <name> --harness <digest> --yes` | The operator's word that a kept harness is the reference harness from there on (`harness.promoted`). Without `--yes` it says what the log holds of that harness and records nothing. A harness the rule would not promote takes `--despite "<why>"` |
| 6 | `bun tools/d2/import.ts --name <name> --harness <dir> [--note "<why>"]` | The operator's word that a harness built elsewhere, another campaign's handover or one written by hand, is one this campaign keeps (`harness.imported`): it is kept under its digest as a session keeps one, and `--parent`, `--reference` and `promote.ts` then name it. It is no session, so `latest` is unmoved |
| 7 | `bun tools/d2/close.ts ... --to <dir>` | Nothing. It writes what the campaign hands over, outside the repository: the reference harness as a directory that stands by itself, the public rules, and the closing report |
| all | `bun tools/d2/harness-builder.ts ... --budget <dollars> --builder <model> --examiner <model> --reviewer <model>` | What the campaign runs by, once (`campaign.opened`); then each move the table names, made by the command of its row above and recorded with its reason, when it began and, for a move that solves, the host's load then (`campaign.move`); and how the campaign ended (`campaign.ended`) |

### The campaign command

The last row is the Harness Builder's controller, which runs a campaign move after move. It asks
`decide` for the one move that follows (section 7, "What follows a reading"), prints it with its
reason, makes it by the command of its row, and reads the log again, until the campaign ends or
`--moves N` are made. `--dry-run` prints the move and makes none. A campaign freezes an exam
whose reading holds no fault and promotes the harness the rule names without waiting (section 3).
Under `--attended` it runs only once every fault of its checks is admitted, and it reports a step
read twice without promoting it, waiting there for `promote.ts`.

The skill `launch-run` says how it is started: niced, in a process group of its own, with its
output in two files and the key in Bun's own `--env-file`. Each solve waits for the host: a
solve of a Builder session or a comparison starts once the one-minute load is at or under the
cores, says so as it waits, and the wait is on record (`campaign.waited`, `tools/d2/host.ts`);
`--loaded` starts them all the same. Until 12 October the wait was at a move's start, and a
comparison of hours ran on whatever load came after it. Each run of
the command keeps a receipt beside the log, `launch-run-<n>.json` (`tools/runs/receipt.ts`):
its flags, the commit, whether the tree was dirty, and the load it started under, since the log
holds the host's code by content and no commit.

**It opens a campaign over a stored pack, or from a prompt** (`--prompt "<text>"` or
`--prompt-file <path>`, with `--solver`). From a prompt, the opening holds the prompt and the
first move is the draft of row 0. A draft stands once the host's reading without a model finds no
fault in it: its shape, a source on every rule, one check a rule, every control through the
checks twice, and the smallest answer the format allows refused on every example
(`draftReading`, `tools/d2/exam.ts`). What the reading cannot say is whether a rule is the
field's and its source real. Every check of a drafted exam is its author's own computation,
since nothing installs an engine of the field for a campaign, so its acceptance reading holds
one fault a check and the campaign ends on its exam there, once: the log holds `campaign.ended`
with the ending `exam`, and the command prints the `--admit` line to run. It goes on when the
operator admits the checks by name, which is rule 10's word: the command run again with
`--admit <checks>` reads the exam again and goes past that ending.

**Its budget is one total.** Each move's cap is what is left of `--budget` once every billed
dollar in the log is taken off, and the campaign ends on its budget where less is left than one
solve is held at (`--reserve`), or than the next comparison would bill by what the last one did
(`afforded`, `src/builder/decide.ts`): a comparison the cap cuts tallies nothing.

**It ends in one of seven ways**, and the log's last event says which (`campaign.ended`):
`budget`, `stop` (the stop rule, section 7), `exam`, `no-room`, `environment`, `operator` or
`control` (an A/A that read a step, section 7). A
move that threw after it began ends the campaign on its environment, and so do three Builder or
Examiner sessions in a row that the provider failed before they held out a task or changed a
harness (`crashedRun`, `src/builder/ground.ts`): such a session held out nothing because it was
refused a turn, not because the domain gave it none, so it is not an idle session for the
patience; one that held a task out and then crashed moved the campaign. Run again by its name, the campaign goes
on from its log, and the count starts afresh.
With `--handover <dir>` it then writes what it hands over (row 7): the harness is copied whole,
with the programs a kept state names by a link, and has to open there as the harness it was kept
as. The closing report is a view of the log, names no task and holds no check, and says what was
audited and what was not: what the Referee ruled, what a person's labels settled, how many
comparisons are still unsettled, and what a person read of the answers that passed in a packet
(`settle.ts`), or that nobody did.

**The operator steers a campaign that runs by leaving it a word** (`tools/d2/word.ts`), which
is one event in its log (`campaign.word`): `--stop "<why>"` ends it there with the ending
`operator`, `--tasks "<why>"` has an Examiner session write other tasks before anything else is
built or compared, and `--budget <dollars>` sets its total from there on. The command reads a
word at the next move's boundary and never inside a move (`pendingWords`, `src/builder/word.ts`),
waits for none, and the event that acts on a word names it (`answers`), so each takes effect
once. A stop followed by the same command is a pause. A word reaches no seat: no Builder,
Examiner, solver or reviewer reads it or its reason. `bun run runs stop` is the abrupt form: it
ends the process that writes the log, which writes no ending, and releases what its unfinished
solves and sessions held on the host.

### What the log records of a campaign's conditions

**The opening** (`campaign.opened`) keeps what the campaign runs by, so that its command goes on
by its name alone: the total and the reserve, the full limit of a solve, the Builder sessions
before a comparison (`--sessions`, 3), the patience (`--patience`, 6), who sits in each seat,
and the terms of its moves as a command last named them (`TERMS`, `src/builder/opening.ts`): a
session's limits, a comparison's size, the practice tasks and an Examiner session's. A term no
command named is its move's default. A later run that names nothing runs by the record, and one
that names another term records it again: these are the operator's conditions.

**The setting** (`campaign.setting`, `tools/d2/setting.ts`) is recorded once, by the first
command that begins a comparison or a Builder session, and does not change: who solves and under which limits, which
four flags name (`--solver`, `--solver-effort`, `--solve-minutes`, `--solve-model-turns`), and
which tasks are scored (`--tasks` or `--target`). The first command records what it names, with
the defaults for the rest. From then on a command that names nothing runs under the record, and
one whose flag names another is refused with both: another setting is another campaign. A
campaign whose solves were made before a setting was recorded has one all the same, the one its
last test-side solves ran under, and the first record is held to it (`firstRecord`). A solver
that is another model, at another effort or under other limits is another solver, and no solve
on record then counts.

**Practice follows the supply, and the outcomes.** One release takes at most half of what is
held, so a campaign that opens on a few tasks releases fewer than `--practice` names. Before a
Builder session the table has more released where tasks were held out since the last release,
and after a control that read room (section 7) it has as many again released. A release takes
first the tasks no solve answered in two comparisons, then half of the tasks the reference
harness failed in the last comparison, and the rest by the contract's draw
(`tools/d2/prepare.ts`): the tasks that leave the reference room are what a Builder has to work
on. A task that a comparison scored before its release keeps that comparison's solves on the
exam side: a Builder is shown its practice solves only (`practiceRan`, `src/kernel/solves.ts`).
Before a comparison the campaign holds as many scorable tasks as the comparison scores
(`--target`), or the Examiner writes more first.

### What refuses a move

Whether a comparison may start is one function's to say (`admission`,
`src/builder/admission.ts`), and a round or a checkpoint asks it before its first event, whether
the campaign command made it or a hand started it. It refuses, among others: a log with no
held-out task; a comparison that would leave fewer untied tasks than a first reading takes at
its trigger (`sweepOf`); a comparison with no `--cap`; a checker that nobody has read; a campaign the stop rule has
stopped, unless `--past-stop "<why>"` gives the operator's reason, which is logged
(`stop.overridden`). A Builder session by itself asks its own (`admitSession`): a cap, a checker
that has been read and the stop rule; and the session refuses a `--session` whose Builder started
and did not end whole (`spent`, `src/builder/session.ts`). What goes on unasked is what the log holds the start of, of its own kind: a comparison
that began, or a session that began. A command writes nothing before its last refusal: the
admission's, then the comparison's own terms, and only then an override of the stop rule and the
campaign's setting. A comparison that reported is finished, and run again says what it said. A
rehearsal is exempt by name: its seats are scripts, which are paid nothing.

The other verbs over a campaign's log:

```text
bun run runs rehearse [--no-comparison] <the flags of tools/d2/round.ts that name no model>
bun run runs rehearse --campaign <the flags of tools/d2/harness-builder.ts that name no model>
bun run runs view <name> [--level N] [--trigger N] [--target N] [--practice N] [--past-stop "<why>"]
bun run runs pulse | stop <name> | replay | seed | zip
```

### Defaults, and a first flag line

Defaults worth knowing: 12 scored tasks (`--target`), 2 solves a side (`--solves`), level 0.10
(`--level`) and trigger 0.25 (`--trigger`), an objective margin of 0.01 (`--margin`), a stop past
3 tasks with a check defect (`--defects`), a reserve of 10 dollars a solve (`--reserve`),
`--parent latest`, `--reference promoted`, which is the harness last promoted and the starter
until one is; a Builder session of 240 minutes, 300 turns and 24 practice solves; a solve of
120 minutes and 24 prompts, with the model's own turns unlimited until `--solve-model-turns`
names a number. An Examiner session ends when the Examiner calls `finish` a second time, or a
first time once the host has the tasks it asked for: what the campaign is short of a comparison's
target and of its practice (`examTasks`, `tools/d2/harness-builder.ts`), or `--exam-tasks` where
the operator names a count. A first `finish` short of them is declined once, with the need and
no count, since every live session of 9 and 10 October proposed one batch of one to three tasks
in three turns and finished. The session's home is carried whole into the next session's, and
what it said at its `finish` opens the next (11 October).

Two of them need a word for a small campaign. The reserve is what one solve is held at before it
starts, and a campaign ends where less of its total is left than that: set `--reserve` to about
what one solve of the solver bills, which the log of any earlier campaign under the same solver
says (`solve.finished.billed`). With `claude-api/claude-sonnet-5-5` at high on tasks a program
answers, 10 October: a solve 0.01 to 0.05 dollars, a Builder session 0.02 to 0.25, an Examiner
session 0.12, a draft 0.15 to 0.19, and a campaign of two comparisons of 5 or 6 tasks at 2 or 3
solves a side 2 to 5 dollars in all. One flag line that ran a small campaign from a prompt to a
typed ending on 10 October, for a first campaign to start from:

```text
bun tools/d2/harness-builder.ts --name t-9 --prompt-file <file> --budget 6 --reserve 0.05 \
  --builder claude-api/claude-sonnet-5-5 --examiner claude-api/claude-sonnet-5-5 \
  --reviewer claude-api/claude-sonnet-5-5 --solver claude-api/claude-sonnet-5-5 --solver-effort high \
  --solve-minutes 8 --solve-model-turns 10 --solves 2 --target 8 --practice 3 \
  --minutes 20 --turns 60 --practice-solves 6 --exam-tasks 10
```

What these commands and flags replaced, and when, is in `docs/simplify.md` (packages A, B and
D) and `docs/plan-history.md`.

## 7. How a comparison is read

`src/kernel/compare.ts`, `src/builder/round.ts` and `src/builder/comparison.ts` own this, and their
head comments are the full account. The short form follows.

**Terms first.** A comparison writes `comparison.started` before its first solve: its two
harnesses, its setting, its scored tasks, its solves a side, its level, its objective rule, its
dollar cap and, where given, its prediction (`--predict`). One continued from its log keeps those
terms, and one asked for again on other terms is refused. The scored tasks are `--target` of the
held-out ones, the newest epoch's first and within an epoch drawn by the contract's hash, less
two kinds the draw leaves out: a task with no valid answer after two comparisons, until a person
labels it (`awaitingLabel`), and one the reference harness answered in every solve of two
comparisons, on whichever side it stood, which can only tie again or be lost (`exhausted`); a task
the objective told two valid answers apart on is not closed, since the next harness can still win
it. A third of the closed ones stays in by a hash of its own, so that a harness that breaks what
the reference answers still shows its losses. The Examiner is told such a task is exhausted, in
those words.

**Fresh solves.** Each scored task is solved under each harness, afresh. A task's solves run
together, the tasks in an order a hash of each draws, and within a task the harness that goes
first is mirrored, so what drifts over a comparison's hours falls between tasks, which the test
does not read. A solve counts only when its start names the comparison. No earlier solve
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
comparison, fixed at its start; a check program that declares none pairs on validity alone.

**The test.** A one-sided paired sign-flip test reads each task's difference in pair wins
(`flipP`, `src/kernel/compare.ts`): were the harnesses interchangeable each untied task would be as
likely won as lost by its margin, and p is the share of the signs that sum to at least what was
read. It is exact, and where every task is won or lost by as many pairs it is the sign test. The
step is read on the **frontier**, the scored tasks not exhausted; the **retained** tasks, fixed
with them at the comparison's start from the exhausted third the draw keeps, may not lose more
pairs than they win, and an empty retained set reads `unmeasured`, never no loss. Each family's
tallies stand beside both, from the same rows; they show concentration, and establish no
independence. The test runs in two stages: a comparison whose frontier is at or under the trigger
(0.25: 2 to 0, 4 to 1, 5 to 2, 7 to 3 where every task is won by as many pairs) buys the repeat
and promotes nothing, and the step and its repeat read together clear the level (0.10: 4 to 0, 6
to 1, 7 to 2, 9 to 3), the repeat having untied a task and won at least as many pairs as it lost,
neither stage losing on its retained tasks, and their untied tasks not all in one family of two
or more (`readTwice`). Every reading prints its untied count, the least share of them it detects
four times in five (`detectable`), and the chance an attempt at its margins promotes equal
harnesses (`falseRate`). A reading under the trigger counts for the
stop rule as a move that showed a gain. Both terms are recorded in the campaign's opening, so a
campaign reads by its own rule whatever the tree's default. Two other readings of a tally are in
the plan ("Statistical power and cost") and neither is built.

**The reading** is one of five words (`Reading`, `src/builder/comparison.ts`):

| Reading | Meaning |
| --- | --- |
| `step` | The test cleared its level |
| `no-step` | A test was made and did not clear its level |
| `regressed` | The frontier cleared its level and the retained tasks lost more pairs than they won. It promotes nothing |
| `narrow` | The frontier cleared its level and its untied tasks all fall in one family of the two or more the set holds. It promotes nothing; the repeat draws other families where supply allows |
| `not-scored` | No task was tallied, or the cap cut the test short. Nothing was tested |
| `check-defects` | The comparison stopped on its check defects |
| `no-change` | The session left nothing new to compare |

`not-scored` and `no-step` are different results. Eight rounds on 8 October scored no task and
were recorded as `no-step` eight times, for over 220 dollars, before the two were named apart.
A log of before 11 October may hold `below-starter` or `starter-unread`, readings of a step
against a promoted reference that also solved the starter (`docs/simplify.md`, B2); the starter
is now the control the tasks written after a promotion are read with (below).

**Rejections.** A rejected answer counts as not valid only once the Referee has ruled it `earned`,
which it can only on a probe that moved a refusing check off its refusal (`src/review/referee.ts`).
A ruling of `check-defect` or `unclear`, or no ruling, sets the task aside for both harnesses. A
person's labels then settle it (`settle.ts`), and a label stands over a ruling. Past `--defects`
tasks with a check defect or a check that could not run, the comparison stops, since the check
program then needs its owner before more is spent.

**The budget.** A campaign runs at one budget, the one its setting names. The binding unit is
the model's own turns, told to the solver on every tool result and enforced
(`--solve-model-turns`; a solve that uses them without an answer ends `turns-ended`), and the
wall of a solve (`--solve-minutes`). A time limit on each command bounds a turn. The prompts a
solver is given before a solve stops with no answer are every solve's (`LIMITS.turns`, 24) and
bound no solve on record. A comparison is read at the one budget its solves were told: a
reading at a shorter budget would be of a solver that was told the longer one (on 9 October the
starter answered 0 of 10 solves read at two turns, and 10 of 10 once it was told two).

**Beside the test.** The report holds how each harness did by itself (`valid`: on how many tasks
every solve, some or none were valid), which tasks entered each of its two sets, and its overlap
with the comparison of the same two harnesses before it. The reference read against itself on
halves of its own solves mirrored in time stands beside every comparison of four solves a side, and
`--noise` on a checkpoint gives one at fewer; it should read no step, and its tie share is the
noise every comparison has to exceed, its flip rate how often two solves of a task disagree, and
its drift its earlier solves against its later ones. The epoch's first is its control: read
two-sided at the comparison's level, since which half is which is arbitrary, a step there either
way ends the campaign on its control, as its two sides are not interchangeable, and no comparison
against that reference reads anything until the operator leaves the cause on record
(`tools/d2/word.ts --cause`); run again, the campaign goes on. The A/As after it stand as readings.

**The dollar cap.** `--cap` is required. Before each solve the billed dollars of the comparison
are summed from the log, and the solve does not start when a reserve for it and for every solve
in flight would pass the cap.

**Room.** A comparison's report says what room a harness has to gain in (`roomOf`,
`src/kernel/reports.ts`): none where the reference harness was valid on more than three solves
in four, so that its tasks could mostly only tie; too hard where neither harness was valid on
one solve in four; and room otherwise. The two shares (`ROOM`) are the plan's proposal and the
operator's to set. The two ways to room are the tasks and the objective.

**After the test.** A comparison that wrote its report is finished: run again, it returns that
report. The stop rule is as many moves in a row that could have shown a gain and showed none as
the campaign's patience (`stopRule`, `src/kernel/reports.ts`; `--patience`, six by default
while the system is built, since every campaign of 9 and 10 October ended on the plan's three
before its tasks were measured). A move that counts is one of two: a harness a session changed,
once against one reference and read by the last comparison of the two, where that comparison
tallied a task and left room; or a whole session that left its harness as it was where a
practice solve of it failed, since a session whose every practice solve passed had nothing to
work on. A repeat, a control, a comparison that scored nothing or left no room do not count.
The next comparison or session is then refused, unless the operator gives a reason to go on
(`--past-stop`). A task with no valid answer in two comparisons goes to a person as possibly
infeasible, unless a valid answer for it stands anywhere on record, a solve's or the one the
host saw its author's `try_answer` pass before the proposal (`task.proposed.feasible`), or a
limit cut its solves (`awaitingLabel`). Promotion is the operator's `promote.ts --yes`, which
writes `harness.promoted`. A comparison that names no `--reference` is made against the harness
last promoted, and one that names a digest is made against that harness and promotes nothing.

**What follows a reading** is move 7's to say (`decide`, `src/builder/decide.ts`), and the view
prints it as its last line. In the order the table asks:

1. A word the operator left, where nothing has acted on it.
2. The exam: a draft where the campaign opened from a prompt, a reading of a checker nobody has
   read, and an ending where the reading holds a fault that nobody froze or admitted.
3. The tasks: a pack's taken in, practice released, and tasks written where the campaign has none.
4. The budget, the provider (three sessions in a row crashed before they held out a task or
   changed a harness, section 6) and the stop rule, which end the campaign.
5. A comparison that began and has not reported goes on.
6. The reference's room on the tasks, read from the last comparison it was in, whichever side
   it took: where it answered nearly all of them, the Examiner writes tasks it fails. After a
   promotion that reading is the comparison the harness was promoted on; the row is the same at
   every epoch, and nothing in the table or in any seat's prompt is a promotion's own. Tasks
   held out since the last comparison, where no session has left a harness but the reference,
   are read by a **control** before a Builder session is paid for: the starter compared with the
   reference on them, which says whether they leave the reference room. With room the Builder
   builds, on practice brought up from those tasks; without it the tasks change again.
7. A step under the trigger is one draw: the same two harnesses are compared again on fresh
   solves, and the two read together name the harness to promote (`unpromoted` says why another
   is not). The repeat draws the held-out tasks the first stage did not score first, where the
   campaign holds them (`firstStageOf`, `src/builder/round.ts`).
8. No step with room sends the Builder to build again, once the next comparison has tasks to
   untie: where the reference answered too many of them in every solve, the Examiner writes
   tasks first, since a changed harness can only tie again on those. No step without room, or
   where neither harness answered, sends the Examiner for other tasks: there is no shorter budget
   to fall back to.
9. Nothing new to compare: the Builder builds, once the campaign holds as many scorable tasks as
   a comparison scores; before any comparison the Examiner writes the rest first, so that the
   release before the first session has them to draw practice from. Something new: it is
   compared once the sessions before a comparison have run, or tasks are written first where the
   comparison would be short of them.

The campaign ends `no-room` after more comparisons of one harness without room than its
patience, or as many Examiner sessions in a row that held out no task where they were asked for
room; where they were asked for tasks, as for a campaign that holds none, it ends `exam`.

## 8. Rules

Cite a rule by its number in a pull request or a review.

1. **The comparison decides, and nothing else does.** A harness is better when a comparison reads
   a step. A practice result, a Builder's account, a reviewer's opinion and a passing
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
    the answer. The reading names each check's instrument by the tools it runs, or `author`, so an
    exam no engine decides, as every drafted one, waits for the operator's word on each check.

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

Read on `main` at `524c589` (11 October), three designed parts are absent from the source. Check
the plan and the head before relying on this list, and delete a line here in the change that
makes it false:

- the Judge: the Referee has a probe and no shell, reads the check program, and is unmeasured
  against hand labels. No seat reads an answer that passed: a person reads three in each
  comparison's packet (`settle.ts`);
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
- A Referee's ruling is a model's output. Keep it apart from the verifier's verdict and from a
  fact of the environment.
- A session report or a subagent's report is a lead. Check a finding against the source before
  acting on it or repeating it.

A negative claim about capability, such as "nothing checks X" or "the admission does not refuse Y",
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
| Reading the harnesses a campaign keeps, before a promotion or a handover | `harness-audit` |
| Handing runs, or a question, to someone outside | `zip-run`, `oracle-handover` |

`/goal` (`.claude/commands/goal.md`, kept from v1) carries one objective of the operator's across a
session's turns. It states the contract, measures the position on evidence and names the next step,
until every result has current evidence or one action needs new authority. The product runs the same
way without a command: a campaign goes on to a typed ending (section 3), and each Builder
continuation restates its goal (`src/builder/prompt.ts`).

What holds in all of them:

1. **The worktree is the condition.** A run executes the source of the worktree it started in.
   Launch from a clean worktree at a published commit, kept for that run alone. Do not edit
   `src/` there while the run lives, and never move a campaign's folder to another worktree.
2. **Prove the path first, without a model**: a dry run of the campaign command
   (`bun tools/d2/harness-builder.ts --name <name> --dry-run`), a replay for a changed reader
   (`bun run runs replay`), a rehearsal over a seed for a changed round or campaign
   (`bun run runs seed`, `bun run runs rehearse`).
3. **Put one prediction on record before the first solve** (`--predict`), written so that a
   recorded count settles it. One written after the first solve started is a description. The
   campaign command takes no `--predict`, since its comparisons are the table's: a prediction for
   a campaign is written in the ledger of the session that starts it, before the first solve.
4. **One or two rounds at a time on one host.** A wall counts the clock, and a loaded host moves
   every solve's time.
5. **Never open, print or copy the file passed as `--env-file`**, and name no account or
   credential path in anything that is published.
6. **Do not stop a run to fix it.** Work found while a run lives is work for the next start.
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
npm or npx. `src/meta` wraps the few Node surfaces Bun lacks (`tools/oxlint/HABITS.md`, 12.8).

| Command | What it does |
| --- | --- |
| `bun run typecheck` | `tsc --noEmit` over `src`, `tools`, `vendor` and `test` |
| `bun run lint` | Oxlint, type-aware, with the two repository plugins and the not-slop ledger applied. `-- --strict` makes plugin findings fail the run |
| `bun run format` / `format:check` | Biome writes, or checks |
| `bun run test -- <paths...>` | The suite through its wrapper. Never bare `bun test` |
| `bun run simplify` | The whole-tree scans, as a census to read |
| `bun run not-slop` | The ledger of answered findings: status, `-- answer <id> "<why>"`, `-- prune` |
| `bun run gate` | The gate in one command: a frozen install, the format check, typecheck, the strict lint and the suite. `-- --static` runs the tests one import from what HEAD changed in place of the suite |
| `bun run hooks:install` | Points this clone's `core.hooksPath` at `.githooks`, once; every worktree shares it |
| `bun run commit:check` | What the pre-commit hook runs, and by hand: author email, format and lint of staged files, the slop report, the secret scan |
| `bun run secrets` | The secret scan |
| `bun run runs <verb>` | `pulse`, `stop`, `rehearse`, `seed`, `replay`, `zip`, `view` |
| `bun .claude/skills/stack-pr/scripts/stack.ts` | The open stack: every edge, and the top |
| `bun run land -- <pull request>` | Proves every commit a landing would publish where it sits; `--sanitize` posts each verdict, `--merge` also merges ("The stack and pull requests") |
| `bun tools/loc/source-policy.ts` | The size and unused-export policy. No package script, CI job or hook runs it (`tools/oxlint/HABITS.md`, 12.10) |

The gate is what CI runs, and `bun run gate` runs it: CI's Darwin job in one command, cheapest
step first. The strict lint fails on everything a plain one does, so it runs once. Run it before
any delivery a push does not cover.

**Keep the hooks enabled.** `bun run hooks:install` sets them up once per clone; without it a
commit goes unchecked and a push ungated, and nothing says so (`git config core.hooksPath` tells
which). The pre-commit runs `bun run commit:check`. The pre-push gates the work a push adds
(`tools/runtime/pre-push.ts`): each new commit gets the static steps and its nearby tests over a
checkout of its own, and the pushed head holding the newest of them the whole gate. A push of
documentation alone gets `git diff --check`. A pass is remembered by commit id, and a failure names
the commit, the step and the `--fixup` that repairs it; its log is under
`git rev-parse --git-path ana-gate`.

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
before you push. Until 11 October v2's work was one linear stack of open pull requests; PRs #219
and #221 merged the whole of it into `main` that day. A new subject is now a pull request on
`main`, from a worktree of its own at `origin/main`, and the stacking rules below hold where one
pull request depends on another that has not merged: there the top is that pull request's branch,
and elsewhere it is `main`. Several sessions write at once. v2 was built in `s-smits/anabasis-v2`
until 11 October 2026, when it took over this repository, v1's: a pull request number in text
written before then, up to #235, is that repository's, while this one's own run to #140 for v1
and go on from there. New text that cites one of v2's names it `anabasis-v2#N`. A cited v2 hash
that does not resolve here was on one of that repository's pull-request branches, rewritten
before it merged. What it comes to:

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
- **Every commit passes alone.** Fold a fix into the unpublished commit it corrects. The
  pre-commit hook runs `bun run commit:check`; run it by hand where the hooks are not installed.
- **Push your own branch**, never `main`, never with `--no-verify`. A rewrite of a published
  branch takes `--force-with-lease` on the head you last saw. Keep the hooks enabled
  (`bun run hooks:install`). The pre-push hook gates the commits along each pushed head's first
  parents that no remote-tracking ref holds. One whose patch the replaced branch held is a
  rebase's replay, left to `bun run land`. A history brought in through a merge's other parent was
  made elsewhere and is only counted; the merge itself is gated. v1's hook gated every commit new
  to the remote, which for PR #141 meant 448 commits, 444 of them v2's history merged in.
- **Merging is the operator's call**, and so is a restack of the whole stack. A stack lands
  through `bun run land -- <top> --merge` (`tools/runtime/land.ts`), never through a local merge
  pushed to `main`, which leaves the pull requests open. It reads the chain of bases down to
  `main`, requires each head to contain the one beneath it, and proves every commit it would
  publish over its own checkout, the top's head with the whole gate. `--sanitize` stops there and
  posts each verdict as the status `ana/commit`. `--merge` also waits for `ci.yml` on the top's
  head, posts `ana/stack-gate` on every head, and merges bottom-up, each pull request based on
  `main` just before its merge and pinned to its gated head.

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

Name what misbehaves: the campaign command, a round, a reader, the Builder. The file that holds it goes in
the evidence beneath. A change with no defect behind it says so in one line. Rewrite the body
after every push that changes the pull request.

### Reviews and subagents

Launch parallel subagents from the current session in one message, one bounded task each, with no
coordinator. Each prompt names its authority, the exact paths and commit, the observed facts, the
question and the required output, and says read-only unless the operator asked for changes. Give a
reviewer the code and not your conclusion. Check every finding you act on against the source.

## 12. Code that passes the first time

Most lint findings here are preventable by habit, and the habits are `tools/oxlint/HABITS.md`:
the compiler's settings, how lint runs and what to do with a finding, the rewrites that pass the
first time, the two plugins' rules, the owners in `src/meta`, the whole-tree scans, the size
policy and how a test is written. Read it whole before the first line of code, and not for a
change that writes none. What holds whatever is written:

- The gate is what CI runs (section 11), and a strict lint for the files changed:
  `bun run lint -- --strict`. Work in strict mode; add no finding, and give the strict count in
  the pull request.
- Never turn a rule off: no new `"off"` in `.oxlintrc.json` and no `oxlint-disable` comment for
  a plugin rule. A finding that is wrong about a site is answered in the ledger or by tuning the
  rule (`HABITS.md`, 12.2).
- Every runtime surface has one owner in `src/meta` (`HABITS.md`, 12.8); `node:` is imported
  nowhere else.
- A file is at most 800 nonblank lines and a function 115, and an `export` has a reader in
  another file (`bun tools/loc/source-policy.ts`, which reports vendor only).

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
src/examiner/   an Examiner session, its prompt, and the outcomes and counts it is told; the
                session that drafts an exam from a prompt (draft); the walled home both
                sessions have (shell)
src/review/     the Referee, the probe, agreement with hand labels
src/verify/     the OS wall: Seatbelt, Bubblewrap, the disk cap, what each actor may read
src/backends/   the three model backends as one pi collection, and compaction
src/meta/       the owners of every runtime surface (`tools/oxlint/HABITS.md`, 12.8)
tools/c/        the check program: accept, carry, rejections, repaired
tools/d1b/      examine, draft
tools/d2/       campaign, setting, prepare, round, session, checkpoint, settle, promote, import; exam,
                which stages a drafted exam as a pack; close, which writes what a campaign hands
                over; harness-builder, which runs a campaign move after move; and word, which
                leaves the operator's word for one that runs
tools/runs/     stop, the receipt, rehearse, seed, pulse, view, replay, zip
tools/wri/      the whole-run investigation's reader of one log: its folds and the exam side's lanes
                (folds), the other lanes, the rows and the overview (read)
tools/oxlint/   the two lint plugins, the ledger, the whole-tree scans
tools/runtime/  the lint and test wrappers, the commit check
tools/loc/      the size and unused-export policy
vendor/         pi-coding-agent and pi-claude-bridge, copied
docs/           the plan, the transfer ledger, the account of v1, the helper prompts
.claude/skills/ the procedures (section 10), stack-pr, and main/ with the skill scripts' argument
                parser and git helper
.ana/           campaign logs and kept harnesses; ignored, and never edited by hand
```

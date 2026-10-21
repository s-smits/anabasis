# AGENTS.md

This is the working contract for coding agents in this repository: Claude Code, Codex and their
subagents. Claude Code reads it directly, and a `CLAUDE.md` beside it is the operator's own.

It holds what stays true from one pull request to the next: what the system is for, who decides
what, how a result is read, and how to write code here that passes its checks the first time. It
keeps no queue and no status. Those live elsewhere:

| Question | Owner |
| --- | --- |
| What is designed, in what order, and how far each part has got | `docs/plan.md`: the four factors' values, the open rows with their level, the tuning, the open decisions |
| What came over from v1, and what was replaced or dropped | `docs/transfer.md` |
| What v1 measured, and why it did not climb | `docs/v1.md` |
| A prompt handed whole to another session: an audit, a review | `docs/prompts.md` |
| How Anabasis is measured outside a campaign: against another system on a benchmark, or with one mechanism switched off | `studies/<name>/README.md`, each a protocol written before its first solve (`studies/README.md`) |
| The plan until 20 October, its history and the simplification plan of 11 October | `git show 7f0add79:docs/plan.md` (and `plan-history.md`, `simplify.md`); a comment that cites `7f0add79:docs/<file>` means that text |
| What the code does today | the source at the stack's head, and the head comment of each module |
| How a procedure is carried out: stacking, launching, reading a run, wording a claim | the skill that owns it, under `.claude/skills/` (sections 10 and 11) |
| How code is written here so that it passes its checks the first time | `tools/oxlint/HABITS.md` (section 12) |

Where one of those disagrees with this file, the newer evidence wins. A sentence here whose
mechanism has left the source is dead text: say so, and correct it in the change that found it.

Do the task. When something is ambiguous, take the most reasonable reading, say which one you
took, and carry authorised work through implementation, checks and delivery, the findings of
your own reviews and subagents included once you have checked them. An audit, a review or a plan
asked for on its own stays read-only until the operator asks for the change. Ask only for a
decision that belongs to the operator (section 3 lists them) or for a missing permission, and ask
with the reviewable result ready.

## 1. What Anabasis v2 does

One query names one technical domain. A campaign builds one **Built Harness** for it (a harness,
for short): the guide and the programs a solving model uses to answer that domain's tasks. The
**solver** is that model, and it only ever answers from inside a harness: a solve is the solver
and one harness working as one system. The campaign's setting fixes the solver, and the harness is
the part that is built, compared and promoted. So two systems in a comparison differ only in their
harness, and whatever one of them wins, its harness won. Every mechanism in the repository serves
one question:

> Is the new harness better than the reference harness, for this solver, on tasks neither was
> built on?

A comparison in code answers it. Both harnesses solve the same held-out tasks afresh, under the
same limits. A hidden check program decides whether each answer is valid. Each task then counts as
a win, a loss or a tie for the new harness, by its difference in pair wins, and a one-sided paired
sign-flip test over the tasks reads either a **step** or nothing.

```text
                        OPERATOR   freezes the exam, sets the dollar cap, labels answers blind
                            │
   EXAM SIDE                │                      BUILD SIDE
   Examiner (model)         │                      Builder (model)
     writes tasks           │                        edits harness/, practises on released
   Contract                 │                        tasks, ends with a frozen harness version
     public rules, format   │                              │
   Check program + engines  │                              ▼
     hidden from every      │                      Solver (model) inside the harness, one system
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

### The four reported factors

Anabasis v2 is a training loop where the thing being trained is a harness, and the loss is
measured by running a fixed model. Seen that way, it needs what every learning system needs: a
training signal that carries information, a held-out set the learner cannot see, an evaluation
less noisy than the effect it looks for, correct labels, and a result worth what it cost. The
first of these, supply, is a condition a comparison must meet before it is admitted. The other
four are reported: climb, honesty, verdicts and economy. Every session, pull request and run is
judged against them, and a change that moves none of them says what it moves instead. Below, each
is a question, how it is measured, and its bar. The recorded values live in the plan
(`docs/plan.md`, "Goal and the four factors") and only there.

**Supply, the condition before the four: is there gradient?** A comparison can only register a
difference on a task where one harness answers and the other does not, or, where the contract
declares an objective, where one answers better by it. A task the reference solves every time,
with no better answer on record, is a solved example, and a task nobody has solved cannot be
learned from. Neither carries signal, and a scored set made of them reads "no room" whatever the
new harness is like. The informative tasks lie in between (`informative`,
`src/kernel/compare.ts`). The reference answers them:

- sometimes;
- never, while a valid answer is on record (another harness's or the task author's);
- every time, where an answer on record beats one of its answers by the objective, by at least the
  room floor of the larger measure (another of its own, the other harness's, or the author's;
  `ROOM`, 1%).

In most learning the data stays fixed and the model moves; here the solver stays fixed and the
Examiner keeps the exam at its frontier. It is told what the reference did on each task and, unless
the campaign's term `exam-results` is `off`, which harness won it in the last comparison
(section 3). Supply is measured as the number of
informative tasks in a comparison's scored set. Bar: at least four before each comparison starts.
It is not reported as a factor, because passing it only says a comparison can show a difference,
and says nothing about whether one was shown. It binds first, because every other number is
undefined without it.

**1. Climb: how much ability has accumulated?** The one quantity the system exists to move is the
reference harness. A promotion is one step of descent: a harness that beats the reference on
held-out tasks by more than chance allows, in one comparison on fresh solves. A climb is several
of them, read as promotions within one campaign (`src/builder/climb.ts`); promotions added up
across campaigns are no climb. Every draft that the reference answered in none of its admission
solves, but whose author's own answer passes on it (`task.feasible`), is held out like any other
task (`try_task`, `gated` in `src/examiner/write.ts`). A task the reference never answers while a
valid answer is on record is exactly the room a promotion leaves, and so is a draft the reference
answers in every solve where the author's answer beats one of the reference's on the objective
(`informative`, `src/kernel/compare.ts`). An older log's `ladder` tasks read as held out, and its
ladder readings drive no decision (`lastReports`, `src/kernel/reports.ts`).

An author's passing answer proves the answer passes the checks on the hidden values. It does not
prove the public input is enough to derive that answer, so a held task no reference ever answers
may be hard or may be underspecified, and no reading can tell which until a person reads it.

A small movement is read against the solver's measured variation before it is called a gain.
Milestone: twelve confirmed promotions in one real campaign, then the same in a second domain. This
is the operator's milestone for observation, and it is no quota, promotion rule or stop: no prompt,
table row or tool names a count of promotions, and the campaign keeps its own endings. The stop
rule's patience marks a possible plateau, which is evidence that progress stalled and no proof that
no step is left. A campaign that ended before twelve because of its budget, its environment or as
`finished` (three Builder conversations in a row made no campaign move) reads "reached N promotions;
further improvement unresolved". One ended by its patience reads differently. Its false-promotion
risk is reported across the whole campaign, over every comparison that could have promoted, because
the opening's estimate over one patience's attempts restarts with each promotion and so covers one
window at most.

**2. Honesty: could the measured gains be chance or drift?** A test at level 0.10 is designed to
crown a winner between two equal harnesses about one time in ten. That design value stays a claim
until it is measured on the real solver, whose variance is unknown: the same harness fails a task
once and passes it the next time. The measurement is an A/A test, built the same way as the test:
the reference's solves of a task are split into two halves mirrored in time, then tallied and
tested as a comparison is (`src/builder/comparison.ts`). At four solves a side every comparison
carries one, on the solves its test reads, two against two; at fewer solves there is none. A step
in an A/A test is a false positive by construction. How often two of its solves of a task disagree
is the flip rate. Bar: no step in the ten controls after the six on record. Ten controls still only
bound the rate loosely. The same control gives the tie share, the floor a real comparison has to
beat before its wins mean anything.

A campaign makes many promotion attempts under one reference. An attempt is one reading, and the
exact test reads a step between equal harnesses at most as often as its level: at 0.02, 1.1% of
the time on 24 untied tasks, and at 0.10, 7.6% (`falseRate`, the test's `power` at one half,
`src/builder/comparison.ts`). Every reading prints that rate at its own margins, and a campaign's
opening prints it at its target (`sizeLines`, `src/kernel/size.ts`). The level is a per-comparison
level: nothing holds a campaign's attempts together to it, and no opening is refused on their
sum. The climb adds up
what the attempts risk together as they come: each reading of a harness against the reference is
one attempt, at its own rate, and the sum is an estimate and no bound. The A/A controls that read a
step, one-sided at the level, are counted beside it (`falsePromotion`, `src/builder/climb.ts`). A
control with too few untied tasks to reach the level cannot read a step, so it tests nothing about
that rate: the climb counts only the controls that could have, and reports the others apart as too
small to read one (`incapable`).

**3. Verdicts: are the labels correct?** Validity is decided by a check program nobody has audited
against the field, and a check that rejects a right answer is label noise: in v1, 36 of 47
rehearsal misses came from a faulty check or instrument. The Referee is the noise filter
(`src/review/referee.ts`). It runs once for each answer a check rejects inside a comparison, a
Builder's practice or an Examiner admission probe, before the rejection counts. It never runs on a
pass, on a solve a limit cut short, or on a crash. First the host replays the checks on the logged
answer, and a verdict that does not repeat is ruled a check defect by the host. The Referee reads
the task with its hidden values, the public rules, the answer, the rejecting checks with the fields
each reads, the check program's source, a valid answer for the task where one is on record, and a
probe that changes existing fields or their parent together and reruns the checks (at most eight
probes per ruling). A coupled probe changes at most three paths that one rejecting check reads
together, or their parents; only a scalar answer's root can be replaced. It never reads the harness,
the trace or anything the Builder wrote. It records one ruling (`referee.finding`): `earned` must
name the rule broken and the field that breaks it, both cited by a rejecting check; `check-defect`
must cite a probe that decided both sides on a field the check reads, or shows a refusal independent
of the answer where it declares none. A cited probe that supplies an accepted answer, whole or on
every field that check reads, is refused as defect evidence; `unclear` covers the rest. A ruling
without its evidence is refused, and each refusal is recorded with the ruling asked for and why
(`referee.refused`; no report reads them yet). `earned` counts as a loss; the other two
set the task aside for both harnesses, so a broken check scores against nobody.

The Referee is a model, and it is measured by how well it agrees with a person who labels the same
rejections blind (`tools/d2/settle.ts`, `src/review/agreement.ts`): a three-by-three table of label
against ruling, read as two rates, with each kind's agreement and PABAK reported beside kappa, and
never kappa alone. Once a packet is settled, `settle.ts` prints them over every settled packet, and
reads each settled comparison again with the labels in place of the verdicts they overturn
(`swapped`). A decision that flips means its packet was too small. Both are reports, and so is the
line it prints when a person labels more than one in four `unclear` rulings as earned. Bar: read on
at least thirty labels, catching three in four of the rejections a person calls a check defect, and
voiding at most one in ten of those a person calls earned. A packet holds every rejection that set
a task aside, plus a blind sample of three rejections ruled earned and three passes, since no seat
reads an answer that passed.

**4. Economy: what did each measured gain cost?** A significant step is not necessarily a useful
one. The budget is a bound the operator sets, and a campaign is judged by how fast it climbs under
that bound, rather than by what it leaves unspent. The closing report reads
economy from the log alone and runs no extra solve (`tools/d2/close.ts`, "Work and spend"). It
gives, in order: the climb's velocity (the log's dollars and hours per promotion); the dollars
billed; what the Examiner billed per task it held out, admission solves included; what comparisons
billed per task they scored; and how many of the comparisons that began actually reported, since
one cut short before its report bought nothing it can show. There is one bar, a term of the opening
the operator may set, which is read and printed and gates nothing (`worthOf`,
`src/builder/climb.ts`; revised plan W): at most 3 promotion attempts per epoch after set-up, with
its Builder sessions and billed dollars beside it, which a step's report carries.

Left out on purpose:
- The wall between the two sides is a correctness property. The suite tests it as a byte-identical
  message under a changed hidden value, and it is not something to optimise.
- The Builder's practice results are excluded by rule 1: a learner's score on its own training set
  is the overfitting signal, and no metric.
- A campaign's cost is read as economy, beside the climb it bought, because a cheap system that
  does not climb has no cost worth reporting. A solve's bill decides only between two valid answers,
  and only on a task validity and the objective leave even (section 7, "The tally").

The four are ordered by where they bind, after supply (without which there is no gradient):
without climb there is no result, without honesty and verdicts no result anyone can believe, and
without economy no result whose price is known.

### Two sides and one wall

The exam side knows what a right answer is. The build side tries to produce right answers. The
measurement is only worth something because the build side never learns what the exam side knows,
so the wall between them is the system's main asset.

What crosses from the exam side to the build side is a closed list:

- the contract's public rules, its scope and conventions, the answer format and, where the check
  program declares one, the objective: the quantity and which way is better;
- the public part of each **released** (practice) task;
- for a practice solve: its ending's outcome and kind, the solver's trace and, where the
  contract states an objective, the measure the verifier took of a valid answer;
- for each comparison: the tally and the reading, without naming any task;
- host limits and remaining campaign budget, how many held-out and practice tasks the campaign
  holds (a count no task outcome changes), and fixed procedural advice from the move table.

Nothing else crosses. That keeps out every held-out task and its trace, every check and hidden
value, the list of checks that refused an answer, and all of the Referee's reasons. Section 8
states this as a rule.

### What changed from v1

v1 is this repository's history before v2 took it over on 11 October 2026. Its last tree is
`5bc9988`, and `git show 5bc9988:<path>` reads a v1 file. v1 was itself built in a private
repository, harness-builder-v4, and published here as a squashed history, so a v1 commit cited in
`docs/transfer.md`, such as `7af7315`, is missing from this one. Much of `src/meta`, `src/verify`,
`tools/loc` and `tools/oxlint` was copied from v1 at `3f93d06`, so v1's wording still appears in
comments there. A comment that cites "AGENTS.md rule N" means v1's file, whose rules were numbered
differently. The design around the copied code is different: the Examiner writes the tasks and
the Builder only the harness, two harnesses are compared on held-out tasks under one budget the
host sets, and one log holds a campaign. `docs/transfer.md` keeps the part-by-part account.

Some v1 words mean nothing here: battery, band, witness, F2, census, submit gate, adoption, veto.
Keep them out of new text. Three v1 words have their own v2 meaning: a **climb** is factor 1 of
section 1, an **epoch** is the stretch of a campaign under one reference harness
(`src/builder/climb.ts`), and the **level** is the step test's (`--level`). Two survive with a
narrow meaning: a **cycle** and a **sweep** name a stored v1 run that a campaign takes its pack
from (`--sweep`, `--cycle`), and **bundle** names that pack's directory (`--bundle`).

## 2. The stance: code owns the conditions, models own the content

From the outside Anabasis v2 is a workflow; inside its steps the agents are free. That split is
the system's philosophy, and most design questions are settled by asking which side of it a
decision falls on.

| Code decides | A model decides |
| --- | --- |
| Which move may start, and every refusal | What a harness contains, and when to request a campaign tool |
| Every limit of a solve and of a session | How a task is solved |
| The condition a solve runs under, and its identity | What a new task asks, within the contract |
| Whether an answer is valid | Whether a rejection was right (a ruling, with its required evidence) |
| The comparison, the tally and the test | Why a practice solve failed, read from its trace |
| What crosses the wall | Which failure to work on, and what to change |
| The dollar cap and what is charged to it | |
| The log: what is recorded, and its order | |

Code keeps the first column for one of three reasons: a model cannot observe those facts, the
model is itself the subject of the decision, or the value must stay identical on both sides of a
comparison. Models keep the second column because code cannot reason about a domain it has never
seen.

Six consequences guide a change:

1. **Give a model facts, never a course.** The host tells an agent what happened: a tally, an
   ending, a limit and how much of it is used. It leaves what to do next to the agent: a model
   told a course follows the course instead of the evidence.
2. **Give an author facts instead of a target.** An author told a zone, a share or a count writes
   towards it, and one told each answer's distance from its limit moves the limits. So the
   Examiner is told what was measured on the reference side (section 3, "What the Examiner
   reads"), with no number to reach. It is told the budget every solve is held to, because a task
   that tells two harnesses apart is one a better method answers within that budget and a worse one
   does not. Which harness won each task of the last comparison is a fact of the record, and it is
   told unless the campaign's term `exam-results` is `off`: the operator accepted on 20 October
   that an author who knows which tasks the newest harness wins may write towards that harness,
   to give it the plainest signal of where the exam has fallen behind.
3. **Keep the Builder free.** It may change or rewrite anything in the harness. One limit stands:
   nothing in a harness answers a particular task, so no part of it names a task, copies its text
   or holds its answer. A program may search for candidates and test them against the public
   rules, and the solver writes and submits the answer (`src/builder/prompt.ts`). Add no second
   limit in a prompt or a check. Both harnesses run under one budget, and that budget prices
   whatever a harness does.
4. **Keep code from choosing content just because reasoning about it is hard.** Code may validate
   a declared structure. A classifier in code that decides what a harness or a task should contain
   is a model's decision made badly.
5. **Keep conditions out of a model's hands.** A model's reply never sets a score, a limit or an
   identity. The Builder may request a campaign move, and code checks whether it may start. Where
   a model's output feeds a decision (a ruling), code states what evidence the output must carry,
   and refuses it otherwise.
6. **When in doubt, allow, and allow the whole.** A wall protects three things: the exam side's
   hidden values, the operator's credentials, and each seat's files from the other seats.
   Everything else is allowed, by the simplest rule that says so: reads are open by default with
   the protected roots closed by name, and each seat gets one root it can read and write whole.
   Grant the folder instead of a list of subfolders inside a seat's root, a path per command, or a
   single file: each narrower grant is one more policy to keep true on two operating systems, and
   on the record narrow grants ended solves by the dozen while no wide one leaked a hidden value
   (`7f0add79:docs/plan.md`, rows B10, B12 and B17). Narrow a grant only where two would collide, as two
   solves writing one path in a shared `/tmp` did, or where the wider grant would open one of the
   three protected things. A seat's commands write one root, except for the host's own folder
   inside it (`SolveDirs`, `src/solve/command.ts`), and each policy is probed once per process by
   one command run exactly as every command of a seat is run (`walledBase`, `probeWall`).

## 3. The seats

Each seat has one job and a closed view. "Reads" is what the host hands it; "Never" is what the
wall keeps from it.

| Seat | Job | Reads | Never | Source |
| --- | --- | --- | --- | --- |
| **Examiner** (model) | Writes task instances against a fixed contract and check program. For a campaign that opens from a prompt, it first drafts that exam: the rules with their sources, the answer format, one check per rule, examples and controls | Listed below the table | Listed below the table | `src/examiner/` |
| **Builder** (model) | Edits `harness/`, chooses campaign tools in the same conversation, and ends with a frozen harness version | The public rules and the objective, practice tasks, practice results with their measures and traces, each comparison's tally, its own notes, and a copy of the other harnesses its campaign kept (`kept/`) | A held-out task or its trace, a check, a hidden value, which checks refused an answer | `src/builder/` |
| **Solver** (model) | Answers one task from inside a harness, as one system with it: pi's coding agent with `read`, `bash`, `edit`, `write` and `submit`, plus whatever the harness adds | The task's public part, the public rules, the harness's guide and programs, its limits and how much it has used | The checks and the hidden values | `src/solve/` |
| **Verifier** (code) | Runs every applicable check on one answer, each in a fresh cell inside the OS wall | The answer, the task, the check program, the installed engines | n/a | `src/kernel/verify.ts`, `src/verify/` |
| **Referee** (model) | Rules each rejection `earned`, `check-defect` or `unclear` before it counts | Only the verifier's side: the task with hidden values, the rules, the answer, the refusing checks, the check program | The harness, the solver's trace, the Builder | `src/review/referee.ts` |
| **Host** (code) | Everything in the first column of section 2 | The log | n/a | `src/kernel/`, `tools/` |
| **Operator** (person) | See below | Every report and refusal | n/a | n/a |

What the **Examiner** reads:

- the contract, the operator's brief, the budget every solve is held to, and examples;
- one outcome for each task of the campaign, and whether a valid answer to it is on record;
- for a task the reference stood in two or more comparisons of, the same outcome for each of its
  last three, newest first, each with whether a limit cut one of the reference's solves, and how
  many of the newest closed it in a row (`histories`, `poolOf`), since one outcome cannot tell a
  task answered once from one answered every time;
- for each task the last comparison tallied, which harness won it or that it tied, and, where the
  objective alone decided it, how far apart the two sides' measures were (`objectiveMargin`). This
  is the operator's word of 20 October, a term of the campaign (`exam-results`, on by default):
  the Examiner learns which tasks the newest harness wins, and so what to write against it. With the
  term `off` it is told none of it;
- for such a task, how much better a measure on record is than one of the reference's answers,
  where another of its own or its author's is (`roomLeft`). The other harness's answers are left
  out of it, so it reads the same with `exam-results` off whatever that harness measured;
- those tasks counted by family, with the solves per side they rest on, and by family the turns
  each valid answer of the reference took (`src/examiner/record.ts`). With `exam-results` off, where any family holds one
  task, the counts are a total only, and a total of one is withheld. Whether the counts help is
  untested (`docs/plan.md`, row F60);
- what the last session under the current reference said at its `finish`;
- the home the last session left, with a copy of the reference harness in it unless the
  campaign's term `exam-reference` is `off`;
- how many of its gate's solves each held task passed on, and the drafts a gate refused after
  reading them, with the reason, each with how far its author's answer stood from the reference's
  best by the objective (`reference.gap` of `task.gate`): those read on the current reference counted alone, and those
  read on a replaced reference as one count;
- the checks, through `try_answer`, on an instance with an answer of its own;
- when it drafts an exam: the operator's prompt, what the host's reading found in each draft, and
  a walled home of its own, empty when it starts.

What the **Examiner** never reads: a target, a harness's name, the other harness's result on any one
task where `exam-results` is `off`, or a count of a task's valid solves beyond every, some or none. The one exception is how many
of the reference harness's solves of a draft task were valid (`try_task`, and in later sessions; up
to three, one at a time until they leave room), how many of them gave no reading, the turns each
valid one took and, where the contract declares an objective, their measure and its own answer's.
Nothing else of those solves reaches it. The Examiner makes none of the exam's solves itself.

The tools of each model seat, as its source names them:

- Examiner: `propose_tasks`, or `try_task` and `wait` where the host can have the reference harness
  solve a draft task, then `read_example`, `try_answer`, `read_opening`, `bash`, `read`, `write`
  and `finish`. `read_opening` serves the session's opening message again, for a context that was
  compacted. `try_task` returns at once with the ids it put to the gate. The gate's word on each
  instance comes with the session's next tool result. `wait`, and the reminder after a turn that
  made no call, wait for that word where the gate has said nothing new (`settled`), and `finish`
  and the session's end wait
  for every instance still at the gate (`putAside`, `src/examiner/write.ts`), so a session goes on
  writing while its drafts are solved.
  `propose_tasks` runs no solve and answers in its own result.
  `try_answer` runs the checks on an instance with an answer of the Examiner's own. Where the checks
  pass, the session holds the answer in memory until the task has its final id. A task proposed with
  that content is then checked against it again under its own id: inside the gate where the
  reference's solves were valid in every one or in none, so that the answer decides, and otherwise
  once the gate holds the task. A pass on a held task is logged as `task.feasible`, by version and
  session, with the answer, kept on the exam side for the Referee, and the objective's measure of
  the answer where the contract declares one (`measureOf`). The shell is a walled
  home of its own. It is seeded with the home the last session left and, unless the campaign's term
  `exam-reference` is `off`, a copy of the reference harness as `reference-harness/`, laid afresh
  each session and kept out of the home carried on. The only way from it into the exam is that one
  gate. In the session that drafts an exam the tools are `draft_exam`, `bash`, `read`, `write` and
  `finish`, the shell is a walled home empty at its start (`src/examiner/shell.ts`), and the only
  way from it into the exam is `draft_exam`.
- Builder: `read`, `bash`, `edit`, `write`, `practice`, `read_trace`, `read_opening`,
  `check_harness`, `preview_harness` and `finish`. In the campaign command it also has `examine`,
  `release_practice`, `compare`, `promote`, `campaign_status` and `wait`, which returns once the
  Examiner session beside the conversation ends, on the host's time.
- Solver: `read`, `bash`, `edit`, `write` and `submit`. Its answer is the file `answer.json`;
  `submit` with `malformed` is its statement that the task is malformed, given instead of an
  answer.
- Referee: `probe_check`, `read_check_program` and `record_ruling`.

An older log may hold `diagnosis.*` events from a removed Diagnoser seat (`7f0add79:docs/simplify.md`, E1).

### What waits for the operator

Seven decisions are the operator's. Someone outside the loop has to fix the exam, pay for it, and
own what cannot be undone:

- freezing or refusing the contract and the check program, and admitting a check by name
  (`accept.ts --freeze`, `--admit`). The operator writes none of it;
- labelling drawn rejections blind;
- the dollar cap, and which provider account pays;
- deciding whether a task that nobody answers is infeasible;
- promoting a harness to reference (`tools/d2/promote.ts --harness <digest> --yes`). The rule
  names the harness (section 7); promoting a different one takes the operator's reason
  (`--despite`);
- changing what a solver is given or told: the starter, the shell, the limits of a campaign;
- stopping a live run.

Where one is still open, bring it as a single question, with the evidence and a recommendation,
and carry on with whatever does not depend on the answer. Once the operator has given the word, it
covers every case it names until the operator withdraws it, after a compaction or a long detour
too: "stop and scrub the forks" or "launch these nine runs" is not asked again case by case. A
general instruction ("keep going", "improve the system") authorises the work within its scope, and
none of these seven. Write "a person" only for a duty in the list above; the setting, the
reference, the stop rule and the next move are code's (sections 4 to 7).

Two of the seven are given once, for every campaign: the campaign command freezes an exam whose
reading shows no fault, and promotes the harness the rule names, without waiting. A campaign runs
unattended to a typed ending, the way a goal runs until it is met (`docs/plan.md` row F29).
Launching it is also the word that admits every check decided by its author's own computation, the
declared objective among them, in a drafted exam or a stored pack. The campaign command reads the
exam with `accept.ts --freeze --admit-authored` (`make`, `tools/d2/harness-builder.ts`), and reads
again a reading taken under `--hitl` that left some unadmitted (`planOf`, `src/builder/opening.ts`).
`--hitl` (the operator in the loop) hands all three back to the operator for one campaign, which
keeps that setting until `--no-hitl`; there a check is admitted by name (`--admit`). Freezing an
exam whose reading shows any other fault, and going on past the stop rule, need the operator's word
each time in every campaign (`--despite`, `--past-stop`).

The operator types nothing into a Builder session. Every message a Builder reads is built by the
host from the contract, the practice tasks, the practice results and the tallies.

### The harness

A harness is a directory where each part has one purpose (`HARNESS.md`, which a Builder is given
alongside it, shows the shapes with a worked example):

| Part | Purpose |
| --- | --- |
| `agent/tools-spec.json` | Selects which of pi's coding tools the solver has |
| `.toolchain/` | The programs, which the solver runs by name from its shell |
| `agent/BUILT_AGENTS.md` | The guide: words about the programs and the tools, read once per task in the solver's system prompt |
| `agent/tools.ts` | The harness's own tools, which the solver has beside pi's tools; each call runs alone under the wall. Whether a computation is a program, a tool or both is the Builder's choice, and it is told what each costs a solve. An empty `tools.ts` is no empty harness: the programs live in `.toolchain/` |

A harness is named by its digest, so changing any part makes a different harness, and solves under
the old one do not count for the new one. The **Starter Built Harness** is pi's coding agent as pi
releases it, with no guide and no domain program (`src/solve/starter.ts`). Every campaign starts
from it, it is the first reference harness, and it stays the fixed lower reference after a
promotion.

The solver and the Built Harness it runs in are one system, and every solve happens inside one:
"the starter's solves" are the solver's solves inside the starter. The setting fixes the solver,
so it is the same on both sides of a comparison, and the harness is the one thing a comparison
reads, the one thing the Builder edits, and the one thing a promotion makes the reference. A
harness shows itself as an answer its solver reaches within the solve's budget while the
reference's does not, so the budget is what lets a better harness show: the more turns a solve
has, the more of a harness's programs the solver inside the starter can work out for itself
(section 7, "The budget"). Never write "with or without a harness": every solve has one.

## 4. The Harness Builder

The **Harness Builder** and the **Builder** are the same model agent. It edits the harness and
decides when to ask for another task-writing session, release practice tasks, compare its current
harness, or promote an eligible harness. No coordinating model sits above it.

The host opens the exam and prepares the campaign first. Then `tools/d2/harness-builder.ts` keeps
one Builder conversation and one workspace open while its campaign tools run.

An Examiner call runs a separate agent with its own view. The call returns at once and the session
writes alongside the conversation. A comparison or a promotion waits for it on the host's time, a
release of practice tasks does not, and the campaign facts under each campaign tool's result say
what it held out. When the Builder finishes or hits its wall, the end of the conversation waits for
the Examiner session without stopping it. What does stop it: the host's halt (on the run's moves, an
ending the table names, or the operator's stop) and a kill of the run. It then ends on record as
killed.

A comparison returns the same aggregate tally and reading the Builder already receives. A
promotion can only name the harness the existing rule allows. The model cannot choose a checker, a
held-out task, a solve limit or a reference.

Where the table names more than the action itself, the tool does what the table names
(`comparedOf`, `tools/d2/campaign-actions.ts`), and the status and the result state it as a fact:

- A comparison that has begun and not yet reported goes on under its own terms.
- A comparison reads the harness it froze, and a step promotes that harness, whatever `harness/`
  holds now.
- While `harness/` is the reference harness, `compare` runs the table's own comparison: the
  control of the starter against the reference, or the latest harness on tasks written since then.
  Where the table names neither, there is nothing to compare.
- A harness that a comparison has already read against the reference, unchanged since, is only
  compared again when the table names it: a second draw of the same pair is a second chance at a
  step (section 1, factor 2).
- `promote` names the harness the rule names, which is not always the last one frozen (`step`,
  `src/builder/decide.ts`).

An action the host refuses before it begins, or one that produces nothing, counts as no move and
writes no `campaign.move`. An Examiner session and a comparison are recorded as they begin, like
every move the host makes. The record carries the code of the table's row where the Builder made
the move the table named, and `asked` with what the table named where it made a different one. If
its command then refuses it, the record stays, as a host's would, and counts against `--moves`.
The conversation itself is a `build` move with the code `led`.

`decide` (`src/builder/decide.ts`) is the one table over the log. It gives advice at the opening,
under each campaign tool's result, and when a turn ends without a call; an edit or a practice solve
ends only at the session's limits. The Builder may ignore an advised build, comparison or
task-writing move, apart from the Examiner session that follows a promotion, which the host starts
beside it (section 7, row `no-room`). Running out of budget, the stop rule, an operator stop, a
faulty exam and a failed environment still end the run in code. Every tool goes through the same
admissions and commands as a move the operator launches. The controller's private reasons
(`campaign.move`, `campaign.ended`) never reach a seat's message.

What reaches the Builder is the closed list of section 1. It never receives a held-out task,
a comparison trace, a checker, a Referee reason or an Examiner's free-form reply. Newly released
tasks and the promoted reference are refreshed in its current workspace. `read_opening` serves the
current public practice tasks and aggregate tallies, even after compaction.

Comparing the working copy freezes it and records `build.checkpoint` without ending the
conversation. The next edit changes the working copy, and the harness under comparison stays as it
was. The same model conversation continues after the tool returns. Its session limits cover the
whole conversation, and its wall counts only the Builder's own time: the clock stops while a
campaign action runs, since that is the host's time, bounded by the campaign's total and `--moves`
(`Bench.within`, `src/builder/tools.ts`). A comparison cut at the wall would lose the solves in
flight and read as a failed host, and one bought in the conversation is read in it. Both compaction
modes still apply, and model usage is recorded before a tool can spend more of the campaign's
budget. When a conversation ends at its own limits, the same run of the command opens a new one,
with the existing notes and results as its fallback. The same happens after a process restart.

The conversation is a term of the campaign, kept by its opening as `--hitl` is: `--builder-led`,
on for any campaign that opens now. With `--no-builder-led`, and in a campaign on record without
the term, the host makes every move the table names, a Builder session among them. The two modes
differ only in the branch that opens the conversation (`converse`, `tools/d2/harness-builder.ts`),
the tools and advice it is given (`tools/d2/campaign-actions.ts`), the table of texts a Builder
reads (`SAID`, `src/builder/prompt.ts`), and the span the readers give a session (`soFar`,
`src/builder/handover.ts`). The conversation is valued for its continuity: a simpler controller
that drops it is a regression. `test/builder-led.test.ts` proves the mode without a model; whether
it improves a real campaign is unclaimed until an ablation reads it.

Repeat the standing facts where the agent reads, so a compaction needs no signal: the first tool
result of each Builder turn ends with the turn number, the session time used and the practice
solves left (`usedLine`, `src/builder/prompt.ts`), a turn that ends without a call is answered with
the goal and the same facts (`continuation`), and `read_opening` serves the opening message again.
A Builder ends nearly every turn in a tool call, so a message sent only between turns goes unseen.

## 5. The log

A campaign's record is one append-only JSONL file, `.ana/d2/<name>/log.jsonl`, with one event per
line (`src/kernel/log.ts`). Every state and every report is a view over it; nothing else is stored
as truth.

- An append is written and synced before it returns. A read refuses a torn or unknown line.
- A task's state (`held`, `released`, `refused`, `disputed`) is a fold over the log
  (`src/kernel/task.ts`); an older log's `ladder` is read as `held`.
  The same goes for the pairs of a comparison (`src/kernel/compare.ts`), the stop rule, the tasks
  waiting for a label (`src/kernel/reports.ts`), and the dollars billed.
- A **condition** is everything that could change a solve's result, as one content-addressed record
  (`src/kernel/condition.ts`): the contract, the harness, the task version, the model and its
  effort, the price table, the runtime's packages, the compaction mode, the tool trees and the
  sandbox, which it names by the isolation profile and the platform (`tools/d2/campaign.ts`). Two
  solves are comparable only when their conditions differ in the one thing being compared.
- A solve's trace is in the log (`solve.turn`, `solve.call`), and so are the turns and calls of
  each Builder session and Examiner session. `src/kernel/trace.ts` is the one reader of them all.

Four habits follow:

1. **Add no second store.** A fact a command needs later is an event, and the command reads it
   back. A file beside the log that holds state is a second history.
2. **Add no second reader of one fact.** Find the fold that already reads it and call that.
3. **Never edit a log, and never write an event by hand.** A log with a hand-written line records
   a history that did not happen. Move or copy a campaign only with `bun run runs copy`, `move`
   and `retire`, which carry its folder whole.
4. **Keep old event kinds readable.** The source keeps no compatibility paths
   (`tools/oxlint/HABITS.md`, 12.3), and the log is the one exception, because a log is evidence:
   `EVENT_KINDS` still lists kinds that no command writes, so that older logs still read.

`.ana/` is ignored by Git and lives inside the repository. Every solve's, Builder's and Examiner's
wall denies the repository, along with its other worktrees (`worktreesOf`,
`tools/d2/campaign.ts`). A campaign runs from a worktree kept for it. Once it has been idle for a
day, `bun run runs retire` moves its folder whole into the archive, `data/runs/` of the main
worktree, which is also ignored and also behind the wall, and deletes a seed instead. Nothing else
deletes a log or a trace there.
The log holds hidden values and the checks' verdicts, so it stays on the exam side: keep it out of
prompts, pull requests and pastes.

## 6. A campaign's commands

A campaign runs as a sequence of commands over one log. Each command names the campaign (`--name`)
and the pack it opens over: either a stored pack, given by four flags together
(`--root --sweep --cycle --bundle`), or none, for a campaign that opened from a prompt and whose
exam its own log drafted (`packNamed`, `tools/d2/campaign.ts`). The head comment of each file is
its manual and lists its flags.

| Order | Command | What it puts in the log |
| --- | --- | --- |
| 0 | `bun tools/d1b/draft.ts --name <name> --session d-1 --examiner <model>` | For a campaign that opened from a prompt: the session in which an Examiner drafts its exam, and the whole draft that stood (`exam.drafted`). The host reads each draft without a model before it stands |
| 1 | `bun tools/c/accept.ts ... [--admit <checks> \| --admit-authored] [--freeze [--despite "<why>"]]` | What the check program was seen to do (`checker.read`), and the operator's word that the contract and that version stand (`contract.frozen`) |
| 2 | `bun tools/d2/prepare.ts ... [--practice N]` | The pack's tasks held out and the practice tasks released |
| 3 | `bun tools/d1b/examine.ts ... --session x-1 --examiner <model>` | More held-out tasks, written by an Examiner session |
| 4 | `bun tools/d2/round.ts ... --session b-1 --builder <model>` | A Builder session, then the comparison of the harness it left with the reference |
| 4 | `bun tools/d2/session.ts ... --session b-2 --builder <model>` | A Builder session without a comparison after it, under its own dollar cap. The plan's checkpoint is several of these followed by one comparison |
| 4 | `bun tools/d2/checkpoint.ts ... --id g2` | One comparison of two harnesses the campaign keeps, without a Builder session |
| 5 | `bun tools/d2/settle.ts ... --session b-1` | The comparison's packet: every rejected answer ruled a check defect or unclear, or left unruled, plus three rejections ruled earned and three answers that passed, drawn uniformly by id, blind to ruling and harness. Once answered: the person's labels and the report again; a pass labelled wrong counts as its side's fail, as an earned rejection does. Until it is answered the report says `unsettled`, and no promotion waits for it |
| 6 | `bun tools/d2/promote.ts --name <name> --harness <digest> --yes` | The operator's word that a kept harness is the reference harness from then on (`harness.promoted`). Without `--yes` it shows what the log holds of that harness and records nothing. A harness the rule would not promote needs `--despite "<why>"`. `--harness` takes a kept digest, or the letter the view and the closing report print beside it: A for the starter, then B, C and on, in the order the log first names each harness (`namesOf`, `src/builder/names.ts`). The letter is a name; the digest stays the identity |
| 6 | `bun tools/d2/import.ts --name <name> --harness <dir> [--note "<why>"]` | The operator's word that a harness built elsewhere (another campaign's handover, or one written by hand) is kept by this campaign (`harness.imported`). It is kept under its digest the way a session keeps one, after which `--parent`, `--reference` and `promote.ts` can name it. It is not a session, so `latest` does not move |
| 7 | `bun tools/d2/close.ts ... --to <dir>` | Nothing. It writes what the campaign hands over, outside the repository: the reference harness as a self-contained directory, the public rules, and the closing report |
| all | `bun tools/d2/harness-builder.ts ... --budget <dollars> --builder <model> --examiner <model> --reviewer <model>` | The opening (`campaign.opened`), the Builder's requested moves (`campaign.move`), frozen versions inside its conversation (`build.checkpoint`) and its ending (`campaign.ended`) |

### The campaign command

The last row opens the exam and then runs the Builder with campaign tools (section 4). The Builder
chooses its moves, and `decide` supplies filtered advice. `--moves N` bounds the campaign actions;
`--dry-run` prints the table's advice without making a move. A campaign freezes an exam whose
reading shows no fault, and promotes the harness the rule names without waiting (section 3). Under
`--hitl` it only runs once every fault of its checks is admitted, and it reports a step without
promoting it, waiting there for `promote.ts`.

`bun run runs launch` starts it (the skill `run-management`): niced, in its own process group, with
its output in two files and the key in Bun's own `--env-file`. `continue` runs a campaign again from
its log, and `pause` stops one at a clean point. Each solve waits for the host: a solve of a Builder
session, a comparison or an Examiner session's gate starts once the one-minute load is at or below
the core count, or after half an hour. It says so while it waits, and the wait is recorded
(`campaign.waited`, `tools/d2/host.ts`); `--loaded` starts them regardless. A solve also waits, off
the record, while others are in flight and what is left of the budget holds no reserve for it
(`affords`). Each run of the command keeps a receipt beside the log, `launch-run-<n>.json`
(`tools/runs/receipt.ts`): its flags, the commit, whether the tree was dirty, the load it started
under, the Bun version, and the login it ran as where one was named. The log holds the host's code
by content, without a commit, so the receipt fills that gap.

**It opens a campaign over a stored pack, or from a prompt** (`--prompt "<text>"` or
`--prompt-file <path>`, with `--solver`). From a prompt, the opening holds the prompt, and the
first move is the draft of row 0. A draft stands once the host's reading, without a model, finds
no fault in it. That reading checks:

- its shape;
- a source on every rule;
- one check per rule;
- every control through the checks twice;
- the smallest answer the format allows, refused on every example (`draftReading`,
  `tools/d2/exam.ts`).

What the reading cannot tell is whether a rule really belongs to the field and its source is real.
Every check of a drafted exam is its author's own computation, since nothing installs a field
engine for a campaign, so its acceptance reading would show one fault per check. The launch is the
operator's word for each of them, the word rule 10 asks for: the exam is read with every check its
author decides admitted, the declared objective among them (`--admit-authored`), and frozen if
nothing else is at fault. Under `--hitl` the campaign ends on its exam at that point instead, and
continues when the command is run again with `--admit <checks>`.

**Its budget is one total.** Each move's cap is what is left of `--budget` after every billed
dollar in the log is subtracted. The campaign ends on its budget when what is left is less than
one solve is held at (`--reserve`). No forecast of what the next move will bill holds it: a
comparison begun near the end of the budget runs under what is left, and one the cap cuts tallies
nothing and reads `not-scored`.

**It ends in one of seven ways**, and the log's last event says which (`campaign.ended`):

- `budget`;
- `stop` (the stop rule, section 7);
- `exam`;
- `no-room`;
- `environment`;
- `operator`;
- `finished` (three Builder conversations in a row made no campaign move, the last ending by
  `finish` or at its limits).

Lack of room is advice to request other tasks while a conversation is alive, and becomes the
campaign's ending once that conversation has ended at its limits. A Builder's `finish` ends one
conversation and never the campaign. Between conversations the host makes whatever move the table
names that needs nothing from a Builder, as a campaign move like any other: any comparison, and a
promotion (`hostOwed`, `tools/d2/harness-builder.ts`). Any Examiner session the table names starts
as the next conversation opens, and writes alongside it (`campaignTools`,
`tools/d2/campaign-actions.ts`).

A comparison that began under other code is refused at that point by its own terms, and the
campaign ends on its environment, to be run at that code until it reports. After that another
conversation follows on the Builder's notes, as after one that ended at its limits, until three in
a row have made no campaign move. Three things are not counted towards those three: a conversation
the provider crashed or a stop killed; an Examiner session beside it that crashed or was killed
without holding out a task; and one the host refused before it began (`idleOf`,
`tools/d2/campaign-terms.ts`). The three idle conversations end the campaign `finished` unless the
table names an ending of its own, and the status a Builder reads counts the conversations before
its own that made no move. A Codex goal stays active on the same terms: its own model ends it only
as met, or as blocked once the same blocker has held for three turns, and a climb is never met.
Run again by its name, a campaign that ended `finished` continues with a new conversation, as after
the operator's stop.

A move that threw after it began ends the campaign on its environment, except one whose session is
recorded as crashed, from which the campaign continues (`goesOn`, `tools/d2/harness-builder.ts`).
Three Builder or Examiner sessions in a row that the provider failed before they held out a task
or changed a harness also end it on its environment (`crashedRun`, `src/builder/ground.ts`). Such a
session held out nothing because it was refused a turn, while the domain may well have had tasks to
give, so it does not count as idle for the patience; one that held a task out and then crashed did
move the campaign. Run again by its name, the campaign continues from its log, and the count starts
again.

With `--handover <dir>` it then writes what it hands over (row 7). The harness is copied whole,
with the programs a kept state names by a link, and it has to open there as the harness it was kept
as. The closing report is a view of the log; it leaves out task names and checks. It says what was
audited and what was not: what the Referee ruled, what a person's labels settled, how many
comparisons are still unsettled, and what a person read of the answers that passed in a packet
(`settle.ts`), or that nobody read them.

**The operator steers a running campaign by leaving it a word** (`tools/d2/word.ts`), which is one
event in its log (`campaign.word`):

- `--stop "<why>"` ends it there with the ending `operator`;
- `--tasks "<why>"` has an Examiner session write other tasks before anything else is built or
  compared;
- `--budget <dollars>` sets its total from then on.

The command reads a word at the next move's boundary, never inside a move (`pendingWords`,
`src/builder/word.ts`), and never waits for one. The event that acts on a word names it
(`answers`), so each takes effect once. A stop followed by the same command is a pause. No seat
sees a word: no Builder, Examiner, solver or reviewer reads it or its reason. `bun run runs stop`
is the abrupt form: it ends the process that writes the log, so no ending is written, and
releases what its unfinished solves and sessions held on the host.

### What the log records of a campaign's conditions

**The opening** (`campaign.opened`) keeps what the campaign runs by, so that its command can
continue by name alone:

- the project it belongs to;
- the total and the reserve;
- the full limit of a solve;
- the Builder sessions the table counts before it advises a comparison (`--sessions`, 2);
- the patience (`--patience`, 6);
- who sits in each seat;
- the terms of its moves as a command last named them (`TERMS`, `src/builder/opening.ts`): a
  session's limits, a comparison's size, the practice tasks and an Examiner session's terms.

A term no command named takes its move's default. A later run that names nothing runs by the
record, and one that names a different term records it again: these are the operator's
conditions.

**Every campaign belongs to a project** (`--project`), named with letters, digits, `.`, `_` and
`-`. The opening is only written with a project, and an older opening without one takes the flag
the next time its command runs. A later run need not name the project; one
that names a different project is refused (`projectOf`, `tools/d2/campaign.ts`). The project groups
campaigns on the operator's page and plays no part in any move or seat. Campaigns run only by the
hand commands of rows 0 to 7 write no opening and so have no project.

**The setting** (`campaign.setting`, `tools/d2/setting.ts`) is recorded once, by the first command
that begins a comparison or a Builder session, and never changes. It says who solves and under
which limits, named by five flags (`--solver`, `--solver-effort`, `--solver-window`,
`--solve-minutes`, `--solve-model-turns`), and how many held-out tasks a comparison draws (`--target`).
The first command records what it names and the defaults for the rest. From then on a command that
names nothing runs under the record, and one whose flag names something different is refused with
both values: a different setting is a different campaign. A campaign whose solves were made before
a setting was recorded still has one, the one its last test-side solves ran under, and the first
record is held to it (`firstRecord`). A solver that is another model, at another effort or under
other limits is a different solver, and no solve on record counts for it. `--solver-window` is the
context at which the solver's Claude Code compacts, 300,000 tokens unless a command names another.
A model that Claude Code serves with a 200K context, such as `claude-haiku-5-5`, is refused at
that window and needs one it can hold.

**Practice follows the supply and the outcomes.** One release takes at most half of what is held,
so a campaign that opens on a few tasks releases fewer than `--practice` names. Before a Builder
session the table releases more where tasks have been held out since the last release, and after a
control that read room (section 7) it releases as many again. `--practice` is a per-epoch count,
and once practice exists a release never leaves fewer frontier tasks than a sweep at the level needs
(`practiceRoom`, `src/builder/decide.ts`). Each release is one task fewer to compare.

A release takes, in this order:

1. the tasks no solve answered in two comparisons;
2. half, rounded up, of the tasks the reference harness failed in a solve of its last reading of
   each; the other half stays held for the comparisons;
3. the rest by the contract's draw from every task neither list holds, those the reference
   answered in every solve among them, since a practice pass returns the objective's measure
   (`releaseOrder`, `src/kernel/reports.ts`, which `tools/d2/prepare.ts` calls).

The release reads the reference's own solves alone, never the other harness's answers, so which
held-out task a new harness won leaves the practice set unchanged (rule 3).

The tasks that leave the reference room are what a Builder has to work on. A task that a
comparison scored before its release keeps that comparison's solves on the exam side: a Builder is
shown only its practice solves (`practiceRan`, `src/kernel/solves.ts`). Before a comparison the
campaign holds as many scorable tasks as the comparison scores (`--target`), or the Examiner
writes more first.

### What refuses a move

One function decides whether a comparison may start (`admission`, `src/builder/admission.ts`), and
a round or a checkpoint asks it before writing its first event, whether the campaign command made
it or someone started it by hand. Among other things it refuses:

- a log with no held-out task;
- a comparison that would score fewer frontier tasks than a step needs at the level
  (`held-short`, `sweepOf`);
- a comparison with no `--cap`;
- a checker that nobody has read;
- a campaign the stop rule has stopped, unless `--past-stop "<why>"` gives the operator's reason,
  which is logged (`stop.overridden`).

A Builder session on its own asks its own admission (`admitSession`): a cap, a checker that has
been read, and the stop rule. The session also refuses a `--session` whose Builder started and did
not end whole (`spent`, `src/builder/session.ts`). What continues without asking is whatever the
log shows the start of, of its own kind: a comparison that began, or a session that began. A
command writes nothing before its last refusal: first the admission, then the comparison's own
terms, and only then an override of the stop rule and the campaign's setting. A comparison that
has reported is finished, and running it again repeats what it said. A rehearsal is exempt by
name: its seats are scripts, which cost nothing.

The other verbs over a campaign's log:

```text
bun run runs rehearse [--no-comparison] <the flags of tools/d2/round.ts that name no model>
bun run runs rehearse --campaign <the flags of tools/d2/harness-builder.ts that name no model>
bun run runs view <name> [--level N] [--target N] [--practice N] [--past-stop "<why>"]
bun run runs fresh | launch | continue | keep | pause | copy | fetch | retire | stop <name> | source <name> | status | logins | pulse | replay | seed | zip
```

### Defaults

- 24 scored tasks (`--target`);
- 4 solves per side (`--solves`; `SIZE` in `src/kernel/size.ts`);
- level 0.02 (`--level`), with a patience of 6 (`--patience`): one comparison that reads a step at
  the level promotes;
- a room floor of 1% (`ROOM`), the least improvement by the objective worth counting, as
  a share of the larger measure. Two valid answers closer than it tie in a pair, and an answer on
  record better than one of the reference's by less leaves that task no room, at the gate, on the
  frontier and in `roomOf`. It is a constant, the same for every campaign. A comparison keeps the
  floor it began with, and one that began before 21 October
  recorded none: its pairs read at floating-point equality (`SAME`), as they were read;
- a stop after more than 3 tasks with a check defect (`--defects`);
- a reserve of 10 dollars per solve (`--reserve`);
- `--parent latest` and `--reference promoted`, which is the harness last promoted, and the
  starter until one is;
- a Builder session of 24 hours (1,440 minutes) of its own time, 300 turns and 24 practice solves;
  a Builder that leads its campaign has no count of practice solves, only as many as what is left
  of the campaign's total holds a reserve for (`practiceLeft`, `src/builder/tools.ts`);
- a solve of 20 of the model's own turns and 30 minutes, whoever solves (`LIMITS`,
  `tools/d2/campaign.ts`), and 24 prompts.

An Examiner session ends when the Examiner calls `finish` a second time, or a first time once the
host has the tasks it asked for, or at the end of a turn once it has them. Those are what the
campaign is short of for a comparison's target and its practice (`shortOf`,
`src/builder/decide.ts`), or `--exam-tasks` where the operator names a count. `finish` and the
session's end first wait for every instance still at the gate, so each reads the whole count, and a
session can hold out more than it asked for. A first `finish` that falls short is declined once,
with the need and without a count, because an Examiner left alone proposes one small batch and
finishes. The session's home is carried whole into the next session's, and what it said at its
`finish` opens the next session.

For a small campaign, set `--reserve` to roughly what one solve of the solver bills, which the log
of any earlier campaign under the same solver shows (`solve.finished.billed`): a campaign ends once
less of its total is left than one reserve. `bun run runs fresh <pack>` opens and launches a
measured campaign from the operator's prompt for that pack (the skill `run-management`). What these
commands and flags replaced is in `7f0add79:docs/simplify.md` and `7f0add79:docs/plan-history.md`.

## 7. How a comparison is read

`src/kernel/compare.ts`, `src/builder/round.ts` and `src/builder/comparison.ts` own this, and their
head comments give the full account. Here is the short version.

**Terms first.** Before its first solve a comparison writes `comparison.started`: its two
harnesses, its setting, its scored tasks, its solves per side, its level, its objective rule, its
dollar cap and, where given, its prediction (`--predict`). A comparison continued from its log
keeps those terms, and one requested again on other terms is refused.

The scored tasks are `--target` of the held-out ones: the newest epoch's first, and within an epoch
those held out since the last comparison began before the others, each drawn by the contract's
hash. The draw does two more things:

- It leaves out a task that has had no valid answer after two comparisons, until a person labels
  it (`poolOf`).
- It takes off the frontier a task that the reference harness answered in every solve of the last
  comparison it stood in for that task, on whichever side. Such a task can only tie again or be
  lost: it is **exhausted** (`poolOf`). A task is not closed where a valid answer on record (the
  reference's own, the other side's or its author's) is better by the objective than one of the
  reference's by at least the room floor, since the next harness can still win it (`bettered`).

An exhausted task stays in the draw as **retained**, so that a harness that breaks what the
reference answers still shows its losses. A loss can only come from a task the reference answers.
With those tasks out of the draw, a harness that answers new tasks and loses old ones would look
better than it is over the tasks written, all the more so as the newest tasks are drawn first.
A scored set takes one retained task for every three frontier tasks, on top of the target
(`scoredSet`). The step's one test reads the retained tasks with the frontier, and the report
gives their tally apart (see "The test" below).

**Fresh solves.** Each scored task is solved under each harness, afresh. A task's solves run
together, the tasks run in an order drawn by a hash of each, and within a task the harness that
goes first is mirrored, so anything that drifts over a comparison's hours falls between tasks,
where the test does not look. A solve counts only when its start names the comparison. No earlier
solve of either harness is reused: a condition names the host's code, which changes between
comparisons, and one frozen draw of the reference's solves would bias every later reading.

**How a solve ends** (`src/kernel/solve.ts`), and its part in a pair:

| Ending | Kinds | In a pair |
| --- | --- | --- |
| pass | | Valid. It beats an answer that is not valid, and is even with another valid one unless the comparison fixed an objective and one is better by it, or one solve billed at least 20% less |
| fail | `rejected`, once the rejection is ruled a true fail | Not valid |
| fail | `wall-ended`, `turns-ended`, `context-ended`, `no-answer` | Not valid. There is nothing to recompute, so no ruling is needed |
| fail | `broken-harness` | Not valid. The harness is what is compared, and one that cannot open answers nothing |
| fail | `rejected`, ruled a check defect or unclear, or waiting for a person | The task is set aside for both harnesses |
| non-result | `provider`, `sandbox-crash`, `killed`, `moved-files`, `check`, `verifier` | No measurement. It is solved again and is in no pair |
| flagged | | Not valid: the solver's statement, with a reason, that the task is malformed (`submit` with `malformed`), counted as the flagging side's own fail and reported separately (`flagged` in the report). A task both sides flag ties; one the other side answers is lost |

**The tally.** Every solve of the new harness is paired with every solve of the reference on the
same task, and one rule decides each pair: validity, else the objective, else the bill. A task is
read by the three in order (`pairings`, `src/kernel/compare.ts`): the harness that wins more pairs
on validity wins it; where the two are even on validity, the one that wins more on the objective;
where they are even on that too, the one that wins more on the bill; otherwise the task is a tie,
and its difference is the deciding rule's own count of pairs. Ties leave the test. A comparison
records the bill's floor at its start (`cost`), and one begun before 21 October records none and
reads its pairs won on validity and the objective added up, with no bill.

Where the check program declares an **objective** (a quantity its evaluator computes from a valid
answer, with a direction: `brief.objective`, `objective(request)`, verified after the checks pass;
`OBJECTIVE`, `src/kernel/verify.ts`), two valid answers in a pair are compared by it, and the better
one wins the pair where the two are at least the room floor apart (`ObjectiveRule`, `better`,
`src/kernel/compare.ts`; `ROOM`, 1% of the larger measure), and otherwise they tie.
The sign-flip test says whether a difference is believable, and the floor whether it is worth
counting: six tasks with room won by 0.01% read p = 0.016 and would promote. Validity is read first, so a refused
answer can never be the better one. The objective is public, in the contract and in the solver's
resources, and the report says how many tallied tasks it decided (`objective.decided`). The rule is
a term of the comparison, fixed at its start; with a check program that declares no objective,
pairs are decided on validity and the bill.

The **bill** decides between two valid answers: the solve that billed at least 20% less than the
other wins the pair (`COST`, `cheaper`), and the report says how many tallied tasks it decided
(`cost.decided`). A pair with an answer that is not valid reads no bill, so an answer that fails
fast is never cheaper. A task the reference closes on validity and the objective leaves no room in
supply (`informative`), so a harness that only bills less wins it as a retained task, read in the
same test, and the Examiner is still asked for tasks the reference fails.

**The test.** A one-sided paired sign-flip test reads each task's difference in pair wins (`flipP`,
`src/kernel/compare.ts`). If the harnesses were interchangeable, each untied task would be as
likely won as lost by its margin, and p is the share of sign assignments that sum to at least what
was observed. It is exact, and where every task is won or lost by the same number of pairs it is
the sign test.

The step is read on every tallied task in one test: the **frontier**, the scored tasks that are
not exhausted, and the **retained** tasks, fixed alongside them at the comparison's start from the
exhausted tasks and the tasks of an earlier epoch the reference never stood in. So a gain on new
tasks can offset a loss on old ones. The report gives the two sets' tallies apart, so a loss on the
retained tasks shows; an empty retained set reads `unmeasured`, never "no loss". Each family's
tallies stand beside both, from the same rows; they show concentration, and prove no independence.

One reading decides (`stepOf`): a test at or under the level (0.02 by default: 6 to 0, 8 to 1,
10 to 2, 12 to 3; at 0.10: 4 to 0, 6 to 1, 7 to 2, 9 to 3) reads `step` and promotes. The
null hypothesis is the fixed-task one, in which each drawn task is as likely won as lost on fresh
solves. Every reading prints its untied count, the smallest share of those tasks it detects four
times in five (`detectable`), and the chance that one reading at its margins reads a step between
equal harnesses (`falseRate`), never more than the level. A reading of `step` counts for the stop
rule as a move that showed a gain. The level is recorded in the campaign's opening, so a campaign
is read by its own rule whatever the tree's default is, and a trigger an older opening holds is
read past. Two other ways to read a tally are in the plan ("Statistical power
and cost"); neither is built.

**The reading** is one of these words (`Reading`, `src/builder/comparison.ts`):

| Reading | Meaning |
| --- | --- |
| `step` | The test cleared its level |
| `no-step` | A test was made and did not clear its level |
| `not-scored` | No task was tallied, or the cap cut the test short. Nothing was tested |
| `check-defects` | The comparison stopped on its check defects |
| `no-change` | The session left nothing new to compare |

`not-scored` and `no-step` are different results: one tested nothing, the other tested and found
no gain. Older reports may hold `regressed`, `narrow`, `below-starter` or `starter-unread`, which
no comparison writes now and none of which promotes.

**Rejections.** A rejected answer counts as not valid only once the Referee has ruled it `earned`,
which it can only do on a probe that moved a refusing check off its refusal
(`src/review/referee.ts`). A ruling of `check-defect` or `unclear`, or no ruling at all, sets the
task aside for both harnesses. A person's labels then settle it (`settle.ts`), and a label
overrides a ruling. Once more than `--defects` tasks have a check defect or a check that could not
run, the comparison stops, because the check program then needs its owner before more is spent.

**The budget.** A campaign runs at one budget, the one its setting names. The binding units are the
model's own turns, told to the solver on every tool result and enforced (`--solve-model-turns`; a
solve that uses them all without an answer ends `turns-ended`), and the wall of a solve
(`--solve-minutes`). A time limit on each command bounds a turn. The prompts a solver gets before a
solve stops without an answer are the same for every solve (`LIMITS.turns`, 24), and no solve on
record has hit that bound. A comparison is read at the single budget its solves were told: a
reading at a shorter budget would describe a solver that was told the longer one.

**Beside the test.** The report shows:

- how each harness did on its own (`valid`: on how many tasks every solve, some or none were
  valid);
- which tasks entered each of its two sets;
- its overlap with the previous comparison of the same two harnesses;
- where the contract declares an objective, the median relative gain by it on the frontier tasks
  the new harness won, over those with a valid measure on both sides (`objectiveGain`): a pair
  keeps only the sign of a difference, so this gives a step's size. The closing report prints it
  beside each promotion's tally, and nothing decides on it.

Beside every comparison of four solves per side stands the reference read against itself, on
halves of its own solves mirrored in time. It should read no step; its tie share is the noise every
comparison has to beat, and its flip rate is how often two solves of a task disagree. The
A/A is read two-sided at the comparison's level, since which half is which is arbitrary. Every A/A
stands as a reading and ends nothing: the climb counts it beside the false-promotion estimate
(section 1, factor 2). An older log may end `control`, an ending no command writes now.

**The dollar cap.** `--cap` is required. Before each solve the comparison's billed dollars are
summed from the log, and the solve does not start if a reserve for it and for every solve in flight
would exceed the cap.

**Room.** A comparison's report says how much room a harness has to gain (`roomOf`,
`src/kernel/reports.ts`):

- **room** where a task was informative for the reference harness (`informative`,
  `src/kernel/compare.ts`, the same definition `try_task` uses to admit a draft):
  - valid on some of its solves and not all;
  - one of its valid answers bettered by the objective by at least the room floor, by another of
    its own, by the other harness's or by its author's on record (`bettered`);
  - valid on none where a valid answer to it is on record: another harness's, a reference solve's
    at the gate, or its author's;
- **too hard** where neither harness gave a valid answer and none is on record;
- **none** otherwise: a task the reference fails in every solve that nobody has answered among them.

So the two routes to room are the tasks and the objective.

**After the test.** A comparison that wrote its report is finished: run again, it returns that
report.

The **stop rule** fires after as many moves in a row that could have shown a gain and did not as the
campaign's patience (`stopRule`, `src/kernel/reports.ts`; `--patience`, six by default). A move that
counts is one of two kinds:

- a harness a session changed, once against one reference, read by the last comparison of the two,
  where that comparison tallied a task and left room;
- a whole session that left its harness unchanged where a practice solve of it failed (a session
  whose every practice solve passed had nothing to work on).

A control, and a comparison that scored nothing or left no room do not count. A pair that read a
step has shown a gain, and only the moves since the last promotion count, so patience never ends a
campaign that has earned one. The next comparison or session is then refused, unless the operator
gives a reason to go on (`--past-stop`).

A task with no valid answer in two comparisons goes to a person as possibly infeasible, unless one
of these holds:

- a valid answer for it stands anywhere on record: a solve's; the one whose pass the host saw for
  its author's answer on the task under its own id, before or after the proposal; or a stored
  pack's answer that passes today's checks at `prepare` (`task.feasible`);
- its wall or its context cut its solves short (`poolOf`).

A solve that used every model turn `--solve-model-turns` names is not a cut, unless the window or
the provider ended its last turn (`windowEnded`, `providerFailed`; an older log records such a
solve as `turns-ended`). The turns are the budget, so such a solve counts as a fail, just as a
wrong answer does.

Promotion writes `harness.promoted`: the campaign command does where the rule names a harness,
outside `--hitl` (section 3), and otherwise the operator's `promote.ts --yes` does. A comparison
that names no `--reference` is made against the harness last promoted, and one that names a digest
is made against that harness and promotes nothing.

**What follows a reading** is move 7's decision (`decide`, `src/builder/decide.ts`), and the view
prints it as its last line. The table has ten rows, asked in order (`ROWS`); the first that names
a move chooses it, and the decision carries that row's code:

1. `stop`: a stop the operator left ends the campaign.
2. `exam`: the exam does not stand. It is drafted where the campaign opened from a prompt, read
   where nobody has read its checker, and the campaign ends where the reading shows a fault that
   nobody froze or admitted.
3. `bound`: a bound is spent: the budget; the provider (three sessions in a row that crashed before
   they held out a task or changed a harness, section 6); the stop rule; a comparison stopped on its
   check defects or cut by its cap.
4. `tasks`: the tasks are not set up yet. A pack's tasks are taken in, practice is released, and
   tasks are written where the campaign has none or the operator asked for others, and before the
   first comparison up to a comparison's target plus the practice the release still draws from
   them.
5. `unfinished`: a comparison that began and has not reported continues. An Examiner session that
   holds out no task counts towards the patience.
6. `step`: a comparison against the reference that read `step` names the harness to promote, the
   newest such where several wait (`unpromoted` says why another is not; older logs name the row
   `twice`).
7. `no-room`: the last comparison the reference was in left it nothing to gain, whichever side it
   took: no task informative for it, or none either harness answered. The Examiner writes tasks it
   fails; there is no shorter budget to fall back to. After a promotion that reading is the
   comparison the harness was promoted on, and the row names one Examiner session for the new
   reference whatever room that reading left, which the host starts beside the conversation once
   the action that promoted returns, since the comparison a harness is promoted on reads room on
   it by construction.
8. `short`: the gate would refuse the next comparison for lack of tasks (`refusals`,
   `src/builder/admission.ts`), or the pair's last comparison tallied none. The Examiner writes
   tasks first, since a changed harness can only tie again on tasks the reference closed.
9. `unread`: something no comparison has read yet is compared: a harness whose sessions have run,
   and the tasks held out since the last reading (`programs-of:` remains a checkpoint name for an
   audit by hand). Where no session has left any harness except the
   reference, those tasks are read by a **control** before a Builder session is paid for: the
   starter compared with the reference on them, which shows whether they leave it room.
10. `build`: otherwise the Builder builds.

Two holds are then applied to the move a row named (`HOLDS`), and a decision a hold changed
carries the hold's code:

- `practice` releases practice before a Builder session;
- `unshown` sends for tasks where the last session changed nothing and was shown no failed practice
  solve.

One count ends a campaign that cannot be given tasks or room (`roomless`): the readings in a row,
up to the end of the log, that left nothing to gain. A reading here is either a comparison against
the reference that left it no room, or a whole Examiner session that held out no task. At the
campaign's patience it ends `no-room` where the Examiner was asked for room, and `exam` where it
was asked for tasks, as for a campaign that holds none. The comparison that raised the need does
not answer it and is not counted. A comparison with room, a promotion, and a session whose tasks no
comparison has read yet each reset the count.

## 8. Rules

Cite a rule by its number in a pull request or a review.

1. **The comparison decides, and nothing else does.** A harness is better when a comparison reads a
   step. A practice result, a Builder's account, a reviewer's opinion and a passing test suite say
   nothing about which harness is better, and none of them may set or adjust a reading.

2. **Only the Examiner writes the exam, and nobody coaches it.** No person and no other agent
   writes or repairs a rule, a check or a task. That includes you: never hand-edit a pack, a check
   program, a task, a kept harness or a log to make a command pass. A defect that shows across
   domains is fixed in the host, a prompt or the contract code. A check ruled defective goes back to
   its author. For a campaign that opens from a prompt, the Examiner drafts the exam once, before
   its first task, and the host holds each draft to a reading without a model; no seat repairs a
   check afterwards.

3. **Nothing crosses the wall except the closed list of section 1.** The test is exact: changing a
   hidden value, a check, or which held-out task was won must leave every message a Builder or a
   solver reads byte-identical. For a Builder that test is in the suite (`test/builder.test.ts`,
   "what crosses to the Builder"): two campaigns that differ in every such detail, one session over
   each, and every context and every file of its home compared. For what its campaign tools tell it,
   the test is `test/builder-led.test.ts`, "tells the Builder the same whichever held-out task was
   won": two campaigns with equal tallies in which different tasks were won. A change that touches
   such a message says in its pull request how it checked this. Withholding applies to everything an
   agent can read: prompts, tool descriptions, tool results and the files in its home.

4. **Terms are fixed before the first solve and never moved after a result.** The tasks, the solves
   per side, the level, the cap and the prediction are logged first. Do not top up a set that a
   dispute thinned, or rerun a finished comparison on other terms.

5. **Both sides are solved afresh under one setting.** No stored solve stands in for a side.

6. **One solve is weak evidence.** The same harness fails a task once and passes it the next time:
   in v1's record a fail repeated on the same bytes 5 times in 21. A fail, a win or a loss counts
   when repeated solves support it. Say so wherever a single result is shown to an agent.

7. **A non-result is never a pass or a fail.** A provider failure, a sandbox crash, a kill, a check
   that threw and a verifier that could not decide are typed, solved again where the solve's side
   failed, and counted nowhere. A broken harness is the opposite case and counts as the harness's
   own fail: as a non-result it would be rerun into the same break, and the harness would drop out
   of the score with it. An environment failure belongs to the environment's owner, never to an
   author. A solver's flag that a task is malformed is its side's own fail for the same reason: if
   it counted nowhere, it would take a task its harness was losing out of the tally. It is reported
   separately.

8. **A rejection counts only once it is ruled, and a hand label overrides a ruling.** In v1, 36 of
   47 rehearsal misses came from a faulty check or instrument. The passes were sound: 5 of 1,411
   were overturned.

9. **No reference answers, no stronger solver, no agent built to find answers.** A check verifies a
   property, which is easier than finding an answer, so a check can be right on a task nobody has
   solved. v1's solver matched whatever its author's side found.

10. **No agent writes an instrument.** The facts a check compares come from the field's own tool: an
    analysis engine, a compiler, a simulator, installed and pinned by digest. Nothing in the system
    writes or edits one. A check decided by its author's own computation is listed as a fault until
    the operator admits it, by name (`--admit`) or every such check at once (`--admit-authored`);
    a declared objective is read as one more such check. The reading names each check's
    instrument by the tools it runs, or `author`. So an exam that no engine decides, which includes
    every drafted one, stands on the operator's word for each check: a launch without `--hitl`
    gives that word for every such check, in a drafted exam or a stored pack.

11. **The host owns every limit.** A harness, a prompt or a file that asks for a longer wall, more
    turns or more disk changes nothing.

12. **One owner for each decision and one reading for each fact.** Before adding a check, a flag or
    a reader, find the one that already exists and change it. Where two places decide the same
    thing, the pull request that notices it names both and removes one.

13. **Add machinery only on evidence, and rewrite rather than add.** Build a mechanism when a live
    result shows the need for it. A gate earns its place by changing a decision correctly; given the
    choice, remove or widen a gate before adding a wall. Map each new concept as
    `owner → live reader → decision it changes → evidence → hostile test`, and drop it when a link
    is missing. A fix rewrites the owner and the neighbouring code its old shape bent, and the
    change that supersedes a mechanism retires it: a pull request that gives a decision a new owner,
    makes one rule the fallback of another, or answers a failed run with a row, a threshold or a
    sentence, deletes what it replaces in the same change, or names under "Not done" whatever still
    reads the old path. An overhaul leaves its part simpler, as the skill `reduce-complexity`
    measures it.

14. **Stop when nothing can be learned.** A launch that cannot give a result is refused before it is
    paid for. A comparison that tested nothing says `not-scored`. A comparison of non-results gives
    an operational result and says nothing about a harness. Do not remeasure a dead provider just
    because budget remains.

15. **Credit and session limits are expected, and are not defects of the system.** A login running
    out of credit or reaching its session limit is part of the development process, like a host
    restart. Keep what was recorded, classify the affected work from its events, and continue from
    the log at the run's own commit once the login has room again, or under another login (section
    10, item 9). A named reset is waited out in code (`waitOut`, `tools/d2/host.ts`); a crash
    without a named reset counts towards the crash rule (`crashedRun`) and ends a campaign on its
    environment, which is a pause and not a result. Such an ending is not a failure of any
    mechanism: do not patch, triage or report it as one, do not count it against a change, and do
    not spend a pull request on waiting it out. A generic 429, a timeout or a crash that does not
    name a limit is a different matter: investigate the failure itself.

## 9. Status, evidence and claims

`.claude/skills/attribution-and-proof/SKILL.md` owns what a single reading may be said to show, and
the form of its report. This section holds what applies to every statement, in a pull request as
much as after a run.

### The ladder

Do not use the words "built" and "done" for status. A part stands on one level, and a statement
about it names the level:

| Level | Meaning |
| --- | --- |
| Planned | In the plan only |
| Present in source | In the tree at a named commit, with its live reader |
| Proved without a model | A test with its nearest hostile case, a replay of recorded logs, or a rehearsal on a seed |
| Exercised live | An event in a real run's log shows that the mechanism did its work there |
| Shown in an outcome | A reading that moved, repeated once on fresh solves |
| Withdrawn | Analysis, a review or a run showed that it does not work. The entry stays, with the reason |

None of them stands in for the next. The four middle levels are the skill's, and the plan uses the
same words. The plan keeps the level of each part, and a pull request names
what it moves: in `docs/plan.md` that is the level column of its open rows. Keep no second status
list: not in this file, not in a new file, not in a code comment.

### Evidence

```text
events in a campaign's log  >  a fold over the log  >  source and tests  >  a command's printed line
                            >  a pull request's text  >  an agent's account
```

- A prompt assertion proves text, a type proves a shape, and a test proves the conditions it
  tested. None of them proves that a model behaves better.
- A rehearsal (`bun run runs rehearse`) puts a script in each model seat except the Referee's,
  which it leaves empty, so a scripted rejection is set aside unruled. It proves that the path runs
  and writes its events, and nothing about a model.
- A test suite that passes on one operating system says nothing about the other. The OS wall has
  two mechanisms, Seatbelt and Bubblewrap, and each is exercised only on its own platform.
- A Referee's ruling is a model's output. Keep it apart from the verifier's verdict and from facts
  about the environment.
- A session report or a subagent's report is a lead until it is checked as section 11 says.

A negative claim about capability, such as "nothing checks X" or "the admission does not refuse
Y", is the most expensive kind to get wrong, because every later reader compensates for a defect
that may not exist. Make one only with the named symbol, its call sites, and a check run in the
same turn.

### What may be claimed

| Claim | Requires |
| --- | --- |
| A step | A comparison that read `step`, named with its condition: the setting, the tasks, the solves per side, the level, the budget and the starter it was read on. One comparison is one draw: a step promotes on its own reading, with the reference read against itself beside it, and the word is used without qualification only once a later reading of the same pair on fresh solves holds it |
| No step | The same naming, plus the size of the test. `no-step` says that a test of this size found no gain. It says nothing about equality |
| A mechanism | The event it writes, in a live run's log, where its trigger occurred |
| A refusal | The refusal's text. It establishes its own condition and nothing about the answers |
| Which part of a harness did it | A checkpoint against the control `programs-of:<digest>`, which is the starter with only that harness's installed programs |

`step` says that under one condition the new harness won more tasks than it lost against the
reference, by validity or by the contract's objective, by more than the level leaves to chance. It
does not say that the harness is better under another wall, budget, solver or host, or that the
solver designs better: a harness that installs an engine the public rules name saves the solver its
set-up time, and under a short wall that reads as a step.

Keep the counts apart in every sentence: valid answers; rejected answers, by ruling; solves that
ended without an answer, by how they ended; non-results; and tasks set aside for a label. A rate
has a denominator, and the tasks left out of it are named beside it. Results are never compared
across campaigns, or across two settings.

## 10. Runs with a real model

A run with a real model spends the operator's money and needs the operator's word for that run. A
launch request authorises the runs it names, and no other run beside them. The skills own the
procedure:

| When | Skill, under `.claude/skills/` |
| --- | --- |
| Deciding what to run next, and reading what a run showed | `run-improvement-campaign` |
| Testing a path before spending | `system-path-simulation` |
| Starting, continuing, pausing or stopping a run | `run-management` |
| Wording a claim afterwards | `attribution-and-proof` |
| Doubting a reading, or asking what a fail was | `whole-run-investigation` |
| Reading the harnesses a campaign keeps, before a promotion or a handover | `harness-audit` |
| Reading the promotions on record, and tuning the promotion rule | `promotion-tuner` |
| Handing runs, or a question, to someone outside | `zip-run`, `oracle-handover` |

`/goal` (`.claude/commands/goal.md`, kept from v1) carries one of the operator's objectives across a
session's turns. It states the contract, measures the position on evidence and names the next
step, until every result has current evidence or the next action needs new authority. The product
works the same way without a command: a campaign goes on to a typed ending (section 3), and each
Builder continuation restates its goal (`src/builder/prompt.ts`).

What holds in all of them:

1. **The worktree is the condition.** A run executes the source of the worktree it started in.
   Launch from a clean worktree at a published commit, kept for that run alone. Do not edit `src/`
   there while the run lives, and move its folder only as section 5 says.
2. **Prove the path first, without a model**: a dry run of the campaign command
   (`bun tools/d2/harness-builder.ts --name <name> --dry-run`), a replay for a changed reader
   (`bun run runs replay`), and a rehearsal over a seed for a changed round or campaign
   (`bun run runs seed`, `bun run runs rehearse`).
3. **Put one prediction on record before the first solve** (`--predict`), written so that a
   recorded count settles it. A prediction written after the first solve started is a description.
   The campaign command takes no `--predict`, since its comparisons are the Builder's to ask for: a
   prediction for a campaign goes in the ledger of the session that starts it, before the first
   solve.
4. **One or two rounds at a time on one host.** A wall counts the clock, and a loaded host shifts
   every solve's time.
5. **Never open, print or copy the file passed as `--env-file`**, and name no account or credential
   path in anything that is published.
6. **Do not stop a run to fix it.** Work found while a run is live is work for the next start.
7. **Read the log's events and the report before any agent's prose**, and resolve the prediction as
   held or falsified, with the count that settled it.
8. **Report every attempt that started as spent**, including the unsuccessful ones.
9. **A measured run opens a fresh project and climbs on its own.** A run whose promotions are read
   opens a new project from a prompt (`--prompt-file`): its Examiner drafts the exam, the starter is
   its first reference, and nothing is billed before its opening. It runs at the commit it opened at
   to a typed ending, with no help along the way. A seed, a fork, a campaign over a stored pack and
   a run continued at another commit all start with an exam, a promotion or code they did not earn,
   and their promotions count for nothing. A run continues from its log at its own commit after a
   pause, a host restart or a change of login. A fix is measured by a new fresh run, never by
   continuing a live or stalled one at the fixed code. Seeds and stored packs remain for rehearsals
   and replays, which prove a path and show no climb.

A solve and a Builder session run on either host, behind Seatbelt on macOS and Bubblewrap on Linux.
Nothing caps the disk of a solve, a Builder session or an Examiner session on either host: each runs
its commands under the command wall in a root of its own on the host's disk, which is removed with
whatever still works in it when the seat ends (`src/verify/seat-root.ts`). When the required wall is
unavailable, the result is a typed non-result, never an unconfined run.

Each seat's wall (a solve's, a Builder's or an Examiner's) is probed once per process before its
first use, by one command launched the way a seat's commands are (`runWalled`). The probe checks
that a canary in the repository and the `package.json` of its first other worktree, which the
probe never writes, are refused, and that a file written in the seat's own folder reads back. A
probe that fails refuses the start and prints its lines (`walledBase`, `src/solve/command.ts`). The
verifier's cells share that base, are launched without the seat's shell, and are not probed; the
suite tests them (`test/verify.test.ts`).

Every seat's commands can reach the network: a solver and a Builder install what a task needs and
can look things up, under both harnesses alike (`network`, `src/verify/solve-sandbox.ts`). Only
the verifier's cells run with the network closed. The condition does not record it separately,
since it does not vary between the two sides of a comparison; whether to narrow it to a package
index is an open row in the plan (`docs/plan.md`, "Tuning", the row "Network in a solve").

## 11. Working in the repository

### Runtime and commands

Bun 1.4.3 only, as `package.json` pins it, for every task including one-off inspection. No Node,
npm or npx. `src/meta` wraps the few Node surfaces Bun lacks (`tools/oxlint/HABITS.md`, 12.8).

| Command | What it does |
| --- | --- |
| `bun run typecheck` | `bun check`, Bun's port of the TypeScript 7 checker, over `src`, `tools`, `vendor` and `test` |
| `bun run lint` | Oxlint, type-aware, with the two repository plugins and the not-slop ledger applied. `-- --strict` makes plugin findings fail the run |
| `bun run format` / `format:check` | Biome writes, or checks |
| `bun run test -- <paths...>` | The suite through its wrapper. Never bare `bun test` |
| `bun run simplify` | The whole-tree scans, as a census to read |
| `bun run not-slop` | The ledger of answered findings: status, `-- answer <id> "<why>"`, `-- prune` |
| `bun run gate` | The gate in one command: a frozen install, the UI's own gate, the format check, typecheck, the strict lint and the suite. `-- --static` runs the tests one import away from what HEAD changed instead of the suite, and the UI's gate without its browser test files unless HEAD changed `packages/ui` |
| `bun run hooks:install` | Points this clone's `core.hooksPath` at `.githooks`, once; every worktree shares it |
| `bun run commit:check` | What the pre-commit hook runs, also by hand: author email, format and lint of staged files, the slop report, the secret scan |
| `bun run secrets` | The secret scan |
| `bun run runs <verb>` | `fresh`, `launch`, `continue`, `keep`, `pause`, `copy`, `fetch`, `retire`, `stop`, `source`, `status`, `logins` (or `usage`), `on`, `hosts`, `pulse`, `rehearse`, `seed`, `replay`, `zip`, `view`. A verb that names a run goes to the machine that holds it |
| `bun run ui:dev` | The page that shows a campaign as its log reads, on the loopback with a token (`packages/ui/README.md`). `-- --exam-side` adds the exam side's content: start that only where no Builder or solver runs |
| `bun run ui:gate` | The UI's own gate: its dependencies, its typecheck and build, and its tests under `packages/ui/test` |
| `bun .claude/skills/stack-pr/scripts/stack.ts` | The open stack: every edge, and the top |
| `bun run follow` | Moves this checkout to the top of the open stack (GitHub's native stack, else the longest chain of bases), on `stack-pr<N>` reset to the top's branch: a commit made on it is not kept, and the earlier `stack-pr` branch is deleted. Uncommitted changes to tracked files come back, and it installs where `bun.lock` moved (`.claude/skills/stack-pr/scripts/follow.ts`) |
| `bun run land -- <pull request>` | Proves every commit a landing would publish, where it sits; `--sanitize` posts each verdict, `--merge` also merges ("The stack and pull requests") |
| `bun tools/loc/source-policy.ts` | The size and unused-export policy. No package script, CI job or hook runs it (`tools/oxlint/HABITS.md`, 12.10) |

The gate is what CI runs, and `bun run gate` runs it: CI's two Darwin jobs in one command, cheapest
step first. The strict lint fails on everything a plain one does, so it runs only once. Run it
before any delivery that a push does not cover.

**Keep the hooks enabled.** `bun run hooks:install` sets them up once per clone. Without it a commit
goes unchecked and a push ungated, silently (`git config core.hooksPath` tells you which). The
pre-commit hook runs `bun run commit:check`. The pre-push hook gates the work a push adds
(`tools/runtime/pre-push.ts`): each new commit gets the static steps and its nearby tests over a
checkout of its own, and the pushed head holding the newest of them gets the whole gate. A push of
documentation alone gets `git diff --check`. A pass is remembered by content: a whole pass by the
commit's tree, and a static one by its tree and its parent's, each with the gate that ran and the
Bun version, so a restack that keeps every tree runs nothing again. `ANA_GATE_FRESH=1` ignores
remembered passes. One push of a clone runs at a time: a push started while another is at its gate
waits for it, and then gates only what that push did not publish (`queue`); where that push
replaced the head this one is stacked on, it is refused with the `git rebase --onto` that restacks it
(`staleBases`). A failure names the commit, the step and the `--fixup` that repairs it; its log is under
`git rev-parse --git-path ana-gate`.

Run one full suite at a time on a host; two overlapping suites each take about twice as long, and
`bun run land -- <top> --jobs N` shares one host's workers between commits instead. While editing,
run only the owning test files: `bun run test -- test/compare.test.ts`. The wrapper refuses a named
path that does not exist, because Bun would treat it as a filter and silently run its neighbours.

CI (`.github/workflows/ci.yml`) runs on `main` and on the top of a landing, where
`bun run land -- <top> --merge` dispatches it; pushing to a pull request starts no run, since only
the top's run is read. It has three jobs:

- `darwin`, on macOS 15, installs the UI's dependencies so that the lint reaches `packages/ui`,
  then runs typecheck, lint, the format check and the suite;
- `darwin-ui`, on a macOS 15 runner of its own, runs the UI's own gate, in three separate steps;
- `linux`, on an Ubuntu VM, installs Bubblewrap and runs the suite, then the climb simulation,
  which the suite skips without `ANA_CLIMB` (`ANA_CLIMB=1 bun run test -- test/climb.test.ts`).

Every step after the install runs even when an earlier one failed, so one run names every failure.
In a container without user namespaces the tests that need the wall fail. Name those in the pull
request as failures that occur without the change, and do not call the suite green.

### What you never touch

- `.ana/`: campaign logs, kept harnesses, launch receipts. Read them through the readers; never
  edit, move or commit them.
- A pack, a check program or a kept harness, by rule 2.
- `.env` and any credential. Never copy one from another checkout to make a command
  start.
- `vendor/`: `pi-coding-agent` and `pi-claude-bridge` are copies of upstream. A local change is
  marked in place and kept small. Biome and Oxlint both skip `vendor`.
- Installed dependencies: no patches, and no edits under `node_modules`.

### The stack and pull requests

`.claude/skills/stack-pr/SKILL.md` owns this procedure. Read it before you branch and again before
you push.

Every open pull request sits on one chain whose bottom is based on `main`, and several sessions
write at once. One chain, because pull requests beside each other on `main` cannot describe one
another, each pays the whole gate at its own head, and they land in whatever order the merges come.
A chain lands with one `bun run land -- <top>`, which runs the whole gate once, at the top.

v2 was built in `s-smits/anabasis-v2` until 11 October 2026, when it took over this repository,
v1's. A pull request number in text written before then, up to #235, refers to that repository,
while this repository's own numbers run to #140 for v1 and continue from there. New text that cites
one of v2's names it `anabasis-v2#N`. A cited v2 hash that does not resolve here was on one of that
repository's pull-request branches, rewritten before it merged.

In practice:

- **Read the stack every time**: before `git worktree add`, before opening a pull request, and
  before a push that rewrites a branch. `bun .claude/skills/stack-pr/scripts/stack.ts` prints the
  edges and the top; where `gh` has no GraphQL, `gh api repos/<owner>/<repo>/pulls` gives the same
  edges. The top is the end of the longest chain, which need not be the highest number. State no
  fact about the repository without the commit you read it at.
- **A new subject is a new pull request on the top of the chain**, never beside it, even where it
  depends on nothing below; its body says so. The same subject as one of your own open pull
  requests is appended to it. Skills go on the chain like code, and so does documentation that
  describes an open pull request, with the row of `docs/transfer.md` that the change moves. Only
  documentation alone (`AGENTS.md`, `docs/`) that describes no open pull request may go on `main`.
- **Another session's pull request changes only on the operator's word**, which a request to fix it
  gives. A pull request with children takes new commits only.
- **One worktree per pull request**, from the top, pinned by commit, with its own
  `bun install --frozen-lockfile`. Never branch in a worktree a run was launched from. Never use
  `git stash` by hand: it is shared between worktrees, and `bun run follow` pops only the stash it
  pushed, by its commit.
- **Every commit passes alone.** Fold a fix into the unpublished commit it corrects. The pre-commit
  hook runs `bun run commit:check`; run it by hand where the hooks are not installed.
- **Push your own branch**, never `main`. Push with `--no-verify` only where the operator says so,
  and then `bun run land -- <top> --sanitize` proves the commits the hook skipped. Rewriting a
  published branch takes `--force-with-lease` on the head you last saw. The pre-push hook gates the
  commits along each pushed head's first parents that no remote-tracking ref holds. A commit whose
  patch the replaced branch held is a rebase's replay, left to `bun run land`. History brought in
  through a merge's other parent was made elsewhere and is only counted; the merge itself is gated.
- **Merging is the operator's call**, and so is restacking the whole stack. A stack lands through
  `bun run land -- <top> --merge` (`tools/runtime/land.ts`), never through a local merge pushed to
  `main`, which leaves the pull requests open. It reads the chain of bases down to `main`, requires
  each head to contain the one beneath it, and proves every commit it would publish over its own
  checkout, with the whole gate on the top's head. `--sanitize` stops there and posts each verdict
  as the status `ana/commit`. `--merge` also waits for `ci.yml` on the top's head, posts
  `ana/stack-gate` on every head, and merges the top through GitHub's asynchronous merge, pinned to
  its gated head, which merges the native stack beneath it all or nothing; the merge commit's tree
  must match the top's. A landing of several pull requests is refused unless they are one native
  stack, its members up to the top the chain of bases.
- **A restack makes the stack one chain again** (restack, linearize, quench, drain): each pull
  request that left the chain is replayed onto the head beneath it, based there and added to the
  native stack. Resolve conflicts hunk by hunk, never by taking one side's file whole, which drops
  the other side's hunks, and push each moved branch through the gate with a lease.
- **The native stack.** Setting a base alone leaves a pull request outside GitHub's stack ("can be
  stacked"). `gh stack link <pr> <pr> ...` (the `gh-stack` extension) makes one, bottom to top, and
  `gh stack link <stack> <pr>` appends above its top; it never removes or reorders a member, and it
  sets the bases. `gh stack unstack <stack>` dissolves a whole stack. `gh api
  repos/{owner}/{repo}/stacks` lists them.

A commit subject is one imperative sentence that states the finished change: "Refuse a comparison
on a checker nobody has read". The body says what was wrong and what happens now, with the counts
that show it. It never narrates a revert.

A pull request follows the writing principles in section 13 and the body guidance in
`.claude/skills/stack-pr/SKILL.md`, section 7. The skill owns the structure and examples; headings
serve the explanation and are not a form to fill in.

Name what misbehaves: the campaign command, a round, a reader, the Builder. The file that holds it
goes in the evidence underneath. A change with no defect behind it says so in one line. Rewrite the
title and the body after every push that changes the pull request, and leave a short comment on
each pull request it turns back or retires.

### Reviews and subagents

Launch parallel subagents from the current session in one message, one bounded task each, with no
coordinator. Each prompt names its authority, the exact paths and commit, the observed facts, the
question and the required output, and says read-only unless the operator asked for changes. Give a
reviewer the code, and keep your conclusion to yourself.

A review reads the code first and the runs second, and so does the check of any finding before it is
acted on or repeated, whoever reported it. Read the owner, its callers, its test and its head
comment until each claim is a sentence a recorded log can settle. Then put each claim to the newest
runs it touches before reporting it: a reader through `bun run runs replay`, a campaign through
`tools/wri/wri.ts` or `bun run runs view`, an event kind by counting it in the logs that hold it.
Write what the log should show before you look. Report each finding as confirmed, with the campaign
and event that show it; plausible, from the source alone, with the run that would settle it; or
refuted. Name the runs read and those left unread. A subagent's report is checked by the session
that launched it, which then acts on what held, within the task's authority: a confirmed finding
left in a report is dropped work.

## 12. Code that passes the first time

Most lint findings here can be prevented by habit, and the habits are in `tools/oxlint/HABITS.md`:
the compiler's settings, how lint runs and what to do with a finding, the rewrites that pass first
time, the two plugins' rules, the owners in `src/meta`, the whole-tree scans, the size policy and
how to write a test. Read it whole before writing the first line of code; a change that writes no
code can skip it. Whatever you write:

- The gate (section 11) runs the lint strict. Add no finding, and give the strict count in the
  pull request.
- Never turn a rule off: no new `"off"` in `.oxlintrc.json` and no `oxlint-disable` comment for a
  plugin rule. A finding that is wrong about a site is answered in the ledger, or by tuning the rule
  in a change whose subject is the lint (`HABITS.md`, 12.2).
- Every runtime surface has one owner in `src/meta` (`HABITS.md`, 12.8); `node:` is imported
  nowhere else.
- Reuse before you derive. Before writing a fold or a reader, find the production owner that
  already reads the fact and call it (rule 12), and take the angle to reuse one wherever you see
  it. Dependencies run one way. Production is `src/`, `vendor/`, `packages/` and the commands under
  `tools/`; helper code is `.claude/` (the skills and their scripts), the whole-run
  investigation's reader, `tools/wri/`, and the studies' code, `studies/`. A helper imports
  production readers and wraps them, and production never imports a helper. Where production
  needs a fact a helper computes, the fact moves into a production owner and the helper imports it
  from there.
- A file has at most 800 nonblank lines and a function 115, and every `export` has a reader in
  another file (`bun tools/loc/source-policy.ts`, which reports vendor only).
- A test checks what a message carries, never how it is worded: the facts it states (an outcome, a
  count, a limit), and what the wall keeps out of it (rule 3), checked by its absence. A sentence of
  a prompt is checked by reading the composed prompt (section 13); a test that fails when a sentence
  is reworded proves the wording and nothing about what a model does.

## 13. Writing

Plain, understated European English, in commits, pull requests, comments, prompts and messages to
the operator. Use simple academic prose: a clear question, a concrete mechanism, evidence and its
limits, explained in ordinary words. Write for a careful colleague who has not
read the conversation.

- Lead with the change and a plain verb: "This PR fixes…", "Adds…", "Removes…", "Replaces…". Pick
  the verb a person would say (hide, skip, drop, leave out, refuse) instead of folding a negation
  into the object: "Hide seeded campaigns" rather than "List no seeded campaign", "skips the link"
  rather than "follows no link".
- State what changed and what remains, with exact results and the axis named: "12 cases passed,
  0 failed", "1,281 of 1,386 programs". No "robust", "bulletproof" or "10x", no celebration, no
  emoji, no exclamation marks.
- Say what a thing is. Write "X instead of Y" or "X rather than Y", and "one owner instead of five"
  rather than a sentence built on a negation and its correction ("not five owners, but one").
- State a limit early, and name the owner of a decision.
- A title names the changed behaviour in a short imperative sentence. Explain the implementation
  in the body instead of putting its full sequence or every exception in the title.
- Explain why a mechanism matters before naming its files. Use ML concepts where they clarify the
  change: practice as training exposure, held-out comparisons as evaluation, repeated outcomes as
  solver variation, and billing as economy. Infrastructure work says what it enables; it does not
  imply better learning or a measured performance gain. Keep ordinary tooling descriptions plain.
- No em dashes. Put identifiers, paths and commands in inline code. Use British spelling.
- Distinguish tests, recorded observations, retrospective estimates and remaining uncertainty.
  A scripted test can prove delivery of a prompt; observing the model's response needs a live
  model. One simulation is one observation, and an estimated saving is not a measured reduction.
  Preserve counts, baselines, conditions and limitations when rewriting. Attribute earlier checks
  to their recorded commit and runner, and say when they were not rerun or their location is unknown.
- Scale the structure to the change. Use connected paragraphs, bullets for parallel changes and
  tables for comparisons. Do not add authorship labels or stock closing claims.
- Use the fixed terms of section 14, each with one meaning. Suffix an ambiguous name with what it
  belongs to: "the Builder session b-2", "comparison g2", "the buffer campaign".
- A head comment explains why the code is as it is: the defect it answers, the record that showed
  it, and the date. It is the module's manual; keep it true in the change that alters the code.
- A prompt for an agent states facts and limits, each once, in the place that owns it: the system
  prompt for what holds all session, the opening message for the campaign's state, a tool result
  for what that call found. When the same interface failure recurs, fix the schema or the tool
  instead of adding another sentence.
- Dates are absolute: "9 October". Words such as "yesterday" go stale in a record. This file and
  the skills state how things are now; when a mechanism changes, rewrite the sentence that
  describes it, and leave its date and history to the commit, the pull request and the head
  comment.

## 14. Terms and map

### Terms

| Term | Meaning |
| --- | --- |
| Campaign | Everything run for one query: one domain, one contract, one check program, one log |
| Project | What the operator files campaigns under, named at a campaign's opening (`--project`) and kept by it |
| Contract | The one public document: the rules, each with an id, and the answer format |
| Check | A hidden program that tests one rule on one answer and returns pass or reject |
| Instrument | The field's own tool that computes the facts a check compares |
| Control | An answer with a known label, used to test a check. The do-nothing answer, the smallest the format allows, is one for every task |
| Held-out task | A task the Builder never sees. Only held-out tasks are scored |
| Practice task | A task released to the Builder. Once released it is never scored |
| Valid answer | An answer that passes every check, submitted within the limits |
| Rejection | An answer at least one check rejects: a true fail when the answer is wrong, a check defect when it was right |
| Hand label | A person's verdict on one rejection: `earned`, `check-defect` or `unclear`; or on one answer that passed: `sound`, `wrong` or `unclear` |
| Built Harness | The directory the Builder edits (section 3), a harness for short: the part of a solving system that is built, compared and promoted. The Starter Built Harness is the first, and every reference after it is one a promotion named: a harness a Builder built, or one the operator imported (`import.ts`) |
| Solver | The model that answers a task, fixed by the setting. It runs only inside a harness, and the two are one system |
| Reference harness | The harness a new one is compared with: the starter until a step is promoted |
| Comparison | Both harnesses solve the same held-out tasks; each task is a win, a loss or a tie |
| Round | One Builder session followed by one comparison. A session may also run on its own, without a comparison after it |
| Checkpoint | One comparison of two kept harnesses, without a session |
| Step | A comparison in which the new harness wins significantly more tasks than it loses |
| Setting | Who solves, under which limits, and which tasks are scored: recorded once in the log (section 6) |
| Condition | Everything that could change a solve's result, as one record with an id |
| Session | One bounded stretch of an agent's work: a Builder's ends with a frozen harness version |
| Trace | The record of one solve: every model turn and every tool call with its result |

### Map

```text
src/kernel/     the log, tasks, conditions, traces, the verifier's contract, the comparison, the reports
src/solve/      one solve: the starter, the prompt, the command wall's tools, the answer file
src/builder/    a Builder session, its tools, prompt, notes and what it is told of the past; the round,
                and what the log holds of a comparison (comparison); whether a comparison may start
                (admission); the one reading of a campaign (handover);
                the move that follows from a log (decide) and the reading of the log it is asked
                of (ground), what a campaign runs by (opening), the words the operator left it
                (word), and the letters people read for its harnesses (names)
src/examiner/   an Examiner session, its prompt, and the outcomes and counts it is told; the
                session that drafts an exam from a prompt (draft); the walled home both
                sessions have (shell)
src/review/     the Referee, the probe, agreement with hand labels
src/verify/     the OS wall: Seatbelt, Bubblewrap, a seat's root, what each actor may read
src/backends/   the three model backends as one pi collection, and compaction
src/meta/       the owners of every runtime surface (`tools/oxlint/HABITS.md`, 12.8)
tools/c/        the check program: accept, carry, rejections, repaired
tools/d1b/      examine, draft
tools/d2/       campaign, setting, prepare, round, session, checkpoint, settle, promote, import; exam,
                which stages a drafted exam as a pack; close, which writes what a campaign hands
                over; harness-builder, which opens a campaign and makes its moves to a typed
                ending, or keeps its Builder's conversation to one; campaign-terms, the flags and
                what a campaign runs by; campaign-actions, the tools through which a Builder that
                leads its campaign asks the host; host, where each solve waits for the load, the
                reserve or a named reset; and word, which leaves the operator's word for a running
                campaign
tools/runs/     the registry of runs, the receipt, launch, continue, pause and copy (manage), fresh, keep,
                stop, pulse and status, logins, hosts, rehearse, seed, view, replay, zip
tools/wri/      the whole-run investigation's reader of one log: its folds and the exam side's lanes
                (folds), the other lanes, the rows and the overview (read)
tools/oxlint/   the two lint plugins, the ledger, the whole-tree scans
tools/runtime/  the lint and test wrappers, the commit check
tools/loc/      the size and unused-export policy
packages/ui/    the page over a campaign's log: a server on the loopback that renders the folds
                above and reads nothing for itself (src/server), and four panes, Campaign, Moves,
                Tasks and Log (src/views). It writes nothing. Its design rules are in its DESIGN.md
vendor/         pi-coding-agent and pi-claude-bridge, copied
docs/           the plan, the transfer ledger, the account of v1, the helper prompts
studies/        measurements outside a campaign's reading, one folder each: its protocol, predictions,
                adapters and patches; shared/ holds what several use, runs/ the records each keeps,
                and external/ (ignored) the clones. A log, a benchmark's tests and a credential are
                never kept
.claude/skills/ the procedures (section 10), stack-pr, simplify, reduce-complexity, commit-r,
                codex-gpt-swarm and promotion-tuner, and main/ with the skill scripts' argument
                parser and git helper
.ana/           campaign logs and kept harnesses; ignored, and never edited by hand
```

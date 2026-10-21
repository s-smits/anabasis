# Whole-run investigation lanes

This file is the whole catalogue: six deterministic rows the primary reviewer settles itself, and
thirty-one lanes a paid session can be given, one question each. Read the stance below before any row
or lane, because every one of them is written from it. `tools/wri/catalogue.ts` parses this file,
and `test/wri-catalogue.test.ts` holds it to `TRIGGERS` in `tools/wri/folds.ts`: every trigger the reader prints
is named in the `Starts from` paragraph of the lane it starts.

## Who holds which pen

v1's Builder wrote its own exam, and v1's catalogue was written from that: no verdict was an
independent measurement until a lane had said which part of it the Builder did not write. v2 took
the pen apart, and each part has its own way of going wrong.

`AGENTS.md` sections 1 to 8 own the seats, their views, the wall and the promotion rule. Apply
those rules to the campaign's recorded conditions. A stored pack supplies an imported exam;
for a campaign opened from a prompt, the Examiner drafts the rules, checks and controls first.
No seat repairs the check program during a campaign. In task-writing mode, `try_task` admits
drafts by the reference harness's room, including an author's valid answer on record. A pass
establishes what the check reads; weigh that instrument before treating it as domain correctness.

Six readings follow from that, and every row and lane applies them.

- **Weigh each verdict by its instrument.** A check that runs the field's own engine establishes
  more than one that runs its author's computation, and the label in the brief is the author's
  claim about which it is. Name the instrument before relying on the verdict.
- **Name the bytes.** A solve ran under one condition: a contract, a harness digest, a task
  version that holds the check program's hash, a verifier tool tree, a sandbox, the host's code.
  Two solves under conditions that differ in more than the harness are not a pair.
- **Keep the kinds of ending apart.** A valid answer, a rejected answer, a solve that reached its
  limits with no answer, and a non-result are four things. Only a rejected answer says anything
  about a check and needs a ruling; a solve with no answer is not valid with none; a non-result
  is solved again and is in no pair.
- **A ruling is a reading.** The Referee's agreement with a person is unmeasured until hand labels
  exist, and an earned ruling that probed nothing restates the check. Count rulings as a reviewer's
  and say so.
- **A comparison is only its untied tasks.** A tie carries nothing, a flip is the solver's
  variance, and a task left out for one side's rejections is that side's loss removed.
- **Separate what was observed from what is inferred.** Every finding states the recorded
  observation and the cause it proposes as two sentences, so a reader can keep the first while
  rejecting the second. An earlier diagnosis is a hypothesis for the lane, never its premise.

## How the catalogue is read

A lane is started by a trigger: the capitalised text before the first colon of a line that
`bun tools/wri/wri.ts read` prints, with the lane's number beside it. A trigger says a lane has
something to read and never what the answer is, so a lane that contradicts its trigger with
evidence has done its job. Four lanes are standing and open on every campaign, triggered or not:
1, 15, 18 and 22. `selected` also opens them where no report exists. Lanes 5 and 19 are isolated:
each runs alone, only on its trigger, and freezes its result
before it reads any other report.

Nothing here changes a verdict, a task's state or a reading. A lane's product is a finding with
one owner, the exact evidence it cites and the observation that would reverse it. The owner is one
of these, and a finding names exactly one:

| owner | what it is |
| --- | --- |
| `pack/evaluator`, `pack/brief`, `pack/controls`, `pack/tasks` | the exam, stored or drafted, by file |
| `examiner/task` | an instance, as a session wrote it |
| `harness/guide`, `harness/tools`, `harness/tool-tree`, `harness/config` | the Built Harness, by part |
| `builder-prompt`, `examiner-prompt`, `reviewer-prompt` | what a role is told, with the file under `src/` named |
| `host` | the host's code, with the file named |
| `environment` | the machine or a provider |
| `operator` | a decision the plan leaves to a person |

Evidence is cited by event kind, solve id, the first eight characters of a version or digest, a
check id and a count. A report never carries a task's text, an answer, a hidden value or a passage
of a trace: the log holds all of them, and a report is read by people and sessions the walls were
built to keep them from.

Each lane body opens with exactly one paragraph beginning `Starts from`. The lanes fall into seven
groups: the exam's instrument (1–6), the tasks (7–12), the harness (13–19), the comparison
(20–25), the solve, its failure and its cost (26–28), the review loop (29–30), and the climb (31).

## Deterministic rows A–F

The primary reviewer settles these from the log before any lane is launched, and never delegates
them: they are the identities every finding binds to. `wri.ts read` prints them.

**A. campaign and log.** One campaign is one folder under `.ana/d2/<name>`: `log.jsonl`, the
staged `checks/` (`exams/<digest>/checks/` for a drafted exam) and `states/`. Read the log's first and last event, its sessions and its reports,
and confirm it folds: `read` throws on a history that moves a task where it cannot go. Compare the
host hash of the last condition with this checkout's (`wri.ts read` prints both): when they differ,
every statement about source is about another tree, and the report says so before it says anything
else. Row A gives billed dollars and hours by role, which lane 28 starts from.

**B. checker identity.** Read `contract.frozen` and every `checker.read`. The checker is two
hashes, the contract's and the check program's; a task version holds the second. A campaign with
nothing frozen has no frozen checker; inspect its readings and task versions. A reading at
other hashes than the frozen ones is of another checker. `despite` on a freeze is the operator's
reason for freezing over named faults: quote the count, not the reason's text.

**C. conditions.** List the conditions by side and model, and the number of distinct values of
each field. One contract, one sandbox, one verifier tool tree and one host hash is the clean case.
More than one host hash means the campaign ran under different source content; a comparison counts only
solves made since it began for that reason. Say how many finished solves name no response model: there the
served model is the provider's word and nothing attests it.

**D. task sets.** Partition the task versions: the pack's, a session's, carried from another
checker's campaign. Then by state: held out, released for practice, disputed, refused. The sets a
round uses must be disjoint: a version both practised and measured is lane 18's finding and is
settled here first. The row's last line counts the held-out tasks, which every comparison may
score, and the practice tasks. A task with no valid answer on record after two comparisons that
cut no solve of it at a limit is held out still and is left out of the scored set until a person
labels it; lane 8 names those.

**E. case partition.** For each side, count passes, fails by kind and non-results by kind from
`solve.finished`, the solves that started and never finished, and those open at the log's
end, which a later step's start or end, or the campaign's end, would have marked cut. A fail of kind `rejected` has a
verdict with the refusing checks; `wall-ended`, `turns-ended`, `context-ended`, `no-answer` and
`broken-harness` have none. Count `flagged` separately too. Recount
any figure a report quotes from these rows before a rate is read.

**F. sessions and the harness chain.** The campaign command's moves, its endings and its billed
dollars against its budget. For each Builder session: its parent, the digest it left, how it ended,
whether it changed anything, whether what it left opens, its practice solves and the reading of each
comparison of the harness it left, which a comparison names by its own session (`g-N`). For each Examiner session: how it ended, what it proposed and what stood
feasible. A session that started and never finished is refused by its round and is named here.
A step still open at the log's end is named on a line of its own, with its turns, what it held
out or practised and when it last wrote, or, for a comparison, its solves ended and open: the
campaign command records a move as it begins; use the step's own ending to establish closure.

## Lanes 1–31

### The exam's instrument

**1. Verdict chain: what a pass observes.**

Starts from `INSTRUMENT AUTHORED (lane 1)`, `REFUSALS BY CHECK (lane 1)` and from
`PASSES UNREAD (lane 1)`, which is standing: no reviewer reads a pass, so every campaign with a pass
leaves this open.

The question is what a pass establishes. The Referee reads refusals only, so a check that observes
too little is seen by nobody: v1's passes held up, 5 vetoes in 1,411, but v1 had a Judge reading
them and v2 has none. For each check in the last `checker.read`, read its row (instrument, the
controls it passed and refused, the reject controls naming it that it caught: counts of controls,
not of the campaign's answers) and the campaign's answers it refused, which `REFUSALS BY CHECK`
counts and which names the checks that refused none, beside the brief's entry for it in the campaign's
staged `checks/brief.json`: which fields of the answer it declares, which public inputs, which
rules it cites, and which tool it names. Then take a sample of passes, spread over families and
over both harnesses and weighted to the checks that refused none, and for each say from the published rules alone what the answer would have to
get wrong to still pass: a field no check reads, a rule no check cites, a tolerance wider than the
rule's. An `author` instrument computes with its author's own code, and what its pass means is
that the author's computation agreed. The row's instrument names the tools the check runs, or
`author` where it runs none (since 12 October; a reading of before holds the brief's
`evidence.kind`, a label, under which 5 of buffer's 7 `authored` checks ran an installed engine on
their author's input). A tool named is not yet a field engine: read from the check program what it
hands the tool and what it computes itself, and weigh its pass by what computed it. With no pass in the log,
the rows beside the brief are the whole lane, and the reading is what a pass would establish
were one taken; say that, and do not come back `could not read` for the missing sample. `wri.ts grade` puts one constructed answer to the campaign's
checker and writes nothing; use it to show a gap under the required verifier wall. Do not read a pass rate here. The
decision it changes is whether a pass on this pack counts as the solver being right or as the
answer having the checked shape; it routes to `pack/evaluator` for a check that reads too little
and `pack/brief` for a rule no check enforces.

**2. Verifier dependency closure.**

Starts from `VERIFIER TOOLS MOVED (lane 2)` and `TOOL MISSING (lane 2)`.

The question is which bytes decided the verdicts. A condition names `verifierTools`, the content
hash of the pack's tool tree, and a task version holds the hash of every file of the check
program. Between them is what neither hashes: the interpreter a check's tool runs under, a library
the tool loads from the host, a file the evaluator reads outside its own directory. Trace one
external check from its entry in the evaluator to the process that decides it and name each edge
by whether a hash in the log covers it. Two tool trees in one log mean verdicts given under
different instruments stand side by side: say which solves ran under which, and whether a round's
pairs straddle them, which is row C's and lane 20's to confirm. A tool the path lacks stops a run
and is named by `accept.ts` before any control. Do not rerun a check to see whether it agrees;
`tools/m0/regrade.ts` does that for a stored sweep. The decision it changes is whether two
verdicts may be compared at all; it routes to `host` (`src/kernel/verify.ts`,
`src/kernel/check-child.ts`) for an unhashed edge and `environment` for a tool that is not there.

**3. Check discrimination and controls.**

Starts from `NO CHECKER READING (lane 3)`, `CHECKER READ WITH FAULTS (lane 3)` and
`CONTROL COVERAGE (lane 3)`.

The question is whether each check has been seen to refuse what it should and pass what it should,
and whether the controls that would show it are still right. Read the last `checker.read`: its
faults and each check's row. `readChecker` and `acceptCommand` include control labels and
repeatability, pass and refusal coverage, named reject-control coverage, missing tools,
do-nothing answers and unadmitted authored checks, including the objective. Since 14 October
fresh controls establish current faults; stored verdicts are reported separately. A control fault
can be a stale control. Decide from the public rule, the control's label and its answer whether
the control or the check is wrong. A reject control tests the
fault its author thought of; coverage of one control per check says the check can say no, and
nothing about how often it says no wrongly, which is lane 4's. A check that could not run is one
fault that names it and never a request for another control. The decision it changes is whether
the checker can be frozen as it stands; it routes to `pack/controls` for a stale control,
`pack/evaluator` for a check that fails its own controls, and `operator` for a freeze given
`despite` faults.

**4. False rejection among fails.**

Starts from `REFUSED UNREAD (lane 4)`, `CHECK DEFECT RULED (lane 4)` and `RULED UNCLEAR (lane 4)`.

The question is whether a refused answer was wrong or a right one the checks refused. Every
reading of a comparison rests on it: a refusal that is the check's fault makes a win when it falls
on the parent and a loss when it falls on the child. Take the refused answers, the verdicts of
kind `fail` that name a check, and sort them by ruling: earned, check defect, unclear, unread. For
each check with refusals, decide from the public rule the check cites whether its rule, as
published, could reject a valid answer: a tolerance tighter than the published rounding, a unit
the check reads otherwise, a sentence that admits two readings with the check taking one. Then
read the rulings against that: an earned ruling names a rule and a field, a check-defect ruling
cites a probe in which both sides reached a verdict, and `EARNED WITHOUT A PROBE` in lane 30 says
how many earned rulings looked at nothing but the packet. Where a person labelled a sample
(`labels.json` beside a rejections campaign's log), set the rulings against the labels and say
whether the bar in `AGENTS.md` section 1 was cleared; where none did, say the rulings are one reader's.
Where public facts cannot decide, retain the logged ruling and ask whether lane 5 can settle it.
A rejection without an `earned` ruling sets the task aside; it does not become a scored fail. Report counts per check id
and never an answer or where it failed. The decision it changes is whether a round's fails are
read as the solver's limit or as the exam's noise; it routes to `pack/evaluator` for the check,
`pack/brief` for the rule's publication and `operator` for labels not yet made.

**5. Valid-alternative rejection challenge.**

Starts from `FAILS ON ONE CHECK (lane 5)` and `DEFECT RULED BESIDE PASSES (lane 5)`, and only when
lane 4 left a check undecided. It runs alone.

The question is whether a check rejects valid work, shown by construction. Freeze the corpus
before reading the evaluator, the Referee's probes or any other report: from the public rules and
a task's public input alone, write answers that are valid by the rules and differ from an
accepted one in a way the rules allow, a different valid design, a permitted rounding, an
equivalent unit. Record their digests. Only then put each to the campaign's checker with
`wri.ts grade`, which writes nothing, and report the two-by-two: valid by construction and
accepted, valid and refused, with the refusing check. A refused valid answer is a false rejection
with a witness, which a ruling is not. An alternative you cannot show valid from public facts
proves nothing either way and is dropped, with the count of those dropped. Do not use a solver's
recorded answer as a base where the task is held out. The decision it changes is
whether a repair of the named check is owed; it routes to `pack/evaluator`, and the corpus goes to
the checker's owner as the repair's accept controls.

**6. Checker identity, freeze and repair closure.**

Starts from `CHECKER NOT FROZEN (lane 6)`, `FROZEN DESPITE FAULTS (lane 6)`,
`READ AT ANOTHER VERSION (lane 6)` and `TASKS CARRIED (lane 6)`.

The question is under which checker each result was counted, and whether a repair closed what it
was made for. A campaign whose checker is not frozen can have its staged `checks/` edited between
two rounds with nothing refusing it; only the task versions would show it, as tasks that silently
stop matching. For a campaign whose tasks were carried, read the campaign they came from:
`tools/c/repaired.ts` over the old log and the repaired pack gives the verdicts that moved and
the reading of them, withdrawn refusals by what was ruled of each, accepted answers newly refused,
ruled defects still refused, and the controls the repair broke. Say whether the repair moved only
answers that were read and ruled the old checker's fault, and what it left: `unrepaired` is a
defect ruled and not fixed, `unread` a withdrawal nobody can defend. Then read what `carry.ts`
did: every available task not refused is proposed under the repaired checks and put to the package
gate, with no solve. This includes disputed tasks and the pack's tasks. Any task ever released
for practice is released here too; another that passes is held out. A new refusal changes only
the receiving campaign. Solves are not carried. The decision it changes is whether to use the
repair in another campaign; read the two separately and explain changed verdicts from the repair
reading; it routes to `operator` for a freeze not given or a
repair adopted against its reading, and `pack/evaluator` for a defect left standing.

### The tasks

**7. Supply and the gate.**

Starts from `SUPPLY THIN (lane 7)`, `GATE REFUSED (lane 7)` and
`SAFEGUARD-8 PROMOTION ON AUTHOR ROOM (lane 7)`.

The question is where tasks are lost between a proposal and the scored set, and whether the gate
that refused was right to. v1's gate audit kept 30 of 54 refusal codes at its bar of 98% sure
that what was refused was wrong (`docs/transfer.md`); ask the same here. `packageGate`
checks the package's shape. Where `try_task` is available, `gated` also runs three fresh
reference solves and uses `informative` to decide room. It holds a draft the reference answers
sometimes; one it never answers with the author's valid answer on record; or one whose valid
reference answer is beaten by an answer on record under the objective. For each refusal read `task.gate`
and say whether it named a real defect and whether the Examiner could have acted on the reason it
was given. Then read what leaves the set after the gate: tasks disputed on a check's fault, tasks
refused by a person as infeasible, and tasks waiting for a label (lane 8). Read the campaign's
target and level: `SIZE` defaults to 24 frontier tasks and four solves per side, with retained
tasks alongside. `refusals` requires at least `sweepOf(level)` frontier tasks. Say how many it
holds against those terms. Do not propose loosening the gate from the yield alone. The
decision it changes is whether another Examiner session is bought before the next comparison; it
routes to `examiner-prompt` (`src/examiner/prompt.ts`) where the Examiner was not told what the
gate needs, and `host` (`src/kernel/task.ts`) where the gate refuses on something that is not a
defect. `SAFEGUARD-8` names a promotion whose frontier clears its level only with the tasks
the gate held on their author's answer alone: every reference solve valid and alike, and the
author's answer better than each by the objective. The room on such a task is the author's
answer as the author's objective measures it, so read those answers and the objective before the
promotion is reported: r3's second and third promotions (19 October) read 5-0 and 3-0 without
them, where a step at 0.02 takes 6-0.

**8. Tasks no harness answers.**

Starts from `NO VALID ANSWER (lane 8)` and `AWAITING A LABEL (lane 8)`.

The question is why a task has no valid answer under either harness: it is hard, it is wrongly
checked, or it has no valid answer at all. No stronger solver proves a task possible now, so the
exam can hold a task nobody can do, and it ties whatever the harnesses are. `NO VALID ANSWER`
counts the scored tasks whose last comparison held none. `AWAITING A LABEL` names the ones with
no valid answer anywhere on record after two comparisons that cut no solve of them at a limit:
they are out of the scored set until a person labels each with
`tools/d2/prepare.ts`, `--keep` or `--infeasible`. Read each by how its solves ended. Solves that
reached their limits measured the budget: compare what they used with what the valid solves of
other tasks used. Rejected answers are the case with two readings, and the rulings on them say
which: a check that rejects every answer is a check defect on the task, and a task whose every
rejection is a true fail may be infeasible, which no ruling on one answer can show. v1's record
is that most rejections were the check's: 36 of 47 rehearsal misses. Do
not label a task from the count alone. The decision it changes is the label each waiting task
gets; it routes to `operator` for the label, `pack/evaluator` where the rejections are a check's
fault, and `examiner/task` for an instance whose own limits exclude every answer.

**9. Whether validity separates.**

Starts from `TIES BETWEEN VALID ANSWERS (lane 9)` and
`SAFEGUARD-9 PROMOTION BY THE OBJECTIVE ALONE (lane 9)`.

The question is whether a valid answer within the budget tells two harnesses apart.
`TIES BETWEEN VALID ANSWERS` fires where more than half the tallied tasks tie and at least one
answer on each side is valid. An objective is already supported where the contract declares it;
read `score.points` for what the objective and the bill gave the tallied tasks (`objective.decided`
in a report begun before 21 October). Two valid measures tie within the room floor, `ROOM`, 1% of the
larger magnitude; a comparison begun before 21 October recorded none and read them at `SAME`. A report
written before 11 October also holds `spread`, how far the use of turns, CPU seconds and seconds
moved between repeated solves of one harness on one task, which decided the budget's unit; the
unit is the model's turns, and no trigger reads it since. Seconds move with the host's load,
which each `solve.started` and `solve.finished` records. `SAFEGUARD-9` names a promotion whose
frontier on validity alone does not clear its level: the objective decided it, as it did
all three of r3's. In a drafted exam the objective is its author's own computation
(`INSTRUMENT AUTHORED`, lane 1), so the claim is "better by the objective", and the objective's
arithmetic is what a person checks first. The decision it changes is whether
the declared objective measures domain quality, and how a promotion is worded; it routes to `operator`.

**10. Ties and the budget.**

Starts from `TIED TASKS (lane 10)`.

The question is what share of the tasks tie and why. A tie says nothing, and the share of untied
tasks is what sizes every later comparison. With two solves a side and no true difference, 38%
of tasks tie when a solve is valid half the time, 51% at four times in five and 69% at nine in
ten. These are historical two-solve illustrations, rather than the four-solve default.
`TIED TASKS` gives each comparison's ties and how many of them had no valid
answer; the rest are ties between valid answers. A report written before 11 October also holds
the same solves read at each shorter budget the comparison fixed (`budgets`), which no trigger
reads since: that reading was of a solver told the longer limit, and on 9 October the starter
answered 0 of 10 solves read at two turns and 10 of 10 once it was told two. v1's limit never
bound: six tasks passed in 2.5 to 26 minutes of a 120-minute limit, and 265 of 299
batteries passed whole. Say what demand the tied tasks make: v1 measured that requirements
sharing one limit lowered pass counts, 7 of 20 against 22 of 23, where a tightened limit and a
widened exam did not. Do not prescribe an instance. The decision it changes is the size of the
budget the setting names and what the Examiner is asked for next; it routes to `operator` for
the budget and `examiner/task` for tasks every harness answers.

**11. Public disclosure and one recipe.**

Starts from `PASSES AT A SMALL WALL SHARE (lane 11)`.

The question is whether the task, the public resources and the tools publish a sufficient
construction, so that solving is following it. The lead is passes at a small share of the wall in
one sequence of calls: v1's firmware passes came at 1.5% of the wall, and 8 of 12 submissions were
the draft the solver had before its first simulation. Read the call sequences per family from
`solve.call` (tool names and order, never arguments): one ordered sequence across every pass of a
family is a recipe. Then read what publishes it: the contract's rules, the resources a solver is
handed, the harness's guide and the tool descriptions. A rule that states the acceptance
arithmetic lets the solver compute every check on its own candidate, and v1 measured that a task
a written search reaches is a task passed, at any size. Keep this apart from lane 15: there the
harness does a check's work, here the exam's own public text does. The decision it changes is
whether these tasks can measure a harness at all, since a recipe leaves nothing for a guide or a
tool to add; it routes to `pack/brief` for a rule that publishes the method, `examiner/task` for
an instance whose public input settles it, and `harness/guide` only where the recipe is the
Builder's.

**12. Pressure on the Examiner.**

Starts from `OUTCOMES BY SESSION (lane 12)`.

The question is whether anything moves the Examiner toward tasks that separate harnesses,
session over session. v1 pressed its Builder with zones, targets, slack figures and a
reference-distance pointer, and removed each after measuring it: every one pointed the author at
one route. Read the Examiner's current inputs in `AGENTS.md` section 3 and `record.ts`: outcomes
and recent histories, gate results, family counts, valid-answer turns, the solve budget and,
unless `exam-reference` is off, the reference harness. It gets no target or other harness's
task result. Read which inputs each session actually received. `OUTCOMES BY SESSION` gives,
for each session's held-out tasks, how many
the reference harness answered in every solve, in some, in none, and how many no comparison has
scored, as they stand at the log's end, beside the reports the session opened after: one that
opened after none heard no outcome, and its tally is no effect of the channel. Read them in session order, and what changed in the instances between sessions:
families, the number of requirements meeting in one limit, sizes. The public inputs are in
`task.proposed`; describe how they differ and quote none. An author told the reference failed a
task can reach that outcome with tasks whose solves vary widely in what they need: such tasks
split evenly and add nothing, so set a session's outcomes beside lane 24's reading of the reference
harness against itself. Do not propose telling the Examiner a share, a target or a level: v1
measured that. The decision it changes is whether the Examiner's inputs are revised before
another session; it routes to `examiner-prompt`, and to `operator` for the reading.

### The harness

**13. Harness delta against its note.**

Starts from `HARNESS CHANGED (lane 13)`, `BROKEN AT END (lane 13)` and
`MEASURED AN EARLIER STATE (lane 13)`.

The question is what moved between the parent and the child, and whether the measured bytes are
the ones the Builder described. Every state a session left is kept by digest under the campaign's
`states/`. The first parent is the Starter Built Harness (`writeStarter`); read the parent
digest and its kept state rather than assuming a stored sweep supplied it. Where a state is
unavailable, say the diff could not be made. Diff the two part by part: the guide, the tool spec, the tools module, the config, the tool
tree; `harness-versions.ts --diff` of [harness-audit](../../harness-audit/SKILL.md) counts it.
Describe each change by its kind and size; quote no line. The note is in `harness.version`: say
whether what it claims is what changed. When the final state did not open, the round measured the
last state the session practised with, and the note describes edits that were never measured:
name the edits made after that practice from `build.call`. The host ignores `agent/config.yaml`:
confirm limits from the condition. A session that wrote with its shell
leaves no `write` or `edit` call (`write_file` before 2026-10-09), and the row's list names only
`.toolchain` where a shell command named the tool tree: the list is no inventory of the child,
which the diff alone gives, and an empty one is not an unchanged harness. The
decision it changes is what a step, or its absence, is attributed to; it routes to
`harness/guide`, `harness/tools`, `harness/tool-tree` or `harness/config` for the part that
moved, and to `host` (`src/builder/session.ts`) when the measured state is not the one the log
names.

**14. Operating guide and roster truth.**

Starts from `NEVER CHECKED (lane 14)`, `TOOLS CALLED (lane 14)` and `TOOL CALLS ERRED (lane 14)`.

The question is whether the guide, the tool descriptions and the tools' replies tell the solver
the truth. Read the child's guide and spec beside what solves under it did: the tools each
solve called, in what order, how many calls returned an error, and whether a tool the guide leans
on was ever called. An erred call is any non-zero exit, and a test the harness ships may report
what is unmet that way by design, as all 44 erred calls under buffer's child did on 12 October:
read what each call printed before counting it a tool that failed. A tool no solve calls is dead weight in every prompt; a tool most solves call
once and abandon promised something its reply did not give. Compare the guide's account of how
the tools combine with the sequences solves actually ran. A guide is appended to the solver's
prompt on every task, so a line that is true of the practice tasks and false of the domain costs
on every scored one. The round's prompt is the host's, in `src/solve/prompt.ts`, and its wall
sentence is the host's claim: check it against the condition's limits. Do not judge the solving
method. The decision it changes is whether a failed solve failed the task or was misled; it
routes to `harness/guide` and `harness/tools`, and to `host` for a sentence of the solver's
prompt that the condition contradicts.

**15. Check mirroring in solver tools.**

Starts from `TOOLS EDITED (lane 15)`, and is standing: it opens on every campaign.

The question is whether anything in the harness answers for the solver. The Builder's prompt
(`src/builder/prompt.ts`) holds one limit: nothing in a harness answers a particular task, since a
harness is measured on tasks it never saw. Since 20 October a program or tool may run the field's
engine, search for candidates, test them against the public rules and report which meet them, and
the solver decides what it writes to `answer.json` (operator, 20 October; until then a part that
both proposed a candidate and judged it was read as the limit crossed). Inspect the contents for
that limit rather than inferring compliance from `check_harness`. Read every tool and program in
the child and in the parent: what it takes, what it returns, and whether anything in it names a
task, copies a task's text or holds an answer to one. A search and a filter against the public
rules are allowed; a part keyed to a particular task is the limit crossed, and `ANSWER FROM A
PROGRAM` (lane 19) reads from the log where a program's output was submitted unchanged, which is
a lead to read and no finding by itself. Then read how solves used each part from `solve.call`,
and count under each harness the solves that submitted what a search reported. The Builder cannot
have copied a check it never saw, so a mirror here is rebuilt from the public rules, and whether that
is a fault depends on lane 11: where the rules publish the arithmetic, the tool only saves the
solver the typing. The decision it changes is whether a gain is the harness helping the solver
work or helping it ask; it routes to `harness/tools` and `harness/guide`, and to `builder-prompt`
(`src/builder/prompt.ts`) when the ceiling's sentence did not prevent it.

**16. Finish decision against practice evidence.**

Starts from `NO PRACTICE (lane 16)`, `FINAL BYTES NEVER PRACTISED (lane 16)` and
`SESSION ENDED (lane 16)`.

The question is what the Builder did with each practice verdict before it stopped. Read the
session's `build.call` rows in order: edits, `check_harness`, `practice`, the ending and record
each practice returned, and the task's record under this harness and under the parent. Read
the Referee's rulings separately from the log; the Builder did not receive them. A session that edited after its last practice was measured on
bytes it never tried; one that never practised was measured on belief. The trigger reads this by
digest: a practice solve's condition names the state it ran under, so the harness that was
measured either is one of those states or is not, whichever tool made the last edit. The Builder is told one
solve is weak evidence and to read the record: say whether it practised a task again after a
change, and whether it decided beforehand which tasks a change should move. A session cut at its
wall or its turns is a whole session and is compared; say how many practice solves and turns it
had left. Read the gap between the last edit and `finish`. The decision it
changes is whether a no-step is read as the change not helping or as the change never having
been tried; it routes to `builder-prompt` when the session's order shows it was not told what
practice is for, and to `host` (`src/builder/session.ts`) for limits that ended a session mid
edit.

**17. Follow-up of earned fails.**

Starts from `PRACTICE FAILS (lane 17)`.

The question is whether a fail that was the solver's led to a change that answered it. v1's climb
step was a fail, a harness change that answers it and the same task passing; in its record a fail
led to a change once in six chances, and its second blocker was that an earned fail was not
followed up. For each practice fail ruled earned, follow it: what the Builder changed next (the
part, from `build.call`), whether the
same task was practised again under the changed harness and how it came out there. A pass on the
next solve after a fail with no edit between them is a flip and answers nothing: the trigger
counts the later passes under changed bytes apart from those under the same bytes. A fail ruled a
check defect is not the Builder's to build around and leaves practice; one the Builder built
around anyway is a harness fitted to the exam's fault. Keep the count honest: fails, of which
ruled earned, of which followed by an edit, of which passed after. Until 11 October a Diagnoser
named an owner and a first divergence for each earned fail, and a log of before holds its
readings (`diagnosis.recorded`): 20 of 20 named the solver, and the seat went
(`7f0add79:docs/simplify.md`, E1). The decision it changes is whether the session produced a change with a
reason, which is the only kind worth a round's solves; it routes to `harness/guide` or
`harness/tools` for a fail left standing, and `builder-prompt` when the fail was ignored.

**18. Exposure: what the Builder could see.**

Starts from `PRACTISED TASK MEASURED (lane 18)` and `SHELL COMMANDS (lane 18)`, and is standing.

The question is whether the child could know the exam. A harness that carries the scored tasks'
answers scores higher on exactly those and is no better on any other. Settle the sets first, from
row D: no version is both practised and scored. Then read what the session
could reach. Its shell has the network and its home; that home holds `harness/`, `practice/`,
the public resources and the other kept harnesses under `kept/`. A v1 state can carry a correctness
model with hidden values; `copyHarness` leaves it out at every depth. Confirm from the
session's commands that no path under a `correctness-model/` was read, and that no command walked
the host's temporary folder or the repository, which the wall denies. Read the commands for what
they fetched from the network. Then read the child for what it holds of the practice tasks: a
task id, a passage of a task, a value that is an answer. The Builder is told such a line moves
nothing that is measured, which is true of honest tasks and false of a leak. `read_trace` serves
practice solves only; confirm no refused call tried another. The decision it changes is whether
the round's reading is admitted at all; it routes to `host` (`src/builder/tools.ts`,
`src/solve/command.ts`) for a path the wall left open and `harness/guide` or `harness/tools` for
task content in the harness.

**19. Trace challenge.**

Starts from `WIN AT A SMALL WALL SHARE (lane 19)`, and only when lane 11, 15 or 18 suspects a
shortcut. It also starts from `ANSWER FROM A PROGRAM (lane 19)` on its own, which needs no other
lane's suspicion: that trigger counts the solves whose one shell call was followed by `submit`, with
no file-writing call, per Builder session's practice and per comparison. It is a lead that one
program may have made what the solve submitted. Each comparison's reference side is printed beside its new one as the
control, since a solver can finish a task in one command of its own; on the #107 campaigns none of
the 132 reference solves read so, and 24 of recode's 40 measured solves under its built harnesses
did. The lane's own table is what tells a harness's program from a solver's one command.
`WINS (lane 19)` lists each comparison's won tasks by solve, as the comparison paired them.
At this commit it also makes `selected` queue this isolated lane, even without suspicion; that is
the selection defect found on 20 October, with its fix in an open PR. The primary must decline
that lead alone and require one of the reasons above before building the lane. It runs alone.

The question is where the deciding value came from. Take the tasks the new harness won by pair
wins, which `WINS` names by solve. A task can be won by the objective with valid answers under
both harnesses, so the trigger's list of failed reference solves can be empty. For each, open the
new harness's solve: `solve.turn` and `solve.call` in
order. Show the step at which the answer's deciding value first appears and what produced it: a
tool's computation from the task's public input, the solver's own working, a line of the guide,
or nothing in the trace at all. A value that arrives whole in the first turn, on a task the
solver worked at under the reference harness and missed, has no recorded derivation at that point.
Freeze the table, win by win with the step and the source's kind, and open no other lane's report.
The primary compares the frozen table with lanes 15 and 18 afterwards. This lane
reads traces of scored tasks, which no Builder may see: its report stays with
the primary, names solves and steps, and quotes nothing. The decision it changes is whether a
win is the harness solving or the harness knowing; it routes to `harness/tools`, `harness/guide`
or `host`, by where the value came from.

### The comparison

**20. Pair identity and source reach.**

Starts from `HOST CODE MOVED (lane 20)`.

The question is whether the two sides of each comparison differ in the harness and in nothing
else. A condition is a content address: the contract, the harness, the task version, the model
and its effort, frozen prices, the runtime's pinned packages, the compaction mode, the solver's
and the verifier's tool trees, the sandbox, the limits, the host's code and the side. A
comparison counts a solve under one of its harnesses and its own setting, started after its
`comparison.started` event, and no solve made before (`src/builder/round.ts`). Confirm it from
the log all the same: for the counted solves of each comparison, list the distinct values of
every field but the harness and its `solverTools`, which may change with it. Then read what a
condition does not hold: load, recorded at solve start and finish, which `gated` in `tools/d2/host.ts` gates at
the start unless `--loaded` is named; the hour; the provider's
served model, which `responseModels` names or leaves empty; how many solves ran at once. The two
harnesses take the first place in turn, task by task, so neither has the quieter hours: check
the order of `solve.started` within the comparison. Where the host's code moved inside the
campaign, name the commits between the two hashes if this checkout has them. A campaign command
that ran names its commit, and whether the tree was dirty, in `launch-run-<n>.json` beside the
log. The decision it changes is whether a difference between the sides is the harness's; it
routes to `host` (`src/kernel/condition.ts`, `src/builder/round.ts`) for a field a condition
should hold and does not, and `environment` for load.

**21. The scored set and what left it.**

Starts from `SCORED SET MOVED (lane 21)`.

The question is whether the tasks a comparison tallied are the tasks it fixed before its first
solve, and whether what left favours a side. `scoredSet` draws from held-out tasks by epoch and
whether they were held since the previous comparison, then by the contract's hash. `poolOf`
uses reference outcomes to partition frontier and retained tasks and leaves awaiting tasks out.
The set is fixed before any result of this comparison and written into
`comparison.started` with the harnesses, the solves a side, the level and the cap.
`SCORED SET MOVED` fires when the tally holds fewer tasks than that event. A task leaves four
ways: `short` of its solves under a harness, a disputed task excluded through `taskStates`,
`withdrawn` when a person released or refused it while the comparison ran, and
`aside` on a rejection not ruled a true fail. The last is the one that can lean: a task is set aside for a rejection under either harness, so rejections that fall on one
side remove that side's losses, which lane 30's `SET ASIDE BY SIDE` counts. Read `counted` in
the report, the tally were every such rejection to stand, beside `scored`. A comparison asked
for again on other terms under the same id is refused; confirm no second `comparison.started`
carries the id. Until 2026-10-09 a round screened candidates and admitted the ones a harness
failed; a log from before then holds those admissions, and their tallies are of a selected set.
The decision it changes is whether the tally is of the set that was fixed; it routes to `host`
(`src/builder/round.ts`) and to `operator` for the labels that would return a task.

**22. Paired sign-flip test, ties and power.**

Starts from `NOTHING SCORED (lane 22)`, `CUT BY ITS CAP (lane 22)`,
`FEW INFORMATIVE PAIRS (lane 22)` and `SET SHORT (lane 22)`, and is standing.

The question is what the comparison's test could and could not have shown at its size. The paired
sign-flip test reads each task's score; a tie carries nothing. It reduces to the
sign test where all untied margins are equal. v1 found the signal too
rare to settle a comparison at the size it ran: 11 of 322 batteries held a fail nobody
contested. Read `scored` with its `differences`, p, `detectable`, `falseRate`, ties and
unanswered tasks, which the step tested since 20 October, and the frontier and retained tallies
apart (before 20 October the step, `detectable` and `falseRate` were the frontier's). Say
how many untied tasks there were and what the smallest result is that would have cleared the
level on those margins. `FEW INFORMATIVE PAIRS` fires when reversing the smallest positive
tested difference makes the reading miss its level; it also names `sweepOf(level)`.
It does not test every possible result containing a loss. A
comparison that tallied no task tested nothing and reads `not-scored`; before the report learned
to say so it read `no-step`, as the eight truss rounds of 8 October did. `CUT BY ITS CAP` names
one its dollar cap ended: it is finished, reads `not-scored`, and its solves are in no tally. A
`no-step` at four untied tasks is no evidence of no gain, and a `step` at five rests on five
tasks: say both plainly. One comparison of equal harnesses reads a step at most as often as its
level allows, 2% at the default, and since 19 October one step against the reference promotes,
so a campaign's patience of attempts sums that risk (until 19 October a step was repeated before
anything was promoted). Read the tasks left out through `short`, `aside`, `withdrawn` and
disputed task states, and
whether leaving them out could have moved the tally. The decision it changes is whether the
operator enlarges a future comparison or reads the result as it stands. A finished comparison
keeps its terms and is not topped up or rerun for another chance at a step; it routes
to `operator`, and to `host` (`src/kernel/compare.ts`) only for an arithmetic fault.

**23. The starter.**

Starts from `VALID BY HARNESS (lane 23)`.

The question is whether the tasks leave a harness room to add anything to the starter. The
Starter Built Harness is pi's coding agent with nothing added: pi's four coding tools, no guide
and no domain tool (`src/solve/starter.ts`). Before 2026-10-09 it was the solver with a shell and an
answer writer, and a log of that time holds its solves under another digest. The Builder forks it
in its first session, and it is the reference harness until a step is promoted, so the plan's first
round compares a built harness with it. `VALID BY HARNESS` gives each harness by itself, as the tasks by how many of their
solves were valid, none first: for the reference harness of the first round that is the
starter's own result. A starter valid on nearly every
solve has tasks too easy to show an improvement, and they are replaced before another session is
paid for where `decide` names that move. The Examiner is given facts rather than a target valid
share. After a promotion the starter can be the control: the tasks written for the promoted
harness are read by the starter against it before a Builder session is paid for, which is where
the plan reads whether the starter loses more each epoch. Until 11 October a step against a
promoted reference also solved the starter on the tallied tasks and read `below-starter` or
`starter-unread` off it; a report of before holds the words and its `against`, and no trigger
reads them. Read which tasks the starter answers that
a harness does not, by the solves' endings and never their text. The decision it changes is
whether a step is believed, and at the first gate whether the tasks are replaced; it routes to
`operator`, and to `harness/guide` or `harness/tools` where a harness loses to the starter.

**24. Flips and solver variance.**

Starts from `FLIPS (lane 24)` and `REFERENCE AGAINST ITSELF (lane 24)`.

The question is how much of the tally is the solver's variance. A task that the same harness
both answered validly and did not, under one condition, is a flip. v1 recorded a fail repeating
5 times in 21 on the same bytes, and in one truss run 13 tasks solved 59 times failed twice
with both fails passing beside them. Under a fixed budget a flip is also a solve that needed a
little more than the budget once and a little less the next time. `REFERENCE AGAINST ITSELF` is
the direct measure: at four or more even solves per side, `compared` splits the reference's
own solves into two halves mirrored in time, on the tasks the comparison tallied. It runs no
extra solves. Two samples of one harness should tie on most tasks and win as
often as lose; the tally's untied share is the noise every comparison at that budget has to
exceed. `readsStepEitherWay` tests either direction at half the level. The epoch's first A/A
that clears this two-sided test ends the campaign on `control` until the operator records a
cause; later A/As remain reports. Count the flips per
harness beside it. Where the new harness flips less than the reference on the same tasks, the
gain may be steadiness; where both flip alike, a win by one solve in two is within what one
harness does to itself. The decision it changes is how many solves a side a task needs, and
whether the budget's unit is fit; it routes to `operator`, and `environment` when flips cluster
in hours of high load.

**25. The chain of comparisons.**

Starts from `CHAIN (lane 25)` and `NO TASK HELD OUT (lane 25)`.

The question is whether the campaign is climbing: whether a step was found, promoted, and built
on. Read the chain: each comparison's reference harness, the harness compared with it, and its
reading. The starter is the first reference; a `harness.promoted` event names each successor.
Outside `--hitl`, the campaign command promotes the harness its rule names. A Builder session
starts from the latest harness a session left, step or
none, and the operator may send it back to an earlier one. So a chain of sessions each starting
from the last, all compared with the same reference, is the plan's design and no fault. Since
19 October one comparison that reads a step against the reference promotes its harness; until
then a step was repeated once on fresh solves first, and a log of before may hold a step no
second comparison of the same two harnesses followed, which promoted nothing. Row F's `campaign` line gives the
moves the command made, how it ended and its billed dollars against its budget. `patienceOf`
reads the opening's patience, six by default. `stopRule` counts changed harnesses once against
one reference by their last comparison that scored and left room, and unchanged whole sessions
shown a failed practice solve. A step is a gain; a promotion starts the count again. Controls
and readings with no score or no room do not count. A campaign with no held-out task measures nothing at all: eight rounds on the
truss pack ran so on 8 October, for over $220, and each could only read that no task was
scored. The decision it changes is what runs next:
a promotion, another checkpoint, an Examiner session, or a stop; it routes to `operator`.

### The solve, its failure and its cost

**26. Solver process and walls.**

Starts from `MISSES AT A LIMIT (lane 26)`, `WALL SHARE (lane 26)`, `HOST LOADED (lane 26)`,
`LOAD MOVED (lane 26)`.

The question is how the solver spent its walls, and whether a miss measured the task or the
wall. The limits are the host's, in the condition: the solve's wall, the turn cap, the shell's
default and maximum, and concurrency. `LIMITS` defaults to 20 model turns, 30 minutes and 24
prompts; read the solve's own recorded limits. There is no seat disk cap on either platform; until
19 October a Mac runner mounted a 2 GiB image per seat. A solve the wall ended is a fail in the count and a truncated
solve, never a settled failure of capability, and so is one its model turns or its context
ended. `MISSES AT A LIMIT` counts, for each comparison and each side, the misses that ended at
one of the three, with a call in the last turn their bound allowed (`last turn`), or past 95% of
the wall, with their kinds and the turn bound the solves were
told, and the misses outside any comparison on a line of their own: on 10 October recode ended
41 of its 58 scored misses on turns, 12 of 18 reference misses and 4 of 4 new in g-2 at 8 turns,
and a read of the wall alone saw none. A side whose misses are all at a limit was limited by
the recorded budget; each still counts as a fail. For each side, read the share of the wall a solve
used. Read the median share under the parent and
the child on the scored set, and say whether the child's solves got shorter, longer or the same
on the tasks both passed. Read `seconds` against the load at start and end. A wall counts the clock, so a loaded host holds less
work in it.
`HOST LOADED` names a comparison whose solves started, at the median, under a load over the
host's cores, where the log holds the cores (from 9 October). `LOAD MOVED` gives the median
load of each comparison's first half of solves and its second, by start, where the busiest half
ran under twice the calmest or more, within one comparison or across them: on 9 October one
harness answered the same tasks in a median of 105 s under a load of 31 and of 40 s under a load
of 6, so a step and its repeat, or two readings at one wall, were not made under one budget. A
`solve.finished` written before 11 October holds the CPU seconds of the solve's commands
(`cpu`), which the meter read only of the children a command waited for, as a floor where a
command was cut, and as zero under Bubblewrap; no trigger reads it since, and no budget was
given in it after 9 October. The prompts a solve is given are v1's cap on nudges and every
solve's: every finished solve of the first three rounds on 9 October was given one, and a
budget in `prompts`, which was a unit until then, read what the full limit read. Since
11 October a comparison is read at the one budget its solves were told. The decision it changes is whether a
wall-bound miss is the task's or the wall's, and whether a gain shows first in time; it routes
to `environment` for load, `harness/guide` when the guide sends the solver into work the wall
cannot hold, and `operator` for the wall itself.

**27. Failure mechanism and non-result honesty.**

Starts from `NON-RESULTS (lane 27)`, `SOLVE NEVER FINISHED (lane 27)`,
`EXAMINER NEVER FINISHED (lane 27)`, `MISSES WITHOUT A VERDICT (lane 27)` and `SESSION CRASHED (lane 27)`.

The question is, for every ending that is not a pass or a refused answer, which link broke first
and whether its kind is honest. A non-result is never counted and a solve-side one is run again,
up to three times; a fail counts against the harness. So the line between them decides a tally:
v1 excused timeouts as the environment's and could leave out a quarter of its cases, and a
harness that timed out more could look better. Here the wall, the context and a missing answer
are fails. Read each non-result's kind and reason: `provider` after its retries, `verifier`,
`check`, `moved-files`, `killed`. Say whether reruns fell evenly on the two harnesses, since a
side whose bad solves are rerun and whose good ones stand is favoured: `NON-RESULTS` gives each
comparison's count under the reference harness and under the others. A solve that started and
never finished, where the campaign went past it, was cut by a kill; its root may still be on disk.
So was an Examiner session with a start and no ending that the campaign went past: its id is
spent, and what it proposed before the cut is in the log and held out. Both triggers name what is
open at the log's end apart: it may be running or stopped, and `bun run runs stop` writes no
ending, and `bun run runs pulse` says whether its process is alive. A fail of kind `broken-harness` fails every task alike. For a session that crashed, name the turn and whether
its round was refused as the rule says. The decision it changes is whether a count is trusted as
written; it routes to `host` (`src/solve/run.ts`, `src/kernel/solve.ts`) for a kind that hides a
cause, `environment` for a provider or the machine, and `harness/tools` for a harness that does
not open.

**28. Time, spend and silence.**

Starts from `LONG SILENCES (lane 28)` and `SPEND LED BY A ROLE (lane 28)`.

The question is where the hours and the dollars went, and what each long silence was. Use
`spendOf`, which delegates billing to `billedAll`: ending records count closed work and turn
records count work without an ending. Drafting and `try_task` admission solves are the
Examiner's spend. Read metered and backend-reported amounts separately where the events hold
them. Say what share the reviewers took here and what their rulings changed, which is lane 30's.
Row A puts the hours by role beside the billed dollars: each Builder and Examiner session and
each comparison from its start to its end, a session a stop cut to the stop, and the rest of the
campaign's span as between moves; on 10 October recode's Builder took 52% of the hours against
43% of the dollars. `LONG SILENCES` reads every gap between two events longer than five of the
campaign's median measured solve, a pass or a fail, and never under ten minutes, and names the
five longest by what ended them: a command whose time covers most of the gap, a model turn with its output
tokens, or nothing open between moves. A fixed twenty minutes read nothing on buffer on
10 October, whose longest gap was 19.5 minutes; recode's two gaps over it were each an Examiner
turn of over 56,000 output tokens. For each silence, confirm what was running from the events on either side: a
solve at its wall, a Builder command, a provider wait, a machine asleep. Read the cost of one round at the plan's size
from this one's parts and say what the next costs. `AGENTS.md` sections 1 and 6 own economy and
the campaign's dollar cap. The decision it changes is what the next round is expected to cost and whether a role's
spend is earning its place; it routes to `operator`, and to `environment` for a wait nobody
chose.

### The review loop

**29. Triage: the harness, the rules or the solver.**

Starts from `REPLAY MOVED THE VERDICT (lane 29)`.

The question is which side each practice fail was on, and whether the successor repaired that
side. A practice fail is ruled by the Referee: earned, a check defect, or unclear. The
Referee's replay runs the checks again on the logged answer; a replay whose verdict differs from
the logged one is a check that does not repeat. Then read what the Builder changed after each
earned fail and whether it was the side that failed. Until 11 October a Diagnoser named an owner
for each earned fail, the harness, the public rules or the solver, and a log of before holds
its readings beside the rulings; 20 of 20 named the solver, and the seat went
(`7f0add79:docs/simplify.md`, E1). The decision it changes is whether the next change goes to the harness
or to the exam's owner; it routes to `reviewer-prompt` (`src/review/referee.ts`) for a ruling
that cannot be right, `pack/evaluator` for a check that does not repeat, and `harness/guide` or
`harness/tools` for a repair on the wrong side.

**30. Rulings, labels and what each role was told.**

Starts from `SET ASIDE AND UNSETTLED (lane 30)`, `READING MOVES WITH THE SET-ASIDE (lane 30)`,
`SET ASIDE BY SIDE (lane 30)`, `SETTLED BY HAND (lane 30)`, `REVIEW FAULTS (lane 30)` and
`EARNED WITHOUT A PROBE (lane 30)`.

The question is what became of each rejection, and whether each role was told enough to act and
no more than it may know. A rejected answer counts as not valid only once it is ruled a true
fail. One ruled a check defect or unclear, and one nobody ruled on, sets its task aside: out of
every tally of that comparison, for both harnesses. A comparison run with no reviewer sets every
rejection aside. So
read the tasks set aside. `SET ASIDE BY SIDE` counts their rejections under the reference
harness and under the others: a rejection under one harness removes a task that harness would
have lost, so rejections that fall on one side move the tally toward it.
`READING MOVES WITH THE SET-ASIDE` fires when the report's `counted`, the tally were every such
rejection to stand, clears its level and `scored` does not, or the reverse: the reading then
rests on labels nobody has made. `SET ASIDE AND UNSETTLED` counts the tasks still waiting. A
person settles a comparison with `tools/d2/settle.ts`: `packetOf` draws every rejection that
set a task aside, plus up to three earned rejections and three passes, blind to ruling and
harness. Until then its report says `settled: "unsettled"`, and no
promotion waits for it. A task whose rejections all stand as earned is restored, one labelled a
check defect is disputed for good, one labelled unclear or not drawn stays out, and the report is
written once more with `settled` saying what the labels did.
`SETTLED BY HAND` sets the two reports side by side. Read whether the labels were made from the
packets or from the rulings, and whether a task disputed for a check's fault was taken to the
checker's owner: a dispute removes a task and repairs nothing. The Referee's agreement with a
person is unmeasured until its rulings are set against labels made before it read
(`src/review/agreement.ts`); on the record of 9 October, which is not this run's, it ruled all 64
rejections then stored a true fail with no label to compare. Count this run's rulings from its log,
its earned rulings as a reviewer's, and those made without a probe as restating
the check. Read `referee.refused` events separately where present: no trigger currently counts
them. Count the rulings that recur: the same check ruled a defect across sessions is a
repair owed, and lane 6 reads whether one was made. Then read what each role was told. The
Builder is told a practice task's record and the ending's outcome and kind, with no ruling,
check id or reviewer's reason: confirm it from what `build.call` returned. Check the Examiner's
inputs against `AGENTS.md` section 3 and `record.ts`. The decision it changes is whether the Referee's rulings
may count without a person reading each; it routes to `operator` for the bar and the labels,
`reviewer-prompt` for rulings made without a probe, and `host` (`src/builder/tools.ts`,
`src/examiner/session.ts`) for a role told more than it may know.

### The climb

**31. The promotion and the climb after it.**

Starts from `PROMOTED (lane 31)`, `STARTER BARE (lane 31)`, `AFTER THE PROMOTION (lane 31)` and
`SHARED TEMPORARY FOLDER (lane 31)`. Where several campaigns are under review, it is given their
climbs side by side, in the columns `wri.ts climb` prints.

The question is whether a promotion measured what the campaign exists to measure, and whether the
campaign climbed from it. Lane 25 reads the chain and whether a step was promoted; lane 23 reads
the starter; this lane reads the promotion as one event with its cause and its consequence, and
it is the lane a person reads before saying a campaign has improved a harness. Read it in five
parts, and keep them apart in the report: a promotion can follow the rule exactly and still
measure little.

First the rule. `PROMOTED` gives the harness and its parent, whether the table promoted it (a
`campaign.move` of `promote` names it between the neighbouring promotions) or the operator did (`tools/d2/promote.ts`, which records
any faults it was promoted `despite`), and the comparisons it rests on, each with its tally, its
p, its level and the reference against itself. Say which rule the campaign ran under: a level
pinned in its opening terms, or none, so the tree's default. Until 19 October a step was read in two
stages: a first reading at or under a trigger bought a repeat on fresh solves, and the two read
together had to clear the level. Since then one reading at the level promotes, and since
20 October that reading is one test over the frontier and the retained tasks together. Set the tally beside its own A/A noise as evidence about
variance, without replacing the recorded test with a threshold on untied share.

Then what the step measured. `STARTER BARE` names a rest comparison where the reference answered
none of its solves on more than half its tasks. There the step reads "a harness that carries an
engine beats one that carries none": real, and the first thing a harness should learn, but it
says nothing about how good the engine or the guide is, and a second promotion is the first that
can. `STARTER BARE` actually tests the reference of each supporting comparison, even where it
is no longer the starter, so name that reference. Read `VALID BY HARNESS` at the recorded
budget. Until 11 October reports also held shorter-budget readings of solves told the longer
budget; those do not measure a solver told the shorter one. Read lane 13's account of what the Builder
changed, and lane 19's of the winning solves, by their calls: whether the wins came from the
change the note claims, from a program the harness ships, or from the solver writing its own.

Then what touched both sides. `SHARED TEMPORARY FOLDER` counts the solves and sessions that named
a path under the host's `/tmp` or `/var/tmp`, including their `/private` spellings, solves by
comparison and side, practice apart. The wall now closes those shared roots and gives each seat
its own temporary directory. A path in an argument is a lead, not proof that the command could
read it. Until 12 October a shared temporary path let a reference solve run a program another
campaign's Builder had compiled. The trigger names `/bin/` paths from call arguments and paths
more than one solve or session named: two solves that
write one `/tmp/m.py` at once can each read the other's. A reference solve that runs a program its
harness never shipped lifts the reference, and a new-harness solve that does so lifts the step;
say which side each falls on and whether the tally turns on those tasks, after confirming the
command succeeded. Read the load each solve started under: load can change the time available
for work without changing the recorded setting.

Then the climb after. `AFTER THE PROMOTION` gives, up to the next promotion or the log's end, the
setting events, the Examiner sessions and what each held out, every
comparison read against the promoted harness, the controls that put the starter against it, the
Builder sessions with their parent and how many of their practice tasks were written since, and
any comparison started and not reported. A climb is these in order: an Examiner session that
leaves the promoted harness room (`informative`, including valid author answers and objective
improvements), any control the table called for, a Builder session and its released practice
tasks, and a comparison against the promoted reference. Since 19 October `noRoom` requests one
Examiner session after each promotion even where its supporting reading left room. The setting
stays fixed. Read the reference's valid share and objective room epoch by epoch: if every new task is one
the promoted harness already answers, the campaign is measuring ties, and lane 22's power says how
many tasks the next step would need. If the Examiner holds out tasks the promoted harness fails
for reasons no harness can change, the room is false; lane 8 reads those.

Last the cost: dollars and hours from the opening to the promotion, and from the promotion to the
next session's end, by role (lane 28's spend). A campaign that spent most of its budget reaching
a step against a bare starter has little left to climb with.

Where several campaigns are under review, compare before concluding. The prompt's section on them
opens with `wri.ts climb`'s table, which sets every campaign in these columns from its log, and with each
solve, its side named, that named a path another campaign's Builder or Examiner session named under
a shared temporary root first; `crossings` tracks the first occurrence per path and campaign,
not every use, and proves neither a write nor execution. A scratch name two solvers chose is
only counted. Align them first: the pack or drafted exam,
the seats and efforts, the limits and the tree each ran (row F, and the host line). Then set side
by side the time and dollars to the first promotion, each rest comparison's tally and noise, the
tie share, the reference's valid profile, the kind of change that won, the shared-folder exposure
by side, and how far each got after. A difference in the tree is a candidate cause only where the
other columns agree; one campaign a tree is one sample, and two runs of one tree that differ as
much as two trees do say the difference is the campaign's variance. A campaign that has not
promoted yet is read at the same move, not at the same hour. The decision it changes is whether a
promotion is reported as an improvement, whether the campaign is kept running toward a second
one, and what the host must fix before the next promotion can be believed; it routes to
`operator` for the report and the keep or stop, `host` (`src/builder/decide.ts`) for a move
after a promotion the rule did not make, `examiner-prompt` (`src/examiner/prompt.ts`) for room
written where there is none, and `environment` for the shared temporary folder and the load.

## Retired from v1

`from-v1.md` holds the whole account: which of v1's nine rows and thirty-eight lanes were kept,
overhauled, merged or removed, and why. A reader meeting one of the removed lanes in a v1 archive
reads it from that archive alone.

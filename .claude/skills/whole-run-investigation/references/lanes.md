# Whole-run investigation lanes

This file is the whole catalogue: six deterministic rows the primary reviewer settles itself, and
thirty-one lanes a paid session can be given, one question each. Read the stance below before any row
or lane, because every one of them is written from it. `tools/wri/catalogue.ts` parses this file,
and `test/wri-catalogue.test.ts` holds it to the reader: every trigger `tools/wri/read.ts` prints
is named in the `Starts from` paragraph of the lane it starts.

## Who holds which pen

v1's Builder wrote its own exam, and v1's catalogue was written from that: no verdict was an
independent measurement until a lane had said which part of it the Builder did not write. v2 took
the pen apart, and each part has its own way of going wrong.

- **The pack's author** wrote the contract, the check program, the pack's tasks and its controls.
  In the truss pack that is v1 and a person. No session of v2 writes or repairs a check. So a pass
  means what the check reads, a refusal means the check refused, and neither means more until the
  check itself has been read.
- **The Examiner** writes task instances, against checks it is shown by id and assertion only.
  It writes no check, no control and no verdict, and it is put to no solver. At a session's
  opening it is told one outcome of every task the campaign holds: how the reference harness did
  on it in the last comparison that scored it, valid in every solve, in some or in none, or
  disputed (`src/examiner/record.ts`). It is never told any other harness, a count, a budget, a
  target or a level.
- **The Builder** writes the harness: the guide, the tools, the tool tree. It sees practice tasks,
  their records and the reviewers' readings of its practice fails. It never sees a check or a
  held-out task.
- **The host** owns the conditions, the limits, the one gate, the draw of the scored set and the
  comparison. The Referee advises it. It decides nothing about promotion: the
  reference harness is the one the campaign started with until the operator names another.
- **A person** rules where no reviewer has: a rejection the Referee did not rule a true fail sets
  its task aside until someone has labelled it, and a task with no valid answer on record, after
  two comparisons that cut no solve of it at a limit, leaves the scored set until someone has
  read it.

No stronger solver holds a witness any more, and nothing selects a task by pass or fail. Until
2026-10-09 a task met four more gates, was screened by two harnesses and scored beside an anchor
(`docs/plan.md`, Phase 2). A log from before then holds those events, and the reader reads them
as history.

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
evidence has done its job. Four lanes are standing and open on every campaign that holds a report,
triggered or not, because their question is open whenever a harness was compared: 1, 15, 18
and 22. Lanes 5 and 19 are isolated: each runs alone, only on its trigger, and freezes its result
before it reads any other report.

Nothing here changes a verdict, a task's state or a reading. A lane's product is a finding with
one owner, the exact evidence it cites and the observation that would reverse it. The owner is one
of these, and a finding names exactly one:

| owner | what it is |
| --- | --- |
| `pack/evaluator`, `pack/brief`, `pack/controls`, `pack/tasks` | the imported correctness model, by file |
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
else. A log that holds solves of two campaigns' names was written into by hand. The row's last
line is the metered dollars by role, which lane 28 starts from.

**B. checker identity.** Read `contract.frozen` and every `checker.read`. The checker is two
hashes, the contract's and the check program's; a task version holds the second. A campaign with
nothing frozen has no checker on record, only whichever one each task version names. A reading at
other hashes than the frozen ones is of another checker. `despite` on a freeze is the operator's
reason for freezing over named faults: quote the count, not the reason's text.

**C. conditions.** List the conditions by side and model, and the number of distinct values of
each field. One contract, one sandbox, one verifier tool tree and one host hash is the clean case.
More than one host hash means the code was edited inside the campaign; a comparison counts only
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
verdict with the refusing checks; `wall-ended`, `context-ended` and `no-answer` have none. Recount
any figure a report quotes from these rows before a rate is read.

**F. sessions and the harness chain.** The campaign command's moves, its endings and its billed
dollars against its budget. For each Builder session: its parent, the digest it left, how it ended,
whether it changed anything, whether what it left opens, its practice solves and the reading of each
comparison of the harness it left, which a comparison names by its own session (`g-N`). For each Examiner session: how it ended, what it proposed and what stood
feasible. A session that started and never finished is refused by its round and is named here.
A step still open at the log's end is named on a line of its own, with its turns, what it held
out or practised and when it last wrote, or, for a comparison, its solves ended and open: the
campaign command writes a move's `campaign.move` when the move ends, so the moves leave it out.

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
rule's. An `authored` instrument computes with its author's own code, and what its pass means is
that the author's computation agreed. The row's instrument is the brief's `evidence.kind`, a label:
an `authored` check may still run an installed engine on its author's input, as 5 of buffer's 7
did on 12 October, so read from the check program and its `requiredToolIds` which tool each check
runs, and weigh its pass by what computed it. With no pass in the log — a campaign stopped before its first
solve — the rows beside the brief are the whole lane, and the reading is what a pass would establish
were one taken; say that, and do not come back `could not read` for the missing sample. `wri.ts grade` puts one constructed answer to the campaign's
checker and writes nothing; use it to show a gap, on the Mac. Do not read a pass rate here. The
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
faults, and each check's row. A fault is one of five kinds: a control that did not get its label,
a control that got two verdicts, a check that refused nothing or passed nothing, a check no reject
control it refused names, and a tool the path lacks. Controls go stale: on 8 October all 35 accept
controls of the truss pack failed while its rejections read sound, so a control fault is first a
question about the control. Say for each fault whether the control or the check is wrong, from the
published rule and the control's label, without opening an answer. A reject control tests the
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
whether the bar was cleared; where none did, say the rulings are one reader's. Where public facts
cannot decide, the fail stays a fail and the question goes to lane 5. Report counts per check id
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
did: every task a session wrote that was neither refused nor disputed is proposed again under
the repaired checks and put to the one gate, with no solve; a task the gate refuses there is in
neither campaign's sets. Solves are not carried. The decision it changes is whether results
of the two campaigns may be read together; it routes to `operator` for a freeze not given or a
repair adopted against its reading, and `pack/evaluator` for a defect left standing.

### The tasks

**7. Supply and the gate.**

Starts from `SUPPLY THIN (lane 7)` and `GATE REFUSED (lane 7)`.

The question is where tasks are lost between a proposal and the scored set, and whether the gate
that refused was right to. v1's gate audit asked of every refusal whether it was 98% sure to
refuse something wrong, and removed 23 of 54 that were not; ask the same here. A task meets one
gate, the shape of its package (`src/kernel/task.ts`): its family, its inputs, its rule ids, and
that the checks have what they need to run on it. For each refusal read the reason in `task.gate`
and say whether it named a real defect and whether the Examiner could have acted on the reason it
was given. Then read what leaves the set after the gate: tasks disputed on a check's fault, tasks
refused by a person as infeasible, and tasks waiting for a label (lane 8). The plan sizes a
comparison at 12 held-out tasks and asks for more when ties leave fewer than 8 untied; say how
many the campaign holds against that. Do not propose loosening the gate from the yield alone. The
decision it changes is whether another Examiner session is bought before the next comparison; it
routes to `examiner-prompt` (`src/examiner/prompt.ts`) where the Examiner was not told what the
gate needs, and `host` (`src/kernel/task.ts`) where the gate refuses on something that is not a
defect.

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
is that most rejections were the check's: 36 of 47 rehearsal misses. Four of the five tasks the
second live Examiner session lost were rejected on one limit its author set without solving. Do
not label a task from the count alone. The decision it changes is the label each waiting task
gets; it routes to `operator` for the label, `pack/evaluator` where the rejections are a check's
fault, and `examiner/task` for an instance whose own limits exclude every answer.

**9. Whether validity separates.**

Starts from `TIES BETWEEN VALID ANSWERS (lane 9)`.

The question is whether a valid answer within the budget tells two harnesses apart.
`TIES BETWEEN VALID ANSWERS` fires on a
comparison where more than half of the tallied tasks tie with valid answers on both sides. That
is the plan's condition for building an objective (`docs/plan.md`, Phase 3): until it holds, no
objective is built, and where it holds the question is whether the objective would separate the
same solves (`objective.decided` in a report of a check program that declares one). A report
written before 11 October also holds `spread`, how far the use of turns, CPU seconds and seconds
moved between repeated solves of one harness on one task, which decided the budget's unit; the
unit is the model's turns, and no trigger reads it since. Seconds move with the host's load,
which each `solve.started` and `solve.finished` records. The decision it changes is whether
Phase 3 is built; it routes to `operator`.

**10. Ties and the budget.**

Starts from `TIED TASKS (lane 10)`.

The question is what share of the tasks tie and why. A tie says nothing, and the share of untied
tasks is what sizes every later comparison. With two solves a side and no true difference, 38%
of tasks tie when a solve is valid half the time, 51% at four times in five and 69% at nine in
ten (`src/kernel/size.ts`), so the tasks are written where the reference harness is valid about
half the time. `TIED TASKS` gives each comparison's ties and how many of them had no valid
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
one route. v2 tells the Examiner one outcome of every task the campaign holds and nothing to aim
at (`src/examiner/record.ts`). That is the one channel by which a better exam is asked for, so
read whether it carried. `OUTCOMES BY SESSION` gives, for each session's held-out tasks, how many
the reference harness answered in every solve, in some, in none, and how many no comparison has
scored. Read them in session order, and what changed in the instances between sessions:
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
`states/`. A campaign's first parent is the stored sweep's harness and stands in the sweep's root,
outside the campaign's folder: where that root is not on this machine, say the diff could not be
made. Diff the two part by part: the guide, the tool spec, the tools module, the config, the tool
tree; `harness-versions.ts --diff` of [harness-audit](../../harness-audit/SKILL.md) counts it.
Describe each change by its kind and size; quote no line. The note is in `harness.version`: say
whether what it claims is what changed. When the final state did not open, the round measured the
last state the session practised with, and the note describes edits that were never measured:
name the edits made after that practice from `build.call`. A change to `config.yaml` that moves
a wall or a turn cap changes what the limits measure, though v2's limits are the host's and a
harness's own are not read: confirm that from the condition. A session that wrote with its shell
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
on was ever called. A tool no solve calls is dead weight in every prompt; a tool most solves call
once and abandon promised something its reply did not give. Compare the guide's account of how
the tools combine with the sequences solves actually ran. A guide is appended to the solver's
prompt on every task, so a line that is true of the practice tasks and false of the domain costs
on every scored one. The round's prompt is the host's, in `src/solve/prompt.ts`, and its wall
sentence is the host's claim: check it against the condition's limits. Do not judge the solving
method. The decision it changes is whether a failed solve failed the task or was misled; it
routes to `harness/guide` and `harness/tools`, and to `host` for a sentence of the solver's
prompt that the condition contradicts.

**15. Check mirroring in solver tools.**

Starts from `TOOLS EDITED (lane 15)`, and is standing: it opens on every campaign that holds a
report.

The question is whether anything in the harness does the judging for the solver. The Builder's
prompt forbids it by the public rules, since the Builder sees no check: no tool, program or guide
line may say whether a candidate meets a rule, or compute for a named case what an accepted
answer must contain. Nothing in the code enforces that. v1 found it in three domains: users of
grader-like advisers passed 444 of 447. Read every tool in the child and in the parent: what it
takes, what it returns, and whether its return is a verdict, a margin against a published limit,
or a quantity the solver must still judge. Reusable computation is allowed and wanted; a tool
that returns "meets rule R" is the grader moved into reach. Then read how solves used it from
`solve.call`: propose, ask, adjust, ask again, record is the pattern of a solver searching
against a verdict. Count the solves with that pattern under each harness. The Builder cannot have
copied a check it never saw, so a mirror here is rebuilt from the public rules, and whether that
is a fault depends on lane 11: where the rules publish the arithmetic, the tool only saves the
solver the typing. The decision it changes is whether a gain is the harness helping the solver
work or helping it ask; it routes to `harness/tools` and `harness/guide`, and to `builder-prompt`
(`src/builder/prompt.ts`) when the ceiling's sentence did not prevent it.

**16. Finish decision against practice evidence.**

Starts from `NO PRACTICE (lane 16)`, `FINAL BYTES NEVER PRACTISED (lane 16)` and
`SESSION ENDED (lane 16)`.

The question is what the Builder did with each practice verdict before it stopped. Read the
session's `build.call` rows in order: edits, `check_harness`, `practice` and what each practice
returned, the task's record under this harness and under the parent, and the Referee's ruling of
a fail. A session that edited after its last practice was measured on
bytes it never tried; one that never practised was measured on belief. The trigger reads this by
digest: a practice solve's condition names the state it ran under, so the harness that was
measured either is one of those states or is not, whichever tool made the last edit. The Builder is told one
solve is weak evidence and to read the record: say whether it practised a task again after a
change, and whether it decided beforehand which tasks a change should move. A session cut at its
wall or its turns is a whole session and is compared; say how many practice solves and turns it
had left. v1 found its Builders took 50 minutes from a clear check to a submit, and that without
a cue to stop some never did: read the gap between the last edit and `finish`. The decision it
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
(`docs/simplify.md`, E1). The decision it changes is whether the session produced a change with a
reason, which is the only kind worth a round's solves; it routes to `harness/guide` or
`harness/tools` for a fail left standing, and `builder-prompt` when the fail was ignored.

**18. Exposure: what the Builder could see.**

Starts from `PRACTISED TASK MEASURED (lane 18)` and `SHELL COMMANDS (lane 18)`, and is standing.

The question is whether the child could know the exam. A harness that carries the scored tasks'
answers scores higher on exactly those and is no better on any other. Settle the sets first, from
row D: no version is both practised and scored. Then read what the session
could reach. Its shell has the network and its home; its home held `harness/`, `practice/` and
the public resources. The parent state is v1's and carried a correctness model with every task's
hidden values until the copy given to a Builder dropped it at every depth; confirm from the
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
no file-writing call, per Builder session's practice and per comparison, so that one program made
what the solve submitted. Each comparison's reference side is printed beside its new one as the
control, since a solver can finish a task in one command of its own; on the #107 campaigns none of
the 132 reference solves read so, and 24 of recode's 40 measured solves under its built harnesses
did. The lane's own table is what tells a harness's program from a solver's one command.
`WINS (lane 19)` lists each comparison's won tasks by solve, as the comparison paired them, and
starts nothing by itself. It runs alone.

The question is where the deciding value came from. Take the wins, the tasks the reference
harness failed and the child passed, which `WINS` names by solve, and for each open the child's solve: `solve.turn` and `solve.call` in
order. Show the step at which the answer's deciding value first appears and what produced it: a
tool's computation from the task's public input, the solver's own working, a line of the guide,
or nothing in the trace at all. A value that arrives whole in the first turn, on a task the
solver worked at under the reference harness and missed, came from somewhere the trace does not show. Freeze the
table, win by win with the step and the source's kind, before reading lanes 15 and 18. This lane
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
every field but the harness. Then read what a condition does not hold: the machine's load, which
each `solve.started` and `solve.finished` records and nothing acts on; the hour; the provider's
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
solve, and whether what left favours a side. No result chooses the scored set: it is drawn from
the held-out tasks by the contract's hash, or named by the operator, and written into
`comparison.started` with the harnesses, the solves a side, the level and the cap.
`SCORED SET MOVED` fires when the tally holds fewer tasks than that event. A task leaves four
ways, and the report names each: `short` of its solves under a harness, `disputed` when a check
could not run, `withdrawn` when a person released or refused it while the comparison ran, and
`aside` on a rejection not ruled a true fail. The last is the one that can lean: a task is set aside for a rejection under either harness, so rejections that fall on one
side remove that side's losses, which lane 30's `SET ASIDE BY SIDE` counts. Read `counted` in
the report, the tally were every such rejection to stand, beside `scored`. A comparison asked
for again on other terms under the same id is refused; confirm no second `comparison.started`
carries the id. Until 2026-10-09 a round screened candidates and admitted the ones a harness
failed; a log from before then holds those admissions, and their tallies are of a selected set.
The decision it changes is whether the tally is of the set that was fixed; it routes to `host`
(`src/builder/round.ts`) and to `operator` for the labels that would return a task.

**22. Sign test, ties and power.**

Starts from `NOTHING SCORED (lane 22)`, `CUT BY ITS CAP (lane 22)`,
`FEW INFORMATIVE PAIRS (lane 22)` and `SET SHORT (lane 22)`, and is standing.

The question is what the comparison's test could and could not have shown at its size. A sign
test reads the tasks on which the sides differ; a tie carries nothing. v1 found the signal too
rare to settle a comparison at the size it ran: 11 of 322 batteries held a fail nobody
contested. The plan's table is in untied tasks: 12 of them detect a harness that truly wins
three in four about 65% of the time, and 12 tasks at two solves a side, with the reference
harness valid half the time and the new one three times in four, 51% (`src/kernel/size.ts`). So
read the report's `scored`: wins, losses, ties, the p and how many ties had no valid answer. Say
how many untied tasks there were and what the smallest result is that would have cleared the
level with that many. The trigger does that by the report's own test: it fires when no result
with a loss could have cleared the level on that many, and names the least sweep that does. A
comparison that tallied no task tested nothing and reads `not-scored`; before the report learned
to say so it read `no-step`, as the eight truss rounds of 8 October did. `CUT BY ITS CAP` names
one its dollar cap ended: it is finished, reads `not-scored`, and its solves are in no tally. A
`no-step` at four untied tasks is no evidence of no gain, and a `step` at five rests on five
tasks: say both plainly. One comparison of equal harnesses reads a step up to one time in ten,
and three in a row at least once about 14% of the time, which is why a step is repeated before
anything is promoted. Read the tasks the report left out, `short`, `aside` and `disputed`, and
whether leaving them out could have moved the tally. The decision it changes is whether the
operator repeats the comparison, enlarges the set or reads the result as it stands; it routes
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
starter's own result, and the plan's first gate is read off it. A starter valid on nearly every
solve has tasks too easy to show an improvement, and they are replaced before another session is
paid for: v1's solver wrote its own search and passed, and twelve firmware tasks passed faster
with the simulator withheld. The Examiner writes tasks where the starter is valid on about half
its solves. After a promotion the starter is the control: the tasks written for the promoted
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
the direct measure, the plan's A/A comparison: the reference harness is solved twice as often,
its first solves of a task in the order they started are the test's, and those against its
later ones give a second tally. Two samples of one harness should tie on most tasks and win as
often as lose; the tally's untied share is the noise every comparison at that budget has to
exceed, and a p at or under the level there is a step where none can be. Count the flips per
harness beside it. Where the new harness flips less than the reference on the same tasks, the
gain may be steadiness; where both flip alike, a win by one solve in two is within what one
harness does to itself. The decision it changes is how many solves a side a task needs, and
whether the budget's unit is fit; it routes to `operator`, and `environment` when flips cluster
in hours of high load.

**25. The chain of comparisons.**

Starts from `CHAIN (lane 25)`, `STEP NOT REPEATED (lane 25)` and `NO TASK HELD OUT (lane 25)`.

The question is whether the campaign is climbing: whether a step was found, repeated, and built
on. Read the chain: each comparison's reference harness, the harness compared with it, and its
reading. The reference harness is the one the campaign started with until the operator promotes
another by naming it; a Builder session starts from the latest harness a session left, step or
none, and the operator may send it back to an earlier one. So a chain of sessions each starting
from the last, all compared with the same reference, is the plan's design and no fault. A step
is repeated once on fresh solves before anything is promoted: `STEP NOT REPEATED` names a step
no second comparison of the same two harnesses has followed. A second step of another child
against the same reference is another harness, not a repeat. Row F's `campaign` line gives the
moves the command made, how it ended and its billed dollars against its budget; the stop rule is
that three moves in a row that could have shown a gain, with none, stop the
campaign. A changed harness counts once against one reference, by the last comparison of the two
under the campaign's setting, where it left room; a repeat does not count again. A campaign with no held-out task measures nothing at all: eight rounds on the
truss pack ran so on 8 October, for over $220, and each could only read that no task was
scored. The decision it changes is what runs next: a repeat, a promotion, another checkpoint,
an Examiner session, or a stop; it routes to `operator`.

### The solve, its failure and its cost

**26. Solver process and walls.**

Starts from `MISSES AT A LIMIT (lane 26)`, `WALL SHARE (lane 26)`, `HOST LOADED (lane 26)`,
`LOAD MOVED (lane 26)`.

The question is how the solver spent its walls, and whether a miss measured the task or the
wall. The limits are the host's, in the condition: the solve's wall, the turn cap, the shell's
default and maximum, the disk. A solve the wall ended is a fail in the count and a truncated
solve, never a settled failure of capability, and so is one its model turns or its context
ended. `MISSES AT A LIMIT` counts, for each comparison and each side, the misses that ended at
one of the three or past 95% of the wall, with their kinds and the turn bound the solves were
told, and the misses outside any comparison on a line of their own: on 10 October recode ended
41 of its 58 scored misses on turns, 12 of 18 reference misses and 4 of 4 new in g-2 at 8 turns,
and a read of the wall alone saw none. A side whose misses are all at a limit was cut, not
beaten. For each side, read the share of the wall a solve
used: v1 found it the measure that moves on every battery and leads a fail, 18.6% against 6.6%
in truss batteries that went on to fail a case, and that it said the opposite in firmware, where
fails at 1.5% of the wall were not the solver's. So read the median share under the parent and
the child on the scored set, and say whether the child's solves got shorter, longer or the same
on the tasks both passed. Read `seconds` against the load at start and end: on 7 October wall
time ran 2.3 times CPU time under load. A wall counts the clock, so a loaded host holds less
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
`EXAMINER NEVER FINISHED (lane 27)`, `MISSES WITHOUT A VERDICT (lane 27)` and
`SESSION CRASHED (lane 27)`.

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
open at the log's end apart: it is running, or was stopped by `bun run runs stop`, which writes no
ending, and `bun run runs pulse` says whether its process is alive. A fail of kind `broken-harness` fails every task alike. For a session that crashed, name the turn and whether
its round was refused as the rule says. The decision it changes is whether a count is trusted as
written; it routes to `host` (`src/solve/run.ts`, `src/kernel/solve.ts`) for a kind that hides a
cause, `environment` for a provider or the machine, and `harness/tools` for a harness that does
not open.

**28. Time, spend and silence.**

Starts from `LONG SILENCES (lane 28)` and `SPEND LED BY A ROLE (lane 28)`.

The question is where the hours and the dollars went, and what each long silence was. Every
`solve.finished`, `build.finished`, `exam.finished` and `referee.finding` (and, in a log of
before 11 October, `diagnosis.recorded`) carries tokens, metered and billed dollars and, where a
backend reports it,
its own cost. Sum them by role and by round, and set billed beside metered: they differ by cache
pricing and by what a backend reports. v1 found review took 54% of firmware's spend and changed
nothing measurable, and that a gate took 31% of its Builder's time where the verifying tool was
slow: say what share the reviewers took here and what their rulings changed, which is lane 30's.
Row A puts the hours by role beside the billed dollars: each Builder and Examiner session and
each comparison from its start to its end, a session a stop cut to the stop, and the rest of the
campaign's span as between moves; on 10 October recode's Builder took 52% of the hours against
43% of the dollars. `LONG SILENCES` reads every gap between two events longer than five of the
campaign's median finished solve, and never under ten minutes, and names the five longest by
what ended them: a command whose time covers most of the gap, a model turn with its output
tokens, or nothing open between moves. A fixed twenty minutes read nothing on buffer on
10 October, whose longest gap was 19.5 minutes; recode's two gaps over it were each an Examiner
turn of over 56,000 output tokens. For each silence, confirm what was running from the events on either side: a
solve at its wall, a Builder command, a provider wait, a machine asleep. Read the cost of one round at the plan's size
from this one's parts and say what the next costs. Do not propose a cap: the operator declined
one. The decision it changes is what the next round is expected to cost and whether a role's
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
(`docs/simplify.md`, E1). The decision it changes is whether the next change goes to the harness
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
rejection aside, which is how the plan's first round is read before there is a Judge. So
read the tasks set aside. `SET ASIDE BY SIDE` counts their rejections under the reference
harness and under the others: a rejection under one harness removes a task that harness would
have lost, so rejections that fall on one side move the tally toward it.
`READING MOVES WITH THE SET-ASIDE` fires when the report's `counted`, the tally were every such
rejection to stand, clears its level and `scored` does not, or the reverse: the reading then
rests on labels nobody has made. `SET ASIDE AND UNSETTLED` counts the tasks still waiting. A
person settles a comparison with `tools/d2/settle.ts`: a task whose rejections are all labelled
earned is restored, one labelled a check defect is disputed for good, one labelled unclear
stays out, and the report is written once more with `settled` saying what the labels did.
`SETTLED BY HAND` sets the two reports side by side. Read whether the labels were made from the
packets or from the rulings, and whether a task disputed for a check's fault was taken to the
checker's owner: a dispute removes a task and repairs nothing. The Referee's agreement with a
person is unmeasured until its rulings are set against labels made before it read
(`src/review/agreement.ts`), and it ruled all 64 stored rejections a true fail with no label to
compare: count its earned rulings as a reviewer's, and those made without a probe as restating
the check. Count the rulings that recur: the same check ruled a defect across sessions is a
repair owed, and lane 6 reads whether one was made. Then read what each role was told. The
Builder is told a task's record and a ruling's kind, and never a check's id or a
reviewer's failure text: confirm it from what `build.call` returned. The Examiner is told one
outcome a task and the gate's reason. The decision it changes is whether the Referee's rulings
may count without a person reading each; it routes to `operator` for the bar and the labels,
`reviewer-prompt` for rulings made without a probe, and `host` (`src/builder/tools.ts`,
`src/examiner/session.ts`) for a role told more than it may know.

### The climb

**31. The promotion and the climb after it.**

Starts from `PROMOTED (lane 31)`, `STARTER BARE (lane 31)`, `AFTER THE PROMOTION (lane 31)` and
`SHARED TEMPORARY FOLDER (lane 31)`. It reads the peer campaigns the primary named with
`start --with`, each as the reader prints it, and reviews none of them.

The question is whether a promotion measured what the campaign exists to measure, and whether the
campaign climbed from it. Lane 25 reads the chain and whether a step was repeated; lane 23 reads
the starter; this lane reads the promotion as one event with its cause and its consequence, and
it is the lane a person reads before saying a campaign has improved a harness. Read it in five
parts, and keep them apart in the report: a promotion can follow the rule exactly and still
measure little.

First the rule. `PROMOTED` gives the harness and its parent, whether the table promoted it (a
`campaign.move` of `promote` follows) or the operator did (`tools/d2/promote.ts`, which records
any faults it was promoted `despite`), and the comparisons it rests on, each with its tally, its
p, its level and the reference against itself. Say which rule the campaign ran under: a level and
a trigger pinned in its opening terms, or none, so the tree's default, which differs between trees
(abl175-new, on #175's tree, was read at 0.2; from #183 a step is read in two stages). A first
reading at or under the trigger buys a repeat on fresh solves, the step and the repeat read
together must clear the level, and the harness must not lose at the full limit. Set the tally beside its own A/A noise: a step whose
untied share is inside what the reference does to itself is not a step at any p.

Then what the step measured. `STARTER BARE` names a rest comparison where the reference answered
none of its solves on more than half its tasks. There the step reads "a harness that carries an
engine beats one that carries none": real, and the first thing a harness should learn, but it
says nothing about how good the engine or the guide is, and a second promotion is the first that
can. Read `VALID BY HARNESS` at each budget: a step that holds at the shortest budget and one that
holds only at the full limit are different findings. Read lane 13's account of what the Builder
changed, and lane 19's of the winning solves, by their calls: whether the wins came from the
change the note claims, from a program the harness ships, or from the solver writing its own.

Then what touched both sides. `SHARED TEMPORARY FOLDER` counts the solves and sessions that named
a path under the host's `/tmp`, solves by comparison and side, practice apart. The Mac gives every
process one `/tmp`, so a program one campaign's Builder compiled there is on the path of every
solve on the host (plan defect H1, 10 October: a reference-side solve of abl175-new's repeat found
and ran a phreeqc another campaign's Builder had built). It names the programs found under it,
with the solves that ran them, and the paths more than one solve or session named: two solves that
write one `/tmp/m.py` at once can each read the other's. A reference solve that runs a program its
harness never shipped lifts the reference, and a new-harness solve that does so lifts the step;
say which side each falls on and whether the tally turns on those tasks. Read the load each solve
started under from its record: a step read while the host ran at twice its cores is read under
another setting than its repeat.

Then the climb after. `AFTER THE PROMOTION` gives, up to the next promotion or the log's end, the
settings the table moved (after a promotion it reads the budget rule again on the promoted
harness's own solves, `src/builder/decide.ts`), the Examiner sessions and what each held out, every
comparison read against the promoted harness, the controls that put the starter against it, the
Builder sessions with their parent and how many of their practice tasks were written since, and
any comparison started and not reported. A climb is these in order: an Examiner session that
leaves the promoted harness room (tasks it answers on fewer than three solves in four), a control
that confirms the room, a Builder session from the promoted harness practising on those tasks, and
a comparison against it. Read the reference's valid share epoch by epoch: if every new task is one
the promoted harness already answers, the campaign is measuring ties, and lane 22's power says how
many tasks the next step would need. If the Examiner holds out tasks the promoted harness fails
for reasons no harness can change, the room is false; lane 8 reads those.

Last the cost: dollars and hours from the opening to the promotion, and from the promotion to the
next session's end, by role (lane 28's spend). A campaign that spent most of its budget reaching
a step against a bare starter has little left to climb with.

Where peer campaigns were named, compare before concluding. The prompt opens their section with
`wri.ts climb`'s table, which sets every campaign in these columns from its log, and with each
solve, its side named, that ran a path another campaign's Builder or Examiner session named under
`/tmp` first; a scratch name two solvers chose is only counted. Align them first: the pack, the sweep,
the seats and efforts, the limits and the tree each ran (row F, and the host line). Then set side
by side the time and dollars to the first promotion, each rest comparison's tally and noise, the
tie share, the reference's valid profile, the kind of change that won, the shared-folder exposure
by side, and how far each got after. A difference in the tree is a candidate cause only where the
other columns agree; one campaign a tree is one sample, and two runs of one tree that differ as
much as two trees do say the difference is the campaign's variance. A peer that has not promoted
yet is read at the same move, not at the same hour. The decision it changes is whether a
promotion is reported as an improvement, whether the campaign is kept running toward a second
one, and what the host must fix before the next promotion can be believed; it routes to
`operator` for the report and the keep or stop, `host` (`src/builder/decide.ts`) for a move
after a promotion the rule did not make, `examiner-prompt` (`src/examiner/prompt.ts`) for room
written where there is none, and `environment` for the shared temporary folder and the load.

## Retired from v1

`from-v1.md` holds the whole account: which of v1's nine rows and thirty-eight lanes were kept,
overhauled, merged or removed, and why. A reader meeting one of the removed lanes in a v1 archive
reads it from that archive alone.

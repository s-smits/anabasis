# Whole-run investigation lanes

This file is the whole catalogue: six deterministic rows the primary reviewer settles itself, and
thirty-four lanes a paid session can be given, one question each. Read the stance below before any row
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
evidence has done its job. Three lanes are standing and open on every campaign, triggered or not:
1, 18, 23 and 34. `selected` also opens them where no report exists. Lanes 5 and 19 are isolated:
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

Each lane body opens with exactly one paragraph beginning `Starts from`. The lanes fall into nine
sections, one for each label of "Labels" below that has lanes, and the sections run from the label
with the most lanes to the label with the fewest: verdicts (1–8), supply (9–14), harness (15–20),
comparison (21–25), climb (26–28), solve (29–30), economy (31), runs (32) and log (33). Lane 34,
added on 30 October, closes the catalogue under `climb`, so the numbers before it stand.

The catalogue was renumbered on 27 October, when lanes 6, 15 and 17 were folded into lanes 3, 13
and 16 and the rest were put in label order. A report, a ledger or a comment written before then
cites the old numbers; read them through this table, old number first.

| old | new | old | new | old | new | old | new |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1–5 | 1–5 | 12 | 14 | 20–24 | 21–25 | 30 | 7 |
| 6 | 3 | 13 | 15 | 25 | 26 | 31 | 27 |
| 7 | 9 | 14 | 16 | 26 | 29 | 32 | 28 |
| 8 | 10 | 15 | 15 | 27 | 30 | 33 | 20 |
| 9 | 11 | 16, 17 | 17 | 28 | 31 | 34 | 8 |
| 10 | 12 | 18, 19 | 18, 19 | 29 | 6 | 35 | 32 |
| 11 | 13 | | | | | 36 | 33 |

## Labels

Every pull request carries at least one area label beside its importance label, and may carry
several: the label of each area its change touches. The areas are cut where a change lands in the
code, so a pull request's files point to its labels. Nine are groups of lanes, each under one of
the five points every change is judged by (`AGENTS.md`, section 1: supply and the four factors).
Three name areas of the repository that no run exercises, and `misc` names a change none of the
twelve holds.
`bun run land` refuses a stack in which a pull request carries none (`checkLabels`,
`tools/runtime/land.ts`). A release cycle's `Predictions.md` gives each row its pull request's
labels, and the row's lanes are drawn from those labels' lanes (run-improvement-campaign, step 1).

| point | lanes | label | a pull request carries it when it changes |
| --- | --- | --- | --- |
| verdicts | 1–8 | `verdicts` | the check program's reading, the verifier, drafting an exam and the host's reading of a draft, its freeze or admission, the Referee, its evidence, hand labels and `settle.ts` |
| supply | 9–14 | `supply` | the Examiner, its task admission, which tasks are held out or released, or what the Examiner is told |
| climb | 15–20 | `harness` | the Builder session or conversation, its prompt, tools, compaction or notes, practice, the harness contract, or what crosses the wall to the Builder |
| honesty | 21–25 | `comparison` | a comparison's terms, pairing, scored set, test, A/A comparison or condition identity |
| climb | 26–28, 34 | `climb` | the move table, the campaign command's moves, promotion, the stop rule, the campaign's endings, the operator's words, or what follows a promotion |
| honesty | 29–30 | `solve` | a solve's run, a backend, the wall, how a solve ends, non-results, or the host's solve slots and load |
| economy | 31 | `economy` | billing, the budget, time and silence readers, or the closing report's work and spend |
| honesty | 32 | `runs` | launching, continuing, moving and stopping runs, logins, hosts, controllers, receipts and run records |
| honesty | rows A–F, 33 | `log` | the campaign log, its append and locks, event kinds, conditions, the folds every reader shares, and the readers over them: the investigation, the cycle's scripts, `view`, `replay`, the closing report's text, the page and studies |
| none | none | `landing` | the stack, `bun run land`, the hooks, the CI gate |
| none | none | `quality` | lint, the simplify census, the size policy, and guidance on how code and designs are written |
| none | none | `docs` | `AGENTS.md`, `docs/` and other prose of record, where the text itself is the change |
| none | none | `misc` | anything no other label holds |

A row with no lane is settled by its tests or its own reader, named in its prediction, and says
what it moves instead of a point (`AGENTS.md`, section 1). The investigation is not exhaustive, so
`misc` is a label like the others; a run of `misc` pull requests on one subject is the sign that
the table lacks a row.

## Deterministic rows A–F

The primary reviewer settles these from the log before any lane is launched, and never delegates
them: they are the identities every finding binds to. `wri.ts read` prints them.

**A. campaign and log.** One campaign is one folder under `.ana/d2/<name>`: `log.jsonl`, the
staged `checks/` (`exams/<digest>/checks/` for a drafted exam) and `states/`. Read the log's first and last event, its sessions and its reports,
and confirm it folds: `read` throws on a history that moves a task where it cannot go. Compare the
host hash of the last condition with this checkout's (`wri.ts read` prints both): when they differ,
every statement about source is about another tree, and the report says so before it says anything
else. Row A gives billed dollars and hours by role, which lane 31 starts from.

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
labels it; lane 10 names those.

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

## Lanes 1–34

### The verdicts: the instrument, its review and its draft

Label: `verdicts`.

**1. Verdict chain: what a pass observes.**

Starts from `INSTRUMENT AUTHORED (lane 1)`, `REFUSALS BY CHECK (lane 1)` and from
`PASSES UNREAD (lane 1)`, which is standing: no reviewer reads a pass, so every campaign with a pass
leaves this open.

The question is what a pass establishes. The Referee reads refusals only, so a check that observes
too little is seen by nobody: v1's passes held up, 5 vetoes in 1,411, but v1 had a Judge reading
them and v2 has none. For each check in the last `checker.read`, read its row (instrument, the
controls it passed and refused, the reject control answers naming it that it caught: counts of control answers,
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
pairs straddle them, which is row C's and lane 21's to confirm. A tool the path lacks stops a run
and is named by `accept.ts` before any control. Do not rerun a check to see whether it agrees;
`tools/m0/regrade.ts` does that for a stored sweep. The decision it changes is whether two
verdicts may be compared at all; it routes to `host` (`src/kernel/verify.ts`,
`src/kernel/check-child.ts`) for an unhashed edge and `environment` for a tool that is not there.

**3. Check discrimination and control answers.**

Starts from `NO CHECKER READING (lane 3)`, `CHECKER READ WITH FAULTS (lane 3)`,
`CONTROL COVERAGE (lane 3)`, `CHECKER NOT FROZEN (lane 3)`, `FROZEN DESPITE FAULTS (lane 3)`,
`READ AT ANOTHER VERSION (lane 3)` and `TASKS CARRIED (lane 3)`.

The question is whether each check has been seen to refuse what it should and pass what it should,
and whether the controls that would show it are still right. Read the last `checker.read`: its
faults and each check's row. `readChecker` and `acceptCommand` include control answer labels and
repeatability, pass and refusal coverage, named reject-control coverage, missing tools,
do-nothing answers and unadmitted authored checks, including the objective. Since 14 October
fresh control answers establish current faults; stored verdicts are reported separately. A control fault
can be a stale control answer. Decide from the public rule, the control answer's label and its answer whether
the control or the check is wrong. A reject control tests the
fault its author thought of; coverage of one control answer per check says the check can say no, and
nothing about how often it says no wrongly, which is lane 4's. A check that could not run is one
fault that names it and never a request for another control. Say under which checker each
result was counted: a checker not frozen can change between two rounds with nothing refusing it,
and a campaign whose tasks were carried from another checker's campaign is read beside that one
with `tools/c/repaired.ts`, its old log against the repaired pack. The decision it changes is
whether the checker can be frozen as it stands; it routes to `pack/controls` for a stale control answer,
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
cites an answer probe in which both sides reached a verdict, and `EARNED WITHOUT A PROBE` in lane 7 says
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
with a valid answer, which a ruling does not supply. An alternative you cannot show valid from public facts
proves nothing either way and is dropped, with the count of those dropped. Do not use a solver's
recorded answer as a base where the task is held out. The decision it changes is
whether a repair of the named check is owed; it routes to `pack/evaluator`, and the corpus goes to
the checker's owner as the repair's accept controls.

**6. Triage: the harness, the rules or the solver.**

Starts from `REPLAY MOVED THE VERDICT (lane 6)`.

The question is which side each practice fail was on, and whether the successor repaired that
side. A practice fail is ruled by the Referee: earned, a check defect, or unclear. The
Referee's replay runs the checks again on the logged answer; a replay whose verdict differs from
the logged one is a check that does not repeat. Then read what the Builder changed after each
earned fail and whether it was the side that failed. Until 11 October a Diagnoser named an owner
for each earned fail, the harness, the public rules or the solver, and a log of before holds
its readings beside the rulings; 20 of 20 named the solver, and the seat went
(`7f0add79:docs/simplify.md`, E1). The decision it changes is whether the next change goes to the harness
or to the exam's owner; it routes to `reviewer-prompt` (`src/referee/referee.ts`) for a ruling
that cannot be right, `pack/evaluator` for a check that does not repeat, and `harness/guide` or
`harness/tools` for a repair on the wrong side.

**7. Rulings, labels and what each role was told.**

Starts from `SET ASIDE AND UNSETTLED (lane 7)`, `READING MOVES WITH THE SET-ASIDE (lane 7)`,
`SET ASIDE BY SIDE (lane 7)`, `SETTLED BY HAND (lane 7)`, `REVIEW FAULTS (lane 7)`,
`EARNED WITHOUT A PROBE (lane 7)` and `RULINGS REFUSED (lane 7)`.

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
(`src/referee/agreement.ts`); on the record of 9 October, which is not this run's, it ruled all 64
rejections then stored a true fail with no label to compare. Count this run's rulings from its log,
its earned rulings as a reviewer's, and those made without an answer probe as restating
the check. `RULINGS REFUSED` counts the `referee.refused` events by the ruling the Referee asked
for: read each beside the ruling it then recorded for that solve, since a refused `earned` that
becomes `unclear` sets a task aside the Referee meant to count. Count the rulings that recur: the same check ruled a defect across sessions is a
repair owed, and lane 3 reads whether one was made. Then read what each role was told. The
Builder is told a practice task's record and the ending's outcome and kind, with no ruling,
check id or reviewer's reason: confirm it from what `build.call` returned. Check the Examiner's
inputs against `AGENTS.md` section 3 and `record.ts`. The decision it changes is whether the Referee's rulings
may count without a person reading each; it routes to `operator` for the bar and the labels,
`reviewer-prompt` for rulings made without an answer probe, and `host` (`src/builder/tools.ts`,
`src/examiner/session.ts`) for a role told more than it may know.

**8. The drafted exam against its prompt.**

Starts from `EXAM DRAFTED (lane 8)`.

The question is whether the exam a campaign drafted from the operator's prompt is the exam the
prompt asked for. The host's reading (`draftReading`, `tools/d2/exam.ts`; `unreadFields`,
`src/kernel/acceptance.ts`) checks shape, sources, one check per rule, controls and the fields an
accept control moves; it cannot tell whether a rule belongs to the field, whether its source says
what the rule says, or whether the objective measures what the prompt values (`AGENTS.md`,
section 6). `EXAM DRAFTED` gives the number of `exam.drafted` events, and each drafting session's
ending, whether its draft stands, and the measurement `draft.finished` recorded (complete,
interrupted with its source, or not run). Read the prompt in `campaign.opened`, then the draft that
stood: each rule against the prompt's request and its cited source, the answer format against what
a solver must produce, the objective's quantity and direction against what the prompt says is
better, and the scope against what it leaves out. Count the drafts that did not stand by the
reading's fault, and say whether the last draft fixed the fault or removed the rule. Where the
measurement was interrupted or not run, the exam stood without the reference's solves on it, so
lane 9 reads the first task admission as its first measurement. A check that only its author's computation
decides was admitted by the launch (rule 10): name those the field's own engine could have decided.
The decision it changes is whether the campaign measures the domain the operator asked about, and
so whether its promotions answer the operator's question; it routes to `examiner-prompt`
(`src/examiner/draft.ts`) for a draft that drifted from its prompt, `pack/brief` or
`pack/evaluator` for a rule or an objective that misstates its source, and `operator` for a
prompt that left the exam open to more than one reading.

### The supply: the tasks

Label: `supply`.

**9. Supply and task admission.**

Starts from `SUPPLY THIN (lane 9)`, `GATE REFUSED (lane 9)` and
`SAFEGUARD-8 PROMOTION ON AUTHOR ROOM (lane 9)`.

The question is where tasks are lost between a proposal and the scored set, and whether the task admission
that refused was right to. v1's task admission audit kept 30 of 54 refusal codes at its bar of 98% sure
that what was refused was wrong (`docs/transfer.md`); ask the same here. `packageGate`
checks the shape check. Where `try_task` is available, task admission also runs up to three fresh
reference solves and uses `informative` to decide room. It holds a draft the reference answers
sometimes; one it never answers with the author's valid answer on record; or one whose valid
reference answer is beaten by an answer on record under the objective. For each refusal read `task.gate`
and say whether it named a real defect and whether the Examiner could have acted on the reason it
was given. Then read what leaves the set after the task admission: tasks disputed on a check's fault, tasks
refused by a person as infeasible, and tasks waiting for a label (lane 10). Read the campaign's
target and level: `SIZE` defaults to 24 frontier tasks and two solves per side, with retained
tasks alongside. `refusals` requires at least `sweepOf(level)` frontier tasks. Say how many it
holds against those terms. Do not propose loosening the task admission from the yield alone. The
decision it changes is whether another Examiner session is bought before the next comparison; it
routes to `examiner-prompt` (`src/examiner/prompt.ts`) where the Examiner was not told what the
task admission needs, and `host` (`src/kernel/task.ts`) where the task admission refuses on something that is not a
defect. `SAFEGUARD-8` names a promotion whose frontier clears its level only with the tasks
the task admission held on their author's answer alone: every reference solve valid and alike, and the
author's answer better than each by the objective. The room on such a task is the author's
answer as the author's objective measures it, so read those answers and the objective before the
promotion is reported: r3's second and third promotions (19 October) read 5-0 and 3-0 without
them, where a step at 0.02 takes 6-0.

**10. Tasks no harness answers.**

Starts from `NO VALID ANSWER (lane 10)` and `AWAITING A LABEL (lane 10)`.

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

**11. Whether validity separates.**

Starts from `TIES BETWEEN VALID ANSWERS (lane 11)` and
`SAFEGUARD-9 PROMOTION BEYOND VALIDITY (lane 11)`.

The question is which measure carried each reading: validity, the objective or the bill. A task's
score weighs the three (`pointsOf`, `src/kernel/compare.ts`), and a step must clear its level on
the score and again without the bill (`stepOf`, `unbilled`), so a reading has three tallies.
For every comparison against the reference, set them side by side with their p: as scored, without
the bill, and on validity alone, beside the report's `points`. `TIES BETWEEN VALID ANSWERS` fires
where more than half the tallied tasks tie and at least one answer on each side is valid: there
validity separates nothing and the objective and the bill are all the reading has. Two valid
measures tie within the objective gap floor, `ROOM`, 1% of the larger measure. `SAFEGUARD-9` names a
promotion whose tested tasks on validity alone do not clear its level, with the same tasks read
without the bill beside it: where that clears the level the objective carried the promotion, and
where it does not, the bill did. A promotion of a GPT campaign at v0.7.1 read 6-0 as scored and
2-1 without the bill, and two readings of 8-0 at v0.7.3 were refused as steps because they did not
stand without it. Say for each step whether it rests on answers the reference could not give or
on better or cheaper answers to tasks both sides answered. In a drafted exam the objective is its
author's own computation (`INSTRUMENT AUTHORED`, lane 1), so the claim is "better by the objective"
and the objective's arithmetic is what a person checks first. The decision it changes is how a
promotion is worded, and whether the objective measures domain quality; it routes to `operator`,
and to `host` (`src/kernel/compare.ts`) where the three tallies disagree with the report.

**12. Ties and the budget.**

Starts from `TIED TASKS (lane 12)`.

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
task sets passed whole. Say what demand the tied tasks make: v1 measured that requirements
sharing one limit lowered pass counts, 7 of 20 against 22 of 23, where a tightened limit and a
widened exam did not. Do not prescribe an instance. The decision it changes is the size of the
budget the setting names and what the Examiner is asked for next; it routes to `operator` for
the budget and `examiner/task` for tasks every harness answers.

**13. Public disclosure and one recipe.**

Starts from `PASSES AT A SMALL WALL SHARE (lane 13)`.

The question is whether the task, the public resources and the tools publish a sufficient
construction, so that solving is following it. The lead is passes at a small share of the deadline in
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

**14. Pressure on the Examiner.**

Starts from `OUTCOMES BY SESSION (lane 14)`.

The question is whether anything moves the Examiner toward tasks that separate harnesses,
session over session. v1 pressed its Builder with zones, targets, slack figures and a
reference-distance pointer, and removed each after measuring it: every one pointed the author at
one route. Read the Examiner's current inputs in `AGENTS.md` section 3 and `record.ts`: outcomes
and recent histories, task admission results, family counts, valid-answer turns, the solve budget, who won each task, and the reference harness. It gets no target or other
harness's measure. Read which inputs each session actually received. `OUTCOMES BY SESSION` gives,
for each session's held-out tasks, how many
the reference harness answered in every solve, in some, in none, and how many no comparison has
scored, as they stand at the log's end, beside the reports the session opened after: one that
opened after none heard no outcome, and its tally is no effect of the channel. Read them in session order, and what changed in the instances between sessions:
families, the number of requirements meeting in one limit, sizes. The public inputs are in
`task.proposed`; describe how they differ and quote none. An author told the reference failed a
task can reach that outcome with tasks whose solves vary widely in what they need: such tasks
split evenly and add nothing, so set a session's outcomes beside lane 25's reading of the reference
harness against itself. Do not propose telling the Examiner a share, a target or a level: v1
measured that. The decision it changes is whether the Examiner's inputs are revised before
another session; it routes to `examiner-prompt`, and to `operator` for the reading.

### The harness

Label: `harness`.

**15. Harness delta against its note.**

Starts from `HARNESS CHANGED (lane 15)`, `BROKEN AT END (lane 15)`,
`MEASURED AN EARLIER STATE (lane 15)` and `TOOLS EDITED (lane 15)`.

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
which the diff alone gives, and an empty one is not an unchanged harness. Read every tool and
program the child holds for the Builder's one limit (`src/builder/prompt.ts`): nothing in a
harness names a task, copies its text or holds its answer. A search and a filter against the
public rules are allowed, and the solver decides what it submits; `ANSWER FROM A PROGRAM` (lane 19)
reads where a program's output was submitted unchanged. The
decision it changes is what a step, or its absence, is attributed to, and whether a gain is the
harness helping the solver work or answering for it; it routes to
`harness/guide`, `harness/tools`, `harness/tool-tree` or `harness/config` for the part that
moved, to `builder-prompt` when the limit was crossed, and to `host` (`src/builder/session.ts`)
when the measured state is not the one the log names.

**16. Operating guide and roster truth.**

Starts from `NEVER CHECKED (lane 16)`, `TOOLS CALLED (lane 16)` and `TOOL CALLS ERRED (lane 16)`.

The question is whether the guide, the tool descriptions and the tools' replies tell the solver
the truth. Read the child's guide and spec beside what solves under it did: the tools each
solve called, in what order, how many calls returned an error, and whether a tool the guide leans
on was ever called. An erred call is any non-zero exit, and a test the harness ships may report
what is unmet that way by design, as all 44 erred calls under buffer's child did on 12 October:
read what each call printed before counting it a tool that failed. A tool no solve calls is dead weight in every prompt; a tool most solves call
once and abandon promised something its reply did not give. Compare the guide's account of how
the tools combine with the sequences solves actually ran. A guide is appended to the solver's
prompt on every task, so a line that is true of the practice tasks and false of the domain costs
on every scored one. The round's prompt is the host's, in `src/solver/prompt.ts`, and its deadline
sentence is the host's claim: check it against the condition's limits. Do not judge the solving
method. The decision it changes is whether a failed solve failed the task or was misled; it
routes to `harness/guide` and `harness/tools`, and to `host` for a sentence of the solver's
prompt that the condition contradicts.

**17. Finish decision against practice evidence.**

Starts from `NO PRACTICE (lane 17)`, `FINAL BYTES NEVER PRACTISED (lane 17)`,
`SESSION ENDED (lane 17)` and `PRACTICE FAILS (lane 17)`.

The question is what the Builder did with each practice verdict before it stopped. Read the
session's `build.call` rows in order: edits, `check_harness`, `practice`, the ending and record
each practice returned, and the task's record under this harness and under the parent. Read
the Referee's rulings separately from the log; the Builder did not receive them. A session that edited after its last practice was measured on
bytes it never tried; one that never practised was measured on belief. The trigger reads this by
digest: a practice solve's condition names the state it ran under, so the harness that was
measured either is one of those states or is not, whichever tool made the last edit. The Builder is told one
solve is weak evidence and to read the record: say whether it practised a task again after a
change, and whether it decided beforehand which tasks a change should move. A session cut at its
deadline or its session turn limit is a whole session and is compared; say how many practice solves and turns it
had left. Read the gap between the last edit and `finish`. Follow each practice fail ruled earned:
what the Builder changed next, and whether the same task was practised again under the changed
bytes and passed. A pass after a fail with no edit between them is a flip and answers nothing;
a fail ruled a check defect that the Builder built around is a harness fitted to the exam's fault.
Count fails, of which ruled earned, of which followed by an edit, of which passed after. The
decision it changes is whether a no-step is read as the change not helping or as the change never having
been tried; it routes to `builder-prompt` when the session's order shows it was not told what
practice is for, and to `host` (`src/builder/session.ts`) for limits that ended a session mid
edit.

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
`src/tools/command.ts`) for a path the wall left open and `harness/guide` or `harness/tools` for
task content in the harness.

**19. Trace challenge.**

Starts from `WIN AT A SMALL WALL SHARE (lane 19)`, and only when lane 13, 15 or 18 suspects a
shortcut. That trigger counts the passed solves, in few calls and a small share of their deadline, of
tasks the new harness won, on validity, the objective or the bill alike. It also starts from `ANSWER FROM A PROGRAM (lane 19)` on its own, which needs no other
lane's suspicion: that trigger counts the solves whose one shell call was followed by `submit`, with
no file-writing call, per Builder session's practice and per comparison. It is a lead that one
program may have made what the solve submitted. Each comparison's reference side is printed beside its new one as the
control, since a solver can finish a task in one command of its own; on the #107 campaigns none of
the 132 reference solves read so, and 24 of recode's 40 measured solves under its built harnesses
did. The lane's own table is what tells a harness's program from a solver's one command.
`WINS (lane 19)` lists each comparison's won tasks by solve, as the comparison paired them, and
starts nothing by itself (`selected`). It runs alone.

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

**20. The Builder's conversation across compactions.**

Starts from `BUILDER COMPACTED (lane 20)`.

The question is whether a Builder that leads its campaign keeps its place across compactions,
continuations and campaign tools that run for hours. One conversation spans epochs (`AGENTS.md`,
section 4), so what it knows after a compaction is what the summary kept and what the host repeats
where it reads: the standing facts at the head of each turn's first result (`usedLine`), the
continuation after a turn without a call (`continuation`, both `src/builder/prompt.ts`),
`read_opening`, and the notes carried to the next conversation (`src/builder/memory.ts`).
`BUILDER COMPACTED` gives each session's `build.compacted` count beside its `build.turn` count and
its calls of `read_opening`. Read each compaction's `tokensBefore`, its seconds and any `error`,
then the calls after it: whether the Builder repeated a practice solve on a harness it had already
practised, asked for a comparison of a harness already read, re-released practice, or lost an edit
it had planned in its notes. Read the continuations the same way, and the notes a later
conversation opened on beside what the earlier one did. Compare the compaction rate per hundred
turns across the campaigns under review only where their Builder model and tool results agree.
The decision it changes is whether the conversation earns its continuity over a controller that
opens a new session each move (`AGENTS.md`, section 4: the mode is unclaimed until an ablation
reads it), and what the host repeats after a compaction; it routes to `builder-prompt`
(`src/builder/prompt.ts`) for a fact the Builder lost and the host does not repeat, and `host`
(`src/agent/backends/compaction.ts`, `src/builder/memory.ts`) for a compaction that failed or a note
that did not carry.

### The comparison

Label: `comparison`.

**21. Pair identity and source reach.**

Starts from `HOST CODE MOVED (lane 21)`, `STARTS OUT OF TURN (lane 21)` and `SERVED ANOTHER MODEL (lane 21)`.

The question is whether the two sides of each comparison differ in the harness and in nothing
else. A condition is a content address: the contract, the harness, the task version, the model
and its effort, frozen prices, the runtime's pinned packages, the compaction mode, the solver's
and the verifier's tool trees, the sandbox, the limits, the host's code and the side. A
comparison counts a solve under one of its harnesses and its own setting, started after its
`comparison.started` event, and no solve made before (`src/campaign/round.ts`). Confirm it from
the log all the same: for the counted solves of each comparison, list the distinct values of
every field but the harness and its `solverTools`, which may change with it. Then read what a
condition does not hold: load, recorded at solve start and finish, which the solve queue in `tools/d2/host.ts` bounds at
the start unless `--loaded` is named; the hour; the provider's
served model, which `responseModels` names or leaves empty, and `SERVED ANOTHER MODEL` counts
by side where it is not the one the condition asked for, or over the whole campaign where no
scored solve shows it (row C and the derived `degradations.txt` count every seat's turns); how many solves ran at once. The round
mirrors which harness takes the first place, slot by slot and task by task, so that neither has the
quieter hours. One worker runs a task's slots in that order: each solve call, with its load wait,
its provider reruns or reset and its one outer retry, returns before the next slot starts
(`drain`, `src/campaign/round.ts`). A round that ran before that hold queued each solve on its own,
so a load wait or a provider's rerun on one side let the other side's later slots start first.
`STARTS OUT OF TURN` counts the tasks whose counted solves did not start balanced between the
sides. In a comparison run with the hold it is a defect of the round; in an older one, read which
side started late and what it waited for (`campaign.waited`). Where the host's code moved inside the
campaign, name the commits between the two hashes if this checkout has them. A campaign command
that ran names its commit, and whether the tree was dirty, in `launch-run-<n>.json` beside the
log. The decision it changes is whether a difference between the sides is the harness's; it
routes to `host` (`src/kernel/condition.ts`, `src/campaign/round.ts`) for a field a condition
should hold and does not, and `environment` for load.

**22. The scored set and what left it.**

Starts from `SCORED SET MOVED (lane 22)`.

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
side remove that side's losses, which lane 7's `SET ASIDE BY SIDE` counts. Read `counted` in
the report, the tally were every such rejection to stand, beside `scored`. A comparison asked
for again on other terms under the same id is refused; confirm no second `comparison.started`
carries the id. Until 2026-10-09 a round screened candidates and admitted the ones a harness
failed; a log from before then holds those admissions, and their tallies are of a selected set.
The decision it changes is whether the tally is of the set that was fixed; it routes to `host`
(`src/campaign/round.ts`) and to `operator` for the labels that would return a task.

**23. Paired sign-flip test, ties and power.**

Starts from `NOTHING SCORED (lane 23)`, `CUT BY ITS CAP (lane 23)` and
`SET SHORT (lane 23)`, and is standing.

The question is what the comparison's test could and could not have shown at its size. The paired
sign-flip test reads each task's score; a tie carries nothing. It reduces to the
sign test where all untied margins are equal. v1 found the signal too
rare to settle a comparison at the size it ran: 11 of 322 task sets held a fail nobody
contested. Read `scored` with its `differences`, p, `detectable`, `falseRate`, ties and
unanswered tasks, which the step tested since 20 October, and the frontier and retained tallies
apart (before 20 October the step, `detectable` and `falseRate` were the frontier's). Say
how many untied tasks there were and what the smallest result is that would have cleared the
level on those margins. Reversing one observed win establishes neither a small sample nor a
requirement to win every task. A comparison that tallied no task tested nothing and reads
`not-scored`; before the report learned to say so it read `no-step`, as the eight truss rounds
of 8 October did. `CUT BY ITS CAP` names
one its dollar cap ended: it is finished, reads `not-scored`, and its solves are in no tally. A
`no-step` at four untied tasks is no evidence of no gain, and a `step` at five rests on five
tasks: say both plainly. One comparison of equal harnesses reads a step at most as often as its
level allows, 2% at the default, and since 19 October one step against the reference promotes,
so a campaign's improvement patience of attempts sums that risk (until 19 October a step was repeated before
anything was promoted). Read the tasks left out through `short`, `aside`, `withdrawn` and
disputed task states, and
whether leaving them out could have moved the tally. The decision it changes is whether the
operator enlarges a future comparison or reads the result as it stands. A finished comparison
keeps its terms and is not topped up or rerun for another chance at a step; it routes
to `operator`, and to `host` (`src/kernel/compare.ts`) only for an arithmetic fault.

**24. The starter.**

Starts from `VALID BY HARNESS (lane 24)`.

The question is what the starter gives a campaign to build on, and whether the tasks leave a
harness room to add anything to it. The Starter Built Harness is pi's coding agent with pi's four
coding tools, no domain program and the starter instructions as its guide: two lines true in every
domain, in `EXAMPLE`'s outline with its entries empty (`src/harness/starter.ts`). Until 27 October
its guide was empty, and 38 of the 43 promoted guides then on record copied `EXAMPLE`'s outline
exactly. Its digest names the guide, so a campaign opened before the change holds its solves under
another digest. `VALID BY HARNESS` gives each harness by itself, as the tasks by how many of their
solves were valid, none first: for the first comparison's reference that is the starter's own
result. Read it beside the same reading of the release before, by pack, where the setting agrees,
and say whether the guide moved the starter's valid share; one campaign a release is one sample.
A starter valid on nearly every solve has tasks too easy to show an improvement, and `decide`
then asks the Examiner for others. Then read each built guide against the starter's: whether it
keeps the two lines, drops them, or rewrites them, and whether it still copies `EXAMPLE`'s outline
or grows its own. After a promotion the starter comparison puts the starter against the reference: the tasks written for the
promoted harness are read by the starter against it before a Builder session is paid for, which
is where the plan reads whether the starter loses more each epoch. Read which tasks the starter
answers that a harness does not, by the solves' endings and never their text. The decision it
changes is whether the starter's guide stays as it is, and at the first task admission whether the tasks are
replaced; it routes to `host` (`src/harness/starter.ts`) for the starter's guide, `operator`, and
`harness/guide` or `harness/tools` where a harness loses to the starter.

**25. Flips and solver variance.**

Starts from `FLIPS (lane 25)` and `REFERENCE AGAINST ITSELF (lane 25)`.

The question is how much of the tally is the solver's variance. A task that the same harness
both answered validly and did not, under one condition, is a flip. v1 recorded a fail repeating
5 times in 21 on the same bytes, and in one truss run 13 tasks solved 59 times failed twice
with both fails passing beside them. Under a fixed budget a flip is also a solve that needed a
little more than the budget once and a little less the next time. `REFERENCE AGAINST ITSELF` is
the direct measure: at four or more even solves per side, `compared` splits the reference's
own solves into two halves mirrored in time, on the tasks the comparison tallied. It runs no
extra solves. Two samples of one harness should tie on most tasks and win as
often as lose; the tally's untied share is the noise every comparison at that budget has to
exceed. `readsStepEitherWay` reads it either way, each half at the comparison's level, and its
`detectable` is sized at the same level. An A/A that reads a step is a report and ends nothing;
the climb counts it beside the false-promotion estimate. Count the flips per
harness beside it. Where the new harness flips less than the reference on the same tasks, the
gain may be steadiness; where both flip alike, a win by one solve in two is within what one
harness does to itself. The decision it changes is how many solves a side a task needs, and
whether the budget's unit is fit; it routes to `operator`, and `environment` when flips cluster
in hours of high load.

### The climb

Label: `climb`.

**26. The chain of comparisons.**

Starts from `CHAIN (lane 26)` and `NO TASK HELD OUT (lane 26)`.

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
reads the opening's improvement patience, six by default. `stopRule` counts changed harnesses once against
one reference by their last comparison that scored and left room, and unchanged whole sessions
shown a failed practice solve. A step is a gain; a promotion starts the count again. Starter comparisons
and readings with no score or no room do not count. A campaign with no held-out task measures nothing at all: eight rounds on the
truss pack ran so on 8 October, for over $220, and each could only read that no task was
scored. The decision it changes is what runs next:
a promotion, another standalone comparison, an Examiner session, or a stop; it routes to `operator`.

**27. The promotion and the climb after it.**

Starts from `PROMOTED (lane 27)`, `STARTER BARE (lane 27)`, `AFTER THE PROMOTION (lane 27)` and
`SHARED TEMPORARY FOLDER (lane 27)`. Where several campaigns are under review, it is given their
climbs side by side, in the columns `wri.ts climb` prints.

The question is whether a promotion measured what the campaign exists to measure, and whether the
campaign climbed from it. Lane 26 reads the chain and whether a step was promoted; lane 24 reads
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
budget; those do not measure a solver told the shorter one. Read lane 15's account of what the Builder
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
comparison read against the promoted harness, the starter comparisons that put the starter against it, the
Builder sessions with their parent and how many of their practice tasks were written since, and
any comparison started and not reported. A climb is these in order: an Examiner session that
leaves the promoted harness room (`informative`, including valid author answers and objective
improvements), any starter comparison the table called for, a Builder session and its released practice
tasks, and a comparison against the promoted reference. Since 19 October `noRoom` requests one
Examiner session after each promotion even where its supporting reading left room. The setting
stays fixed. Read the reference's valid share and objective gap epoch by epoch: if every new task is one
the promoted harness already answers, the campaign is measuring ties, and lane 23's power says how
many tasks the next step would need. If the Examiner holds out tasks the promoted harness fails
for reasons no harness can change, the room is false; lane 10 reads those.

Last the cost: dollars and hours from the opening to the promotion, and from the promotion to the
next session's end, by role (lane 31's spend). A campaign that spent most of its budget reaching
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
`operator` for the report and the keep or stop, `host` (`src/campaign/decide.ts`) for a move
after a promotion the rule did not make, `examiner-prompt` (`src/examiner/prompt.ts`) for room
written where there is none, and `environment` for the shared temporary folder and the load.

**28. The moves against the table.**

Starts from `MOVES ASKED (lane 28)`, `ENDED AND WENT ON (lane 28)` and `OPERATOR WORDS (lane 28)`.

The question is whether the campaign command made the moves its table names, and whether each
of its endings came for the reason it records. The table (`decide`, `src/campaign/decide.ts`)
advises; inside a led campaign the Builder chooses, and the host makes what needs no Builder
(`hostOwed`, `tools/d2/harness-builder.ts`). `MOVES ASKED` counts the `campaign.move` events with
the code `asked`, by move, out of every move: the Builder asked for one move where the table named
another. Read each beside the decision the table gave at that point (`bun run runs view` replays
it as its last line) and say whether the move it took moved the chain (lane 26) or spent a
comparison the table would have saved. Then read the endings. A `campaign.ended` is the last
event of a run that stopped, so `ENDED AND WENT ON` names each ending that later events follow: a
continuation, which is right after `operator`, `finished`, `environment` or a crash, and a fault
after `budget`, `stop` or `no-room` unless an operator's word (`--budget`, `--past-stop`) stands
between. Recount the idle conversations behind each `finished` (`idleOf`,
`tools/d2/campaign-terms.ts`) and the readings without room behind each `no-room` (`roomless`,
`src/campaign/decide.ts`), and say whether the count that ended the run is the count the log
holds. `OPERATOR WORDS` tallies the `campaign.word` events by kind and how many an event answers
(`pendingWords`, `src/campaign/word.ts`): a word nobody answered is still owed, and one answered
twice took effect twice. Confirm that no seat's context names a word. The decision it changes is
whether the controller's moves and endings may be read as the table's, and whether a move the
Builder chose instead is advice the table should give; it routes to `host`
(`src/campaign/decide.ts`, `tools/d2/harness-builder.ts`, `tools/d2/campaign-actions.ts`) for a
move or ending the table did not name, `builder-prompt` (`src/builder/prompt.ts`) for advice the
Builder read and set aside, and `operator` for a word that did not act.

### The solve

Label: `solve`.

**29. Solver process and deadlines.**

Starts from `MISSES AT A LIMIT (lane 29)`, `WALL SHARE (lane 29)`, `HOST LOADED (lane 29)`,
`LOAD MOVED (lane 29)`.

The question is how the solver used its time before deadlines, and whether a miss measured the task or its
deadline. The limits are the host's, in the condition: the solve's deadline, the turn cap, the shell's
default and maximum, and concurrency. `LIMITS` defaults to 20 model turns, 30 minutes and 24
prompts; read the solve's own recorded limits. There is no seat disk cap on either platform; until
19 October a Mac runner mounted a 2 GiB image per seat. A solve the deadline ended is a fail in the count and a truncated
solve, never a settled failure of capability, and so is one its model turns or its context
ended. `MISSES AT A LIMIT` counts, for each comparison and each side, the misses that ended at
one of the three, with every turn their bound allowed used by the end's count (`last turn`), or past 95% of
the deadline, with their kinds and the turn bound the solves were
told, and the misses outside any comparison on a line of their own: on 10 October recode ended
41 of its 58 scored misses on turns, 12 of 18 reference misses and 4 of 4 new in g-2 at 8 turns,
and a read of the deadline alone saw none. A side whose misses are all at a limit was limited by
the recorded budget; each still counts as a fail. For each side, read the share of the deadline a solve
used. Read the median share under the parent and
the child on the scored set, and say whether the child's solves got shorter, longer or the same
on the tasks both passed. Read `seconds` against the load at start and end. A deadline counts elapsed time, so a loaded host holds less
work in it.
`HOST LOADED` names a comparison whose solves started, at the median, under a load over the
host's cores, where the log holds the cores (from 9 October). `LOAD MOVED` gives the median
load of each comparison's first half of solves and its second, by start, where the busiest half
ran under twice the calmest or more, within one comparison or across them: on 9 October one
harness answered the same tasks in a median of 105 s under a load of 31 and of 40 s under a load
of 6, so a step and its repeat, or two readings at one deadline, were not made under one budget. A
`solve.finished` written before 11 October holds the CPU seconds of the solve's commands
(`cpu`), which the meter read only of the children a command waited for, as a floor where a
command was cut, and as zero under Bubblewrap; no trigger reads it since, and no budget was
given in it after 9 October. The prompts a solve is given are v1's cap on nudges and every
solve's: every finished solve of the first three rounds on 9 October was given one, and a
budget in `prompts`, which was a unit until then, read what the full limit read. Since
11 October a comparison is read at the one budget its solves were told. The decision it changes is whether a
deadline-bound miss is the task's or the deadline's, and whether a gain shows first in time; it routes
to `environment` for load, `harness/guide` when the guide sends the solver into work the deadline
cannot hold, and `operator` for the deadline itself.

**30. Failure mechanism and non-result honesty.**

Starts from `NON-RESULTS (lane 30)`, `SOLVE NEVER FINISHED (lane 30)`,
`EXAMINER NEVER FINISHED (lane 30)`, `MISSES WITHOUT A VERDICT (lane 30)` and `SESSION CRASHED (lane 30)`.

The question is, for every ending that is not a pass or a refused answer, which link broke first
and whether its kind is honest. A non-result is never counted and a solve-side one is run again,
up to three times; a fail counts against the harness. So the line between them decides a tally:
v1 excused timeouts as the environment's and could leave out a quarter of its cases, and a
harness that timed out more could look better. Here the deadline, the context and a missing answer
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
written; it routes to `host` (`src/solver/run.ts`, `src/kernel/solve.ts`) for a kind that hides a
cause, `environment` for a provider or the machine, and `harness/tools` for a harness that does
not open.

### The economy

Label: `economy`.

**31. Time, spend and silence.**

Starts from `LONG SILENCES (lane 31)` and `SPEND LED BY A ROLE (lane 31)`.

The question is where the hours and the dollars went, and what each long silence was. Use
`spendOf`, which delegates billing to `billedAll`: ending records count closed work and turn
records count work without an ending. Drafting and `try_task` admission solves are the
Examiner's spend. Read metered and backend-reported amounts separately where the events hold
them. Say what share the reviewers took here and what their rulings changed, which is lane 7's.
Row A puts the hours by role beside the billed dollars: each Builder and Examiner session and
each comparison from its start to its end, a session a stop cut to the stop, and the rest of the
campaign's span as between moves; on 10 October recode's Builder took 52% of the hours against
43% of the dollars. `LONG SILENCES` reads every gap between two events longer than five of the
campaign's median measured solve, a pass or a fail, and never under ten minutes, and names the
five longest by what ended them: a command whose time covers most of the gap, a model turn with its output
tokens, or nothing open between moves. A fixed twenty minutes read nothing on buffer on
10 October, whose longest gap was 19.5 minutes; recode's two gaps over it were each an Examiner
turn of over 56,000 output tokens. For each silence, confirm what was running from the events on either side: a
solve at its deadline, a Builder command, a provider wait, a machine asleep. Read the cost of one round at the plan's size
from this one's parts and say what the next costs. `AGENTS.md` sections 1 and 6 own economy and
the campaign's dollar cap. The decision it changes is what the next round is expected to cost and whether a role's
spend is earning its place; it routes to `operator`, and to `environment` for a wait nobody
chose.

### The runs

Label: `runs`.

**32. The run's launches, logins and hosts.**

Starts from `LAUNCHES (lane 32)` and `NO LAUNCH RECEIPT (lane 32)`.

The question is whether the run is the run its readings claim: fresh from a prompt, at one commit,
from a clean tree, and continued only after a pause, a restart or a change of login (`AGENTS.md`,
section 10, item 9). Each launch writes a receipt beside the log (`launch-run-<n>.json`,
`tools/runs/receipt.ts`), and the log holds the host's code only by content. `LAUNCHES` fires
where there is more than one launch or any dirty tree, and names the launches, the commits, the
dirty ones, and how many logins and Bun versions the receipts record. Name no login: count them.
`NO LAUNCH RECEIPT` fires where a campaign command opened the log and no receipt lies beside it, so
nothing says which commit ran. Read each continuation beside the event before it: a run continued
at another commit is no fresh run, and its later promotions count for nothing (item 9); one
continued after a credit or session limit is rule 15's ordinary case and no defect. One campaign
name can stand on two hosts, as two forks of one pack did on 27 October: read each copy by the
host its snapshot came from (`data/runs/<host>/<name>`), never add their counts, and say which copy
each finding cites. Count the runs live on each login at each launch against the fleet's cap
(`bun run runs active`), without naming a login, and say whether a launch went over it. Set each
receipt's load against its cores, and read the `campaign.waited` events and any wait at a named
reset (`waitOut`) as the host's time. Confirm that every comparison's condition names one host-code
digest per launch (lane 21 reads the pairs). The decision it changes is whether the run's
promotions count towards the milestone, and whether a launch path let a run start at a commit or
tree it should not; it routes to `operator` for a run whose promotions do not count, `environment`
for a host, a login or a load, and `host` (`tools/runs/`, `tools/d2/harness-builder.ts`) for a
receipt missing or wrong.

### The log

Label: `log`.

**33. The log and what reads it.**

Starts from `LOG OUT OF ORDER (lane 33)`. It also opens where it is named, since every report
rests on the folds it checks.

The question is whether the log holds one consistent history, and whether the readers print what
the log holds. The log is append-only with one writer under a lock (`src/kernel/log.ts`), so a
timestamp earlier than the line above it, a `solve.finished` whose solve never started, or a
`comparison.started` written twice under one id are each a history no writer should have made.
`LOG OUT OF ORDER` names which and how many. Read each against the processes the receipts record
(lane 32): two controllers on one log is the usual cause. Then recount one number from each reader
a person reads against the folds: the view's comparisons and next move (`bun run runs view`), the
closing report's promotions and spend (`tools/d2/close.ts`), the pulse's open runs and endings,
run-improvement-campaign's `scripts/cycle.ts` promotions and hours, and the page where it was used. A reader that disagrees
with the fold it should call is a second reader of one fact (rule 12). Run `bun run runs replay`
where the tree that reads differs from the tree that wrote, and say which event kinds this tree
cannot read. The decision it changes is whether any count in the other reports can be believed as
the log's, and which reader to correct; it routes to `host` (`src/kernel/log.ts`,
`src/kernel/reports.ts`, `tools/d2/close.ts`, `tools/runs/`) for a writer or reader at fault, and
`environment` for a log written by two processes.

### The audit

Label: `climb`.

**34. Harness quality, version by version.**

Starts from every harness version the campaign kept, and is standing.

The question is whether the harnesses a campaign climbed through got better at the domain, or only
quicker at winning comparisons. A step says the new harness beat the reference on the scored tasks
under one setting (rule 1). It does not say how hard those tasks were, or whether the change that
won is one a person who knows the field would keep: on 30 October all six promotions of the cycle's
runs after 02:45Z won on the objective alone. Promotions an hour measure the climb's speed; this
lane reads what each promotion bought.

Grade before you read a result, in this order, writing each grade into the report as it settles:

1. From the campaign's derived folder (`wri.ts derive`, named in the campaigns section), read
   `chain.txt`: each kept version, its parent, its parts and the count of what moved against its
   parent, with no result (`harness-versions.ts --blind`).
2. Read the lines that moved: `diff -r` of `states/<parent>/` and `states/<digest>/` beside the log
   ([harness-audit](../../harness-audit/SKILL.md)). Grade soundness. A version
   the copy does not keep (`versions.txt` says so) goes under `## Not read`, ungraded: refreshing
   the copy is the primary's (`runs fetch <name>`), and no lane reads another host's folder.
3. Read `tasks.txt`: each scored task's public input and the comparisons that scored it, with no
   outcome (`tools/wri/tasks.ts`), and the checks under `exams/` it is held to. Grade reach.
4. Only then read the results: `versions.txt` (each version's comparisons and promotions),
   `readings.txt` (each comparison's tally, the tally without the bill and its A/A), and rows D and
   E in `rows.txt` (each task's valid share).

Grade on two scales of 0 to 7. A scale of ten left its lower half unused once current models solve
routine work (operator, 30 October), so eight points carry the range that occurs. Each grade is a
reviewer's reading: it changes no verdict, reading, promotion or move, and no seat is told it.

**Reach** is how hard a held-out task is for a strong current model working in the domain. Grade
each task a comparison scored from its public text, the rules it cites and the checks that read it,
before reading any outcome of it:

- 0: one lookup, or a direct transform of the input;
- 1: a routine method applied once;
- 2: a few standard steps, one constraint at a time;
- 3: several steps with one subtlety of the field that a careful generalist catches;
- 4: constraints that interact, or the field's own engine used with care;
- 5: specialist work: a method a generalist would not choose, or a tolerance that punishes approximation;
- 6: work a specialist gets wrong on a first pass;
- 7: the field's edge, where no published method fits whole.

Before the first grade, write the features of this domain's tasks that place one at each grade you
use (sizes, limits, tolerances), so a second reader grading from them reaches the same grades.

Then set each grade beside the reference's valid share of the task (rows D and E, `rows.txt`). A
task graded low that no harness answers is lane 10's question; one graded high that the starter
answers every time says the grade is too high for this solver, and is regraded once with that
reason. For each comparison, give the grades of the untied tasks the new harness won and those it
lost, and say on which grades the step rests. A version's reach is the highest grade at which it
holds valid answers on most of its solves. Where the reference answers every scored task validly,
reach cannot separate the versions: say so once, and for each step give instead how far its
objective wins moved the objective, and on which grades.

**Soundness** is whether a version's change is right for the domain, beyond whether it won. Grade
each version against its parent from the diff alone, before reading its comparison:

- 0: it breaks or misleads: the guide claims what no tool does, or a tool fails its own call;
- 1: it is fitted: it names practice content or narrows to the practice set's shapes (lane 18's limit);
- 2: churn: rewording or reordering that no solve's behaviour could follow;
- 3: plausible but narrow: it helps a few task shapes and is silent on the rest;
- 4: sound for one part of the domain, stated generally;
- 5: sound across the domain's kinds of task, and the solves under it call what it added;
- 6: a method a specialist would teach, with its own checks built in;
- 7: what an expert would adopt unchanged.

Then read whether the step's wins fall where the change acts. Set the version's weight beside its
soundness: guide lines, tools and tool-tree files from `chain.txt`. Weight that grows while
soundness stays flat is weight, not quality.

Write the grades under a `## Grades` heading between the verdict line and `## Findings`: one row a version in chain order
(the digest's first eight characters, its parent, each comparison's reading with its tally and its
tally without the bill, weight, soundness with one sentence, reach), then one row a comparison with
the reach grades of the tasks won and lost. A sentence names parts, kinds and counts; it quotes no
task, answer or line of the harness. The decision it changes is whether a climb is reported as the
harness getting better at the domain, or as promotions won on easy tasks or on the objective alone;
it routes to `operator` for that report, `harness/guide` or `harness/tools` for a version graded
0 or 1, `examiner-prompt` (`src/examiner/prompt.ts`) where the scored tasks all grade 2 or below
and the reference answers them, and `builder-prompt` (`src/builder/prompt.ts`) where soundness falls
while promotions go on.

## Retired from v1

`from-v1.md` holds the whole account: which of v1's nine rows and thirty-eight lanes were kept,
overhauled, merged or removed, and why. A reader meeting one of the removed lanes in a v1 archive
reads it from that archive alone.

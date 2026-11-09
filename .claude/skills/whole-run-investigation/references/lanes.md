# Whole-run investigation lanes

The catalogue: six deterministic rows the primary settles itself, and thirty-one lanes, each one
question a paid session can be given. `tools/wri/catalogue.ts` parses this file, and
`test/wri-catalogue.test.ts` holds it to `TRIGGERS` (`tools/wri/folds.ts`): each trigger the reader
prints is named in the `Starts from` paragraph of the lane it starts.

## Who holds which pen

The Examiner writes the exam (drafted from the operator's prompt, or imported as a stored pack),
the Builder writes the harness, the host's verifier decides validity and the Referee rules each
rejection. `AGENTS.md` sections 1 to 8 own the seats, their views, the wall and the promotion rule;
apply them to the conditions the log records. No seat repairs the check program during a campaign,
and a pass establishes only what its check reads. Every row and lane applies six readings:

- **Weigh each verdict by its instrument.** A check that runs the field's own engine establishes
  more than one that runs its author's computation. Name the instrument before relying on a verdict.
- **Name the bytes.** A solve ran under one condition: contract, harness digest, task version
  (which holds the check program's hash), verifier tool tree, sandbox and host code. Two solves whose
  conditions differ in more than the harness are not a pair.
- **Keep the endings apart.** A valid answer, a rejected answer, a solve that hit its limits with no
  answer, and a non-result are four outcomes. Only a rejection says anything about a check, and a
  non-result is solved again and enters no pair.
- **A ruling is a reading.** The Referee's agreement with a person is unmeasured until hand labels
  exist, and an earned ruling that probed nothing restates the check.
- **A comparison is only its untied tasks.** A tie carries nothing, a flip is solver variance, and a
  task set aside for one side's rejections is that side's loss removed.
- **Separate observation from inference.** State the recorded observation and the proposed cause as
  two sentences, so a reader can keep the first and reject the second. An earlier diagnosis is a
  hypothesis, never a premise.

## How the catalogue is read

A trigger is the capitalised text before the first colon of a line `bun tools/wri/wri.ts read`
prints, with its lane beside it. It says a lane has something to read, never what the answer is,
so a lane that refutes its trigger has done its job. Lanes 1, 2, 18, 26, 27, 30 and 31 are
standing: they open on every campaign, triggered or not. Lanes 4 and 15 are isolated: each runs
alone, only on its trigger, and freezes its result before it reads anything that could lead it.
Lane 27 grades blind, so it is read first in any session it shares.

No lane changes a verdict, a task's state or a reading. Its product is a finding with exactly one
owner, the evidence it cites and the observation that would reverse it:

| owner | what it is |
| --- | --- |
| `pack/evaluator`, `pack/brief`, `pack/controls`, `pack/tasks` | the exam, stored or drafted, by file |
| `examiner/task` | an instance, as a session wrote it |
| `harness/guide`, `harness/tools`, `harness/tool-tree`, `harness/config` | the Built Harness, by part |
| `builder-prompt`, `examiner-prompt`, `reviewer-prompt` | what a role is told, with the file under `src/` named |
| `host` | the host's code, with the file named |
| `environment` | the machine or a provider |
| `operator` | a decision the plan leaves to a person |

Cite evidence by event kind, solve id, the first eight characters of a digest, check id and count,
never by a task's text, an answer, a hidden value or a passage of a trace.

Each lane carries `Label:`, `Importance:` and `Marks:` lines, which no session is shown. The
importance (0 to 1, only ratios matter) weighs a lane when `wri.ts lanes --agents N` packs whole
labels into sessions. The marks (`standing`, `alone`, `blind` and `side-by-side`, or `none`) are
what the code reads of how a lane opens; a lane's prose says the same to its session. Then comes one paragraph beginning `Starts from`. Old lane numbers in earlier reports map
to today's through the head comment of `tools/wri/catalogue.ts`.

## Labels

Every pull request carries an importance label and at least one area label, one for each area its
files touch (`checkLabels`, `tools/runtime/land.ts`). A lane carries the label of the pull requests
that change what it reads. Each run's `predictions-<run>.md` gives a row its pull request's
labels and draws its lanes from them (run-improvement-campaign, step 1).

| point | lanes | label | a pull request carries it when it changes |
| --- | --- | --- | --- |
| verdicts | 1, 6, 10 | `exam` | drafting, the check program, the verifier, controls, freeze or admission, public task text |
| verdicts | 2–5 | `verdicts` | the Referee, set-asides, hand labels and `settle.ts` |
| supply | 7, 9, 11 | `supply` | task writing and admission, release, room, what the Examiner is told |
| climb | 12–16 | `harness` | the Builder's session, prompt, tools or practice, the harness contract, the wall to the Builder |
| honesty | 8, 17, 18, 20, 29 | `comparison` | a comparison's terms, pairing, scored set, tally, test, A/A, conditions |
| climb | 19, 21–23, 27, 28, 30, 31 | `climb` | the move table, moves, starter comparison, promotion, stop rule, endings, words |
| honesty | 24 | `solve` | a solve's run, backends, the wall, endings, non-results, slots and load |
| economy | 25 | `economy` | billing, the meter, the budget, time readers |
| honesty | 26 | `runs` | launching and moving runs, logins, hosts, receipts |
| honesty | rows A–F | `log` | the log, event kinds, conditions, shared folds, `view`, `replay`, the page |
| none | none | `investigation` | `tools/wri/`, this catalogue, its skill and the scripts its lanes run |
| none | none | `landing` | the stack, `bun run land`, the hooks, the CI gate |
| none | none | `quality` | lint, the simplify census, the size policy, how code is written |
| none | none | `docs` | `AGENTS.md`, `docs/` and other prose of record |

A row with no lane is settled by its tests or its own reader. A change no label holds takes the
label of the nearest code; several such pull requests on one subject mean the table lacks a row.

## Deterministic rows A–F

The primary settles these from the log before any lane is launched and never delegates them: every
finding binds to them. `wri.ts read` prints them.

**A. campaign and log.** A campaign is a folder `.ana/d2/<name>` holding `log.jsonl`, the staged
`checks/` (`exams/<digest>/checks/` for a drafted exam) and `states/`. Confirm the log folds (`read`
throws on an impossible task history). Compare the last condition's host hash with this checkout's:
where they differ, every statement about source concerns another tree, and the report says so first.
Row A also gives dollars and hours by role, which lane 25 starts from.

**B. checker identity.** The checker is two hashes, the contract's and the check program's, read
from `contract.frozen` and every `checker.read`. A campaign with nothing frozen has no frozen
checker, and a reading at other hashes is of another checker. `despite` on a freeze is the
operator's reason for freezing over faults: quote its count, not its text.

**C. conditions.** Count the distinct values of each condition field by side and model; one
contract, sandbox, tool tree and host hash is the clean case. Count finished solves that name no
response model, whose served model only the provider attests.

**D. task sets.** Partition task versions by origin (pack, session, carried) and by state (held
out, released, disputed, refused). A round's sets must be disjoint; a version both practised and
measured is `PRACTISED TASK MEASURED`, lane 12's, and is settled here first. A task with no valid
answer after two comparisons that cut none of its solves at a limit leaves the scored set until a
person labels it (lane 9).

**E. case partition.** For each side, count passes, fails by kind and non-results by kind from
`solve.finished`, solves started and never finished, and those open at the log's end. Only a
`rejected` fail carries refusing checks. Count `flagged` apart. Recount any figure a report quotes.

**F. sessions and the harness chain.** The campaign's moves, endings and bill against budget. For
each Builder session: parent, digest left, ending, whether it changed anything and opens, its
practice, and the reading of each comparison of its harness (named by session, `g-N`). For each
Examiner session: ending, proposals, and what stood. A move is recorded as it begins, so name every
step still open at the log's end on its own line and judge closure by the step's own ending.

## Lanes 1–31

### The verdicts: the instrument, its review and its draft

**1. Verdict chain: what a pass observes.**

Label: `exam`.
Importance: 0.6.
Marks: `standing`.

Starts from `INSTRUMENT AUTHORED (lane 1)`, `REFUSALS BY CHECK (lane 1)`,
`VERIFIER TOOLS MOVED (lane 1)`, the checker's own `NO CHECKER READING (lane 1)`,
`CHECKER READ WITH FAULTS (lane 1)`, `CONTROL COVERAGE (lane 1)`, `CHECKER NOT FROZEN (lane 1)`,
`FROZEN DESPITE FAULTS (lane 1)`, `READ AT ANOTHER VERSION (lane 1)` and `TASKS CARRIED (lane 1)`,
and from `PASSES UNREAD (lane 1)`, which is standing: no reviewer reads a pass.

What does a pass establish? The Referee reads only rejections, so a check that observes too little
goes unseen. Set each check's row in the last `checker.read` (instrument, controls, refusals from
`REFUSALS BY CHECK`) beside its entry in `checks/brief.json`. Then sample passes across families and
harnesses, weighted to checks that refused nothing, and say from the published rules what a passing
answer could still get wrong: an unread field, an uncited rule, a looser tolerance. An `author`
instrument means only that the author's computation agreed, and a named tool is a field engine only
if it does the decisive work. With no pass, the check rows are the whole lane. For `VERIFIER TOOLS
MOVED` or a checker trigger, say under which tool tree or checker each result counted; carried tasks
are read with `tools/c/repaired.ts`, and `wri.ts grade` tests a constructed answer. Read no pass
rate. The decision: whether a pass means a right answer or a well-shaped one. Routes to
`pack/evaluator`, `pack/brief`, `pack/controls` and `operator` (a freeze `despite` faults).

**2. What each seat was told.**

Label: `verdicts`.
Importance: 0.7.
Marks: `standing`.

Starts from each seat's opening at the campaign's commit, and is standing.

Did a seat's text set it a course, a target or a count, or give it a false, missing or doubly
stated fact (`AGENTS.md` section 2)? A defect in a seat's text moves every session of that seat.
Read, at the receipt's commit, the Examiner's prompts (`src/examiner/draft.ts`,
`src/examiner/prompt.ts`, `examiner-view <name>`), the Builder's (`src/builder/prompt.ts`,
`builder-view <name>`, its `build.call` results) and the Referee's (`src/referee/referee.ts`). List
each sentence that names a route and each fact a later move rested on, with the event showing whether
it was true. A course shows as moves that follow the sentence whatever the outcomes; a false fact as
a move the true one would have changed. Prompt sentences may be quoted. The remedy is a fact or a
deletion, never a target. The decision: whether a seat's text is revised. Routes to
`examiner-prompt`, `builder-prompt` or `reviewer-prompt` with the file, and `host` for a tool result
built from the wrong fold (`src/builder/past.ts`). Any change to the Builder's text must stay
byte-identical under a changed hidden value (rule 3).

**3. False rejection among fails.**

Label: `verdicts`.
Importance: 0.5.
Marks: none.

Starts from `REFUSED UNREAD (lane 3)`, `CHECK DEFECT RULED (lane 3)`, `RULED UNCLEAR (lane 3)` and
`REPLAY MOVED THE VERDICT (lane 3)`.

Was each refused answer wrong, or right and refused? A false rejection is a win on the parent's side
and a loss on the child's. Sort rejections by ruling, and decide for each check whether its rule as
published could reject a valid answer (a tolerance tighter than the published rounding, a unit read
otherwise, an ambiguous sentence). Read the rulings against that: an earned ruling names a rule
and a field, and a check-defect ruling names a refusing check and cites a probe that moved it off its
refusal. Where hand labels exist (`labels.json`), set rulings against them and say
whether the bar of `AGENTS.md` section 1 is cleared; otherwise call the rulings one reader's.
`REPLAY MOVED THE VERDICT` is a check that does not repeat. Where public facts cannot decide, keep
the ruling and pass the check to lane 4. Report counts per check id. The decision: whether fails read
as the solver's limit or the exam's noise. Routes to `pack/evaluator`, `pack/brief` and `operator`
(labels not yet made).

**4. Valid-alternative rejection challenge.**

Label: `verdicts`.
Importance: 0.3.
Marks: `alone`.

Starts from `FAILS ON ONE CHECK (lane 4)` and `DEFECT RULED BESIDE PASSES (lane 4)`, and only when
lane 3 left a check undecided. It runs alone.

Does a check reject valid work, shown by construction? Before reading the evaluator, the Referee's
probes or any report, write answers valid by the public rules that differ from an accepted one in an
allowed way (another valid design, a permitted rounding, an equivalent unit), and record their
digests. Only then grade each with `wri.ts grade` and report the two-by-two of valid by construction
against accepted, with the refusing check. Drop, and count, any alternative whose validity public
facts cannot show. Never base one on a recorded answer to a held-out task. The decision: whether a
repair of the check is owed. Routes to `pack/evaluator`, and the corpus goes to the checker's owner
as accept controls.

**5. Rulings, labels and what each role was told.**

Label: `verdicts`.
Importance: 0.5.
Marks: none.

Starts from `SET ASIDE AND UNSETTLED (lane 5)`, `READING MOVES WITH THE SET-ASIDE (lane 5)`,
`SET ASIDE BY SIDE (lane 5)`, `SETTLED BY HAND (lane 5)`, `REVIEW FAULTS (lane 5)`,
`EARNED WITHOUT A PROBE (lane 5)`, `RULINGS REFUSED (lane 5)` and `SCORED SET MOVED (lane 5)`.

What became of each rejection, and was each role told enough and no more? A rejection not ruled
earned sets its task aside for both sides, so set-asides falling on one side shift the tally towards
it (`SET ASIDE BY SIDE`). `READING MOVES WITH THE SET-ASIDE` means `counted` and `scored` disagree on
the step, so the reading rests on labels nobody made. `SCORED SET MOVED` means a tally lost tasks its
`comparison.started` fixed; only `aside` can bias it (`src/campaign/round.ts`). For `SETTLED BY HAND`
(`tools/d2/settle.ts`, `packetOf`), read whether labels came from the blind packets and whether a
check defect reached the checker's owner. Count earned rulings with no answer probe as restating the
check (`src/referee/agreement.ts`), and read each `referee.refused` beside the ruling then recorded.
A check ruled defective across sessions is a repair owed. Confirm from `build.call` that the Builder
saw no ruling, check id or reason, and the Examiner's inputs against `AGENTS.md` section 3. The
decision: whether rulings may count without a person reading each. Routes to `operator`,
`reviewer-prompt` and `host` (`src/builder/tools.ts`, `src/examiner/session.ts`).

**6. The drafted exam against its prompt.**

Label: `exam`.
Importance: 0.6.
Marks: none.

Starts from `EXAM DRAFTED (lane 6)`.

Is the drafted exam the one the operator's prompt asked for? The host's reading (`draftFaults`,
`src/examiner/draft.ts`; `draftReading`, `tools/d2/exam.ts`) checks shape; it cannot tell whether a
rule belongs to the field, matches its source, leaves an answer field unchecked, or whether the
objective measures what the prompt values. Read the prompt in `campaign.opened`, then the standing
draft's rules, answer format, objective and scope against it. Count drafts that fell by fault, and
whether the last fixed or removed the rule. Where `draft.finished` says no measurement ran, lane 7's
first admission is the first. Name author-decided checks a field engine could decide (rule 10). The decision: whether the campaign measures the domain asked
about. Routes to `examiner-prompt` (`src/examiner/draft.ts`), `pack/brief` or `pack/evaluator`, and
`operator` for an ambiguous prompt.

### The supply: the tasks

**7. Supply and task admission.**

Label: `supply`.
Importance: 0.65.
Marks: none.

Starts from `SUPPLY THIN (lane 7)`, `GATE REFUSED (lane 7)` and
`SAFEGUARD-8 PROMOTION ON AUTHOR ROOM (lane 7)`.

Where are tasks lost between proposal and scored set, and was each refusal right? For each
`task.gate` refusal (`packageGate`; `try_task` in an older log), say whether it named a real defect
the Examiner could act on. Count what left after admission, and hold the frontier against the terms
(`SIZE`; `refusals` needs `sweepOf(level)`). Never propose loosening admission from yield alone.
`SAFEGUARD-8` names a promotion that clears only on room the author's own answer and objective
create: read both before the promotion is reported. The decision: whether another Examiner
session is bought first. Routes to `examiner-prompt` (`src/examiner/prompt.ts`) and `host`
(`src/kernel/task.ts`).

**8. Whether validity separates.**

Label: `comparison`.
Importance: 0.75.
Marks: none.

Starts from `TIES BETWEEN VALID ANSWERS (lane 8)` and
`SAFEGUARD-9 PROMOTION BEYOND VALIDITY (lane 8)`.

Which measure carried each reading: validity, the objective or the bill (`pointsOf`,
`src/kernel/compare.ts`)? Give each comparison's tally and p as scored, without the bill (`stepOf`,
`unbilled`) and on validity alone. `TIES BETWEEN VALID ANSWERS` means only the objective (floor
`ROOM`) and the bill separate most tasks; `SAFEGUARD-9` names a promotion that fails on validity
alone, so count the tasks each measure won (`replay.txt`). Say whether a step rests on answers the
reference could not give or on better answers to shared tasks. A drafted exam's objective is its
author's computation, so check its arithmetic first. The decision: how
a promotion is worded, and whether the objective measures quality. Routes to `operator`, and `host`
(`src/kernel/compare.ts`) where the tallies disagree with the report.

**9. Ties and the budget.**

Label: `supply`.
Importance: 0.55.
Marks: none.

Starts from `TIED TASKS (lane 9)`, `NO VALID ANSWER (lane 9)` and `AWAITING A LABEL (lane 9)`.

What share of tasks tie, and why? The untied share sizes every later comparison; under the null at
two solves a side about 38% tie at a valid rate of one half and 69% at nine in ten (`SIZE`,
`src/kernel/size.ts`). Describe what tied tasks demand without prescribing an instance. A task nobody
answers is hard, wrongly checked or infeasible, and no stronger solver may decide which;
`AWAITING A LABEL` names those waiting for `tools/d2/prepare.ts` `--keep` or `--infeasible`. Read each
by its endings (a check rejecting every answer is a defect) and never label from a count. The decision: what the Examiner is asked for, how large the next
comparison is, and each waiting label. Routes to `examiner/task`, `pack/evaluator` and `operator`.

**10. Public disclosure and one recipe.**

Label: `exam`.
Importance: 0.35.
Marks: none.

Starts from `PASSES AT A SMALL WALL SHARE (lane 10)`.

Do the task, its public resources and tools publish a construction, so that solving is following a
recipe? The lead is passes at a small share of the deadline. From `solve.call` (tool names and
order, never arguments), one ordered call sequence across every pass of a family is a recipe; then
find what publishes it: the rules, the resources, the guide, the tool descriptions. A rule that states
the acceptance arithmetic lets the solver run every check itself. The decision: whether
these tasks can measure a harness at all. Routes to `pack/brief`, `examiner/task`, and
`harness/guide` only where the recipe is the Builder's.

**11. Pressure on the Examiner.**

Label: `supply`.
Importance: 0.65.
Marks: none.

Starts from `OUTCOMES BY SESSION (lane 11)`.

Does anything move the Examiner towards tasks that separate harnesses, session over session? Read
which inputs (`AGENTS.md` section 3, `src/examiner/record.ts`) each session received. `OUTCOMES BY
SESSION` gives how often the reference answered each session's tasks, beside the reports opened
before it. Read them in order with how instances changed (from `task.proposed`, quoting none), and
beside lane 20's A/A, since high-variance tasks split evenly and add nothing. The Examiner aims at
the reference: it reads the reference's outcomes and writes where the reference has not closed a
task, so the tasks written after a promotion may be an adversarial set for the reference and not
for the starter, and a starter read on them may lean against the reference (lane 28). Read the starter's
outcomes on each session's tasks beside the reference's (`starter-reads.ts`, its line a writer, and
each starter comparison's `valid`): a session whose tasks the starter answers as often as before
while the reference falls is aimed at the reference, and one where both fall is harder. Never
propose telling the Examiner a share, target or level. The decision: whether its inputs are revised. Routes to
`examiner-prompt` and `operator`.

### The harness

**12. Harness delta against its note.**

Label: `harness`.
Importance: 0.8.
Marks: none.

Starts from `HARNESS CHANGED (lane 12)`, `BROKEN AT END (lane 12)`,
`MEASURED AN EARLIER STATE (lane 12)`, `TOOLS EDITED (lane 12)` and
`PRACTISED TASK MEASURED (lane 12)`.

What moved between parent and child, and are the measured bytes the ones the Builder described?
Diff the kept states under `states/` part by part (`harness-versions.ts --diff` of
[harness-audit](../../harness-audit/SKILL.md); the first parent is the Starter) and describe each
change by kind and size, quoting no line. Compare it with the note in `harness.version`, or the turns
of a led conversation's `build.checkpoint`. Where the final state did not open, the round measured
the last practised state; name the later edits. Only the diff inventories the child, since shell
writes leave no `edit` call, and limits come from the condition (`agent/config.yaml` is ignored).
Check every program for the Builder's one limit: no task id, text or answer, which would score
higher on exactly those tasks and nowhere else. A search and a filter against the public rules are
allowed, and the solver decides what it submits. The decision:
what a step is attributed to, and whether the harness helped the solver or answered for it. Routes to
the `harness/` part that moved, `builder-prompt` where the limit was crossed, and `host`
(`src/builder/session.ts`, `src/builder/tools.ts`) where the measured state is not the logged one.

**13. The guide against its programs and the solves.**

Label: `harness`.
Importance: 0.3.
Marks: none.

Starts from `NEVER CHECKED (lane 13)`, `TOOLS CALLED (lane 13)` and `TOOL CALLS ERRED (lane 13)`.

Is what a harness tells its solver true of what it ships and what its solves did? A false claim in
the guide costs on every task, invisibly. Compare three accounts:

1. **The guide's claims**: each method, check, default, limit or order it says a program keeps.
2. **The programs**: whether `.toolchain/` or `agent/tools.ts` keeps each claim fully, in part (a
   cross-check run on one case) or not.
3. **The solves**: which tools they called, in what order, and which the guide leans on but none
   called (`TOOLS CALLED`, `TOOL CALLS ERRED`; a non-zero exit may be by design, so read the output).

Read the solver's prompt (`src/solver/prompt.ts`) against the condition too. Judge no method; lane 27
grades soundness from this lane's false claims. The decision: whether a failed solve was misled.
Routes to `harness/guide` and `harness/tools` (the Builder's to correct), and `host` for a prompt
sentence the condition contradicts.

**14. What practice taught the Builder.**

Label: `harness`.
Importance: 0.3.
Marks: none.

Starts from `NO PRACTICE (lane 14)`, `FINAL BYTES NEVER PRACTISED (lane 14)`,
`SESSION ENDED (lane 14)` and `PRACTICE FAILS (lane 14)`.

Did the Builder use practice as evidence? A practice solve is its only outcome signal. From
`build.call`, tabulate each practice solve (digest, task, ending, the next edit, whether it was
retried on the changed bytes) and count practice per comparison, comparisons of unpractised bytes,
earned fails an edit followed and how many then passed, flips with no edit, and edits no result
preceded. Building around a fail ruled a check defect is fitting to the exam's fault. For `SESSION
ENDED`, say how much practice and how many turns were left. The decision: whether a no-step means the change did not
help or was never tried. Routes to `builder-prompt` (a result that misleads, without prescribing a
course) and `host` (`src/builder/tools.ts`, `src/builder/session.ts`).

**15. Trace challenge.**

Label: `harness`.
Importance: 0.3.
Marks: `alone`.

Starts from `WIN AT A SMALL WALL SHARE (lane 15)`, and only when lane 10 or 12 suspects a
shortcut: won tasks passed in few calls at a small share of the deadline. It also starts from
`ANSWER FROM A PROGRAM (lane 15)` alone: solves whose one shell call was followed by `submit`, with
the reference side printed as the control. It runs alone.

Where did the deciding value come from? For each task the new harness won (listed by `WINS`, which
can include objective wins with no failed reference solve), read the new side's `solve.turn` and
`solve.call` in order and find the step where the deciding value first appears and its source: a
tool computing from public input, the solver's own working, a line of the guide, or nothing in the
trace. Freeze the table as counts by source, each with up to three solve ids and steps, and open no
other report; the primary sets it beside lane 12 afterwards. The decision: whether a win is the
harness solving or knowing. Routes to `harness/tools`, `harness/guide` or `host`.

**16. What made each win.**

Label: `harness`.
Importance: 0.6.
Marks: none.

Starts from `WINS (lane 16)`.

Which part of the new harness made each win, if any? Only a comparison against
`programs-of:<digest>` attributes a step to a part (`AGENTS.md` section 9); this lane tells it where
to look. Start with steps, and their tasks untied without the bill (`readings.txt`, `STEP CARRIERS`).
For each won task, read both sides' solves and name where they first part:

1. a new tool was called;
2. the solve followed a guide line the reference lacks;
3. the solver chose another method with no harness part in it;
4. same method, different result: solver variance (lane 20).

Read the harness diff only after the traces, and count wins of each kind. A part that made most wins
is what a `programs-of` comparison should test. The decision: which part a promotion is credited to. Routes to `operator`, and
`harness/tools` or `harness/guide` for a part no win called.

### The comparison

**17. What a step rests on.**

Label: `comparison`.
Importance: 0.7.
Marks: none.

Starts from `STEP CARRIERS (lane 17)`.

Does a step generalise across the scored tasks, or rest on a few that share something else?
`STEP CARRIERS` gives each step's untied tasks and how many top wins it could lose and still clear.
From `readings.txt` and `tasks.txt`:

1. find the smallest set of wins whose removal takes the step below its level;
2. say what they share: a unit or scale, a family, the session that wrote them, a convention, a reach
   grade;
3. set each against the reference's own halves (`REFERENCE AGAINST ITSELF`, lane 20): a win where the
   reference disagrees with itself is noise as much as gain;
4. set the carriers beside the ties: a gain on one task shape with ties elsewhere is narrow.

The decision: whether a step is reported as general, narrow or resting on spread. Routes to
`operator`, and `examiner/task` where the carriers share a shape the Examiner wrote often.

**18. What the test could show at its size.**

Label: `comparison`.
Importance: 0.75.
Marks: `standing`.

Starts from `NOTHING SCORED (lane 18)`, `CUT BY ITS CAP (lane 18)` and
`SET SHORT (lane 18)`, and is standing.

What could each test detect at its sample size (`flipP`, `stepOf`, `src/kernel/compare.ts`; at 0.02
it clears at 6-0, 8-1, 10-2 or 12-3)? For each comparison read the untied tasks, wins and losses, p,
`detectable` and `falseRate`, frontier and retained apart, then one line: a `not-scored` or a
comparison `CUT BY ITS CAP` tested nothing, an underpowered `no-step` is no evidence of no gain (say
how many more wins would have cleared), and a `step` rests on its untied tasks alone. Say whether the
tasks that left (`SET SHORT`) could move the reading. Every attempt adds false-step risk at the
level, and terms are never topped up (rule 4). The decision: whether the operator enlarges future comparisons. Routes to
`operator`, and `host` only for an arithmetic fault.

**19. The starter.**

Label: `climb`.
Importance: 0.65.
Marks: none.

Starts from `VALID BY HARNESS (lane 19)` and `PROMOTION UNCONFIRMED (lane 19)`.

What does the starter give a campaign to build on, do the tasks leave room above it, and does each
promotion still beat it? The Starter (`src/harness/starter.ts`) is pi's agent with four coding tools
and a two-line guide in `EXAMPLE`'s outline. From `VALID BY HARNESS`, compare its valid share with
the previous release's on the same pack and setting; near 100% leaves no room. Read whether built
guides keep or outgrow the starter's. A promotion is confirmed by its epoch's first starter
comparison that tallied a task (`confirmed`, `src/campaign/climb.ts`). For each `PROMOTION
UNCONFIRMED`, say whether the epoch is still open, another move displaced the comparison
(`comparedOf`), or the starter held level. Then read each starter read split
(`bun .claude/skills/comparison-reading/scripts/starter-reads.ts <log>`): by origin (the tasks that
chose the harness, those written before and not chosen on, those written after), each with the
tasks on which validity differed and the rest, and by writing session; and what the tasks written
after read alone (`after`: a step, a step for the starter, no step or too few), since they are the
one origin no step selected, and a confirmation that rests on the others reads the promoting
comparisons again. The starter's own noise is the line `Starter against itself`
(`barLines`, `src/campaign/climb.ts`), which splits the starter's solves in two as the A/A splits the
reference's; a reference lead inside it says nothing. The line `Repetition` beside it names the
comparisons where each side gave one validity and one measure in every solve of every task: there no
split shows noise, and a tie of every task is no measured zero. The tasks written after are written by an
Examiner that reads the reference's outcomes (lane 11), so a loss there may be its aim and not a
plain regression; where losses there
recur read by read, lane 28 owns the question. The decision: whether the starter's guide stays, whether tasks are
replaced, and whether a promotion counts towards the milestone. Routes to `host`
(`src/harness/starter.ts`; `tools/d2/campaign-actions.ts`, `comparedOf`), `operator`, and
`harness/guide` or `harness/tools` where a harness loses to the starter.

**20. Flips and solver variance.**

Label: `comparison`.
Importance: 0.45.
Marks: none.

Starts from `FLIPS (lane 20)` and `REFERENCE AGAINST ITSELF (lane 20)`.

How much of the tally is solver variance? A flip is a task one harness both answered validly and not
under one condition. `REFERENCE AGAINST ITSELF` is the A/A: `compared` splits the reference's solves
into two halves mirrored in time, and `readsStepEitherWay` tests it both ways at the level. Its
untied share is the noise floor a comparison must exceed, and its differences are the margins two
solves of one harness reach by chance: a win by no more than the A/A's difference on the same task is
inside the noise (lane 29). An A/A step is reported and ends nothing.
For each step, count wins on tasks where the reference's halves disagree, and count flips per
harness: fewer on the new side may be steadiness. The decision: how many solves a side a task needs. Routes
to `operator`, and `environment` where flips cluster in high-load hours.

### The climb

**21. Which link holds the next promotion.**

Label: `climb`.
Importance: 0.6.
Marks: none.

Starts from `CHAIN (lane 21)` and `NO TASK HELD OUT (lane 21)`.

What stops the campaign climbing now, as one link with its count? Walk the latest epoch's chain
(`CHAIN`, row F) and stop at the first link that fails:

1. **Tasks.** Did the epoch hold out at least `comparisonFloor` informative tasks
   (`src/campaign/admission.ts`)? `NO TASK HELD OUT` is this link broken at its root.
2. **Build.** Did a Builder session change and practise the harness (lanes 12 and 14)?
3. **Comparison.** Did each comparison tally enough untied tasks, and how many more wins would have
   cleared (lane 18)?
4. **Table.** Did the move the table named run (lane 23)? A displaced starter comparison leaves the
   promotion unconfirmed (lane 19).
5. **Stop.** Did the campaign end on the stop rule (`stopRule`), the budget or no room, and does the
   count that ended it match the log?

Name the link, its count against what it needed, and its owner. Count promotions within this
campaign only. The decision: what runs next. Routes to `examiner-prompt`, `builder-prompt`,
`operator` (size or stop) and `host` (`src/campaign/decide.ts`).

**22. The promotion and the climb after it.**

Label: `climb`.
Importance: 0.75.
Marks: `side-by-side`.

Starts from `PROMOTED (lane 22)`, `STARTER BARE (lane 22)`, `AFTER THE PROMOTION (lane 22)` and
`SHARED TEMPORARY FOLDER (lane 22)`. Where several campaigns are under review, it is given their
climbs side by side, in the columns `wri.ts climb` prints.

Did a promotion measure what the campaign exists to measure, and did the campaign climb from it?
Read this lane before saying a campaign improved a harness, in five parts kept apart:

1. **The rule.** `PROMOTED` gives the harness, its parent, who promoted it (the table, or
   `tools/d2/promote.ts` with any `despite`) and its comparisons with tally, p, level and A/A; the
   A/A is evidence about variance, never a second threshold. Say whether lane 19 finds it confirmed,
   and what the tasks written after it read alone (`after`, `starter-reads.ts`); where every win is an objective margin, read lane 29 before calling the step
   an effect.
2. **What the step measured.** `STARTER BARE` means the reference answered nothing on most tasks, so
   the step shows an engine beats none, not how good it is. Read lane 12's diff and lane 16's wins.
3. **What touched both sides.** `SHARED TEMPORARY FOLDER` counts solves naming paths under `/tmp` or
   `/var/tmp`: a lead, not proof of a read. Where a command succeeded, say which side it lifts.
4. **The climb after.** From `AFTER THE PROMOTION`, read the reference's valid share and objective
   gap epoch by epoch: new tasks it already answers measure ties (lane 18); tasks no harness can
   pass are false room (lane 9). Read the starter split epoch by epoch too, not only the valid
   share: each control's tally on tasks first drawn after the promotion against before it, and
   `starter-reads.ts` by origin. Where the reference wins the tasks that chose it and loses those
   written since, read after read, the chain may not add up against the starter (lane 28).
5. **The cost**, by role (lane 25).

With several campaigns (lane 26 names their confounds), the section opens with `wri.ts climb`'s
table and the cross-campaign temporary paths (`crossings`). Compare cost to the first promotion,
tallies with A/A, tie share, the winning change, exposure and progress after, at the same move rather
than the same hour. A tree difference is a candidate cause only where the rest agree, and one
campaign a tree is one sample. The decision: whether a promotion is reported as an improvement and the campaign kept
going. Routes to `operator`, `host` (`src/campaign/decide.ts`), `examiner-prompt` (room written where
there is none) and `environment`.

**23. The endings and the operator's words.**

Label: `climb`.
Importance: 0.6.
Marks: none.

Starts from `ENDED AND WENT ON (lane 23)` and `OPERATOR WORDS (lane 23)`.

Did the campaign make the moves its table names, and did each ending happen for its recorded reason?
A `campaign.move` carries the table's code (`decide`), or `led` where the Builder chose otherwise
(`asked` in an older log). Diff each comparison of a harness other than the latest against the same
reference (lane 12): where only wording or an unread default moved, it is a second draw of one pair,
allowed only where the table names it (`readAgainst`). `ENDED AND WENT ON` is right after `operator`,
`finished`, `environment` or a crash, and a fault after `budget`, `stop` or `no-room` without an
operator's word between. Recount each ending's count (`idleOf`, `tools/d2/campaign-terms.ts`;
`roomless`, `src/campaign/decide.ts`). `OPERATOR WORDS` tallies `campaign.word` events and answers
(`pendingWords`, `src/campaign/word.ts`); no seat may see a word. The decision: whether moves and
endings read as the table's. Routes to `host` (`src/campaign/decide.ts`,
`tools/d2/harness-builder.ts`, `tools/d2/campaign-actions.ts`), `builder-prompt` and `operator`.

### The solve

**24. Does the budget bind, and how each solve ended.**

Label: `solve`.
Importance: 0.45.
Marks: none.

Starts from `MISSES AT A LIMIT (lane 24)`, `WALL SHARE (lane 24)`, `HOST LOADED (lane 24)`,
`LOAD MOVED (lane 24)`, `STARTS OUT OF TURN (lane 24)`, `NON-RESULTS (lane 24)`,
`SOLVE NEVER FINISHED (lane 24)`, `EXAMINER NEVER FINISHED (lane 24)`,
`MISSES WITHOUT A VERDICT (lane 24)`, `SESSION CRASHED (lane 24)`, `TOOL MISSING (lane 24)` and
`SERVED ANOTHER MODEL (lane 24)`.

Does the solve budget (`LIMITS`, `tools/d2/campaign.ts`) separate the harnesses? A better harness
reaches answers within it that the reference misses; a budget nobody nears leaves only validity and
the objective. By comparison and side, read `MISSES AT A LIMIT`, `WALL SHARE` (deadline and turns)
and effort on tasks both answered, and say whether the budget binds on both, on the reference only
or on neither. Deadlines count elapsed time, so read load (`HOST LOADED`, `LOAD MOVED`) and waits
(`STARTS OUT OF TURN`, `campaign.waited`) beside them. Since non-results are rerun and fails count,
say whether each kind is honest and reruns fell evenly (`NON-RESULTS`). Separate solves killed from
those still open (`bun run runs pulse`), and say whether a crash, a missing tool or another served
model falls on one side. The decision: whether the budget can show saved effort, and whether
counts are trusted. Routes to `operator` (limits), `environment`, and `host` (`src/solver/run.ts`,
`src/kernel/solve.ts`) for an ending kind that hides its cause.

### The economy

**25. Time, spend and silence.**

Label: `economy`.
Importance: 0.35.
Marks: none.

Starts from `LONG SILENCES (lane 25)`, `SPEND LED BY A ROLE (lane 25)` and
`BUILDER COMPACTED (lane 25)`.

Where did the hours and dollars go, does the bill hold all of them, and what was each long silence?
First the bill's completeness: a gap of more than a few percent between the backend's totals and
the host's bill (row F, `costLine`, `src/kernel/meter.ts`) means mispriced or unpriced work, such as
compactions with empty `usages` (`exam.compacted`, `build.compacted`; `host`, `src/agent/session.ts`).
For `BUILDER COMPACTED`, read each compaction's `tokensBefore`, seconds and `error`, and whether later
calls repeated a move. Spend comes from `spendOf`, and row A sets hours beside dollars by role.
`LONG SILENCES` names the five longest gaps by what ended them; confirm each from the events around
it. Estimate the next round's cost, and read the economy factor from the closing report
(`tools/d2/close.ts`; `worthOf`, `src/campaign/climb.ts`). The decision: what the next round costs,
whether the bill can be believed, and whether each role earns its spend. Routes to `operator`,
`host` and `environment`.

### The runs

**26. The run's launches, logins and hosts.**

Label: `runs`.
Importance: 0.3.
Marks: `standing`.

Starts from `LAUNCHES (lane 26)`, `NO LAUNCH RECEIPT (lane 26)`, `HOST CODE MOVED (lane 26)` and
`LOG OUT OF ORDER (lane 26)`, and is standing.

Is the run the run its readings claim: fresh from a prompt, at one commit, from a clean tree, and
continued only after a pause or a change of login (`AGENTS.md` section 10, item 9)? Each launch
writes `launch-run-<n>.json` (`tools/runs/receipt.ts`). `LAUNCHES` counts launches, commits, dirty
trees, logins (never named) and Bun versions; `NO LAUNCH RECEIPT` means nothing says which commit
ran. A continuation at another commit is no fresh run; one after a credit limit is rule 15's
ordinary case. Read each host's copy (`data/runs/<host>/<name>`) apart and never add their counts.
Check live runs a login against the cap (`bun run runs active`) without naming a login, and load
against cores. `HOST CODE MOVED` names the commits between two host hashes and the comparisons that
straddle them; `LOG OUT OF ORDER` usually means two controllers on one log. For a gathered copy,
count states `versions.txt` marks not kept. For arms of one experiment, name every difference beyond
the moved variable (pack, host, commit, seats, budget, terms) as a confound. The decision: whether
the run's promotions count, and whether a launch path let it start wrongly. Routes to `operator`,
`environment`, and `host` (`tools/runs/`, `tools/d2/harness-builder.ts`, `src/kernel/log.ts`).

### The audit

**27. Harness quality, version by version.**

Label: `climb`.
Importance: 1.
Marks: `standing`, `blind`.

Starts from every harness version the campaign kept, and is standing. It grades blind, so a session
that holds it reads it first.

Did the harnesses get better at the domain, or only quicker at winning comparisons? A step says
nothing about how hard the scored tasks were or whether an expert would keep the change. Grade before
reading any result, writing each grade as it settles:

1. Read `chain.txt` from the derived folder: each kept version, its parent, parts and what moved,
   with no result (`harness-versions.ts --blind`).
2. Read the moved lines (`diff -r` of `states/<parent>/` and `states/<digest>/`,
   [harness-audit](../../harness-audit/SKILL.md)) and grade soundness. A version the copy does not
   keep (`versions.txt`) goes under `## Not read`, ungraded; refreshing the copy is the primary's.
3. Read `tasks.txt` (each scored task's public input, no outcome, `tools/wri/tasks.ts`) and the
   checks under `exams/`, and grade reach.
4. Only then read `versions.txt`, `readings.txt` and rows D and E in `rows.txt`.

Both scales run from 0 to 7. A grade is a reviewer's reading that no seat sees.

**Reach** is how hard a held-out task is for a strong current model working in the domain, graded
from its public text, rules and checks:

- 0: one lookup, or a direct transform of the input;
- 1: a routine method applied once;
- 2: a few standard steps, one constraint at a time;
- 3: several steps with one subtlety of the field that a careful generalist catches;
- 4: constraints that interact, or the field's own engine used with care;
- 5: specialist work: a method a generalist would not choose, or a tolerance that punishes approximation;
- 6: work a specialist gets wrong on a first pass;
- 7: the field's edge, where no published method fits whole.

First write the domain features that place a task at each grade, so a second grader agrees.
Then set each grade beside the reference's valid share, regrading once any high grade the starter
always answers. A version's reach is the highest grade at which most of its solves are valid; where the
reference answers everything, report instead how far objective wins moved the objective, by grade.

**Soundness** is whether a version's change is right for the domain, graded against its parent from
the diff alone:

- 0: it breaks or misleads: the guide claims what no tool does, or a tool fails its own call;
- 1: it is fitted: it names practice content or narrows to the practice set's shapes (lane 12);
- 2: churn: rewording or reordering no solve could follow;
- 3: plausible but narrow: it helps a few task shapes;
- 4: sound for one part of the domain, stated generally;
- 5: sound across the domain's kinds of task, and the solves call what it added;
- 6: a method a specialist would teach, with its own checks;
- 7: what an expert would adopt unchanged.

Then read whether the step's wins fall where the change acts. Weight (`chain.txt`) that grows while
soundness stays flat is bloat, not quality.

Write the grades under `## Grades`, between the verdict line and `## Findings`: one row a version in
chain order (digest prefix, parent, tallies with and without the bill, weight, soundness with one
sentence, reach), then one row a comparison with the reach of tasks won and lost. Under
`## Grade rows`, add one tab-separated line a grade, `task<TAB>campaign<TAB>id<TAB>grade` or
`version<TAB>campaign<TAB>digest<TAB>grade`, for `wri.ts trajectory --log <logs> --grades <report>`.
Never sum reach and soundness. Blind graders across campaigns come from `wri.ts packets --log <logs>
--out <dir> --graders 2`: launch its `launch.json`, join with `wri.ts packets --out <dir> --join`,
launch the regrades the join owes once, and join again. The decision: whether a climb is reported as
domain gain or as promotions on easy tasks or the objective alone. Routes to `operator`,
`harness/guide` or `harness/tools` (grade 0 or 1), `examiner-prompt` (`src/examiner/prompt.ts`)
where all scored tasks grade 2 or below, and `builder-prompt` (`src/builder/prompt.ts`) where
soundness falls as promotions continue.

### What the climb rests on

**28. Whether the chain adds up against the starter.**

Label: `climb`.
Importance: 0.7.
Marks: none.

Starts from `CHAIN AGAINST THE STARTER (lane 28)`.

Does a chain of promotions, each of which beat its parent, beat the starter on tasks that chose none
of them? A starter read tallies three kinds of task (`starterReads`, `src/campaign/climb.ts`), and
only those written after the promotion are new to the promoted harness. `CHAIN AGAINST THE STARTER`
fires where, summed over two or more reads, the reference lost more of those than it won; it prints
each read's tally on them, oldest first, the sums on the other two origins, and how many reads are a
step without the tasks that chose the harness. Three causes give that count, and the lane keeps them
apart, each with the count that would separate it:

1. **Selection on margin noise.** A promotion is chosen on the tasks it won, so its margins there are
   the largest of many draws and do not carry to fresh tasks. Set the margins of each promoting step
   against its own A/A (lane 29) and of each starter read against `Starter against itself`
   (`barLines`); where both sit inside the noise, a reversal on new tasks is what chance predicts.
2. **The Examiner's aim.** The Examiner reads the reference's outcomes (`src/examiner/record.ts`) and
   writes where the reference has not closed a task, so tasks written after a promotion are aimed at
   the reference and not the starter (lane 11). Read the starter's own valid share and objective on
   tasks written after against those written before, and by writing session (`starter-reads.ts`,
   its line a writer): a starter that holds level while the reference falls is the aim, and both
   falling is harder tasks. Say which reports each writing session held when it wrote (its
   `exam.started` against the `comparison.reported` before it).
3. **A worse harness.** What is left once the first two are counted: losses outside both sides' noise
   on tasks the starter answers no better than before, with lane 27's soundness and lane 12's diff
   for where the chain went wrong.

Name any condition that moved between the reads (row C: setting, solver, host code, load), since a
drift explains a trend as well as any cause above. Say how many tasks of each origin the reads held,
since a sum over few is one draw. A neutral set, tasks written blind to both harnesses (another
campaign's held-out set read with [compare-systems](../../compare-systems/SKILL.md)), would settle
the first two against the third; it is paid, so propose it with its size and leave it to the
operator. Never propose raising the gap floor (`ROOM`): it hides small margins on both sides alike
and decides nothing about which cause holds. The decision: whether the campaign's promotions are
reported as a climb, and whether a neutral comparison is asked for. Routes to `host`
(`src/campaign/decide.ts`, `src/campaign/climb.ts`), `examiner-prompt` and `operator`.

**29. What an objective-only step won by.**

Label: `comparison`.
Importance: 0.65.
Marks: none.

Starts from `MARGINS INSIDE THE NOISE (lane 29)`.

Did each step whose untied tasks all tie on validity win by more than the reference's own spread?
Such a step is carried by the objective alone, each win a margin between two valid answers
(`pointsOf`, `src/kernel/compare.ts`). `MARGINS INSIDE THE NOISE` names each where more than half
of the wins are no larger than the difference of that report's own A/A (`noise`) on the same task,
the reference read against itself under the same setting, so one outlier task sets no ceiling for
the rest. It counts the wins on tasks whose A/A tied, which clear only a zero difference, and the
other objective-only steps most of whose wins were of that kind, which give no spread to read. For
each step, read the wins' margins beside the A/A's distribution; where the A/A tied, use the starter's split
(`Starter against itself`) or another report's A/A of the same reference and say so. Then read what
the carrying tasks share (lane 17): one family, one writing session, or one quantity whose
measurement moves from solve to solve. Size the remedy as solves a side: from the A/A's spread and the
margins won, how many solves of each task would bring a typical margin outside the noise
(`comparison-reading`, `size.ts`), and what that costs at the campaign's price a solve. Never propose
raising the gap floor (`ROOM`): it would hide these margins and the reference's alike, and the
operator has ruled it out. The decision: whether these steps are reported as effects, and whether
comparisons on objective-only tasks are enlarged or tasks written where validity can separate.
Routes to `host` (`src/kernel/compare.ts`, the comparison's size), `examiner-prompt` (tasks on
which validity can separate harnesses) and `operator`.

**30. What a confirmation is made of.**

Label: `climb`.
Importance: 0.8.
Marks: `standing`.

Starts from every promotion that has a starter read, and is standing.

Would the starter read have confirmed this promotion if nothing the harness learned carried to new
tasks? A starter read tallies three kinds of task (`starterReads`, `src/campaign/climb.ts`), and
`confirmed` tests them together (`againstStarter`, one `readsStep` over the whole tally): the tasks
of the comparison that promoted the harness, on which it was selected, are in the same sum as the
tasks written after it. Four parts, kept apart:

1. **The composition.** For each read, the reference's won-lost-tied on each origin
   (`starter-reads.ts`), and each origin's share of the summed margins, which no script prints (sum
   `differenceOf` over the read's pairs, `pairsReported`, by origin). `starter-reads.ts` also says
   what the tasks written after the promotion read alone at the read's level (`after`); list the
   reads where it is not `a step` while `confirmed` holds.
2. **The selection-only chance.** Keep the margins of the other two origins as recorded, and give
   each task written after the promotion a fair sign at its recorded margin. Count the draws that
   would still read `confirmed` at the level. That count is how often this read confirms by
   selection alone. Show the draw's size and its count, not a single rate.
3. **The fleet.** Across every read under review: reads confirmed, reads confirmed on the tasks
   written after alone (`starter-reads.ts --all` prints both), and the number the selection-only
   chance expects of the first. A confirmed count near that expectation says the flag does not yet
   separate a transferable gain from none.
4. **The measure.** For each confirmed read, say whether validity or the objective carried it
   (`starter-reads.ts` splits each origin by whether validity differed; lane 29), since an
   objective-only read rests on margins.

Never propose a lower level or a higher gap floor (`ROOM`). Say how many reads the counts rest on,
and that a read of few tasks is one draw. The decision: whether `confirmed` is reported as a
transferred gain or as a read that selection alone could produce, and what the climb bar of
`AGENTS.md` section 1 should count. Routes to `host` (`src/campaign/climb.ts`) and `operator` (the
bar).

**31. How many independent batches a read rests on.**

Label: `climb`.
Importance: 0.75.
Marks: `standing`, `side-by-side`.

Starts from every starter read, and is standing. Where several campaigns are under review it is
given their climbs side by side.

Is the unit of evidence a task or a batch of tasks? The tasks written after a promotion come from
one or a few Examiner sessions, and tasks of one session share their writer's aim, families and
difficulty, so their outcomes move together. Five parts:

1. **The batches.** For each read, the number of writing sessions behind the tasks written after the
   promotion and the reference's won-lost on each. `starter-reads.ts` gives one line a writer, but
   over the whole read and not by origin, so name a session that wrote on both sides of the
   promotion apart. A read with one session holds one draw of a batch.
2. **What the count can show.** A sign test across k sessions reaches 0.02 only from k = 6 (one half
   to the power of k). With one session, where neither harness is better and a session moves its
   tasks' scores by as much as a task's own noise, a slice of about eleven tasks reads a step for the
   reference about a quarter of the time, and one for the starter about as often; without that
   session effect, each about one time in fifty (a simulation of 9 November over `flipP`, five
   thousand draws). Give each read its k and the least p it could reach.
3. **The campaign's slices.** Across a campaign, the after-slices that went to the reference, to the
   starter and to neither, one count per promotion. Place the counts of the campaigns under review
   side by side, and name the confounds that differ between them (lane 26: pack, host, commit,
   seats, budget, terms) before saying a difference belongs to the domain.
4. **The spread.** Whether the slices differ from one another by more than the tasks within a slice
   would give by chance (the variance of the slice shares against the binomial at the pooled share).
   Where they do, a pooled tally overstates its precision; say what the writing sessions held in
   common (lane 28 gives the aim, lane 11 how each session's instances changed, lane 17 what a set
   of tasks shares).
5. **What would settle it.** How many separately written batches a campaign would need for a
   campaign-level reading, and what a batch written blind to both harnesses costs
   ([compare-systems](../../compare-systems/SKILL.md)); it is paid, so propose it with its size and
   leave it to the operator.

Never propose a higher gap floor (`ROOM`); it moves the noise to the next margin. The decision:
whether each campaign's climb is reported with its batch counts beside the tallies, and whether a
neutral comparison is asked for. Routes to `host` (`src/campaign/climb.ts`, the report),
`examiner-prompt` (batches written where the reference has not closed) and `operator`.

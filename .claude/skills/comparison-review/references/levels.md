# The levels

Read them in order, one ledger row a level with its count or what could not be read. Each rests on
those before it: a tally read before its identities is a tally of unknown things. Levels 0 to 6 need
no score and cover every task, the sealed half included; levels 7 to 11 read outcomes and cover the
open half until the unsealing. **Inside** names the owner for a campaign comparison, where most of
this is already a fold; **outside** is what a study on another runtime reads by hand.

## 0. Who ran

Which harness digest is each arm, proved by the arm's own record against the kept harness? Which
model and effort answered every turn, read from the trace? Did any turn fall back, any session end
early, any label swap or folder come from an earlier batch? **Inside:** `condition.recorded`, `bun
tools/runs/degradations.ts <name>`. **Outside:** each trace's model field and ending, `export.json`.

## 1. Coverage

What share of the benchmark ran (tasks, categories, rollouts)? Who chose the tasks, by what rule,
before or after a look, and are they typical or near the campaign's domain? How many attempts
started, were retried or were left out? **Inside:** `draw <name>`, `reading <name>`, the admission
line. **Outside:** the study's record and the benchmark's task list.

## 2. Conditions

Did each differ, with evidence: time and order (interleaved or days apart); interpreter, packages and
`PATH`, tried from inside each arm; executor, tools, system prompt and what the executor adds;
budget and what each arm was told; network; host load; the grader's model and conversion.
**Inside:** `conditions <name>`, `HOST LOADED`, `LOAD MOVED`. **Outside:** by hand.

## 3. What was carried

Byte identity first, then whether each part works where it landed: diff guide and toolchain against
the kept ones, check that links resolve and programs start from the solver's place and `PATH`, what
the export dropped (`agent/tools.ts`), and whether the solver loaded the guide. **Inside:** the digest proves
it. **Outside:** `studies/shared/claude-export.ts` and its tree.

## 4. What was told

Perfect copying can still deliver a false guide. Read it in the solver's workspace and sort every
factual statement (limits, interface, scoring, workflow, what each program expects) as true, false
or meaningless there, noting which the export corrected. Then ask whether a solver cited one and
acted on it; absent citations prove little where thinking is unrecorded.

## 5. What it was selected on

Could the gain that promoted this harness show here at all? Read which measure carried the promotion
(`reading`, `replay`, `carriedBy`) and whether it was confirmed, and set what the exam's checks
rewarded against what this grader rewards. Count refusals and limits met ("Was it too strict?" in
`SKILL.md`), and state what the study already expected (`studies/harness2/README.md`, "Read every
result against how uneven the comparison is").

## 6. What the grader could see

The grader's view is not the deliverable. Reproduce it with the grader's own conversion and no model
call: caps and what falls past them by arm, embedded images that consume the cap, lost figures or
notebook outputs, order inside a file, and which file counts. A "not found" past the cap is an
artefact; absent, it is a miss. Report the reproduction beside the official score. **Inside:** the
verifier reads the whole answer and the Referee rules with evidence (lanes 1 to 6).

## 7. How the score is formed

Is scoring all-or-nothing or partial? Read the difference at each grain (points, rubrics, criteria),
since a small gap in criteria can become a large one in points, keeping the frozen measure primary.
Count rubrics one criterion short and the share of the gap one task or rubric holds, drop each task
in turn to see whether the sign holds, and read the paired test on the task differences (`testOf`,
`src/kernel/compare.ts`).

## 8. Each split, both directions

List every rubric or task where the arms split, won and lost, without selecting by size. Classify
each miss, blind where possible, as **wrong** (refuted by the grader), **absent**, **unseen** (stated
past what the grader read) or **disputed** (the grader's reason does not hold). List shared misses
apart: they speak of the task, grader or solver, never the harness. Ask of every win as of every
loss whether the favoured explanation predicts it. **Inside:** the wall holds, so per-task reading
stays in the investigation's lanes and the report names ids and counts.

## 9. Behaviour

Turns, duration and output tokens, with turns sorted by kind (work, recovery, reading, polishing),
since fewer turns can be a harness's virtue or the other arm repairing its environment; programs and
tools used or failed; where and how each stopped. On a few tasks an association is description.
**Inside:** `solve.call`, the lanes on solves, `chain`, `tasks`.

## 10. Noise

Say how far one harness moves against itself and how that was measured, or say it is unmeasured. A
clean A/A is one harness, one condition, one period, rollouts interleaved; anything else is a
description. Rollout noise and grader noise are separate, and grading one deliverable twice measures
the second. Give the test's p beside what this size could detect (`bun
.claude/skills/comparison-reading/scripts/size.ts`), never "within the noise" without a measured
noise. **Inside:** the A/A beside each comparison (`noise`), `falseRate`, `incapable`.

## 11. Economy

Each arm's dollars and hours beside its score on one meter (`billOf`), grader dollars apart, and
whether one arm's cost hides a saving elsewhere. An estimate names the rate it used.

## 12. What this could not read

Close with what is absent: unrecorded thinking, a trace not kept, a condition nobody logged, a task
not run. A level with no evidence says so, and absence never reads as a clean result (`AGENTS.md`,
section 9).

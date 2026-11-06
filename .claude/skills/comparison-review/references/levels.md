# The levels

Read them in order and write one row a level in the ledger, with its count or what could not be read.
Each rests on those before it: a tally read before its identities is a tally of unknown things.
Levels 0 to 6 need no score, so they cover every task, the sealed half included. Levels 7 to 11 read
outcomes, so they cover the open half until the unsealing.

`Inside` names the owner for a campaign comparison, where most of this is already a fold. `Outside`
is what a study on another runtime has to read by hand. An example from one review, a promoted
harness against the bare Starter, is in italics where one exists.

## 0. Who ran

- Which harness digest is each arm, and does the record prove it? Compare the arm's own record with
  the kept harness, not with its name.
- Which model answered every turn, at which effort? Read the trace, not the request.
- Did any turn fall back to another model, or any session end early?
- Was the arm's label ever swapped, or a folder reused from an earlier batch?
- **Inside:** `condition.recorded`; `bun tools/runs/degradations.ts <name>`.
  **Outside:** each trace's model field and ending, `export.json`.
- *Example: every assistant turn of both arms answered as the model asked for, on all 16
  rollouts, so this level was closed in one count.*

## 1. Coverage

- What share of the benchmark ran? Tasks of how many, in how many categories, at how many rollouts
  each? Say this first when the operator asks whether the whole benchmark ran.
- Who chose the tasks, when, and by what rule? Chosen before any result, or after a look?
- Are the tasks like the benchmark's whole, or a corner of it? Is that corner near the campaign's own
  domain?
- How many attempts started, how many were non-results and solved again, and which were left out?
  Every rate carries its denominator.
- **Inside:** `draw <name>`, `reading <name>`, the admission line.
  **Outside:** the study's record, the benchmark's task list.
- *Example: 8 of 65 main tasks, 3 of 35 professions, one rollout each, in the campaign's own
  neighbourhood by choice.*

## 2. Conditions

Name each that could differ, and say whether it did, with the evidence:

- **Time and order:** run side by side, or days apart? Interleaved, or one arm first? A provider,
  a price or a model's behaviour can move in between.
- **Interpreter and environment:** which `python`, which packages, what `PATH`, which versions? List
  what each arm could import and run, tried from inside the arm's own setting.
- **Runtime:** the same executor, tools and system prompt? What does the executor add by itself
  (built-in skills, web tools, its own context files)?
- **Budget:** turns, deadline, dollars and effort, each the same and each what the arm was told.
- **Network:** which hosts were open, and did anyone use them?
- **Host:** load, machine, a deadline measured under different load.
- **The grader:** the same model, version, settings and conversion for both?
- **Inside:** `conditions <name>`; `HOST LOADED` and `LOAD MOVED`. **Outside:** by hand, each row.
- *Example: only three of the eight tasks ran side by side, and they differ by 6 of 254, against
  26 of 296 on the five run a day apart. The two arms' environments differ from the pilot's too, so
  no figure from the pilot serves as a noise estimate.*

## 3. What was carried

Byte identity first, then whether each part still works where it landed.

- Is the delivered guide the kept guide, less a known note? Diff it.
- Is the toolchain the kept toolchain? Diff the tree, and list each difference by kind.
- Do the links resolve there? A link into a temporary copy dangles once the copy moves.
- Does each program start, from the place and under the `PATH` the solver has? Run a sample there.
- What did the export drop on purpose, and did the dropped part hold anything (`agent/tools.ts`)?
- Did the solver load the guide? Look for a sign in its first turns.
- **Inside:** the digest proves it. **Outside:** `studies/shared/claude-export.ts` and its tree.
- *Example: the guide matched byte for byte; 8,353 of 8,360 kept toolchain files arrived with the
  same sha-256 (13,727 of 13,734 counting compiled caches) and 7 dangling links did not, one of them
  `bin/python`, with `bin/python3` still working; `tools: []` meant the dropped tool file held nothing.
  2 of 185 tool calls failed on a dropped path, and both solvers recovered. The operator's suspicion of
  a bad copy was refuted here, by two reads of one store that counted differently and agreed.*

## 4. What was told

Copying can be perfect and the transfer still false. Read the guide as the solver would, in that
workspace, and sort every factual statement:

- **True there**, **false there**, or **meaningless there**.
- Limits: turns, minutes, budgets and how they are enforced.
- Interface: file names, tools, a submit call, an answer format, a home directory.
- Scoring: how a result is judged, what is rewarded, what a harness's tuning assumed.
- Workflow: a suggested order of work, a target number of turns, a stopping point.
- Programs: what each expects to find (an input path, a schema) and what happens when it does not.
- Which of these did a note or the export correct? Which did it leave?
- Then the behaviour: did any solver cite it, and did its actions follow it? Absence of a citation
  proves little where thinking cannot be read.
- *Example: a note corrected three names. "20 turns and 30 minutes", a scoring section and a path
  layout stayed. One program failed both times it was tried, on a path that exists only in a
  campaign. No visible text cited the budget, and 5 of 8 rollouts passed 20 turns, so the false limit
  is a defect whatever it did and its effect is unproved.*

## 5. What it was selected on

Could the gain that promoted this harness be expected to show here at all?

- Which measure carried the promotion: validity or the objective? Read `reading`, `replay`,
  `carriedBy`. Was it confirmed against the starter, by how much?
- What did its exam ask for, what did its checks read, and what did they never reward?
- Set that beside what this comparison's grader rewards. A chart, a document, a stated
  recommendation: did any check ever see one?
- Count the refusals in the rollouts: blocked commands, walls, limits met. Use this with "How a review
  answers 'was it too strict?'" in `SKILL.md` to separate refused from told wrongly from selected
  narrowly.
- State what the study already expected (`studies/harness2/README.md`, "Read every result against how
  uneven the comparison is"). A result the protocol predicted is no surprise to explain away.
- *Example: the promotion was carried by the objective alone, on checks that read numbers; the
  benchmark's rubrics read written deliverables. Every rollout ended normally, so nothing suggested
  a refusal.*

## 6. What the grader could see

The grader's view is not the deliverable. Reproduce the view apart, reading each file as the grader's
own conversion does, with no model call.

- Is there a cap on each file or in total? What falls past it, by arm and file?
- What does conversion do: are images embedded as text that eats the cap? Are figures attached or
  lost? Do notebooks keep their output?
- Does order inside a file decide what is seen? A large sheet placed early hides what follows.
- Are images read only under a condition, up to a count?
- Which file does the grader treat as the deliverable? What did it never open?
- Check the grader's stated reasons against the full deliverable: "not found" where the text is past
  the cap is an artefact, and "not found" where it is absent is a miss.
- Read it apart and report it beside the official score, never in its place.
- **Inside:** the verifier reads the answer whole; the Referee rules rejections with evidence
  (lanes 1 to 8 of a whole-run investigation).
- *Example: on one task the data sheets filled the cap, so the summary sheets were never read: 4
  rubrics worth 32 of that task's 68 points fell on all three arms, and a fifth worth 8 on two of them.
  A statement of one arm sat near character 209,140 of a 200,000 cap, which cost it 8 points the other
  arm won with the same statement placed earlier. A memo's two embedded figures took about 300,500
  characters and cost that arm 4,407 readable ones, while a PDF of the other arm lost none; a second
  read found no failed criterion that the lost text would have met, so the first report's "may have
  cost criteria" fell. The grader reads only `text` notebook outputs, which leaves more of a
  `display()` habit unread (20,585 against 1,204 characters on one task), and explains neither split
  on those tasks.*

## 7. How the score is formed

- All or nothing, or partial? Count the rubrics scored neither at zero nor at their weight.
- Read the difference at each grain: points, rubrics, criteria. Say how far one grain amplifies
  another. The primary measure stays as the ledger froze it, and the rest are description.
- Count those one criterion short: how many rubrics rest on one sentence?
- How much of the gap is one task, or one rubric? Drop each task in turn, and report whether the sign
  holds.
- Do weights make one kind of work decide the total?
- Read the paired test both ways, on the task differences (`scripts/levels.ts`, `testOf`).
- *Example: a gap of 7 criteria of 241 became 32 points of 550, on 11 split rubrics of 68: the
  candidate won 3 for 30 points and lost 8 for 62, and each of the 8 was one criterion short. By task
  the bare arm led 6 to 2 on points (p 0.074) and 5 to 2 with one tie on criteria (p 0.25), so the
  grain changes how strong the same result looks. Leaving out each task in turn kept the sign and moved
  p between 0.016 and 0.133, the lowest on leaving out the candidate's largest win, a cut made after
  seeing and worth no claim.*

## 8. Each split, both directions

- List every rubric or task where the arms split, won and lost alike. No selection by size.
- Classify each miss, blind where you can: **wrong** (a claim the grader refutes), **absent** (never
  stated), **unseen** (stated past what the grader read), **disputed** (the grader's reason does not
  hold of the deliverable).
- List the shared misses apart. Both arms missing it says something about the task, the grader or the
  solver, and nothing about the harness.
- For a win as for a loss: does the explanation you favour predict this row?
- **Inside:** the wall holds, so per-task reading stays with the investigation's lanes, and the
  report names ids and counts.
- *Example: none of the 8 rubrics lost was a wrong number, and all were absent or unseen
  statements. A second read sorted the 62 points as 8 unseen, 14 substantive and 40 a single sentence
  or framing, a judgement and not a count. Both arms made the same wrong choice of year on one task,
  which says nothing of either harness.*

## 9. Behaviour

- How many turns, how long, and how many output tokens? Sort turns by kind: work, recovery from a
  missing package or a failed program, reading, polishing. Fewer turns can be a harness's virtue.
- What did the solver write and how much reached the deliverable?
- Which programs did it use, and which failed? Which tools or built-in skills did only one arm use?
  Web searches?
- Did it follow the guide's workflow? Where did it stop, and with what final check?
- Read any association across so few tasks as description. A rank correlation on eight points
  decides nothing.
- **Inside:** `solve.call`, the lanes on solves, `chain`, `tasks`.
- *Example: the candidate took 197 turns to 285 and wrote 326,010 tokens to 400,143, lower on 8 of
  8. Part of that gap is the bare arm recovering from missing packages (42 module errors to 13, 25 of
  them on one task), and neither read found the turn or call gap tracking the score gap across tasks
  (rank correlation -0.18 on turns, Pearson 0.07 on calls, both on 8).*

## 10. Noise

Say how far one harness moves against itself, and how that was measured, or say it is unmeasured.

- A clean A/A is one harness, under one condition, in one period, with rollouts interleaved. Anything
  else is a description.
- Rollout noise and grader noise are two measures. The same deliverable graded twice measures the
  second, without a new rollout.
- How large a difference could this size show (`bun .claude/skills/comparison-reading/scripts/size.ts`)?
- Report the test's p beside its size, never as "within the noise" without a measured noise.
- **Inside:** the A/A beside each comparison (`noise`), `falseRate`, `incapable`.
- *Example: the only same-harness pair crossed a change of installed packages, 298 against 342.
  Quoting it as noise was wrong, and no clean A/A exists yet. Its per-task differences (mean +5.5,
  standard deviation 5.4) are a shift and a spread together. A second read still named chance as the
  leading explanation, while that spread puts the gap of -4 a task about 2.1 standard errors out on 8
  tasks, so "chance" needed the arithmetic beside it as much as "a real deficit" did.*

## 11. Economy

- Each arm's dollars and hours beside its score, on one meter (`billOf`). Grader dollars apart.
- Whether one arm's cost hides a saving elsewhere: a harness that saves turns but pays for a program.
- *Example: 11 rollouts billed 124.13 dollars, 20.78 for solving and 103.35 for grading over 98
  calls, so a repeat is priced mostly by the grader. The pilot's rate was 1.74 dollars a call and this
  one 1.05: an estimate names the rate it used, since the same design came to about 1,400 and about
  2,200 dollars on the two.*

## 12. What this could not read

Close with what is absent: thinking not recorded, a trace not kept, a condition nobody logged, a task
not run. A level with no evidence says so, and its absence never reads as a clean result (`AGENTS.md`,
section 9).

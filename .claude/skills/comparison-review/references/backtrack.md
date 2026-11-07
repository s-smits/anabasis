# From a finding back to the system

A comparison shows one thing that happened. What may reach the system is a mechanism that holds
beyond it. Three things stand between them: a card that strips the comparison away, a chain that
finds the owner, and a gate that asks whether the system needed this anyway.

## The shape card

One card a finding, written for a reader who has seen no result:

```text
Shape:      the mechanism, in the terms of AGENTS.md section 14
Where:      the owner suspected (a path), or "unknown"
Observable: what the system's own record would show if it recurs (an event, a field, a count)
Would look like: what a case of it looks like, in any domain
```

A card names no benchmark, task, rubric or arm; gives no direction and no score; and says nothing of
what would have raised anything. "A guide's statement about limits survives into a runtime with other
limits" is a card. "The harness lost points on JobBench because it wrote less" is not one, and can
become one only if it says something that holds without the benchmark. Keep the result's link to each
card in the ledger, out of the card.

A finding that cannot be written so is still worth reporting, as a fact of this comparison. It does
not go back to the system.

## The chain

Walk back from what happened to what could be changed, one link at a time, each with its evidence,
and stop at the first owner that could change for every domain:

```text
score difference
  <- grader's view of the deliverable        the instrument
  <- the deliverable's content               the solve's outcome
  <- what the solver did                     the trace
  <- what the solver was told and could run  the guide, the programs, the condition
  <- what carried it there                   the export, the study
  <- what the Builder chose to write         its session, its notes
  <- what the Builder could see and was paid for   practice results, the comparison's reward
  <- what the exam asked and the checks read the Examiner, its prompt, the contract
  <- what the operator's prompt named        the domain's choice
```

A link with no evidence ends the chain there and names the test that would extend it. A chain usually
ends earlier than a story wants, and where it ends is the honest place to report. Name the seat the
fact belongs to, and let `design-and-seats` decide who owns it: code owns conditions, and models own
content (section 2).

| Where the chain ends | Owner | The kind of change |
| --- | --- | --- |
| The grader's view | the benchmark; nobody here | None. An instrument fact, read apart |
| The carrying | `studies/shared/`, the study | Make what is told true, and make what is carried run |
| The condition | the host, the study's arm | Equalise it, or state it |
| A harness's content | the Builder, in that campaign | None by hand (section 2, consequence 3) |
| What the Builder can see | `src/builder/`, section 1's closed list | A fact it lacks, through the wall's rules (rule 3) |
| What the comparison rewards | `src/kernel/compare.ts` and the operator | A decision, with `promotion-tuner`'s replay first |
| What the exam asks | `src/examiner/`, `examiner-complexity` | Ladder, prompts, or the domain's prompt |
| The solver's condition | the operator (section 3) | A decision |
| A model's ability | nobody | None. Report it (no handholding of a weak seat) |

## Counting it in the system's own record

This is what makes the generalisation real. A fresh session takes the cards alone and asks each of the
record: across campaigns, domains and kept harnesses, how often does this shape occur?

- Read by fold or script where one exists: `bun run runs replay`, `promotion-tuner/scripts/table.ts`,
  `harness-audit/scripts/harness-versions.ts`, `examiner-complexity/scripts/grades.ts`,
  `whole-run-investigation`'s derived readers, `bun run runs source --has <text>` to select runs that
  hold a mechanism.
- Give a count with its denominator, the logs read and their commits. A run is evidence only about its
  own code.
- Count across independent contexts: another domain, another pack, another solver. Several runs of one
  pack are one context.
- Read the record before any change, so the record is untouched by the change.
- Report zero plainly. A shape absent from the record is a fact of this comparison, however neat.

## The eight questions

A card leaves the review only through all eight. Each "no" is a reason written beside it.

1. **Is it stated without the comparison?** The card holds as written.
2. **Would it be proposed if the result had reversed?** The mirror question. A false statement in a
   guide is false whichever side won. "Write more" is proposed only because a side lost, and it falls
   here.
3. **Does it recur?** In at least two independent contexts of the system's record, counted. One
   context makes it a lead for a look at the record, never for a change. A plain defect needs no
   recurrence: it is wrong once, whatever the frequency.
4. **Is the benchmark absent from the change?** No vocabulary, rubric, threshold, deliverable type or
   task shape of the benchmark enters code, a prompt, a check or an exam. If the change's only visible
   effect would be on this benchmark's score, it is fitting.
5. **Does it respect the stance?** It gives a model facts rather than a course, and an author facts
   rather than a target; adds no second limit on the Builder; hands no domain knowledge to the starter;
   and helps no seat with what a strong model manages alone (section 2).
6. **Does it pass rule 13's map?** `owner → live reader → decision it changes → evidence → hostile
   test`. Prefer rewriting the owner, and take four fifths for a fifth of the code (section 2,
   consequence 7).
7. **Which trade-off does it move?** Name the lever in section 1's "Trade-offs to keep in view", the
   factor it serves and the sign to watch. A change with no cost has not been looked at.
8. **Can it be falsified in the system's own measure?** One prediction, one count, from the system's
   log, and read before the benchmark. A change that can only be seen in the benchmark is the benchmark
   steering the system.

## Dispositions

Each card gets one:

- **Defect.** Wrong whichever way the result went. Fix it at its owner, under the task's authority, or
  ask where it changes what a solver is told. Say it fixes the defect, and claim no gain.
- **Instrument fact.** True of the grader or the conditions. Report it beside the score, and change
  nothing in the system.
- **Limit of the claim.** What this comparison cannot show. Goes into the wording of every claim from it.
- **Lead.** Passed the gate, and needs an experiment. One row in `Predictions.md` or in the measuring run's `predictions-<run>.md`, with its burned tasks, settled in its `outcomes-<run>.md` and, where it does not hold, carried in its `still-missing-<run>.md` beside the "Intentionally opposed" trade-offs.
- **Domain choice.** Only the operator's: what to ask a campaign to build. Put as a decision with
  evidence.
- **Dropped.** Failed the gate. Stays listed with the question it failed, so the next review need not
  rediscover it and the count of ideas stays honest.

## Worked cards

The first JobBench reading of the promoted jobstat harness. Every row is at the level "Planned" or
below. The dispositions are the author's and were not made blind; none has been tested forward. They
show the gate's working, not results.

| Finding | Card | Mirror | Recurs | Disposition |
| --- | --- | --- | --- | --- |
| The guide told "20 turns and 30 minutes" under no such limit | A guide's statement about limits survives into a runtime with other limits | Holds | Not needed | Defect in the carrying (`studies/shared/claude-export.ts`), on the operator's word |
| 7 links dangled, among them `bin/python` | Absolute links made inside a temporary copy dangle once the copy moves | Holds | Not needed | Defect in the carrying |
| A program failed on a path only a campaign has | A program a harness builds is bound to the workspace it was built in | Holds | To count across kept harnesses | Lead for a look, and no limit on the Builder (section 2, consequence 3) |
| Grader's 200,000-character cap hid sheets | None: it is the benchmark's | Holds | Not asked | Instrument fact, read apart |
| A memo's figures ate the cap | None: as above | Holds | Not asked | Instrument fact |
| 7 criteria became 32 points | None: the score's form | Holds | Not asked | Instrument fact and a limit of the claim |
| The built arm wrote less, and lost on absent statements | A harness selected on one measure spends less on work no comparison rewards | Fails as "write more"; holds as a question about selection | To count: turns and output tokens a solve across promotions in campaigns' logs | "Write more" dropped. The selection question is a lead, read from the system's own logs |
| Promotion carried by the objective alone, and the benchmark rewards prose | None: two gradings differ, as the study's protocol predicted | Holds | Not asked | Limit of the claim. Widening the exam is a domain choice for the operator |
| Bare arm used a built-in skill and web search more | None yet: two tasks each | Unclear | Not asked | Dropped as too thin, listed |
| The guide and programs were made under 20 turns and 30 minutes, and were read under no turn cap and 3600 s | A harness selected under a tight limit carries what it learned about that limit into a looser one | Holds | To count: work a solve across promotions, the same as above | Lead, and a decision on the solver's limits is the operator's |
| The candidate's wins: 3 rubrics for 30 points, for flagging and for a correct basis | A harness's programs reach a detail a bare solver misses | Holds | To count: what `programs-of:<digest>` comparisons carried | Lead, written after the first cards, so counted as such |
| Built arm's score matched the pilot's Starter exactly on 4 tasks of 8 | None: rubric weights make ties common | Not asked | Not asked | Dropped. Tested against which interpreter each arm used: the built arm hit fewer module errors, 13 against 42, so "it lost its packages" fell |

# From a finding back to the system

A comparison shows one thing that happened; what may reach the system is a mechanism that holds
beyond it. A card strips the comparison away, a chain finds the owner, and a gate asks whether the
system needed the change anyway.

## The shape card

```text
Shape:           the mechanism, in the terms of AGENTS.md section 14
Where:           the suspected owner (a path), or "unknown"
Observable:      what the system's own record would show if it recurs (an event, a field, a count)
Would look like: a case of it, in any domain
```

A card names no benchmark, task, rubric or arm, gives no direction or score, and says nothing of what
would have raised anything. "A guide's statement about limits survives into a runtime with other
limits" is a card; "the harness lost points on JobBench because it wrote less" is not. The link from
result to card lives in the ledger, and a finding that cannot be so written stays a fact of this
comparison.

## The chain

Walk back from the score difference through the deliverable, the trace, what the solver was told and
could run, what carried it, what the Builder wrote and was rewarded for, and what the exam asked, one
evidenced link at a time, and stop at the first owner that could change for every domain. A link
without evidence ends the chain and names the test that would extend it. Code owns conditions and
models own content (section 2, `design-and-seats`).

| Where the chain ends | Owner | Change |
| --- | --- | --- |
| The grader's view | the benchmark | none; an instrument fact |
| The carrying | `studies/shared/`, the study | make what is told true and what is carried run |
| The condition | the host, the study's arm | equalise it, or state it |
| A harness's content | the Builder | none by hand (section 2, consequence 3) |
| What the Builder can see | `src/builder/`, section 1's closed list | a missing fact, within rule 3 |
| What the comparison rewards | `src/kernel/compare.ts`, the operator | a decision, after `promotion-tuner`'s replay |
| What the exam asks | `src/examiner/`, `examiner-complexity` | ladder, prompts, or the domain's prompt |
| The solver's condition | the operator (section 3) | a decision |
| A model's ability | nobody | none; report it |

## Counting it in the record

A fresh session counts each shape across campaigns, domains and kept harnesses with existing readers
(`bun run runs replay`, `promotion-tuner/scripts/table.ts`, `harness-audit/scripts/harness-versions.ts`,
`examiner-complexity/scripts/grades.ts`, `bun run runs source --has <text>`), each count with its
denominator and commits, runs of one pack as one context, before any change, and zero said plainly.

## The eight questions

A card leaves only through all eight, with a written reason for each "no".

1. **Is it stated without the comparison?**
2. **Would it be proposed had the result reversed?** A false guide statement is false whichever side
   won; "write more" is proposed only because a side lost, and falls here.
3. **Does it recur** in two independent contexts, counted? One context makes a lead for a look,
   never a change; a plain defect needs no recurrence.
4. **Is the benchmark absent from the change?** None of its vocabulary, rubrics, thresholds,
   deliverable types or task shapes enters code, prompt, check or exam; a change visible only in its
   score is fitting.
5. **Does it respect the stance** (section 2): facts instead of a course or target, no second limit on
   the Builder, no domain knowledge in the starter, no help a strong model does not need?
6. **Does it pass rule 13's map**, preferring a rewrite of the owner?
7. **Which trade-off does it move** (section 1), with the sign to watch? A change with no cost has not
   been examined.
8. **Can it be falsified in the system's own measure**, by one count read before the benchmark?

## Dispositions

**Defect**: wrong whichever way the result went; fixed at its owner (or asked, where it changes what a
solver is told), claiming no gain. **Instrument fact**: reported beside the score. **Limit of the
claim**: enters every claim's wording. **Lead**: one row in `Predictions.md` or the measuring run's
`predictions-<run>.md`, settled in `outcomes-<run>.md` or carried in `still-missing-<run>.md`.
**Domain choice**: the operator's decision, with evidence. **Dropped**: listed with the question it
failed, so the count of ideas stays honest.

## Worked cards

From the first JobBench reading of the promoted jobstat harness, disposed by its sighted author and
untested forward, so they illustrate the gate instead of reporting results.

| Finding | Card | Disposition |
| --- | --- | --- |
| The guide told "20 turns and 30 minutes" under no such limit | A guide's statement about limits survives into a runtime with other limits | Defect in the carrying (`studies/shared/claude-export.ts`) |
| 7 links dangled, `bin/python` among them | Absolute links made in a temporary copy dangle once it moves | Defect in the carrying |
| A program failed on a path only a campaign has | A harness's program is bound to the workspace it was built in | Lead, counted across kept harnesses; no limit on the Builder |
| A character cap hid sheets; 7 criteria became 32 points | none: the benchmark's | Instrument facts, and a limit of the claim |
| The built arm wrote less and lost on absent statements | A harness selected on one measure spends less on work no comparison rewards | "Write more" dropped by the mirror; the selection question is a lead |
| Ties with the pilot's Starter on 4 of 8 tasks | none: rubric weights make ties common | Dropped |

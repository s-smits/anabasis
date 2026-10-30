# The tally, the test and the reading

Read this for task scores, weights, the sign-flip test, reading types and A/A controls. This expands
the middle of `AGENTS.md` section 7. Use `scripts/size.ts` for sample-size figures and
`scripts/reading.ts` for recorded comparisons.

## The tally

Every solve of the new harness is paired with every solve of the reference on the task, and the task
is scored by three measures over those pairings, each from -1 to 1, by fixed weights (`pointsOf`,
`WEIGHTS` , `src/kernel/compare.ts` ):

- **validity**, 0.6: the share of pairings where only the new side's answer is valid, less the share
  where only the reference's is;
- **the objective**, 0.3: between two valid answers, how much better the new one is as a share of
  the larger measure, counted from the floor (`ROOM`, 1%) and full at a tenth (`FULL`);
- **the bill**, 0.1: between two valid answers, the base-2 logarithm of the reference's bill over the
  new one's, counted from a fifth less (`CHEAPER`) and full at half.

The weighted sum determines the task's outcome: positive is a win, negative is a loss and zero is a
tie. `wholePoints` rounds to thousandths, with half points away from zero; reports and the promotion
tuner's replay share it. Swapping sides negates the score. Ties are excluded from the test. A
pairing with an invalid answer reads neither the objective nor the bill, so a refused answer is
never better and a fast failure never cheaper. The measures trade: valid in 3 solves of 4 against 4
of 4 still wins where the valid answers measure a fifth better and bill half. The weights and floors
are the operator's constants of the host; a comparison continued under other code is refused on its
setting, so none is read by two sets of weights; a recorded comparison read again by this tree is
scored by them, while its own report stays what it said. The report gives each measure's points
(`points`).

## The objective

An **objective** is a quantity the check program's evaluator computes from a valid answer, with a
direction, verified after the checks pass (`brief.objective`, `objective(request)` ; `OBJECTIVE` ,
`src/kernel/verify.ts` ): public, in the contract and the solver's resources, and fixed as a term at
the start (`ObjectiveRule`). With none, two valid answers differ only by their bill. The test says
whether a difference is believable and the floors whether it is worth counting: without `ROOM` , six
tasks won by 0.01% would read p = 0.016 (0.015625) and promote; under it such gains score zero and
tie. A task the reference closes on validity and the objective has no room in supply
(`informative`), so a harness that only bills less wins it as a retained task, while the Examiner is
still asked for tasks the reference fails.

## The test and the step

**The test.** A one-sided, exact, paired sign-flip test on each task's score (`flipP`): were the
harnesses interchangeable, each untied task would be as likely won as lost by its margin, and p is
the share of sign assignments summing to at least what was observed. Where every untied task is won,
p is a half to the power of their count, so a gain's size weighs only where wins and losses meet.
The **frontier** and the **retained** tasks, both fixed at the start, are read in this one test, so
a gain on new tasks can offset a loss on old ones; the report keeps their tallies apart, and an
empty retained set reads `unmeasured` , never "no loss". Each family's tallies stand beside both,
from the same rows: they show concentration and prove no independence.

The step (`stepOf`) is the test at or under the level (0.02 by default; with equal margins 6 to 0, 8
to 1, 10 to 2, 12 to 3; at 0.10: 4 to 0, 6 to 1, 7 to 2, 9 to 3), cleared twice: on each task's
score, and on the same scores without the bill (`unbilled`). A step has to stand without the bill
(the operator, 25 October), so the second test can only take a step away. The null is the fixed-task
one. Every reading prints its untied count, the share it detects four times in five (`detectable`)
and its false rate at its margins (`falseRate`), an upper bound under the two-test rule: at 24
untied tasks of equal margin 1.1% at 0.02 and 7.6% at 0.10, and other margins have rates of their
own. A `step` counts for the stop rule as a gain. The level is recorded at the opening, so a
campaign is read by its own rule.

These numbers are the production test's own and `scripts/size.ts` prints them from it: at 0.02 the
smallest scored set that can read a step is 6 tasks, all won (`sweepOf`), and comparison admission
asks for 8 frontier tasks (`comparisonFloor`, `src/campaign/admission.ts` , a sweep plus two); at
0.10 they are 4 and 6. At 24 untied tasks a reading at 0.02 detects four times in five a harness
that wins 80% of them, and at 12 one that wins 87% (`detectable`; `src/kernel/size.ts` , head
comment).

## The reading

The reading is one of these words (`Reading`, `src/campaign/comparison.ts` , whose head comment
names the older ones, none of which promotes):

| Reading | Meaning |
| --- | --- |
| `step` | The test cleared its level |
| `no-step` | A test was made and did not clear its level |
| `not-scored` | No task was tallied, or the cap cut the test short. Nothing was tested |
| `check-defects` | The comparison stopped on its check defects |
| `no-change` | The session left nothing new to compare |

## Beside the test

The report shows how each harness did alone (`valid`: tasks where every, some or no solve was
valid), which tasks entered each set, the overlap with the previous comparison of the same pair, and
each measure's points. Beside it stands the A/A comparison, the reference on halves of its own
solves mirrored in time, read either way at the level by the step's rule (`readsStepEitherWay`),
with its flip rate; a report written before 26 October has no scores without the bill and keeps its
scored-only reading. It should read no step, and it ends nothing: the climb counts it (section 1,
factor 2).

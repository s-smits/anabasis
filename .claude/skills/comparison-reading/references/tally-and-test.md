# The tally, the test and the reading

Read this for task scores, weights, the sign-flip test, reading types and A/A controls. This expands
the middle of `AGENTS.md` section 7. Use `scripts/size.ts` for sample-size figures and
`scripts/reading.ts` for recorded comparisons.

## The tally

Every solve of the new harness is paired with every solve of the reference on the task, and the task
is scored by two measures over those pairings, each from -1 to 1, by fixed weights (`pointsOf`,
`WEIGHTS`, `src/kernel/compare.ts`):

- **validity**, 0.6: the share of pairings where only the new side's answer is valid, less the share
  where only the reference's is;
- **the objective**, 0.3: between two valid answers, how much better the new one is as a share of
  the larger measure, from -1 to 1, counted from the floor (`ROOM`, 1%) and tied under it (`told`).

What a solve billed is reported and scores nothing. An older report may keep a third measure, the
bill at 0.1, with its scores without the bill as `unbilled`, which every reader takes through
`scoresIn`.

The weighted sum determines the task's outcome: positive is a win, negative is a loss and zero is a
tie. `wholePoints` rounds to thousandths, with half points away from zero; reports and the promotion
tuner's replay share it. Swapping sides negates the score. Ties are excluded from the test. A
pairing with an invalid answer reads no objective, so a refused answer is never better. The
measures trade, validity weighing most: valid in 3 solves of 4 against 4 of 4 still wins where the
valid answers measure more than two thirds better, and loses at less. The weights and floors
are the operator's constants of the host; a comparison continued under other code is refused on its
setting, so none is read by two sets of weights; a recorded comparison read again by this tree is
scored by them, while its own report stays what it said. The report gives each measure's points
(`points`).

## The objective

An **objective** is a quantity the check program's evaluator computes from a valid answer, with a
direction, verified after the checks pass (`brief.objective`, `objective(request)`; `OBJECTIVE`,
`src/kernel/verify.ts`): public, in the contract and the solver's resources, and fixed as a term at
the start (`ObjectiveRule`). With none, two valid answers tie. The test says
whether a difference is believable and the floors whether it is worth counting: without `ROOM`, six
tasks won by 0.01% would read p = 0.016 (0.015625) and promote; under it such gains score zero and
tie. A task the reference closes on validity and the objective has no room in supply
(`informative`), and the Examiner is asked for tasks the reference fails.

## The test and the step

**The test.** `flipP` performs an exact one-sided paired sign-flip test over task scores.
Under interchangeability of the harnesses, each nonzero margin is equally likely to have either
sign. The p-value is the share of sign assignments whose sum is at least the observed sum. When
every nonzero task is won, p = 2 to the power of minus the task count; margin size then matters
only when wins and losses coexist. Frontier and retained tasks are fixed before solving and enter
one test, allowing gains on new tasks to offset losses on old tasks. Reports show their tallies
separately. An empty retained set is `unmeasured`, rather than evidence of no regression.
Family tallies describe concentration; they do not establish independence.

The step (`stepOf`) is the test at or under the level (0.02 by default; with equal margins 6 to 0, 8
to 1, 10 to 2, 12 to 3; at 0.10: 4 to 0, 6 to 1, 7 to 2, 9 to 3), read on each task's score
(`scoresIn` for a recorded report). The null is the fixed-task one. Every reading
prints its untied count, the share it detects four times in five (`detectable`) and its false rate
at its margins (`falseRate`), both of the test the step reads: at 24
untied tasks of equal margin 1.1% at 0.02 and 7.6% at 0.10, and other margins have rates of their
own. A `step` counts for the stop rule as a gain. The level is recorded at the opening, so a
campaign is read by its own rule.

These numbers are the production test's own and `scripts/size.ts` prints them from it: at 0.02 the
smallest scored set that can read a step is 6 tasks, all won (`sweepOf`), and comparison admission
asks for 8 frontier tasks (`comparisonFloor`, `src/campaign/admission.ts`, a sweep plus two); at
0.10 they are 4 and 6. At 24 untied tasks a reading at 0.02 detects four times in five a harness
that wins 80% of them, and at 12 one that wins 87% (`detectable`; `src/kernel/size.ts`, head
comment).

## The reading

The reading is one of these words (`Reading`, `src/campaign/comparison.ts`, whose head comment
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
with its flip rate. It should read no step, and it ends nothing: the climb counts it (section 1,
factor 2).

## The record

The reasons behind each rule of `src/kernel/compare.ts`, so that the code keeps what it does and this
file keeps why, with the counts each choice rested on.

**The test.** The paired sign-flip test (`flipP`) reads each task's score. It is exact, by one
convolution over the integer sums, and needs no more than the sign test it replaced: tasks
independent, the two sides alike under the null. Where every untied task is won or lost by as many
pairs it is the sign test, so the plan's smallest wins (4-0, 6-1, 7-2, 9-3 at 0.10) and its table of
power hold to the bit; at several solves a side it also reads how far a task was won, so a 4-1 lost
by one pair in sixteen clears 0.10 where the sign test read every 4-1 at 0.1875. One exact test at
0.02 promotes equal harnesses 1.13% of the time on 24 untied tasks each won or lost by a pair
(`power` at one half). Two other readings of a tally, the trinomial test and the chance that the new
harness is the better one, decide nothing and are not built: their formulas and what they read of
the recorded comparisons are in `7f0add79:docs/plan.md`, "Statistical power and cost" (row C3).

**One test over two sets.** The retained tasks were once a second test, read `regressed`; in 58 real
readings it fired once, on r3's g-12, the starter, which the one test reads `no-step` (p 0.147). A
step whose untied tasks all fell in one family once read `narrow`; in 1,598 recorded readings it
never fired.

**One reading promotes.** The step was once read in two stages: a first reading at or under a
trigger, 0.25, bought a repeat on fresh solves, and the two read together had to clear the level. Of
24 readings in 56 campaigns that cleared the level by themselves, 11 were read again and 11 of 11 won
at least as many tasks as they lost; the repeat took 1 to 2.5 hours of a promotion's 6 to 7, and a
trigger term, a repeat's scored set, its task supply and a rule of the campaign tools served it
alone. So one reading promotes and every comparison draws alike. The level is the caller's and
recorded with the campaign's opening, so a campaign reads by its own rule whatever the tree's default
(`7f0add79:docs/plan.md`, Statistical power and cost).

**The bill scores nothing.** The bill once weighed a tenth of a task's score between two valid
answers. Once no step rested on it, the tally a seat was told and the one the step was read on parted:
one Builder was told 13-1-2 of a comparison read on 3-0-13. A second test, on the score with the bill,
was added after v065-a's aecc1c92 was promoted on 25-3 as scored where the same tasks read 0-10
without the bill, a harness worse by the objective promoted on its cost. Of 47 comparisons read under
both tests, none cleared without the bill and failed as scored, so the scored test decided nothing
the other did not, and it went. Replayed by the promotion tuner over 214 readings, dropping it added
one step and took none: v070's g-4, 21-5-6 without the bill and 17-15-0 as scored, a harness better
by the objective on 16 tasks and dearer. Over 84 readings of 40 campaigns, the test without the bill
took the step from 7 of the 46 promotions the scored test reads, and added none. So the bill left the
score, and the closing report owns the cost (`close.ts`). `carriedBy` also named the bill while it
scored: in buffer-fresh-opus-v065-a's g-3 it carried 25 of 25 wins.

**`ROOM`.** In buffer-fresh-opus-r6 every solve of both sides was valid on all 24 tasks of comparison
g-2, which read 23-0-1 and promoted on gains of 0.01% to 0.65%: at the floor the same solves read
3-3-18, and its task admission held 10 of the 29 drafts it held with no floor. Without the floor six tasks
with room won by 0.01% read p = 0.016 and promote. A `--room` term that set it per campaign was named
by no campaign, so the operator chose one fixed floor, and the tree reads every comparison at it. The
author's answer counts towards room (`hasObjectiveGap`): when it counted from solves alone, a live
Examiner had 7 of 7 drafts refused, three of them with an answer of its own 3% to 20% cheaper than
every reference solve's, because the reference repeated one recipe within the floor. The floor keeps
the author's precision out: in buffer-fresh-opus-r6 its answers held drafts by a hundredth of a
percent.

**`WEIGHTS`.** A task was once read by validity, then the objective, then the bill, one rule to a
task, and the size of a gain counted nowhere: a harness that won 23 tasks by 0.01% read as strongly
as one that halved every bill. The operator then chose a score of weighted measures, in steps of
five. Replayed on 74 recorded comparisons, it read 52 steps where 47 were read, and none of the 26 A/A
comparisons read one; the five steps it dropped rested on objective gaps of a ten-thousandth. The bill's
share later went, leaving the other two as they were. The tree reads every comparison by its weights,
older ones included: the report each wrote is its record.

**The gain is uncapped.** A pairing's objective gain once counted as its share of a tenth (`FULL`, 0.1),
capped at one, so every gain from 10% up weighed alike. A replay at 0.1, 0.3 and 1.0 found it close to
inert, and it went: the gain counts as its own share of the larger magnitude, which `gainOver`
bounds at one. Replayed by the promotion tuner over 154 local campaigns (224 readings, 224 A/A
comparisons), the tree with `FULL` reads 105 recorded promotions as rightful and 106 pairs promoted,
and the tree without it 103 and 104, with no A/A step in either. The two promotions it drops are
truss-fresh-opus-opus-head919's g-1 (7-1-0, p 0.0078 to 0.0625, its A/A 4-4-0) and
buffer-fresh-opus-v065-a's g-5 (10-1-7, p 0.0073 to 0.5005): small objective gains that the cap had
counted as much as a validity loss. Counting each gain past the floor by its sign alone read 103
rightful promotions, one more in doubt and one A/A step (buffer-fresh-opus-v070's g-1), so it was not
taken.

**`informative`.** A task the reference failed in every solve was once never informative, so once a
promoted harness passed every scored solve (buffer-149's 68 of 68 in two comparisons, recode-151's 56
of 56, buffer-159-opus's 38 of 40) its room was only the tasks it answered some of the time, and task
admission held out only such drafts.

**`readsStepEitherWay`.** The table once ended a campaign on its epoch's first A/A step, and no longer
does.

**The mirror.** The A/A's later solves once ran after the test's own were done, so a drift read as a
difference, and `--noise` once read one at fewer by solving the reference twice as often (`round.ts`,
`unsolvedJobs`).

**Fresh solves.** A comparison's solves are the ones it started itself, and the table of how each
ending enters a pair is the plan's (`7f0add79:docs/plan.md`, Phase 2).

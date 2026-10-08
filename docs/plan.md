# Anabasis v2: plan after the v1 review

8 October 2026, revised 9 October · Stijn Smits

![The full system under the plan](system.png)

v2 keeps its independent exam and uses the checks as a floor, compares the old and the new harness pairwise on measured quantities, and builds no agent to find answers. It takes three things from v1: staged sizing, Builder freedom, and one Builder conversation that is kept by compaction. Nothing beyond the items listed here is built until a small scored round has run on real tasks.

## Terms

Each term below has one meaning throughout this plan and in the system figure.

| Term | Meaning |
| --- | --- |
| Solver | The model under test. It answers tasks. |
| Harness | The guide and tools the solver works with. This is what the system tries to improve. |
| Builder | The agent that changes the harness, also called the Harness Builder. It works in one conversation that continues across sessions. |
| Examiner | The agent that writes new tasks. |
| Judge | The agent that recomputes a rejected answer to decide whether the rejection was right. |
| Check | A hidden program that tests one rule of a task and returns pass or reject. The set of checks for a domain is the check program. |
| Valid answer | An answer that passes every check. |
| Rejection | An answer that at least one check rejects. It is a true fail when the answer is wrong, and a check defect when the answer was correct. |
| Objective | The quantity a task asks the solver to optimise, such as mass. It is the metric for comparing two valid answers. |
| Held-out task | A task the Builder never sees. Only held-out tasks are scored. |
| Practice task | A task released to the Builder for trying out changes. It is never scored. |
| Minimal baseline | The solver with only a shell and the tool that writes an answer. |
| Tie | A task on which neither harness wins. Ties are left out of the test. |
| Step | A comparison in which the new harness wins significantly more tasks than it loses. |
| Checkpoint | One comparison, made after one or more Builder sessions. |
| Trace | The record of one solve: every model turn and every tool call with its result. |
| Session | One bounded stretch of Builder work, with limits on time, turns and practice solves. A session ends with a frozen harness version. |
| Diagnoser | The agent that reads one failed practice trace and names the first wrong step, the likely cause and what would prove that diagnosis wrong. |

## Why v1 did not climb

v1 never completed one full improvement cycle, which it called a climb step. Across 83 runs and 357 batteries (a battery is one test set), no failure was both genuine and reproducible. A step was defined as a true fail, meaning the solver's answer was wrong and the check was right to reject it; then a change to the harness in response; then the same task solved; then a harder battery that the solver again fails in part.

| Problem | What v1 recorded |
| --- | --- |
| The test was bounded by its author's ability | The Builder wrote each task and had to solve it first, so no task was harder than what the Builder could already do. The solver, a model of the same class, then solved it too: 265 of 299 batteries were passed in full. |
| Label noise in the test | When a task was failed, the check was usually at fault. 36 of 47 rehearsal misses came from a faulty check or instrument, and 17 of 22 fails that were counted as limits were disputed. |
| High variance between repeated solves | On truss there were 2 fails in 59 repeated solves, and both passed when solved again. One failed solve therefore says little. |
| Harder tests became broader instead of deeper | Enlarging a probe of 5 to 8 tasks to 25 diluted its difficulty in 10 of 13 cases. After a difficulty raise, the median solve time was only 1.07 times the previous one. |
| Failures were rarely acted on | A genuine fail led to a change in the harness about once in six chances. |

- **The one change that made tasks harder:** several requirements that share one limit. This took pass counts from 22 of 23 down to 7 of 20 and 2 of 23.
- **Interventions that had no effect:** a Builder at higher reasoning effort than the solver (6 of 6 passed, twice), a different model solving another model's tasks (9 of 10), hiding the grading instrument from the solver (12 of 12 and 20 of 21), and using rehearsal solves as a filter (895 of 939 passed).
- **Choosing the answer first did not help either.** Six tasks were built around a chosen answer, at a size where greedy and a 12,000-move local search failed. The solver passed all six in 2.5 to 26 minutes. Limits taken from a 3.4-hour search were passed 5 times in 6.
- **The recorded explanation:** the public rules let the solver check its own candidate, "so it wrote a search and ran it until the checks cleared".
- **What was reliable:** the passes. An independent Judge overturned only 5 of 1,411.
- **What was never tested:** tasks whose answer already exists in the field, and a second author for the test. An answer builder for the second was written on 30 September and never ran. v2's Examiner is that second author.

These figures come from v1's notes as summarised by the operator on 8 October. v2's repository holds one ledger row on the subject, `docs/transfer.md:78`.

## Where v2 stands

v2 avoids the self-graded score, but v1's binding constraint is still present: it has moved to gate 2. Read at the stack head, PR #54 (`claude/close-solve-record`, commit `df3935a`).

| v1 blocker | What v2 does today | Status |
| --- | --- | --- |
| Self-graded score | Paired comparison of old and new harness on tasks the Builder never sees. | Avoided |
| The answer is the author's own | A separate Examiner writes tasks, but gate 2 keeps a task only after one pass by a stronger solver. That solver has been the same model at higher effort. | Present, moved to gate 2 |
| A failed task usually meant a wrong check | Uses v1's check program as imported. A failed stronger solve closes the task as `too-hard`, a state with no exit. The Referee may flag it, and the task closes either way. | Present |
| A single fail is a flip | Screening admits on 2 fails in 3 solves. Gate 2 decides on one solve. | Handled at screening only |
| Authors widen instead of deepening | The Examiner hears one word per task and is given no size target. No graduation step exists yet. | Open |
| A true fail was seldom followed up | The Builder gets the trace and a diagnosis for each practice fail. | Addressed, unproven |
| Spend on uninformative runs | No probe stage. A dollar cap was written in PR #16 and closed unmerged. | Present |

The live record so far:

- **Gate 2:** the first sessions lost 14 of 25 tasks there, by the comment in `src/examiner/session.ts`.
- **Second Examiner session:** $48.45 for seven tasks, five too hard and two too easy. No reviewer read the five rejections.
- **Rounds:** eight rounds on 8 October cost over $220 and scored no task.
- **Campaign `exam-1`:** 4 anchor tasks, 1 practice task and 2 candidates. A round on it cannot read a step.

## Principles

Eight principles guide every item below. Each one follows from a result recorded in v1 or v2.

1. **Evaluate the harness as a whole.** The comparison answers one question: does the new harness perform better than the old one on held-out tasks? It does not say which tool or prompt caused the difference. That would need an ablation study, which is run only when the cause matters.
2. **Use measured quantities as the metric.** An answer is valid when it passes the checks. Its quality is a number that an instrument computes, such as mass. A model's opinion about which of two answers looks better is never used as a metric.
3. **Work without ground-truth answers.** A design task has many valid answers, so there is no single correct answer to compare against. The checks verify the required properties, and the best valid answer found so far serves as the reference point for each task.
4. **Treat a pass as reliable and verify every rejection.** In v1 the passes were almost always correct, while most rejections came from faulty checks. A rejected answer therefore counts only after it has been recomputed independently.
5. **Repeat every measurement.** A single solve has high variance: the same harness can fail a task once and pass it the next time. A fail, a win or a loss counts only when repeated solves support it.
6. **Give the Builder full freedom over the harness and no access to the test set.** The Builder may change or rewrite anything. It never sees a scored task, a trace of one, or a check, which keeps it from overfitting to the evaluation.
7. **Fix the sample size and the budget before each round.** The number of tasks and solves is chosen from earlier rounds and is never changed once results are visible, since that would bias the test. Every round also has a spending cap.
8. **Add machinery only in response to evidence.** A new mechanism is built when a live result shows it is needed. On 8 October, 37 pull requests were stacked while only one small live round had run.

## Phases

The plan runs in seven phases, and the first three buy no Builder session.

| Phase | Goal | Gate that ends it |
| --- | --- | --- |
| 0 | Analyse the data we already have | G0: the stored rejections are labelled and counted, and the value a check verifies is known |
| 1 | One Judge and a reliable check program | G1: the check program has an owner, is frozen, and every rejection on record has a ruling |
| 2 | The pairwise comparison | G2: the minimal baseline against the starting harness gives wins and losses on at least 8 held-out tasks |
| 3 | Cheap rounds | G3: one probe produces both wins and losses |
| 4 | First scored round | G4: the round reports wins and losses, every rejection ruled on |
| 5 | Checkpoint comparison | G5: a step against the first harness, with at least as many wins as losses against the baseline |
| 6 | After a step | none: nothing in it is built before G5 |

Gate G2 is the one the plan turns on: if the pairwise comparison cannot separate the minimal baseline from the starting harness, the rounds below it have nothing to measure. Phase 6 is drawn dashed because nothing in it is built before a step has been observed.

## Phase detail

Each phase starts only when the gate before it has passed. Phases 0 to 2 pay for no Builder session.

### Phase 0: analyse the data we already have

The goal is to learn two things without paying for a solve: how reliable rejections are, and where the objective value can be read from.

- **Label the stored rejections by hand.** These are the five from the second Examiner session and the 14 of 25 that the first sessions lost at gate 2. Each gets one of three labels: true fail (the answer is wrong), check defect (the check rejected a correct answer), or infeasible task (no valid answer exists).
- **Find where the objective value can be read.** A check returns only pass or reject (`src/kernel/check-child.ts`), so the comparison needs a value that the answer reports and that a check verifies. Truss answers report mass, utilisation and deflection.
- **Run the pairwise comparison once on stored answers,** from the first and the last cycle of the stored sweep. Those tasks set a mass limit and did not ask for the lightest design, so this only tests that the code runs. Whether the comparison can separate two harnesses stays open until Phase 2.
- **Add the account of v1 to `docs/`,** since v2 holds one ledger row on it.

**Gate G0:** the labels are counted, and we know which reported value is verified by a check and can serve as the objective.

### Phase 1: one Judge and a reliable check program

The goal is that no rejection counts until it has been verified independently.

- **Turn the Referee into the single Judge** by giving it a shell and the domain's installed engines. It looks at one answer at a time and recomputes each rule that a check reported as broken. It needs no reference answer, because the task's rules define what is correct, and it builds no tools of its own.
- **Rule on every rejection.** If the recomputation confirms the violation, the rejection is a true fail. If it shows the rule is met, the rejection is a check defect: the task is set aside as disputed and the check goes to its owner for repair.
- **Keep a person in the loop while rulings are few.** A person confirms every check defect. Where a rule cannot be recomputed, the Judge's ruling is advice only.
- **Give the Judge its own sandbox policy,** because it reads the check program and the hidden values.
- **Settle the check program.** Name its owner (decisions 38 and 47 of the existing plan), confirm or add a check that verifies each value an answer reports, and freeze it (`tools/c/accept.ts --freeze`).

**Gate G1:** the check program has an owner, is frozen and verifies the reported values, and every rejection on record has a ruling.

### Phase 2: the pairwise comparison

The goal is a metric that needs no reference answer and still separates two harnesses when both produce valid answers.

- **State the objective.** Add an objective and its direction, for example "minimise mass", to the contract and to every new task. A solver that is not asked for the lightest design will not look for it. Changing the contract starts a new campaign.
- **Compare in code.** Every solve of the new harness is paired with every solve of the old one on the same task. In each pair a valid answer beats a rejected one, and of two valid answers the one with the better objective wins if the difference exceeds a minimum margin. The harness that wins more pairs wins the task; otherwise the task is a tie. The sign test over tasks is unchanged.
- **Remove the stronger solver.** Gate 2 used one solve by a stronger model to prove that a task was possible. A task without any valid answer now stays in the held-out set and is solved again at each checkpoint. Until one harness produces a valid answer it is a tie, which costs solves and introduces no bias.
- **Add a minimal baseline.** This is the same solver with only a shell and the tool that writes the answer, with no guide and no domain tools. A harness without an answer writer cannot be loaded today (`src/solve/harness.ts`), so running with no harness at all is impossible. The baseline is the opponent of the first harness and a fixed reference for all later ones.
- **Show the Builder the metric.** A practice solve returns whether the answer was valid and its objective value. The objective is public, so nothing is leaked.
- **Give the Examiner feedback.** For each task it wrote, it learns the outcome: one harness won, a tie, or no valid answer yet. Without gate 2 it would otherwise receive no signal.
- **Keep a best-known value.** The best valid answer seen for each task is stored as its reference point.
- **Remove screening and the anchor.** Screening selected tasks by pass or fail, and the anchor existed to guard that selection. The new comparison uses every held-out task and needs neither.

**Gate G2:** on at least 8 held-out tasks, the minimal baseline against the starting harness produces both wins and losses, and every rejection has a ruling.

### Phase 3: cheap rounds

The goal is that no round can spend much money before it has shown it can produce a result.

- **Cap the spend.** Reopen the dollar cap from PR #16 and require `--cap` at launch.
- **Add a probe.** A probe is 5 to 10 tasks with one solve per harness, where any rejected answer is solved once more.
- **Block rounds that cannot give a result.** Turn the two launch warnings from PR #47 into blocks, unless the round is started as a probe.

**Gate G3:** one probe produces both wins and losses.

### Phase 4: first scored round

The goal is one comparison between a Builder's new harness and its parent, plus the noise estimates needed to set the margin.

- Run 12 held-out tasks with 2 solves per harness.
- Write down the predicted result before launch.
- Have the Judge rule on every rejection before the result is read.
- Record three quantities: how much the objective varies between repeated solves of the same harness, the share of tasks that tie, and the billed cost per solve. The margin is set from the first of these.

**Gate G4:** the round reports wins and losses, and every rejection in it has a ruling.

### Phase 5: checkpoint comparison

The goal is to detect a large improvement cheaply, by comparing once after several Builder sessions instead of after each one.

- **Keep one Builder conversation for the whole campaign, as v1 did.** A session still ends at its limits on time, turns and practice solves. The next session resumes the same conversation instead of starting from nothing, so the Builder keeps what it has learned and tried. The conversation is resumed only while the system prompt, the tool definitions and the model backend are unchanged, which was v1's rule.
- **Keep the context by compaction.** When the conversation outgrows the context window it is compacted, and each compaction is logged (`build.compacted`). After every compaction the standing facts are given again: the contract, the practice tasks, the limits and the list of failed practice solves. v1's Builder lost its task count at compaction and had to ask for it again.
- **Show every practice trace, failed as well as passing.** v1 showed its Builder passing traces only, because that Builder also wrote the test. Here the Builder is given the list of all failed practice solves so far, with the harness version, how each ended and the Diagnoser's finding. The list only grows; nothing is summarised or dropped, and the Builder chooses which failures to work on. Any trace is opened in full with `read_trace`, since all of them together would not fit in one message. Today that tool reaches only the solves under the session's starting harness (`src/builder/tools.ts`). Traces of held-out tasks are never shown, and a rejection ruled a check defect is left out.
- **Repair from traces with the agents that already exist.** v1 built this loop, and v2 has every part of it, so no new agent is added. For each failed practice solve the Judge first rules out a check defect. The Diagnoser then names the first step where the solve went wrong, the likely cause, whether the harness, the solver or the public rules are responsible, and one observation that would prove the diagnosis wrong. It reads the failed trace beside a passing solve of the same task. The Builder decides which failures to repair and solves the same task again after its change. The host then marks each failed solve in the list as open, repaired or failing again, read from the log. Repaired means the task passes in repeated solves under a later harness version.
- **Let the Builder keep notes.** It writes a notes file in its workspace for its own later use. If the process restarts and the conversation is lost, a new conversation opens with these notes and the same lists. In v1 a restart lost the conversation as well, and the notes were the only fallback.
- **Tell the Builder each comparison's result in aggregate:** wins, losses, ties, and whether it was a step. It is never told which held-out tasks were won or lost. This reveals a few bits per checkpoint, which is acceptable while checkpoints are few.
- **Compare once per checkpoint.** The latest harness is compared with the first harness and with the minimal baseline, on held-out tasks.
- **Reuse earlier solves** of the baseline and the old harness when the condition id and the served model snapshot are identical, and add a few fresh solves to detect drift. The condition includes a digest of the host code, so reuse is only possible while the source tree stays unchanged during a checkpoint. Today earlier solves are excluded by `since()` in `src/builder/round.ts`.
- **Keep every harness version,** so a failed checkpoint can fall back to the last good one.

**Gate G5:** a step against the first harness, with at least as many wins as losses against the minimal baseline. This replaces gate G4 of the existing plan, a step that also holds on the anchor.

### Phase 6: after a step

Nothing in this phase is built before gate G5 has passed.

- The controller loop and promotion, which the ledger lists as deferred.
- A metric for domains without a measured objective: the same Judge assesses each answer separately, and the two assessments are compared in code.
- An ablation study of a harness that showed a large gain, if the cause matters.
- A second domain.

## Tuning

The way a task is scored changes, and three mechanisms are removed: the stronger solver, screening and the anchor.

| Setting | Now | Proposed | Reason |
| --- | --- | --- | --- |
| How a task is scored | The harness that passes more often wins | Valid beats invalid, then the stated objective by a minimum margin, over every pairing of solves | v1: 265 of 299 batteries passed every case, so pass or fail seldom separates |
| Gate 2 witness | One solve by the stronger solver; a fail is final | Removed; a task with no valid answer waits in an unsolved pool | v1: the solver matched whatever the author's side found. The first sessions lost 14 of 25 tasks here |
| Screening (`--screen`, `--fails`) | 3 solves per side, admit at 2 fails | Removed; every held task is scored | The pairwise comparison gives wins and losses when both harnesses pass |
| Anchor (`--anchor-floor`) | Unscreened tasks, floor of 8 | Removed with screening; the minimal baseline is the fixed reference | The anchor existed to guard the screened choice |
| Baseline | None | A minimal harness: a shell and the answer writer | The first harness has no parent |
| Scored set (`--target`) | 24 | 12 until supply allows more | No campaign has yet scored a task |
| Solves per side (`--solves`) | 3 | 2 | At equal cost, more tasks detect more than more solves |
| Level (`--level`) | 0.10 | Keep | The real false-positive rate is 2% to 8%, since counts are whole numbers |
| Reader of fails | Referee with a probe tool, advising | Judge with a shell and the domain's engines; a person confirms check defects | 36 of 47 misses in v1 were the check's |
| Stop rule | Under 10 points pooled over 3 sessions | No step in 3 checkpoints | The points were a pass-rate measure |
| Dollar cap | None | Required at launch, with a reserve per solve | Over $220 was spent on 8 October with no task scored |
| Earlier solves | Solved again every round | Reused when condition id and snapshot match | The minimal baseline never changes |
| Builder context | A fresh conversation in every session | One conversation across sessions, kept by compaction, with a notes file as fallback | v1 worked this way; a fresh session loses what earlier sessions learned and tried |
| Practice traces | Failed and passing, within one session | Failed and passing, across all sessions, as a growing list | v1 hid failed traces, and a genuine fail led to a harness change once in six chances |

## Statistical power and cost

A round with 12 untied tasks has about 65% statistical power when the new harness truly wins three tasks in four. Small rounds can therefore detect only large effects, which is why Phase 5 compares once after several Builder sessions.

| Untied tasks (sample size) | Wins needed for a step | Power at a 65% true win rate | Power at 75% | Power at 85% |
| --- | --- | --- | --- | --- |
| 8 | 7 | 17% | 37% | 66% |
| 12 | 9 | 35% | 65% | 91% |
| 16 | 12 | 29% | 63% | 92% |
| 24 | 16 | 53% | 88% | 99% |

How to read the table:

- **Effect size** is the true share of untied tasks that the new harness wins. A share of 50% means the two harnesses are equal.
- **Power** is the probability that a round detects an effect of that size and reports a step. The figures are exact for the sign test at a significance level of 0.10.
- **The false-positive rate** is the probability of a step when the harnesses are in fact equal. It lies between 2% and 8%.
- **Sixteen tasks give no more power than twelve** because the number of wins needed moves in whole steps.
- **Ties carry no information.** The share of scored tasks that end untied is therefore the main quantity Phase 4 has to measure.

Costs are estimates at $7 per solve, the price the live truss solves were billed at. A Builder session is counted with up to 24 practice solves.

| Phase | Paid work | Estimate |
| --- | --- | --- |
| 0 | Judge rulings and recomputation on stored answers, no solve | A few dollars |
| 1 | Judge rulings, and repeat solves of a few rejected answers | Under $50 |
| 2 | 8 tasks at 2 solves under the baseline and under the starting harness | $230 to $300 |
| 3 | One probe of 10 to 20 solves, plus repeats | $70 to $170 |
| 4 | 48 scoring solves and one Builder session | $400 to $600 |
| 5 | Three Builder sessions and one comparison of 48 solves | $700 to $1,000 |

For comparison, one round at today's defaults is about 430 solves, close to $3,000. Removing screening and the anchor is what brings a scored round under $600. An Examiner session also becomes cheap once it no longer pays for solves by a stronger model: its own turns cost $2.01 of the $48.45 in the second session.

## What we will not do, and why

Sixteen ideas are deliberately left out. Most were tried in v1, and each row gives the result that speaks against the idea.

| We will not | Why |
| --- | --- |
| Build an agent that finds the answers | Such an agent would be the same model with a shell, which is what the solver already is, so it would find nothing the solver cannot. v1's branch for it, `claude/answer-builder`, was never run. |
| Keep reference answers | A design task has many valid answers, so a single reference is not meaningful. The checks verify the required properties, and the best-known value gives a reference point. |
| Make tasks hard by building them around a chosen answer | v1 tried this with six tasks sized beyond greedy and local search. The solver passed all six in under 26 minutes. |
| Set limits with a stronger solver or a longer search | v1 took limits from a 3.4-hour search, and the solver passed 5 of 6. A Builder at higher effort than the solver gave 6 of 6, twice. |
| Let a Judge pick the better of two answers by impression | A model tends to prefer the more convincing answer, and the Builder would learn to optimise for that preference. v1 did not allow two answers in one Judge prompt. |
| Add a second Judge for pairwise comparison | Measured values are compared in code. Where nothing is measured, the one Judge assesses each answer separately. |
| Have the Judge build its own tools | A shell and the installed engines are enough to recompute a rule. Building tools is the Builder's task. |
| Let a Judge overrule passes | v1's passes were reliable: its Judge overturned 5 of 1,411. |
| Keep screening and the anchor | Both exist to select tasks by pass or fail. The pairwise comparison uses every held-out task. |
| Tell the Examiner which difficulty zone its tasks fell in | v1 changed this feedback first, and it did not make tasks harder. |
| Score individual tools, or build other attribution machinery | The parts of a harness interact, and an ablation study costs as much as a full round. |
| Run a full-size comparison after every Builder session | At today's defaults a round costs about $3,000, and the gain from a single session is usually too small to detect. |
| Enlarge a probe by asking for more tasks at once | In v1 this diluted difficulty in 10 of 13 cases. |
| Let the Builder write tasks or checks | In v1 a harness passed 75 of 75 tasks its own Builder wrote and 2 of 23 on a shared test set. |
| Add more review lanes, launch commands or log readers before Phase 4 | Principle 8: no live result has shown a need for them. |
| Summarise failed traces into an issue list before the Builder sees them | The failed traces are appended and shown as they are. v1 consolidated them into at most six issues, and a genuine fail still led to a harness change only about once in six chances. |

## Decisions for the operator

Seven choices are yours, and each one holds a phase.

- [ ] **Owner of the check program.** Who may repair a check and add one that verifies the values an answer reports, under the plan's decisions 38 and 47. Holds Phase 1.
- [ ] **The deciding quantity.** Which quantity each domain's tasks state as their objective. Adding it to the frozen contract opens a new campaign. Also whether time and cost are only reported or may break a tie. Reporting only is proposed. Holds Phase 2.
- [ ] **The margin before Phase 4.** How much better an objective must be to count as a win while the noise is unmeasured. The instruments' own tolerance is proposed. Holds Phase 2.
- [ ] **Removing gate 2 and the per-task reject controls.** The Examiner writes its controls from the stronger solve's answer today. Moving the controls to the single acceptance reading of the check program is proposed. Holds Phase 2.
- [ ] **Dollar cap.** The cap for each phase, and whether PR #16 is reopened as written. Holds Phase 3.
- [ ] **The stack.** Whether the 37 open pull requests merge before Phase 1's changes are stacked on them.
- [ ] **The plan of record.** Whether this amends or replaces "Anabasis: one plan", and whether the plan moves into the repository, where it is absent today.

## Risks

The largest risk is that measured quality separates two harnesses no better than pass or fail did.

- **A flat objective.** Two harnesses may differ less than two solves of one harness do. Gates G0 and G2 test this before any Builder session is bought.
- **An objective that can be gamed.** A harness may gain on the objective by giving up margin elsewhere. The checks stay the floor, and every rule a task states stays a hard rule.
- **An objective nobody was asked for.** A check returns pass or reject and no number, and the stored truss tasks set a mass limit without asking for the lightest design. The comparison needs tasks that state an objective and a check that verifies the value an answer reports.
- **A Judge with the solver's blind spots.** It is the same class of model. Its rulings rest on recomputation, and a person confirms check defects while they are few.
- **Drift behind reused solves.** A provider may serve a different snapshot under one alias. A few fresh solves are the check.
- **Regressions between checkpoints.** Several sessions of work can be lost at one failed comparison. Kept harness versions limit the loss to a fallback.
- **Cost estimates.** They rest on two observed figures, $7 a solve and the cost of one Examiner session.
- **Context lost at compaction.** A long conversation is compacted many times, and detail drops out each time. The standing facts are given again after each compaction, and the notes file holds what the Builder chose to keep.

## Sources

- **v2**, `s-smits/anabasis-v2` at PR [#54](https://github.com/s-smits/anabasis-v2/pull/54), commit `df3935a`: `src/kernel`, `src/builder`, `src/examiner`, `src/review`, `tools/d2`, `docs/transfer.md`, and the whole-run investigation's `from-v1.md` and `lanes.md`.
- **v2 pull requests** read for their recorded results: [#16](https://github.com/s-smits/anabasis-v2/pull/16) (dollar cap), [#45](https://github.com/s-smits/anabasis-v2/pull/45) (rehearsals), [#47](https://github.com/s-smits/anabasis-v2/pull/47) (launch notes), [#48](https://github.com/s-smits/anabasis-v2/pull/48) (settling by hand), [#52](https://github.com/s-smits/anabasis-v2/pull/52) (second Examiner session), [#53](https://github.com/s-smits/anabasis-v2/pull/53) (provider retries).
- **v1**, `s-smits/harness-builder-v4` at commit `0d0fae6`: `AGENTS.md`, `src/run/battery-sizing.ts`, `src/run/climb-readout.ts`, `src/run/climb-readout-frame.ts`, `src/critic/policy.ts` and the starter pack's `difficulty-ladder.md`. The commit the ledger cites, `7af7315`, could not be fetched.
- **v1's public repository**, [s-smits/anabasis](https://github.com/s-smits/anabasis) at commit `3f93d06`: `AGENTS.md`, "Open gaps: why batteries still pass whole", for the chosen-answer and long-search results and the note on `claude/answer-builder`.
- **The operator's account of v1's notes**, 8 October 2026, drawn from `notes/binding-constraints.md`, `notes/climb-blockers-20261001.md`, `notes/climb-review-20261002.md` and `notes/wri-20261007`. These files were not read for this plan.
- **Detection figures:** an exact calculation for the sign test, made for this plan on 8 October 2026.

## Revisions

**9 October 2026.** The plan was rewritten in plainer terms and extended in one place. What it commits to changed as follows; everything else is wording.

- **One Builder conversation is taken from v1** beside staged sizing and Builder freedom, and Phase 5 gains the work for it: the conversation continues across sessions while the system prompt, the tool definitions and the backend are unchanged; it is kept by compaction, with the standing facts given again after each one; a notes file is the fallback when a process restart loses it. Carried Builder memory leaves Phase 6's deferred list for that reason.
- **Practice traces become a growing list across sessions,** failed as well as passing, each failed solve with its harness version, how it ended and the Diagnoser's finding, and marked by the host as open, repaired or failing again. `read_trace` has to reach solves of earlier sessions. Nothing is summarised: a sixteenth item joins the list of things not done.
- **The repair loop is named** and uses only agents that exist: the Judge rules out a check defect, the Diagnoser reads the failed trace beside a passing one, the Builder chooses what to repair and solves again.
- **The Builder is told each comparison's result in aggregate,** wins, losses, ties and whether it was a step, and never which held-out tasks were won or lost.
- **The Judge's own sandbox policy** is a separate item of Phase 1.
- **Two rows join the tuning table** (Builder context, practice traces) and **one risk** (context lost at compaction).
- **A Terms section fixes eighteen words.** The plan now says comparison where it said reading, rejection where it said refused answer, held-out task where it said unseen task, and check program where it said checker.
- **The principles were restated,** the same eight, and the section on what a round can detect now names effect size, power and the false-positive rate.

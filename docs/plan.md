# Anabasis v2: plan after the v1 review

8 October 2026, revised 9 October after an independent review · Stijn Smits

![The full system under the plan of 8 October](system.png)

The figure was drawn for the text of 8 October and has not been redrawn for this revision. Three things in it are no longer the plan: the contract states no objective and the Examiner's tasks state none until Phase 3 is built; two valid answers are even, so there is no objective comparison between them; and a step does not move the reference harness, which is promoted only in Phase 6.

v2 keeps its independent exam. Before anything else is built, one experiment measures whether a harness changes what the solver achieves. If it does, the reference harness and a new harness are compared pairwise at a fixed compute budget, on validity first and on a measured objective only when validity leaves too many ties. No agent is built to find answers. The plan takes three things from v1: staged sizing, Builder freedom, and one Builder conversation that is kept by compaction. This version was revised on 9 October after an independent review and the discussion that followed it.

## Terms

Each term below has one meaning throughout this plan and in the system figure.

| Term | Meaning |
| --- | --- |
| Solver | The model under test. It answers tasks. |
| Harness | The guide and tools the solver works with. This is what the system tries to improve. |
| Builder | The agent that changes the harness, also called the Harness Builder. It works in one conversation that continues across sessions. |
| Examiner | The agent that writes new tasks. |
| Correctness model | Everything that decides whether an answer is valid: the check program and each task's hidden values, and the objective function once one is added. The name is v1's. |
| Check | A hidden program that tests one rule of a task and returns pass or reject. The checks of a domain form the check program. |
| Verifier | The host code that runs the correctness model on one answer, inside the sandbox. |
| Compute budget | The limits one solve runs under, in turns and CPU seconds, with a time limit behind them. Both harnesses get the same budget. |
| Valid answer | An answer that passes every check and was submitted within the compute budget. |
| Rejection | An answer that at least one check rejects. It is a true fail when the answer is wrong, and a check defect when the answer was correct. |
| Judge | The agent that recomputes a rejected answer to decide whether the rejection was right. |
| Hand label | A person's verdict on one rejected answer, written before any Judge ruling is seen: true fail, check defect or unclear. |
| Objective | The quantity a task asks the solver to optimise, such as mass. It is added only if validity leaves too many ties (Phase 3). The host computes it from the answer, and a value the answer reports about itself is not used. |
| Held-out task | A task the Builder never sees. Only held-out tasks are scored. |
| Practice task | A task the operator releases to the Builder for trying out changes. Once released it is never scored. |
| Reference harness | The harness a new version is compared with. It is the harness the campaign starts with, until a step is promoted. |
| Minimal baseline | The solver with only a shell and the tool that writes an answer, with no guide and no domain tools. Also called the bare solver. |
| Comparison | The reference harness and a new harness solve the same held-out tasks. Each task is a win, a loss or a tie for the new harness. |
| Tie | A task on which neither harness wins. Ties are left out of the test. |
| Step | A comparison in which the new harness wins significantly more tasks than it loses. |
| Round | One Builder session followed by one comparison. |
| Checkpoint | Several Builder sessions followed by one comparison. |
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
| Harder tests became broader instead of deeper | When a probe of 5 to 8 tasks was enlarged to 25, the added tasks passed in 10 of 13 cases. The cause was not isolated. After a difficulty raise, the median solve time was only 1.07 times the previous one. |
| Failures were rarely acted on | A genuine fail led to a change in the harness about once in six chances. |

- **The one change that made tasks harder:** several requirements that share one limit. This took pass counts from 22 of 23 down to 7 of 20 and 2 of 23.
- **Interventions that had no effect:** a Builder at higher reasoning effort than the solver (6 of 6 passed, twice), a different model solving another model's tasks (9 of 10), hiding the grading instrument from the solver (12 of 12 and 20 of 21), and using rehearsal solves as a filter (895 of 939 passed).
- **Choosing the answer first did not help either.** Six tasks were built around a chosen answer, at a size where greedy and a 12,000-move local search failed. The solver passed all six in 2.5 to 26 minutes. Six limits were reset from longer searches, of 45 minutes to 3.4 hours, and the solver passed 5 of the 6.
- **The recorded explanation:** the public rules let the solver check its own candidate, "so it wrote a search and ran it until the checks cleared".
- **What was reliable:** the passes. An independent Judge overturned only 5 of 1,411.
- **What was never tested:** tasks whose answer already exists in the field, and a second author for the test. An answer builder for the second was written on 30 September and never ran. v2's Examiner is that second author.

These figures come from v1's notes as summarised by the operator on 8 October. v2's repository holds two ledger rows on the subject, `docs/transfer.md:67` and `:78`.

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
| Spend on uninformative runs | No probe stage. The operator declined a campaign cap on 8 October, and PR #16 was closed unmerged. | Present |

The live record so far:

- **Gate 2:** the first sessions lost 14 of 25 tasks there, by the comment in `src/examiner/session.ts`.
- **Second Examiner session:** $48.45 for seven tasks, five too hard and two too easy. No reviewer read the five rejections.
- **Rounds:** eight rounds on 8 October cost over $220 and scored no task.
- **Campaign `exam-1`:** 4 anchor tasks, 1 practice task and 2 candidates. A round on it cannot read a step.

## Principles

Eight principles guide every item below. Each one follows from a result recorded in v1 or v2.

1. **Evaluate the harness as a whole.** The comparison answers one question: does the new harness perform better than the old one on held-out tasks? It does not say which tool or prompt caused the difference. That would need an ablation study, which is run only when the cause matters.
2. **Use measured outcomes as the metric.** An answer is valid when it passes the checks within the compute budget, which is the same for both harnesses. When validity leaves too many ties, quality is added: a number that the host computes from the answer, such as mass. A value the answer reports about itself is not used, because the Builder writes the tool that reports it. A model's opinion about which of two answers looks better is never used as a metric.
3. **Work without ground-truth answers.** A design task has many valid answers, so there is no single correct answer to compare against. The checks verify the required properties, and the best valid answer found so far serves as the reference point for each task.
4. **Treat a pass as reliable and verify every rejection.** In v1 the passes were almost always correct, while most rejections came from faulty checks. A rejected answer therefore counts only after it has been recomputed independently.
5. **Repeat every measurement.** A single solve has high variance: the same harness can fail a task once and pass it the next time. A fail, a win or a loss counts only when repeated solves support it.
6. **Give the Builder full freedom over the harness and no access to the test set.** The Builder may change or rewrite anything in the harness, within the one limit its prompt sets today: no harness tool tells the solver whether a candidate meets a rule. It never sees a scored task, a trace of one, or a check, which keeps it from overfitting to the evaluation.
7. **Fix the sample size and the limits before each round.** The number of tasks and solves, the compute budget and the margin are chosen from earlier rounds and are never changed once results are visible, since that would bias the test. Every round also has a dollar cap.
8. **Add machinery only in response to evidence.** A new mechanism is built when a live result shows it is needed. The first such result is whether a harness changes what the solver achieves at all, which no run found in v1's or v2's records has measured. On 8 October, 37 pull requests were stacked while only one small live round had run.

## Phases

The plan runs in seven phases, and the first four buy no Builder session.

| Phase | What it does | Gate after it |
| --- | --- | --- |
| 0 | Measure whether a harness matters | G0: at some budget at least 4 of 8 tasks are untied |
| 1 | One Judge and a frozen correctness model | G1: owner, controls, freeze, and the Judge clears its bar |
| 2 | The comparison at a fixed budget | G2: the A/A comparison gives no step, and the baseline leaves at least 4 tasks untied |
| 3 | The objective, only if needed | G3: the objective decides at least half of the pairs of two valid answers |
| 4 | First scored round | G4: the round finishes under its cap with a tally |
| 5 | Checkpoint comparison | G5: a step against the reference harness that holds against the baseline |
| 6 | After a step | none |

Gate G0 is the one the plan turns on: if the bare solver does as well as the existing harness at every budget, a harness has nothing to add for this solver and domain, and the plan stops before anything else is built. Phase 3 and Phase 6 are drawn dashed. Phase 3 is built only if validity leaves too many ties, and Phase 6 only after a step has been observed.

## Phase detail

Each phase starts only when the gate before it has passed. Phases 0 to 3 pay for no Builder session.

### Phase 0: measure whether a harness matters

The goal is to learn, for about $300, whether a harness changes what the solver achieves, and at which compute budget the difference shows. No run found in v1's or v2's records compares the solver with and without a harness on the same tasks.

- **Reopen the dollar cap first.** A cap for each comparison was agreed on 9 October and is required at launch (`--cap`, from PR #16). A comparison that the cap cuts short is read as not scored.
- **Run one experiment: the bare solver against the existing harness.** Eight stored truss tasks with the shared mass limit, 2 solves per arm, interleaved, under today's limits of 120 minutes and 24 turns. The bare solver has a shell and the answer writer, with no guide and no domain tools. For each solve the host records whether the answer was valid, and the turns, CPU seconds, time and billed cost at the moment it was submitted. The mass is computed afterwards from the members and sections in the answer.
- **Read it at several budgets.** A solve submitted after a given budget counts as no answer at that budget, so one set of solves gives the result at every shorter budget. This is an approximation, because the solver was told only the long limit. The same solves give the spread between two solves of one arm on one task, in each unit, which decides the unit of the budget. The budgets to read are fixed before the solves are opened.
- **Label every rejection in it by hand.** A hand label is one person's verdict on one rejected answer, written before any Judge ruling is seen: true fail (the answer is wrong), check defect (the check rejected a correct answer) or unclear, with a note when the task itself looks infeasible. With about 32 solves this is a small job, and it stands in for the Judge until Phase 1.
- **Label the stored rejections as well,** to measure the Judge in Phase 1. These are the five from the second Examiner session, the rejections among the 14 of 25 tasks that the first sessions lost at gate 2, and a blind sample of 20 from the 64 stored rejections (`tools/c/rejections.ts`). The tool draws the sample by a fixed seed and writes one packet per answer: the task with its hidden values, the public rules, the answer and the checks that rejected it. It refuses to draw from a log that already holds a ruling, so the sample is drawn in a fresh campaign log and the Judge rules there afterwards. A sample without any check defect cannot show that the Judge catches one, so known defects are added if it holds none. The Referee ruled all 64 a true fail, and no person has checked that ruling (`docs/transfer.md:119`).
- **Add the account of v1 to `docs/`,** since v2 holds two ledger rows on it.

**Gate G0:** the tally of the existing harness against the bare solver is written down at the full limit and at two shorter budgets: tasks won, lost and tied. The plan continues if at some budget at least 4 of the 8 tasks are untied, and the better arm becomes the reference harness. If fewer are untied at every budget, a harness has no measurable effect for this solver and domain, and the operator chooses a cheaper solver or another domain before anything else is built.

### Phase 1: one Judge and a frozen correctness model

The goal is that no rejection counts until it has been verified independently.

- **Turn the Referee into the single Judge** by giving it a shell and the domain's installed engines. It looks at one answer at a time and recomputes each rule that a check reported as broken. It needs no reference answer, because the task's rules define what is correct, and it builds no tools of its own. It is not told which harness produced the answer.
- **Rule on every rejection.** If the recomputation confirms the violation, the rejection is a true fail. If it shows the rule is met, the rejection is a check defect. If the Judge cannot tell, the ruling is unclear. After a check defect or an unclear ruling the task is set aside as disputed until a person has decided, and a confirmed defect goes to the owner of the correctness model.
- **Measure the Judge before trusting it.** Its rulings are compared with the hand labels of Phase 0 against a bar fixed in advance: the share of labelled check defects it must catch, and the share of true fails it may wrongly void. v2 already has this instrument (`src/review/agreement.ts`). Until the bar is cleared, a person reads every ruling, true fails included.
- **Give the Judge its own sandbox policy,** because it reads the check program and the hidden values.
- **Settle the correctness model, then freeze it once.** Name its owner (decisions 38 and 47 of the existing plan). Regenerate the pack's controls, since all 35 accept controls fail today (`docs/transfer.md:118`). Then freeze contract and check program together (`tools/c/accept.ts --freeze`). A later repair of a check, or an objective added in Phase 3, opens a new campaign: tasks are carried over (`tools/c/carry.ts`), solves are not.

**Gate G1:** the correctness model has an owner and controls that hold, and is frozen. Every stored rejection has a ruling, and the Judge's rulings clear the bar against the hand labels.

### Phase 2: the comparison at a fixed budget

The goal is a comparison that separates two harnesses without a reference answer and without a harder exam, by giving both the same limited compute.

- **Set one compute budget for both harnesses.** It is given in turns and CPU seconds, with a time limit behind them, and the solver is told it. Its size comes from Phase 0: the budget at which the reference harness gives a valid answer on about half the tasks, which is where the fewest tasks tie by chance. v2 limits time, turns and seconds per shell command today, for the solver and for harness tools alike, and it meters CPU seconds without capping them (`src/kernel/condition.ts`, `src/solve/command.ts`). The cap on CPU seconds is added here. In v1 the limit never bound: six tasks passed in 2.5 to 26 minutes of a 120-minute limit.
- **Score the tasks that end at the limit.** v2 sets a task aside as `wall-bound` when its only fails ended at the time limit. Under a budget these are the informative tasks, so a solve that reaches the budget without an answer counts as not valid.
- **Compare in code.** Every solve of the new harness is paired with every solve of the reference harness on the same task, so the two sides may have different numbers of solves. The table below gives the result of one pair. The harness that wins more pairs wins the task; otherwise the task is a tie. The sign test over tasks is unchanged.

| How a solve ended | Its part in a pair |
| --- | --- |
| Valid answer within the budget | It beats an answer that is not valid. Two valid answers are even, unless an objective has been added in Phase 3. |
| Rejected, and ruled a true fail | Not valid. It loses to a valid answer and is even with another answer that is not valid. |
| No answer: the budget was reached, or nothing was submitted | Not valid. No ruling is needed. |
| Rejected, and ruled a check defect or unclear, or still waiting for a person | The task is set aside as disputed and left out of the test for both harnesses. |
| Non-result: a provider, sandbox or verifier failure | Solved again. It is never counted. |

- **Remove the stronger solver.** Gate 2 used one solve by a stronger model to prove that a task was possible. A task without any valid answer now stays in the held-out set and is a tie, which costs solves and introduces no bias. If no harness produces a valid answer in two comparisons in a row, the task goes to a person as possibly infeasible and leaves the set until it is labelled.
- **Keep the minimal baseline.** A harness without an answer writer cannot be loaded today (`src/solve/harness.ts`), so the baseline is a shell and the answer writer. It is a fixed lower reference: G0 and G2 compare the reference harness with it, and G5 requires that a step also holds against it.
- **Run an A/A comparison.** The reference harness is compared with itself on separate solves. It should give no step. Its tie share shows how often a fixed budget splits two solves of one harness at random, which is the noise every later comparison has to exceed.
- **Block launches that cannot give a result.** PR #47 added two launch warnings. The one for too few tasks to read a step becomes a block, and it counts untied tasks. The other concerns the anchor and is removed with it.
- **Show the Builder the result of a practice solve:** whether the answer was valid within the budget, and how much of the budget it used.
- **Give the Examiner the task list with outcomes.** Today an Examiner session is shown the pack's tasks by id and family and can read any of them whole (`read_example`). It sees no task that an earlier session wrote, and no outcome. It should see every task of the campaign, the older and easier ones included, each with its outcome so far: one harness won, a tie between valid answers, no valid answer yet, or disputed. This is a view of the log, so no new store is built.
- **Remove screening and the anchor.** Screening selected tasks by pass or fail, and the anchor existed to guard that selection. The new comparison uses every held-out task and needs neither.

**Gate G2:** two comparisons on at least 8 held-out tasks, at the fixed budget. The A/A comparison gives no step. The reference harness against the minimal baseline leaves at least 4 tasks untied, which confirms Phase 0's reading under a budget the solver is told. The tally, the tie share, the share of tasks with no valid answer under either harness and the billed cost per solve are recorded, and every rejection has a ruling.

### Phase 3: the objective, only if needed

This phase is built only if, at G2, more than half of the tasks tie because both harnesses give valid answers. Its goal is to separate two valid answers by a measured quantity.

- **State the objective.** Add an objective and its direction, for example "minimise mass", to the contract and to every new task. A solver that is not asked for the lightest design will not look for it. Changing the contract opens a new campaign. A task then sets no hard limit on the quantity that is its objective: four of the five tasks closed as too hard in the second Examiner session were rejected on the mass limit (PR #52).
- **Compute it in the host.** A check returns only pass or reject (`src/kernel/check-child.ts`), and the mass a truss answer reports is written by a harness tool, which the Builder controls. An objective function beside the checks computes the value from the answer. For truss, mass follows from the members and sections.
- **Use it only between two valid answers.** The better value wins the pair when the difference exceeds the margin; otherwise the pair stays even. The margin is fixed before each comparison.
- **Show it.** A practice solve returns the objective value to the Builder, and the best valid value seen for each task is reported beside each result. Nothing is decided on that best-known value.

**Gate G3:** in a comparison on at least 8 tasks under the new contract, the objective decides at least half of the pairs of two valid answers, and the A/A comparison still gives no step. If Phase 3 is skipped, G2 stands in for G3.

### Phase 4: first scored round

The goal is one comparison between a Builder's new harness and the reference harness, plus the noise estimates needed to size Phase 5.

- Run 12 held-out tasks with 2 solves per harness. Run more tasks if the tie share measured at G2 shows that 12 would leave fewer than 8 untied.
- Fix the budget, and the margin if an objective is in use, and write down the predicted result before launch.
- Have the Judge rule on every rejection before the result is read.
- Record three quantities: the share of tasks that tie, how much the use of the budget varies between repeated solves of the same harness, and the billed cost per solve.

**Gate G4:** the round finishes under its cap with a tally, every rejection in it has a ruling, and the three quantities are recorded. The gate does not depend on which harness won.

### Phase 5: checkpoint comparison

The goal is to detect a large improvement cheaply, by comparing once after several Builder sessions instead of after each one.

- **Keep one Builder conversation for the whole campaign, as v1 did.** A session still ends at its limits on time, turns and practice solves. The next session resumes the same conversation instead of starting from nothing, so the Builder keeps what it has learned and tried. The conversation is resumed only while the system prompt, the tool definitions and the model backend are unchanged, the rule v1's contract states.
- **Build the smallest loop that can hold that conversation.** v2 cannot do this today: a session deletes its transcript and releases the Builder's home directory when it ends (`src/builder/session.ts`). Phase 5 adds one process that keeps the conversation and the home directory open, runs the sessions of a checkpoint and then its comparison. The operator still launches each checkpoint and decides what follows it. The full controller loop stays in Phase 6.
- **Keep the context by compaction.** When the conversation outgrows the context window it is compacted, and each compaction is logged (`build.compacted`). After every compaction the standing facts are given again: the contract, the practice tasks, the limits and the list of failed practice solves. v1's Builder lost its task count at compaction and had to ask for it again.
- **Show every practice trace, failed as well as passing.** v1 showed its Builder passing traces only, because that Builder also wrote the test. Here the Builder is given the list of all failed practice solves so far, with the harness version, how each ended and the Diagnoser's finding. The list only grows; nothing is summarised or dropped, and the Builder chooses which failures to work on. Any trace is opened in full with `read_trace`, since all of them together would not fit in one message. That tool already opens any solve of a practice task (`src/builder/tools.ts`); what is bound to one harness today is the list in the opening message (`src/builder/session.ts`). Traces of held-out tasks are never shown, and a rejection ruled a check defect is left out.
- **Repair from traces with the agents that already exist.** v1 built this loop, and v2 has every part of it, so no new agent is added. For each failed practice solve the Judge first rules out a check defect. The Diagnoser then names the first step where the solve went wrong, the likely cause, whether the harness, the solver or the public rules are responsible, and one observation that would prove the diagnosis wrong. It reads the failed trace beside a passing solve of the same task. The Builder decides which failures to repair and solves the same task again after its change. The host then marks each failed solve in the list as open, repaired or failing again, read from the log. Repaired means the task passes in repeated solves under a later harness version.
- **Let the Builder keep notes.** It writes a notes file in its home directory for its own later use. If the process restarts and the conversation is lost, a new conversation opens with these notes and the same lists. In v1 a restart lost the conversation as well, and the notes were the only fallback.
- **Tell the Builder each comparison's result in aggregate:** wins, losses, ties, and whether it was a step. It is never told which held-out tasks were won or lost. This reveals a few bits per checkpoint, which is acceptable while checkpoints are few.
- **Compare once per checkpoint, on fresh solves.** The latest harness is compared with the reference harness on held-out tasks, with both sides solved again and interleaved. The minimal baseline is solved only when that comparison reads a step, to test that the step also holds against it.
- **Stop after three checkpoints without a step.** Each checkpoint is tested at the 0.10 level. When the harnesses are equal, three checkpoints read at least one false step about 14% of the time, so a step is repeated once on fresh solves before anything is promoted in Phase 6.
- **Keep every harness version.** After a comparison without a step the Builder continues from its latest harness, and the operator may tell it to return to an earlier one.

**Gate G5:** a step against the reference harness, with at least as many wins as losses against the minimal baseline. This replaces the existing plan's gate G4, a step that also holds on the anchor.

### Phase 6: after a step

Nothing in this phase is built before gate G5 has passed.

- The full controller loop and promotion, which the ledger lists as deferred. A step is repeated once on fresh solves, and only then does the stepped harness become the reference harness.
- A metric for domains without a measured objective: the same Judge assesses each answer separately, and the two assessments are compared in code.
- An ablation study of a harness that showed a large gain, if the cause matters.
- Examiner depth. This plan does not address v1's fifth blocker, authors who widen a test instead of deepening it. If tasks stay too easy to separate harnesses, the first thing to test is v1's one working lever: several requirements that share one limit.
- A second domain.

## Tuning

The way a task is scored changes, one compute budget is set for both harnesses, and three mechanisms are removed: the stronger solver, screening and the anchor.

| Setting | Now | Proposed | Reason |
| --- | --- | --- | --- |
| How a task is scored | The harness that passes more often wins | Valid within the budget beats not valid, over every pairing of solves; the objective by a margin is added only if too many tasks tie | v1: 265 of 299 batteries passed every case, under a limit that never bound |
| Compute budget | 120 minutes and 24 turns per solve (`tools/d2/campaign.ts`); a task whose fails end at the limit is set aside | One budget in turns and CPU seconds, set from Phase 0 where the reference harness is valid on about half the tasks; tasks that end at the limit are scored | v1's solves took 2.5 to 26 minutes of a 120-minute limit |
| Objective | Not stated; truss tasks set a mass limit | Only if needed (Phase 3): stated in the contract, computed by the host, with no hard limit on the same quantity | A reported value is written by a harness tool; 4 of 5 too-hard tasks were rejected on the mass limit |
| Gate 2 witness | One solve by the stronger solver; a fail is final | Removed; a task with no valid answer stays held out as a tie and goes to a person after two comparisons | v1: the solver matched whatever the author's side found. The first sessions lost 14 of 25 tasks here |
| Screening (`--screen`, `--fails`) | 3 solves per side, admit at 2 fails | Removed; every held-out task is scored | The comparison at a fixed budget gives wins and losses without selecting tasks |
| Anchor (`--anchor-floor`) | Unscreened tasks, floor of 8 | Removed with screening; the minimal baseline and the A/A comparison are the controls | The anchor existed to guard the screened choice |
| Baseline | None | A minimal harness: a shell and the answer writer | No run found on record compares the solver with and without a harness |
| Scored set (`--target`) | 24 | 12 until supply allows more | No campaign has yet scored a task |
| Solves per side (`--solves`) | 3 | 2 | At equal cost, more tasks detect more than more solves |
| Level (`--level`) | 0.10 | Keep | For one comparison the real false-positive rate is 2% to 10%, depending on the number of untied tasks |
| Reader of fails | Referee with a probe tool, advising | Judge with a shell and the domain's engines, measured against hand labels; a person confirms check defects | 36 of 47 misses in v1 were the check's; the Referee ruled 64 of 64 a true fail with no label to compare |
| What a harness may check | No harness tool may tell the solver whether a candidate meets a rule | To decide before Phase 4; lifting the ban is proposed | The solver writes its own check unaided, the stored harness already lists the conditions a candidate fails, and a budget prices the search |
| Stop rule | Under 10 points pooled over 3 sessions | No step in 3 checkpoints | The points were a pass-rate measure |
| Dollar cap | None; a campaign cap was declined on 8 October | Agreed on 9 October: required at launch for each comparison, with a reserve per solve | Over $220 was spent on 8 October with no task scored |
| Earlier solves | Solved again every round | Keep: fresh, interleaved solves at every comparison | Reuse needs `src` and `vendor` unchanged for a whole campaign, and one frozen draw of old solves would bias every later checkpoint |
| Builder context | A fresh conversation in every session | One conversation across sessions, kept by compaction, with a notes file as fallback | v1 worked this way; a fresh session loses what earlier sessions learned and tried |
| Practice traces | A list bound to the session's starting harness | One growing list of failed practice solves across all sessions; any practice trace can be opened | v1 hid failed traces, and a genuine fail led to a harness change once in six chances |

## Statistical power and cost

A comparison with 12 untied tasks has about 65% statistical power when the new harness truly wins three tasks in four. A comparison of 12 tasks has fewer untied ones, because with 2 solves per side at least three tasks in eight tie by chance. If the reference harness gives a valid answer half the time and the new harness three times in four, 12 tasks give 51% power and 24 tasks give 80%. Small comparisons can therefore detect only large effects, which is why Phase 5 compares once after several Builder sessions.

| Untied tasks (sample size) | Wins needed for a step | Power at a 65% true win rate | Power at 75% | Power at 85% |
| --- | --- | --- | --- | --- |
| 8 | 7 | 17% | 37% | 66% |
| 12 | 9 | 35% | 65% | 91% |
| 16 | 12 | 29% | 63% | 92% |
| 24 | 16 | 53% | 88% | 99% |

How to read the table:

- **Effect size** is the true share of untied tasks that the new harness wins. A share of 50% means the two harnesses are equal.
- **Power** is the probability that a comparison detects an effect of that size and reports a step. The figures are exact for the sign test at a significance level of 0.10.
- **The table counts untied tasks, and a comparison runs more tasks than that.** With 2 solves per side, a task ties whenever both harnesses give the same number of valid answers. Without a real difference this happens for 38% of tasks when a solve is valid half the time, for 51% at four times in five, and for 69% at nine in ten. The budget is therefore set where the reference harness is valid about half the time. These figures assume that every task has the same chance of a valid answer, which real tasks do not.
- **The false-positive rate** is the probability of a step when the harnesses are in fact equal. For the four rows above it is 3.5% to 7.6%. Over all untied counts from 4 to 24 it ranges from 1.6% to 9.5%.
- **Several checkpoints raise it.** One comparison of equal harnesses on 12 tasks reads a step about 5% of the time, and three in a row about 14%.
- **Sixteen tasks give no more power than twelve** because the number of wins needed moves in whole steps.
- **Ties carry no information.** The share of tasks that end untied is therefore the main quantity Phase 0, G2 and Phase 4 have to measure.

Costs are estimates at $7 per solve. Live truss solves were billed between $3.29 and $8.15, and the five rejected ones, which ran longest, averaged $6.91 (PR #52). A shorter budget lowers the cost per solve, which Phase 0 and G2 measure. A Builder session is counted with up to 24 practice solves.

| Phase | Paid work | Estimate |
| --- | --- | --- |
| 0 | 32 solves under today's limits: 8 tasks, 2 per arm, the bare solver and the existing harness | $250 to $350 |
| 1 | Judge rulings on the stored rejections; the Referee's reading of 64 cost $25.14 | Under $50 |
| 2 | 48 solves at the fixed budget: 8 tasks, with 2 solves under the baseline and 4 under the reference harness | $200 to $350 |
| 3 | Only if needed: Examiner sessions for tasks under the new contract, and one comparison of 48 solves | $350 to $450 |
| 4 | 48 scoring solves and one Builder session | $400 to $600 |
| 5 | Per checkpoint: three Builder sessions and 48 solves, plus 24 baseline solves when a step is read. Up to three checkpoints | $850 to $1,050 each |

For comparison, one round at today's defaults is about 430 solves, close to $3,000. Removing screening and the anchor is what brings a scored round under $600. An Examiner session also becomes cheap once it no longer pays for solves by a stronger model: its own turns cost $2.01 of the $48.45 in the second session.

## What we will not do, and why

Nineteen ideas are deliberately left out. Most were tried in v1, and each row gives the result that speaks against the idea.

| We will not | Why |
| --- | --- |
| Build an agent that finds the answers | Such an agent would be the same model with a shell, which is what the solver already is, so it would find nothing the solver cannot. v1's `claude/answer-builder` branch, a second author for the correctness model, was never run, so no result speaks for it. |
| Keep reference answers | A design task has many valid answers, so a single reference is not meaningful. The checks verify the required properties, and the best-known value gives a reference point. |
| Use a value the answer reports as the metric | The Builder writes the tool that reports it. The host computes the objective from the answer. |
| Make tasks hard by building them around a chosen answer | v1 tried this with six tasks sized beyond greedy and local search. The solver passed all six in under 26 minutes. |
| Set limits with a stronger solver or a longer search | v1 reset six limits from searches of up to 3.4 hours, and the solver passed 5 of 6. A Builder at higher effort than the solver gave 6 of 6, twice. |
| Let a Judge pick the better of two answers by impression | A model tends to prefer the more convincing answer, and the Builder would learn to optimise for that preference. v1 did not allow two answers in one Judge prompt. |
| Add a second Judge for pairwise comparison | Measured values are compared in code. Where nothing is measured, the one Judge assesses each answer separately. |
| Have the Judge build its own tools | A shell and the installed engines are enough to recompute a rule. Building tools is the Builder's task. |
| Let a Judge overrule passes | v1's passes were reliable: its Judge overturned 5 of 1,411. |
| Keep screening and the anchor | Both exist to select tasks by pass or fail. The pairwise comparison uses every held-out task. |
| Give the Examiner a target pass rate or a difficulty band | v1 steered its author with a band and changed that feedback first, and it did not make tasks harder. The Examiner is told each task's outcome and no target. |
| Score individual tools, or build other attribution machinery | The parts of a harness interact, and an ablation study costs as much as a full round. |
| Run a full-size comparison after every Builder session | At today's defaults a round costs about $3,000, and the gain from a single session is usually too small to detect. |
| Reuse earlier solves of the reference harness or the baseline | The recorded condition includes a digest of `src` and `vendor`, which change between checkpoints, and one frozen draw of old solves would bias every later comparison. |
| Enlarge a probe by asking for more tasks at once | In v1 the added tasks passed in 10 of 13 cases. |
| Let the Builder write tasks or checks | In v1 a harness passed 75 of 75 tasks its own Builder wrote, and 2 of 23 hard tasks from a shared set under another solver. |
| Add more review lanes, launch commands or log readers before Phase 4 | Principle 8: no live result has shown a need for them. |
| Summarise failed traces into an issue list before the Builder sees them | The failed traces are appended and shown as they are. v1 consolidated them into at most six issues, and a genuine fail still led to a harness change only about once in six chances. |
| Take the shell away from the solver, so that it cannot check its own candidate | All computation would then pass through harness tools, which makes any harness look better than none, and the check would move into a harness tool. It also reverses the operator's decision of 14 September that every harness gives the solver a shell. A compute budget prices the search instead. |

## Decisions for the operator

Eleven choices are yours. The last two hold no phase.

- [ ] **The first experiment.** Whether Phase 0's experiment runs before anything else is built, and which eight stored tasks it uses. Also what follows if the harness makes no difference: a cheaper solver or another domain. Holds Phase 0.
- [x] **Dollar cap.** Agreed on 9 October: a cap for each comparison, which replaces the decision of 8 October against a campaign cap. Still open: the amount per phase. The upper estimate of each phase plus a quarter is proposed.
- [ ] **Owner of the correctness model.** Who may repair a check and regenerate the controls, under the plan's decisions 38 and 47. Holds Phase 1.
- [ ] **The Judge's bar.** The share of hand-labelled check defects the Judge must catch, and the share of true fails it may void, both fixed before it reads a labelled rejection. The tool's defaults are 20 labelled rejections, three in four check defects caught, and at most one in ten true fails voided. Holds Phase 1.
- [ ] **The compute budget.** Its unit and its size, chosen from Phase 0. Turns and CPU seconds are proposed as units, at the size where the reference harness is valid on about half the tasks. Also that a task whose solves end at the limit is scored, which settles decision 21 of the existing plan. Holds Phase 2.
- [ ] **Removing gate 2 and the per-task reject controls.** The Examiner writes its controls from the stronger solve's answer today. Moving the controls to the single acceptance reading of the check program is proposed. Holds Phase 2.
- [ ] **The objective.** Needed only if Phase 3 is built: which quantity each domain's tasks state as their objective, with no hard limit on that quantity, and whether time and cost may break a tie. Reporting them only is proposed. Holds Phase 3.
- [ ] **The margin.** Also only for Phase 3: how much better an objective must be to win a pair while the noise is unmeasured. 1% is proposed. Holds Phase 3.
- [ ] **What a harness may check.** The Builder's prompt forbids any harness tool that tells the solver whether a candidate meets a rule, which was v1's answer of 7 October (`src/builder/prompt.ts`). A solver does this unaided: v1 recorded that the solver wrote a search and ran it until the checks cleared, and the stored truss harness already has a tool that lists the geometry conditions a candidate does not meet. v1's reason for the ban was that its Builder had written the checks, which is not the case here, and a fixed budget prices the search. Proposed: lift the ban from the first Builder session, and keep the ban on a tool that returns a finished answer. Holds Phase 4.
- [ ] **The stack.** Whether the 37 open pull requests merge before Phase 1's changes are stacked on them.
- [ ] **The plan of record.** Whether this amends or replaces "Anabasis: one plan", and whether the plan moves into the repository, where it is absent today.

## Risks

The largest risk is that a harness makes no measurable difference for this solver. Phase 0 tests that first, for about $300.

- **No effect to measure.** The bare solver may do as well as the existing harness at every budget. v1's record points that way for most tasks: the solver wrote its own search and passed, and twelve firmware tasks passed faster with the simulator withheld. The plan then stops at G0.
- **A noisy budget.** The turns or seconds a solve needs may vary so much between repeats that a fixed budget splits two solves of one harness at random. Phase 0 measures that spread, and the A/A comparison at G2 shows it as a tie share.
- **Phase 0 is read without a Judge.** A difference in validity between the two arms could come from faulty checks, which caused most rejections in v1. Its rejections are therefore labelled by hand. Time, cost and mass do not depend on the checks.
- **Too few untied tasks.** Ties and tasks without a valid answer shrink the test. Recorded supply is poor: 14 of 25 and then 5 of 7 Examiner tasks had no passing solve. G2 reports both shares, and Phase 4 is sized from them.
- **A Judge with the solver's blind spots.** It is the same class of model, and it reads the check program before it recomputes, so it may repeat a check's error. Its rulings are measured against hand labels before they count.
- **An Examiner that learns noise.** An Examiner told "one harness won" can reach that outcome with tasks whose solves vary widely in what they need. Such tasks split evenly and add nothing. The tie share of the A/A comparison and the split of wins are watched for it.
- **An objective that can be gamed.** This applies if Phase 3 is built. A harness may gain on the objective by giving up margin elsewhere. The checks stay the floor, and the host computes the objective, so a harness cannot gain by reporting a better number.
- **A leak through the network.** Harness tools the Builder wrote run inside held-out solves, and a solve's shell has outbound network access (`src/solve/shell.ts`). The file wall closes the way back and the network does not. Closing outbound access for harness tools would rule this out.
- **Regressions between checkpoints.** Several sessions of work can be lost at one comparison without a step. Kept harness versions limit the loss to a return to an earlier one.
- **Cost estimates.** They rest on a few observed figures: the billed truss solves and the cost of one Examiner session.
- **Context lost at compaction.** A long conversation is compacted many times, and detail drops out each time. The standing facts are given again after each compaction, and the notes file holds what the Builder chose to keep. The single conversation rests on v1's design and on no v2 result. If it does not help, sessions go back to opening fresh with the notes and the list.

## Sources

- **v2**, `s-smits/anabasis-v2` at PR [#54](https://github.com/s-smits/anabasis-v2/pull/54), commit `df3935a`: `src/kernel`, `src/builder`, `src/examiner`, `src/review`, `tools/d2`, `docs/transfer.md`, and the whole-run investigation's `from-v1.md` and `lanes.md`.
- **v2 pull requests** read for their recorded results: [#16](https://github.com/s-smits/anabasis-v2/pull/16) (dollar cap), [#45](https://github.com/s-smits/anabasis-v2/pull/45) (rehearsals), [#47](https://github.com/s-smits/anabasis-v2/pull/47) (launch notes), [#48](https://github.com/s-smits/anabasis-v2/pull/48) (settling by hand), [#52](https://github.com/s-smits/anabasis-v2/pull/52) (second Examiner session), [#53](https://github.com/s-smits/anabasis-v2/pull/53) (provider retries).
- **v1**, `s-smits/harness-builder-v4` at commit `0d0fae6`: `AGENTS.md`, `src/run/battery-sizing.ts`, `src/run/climb-readout.ts`, `src/run/climb-readout-frame.ts`, `src/critic/policy.ts` and the starter pack's `difficulty-ladder.md`. The commit the ledger cites, `7af7315`, could not be fetched.
- **v1's public repository**, [s-smits/anabasis](https://github.com/s-smits/anabasis) at commit `3f93d06`: `AGENTS.md`, "Open gaps: the four blockers to a climb", for the chosen-answer and long-search results and the note on `claude/answer-builder`.
- **The operator's account of v1's notes**, 8 October 2026, drawn from `notes/binding-constraints.md`, `notes/climb-blockers-20261001.md`, `notes/climb-review-20261002.md` and `notes/wri-20261007`. These files were not read for this plan.
- **Detection figures:** an exact calculation for the sign test, made for this plan on 8 October 2026.

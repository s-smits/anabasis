# Anabasis v2: the plan

This file keeps the present only: the four factors with their recorded values, the rows still
open with their level, the tuning that stands, and the decisions waiting for the operator. The
plan as it stood until 20 October (revision 414 of "Anabasis: one plan", with the repository's
notes to that day), its history and the simplification plan of 11 October were removed that day,
and are read with `git show 7f0add79:docs/plan.md` (`plan-history.md`, `simplify.md`). A comment
that cites a row, a phase or a section of `7f0add79:docs/plan.md` means that text. Its 26 refusals
under "What we will not do" all still stand.

A row's level uses the ladder of `AGENTS.md`, section 9. A pull request that moves a row changes
its level here, and nowhere else.

## Goal and the four factors

What each factor is, how it is measured and its bar are `AGENTS.md`'s ("The four reported
factors"). The values below are read from the fresh campaigns' logs on the operator's Mac at
20 October, 22:00; the two runners' logs are not counted.

| # | Factor | Now | Bar |
| --- | --- | --- | --- |
| S | Supply | Fresh buffer campaigns hold out tasks after each promotion: r3's Examiner proved 89 author answers (`task.feasible`) over 5 epochs | At least 4 informative tasks before each comparison |
| M1 | Climb | One campaign with five promotions (buffer r3, 14 comparisons). Six with one each (five buffer, one esp32). Truss: none in 3 | 6 confirmed in one real campaign, observed, no quota; then a second domain (operator, 25 October; 12 until then) |
| M2 | Honesty | 0 A/A steps in 31 A/A readings across those campaigns; the count that could have read one at 0.02 is in the PR | 0 in the ten controls after the six on record |
| M3 | Verdicts | 0 hand labels. r3: 5 Referee rulings in 14 comparisons | 30 labels; 3 in 4 defects caught, at most 1 in 10 earned voided |
| W | Economy | r3: $401 billed for 5 promotions, 25 active hours | At most 3 promotion attempts an epoch, reported |

## Open rows

| Row | What stands open | Level | What moves it |
| --- | --- | --- | --- |
| F21 to F25 | The Referee is unmeasured: no packet has been labelled | Exercised live (the draws and packets) | A person labels a packet (`settle.ts`) |
| F24 | The Referee has no shell and reads the check program first | Planned | A labelled packet that shows the probe misses defects |
| F20 | A Builder keeping its facts across a compaction | Planned | r3 compacted once (`build.compacted`); read whether its next turns used the restated facts |
| F30 | The checker's identity in every task version | Planned | |
| F32 | No field engine behind buffer's or recode's checks; every drafted exam stands on `--admit-authored` | Planned | A domain whose exam names an installed engine |
| F60 | Whether the Examiner's family counts help | Present in source, proved without a model | An ablation, or a read of drafts refused before and after |
| F61 | The room floor (`ROOM`, 1%, one constant), one judgement of what improvement counts: two answers closer than it tie in a pair, and a task an answer on record betters by less leaves no room. r6's g-2 would read 3-3-18 where it promoted on 23-0-1. Replayed on r6, it moves all 24 of the first promotion's tasks off the frontier, so the Examiner is asked for a whole comparison's tasks instead of 4 | Proved without a model, replayed | A fresh campaign's drafts held, frontier and comparisons after its first promotion |
| F62 | The Examiner told each task's winner (`exam-results`; the objective margin was withdrawn on 21 October), the gate's gap on later lines, and `read_opening` | Proved without a model | Drafts held and refused after a promotion, against r6's; an ablation with `exam-results off` |
| B6 | The investigation's reader still reads its own copy of the campaign | Planned | |
| H1 | The Seatbelt half of the per-seat `TMPDIR` | Proved without a model (Linux half) | A wall test on macOS |
| C6 | A side reading of the newest candidate against the previous one (`regressionOf`) | Withdrawn, 21 October: it was in source and decided nothing, and a loss on the reference's answered tasks already counts in the step's one test through the retained tasks | |
| C8 | Restart from the reference | Planned | |
| L2 | A second domain | Planned | M1's milestone in buffer, then the operator names the domain |
| F34 | The size policy runs in no script, CI job or hook | Present in source | The operator's word on running it in the gate |
| Builder-led | The single conversation's value | Proved without a model | A matched ablation with `--no-builder-led` |
| X1 | Whether a harness built without a benchmark's tasks or grades scores higher on it than pi's starter (WorkBuddy-Bench Code), then how it stands against Harness² (`studies/harness2/README.md`) | Present in source (`studies/harness2/run.ts`); WorkBuddy's dry run resolves its job, no container has run it | The operator's word on WorkBuddy-Bench's licence, then `run.ts check` of the starter in WorkBuddy's container and the domain fit, without a model; then the operator's word for the paid arms |
| X2 | Whether buffer v065-a's later promotions carry over to fresh tasks selected against a third harness of its chain, or are patches against tasks chosen to beat the reference (`studies/transitivity/README.md`) | Exercised live: arms A and B ran at `87f0b07e`, P-A and P-B held, arm C not run ($46.32; `studies/runs/transitivity/`) | A second reading of f-1's pair on fresh solves, before the carry-over is claimed without qualification |

Moved on 20 October by r3's log (`buffer-fresh-opus-forkedPR223_v0_5_4-r3`, commit `0b04d709`):

| Row | Was | Now | Event |
| --- | --- | --- | --- |
| F29 | Proved without a model | Exercised live | `contract.frozen` and five `harness.promoted` written by the campaign command, no operator word |
| F49 | Proved without a model | Exercised live | one total in `campaign.opened`, every move capped from it |
| F53, F57 | Present in source | Exercised live | `exam.drafted` from the operator's prompt |
| B13, B14 | Proved without a model | Exercised live | promotions two to five, each on tasks written after the one before |

### The improvement plan of 20 October

On `claude/plan-improve`, each commit proved without a model and replayed over the recorded logs:

| Row | Change | Level |
| --- | --- | --- |
| D2 | A led Builder's practice bounded by the budget's reserve alone | Proved without a model |
| D1 | Practice drawn from every task the reference left unfailed, all-valid ones among them | Proved without a model |
| B1 | The opening no longer refuses on a summed rate (`FALSE_CAP` withdrawn) | Proved without a model |
| B2 | Only the A/A controls that could read a step are counted; the others reported apart | Proved without a model |
| B3 | Frontier and retained tasks read in one sign-flip test (`REGRESSION`, `regressed` withdrawn); 57 of 58 real readings unchanged | Proved without a model |
| F1 | The affordability forecast removed from the table and the compare tool | Proved without a model |
| F2 | An A/A step is a reading, ending nothing (`control`, `--cause` withdrawn) | Proved without a model |
| C1 | The median objective gain on won frontier tasks, reported | Withdrawn, 21 October: it decided nothing, and the score's objective points now give a gain's size |
| A2 | A pass a person labels wrong counts as its side's fail, through one owner (`wrongAsFailed`) | Proved without a model |
| G1 | Checked, no change: a control's tally reaches the Builder as a tally, which section 1's closed list allows | n/a |

## Tuning

| Setting | Stands | Open |
| --- | --- | --- |
| Level | 0.02, one step promotes (since 19 October) | |
| Scored set, solves | 24 tasks, 4 solves a side | |
| Score | Validity 0.6, the objective 0.3 from the room floor (1%) to a tenth better, the bill 0.1 from a fifth less to half; constants of the host | Whether 60/30/10 is the right trade |
| Solve budget | 20 model turns, 30 minutes | |
| Network in a solve | Open in every solve, both harnesses alike | A registry-only proxy, once a trace shows a fetch from anywhere else |
| Reader of fails | The Referee with probes; labels override | F24 |

## Decisions for the operator

- **Labels.** Label one packet; M3 cannot move otherwise.
- **The network.** Keep it open, or add the proxy.
- **The size policy.** Run it in the gate (F34), or leave it by hand.
- **The second domain.** Which, and when (L2).

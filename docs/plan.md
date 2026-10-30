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
factors"). The values below are recounted on 30 October 2026, 22:00 UTC+01:00, from every
campaign log on the three machines (152 campaigns, `promotion-tuner/scripts/table.ts --rows runs`),
unless a row names another reading.

| # | Factor | Now | Bar |
| --- | --- | --- | --- |
| S | Supply | Fresh buffer campaigns hold out tasks after each promotion: on 20 October r3's Examiner proved 89 author answers (`task.feasible`) over 5 epochs | At least 4 informative tasks before each comparison |
| M1 | Climb | Four fresh buffer campaigns reached six or more promotions, each at one commit: v065-a 7, r3 6, forkedPR377 6, forkedPR506 6. Whether any counts as six *confirmed* is unread: no source symbol defines the word. Elsewhere at most job 3, esp32 2, recode 2, truss 1 | 6 confirmed in one real campaign, observed, no quota; then a second domain (operator, 25 October; 12 until then) |
| M2 | Honesty | 1 A/A step in the 111 A/A readings able to read one (buffer forkedPR294, v0.6.1); 0 in the four campaigns above (0 of 7, 6, 6 and 2). The bar's ten controls after the sixth promotion are unmeasured, since the release cycle stops a run at six | 0 in the ten controls after the six on record |
| M3 | Verdicts | 0 hand labels: no `pass.labelled` or `diagnosis.labelled` event in any log on this machine or its archive, and no packet labelled | 30 labels; 3 in 4 defects caught, at most 1 in 10 earned voided |
| W | Economy | r3: $401 billed for 5 promotions, 25 active hours. All fresh campaigns at 29 October: $8,060 for 92 promotions, $87.61 each; none ended on its budget ("Where the dollars went") | At most 3 promotion attempts an epoch, reported |

### Where the dollars went, 29 October

Read from the log of every fresh campaign on the three machines at 29 October, 23:42 UTC: 116
campaigns and 727,548 events, seeds left out. Dollars are each turn's calculated list price, as the
budget counts them, with unfinished work and compaction included. A second reading over the 80
campaigns that billed at least $5 gave the exam side 53.3% of $8,019.82, against 52.7% here.

| Work | Dollars | Share | A held task | A promotion |
| --- | ---: | ---: | ---: | ---: |
| The Examiner writing tasks | 2,468.85 | 30.6% | 0.96 | 26.84 |
| The Examiner drafting the exam | 160.45 | 2.0% | 0.06 | 1.74 |
| Room solves of drafts | 1,617.83 | 20.1% | 0.63 | 17.59 |
| Comparison solves | 2,889.45 | 35.8% | 1.12 | 31.41 |
| The Builder and its practice | 800.09 | 9.9% | 0.31 | 8.70 |
| The Referee | 123.61 | 1.5% | 0.05 | 1.34 |
| Total | 8,060.28 | | 3.13 | 87.61 |

The unit columns divide by 2,573 held tasks and 92 promotions in 36 campaigns, so they carry the
campaigns that never promoted.

- **Supply is the larger half, spent as designed.** What it buys depends on the domain: buffer
  pays $1.19 of exam-side dollars a held task and $31.59 a promotion (65 campaigns, 78
  promotions), ESP32 $4.37 and $205.57 (18, 4), job $4.43 and $98.45 (10, 5), recode $2.36 and
  $83.68 (9, 2), truss $2.25 and $100.39 (13, 3).
- **Refused drafts take half of the room solves.** Of 4,153 settled proposals 2,241 were held and
  1,912 refused; the room solves of refused drafts billed $826.53 of $1,563.98 (52.8%). The refusal
  keeps a task the reference already closes out of every later comparison. At worst, one ESP32
  session put 36 drafts to 108 room solves, all valid within eight turns, and held none.
- **A long session costs little more a turn.** Over the 291 writing sessions of at least 40 turns,
  the context grew from 27,085 to 141,213 tokens a turn between the first ten turns and the last
  ten, and the bill from $0.058 to $0.076 a turn. Output is 42.5% of the writing sessions'
  subcosts, cache reads and writes 55.6%, and compaction billed $9.38.
- **A quarter of the exam side reached no comparison.** 67 of 116 campaigns had no comparison
  report at the reading, and their exam side billed $1,051.01 of $4,247.14 (24.7%). Until
  `f0f3841cc` the host asked for a comparison's target of 24 held tasks before the first
  comparison; it now asks for the admission floor, 8 at the default level.
- **Dollars do not bind.** Of 53 `campaign.ended` events, 47 were `environment`, 4 `exam`, 1
  `operator`, 1 `no-room` and none `budget`. Hours and logins bind instead: Examiner sessions are
  49% of the campaigns' wall hours.
- **One defect, fixed 30 October.** The Examiner's `finish` was declined with a request for more
  tasks after every proposal slot was used: 6 of 206 declined finishes, 20 turns and $0.92. Since
  then `declined` reads `spent` (`src/examiner/write.ts`), so `finish` at a spent allowance ends
  the session.

Not settled: whether shorter writing sessions, or a cheaper Examiner model or effort, buy the same
supply for less. Each needs paired Examiner seats from one recorded position under equal time and
proposal allowances, read on exam-side dollars a task that stays informative.

### Solves a side, 29 and 30 October

Two retrospective replays, without a model, of comparisons that ran four solves a side, read by
the tree's own readers with only the first k solves of each side kept. They measure how the readers
respond to fewer solves on a fixed history; a live campaign would solve its non-results again and
take other moves, so neither is a measured climb.

The first redrew each of 193 comparisons of campaigns opened since 21 October 64 times, keeping a
random consecutive block of k mirrored slots per task, and read each draw by the step rule. "Kept"
is agreement with the reading at four, itself one draw:

| Solves a side | Of 100 steps at four, read as a step | Of 93 non-steps at four, read as a step | Comparison solves | A/A comparison |
| --- | ---: | ---: | ---: | --- |
| 1 | 86.3% | 0.6% | a quarter | none: it needs two reference solves of a task |
| 2 | 95.3% | 1.2% | a half | the first solve against the second |
| 3 | 98.6% | 0.9% | three quarters | halves |

A single reading at two keeps about 55% of the validity room four show, since a task the
reference answers sometimes more often reads every or none valid.

The second replayed 61 whole campaigns (198 comparisons) with `poolOf`, `roomOf` and `decide`,
four against two, with the easy rule at two readings (`RUNS.easy`) and, in memory, at one:

| Over the 198 readings | Four | Two, easy after two readings | Two, easy after one |
| --- | ---: | ---: | ---: |
| Frontier task-readings (summed after each reading) | 4,090 | 4,053 | 2,685 |
| Readings with no room | 5 | 10 | |
| Comparisons newly below the admission floor | | 0 | 8, at the e2c3df42a rules |
| Campaigns ended earlier by supply patience | | 0 | 0 |

So the two-reading easy rule is what keeps supply whole at two solves. Comparison solves billed
35.8% of the fleet's dollars ("Where the dollars went"), so two saves about 18% of a campaign's
dollars against four, and one would save about 9% more, at a seventh of the steps, the A/A
comparison and every task the reference answers only sometimes.

## Open rows

| Row | What stands open | Level | What moves it |
| --- | --- | --- | --- |
| F21 to F25 | The Referee is unmeasured: no packet has been labelled | Exercised live (the draws and packets) | A person labels a packet (`settle.ts`) |
| F24 | The Referee has no shell and reads the check program first | Planned | A labelled packet that shows the probe misses defects |
| F20 | A Builder keeping its facts across a compaction | Planned | r3 compacted once (`build.compacted`); read whether its next turns used the restated facts |
| F30 | The checker's identity in every task version | Planned | |
| F32 | No field engine behind buffer's or recode's checks; every drafted exam stands on `--admit-authored` | Planned | A domain whose exam names an installed engine |
| F60 | Whether a line a task, with turns, the winning measure and one measured line, helps the Examiner more than the family counts it replaced | Proved without a model | The before-and-after Examiner seat over one seed: held drafts with validity room, and drafts held |
| F61 | The room floor (`ROOM`, 1%, one constant), one judgement of what improvement counts: two answers closer than it tie in a pair, and a task an answer on record betters by less leaves no room. r6's g-2 would read 3-3-18 where it promoted on 23-0-1. Replayed on r6, it moves all 24 of the first promotion's tasks off the frontier, so the Examiner is asked for a whole comparison's tasks instead of 4 | Proved without a model, replayed | A fresh campaign's drafts held, frontier and comparisons after its first promotion |
| F62 | The Examiner told each task's winner (the objective margin was withdrawn on 21 October; the switch that hid it was removed on 28 October), the gate's gap on later lines, and `read_opening` | Proved without a model | Drafts held and refused after a promotion, against r6's |
| B6 | The investigation's reader still reads its own copy of the campaign | Planned | |
| H1 | The Seatbelt half of the per-seat `TMPDIR` | Proved without a model (Linux half) | A wall test on macOS |
| C8 | Restart from the reference | Planned | |
| L2 | A second domain | Planned | M1's milestone in buffer read as confirmed, then the operator names the domain |
| F34 | The size policy runs in no script, CI job or hook | Present in source | The operator's word on running it in the gate |
| Builder-led | The single conversation's value | Proved without a model | A matched ablation with `--no-builder-led` |
| X1 | Whether a harness built without a benchmark's tasks or grades scores higher on it than pi's starter (WorkBuddy-Bench Code), then how it stands against Harness² (`studies/harness2/README.md`) | Present in source (`studies/harness2/run.ts`); WorkBuddy's dry run resolves its job, no container has run it | The operator's word on WorkBuddy-Bench's licence, then `run.ts check` of the starter in WorkBuddy's container and the domain fit, without a model; then the operator's word for the paid arms |
| X2 | Whether buffer v065-a's later promotions carry over to fresh tasks selected against a third harness of its chain, or are patches against tasks chosen to beat the reference (`studies/transitivity/README.md`) | Exercised live: arms A and B ran at `87f0b07e`, P-A and P-B held, arm C not run ($46.32; `studies/runs/transitivity/`) | A second reading of f-1's pair on fresh solves, before the carry-over is claimed without qualification |

## Tuning

| Setting | Stands | Open |
| --- | --- | --- |
| Level | 0.02, one step promotes (since 19 October) | |
| Scored set, solves | 24 tasks, 2 solves a side in every domain by default; the setting may name another count once (`--solves`, 29 October); replays in "Solves a side" | Whether two climbs faster live: no campaign at two had read a comparison on 30 October |
| Score | Validity 0.6, the objective 0.3 from the room floor (1%) to a tenth better, the bill 0.1 from a fifth less to half; constants of the host | Whether 60/30/10 is the right trade |
| Solve budget | 20 model turns, 30 minutes | |
| Network in a solve | Open in every solve, both harnesses alike | A registry-only proxy, once a trace shows a fetch from anywhere else |
| Reader of fails | The Referee with probes; labels override | F24 |

## Decisions for the operator

- **Labels.** Label one packet; M3 cannot move otherwise.
- **The network.** Keep it open, or add the proxy.
- **The size policy.** Run it in the gate (F34), or leave it by hand.
- **The second domain.** Which, and when (L2).

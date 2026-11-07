# Anabasis: the plan

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
factors"). The values below are recounted on 5 November 2026 from the records gathered in
`data/runs`, the largest copy of each campaign with rehearsals left out (209 campaigns, read through
`epochsOf`; a campaign held only in a worktree of the central host is not among them), unless a row
names another reading.

| # | Factor | Now | Row of the v1.0 bar |
| --- | --- | --- | --- |
| S | Supply | Fresh buffer campaigns hold out tasks after each promotion: on 20 October r3's Examiner proved 89 author answers (`task.feasible`) over 5 epochs | supply |
| M1 | Climb | 135 promotions in 62 campaigns, 7 confirmed (`confirmed`, read over a campaign by `barLines`, `src/campaign/climb.ts`), each in a campaign of its own: forkedPR530, forkedPR583, forkedPR592, fullrun, last and v065-b in buffer, forkedPR631 in jobstat. Four fresh buffer campaigns reached six or more promotions, each at one commit (v065-a 7, r3 6, forkedPR377 6, forkedPR506 6): 25 promotions, 3 starter comparisons tallied, none confirmed. Of the 13 epochs whose starter comparison tallied a task, the reference led in 11 and 7 cleared. 122 epochs have none, 120 of them from commits before the host owed it whatever waits; at commits that hold the owed row (`heldSince`, `src/campaign/decide.ts`) 2 of 4 promotions were read and both confirmed, and no campaign there has made a second promotion. Elsewhere at most job 3, esp32 2, recode 2, kernel 2, truss 1, jobstat 1 | climb (operator, 25 October: six, observed, no quota; 12 until then) |
| M2 | Honesty | 1 A/A step in the 128 A/A readings able to read one, of 274 read (buffer forkedPR294, v0.6.1), 3 read either way. After a sixth promotion: 2 readings, 1 able, 0 steps. The bar's ten are unmeasured: a campaign that gains nothing after its sixth reaches `stop` seven comparisons in where each leaves room, and a release cycle's cap of two ends it long before (`test/milestone-walk.test.ts`) | honesty |
| M3 | Verdicts | 0 hand labels: no `pass.labelled` or `diagnosis.labelled` event in any log, and of 12 packets drawn in 6 campaigns none is labelled. 1,030 rejections lie in comparisons (962 ruled earned, 35 check-defect, 33 unclear); the most rejections `settle.ts` would draw over one campaign's comparisons is 22, so the bar's 30 takes packets pooled across campaigns, which no reader pools yet | verdicts |
| W | Economy | r3: $401 billed for 5 promotions, 25 active hours. All fresh campaigns at 29 October: $8,060 for 92 promotions, $87.61 each ("Where the dollars went"). All 209 at 5 November: $14,165 billed for 135 promotions, none ended on its budget. Of 73 closed epochs after set-up 70 stand within the bar, and of 62 open ones 60 (`barLines`, `src/campaign/climb.ts`) | economy |

## The v1.0 bar, now

What each row requires, its threshold and the reader that prints it are the system-audit skill's
table, "The pillars and the v1.0 bar". This table holds each row's value and level only. Read on
7 November 2026 from `promotion-tuner/scripts/table.ts --rows runs` over the 222 campaigns whose
last event falls on or after 1 September, `comparison-reading/scripts/starter-reads.ts --all`, and,
for the fresh jobstat campaign at `9190fbbac` that proves v0.10.0 (live, five promotions), `bun run
runs view` and `examiner-complexity/scripts/zone.ts`. That campaign is the nearest to the climb
row's measured campaign: it opened from a prompt and every launch names one commit.

| Row | Now | Level | Status |
| --- | --- | --- | --- |
| wall | The wall tests passed on macOS and on Linux in CI at `9190fbbac` and in the gate at `220e777c3`; the proof campaign's 240 verdicts to its second promotion had 0 sandbox crashes | Proved without a model; exercised live | Met at the proof commit; read again at the release's top |
| supply | Proof campaign: 10 comparisons, 8 to 26 untied tasks each, so every one could read a step; the reference was valid in every solve of all 10, 1 task of 179 scored untied on validity, all 5 steps won on the objective alone. Record: 41 of 111 steps won by validity, 13 of 39 in runs after v0.9.0 | Exercised live | Untied tasks met; validity share not met by the proof campaign, threshold unset |
| climb | Proof campaign: 5 promotions, 1 confirmed (15 won, 6 lost, 3 tied against the starter), 3 read short of a step, 1 unread. Record: 151 promotions, 12 confirmed, at most 1 in any campaign. Of 24 starter reads 12 confirm and 5 are a step without the tasks that chose the harness; on tasks written after a promotion the reference stands 128-104-23 against the starter, and 94-101-23 where validity tied. No second domain | Exercised live | Not met: 1 of 6, first domain only |
| honesty | Proof campaign: no sixth promotion; of its 10 A/A comparisons 3 could read a step and none did, 7 were too small to read one. Record: 1 A/A step in 141 able (0.7%) | Exercised live | Unmeasured after a sixth; fleet rate within the design rate |
| verdicts | 0 hand labels in any gathered or live log | Exercised live (draws and packets) | Not met: 0 of 30 |
| grounding | No drafted exam names an installed engine (F32) | Planned | Not met |
| economy | Proof campaign: $400 for 5 promotions and 1 confirmed, 0 epochs over 3 attempts. Record, summed from the table's per-run dollars and not repriced on one meter: $16,064 for 151 promotions and 12 confirmed, about $106 and $1,339 each | Exercised live | Attempts met; no dollar target set |
| systems | No reading in any tracked record. One session's account of 28 October, truss, 12 tasks at one solve a task: the cheap solver in an unpromoted built harness valid on 11, the dear solver in the starter on 9 | An agent's account | Unmeasured |
| outside | JobBench, one built arm (`f04b0aad`) at one rollout a task: 310 of 550 against the Starter's 342 on 8 tasks; on the fair five 166 of 296, level with Harness²'s held-out arm (166) and below the Starter (192). No Starter A/A, no margin on record, and Harness²'s held-out arm is absent on the 12 tasks item 17 adds. WorkBuddy-Bench: no container has run | Exercised in a study, no reading | Unmeasured; course undecided |

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
- **The gate solves no draft since 1 November.** The gate ablation of 31 October on buffer (Opus
  5.5, one campaign an arm) promoted on its first comparison in both arms, 8 to 0 without room
  solves and 10 to 0 with them, each on the objective alone; the arm with room solves held the same
  kind of task 1.1 hours later and for about $24 of reference solves. Across the record since
  16 October, 5,664 of 6,225 gate readings with room solves had the reference valid on every solve.
  So the room solves were removed (`src/examiner/write.ts`): Present in source, and an indication
  from one campaign an arm, which a fresh pair of campaigns on another domain would settle.
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
| F32 | No field engine behind a drafted exam's checks, since nothing installs one for a campaign (`src/examiner/draft.ts`), and each stands on its author's computation, admitted by `--admit-authored` or by name. 17 stored exams opened up to 15 October name phreeqc or RNAfold on 69 checks, none on all its checks; 0 of their 6 promotions is confirmed | Planned for a drafted exam | A domain whose exam names an installed engine |
| F60 | Whether a line a task, with turns, the winning measure and one measured line, helps the Examiner more than the family counts it replaced | Proved without a model | The before-and-after Examiner seat over one seed: held drafts with validity room, and drafts held |
| F61 | The room floor (`ROOM`, 1%, one constant), one judgement of what improvement counts: two answers closer than it tie in a pair, and a task an answer on record betters by less leaves no room. r6's g-2 would read 3-3-18 where it promoted on 23-0-1. Replayed on r6, it moves all 24 of the first promotion's tasks off the frontier, so the Examiner is asked for a whole comparison's tasks instead of 4. Over 47 buffer and kernel comparisons to 31 October, 508 of 1,027 task readings tie without the bill: 254 identical answers and 248 closer than the floor. A floor of 0.5% would add 2 steps (buffer-r2 g-1, forkedPR530 g-2) and no A/A step (one research session's replay, not moving admission; not yet checked here) | Proved without a model, replayed | A fresh campaign's drafts held, frontier and comparisons after its first promotion |
| F62 | The Examiner told each task's winner (the objective margin was withdrawn on 21 October; the switch that hid it was removed on 28 October), the gate's gap on later lines, and `read_opening` | Proved without a model | Drafts held and refused after a promotion, against r6's |
| B6 | The investigation's reader still reads its own copy of the campaign | Planned | |
| F63 | One pair drawn again unchanged until it reads a step. kernel-cyber2 (31 October) compared `756d142d` with its reference four times with no checkpoint between (g-2 to g-5, the table's `unread` row from g-3), and g-5 read a step and promoted on the fourth draw. Improvement patience counts one pair once (`stopRule`), and supply patience counts each draw that left room as a gain (`roomless`), so neither stops it | Exercised live | The operator's word on a bound for redraws of one pair, then a synthetic log of K redraws in `test/decide.test.ts` |
| F64 | Practice owed after an Examiner session that held nothing. buffer-stackedPR534 released 5 tasks 13 minutes after x-2 ended holding 0, all tasks its new reference answers within 0.4% of the best on record, which used the reading's allowance before x-3 held 17 with room (`practiceDue`, `releaseOwed`) | Exercised live, one campaign | A synthetic log of that shape, then a fresh campaign's practice after its first promotion |
| F65 | The Examiner's gate refuses a draft on the reserve while solves are in flight (`measured`, `src/examiner/write.ts`), where the solve queue waits on the same condition (`tools/d2/host.ts`). kernel-cyber2: 26 refusals, each with 4 solves in flight, on a $50 budget at the default $10 reserve with about $4 spent | Withdrawn (1 November): the gate solves no draft, so it holds no reserve and the solve queue is the one owner of the wait | |
| F66 | The exam stays easy. kernel-cyber2 (31 October) graded every scored task 3 or below of 7 on lane 34's reach scale, and esp32-fresh-opus's reference answered all 3 solves of 76 of 81 drafts. Both of the Examiner's modes are now shown that scale with worked examples from three fields no campaign examines (`src/examiner/ladder.ts`), and a drafted rule names its standard instead of restating it. The first ladder's paired esp32 arm held 1 of 89 session drafts against the control's 17 of 80, every refusal of both at the ceiling (`examiner-complexity`, `exams.ts`) | Exercised live; supply fell on the one paired reading | The rewritten ladder's held share and first comparison against a control on fresh campaigns in two domains, then blind grades of their held tasks |
| C8 | Restart from the reference | Planned | |
| L2 | A second domain | Planned | The climb row met in the first domain, then the operator names the second |
| F34 | The size policy runs in no script, CI job or hook | Present in source | The operator's word on running it in the gate |
| Builder-led | The single conversation's value | Proved without a model | A matched ablation against a host that makes every move, which the campaign command no longer offers (removed 3 November) |
| X1 | Whether a harness built without a benchmark's tasks or grades scores higher on it than pi's starter (WorkBuddy-Bench Code), then how it stands against Harness² (`studies/harness2/README.md`) | Present in source (`studies/harness2/run.ts`); WorkBuddy's dry run resolves its job, no container has run it. The operator's later course, a JobBench parity test on 20 tasks of 65, is `docs/backlog/jobbench-scoring.md`; which course the outside row counts is the operator's (`docs/backlog/v1-bar.md`) | The operator's word on WorkBuddy-Bench's licence, then `run.ts check` of the starter in WorkBuddy's container and the domain fit, without a model; then the operator's word for the paid arms |
| X2 | Whether buffer v065-a's later promotions carry over to fresh tasks selected against a third harness of its chain, or are patches against tasks chosen to beat the reference (`studies/transitivity/README.md`) | Exercised live: arms A and B ran at `87f0b07e`, P-A and P-B held, arm C not run ($46.32; `studies/runs/transitivity/`) | A second reading of f-1's pair on fresh solves, before the carry-over is claimed without qualification |

## Tuning

| Setting | Stands | Open |
| --- | --- | --- |
| Level | 0.02, one step promotes (since 19 October) | |
| Scored set, solves | 24 tasks, 2 solves a side in every domain by default; the setting may name another count once (`--solves`, 29 October); replays in "Solves a side" | Whether two climbs faster live: no campaign at two had read a comparison on 30 October |
| Score | Validity 0.6, the objective 0.3 by its share past the room floor (1%); constants of the host. The bill left the score on 2 November: the step had been read without it since 26 October | Whether 60/30 is the right trade |
| Solve budget | 20 model turns, 30 minutes | |
| Network in a solve | Open in every solve, both harnesses alike | A registry-only proxy, once a trace shows a fetch from anywhere else |
| Reader of fails | The Referee with probes; labels override | F24 |

## Decisions for the operator

- **The v1.0 bar's values** (`docs/backlog/v1-bar.md`). Which outside course counts, JobBench
  parity or WorkBuddy-Bench, and its margin; whether a confirmed promotion's read counts the tasks
  that chose the harness; the share of steps the supply row asks to be won on validity; whether the
  systems row is in v1.0 or after it, with its solvers and margin; any dollar target for economy;
  and the verdicts row's floor of labelled check defects.
- **Labels.** Label one packet; M3 cannot move otherwise.
- **The network.** Keep it open, or add the proxy.
- **The size policy.** Run it in the gate (F34), or leave it by hand.
- **The second domain.** Which, and when (L2).
- **Redraws of one pair.** Bound them, or keep the table's `unread` row as it is (F63).
- **esp32's supply.** Install the field's compilers as engines (F32), or accept that its drafted exam leaves this solver no room: 59 of 59 drafts refused at 3 of 3 valid on 30 October.

# The v1.0 bar, against the goals the operator has set

Status: planned. The table is in the system-audit skill ("The pillars and the v1.0 bar"), each
row's value is in `docs/plan.md` ("The v1.0 bar, now"), and this file holds the reasons and the
record behind every threshold still proposed. Every threshold is a proposal until the operator sets
it; the wording around them is not. Rewritten on 20 November 2026 from the triages of 7 and 16
November and two outside reviews of that day, each claim checked against the tree and the record.
The dated records and the history below are kept as they were written.

## The question

Are the rows a v1.0 release must meet still the ones the operator's long-term goals need, are their
thresholds set where the record says they can tell anything, and does anything print them, so that
the release cycle stays aimed at them?

## Decisions and proposals, by row

1. **One rule for when v1.0 is met** (in the tree with this rewrite). The skill said every row must
   read met, while run-improvement-campaign said a row without a threshold (the validity share, a
   dollar target, systems, outside) held nothing back, so a release could reach 1.0 with no outside
   reading at all. The skill now owns the rule and the other points at it: a row whose threshold
   is unset reads unmeasured and holds 1.0 back, so every threshold is set, and the table
   committed, before the runs that graduate v1.0 start. The operator's word overturns it.
2. **Wall: a Linux runner at the release's top (the operator's).** On 16 November nothing read
   Linux at the top: no Linux runner takes checks, and Actions last ran on `main` on 10 November.
   Which runner, or Actions at the top alone.
3. **Supply.** At least 6 untied tasks a comparison is wording, since the test fixes it: an exact
   one-sided sign-flip test over 5 tasks clears at best 1 in 32. In place of a share of steps won
   on validity, proposed: at least one of the measured campaign's steps is won on validity, and
   otherwise the release says its climb was read on the objective alone. A share cannot be asked of
   jobstat as it stands: 2 of its 37 steps were won on validity against buffer's 30 of 96, so the
   quarter a review proposed would fail every jobstat campaign on record. New, proposed: once a
   domain, the dear and the cheap solver in the Starter on the opening tasks, read by
   `compare-systems`, with the dear one ahead beyond the A/A's spread, so that an exam that cannot
   tell solvers apart is caught before a campaign climbs on it.
4. **Climb: what a confirmed promotion counts (the operator's).** Of 67 starter reads on record 33
   confirm, where sign draws over the tasks written after expect 26.1 with the selection tasks
   standing as they fell, so about four in five confirmations are what selection alone gives.
   Counting the tasks written after alone would confirm 13 of 67. Recommended: keep `confirmed` as
   the count and ask beside it that more of the six read a step for the reference on the tasks
   written after alone than for the starter (`starter-reads.ts` prints both). The threshold is weak
   on purpose: those tasks are written by an Examiner that reads the reference's outcomes, so they
   lean against it and their read is a lower bound. A review proposed three promotions confirmed on
   the tasks written after alone in place of six; item 17's transfer reading is the evidence that
   would choose between the two counts, in place of choosing one now.
5. **Climb: a budget that can hold the count (the operator's).** A budget is fixed at the launch.
   Repriced on one meter, a confirmed promotion cost 155 to 301 dollars in the five jobstat
   campaigns from v0.10.0 on that hold two or more, and 59 and 65 in the two such buffer campaigns;
   the jobstat campaign that ran to the default 800 ended there with three. Recommended: 2,000
   dollars for the measured jobstat campaign and 500 for buffer's. Under item 4's alternative, three
   confirmed on the tasks written after alone would cost more than three confirmed now, since
   fewer reads confirm that way.
6. **Climb: one campaign let go on at one commit.** The release cycle forks fresh runs at each new
   top, and a run continued at another commit does not count (`AGENTS.md`, section 10, item 9), so
   the measured campaign is a proof run left to climb after its release lands. A pause stays the
   operator's word.
7. **Climb: the second domain is a cold one (the operator's).** Recommended, in place of buffer: a
   domain no change was tuned on, opened from its prompt unedited, with buffer kept as the control
   every change is read against. Jobstat and buffer are the two domains every release cycle runs
   (`AGENTS.md`, section 10), and the changes since October were read on them, so a climb in either
   says little of a domain the system has not met. Which domain is the operator's; it needs no
   code.
8. **Honesty: a rate that can be read.** The ten A/As after a sixth promotion cannot be read as
   worded: the two campaigns that passed a sixth ran 12 A/As after it, none able to read a step and
   7 tying every task. Proposed in their place: A/A steps at most the design rate, 1.1% at 0.02,
   over at least 50 able A/As in the release's measured campaigns, read apart on comparisons that
   validity decided and those the objective alone did, with the starter against itself counting
   where a reference ties its own A/A. The fleet reads 2
   steps in 73 able (`trend.ts`; an earlier 207 reproduces from no reader). No reader splits the slices; `carriedBy` (`src/kernel/compare.ts`) names which
   measure carried each task, so the split is a column of `table.ts --rows runs`.
   Adopted on 25 November 2026 on the operator's instruction to fix the open bars, with a burden of
   proof in place of the point rate: the 95% exact upper bound on the pooled false-step rate stays at
   or under twice the level (4% at 0.02), which takes at least 74 able A/As with none stepping, 117
   with one and 156 with two; `trend.ts` (`falseSteps`) prints the bound beside every honesty count,
   and a campaign's honesty line (`climb.ts`) reports all its A/As with theirs.
   Over the fleet's 193 runs it read 2 steps in 73 able A/As, bound 8.4%, so the bar is open.
9. **Verdicts on both sides.** With 4 labelled check defects one miss fails three in four, so
   proposed at least 8 of the 30 rejections. Jobstat's candidate held no rejection in 763 finished
   solves, so the rejections come from buffer and the other domains, and a domain without them
   reports that count. New, proposed: the pass side. The row calibrated only rejections, so it
   catches a check that refuses right answers and misses one that passes wrong ones, which is how a
   gamed or vacuous check shows. The mechanism is in source: each packet draws three passes beside
   its rejections (`tools/campaign/settle.ts`), a person labels each `sound`, `wrong` or `unclear`
   (`PASS_LABELS`), and a settled pass labelled wrong is its side's fail; no bar counts those labels
   and `agreement` reads none. Proposed: at least 20 labelled passes from the measured campaigns'
   references, at most 1 in 10 wrong, the same rate as the earned side until labels give one of
   their own. Jobstat, which offers no rejection, offers passes. Labelling stays the operator's.
   The floor of 8 defects was adopted on 25 November 2026 (`LEAST_DEFECTS`, `agreement.ts`); before
   it, `clears` passed on a single labelled defect. The bar stays on the point rates, since a 95%
   exact lower bound of 3/4 would take about 11 of 11 defects caught.
10. **Grounding.** F32 stands: no drafted exam names an installed engine, since nothing installs one
    for a campaign. A review proposed an engine in every engine-capable domain; one domain is the
    row until one exists at all.
11. **Economy: what a gain costs to make and to use.** Dollars per confirmed promotion on one meter
    (`table.ts --rows cost`), and beside it what a harness costs to use, since a bloated guide
    raises dollars a solve without changing turns: cost to serve N tasks, build plus N times
    dollars a solve (`studies/harness2/README.md`, "Economy, apart from quality"), against the
    Starter's. Proposed: a reference's dollars a solve at most the Starter's beyond the spread of
    the Starter's own rollouts. Any dollar target is the operator's; a break-even cap on building
    needs the systems row's savings a task first.
12. **Systems: in v1.0 (the operator's).** Recommended now, where 16 November left it open: the
    wider aim of `AGENTS.md` section 1 is a cheap solver in a built harness matching a dear one in
    the Starter, and the operator named it "the whole point" on 27 October. Beside it, the built
    harness against `programs-of:<digest>`, which `AGENTS.md` section 9 already requires for a
    claim about which part of a harness did it. Solvers, margin and solves are the operator's.
13. **Outside: the course and the rung (the operator's).** JobBench, in the operator's order of
    `AGENTS.md` section 10: above the Starter, level with Harness²'s held-out arm, then above it;
    WorkBuddy-Bench Code after v1.0, since no container has run and its licence is open.
    Recommended for v1.0: the first rung, the measured campaign's confirmed references above a
    Starter of the same sitting by more than the Starter's spread, over six scored references, with
    the second rung reported beside it.
14. **Outside: a claim reads a set nothing has steered.** The eight tasks of the outside reads have
    been read to explain results, so they steer and cannot confirm (`jobbench-scoring.md`, item 22,
    with its two open terms). The row now says so.
15. **Outside: a one-pass author beside the Starter (the operator's).** A reference above the
    Starter shows that a built harness helps, not that the loop does: one authoring pass from the
    same query might do as well. Proposed: one session of the Builder's model writes a harness from
    the query and the Starter Pack, with no exam, practice or comparison, exported as references are
    and rolled beside the Starter, and the measured reference stands above both. It uses the
    campaign's own model and is told no answer, so rules 2 and 9 hold. It adds a baseline to
    `AGENTS.md` section 10 and is a paid seat, so both wait on the operator's word.
16. **Outside: the conditions of a read.** Three things a deficit or a gain must be read against
    before it is the harness's (`AGENTS.md`, section 10). Consistency: each arm's spread between its
    rollouts and its worst task, against the Starter's, since a harness can win on the mean with a
    wider spread. The runtime: a campaign solves under pi and the read runs an export
    (`builtsolver-outside-deficit.md`, item 6, which waited on the Starter's spread that five
    rollouts now give), so the Starter rolled once under the campaign's runtime beside its export
    gives the gap as a constant. The scope: tasks from professions outside the domain, on which a
    reference may not fall below the Starter beyond its spread. No read sets them apart yet: the
    eight mix statistics with neighbouring professions, and nothing names which lie outside the
    domain's scope.
17. **Outside: transfer along the chain.** The exam is the Examiner's own, so a campaign can climb
    on it in a direction the outside grader does not reward. Proposed: score the measured
    campaign's chain, the Starter and at least three promoted references, outside, and ask that the
    outside score not fall as the inside order rises, each difference read against the Starter's
    spread. Where it peaks early, that reading is the evidence on which the operator revisits the
    count of item 4.
18. **How a threshold is set.** Proposed, under the skill's table: the wall's tests, the A/A design
    rate and the verdict bars are invariants; every other threshold is set from a measured
    distribution or a replay over the record, and backtested so that it passes the record's best
    runs and refuses its known treadmills (`promotion-tuner`, `replay.ts`).
19. **The release notes carry the bar, and `AGENTS.md` points at it.** Each release's "Validation
    and limits" gives one line a row, read from its reader, and the plan copies them; `stack-pr`
    section 9 needs one sentence pointing at the table. `AGENTS.md` section 1 restates the
    honesty, verdicts and economy bars and the milestone; once the operator sets the values, its sentences state the
    same numbers or point at the table (rule 12). Until then it keeps the bars in force.

## Measurements owed before the thresholds freeze

Each anchors a proposed threshold above on a measured distribution; prices are from the gathered
JobBench store, where one Starter rollout of the fair uncut five cost 11.75 to 13.39 dollars of
solves and 34 to 46 of judging.

| Measurement | Anchors | Cost | Waits on |
| --- | --- | --- | --- |
| Label 30 rejections and 20 passes from recent packets | item 9 | the operator's time, no dollars | the operator |
| A one-pass author harness, rolled on the fair five | item 15 | one Builder session and 45 to 60 dollars a rollout | the operator's word for a paid seat |
| The Starter rolled under the campaign's runtime outside | item 16 | 45 to 60 dollars a rollout | an outside sitting |
| The dear and the cheap solver in the Starter on one buffer and one jobstat opening | item 3 | not costed | the operator's word for the solvers |
| A cheap solver in the best jobstat reference against the dear one in the Starter | items 11 and 12 | not costed | the operator's solvers and margin |
| One measured campaign's chain of three references scored outside | item 17 | 45 to 60 dollars a reference a rollout | a campaign with three promotions |

## Readers the bar lacks

Each is built when the record holds something for it to read (rule 13); until then the row reads
unmeasured.

- **Pooled verdicts, both sides**: `agreement` over packets of several campaigns, with pass labels.
  At the first labelled packet.
- **Honesty's two slices**: a column of `table.ts --rows runs` split by `carriedBy`. Now: the
  record holds 73 able A/As.
- **An arm's spread and worst task outside**: present in source since 20 November as
  `score.ts spread --out <store> --name <rollout,...>`, which reads the rollouts named as one arm
  over the store's fair uncut tasks that each scored; the Starter's five give 30 points of 268.
- **One chain inside and outside**: the measured campaign's references in promotion order, each
  with its outside score. When one campaign has three references scored.

## What the record shows (20 November)

Read from the gathered JobBench store (`studies/harness2/score.ts table`), the tree at the stack's
top and one investigation's lane report.

- **Outside.** At 01:05 UTC, on the five tasks the store then read as fair and uncut, the
  Starter's five whole rollouts scored 162 to 192 of 268 and four promoted jobstat references 146
  to 174, against the Starter of their own sitting -8, -4, -6 and -46. Every reference so far lies
  inside or below the Starter's spread. A read earlier that day gave 178 to 208 of 296 on another
  five, since the set moves as records reach the store; a frozen task list for the bar would
  remove that drift (item 14).
- **Cost to use.** The same references spent 9.97 to 12.20 dollars a rollout on solves, the
  Starter 11.75 to 13.39, after builds of 201 to 608 dollars.
- **Pass side.** One investigation of 19 November counted 494 passes in a jobstat campaign read by
  nobody, and found a check that passes an answer listing no correction (plausible; no constructed
  answer was graded).
- **The release rule.** Two skills disagreed on whether an unset row holds 1.0 back (item 1).

## What the reviews proposed that is not taken

- **Their numbers.** A 15-point model gap, 60%, 4 points and 250 dollars came from the reviewer's
  own graduation bar of 19 November and were never in this table. The thresholds it proposed in
  their place (a 3-point export loss, 1.25 times the Starter's cost, 5% wrong passes, 25% of steps
  won on validity, a largest family at most 40%, 300 dollars and 12 hours a harness, within 2
  points of the dear solver at a third of its cost, programs carrying half the gain, half the
  tasks running the harness's programs) are as hand-picked as those it criticised; each threshold
  above is anchored on a measured spread or an existing rate instead, or left to the operator.
- **Harness²'s JobBench gain.** The review cites 4.5 points; no record here holds that figure, and
  Harness²'s scores on record are those of `jobbench-scoring.md`.
- **Stage A and B gates on a drafted exam.** Examiner mechanisms, not bar rows; they belong to
  `examiner-complexity`. Item 3's solver read is the bar's part of the idea.
- **A canary suite of archived check defects in every release's checks.** It needs the Referee, a
  model, in each release's checks, which is paid; it waits on the first labels of item 9.
- **A cross-exam matrix of harnesses on each other's exams, and a family cap on draws.** The first
  has no reader and no run; the second is another session's open change, read by its own replay.
- **Pulling F24, F34, F63 and X2 into v1.0.** They are plan rows, not bar rows; each moves by its
  own row's evidence.

## What the record shows (7 November)

Read from `promotion-tuner/scripts/table.ts --rows runs` (222 campaigns whose last event falls on
or after 1 September), `starter-reads.ts --all`, a search of every gathered and live log for
`pass.labelled` and `diagnosis.labelled`, `runs view` and `reading.ts --zone` of the proof campaign, and
`gh release view` of v0.9.2 to v0.9.5. Counts only; the values per row are in the plan.

- **Rows that no longer matched a goal.**
  - Supply asked that every comparison be admitted on the floor of frontier tasks, which admission
    enforces by construction, so the row could not fail. The plan's bar of 4 informative tasks
    could not read a step at 0.02.
  - Outside named WorkBuddy-Bench first, while every outside reading since 3 November is JobBench
    and the operator called the Harness² comparison the most important thing on 7 November.
  - The second domain waited on "the milestone in buffer", while the operator's focus moved to
    jobstat on 4 November and the proof campaign is jobstat.
- **Goals with no row.** The wider aim of section 1, a cheap solver in a built harness matching a
  dear one in the starter, had no row, no plan row and no reading in any tracked record. No row
  named a dollar target, though the operator asked "did it reduce costs" as one of three questions.
  The release cadence had no tie to the bar: five releases in five days (v0.9.1 to v0.9.5), and
  none of the four notes read names the bar.
- **Thresholds the record shows mis-set.**
  - Honesty's ten A/A comparisons counted those too small to read a step; in the proof campaign 7
    of 10 were. The fleet holds 1 step in 141 able (0.7%).
  - The climb's confirmation includes the tasks that chose the harness: of 24 starter reads 12
    confirm and 5 are a step without them. On tasks written after a promotion the reference stands
    128-104-23 against the starter, and 94-101-23 where validity tied. Of 151 promotions on
    record 12 are confirmed, and no campaign holds more than one.
  - Supply's own gradient: the proof campaign's reference was valid in every solve of its 10
    comparisons, so all 5 of its steps were won on the objective alone. On record 41 of 111 steps
    were won by validity.
  - Verdicts: 0 labels anywhere, and packets draw every non-earned rejection with three earned, so
    the catch rate needs several packets before it can be read.
- **Rows nobody read.** The verdicts row named `d2d7b54acools/c/rejections.ts`, which reads a stored pack's
  sweep and no live campaign; no reader pools packets. The grounding row named `accept.ts`, which
  decides admission and prints no status; the closing report's "What decides a pass" line does.
  The outside row named `run.ts read`, which no run has fed. No report printed the bar whole.

## What the record shows (16 November)

Read from `table.ts --rows runs` and `--rows cost` (248 campaigns whose last event falls on or
after 1 September), `starter-reads.ts --all --since 2026-09-01`, a search of every gathered and
live log for `pass.labelled` and `diagnosis.labelled`, and `runs view` and `reading.ts --zone` of
the candidate and the buffer control. Counts only; the values per row are in the plan.

- **What moved in nine days.** 26 more campaigns and 41 more promotions (192); confirmed
  promotions went from 12 to 33, and the most in one campaign from 1 to 5 in buffer and 3 in
  jobstat. In the 26 campaigns from v0.10.0 on, 16 of 30 starter reads confirm (jobstat 14 of 22,
  buffer 2 of 7).
- **The climb row is held by the budget before it is held by the climb.** Four campaigns ended on
  their budget. The jobstat one at the present setting did so with 3 promotions, all confirmed, at
  $793 of 800; six at its price would take about 1,570 dollars. No measured campaign was launched
  with a budget that could hold six.
- **A confirmation is mostly selection.** 33 of 67 reads confirm against 26.1 expected by sign
  draws. On the tasks written after alone, 13 reads are a step for the reference and 13 a step for
  the starter; in jobstat 5 and 10, in buffer 8 and 3. The reference stands 364-322-44 on those
  tasks, and 317-304-44 where validity tied.
- **The tasks written after lean against the reference.** In the buffer control both promotions
  went unconfirmed, and all 9 of the starter's wins in the two reads lie on tasks written after the
  promotion (6-3-3 and 4-6-3), none on those chosen on (8-0-0, 11-0-0). Every writing session
  there held a copy of the reference harness, and those after a promotion ran commands naming it
  (20 of 76, 6 of 38 and 7 of 36 shell calls). One campaign; whether a writing session should hold
  that copy changes what a seat is given, and is the operator's. On 18 November the copy was
  removed in a draft pull request, with `try_reference` kept, under the operator's standing word of
  12 November ("from now on autonomous choices, no questions for me") and their word of 18 November
  to overhaul where a review's findings hold. It reverses their word of 19 October, so its merge and
  the jobstat fork that would read it (the written-after tally and supply, against the two forks
  that lay the copy) both wait on them.
- **Honesty after a sixth cannot be read as worded.** 12 A/As after a sixth promotion in two
  campaigns, 0 able to read a step, 7 tying every task. The starter against itself in the same
  campaigns: 16 splits, all able, 0 steps. Fleet: 2 steps in 73 able.
- **Jobstat's validity is saturated.** The candidate's reference was valid in every solve of its 7
  comparisons; jobstat holds room on validity on 13 of 2,200 scored tasks and 2 of 37 steps won on
  it, against buffer's 374 of 4,634 and 30 of 96.
- **Verdicts and the wall.** 0 hand labels in any log; 123 logs hold a Referee ruling. No Linux
  suite has run at the stack's top.
- **Outside.** One Starter rollout scored (262 of 518 on eight tasks), no second, no built
  reference of the present export; eight references are owed a read.

## How it came to be

- **30 September.** The operator: "the truss solves are really slow, that's why i'm mainly
  focussing on esp32".
- **13 October.** The operator: "My main interest/dilemma is, if we let the Built Harness Solver be
  a lower-quality model, if it can adjust?"
- **21 October.** On Harness²: "how to fairly compare these runs with Anabasis, as the benchmarks
  are fixed and we dont have benchmarks. Maybe it would be really cool if we could compare it in a
  way that it reaches the same performance without the Benchmark so it's semi-supervised in stead
  of supervised? or at least gets close to those scores". On what a result is: "is it 1) does it
  win from the previous harness 2) correct 3) did it reduce costs ?" Later: "if we could get really
  close then we have proof that it works?"
- **25 October.** The operator: "okay cap at 6 promotions and milestone at 6 as well". The milestone
  had been 12 until then.
- **27 October.** The operator: "we need to run Opus 5.5 medium against 6.1-terra high but with our
  custom domain, this is the whole point that we compare a more expensive model with a cheap one".
  `compare-systems` followed. On 28 October one session's reading on 12 truss tasks put the cheap
  solver in an unpromoted built harness at 11 valid against the dear solver in the starter at 9;
  no tracked record holds it.
- **30 October.** The pillars table was added to the system-audit skill (`b45b43805`), with the
  outside row on WorkBuddy-Bench then Harness² `k=1`. A local requirements note of the same day
  listed seven bars and asked the operator what v1.0 claims about Harness²: beat it, come within a
  margin, or defer it.
- **2 November.** The operator: "realistically, what would we need now to reach v1.0". The answer
  recommended the four factors in two domains for v1.0 and moving Harness² to v1.1 or to "within a
  margin m at a fraction of the cost". The operator: "Launch three subagents to do everything in
  our means up and until step 6"; the Harness² question was not answered then.
- **3 November.** The operator on the Harness² study: "only do job bench please", and "This should
  be really importantly stated in the studies/harness2 folder for comparison, that if Anabasis even
  comes close it's really cool".
- **4 November.** The operator: "so we need at least two promotions to merge it right (unchanged
  during the run) now that we're getting more serious", and "so focus on jobstat now".
- **5 November.** The operator lowered the JobBench trigger: "one promotion would already be a great
  milestone, attune for that". After the first built arm scored: "if we can reach parity that'd
  already be sick", on 20 tasks, "at least 30%".
- **6 November.** The operator: "we can merge to v0.10.0 if we PROVE two promotions on jobstat",
  "AND also NO regressions (ideally improvements) for control opus buffer hhmm".
- **7 November.** The operator: "launch three sub agents to triage the V1 requirements and actually
  check with what we're doing properly, and we should try to stay on track of what the long term
  goals are which we've set. So can we upgrade the requirements here and ensure we stay on track,
  and try to scope for novel research in terms of direction we need to really try to compare with
  Harness 2. That's the main the V0.10 with Harness 2. That's the most important thing." This file
  and the table's rewrite are that triage's proposal.
- **15 November.** The operator, of the jobstat run of a pair past its second promotion: "keep the
  other one going until like longer, like 3 or 4 promotions, like based on what you think is
  best". That run is the candidate of item 11.
- **16 November.** The operator: "re-read v1 requirements as well, maybe upgrade these with all the
  info you have". The rows were read again from their readers; the supply, climb, honesty,
  verdicts and outside rows were reworded, and items 12 to 15 added. No threshold was set.
- **20 November.** The operator: "set up v1 requirements and adjacent files related to it in one
  md", handed it to an outside model, and pasted its review (seven missing requirements and four
  rules for setting thresholds) with the word "upgrade"; then a second review (five holes, a
  replacement table, decisions for every open item) with "rewrite some compartments / md files /
  helpers fully". Each claim was checked against the tree and the record, and this file, the
  skill's table and the release rule were rewritten. No threshold was set.

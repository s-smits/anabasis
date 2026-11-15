# The v1.0 bar, against the goals the operator has set

Status: planned. The upgraded table is in the system-audit skill ("The pillars and the v1.0 bar")
and each row's value on 7 November 2026 is in `docs/plan.md` ("The v1.0 bar, now"). Every
threshold below is a proposal until the operator sets it; the wording around them is not.

## The question

Are the rows a v1.0 release must meet still the ones the operator's long-term goals need, are their
thresholds set where the record says they can tell anything, and does anything print them, so that
the release cycle stays aimed at them?

## Intended changes

1. **Adopt the upgraded table.** Each row now names its requirement, its threshold, the reader that
   prints its status and the decision it serves. The skill owns those; the plan owns the values
   (rule 12). Two rows are added (systems, and the outside row's course made explicit) and five
   are reworded on the counts under "What the record shows".
2. **The outside row's course (the operator's).** Recommended: JobBench parity against Harness²'s
   held-out arm on the 20 tasks of `jobbench-scoring.md` item 17 as v1.0's outside row, and
   WorkBuddy-Bench Code after v1.0. The JobBench path has scored three arms; no WorkBuddy container
   has run and its licence is open. Parity needs two things first: the Starter's A/A at two rollouts
   a side on all 20 tasks (about $440 by the cycle's estimate), from which the margin is fixed
   before any built rollout, and a Harness² sweep on the 12 added tasks, since its held-out arm
   exists on none of them (not yet costed).
3. **What a confirmed promotion counts (the operator's).** Recommended: keep `confirmed` as the bar
   and have each release state beside it how many reads are a step on the tasks written after alone,
   the one origin no step selected (`starter-reads.ts` prints it). Changing `confirmed` itself makes six far
   harder: 5 of 24 reads on record would count.
4. **Honesty counts only the A/A comparisons able to read a step.** Wording, since an A/A too small
   to read one cannot fail: in the proof campaign 7 of 10 were too small. The fleet rate beside it
   uses the table's existing column.
5. **Supply asks for at least 6 untied tasks a comparison.** Wording, since the test fixes it: an
   exact one-sided sign-flip test over 5 tasks clears at best 1 in 32, above 0.02. The plan's old
   "4 informative tasks" could never read a step. The share of steps won on validity is the
   operator's to set.
6. **Verdicts asks for enough labelled check defects to read the catch rate.** Proposed 8 of the 30
   (the operator's): with 4, one miss already fails three in four. A reader that pools packets
   across campaigns is the one piece of code the bar lacks; build it once the first packet is
   labelled, since until then it would read nothing (rule 13).
7. **Systems: in v1.0 or after it (the operator's).** The row reads `compare-systems` on a measured
   campaign's held-out tasks, with its pair of solvers and margin fixed first.
8. **Economy reads dollars per confirmed promotion on one meter.** `table.ts --rows cost` prices it; any dollar
   target is the operator's, and none has been set.
9. **The release notes carry the bar.** Each release's "Validation and limits" gives one line a
   row, read from its reader, and the plan copies them. This needs one sentence in `stack-pr`
   section 9 pointing at the skill's table, in a change of its own. No new reader: every row's
   reader exists except the pooled verdicts reader of item 6.
10. **`AGENTS.md` section 1 restates the honesty, verdicts and economy bars and the milestone.**
    Once the values are set, its sentences state the same numbers or point at the table (rule 12).
11. **The climb row needs a campaign let go on at one commit across releases.** The release cycle
    forks fresh runs at each new top, and a run continued at another commit does not count
    (`AGENTS.md`, section 10, item 9). So the measured campaign is a proof run left to climb after
    its release lands. The jobstat proof campaign at `9190fbbac` is that candidate now; a pause
    stays the operator's word.

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
- **Rows nobody read.** The verdicts row named `tools/c/rejections.ts`, which reads a stored pack's
  sweep and no live campaign; no reader pools packets. The grounding row named `accept.ts`, which
  decides admission and prints no status; the closing report's "What decides a pass" line does.
  The outside row named `run.ts read`, which no run has fed. No report printed the bar whole.

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

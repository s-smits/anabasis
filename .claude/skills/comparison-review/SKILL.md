---
name: comparison-review
description: Review why a comparison of harnesses or systems came out as it did, level by level from identities and conditions to what the grader read, score formation, splits and noise, and trace what it says about the system to an owner without fitting the system to it. Keeps discovery and confirmation apart (a frozen ledger, a sealed half, blind reading, burned tasks), and carries a finding to the system only as a shape stripped of the benchmark's name, the direction and the score. Use when the operator asks why a harness scored lower or higher, why a benchmark result disappointed, whether something was lost in transfer, whether a result is noise, what a comparison teaches, or how to improve the system from a result. Wording a claim is attribution-and-proof's, how the test works comparison-reading's, one campaign's story whole-run-investigation's, running a reading compare-systems'.
---

# Comparison review

A comparison says which side scored higher; a review asks why, and what that says about the system,
whichever way it came out. Its author holds the result, any number of cuts and a preferred answer,
so it can fit a story to one draw of one exam, and a system changed on that story is overfitted to
its evaluation set. A review reads and proposes, starts no solve and changes no verdict; only a fresh
comparison shows that a proposal helped (rules 1 and 6).

## The stance

Four disciplines, each answering a failure in [forking-paths](references/forking-paths.md):

1. **Describe before explaining**, for both sides alike, with no hypothesis in hand.
2. **Improvements are a by-product.** Nobody asks what would have raised the score, which fits the
   system to the yardstick; the question is what is false, broken or unmeasured.
3. **Discovery and confirmation never share data.** Half the tasks stay sealed, every task read
   closely is burned, and a proposal is tested on fresh data.
4. **A finding reaches the system only as a shape**, stripped of the benchmark's name, the direction
   and the score, which a fresh session that knows none of them traces back and counts in the
   system's own record. What cannot be so stated stays a fact about this comparison.

No seat, prompt or check hears the benchmark, and no change aims at its score.

## What it can review

A **campaign comparison** keeps the wall and matches conditions by construction, so level 2 is a
check of `conditions`; read it through `reading`, `replay`, `draw` and the investigation's lanes.
**`compare-systems`** moves the solver too. An **outside benchmark** (`studies/harness2/`) has its own
grader and nothing equal by construction, so it takes the full procedure. Readings from different
commits or settings are a description (`AGENTS.md`, section 9), and a step in an **A/A** is the
finding.

## The procedure

Keep the files in `<dir>` = `.ana/wri/<date>-<subject>-review/` in the central host's main checkout.
No step starts until the check before it holds.

1. **Freeze the ledger** ([the form](references/report.md)): the operator's question, everything
   already seen, one primary measure with the rest secondary, and the arms. *Check:* its digest
   (`shasum -a 256`) and the time are recorded. The digest is the seal's one salt, so an unwelcome
   split cannot be redrawn.
2. **Seal half the tasks**: `bun studies/harness2/compare.ts levels --dataset <dir> --of <arm> --of <arm> --salt
   <salt>` assigns each task by a hash of the salt and its name and withholds the sealed scores until
   step 7. A sealed half smaller than a sweep (six at level 0.02) can falsify a story but read no
   step. A task read closely before the freeze is left out of step 7's count; if all were read, the
   seal is spent and confirmation comes only from step 11. *Check:* sealed names in the ledger, none
   of their scores.
3. **Check the instrument on every task**: levels 0 to 6 of [the levels](references/levels.md) need
   no score. A broken level may end the review. *Check:* a row a level with its count.
4. **Read the open half**, levels 7 to 11, every task and split, the same way whichever side it
   favoured. *Check:* as many rows for wins as for losses, or why not.
5. **Read it again blind**: fresh sessions under neutral arm names, given pointers and open questions
   and no count or conclusion ([the brief](references/report.md)), ideally before your own hypothesis.
   Agreement on one data set is no replication; disagreement is a finding. *Check:* each session's
   model, from its transcript.
6. **Write rival explanations**, at least three, one innocent and one blaming the instrument, each
   with the count it predicts on the sealed half and its falsifier. *Check:* all written before the
   unsealing.
7. **Unseal once** (`--unseal`, printed as its own block). Resolve each row as held, falsified or
   unreached by recounting, never rewording; an idea found here is a new, unconfirmable row.
8. **Write the shapes**, one card a surviving finding ([backtrack](references/backtrack.md)), from
   won rows as well as lost. *Check:* an unsighted reader cannot tell which side a card helped, and
   the report counts cards by direction.
9. **Backtrack blind**: a fresh session gets only the cards and traces each to an owner, counting the
   shape across the system's record. *Check:* owner, count with denominator, logs read.
10. **Pass the gate**: the eight questions of [backtrack](references/backtrack.md), one disposition a
    card, dropped cards listed with their reason.
11. **Test forward, once.** A lead gets one prediction in the measuring run's
    `predictions-<run>.md`, settled by a count in the system's own measure in its `outcomes-<run>.md`
    (one that does not hold shows in the run's derived still-missing view, beside its plan's
    "Intentionally opposed" trade-offs), then a fresh run (`AGENTS.md`, section 10, item 9). The
    benchmark is read last, on unburned tasks, with measure and margin fixed first. A second attempt
    is reported beside the first, and changes tested together get an ablation before any is credited.
    The row names the burned tasks it leaves out and how many attempts the claim has had.
12. **Report and record** through [the form](references/report.md), leading with the operator's
    answer in attribution-and-proof's words; later work goes in `docs/backlog/<subject>.md`, and
    anything said earlier that the review refuted is corrected plainly.

## Across whole campaigns

Two campaigns at different commits, exams or hosts share no task set, so no seal applies; the ledger
says so and owes instead: a **factor table** of what moved, unrun cells named, one campaign crediting
no factor; **what each commit holds** (`bun run runs source --has <text>`); **whether each change
fired**, counted in each log with a hostile log proving the count can see it; **replays labelled as
estimates** (`promotion-tuner`, whose `trend.ts` gives the spread between runs that a difference
between two campaigns must exceed before it is more than one draw against another); **each rival
with a refuting count**, host programs included (`bun
run runs source`); **where the gap sits** (the gap line of `comparison-reading/scripts/reading.ts`); **an unselected
reading**, such as the first starter comparison after a promotion, since a promoting one runs high;
and **a fresh read before any credit** (`compare-systems`), paid, on the operator's word, with its
settling rule frozen. With no `ANA_HOSTS` loaded, readers take the copies under
`data/runs/<host>/<name>` as they stand (`syncRuns` refreshes them), which keeps a review's input
still.

## Hard rules

- **Nothing here reaches a seat** (rule 3). No report, card, rubric or grader reason enters a prompt,
  starter, harness, task or exam; a card that passes changes the owner's code or asks the operator,
  and never becomes advice to a model (section 2).
- **No reference answers** (rules 2 and 9): nothing seen of a benchmark's answers or rubrics becomes a
  check, task or example.
- **Published text carries ids and counts**, never quoted tasks, rubrics, answers or traces, nor host
  names, logins or credential paths. Read no env file.
- **Read only.** Edit no log, pack, check program, kept harness or store.
- **The operator decides** what a solver is given or told and any paid run (section 3). A non-result
  is no evidence (rules 7 and 15).

## "Was it too strict?"

Level 5 separates three causes, of which only one calls for leniency. If **something was refused**,
count refusals in the rollouts and ask whether the guard protects honesty (rules 3 to 8) or can
loosen (section 2, consequence 6). If **something was told or carried wrongly**, it is a defect. If
**the selection was narrow**, no comparison rewarded the work; the Builder is already free, so the
remedy is what the exam asks, a domain choice for the operator.

## The record

The skill is written from the first JobBench review (`docs/backlog/jobbench-scoring.md`), which kept
no ledger or seal, quoted the milder of two grains, and called a swing across a package change noise.
`studies/harness2/levels.ts` is proved without a model, and `studies/harness2/compare.ts` runs a
JobBench comparison on terms fixed first; the procedure stands at "present in source" until a review
keeps a ledger from step 1.

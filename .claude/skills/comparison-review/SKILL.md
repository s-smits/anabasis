---
name: comparison-review
description: Review why a comparison of harnesses or systems came out as it did, level by level, and trace what it says about the system back to an owner without fitting the system to that comparison. Reads the identities, coverage, conditions, what was carried and what was told, what the harness was selected on, what the grader actually read, how the score is formed, each split in both directions, behaviour and noise. Keeps discovery and confirmation apart (a frozen ledger, a sealed half of the tasks, blind reading, a burned-task record), and carries a finding to the system only as a shape stripped of the benchmark's name, the direction and the score, which a fresh session traces back and counts in the system's own record. Use when the operator asks why a harness scored lower or higher, why a benchmark result disappointed, whether something was lost in transfer, whether a result is noise, what a comparison teaches, or how to improve the system from a result. Wording a claim is attribution-and-proof's, how the test works is comparison-reading's, one campaign's whole story is whole-run-investigation's, running a reading is compare-systems'.
---

# Comparison review

A comparison says which side scored higher. This skill asks the two questions after it: why did it
come out so, and what, if anything, does that say about the system, whichever way it came out?

A review stands at the most dangerous point of the whole method. Its author holds the result,
unlimited cuts of the data and a wish about the answer. Every step below exists because a review
can talk itself into a story, and a system changed on a story is fitted to one draw of one exam.
It reads and proposes. It starts no solve and changes no verdict, and only a fresh comparison can
show that anything it proposed helped (rule 1, rule 6).

| The question | Owner |
| --- | --- |
| What may we claim, in which words? | [attribution-and-proof](../attribution-and-proof/SKILL.md) |
| How does the test work, and what can this size show? | [comparison-reading](../comparison-reading/SKILL.md) |
| What happened in this whole campaign? | [whole-run-investigation](../whole-run-investigation/SKILL.md) |
| Run a cheap built system against a dear bare one | [compare-systems](../compare-systems/SKILL.md) |
| Replay recorded comparisons under other rules | [promotion-tuner](../promotion-tuner/SKILL.md) |
| What is a kept harness made of? | [harness-audit](../harness-audit/SKILL.md) |
| What should be different about the whole system? | [system-audit](../system-audit/SKILL.md) |
| **Why did this comparison read so, and does that generalise?** | this skill |

## The stance

Four disciplines carry the rest. Each answers a failure on record (`references/forking-paths.md`).

1. **Describe before explaining.** The first reading says what is there, for both sides alike, with
   no hypothesis in hand. A reader told what to find finds it.
2. **Improvements are a by-product.** Nobody in a review is asked what would have raised the score.
   That question fits the system to the yardstick, after which the yardstick measures nothing. The
   question is what is false, broken or unmeasured in the system, whichever way this result went. An
   improvement that survives is one the system needed anyway, and this comparison only happened to
   show it.
3. **Discovery and confirmation never share data.** What gave a pattern cannot confirm it. Half the
   tasks stay sealed, every task read closely is burned for what it suggested, and the test of a
   proposal is fresh.
4. **A finding reaches the system only as a shape.** It leaves the review stripped of the benchmark's
   name, the direction and the score, and a fresh session that knows none of them traces it back and
   counts it in the system's own record. What cannot be stated that way stays a fact about this
   comparison.

So the generalisation is implicit. No seat, prompt or check ever hears the benchmark, and a change
never aims at its score. If the score moves later, it moves because a more capable system was
measured on tasks nobody read.

## What it can review

| Kind | Graded by | What differs here |
| --- | --- | --- |
| A campaign comparison | the exam's checks and the Referee | The wall holds: its tasks and outcomes stay on the exam side. Conditions match by construction, so level 2 is a check of `conditions`, not a search. Read through `reading`, `replay`, `draw` and the lanes of a whole-run investigation |
| `compare-systems` | the same, under two solvers | The solver moved too. Selection is the campaign's own (its limits section) |
| An outside benchmark (`studies/harness2/`) | the benchmark's own grader | Every level is open, because nothing is equal by construction: another runtime, another task shape, another grading. This is the full form of the procedure |
| Two readings from different commits, cycles or settings | no one reading | A description only (section 9 of `AGENTS.md`). Price and replay them on one meter and one rule first (`promotion-tuner`) |
| An A/A, or a step in one | the same as its parent | Read it like any other. A step in an A/A is the finding |

## The procedure

Keep the files in one folder, `<dir>` = `.ana/wri/<date>-<subject>-review/` in the main checkout of
the central host, beside the cycle's files. No step starts until the check before it holds.

1. **Freeze the ledger, before reading any further.** Write `<dir>/ledger.md`
   ([the form](references/report.md)): the question in the operator's words; **everything already
   seen**, since a review after a result is never blind and a hidden look is the worst kind; the
   primary measure, and the secondary ones as secondary; the arms and how each is told apart.
   *Check:* its digest (`shasum -a 256`) is taken and written down with the time. That digest is the
   seal's salt, and one salt is all a review gets, so an unwelcome split cannot be drawn again.

2. **Seal half the tasks.** Run the script (`scripts/levels.ts --salt <salt>`). It orders the tasks
   by a hash of the salt and prints the first half; the rest stay withheld until step 7. Where the
   seal leaves fewer than a sweep (six at level 0.02), the sealed half can falsify a story and can
   read no step, and the ledger says so. A task already read closely before the freeze confirms
   nothing whichever half it falls in: the ledger names it, and its row is left out of the count at
   step 7. Where every task has been read, the seal is spent, the ledger says so, and confirmation
   comes only from step 11.
   *Check:* the sealed task names are in the ledger, and no score of theirs is.

3. **Check the instrument over every task.** Levels 0 to 6 of
   [the levels](references/levels.md) ask whether the comparison measured what it says, and none of
   them needs a score: identities, coverage, conditions, what was carried, what was told, what the
   harness was selected on, and what the grader could see. Read them on the sealed tasks too,
   without their outcomes. A broken level here is the finding and may end the review: an arm that
   lost its programs says nothing about the harness.
   *Check:* each level has a row with its count, or says what it could not read.

4. **Read the open half, every level, both sides.** Levels 7 to 11: how the score is formed, each
   split, behaviour, noise, economy. Read every task of the half, never the worst few, and read each
   split the same way whichever side it favoured.
   *Check:* as many rows for rubrics or tasks the candidate won as for those it lost, or the reason
   none exist.

5. **Read it again blind.** One or more fresh sessions read the deliverables and traces under neutral
   arm names, with pointers and open questions and no count or conclusion
   ([the brief](references/report.md)). Run this before writing a hypothesis of your own where you
   can. Agreement between sessions on one data set is not replication; disagreement is a finding.
   *Check:* each session's model read from its transcript, and which sessions were blind recorded.

6. **Write the rival explanations and what each predicts.** At least three, one of them innocent
   (chance, or nothing wrong) and one that blames the instrument. Each row of the ledger says what
   the sealed half would show if it were right, as a count, and what would falsify it.
   *Check:* every row has a count and a falsifier, written before the unsealing.

7. **Unseal once.** `--unseal` prints the sealed half as a block of its own, never pooled. Resolve
   every row as held, falsified or unreached by recounting. A row is never reworded afterwards; a new
   idea from the sealed half is a new row, marked as found there, and it has now no confirmation left
   on this comparison.
   *Check:* as many resolutions as rows.

8. **Write the shapes.** For each surviving finding of any kind, one card
   ([backtrack](references/backtrack.md)): the mechanism in the system's own terms, with no
   benchmark's name, no direction and no score. A finding that cannot be written so stays in the
   report as a fact of this comparison. Cards come from rows the candidate won as well as those it
   lost.
   *Check:* a reader who has seen no result cannot tell from a card which side it helped, and the
   report counts the cards drawn from each direction.

9. **Backtrack blind.** A fresh session gets the cards alone, and for each traces the chain to its
   owner and counts the shape in the system's own record: other campaigns, other domains, other
   harnesses. It is told nothing of the comparison. Where the record cannot hold the shape, the card
   says so and remains a lead.
   *Check:* each card has an owner, a count with its denominator, and the logs read.

10. **Pass the gate.** Hold each card to the eight questions of
    [backtrack](references/backtrack.md), and give it one disposition: a defect to fix whichever way
    the result went, an instrument fact, a limit of the claim, a lead that needs an experiment, or
    dropped. Dropped cards stay on the record with their reason. A review that keeps every idea it
    had has no gate.
    *Check:* every card has one disposition, and the dropped ones are listed.

11. **Test forward, once.** A lead gets one prediction in the cycle's `Predictions.md`, settled by a
    count in the system's own measure, then a fresh run (`AGENTS.md`, section 10, item 9). The
    outside benchmark is read last, on tasks not burned, with its primary measure and margin fixed
    before the first solve. One attempt: a second one is reported beside the first, never instead of
    it. Several changes tested together get an ablation before any is credited.
    *Check:* the row names the burned tasks it leaves out, and how many attempts the claim has had.

12. **Report and record.** Report through [the form](references/report.md), leading with the answer
    to what the operator asked, in the words `attribution-and-proof` allows. Keep work the operator
    wants later in `docs/backlog/<subject>.md`. Correct on the spot anything earlier said that the
    review refuted, in plain words.

## Hard rules

- **Nothing here reaches a seat.** No report, card, count or paraphrase goes to a Builder, an
  Examiner, a solver or a Referee (rule 3). A benchmark's rubric, its wording and its grader's
  reasons never enter a prompt, a starter, a harness, a task or an exam. A card that passes the gate
  changes the owner's code or asks the operator a question; it never becomes advice to a model
  (section 2, consequences 1 and 2).
- **No reference answers.** Nothing a review saw of a benchmark's answers or rubrics becomes a check,
  a task or an example (rules 2 and 9).
- **Published text carries ids and counts.** A pull request or backlog entry names a task, a rubric
  index, a weight and a count, and quotes no task, rubric, answer or trace. Host names, logins and
  credential paths stay out. Read no env file.
- **Read only.** Edit no log, pack, check program, kept harness or store. Leave a benchmark's own code
  untouched; reading a file as its grader would (level 6) is done apart, with a scratch script, and
  the official score stands as recorded beside it.
- **Keep the operator's seven decisions.** Changing what a solver is given or told, an arm's export
  note included, and any paid run need the operator's word (section 3). Ask with the evidence and a
  recommendation, and carry on with what does not depend on the answer.
- **A non-result is no evidence.** A provider failure or a limit is rule 7 and rule 15's ordinary
  case, solved again and counted nowhere.

## How a review answers "was it too strict?"

The operator's natural question after a poor transfer is whether the system should allow more. Level 5
settles which of three things the gap is, since they have different remedies and only one of them is
leniency:

- **Something was refused.** Count the refusals, walls, limits and blocked commands in the rollouts.
  Where they account for losses, ask whether the guard protects an honesty property (rules 3 to 8)
  or can loosen (section 2, consequence 6, and the trade-off of a strict gate against a capable
  model).
- **Something was told or carried wrongly.** A false statement or a dead program is a defect of the
  carrying, fixed by making it true, whatever the score did.
- **The selection was narrow.** Nothing stopped the harness doing the work. The comparison that made
  it never rewarded that work, so it never built for it. Leniency changes nothing here, because the
  Builder is already free. The remedy, if one is wanted, is what the exam asks, through the Examiner
  and the operator's prompt, and that is a choice of domain rather than a repair.

## The record

- **5 November 2026.** The first promoted jobstat harness scored 310 of 550 against the bare
  Starter's 342 on eight JobBench tasks, one rollout each (`docs/backlog/jobbench-scoring.md`). The
  operator asked "maybe we did not copy everything and the system was brittle", then "launch another
  opus review subagent, only give it hints". Levels 3, 4, 6 and 7 found the files carried, false
  statements about limits still in the guide, a grader's per-file cap hiding sheets from both arms,
  and an all-or-nothing score that turned 7 criteria of 241 into 32 points. The first answer given,
  "within the noise", cited a swing of the same harness across a change of installed packages: it
  was no clean A/A, and the correction went out in the next report. The next report then quoted p 0.25
  for the bare arm, which is the criteria's reading. This skill's script, run on the same records as
  its first test, read the frozen measure of points at 6 tasks to 2, p 0.074. Nobody had hidden it: with
  no primary measure frozen, the milder figure had simply been the one quoted. The review had no ledger
  and no seal, and ten scripts of cuts went uncounted; this skill is written from that. Its worked
  cards are in [backtrack](references/backtrack.md). A review given hints alone then read the same
  store. It agreed on the copy, the guide, the cap and the amplification, added the notebook outputs and
  a fourth arm, and named chance as leading where the arithmetic did not (level 10). Both read one
  store, so the agreement is two reads and no replication.

This procedure has not yet run from its first step on a live comparison. The script is proved without
a model. The rest stands at "present in source" until a review keeps a ledger from the start.

## Where the detail lives

| file | owns |
| --- | --- |
| [references/levels.md](references/levels.md) | every level's questions, each with where to read it and what it has caught |
| [references/forking-paths.md](references/forking-paths.md) | each way a review deceives itself, and what stops it |
| [references/backtrack.md](references/backtrack.md) | the shape card, the chain to an owner, the eight questions, the dispositions and the worked cards |
| [references/report.md](references/report.md) | the ledger's form, the blind brief, the backtrack brief and the report's form |
| `scripts/levels.ts` | a rubric-graded benchmark's result at each level for two arms, with the sealed half withheld and no rubric text |

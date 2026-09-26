# Gate audit

How to decide whether one refusal — a gate component, a claim clause, a census code, a loop
ceiling, or a check the Builder wrote — earns its place, and what to change when it does not.

## Why this belongs beside the climb

A refusal and the climb pull on the same round. Every refusal a Builder has to answer spends
minutes the round could have spent making the battery harder, and every check that fails a correct
answer moves a battery's pass count as surely as a harder task would. So a check can hold the
climb back two ways: a gate that refuses correct candidates stalls the round, and a declared check
that fails correct answers makes an over-aim battery read as on the band. The triage of 28 recorded
runs on 2026-09-27 found both at once. Of 25 control-census episodes, 21 were slow but correct
tools, 813 minutes in all. And 10 of the 15 verified shipping failures were two Builder-written
firmware checks failing correct sketches, which made three batteries that were really 6/6, 23/23
and 11/11 read 4/6, 19/23 and 9/11 — and made two plans read as met that had missed.

The same evidence also says what a check is for: the loop found real defects, 7 of 8 accept-control
refusals among them, and a battery that scored a real defect is a battery the climb could read. So
the question is never "is this check strict", it is whether it separates right from wrong and what
its wrong firings cost. Read [the climb reference](climb.md) alongside: a battery over the aim with
a failing check is first a question about the check.

## The census comes first

```text
bun --no-env-file .claude/skills/whole-run-investigation/scripts/wri.ts census [--json] [--out <abs file>]
```

`census` runs the `gates` lane over every campaign in the main checkout's tree and groups the
episodes per ledger component: episodes, the rounds and runs they fired in, stalls, how each was
answered, total and median minutes, and minutes per round over every Builder session it read.
Beside that it lists the loop terminals and review-unread holds, and every Builder-written check
that failed a verified case, as failed of ran with the cases named. The cases come from each
campaign's case ledger through the digest's readers, so a typed non-result never counts whatever
its evaluator returned, and a battery kept under a candidate or promotion tree counts once. A
campaign it could not read whole is listed under coverage with its gaps, and an empty total is
then said to hold only for the readable part of the tree. It takes seconds and reads recorded
bytes only. The per-run view is `wri.ts gates <run>`; the priors, codes and retired codes
it groups by are `gate-ledger.ts`, and a code the census reports as unledgered is a ledger row
owed before its card.

The census counts and never judges. `repaired` means the bytes moved and the code went away, which
a rename answers as well as a fix. Whether a firing was a true positive is read per firing from the
receipt, the Builder's prose around it and, for a shipping failure, a re-run of the case with the
suspect condition changed — the firmware false positives were proved by renaming one identifier
and defining one macro, after which every one of them passed.

## The card

One file per decision in the main checkout's ignored `notes/gate-audit-ledger/<id>.md`, where the
dated state of earlier passes lives too. Write each field as a sentence with its evidence.

- **Decision.** Keep, remove, restore, rewrite, or add; the ledger id and abbreviation; the commit
  that holds the code.
- **Climb.** What the component cost and what it caught, from the census: minutes per round,
  stalls, and for a check, the shipping cases it failed and how many of those were wrong answers.
  A component whose firings were mostly correct candidates is costing the climb whatever its
  prior says.
- **Stages.** For preview (`src/gate/validation-pipeline.ts` and what it calls), battery
  (`src/truth/verification-runner.ts`, `src/truth/solve-case.ts`) and claim
  (`src/claim/readiness.ts`, `src/claim/claim.ts`): the producer at `file:line` or `absent`. A
  decision that differs between stages says why, and "a later stage refuses it anyway" is never a
  reason, because the round was paid for by then.
- **Firings.** Up to three firings read in full, each named true positive, false positive or
  unclear, with what answered it: a repair, a rewording, a raised wall, a workaround or nothing.
  Zero is stated as zero, and a decision resting on zero rests on construction.
- **The 98% sentence.** The wrong thing the component refuses, whether a correct candidate can trip
  it, and the fixture or firing showing each.
- **Told.** Every sentence in `starters/`, the Builder system prompt, `FRAME`, tool descriptions,
  AGENTS.md and the skills that states the rule, and what each says after the change. A rule the
  Builder is told and nothing enforces is worse than no rule.
- **Tests, falsifier, refuter.** The positive and nearest hostile case with the revert proof; the
  observation in a later run that would show the decision wrong; what the independent reader found.

## The moves

Consider them in this order for each card, and take the most ambitious one the evidence supports.
Kept components are in scope like any other, because keeping was a decision too.

1. **Delete** a component with no firing on a defective candidate and no argument from construction.
2. **Restore** one the card shows refused something actually wrong, at every stage at once.
3. **Rewrite sharper.** A rule firing on right and wrong alike gets a predicate that separates
   them, with a fixture on each side. For a timeout that is usually a re-run alone before refusing,
   with the wall and the slowest completed run in the finding.
4. **Turn a refusal into a measurement** when it estimates something only blind measurement
   decides, difficulty above all.
5. **Give a fact one owner** when two stages produce it, so parity holds by construction.
6. **Fix the class** when one defect shows in several cards: a check fault the Builder repeats
   across domains is fixed in the starter, not in each bundle.

What no move cuts is AGENTS.md's: verifier authority, isolation, identities, typed non-results, the
three denominators, rule 4's protection of verifier detail, and controller-owned submission.

## The procedure

1. Run the census, then fill the card before editing anything.
2. One decision per commit, every stage, its told text and its `docs/gate-audit.md` entry together,
   so the commit can be dropped whole.
3. The positive and hostile tests, and the revert proof: which tests fail with the production hunk
   reverted.
4. One fresh read-only reader per decision commit, asked which stage, surface, test or firing the
   card missed; settle each point with a source line, a test or a change.
5. Deliver as a stacked pull request, one commit per decision, each passing the gate alone.

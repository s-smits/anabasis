# Levers: what an iteration can tune

A plan holds **repairs** of confirmed defects and **tunings** of levers the evidence points at, even
where nothing is broken. Each lever the run's evidence selects gets a row, tuned or kept with one
checkable sentence; a plan of repairs only names the three closest (`wri2p2.ts` checks for three ids).
Feedback states what was measured, never a target; a tuning names no pack's field; the wall holds
(rule 3). Levers marked *operator* are asked with evidence and a recommendation; the rest are the
iteration's.

## Supply

| # | lever | owner | selected by |
| --- | --- | --- | --- |
| E1 | "How hard" in the writing prompt | `src/examiner/prompt.ts` | reference valid everywhere; `TIES BETWEEN VALID ANSWERS` |
| E2 | What the Examiner hears of outcomes | `heard`, `src/examiner/record.ts` | `OUTCOMES BY SESSION` reading `reference-every` |
| E3 | The ladder's examples and rungs | `LADDER`, `src/examiner/ladder.ts` | high blind grades on closed tasks |
| E4 | Drafting rules: objective, families | `src/examiner/draft.ts` | an objective tying every pair; `INSTRUMENT AUTHORED` |
| E5 | The draft gate (a removal names the dishonest reading it no longer prevents) | `draftFaults`, `src/examiner/draft.ts` | an `exam` ending with nothing compared |
| E6 | The task gate | `refusalOf`, `src/examiner/write.ts` | refusals beside a thin frontier |
| E7 | When an Examiner session opens, for how long (*operator* for limits) | `src/campaign/decide.ts` | hours to a comparison against tasks admitted |
| E8 | Comparison floor, retained share (*operator*) | `comparisonFloor`, `src/campaign/admission.ts` | `no-room` just under the floor |

## Climb

| # | lever | owner | selected by |
| --- | --- | --- | --- |
| B1 | What the Builder hears of practice | `src/builder/tools.ts`, `src/builder/past.ts` | repeated failures; unread traces |
| B2 | The opening and the table's advice | `src/builder/prompt.ts`, `src/campaign/decide.ts` | moves the table did not name; idle sessions |
| B3 | Memory across sessions | `src/builder/memory.ts`, `src/builder/kept.ts` | a session undoing the last |
| B4 | Practice release (*operator* to move the half) | `releaseOrder`, `src/kernel/reports.ts` | a Builder starved of failures |
| B5 | Builder session turns and hours (*operator*) | `tools/d2/harness-builder.ts` | sessions ending mid-change |

## Solve

| # | lever | owner | selected by |
| --- | --- | --- | --- |
| S1 | The starter (*operator*) | `src/harness/starter.ts` | want of a generic tool |
| S2 | Solve limits (*operator*) | `LIMITS`, `tools/d2/campaign.ts` | `turns-ended`, `wall-ended` on both sides |
| S3 | Shell and wall grants (only where no protected root opens) | `src/tools/command.ts`, `src/wall/` | `sandbox-crash` on a needed path |

## Reading

| # | lever | owner | selected by |
| --- | --- | --- | --- |
| R1 | Tally weights (*operator*) | `WEIGHTS`, `src/kernel/compare.ts` | steps carried by a split objective |
| R2 | Objective gap floor (*operator*) | `ROOM`, `src/kernel/compare.ts` | A/A splits past 1% |
| R3 | Solves a side, level (*operator*) | `SIZE`, `src/kernel/size.ts` | too few untied tasks |
| R4 | Starter comparison timing (*operator*) | `heldSince`, `src/campaign/decide.ts` | epoch hours spent confirming |
| R5 | Patience (*operator*) | `stopRule`, `src/campaign/admission.ts` | `stop` while the frontier grows |

## Verdicts

| # | lever | owner | selected by |
| --- | --- | --- | --- |
| V1 | Referee prompt and evidence | `src/referee/referee.ts` | `unclear` or refused rulings |
| V2 | Check-defect stop (*operator*) | `src/campaign/admission.ts` | `check-defects` on few defects |
| V3 | Admitting authored checks (*operator*) | `tools/c/accept.ts --admit` | authored checks refusing nothing |

## Host and economy

| # | lever | owner | selected by |
| --- | --- | --- | --- |
| H1 | Solve queue wait (*operator* for placement) | the solve queue | `campaign.waited` over 15 minutes |
| H2 | Which seat spends (*operator* for the model) | `billOf`, `src/kernel/meter.ts` | `SPEND LED BY A ROLE` |
| H3 | Prose no decision reads | every seat's prompt | prompts grown with no reading moved |

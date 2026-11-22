# Levers: what an iteration can tune

An iteration plan contains both **repairs** for confirmed defects and **tunings** for system levers supported by empirical evidence, even when no defect is present. Every lever selected by a run's evidence receives a row in `plan.md`, either tuned or explicitly retained with one falsifiable justification; a plan consisting solely of repairs must still cite the three most relevant levers (`wri2p2.ts` checks for at least three lever identifiers). Feedback given to models states observed facts rather than target metrics, tunings never name a specific pack's domain, and the evaluation boundary holds strictly (rule 3). Levers marked *operator* require operator approval with supporting evidence and a recommendation; all other levers fall within the iteration's authority.

## Supply

| # | lever | owner | selected by |
| --- | --- | --- | --- |
| E1 | "How hard" guidance in the task-writing prompt | `src/examiner/prompt.ts` | reference valid on every task; `TIES BETWEEN VALID ANSWERS` |
| E2 | Outcome feedback reported to the Examiner | `heard`, `src/examiner/record.ts` | `OUTCOMES BY SESSION` reading `reference-every` |
| E3 | Difficulty ladder examples and rungs | `LADDER`, `src/examiner/ladder.ts` | high blind grades on tasks the reference already solves |
| E4 | Drafting rules: objective and task families | `src/examiner/draft.ts` | an objective that ties every pair; `INSTRUMENT AUTHORED` |
| E5 | Draft admission gate (any relaxation must state which dishonest reading it no longer prevents) | `draftFaults`, `src/examiner/draft.ts` | an `exam` ending with zero comparisons completed |
| E6 | Task admission gate | `refusalOf`, `src/examiner/write.ts` | frequent task refusals alongside a thin frontier |
| E7 | Examiner session scheduling and duration (*operator* for hard limits) | `src/campaign/decide.ts` | elapsed hours to first comparison relative to tasks admitted |
| E8 | Comparison floor and retained task share (*operator*) | `comparisonFloor`, `src/campaign/admission.ts` | `no-room` ending just below the comparison floor |

## Climb

| # | lever | owner | selected by |
| --- | --- | --- | --- |
| B1 | Practice outcome feedback given to the Builder | `src/builder/tools.ts`, `src/builder/past.ts` | repeated failures; unread solver traces |
| B2 | Builder opening prompt and move-table advice | `src/builder/prompt.ts`, `src/campaign/decide.ts` | moves not recommended by the table; idle sessions |
| B3 | Cross-session memory | `src/builder/memory.ts`, `src/builder/kept.ts` | a session reverting the preceding session's changes |
| B4 | Practice task release order (*operator* to change the half-held cap) | `releaseOrder`, `src/kernel/reports.ts` | a Builder starved of informative practice failures |
| B5 | Builder session turn and time limits (*operator*) | `tools/d2/harness-builder.ts` | sessions terminating mid-edit |

## Solve

| # | lever | owner | selected by |
| --- | --- | --- | --- |
| S1 | Starter Built Harness (*operator*) | `src/harness/starter.ts` | absence of a general-purpose tool |
| S2 | Per-solve turn and time limits (*operator*) | `LIMITS`, `tools/d2/campaign.ts` | `turns-ended` or `wall-ended` on both sides of a comparison |
| S3 | Shell and sandbox grants (only where no protected root is exposed) | `src/tools/command.ts`, `src/wall/` | `sandbox-crash` on a legitimate path |

## Reading

| # | lever | owner | selected by |
| --- | --- | --- | --- |
| R1 | Tally weights (*operator*) | `WEIGHTS`, `src/kernel/compare.ts` | promotion steps carried by a split objective |
| R2 | Objective gap floor (*operator*) | `GAP_FLOOR`, `src/kernel/compare.ts` | A/A control splits exceeding 1% |
| R3 | Solves per side and significance level (*operator*) | `SIZE`, `src/kernel/size.ts` | insufficient untied tasks for statistical power |
| R4 | Starter confirmation comparison timing (*operator*) | `heldSince`, `src/campaign/decide.ts` | excessive epoch hours spent confirming promotions |
| R5 | Improvement patience (*operator*) | `stopRule`, `src/campaign/admission.ts` | `stop` ending while the frontier is still expanding |

## Verdicts

| # | lever | owner | selected by |
| --- | --- | --- | --- |
| V1 | Referee prompt and supplied evidence | `src/referee/referee.ts` | `unclear` or refused Referee rulings |
| V2 | Check-defect stopping threshold (*operator*) | `src/campaign/admission.ts` | `check-defects` ending triggered by very few defects |
| V3 | Admitting authored checks (*operator*) | `tools/c/accept.ts --admit` | authored checks producing zero rejections |

## Host and economy

| # | lever | owner | selected by |
| --- | --- | --- | --- |
| H1 | Solve queue wait threshold (*operator* for host placement) | the solve queue | `campaign.waited` exceeding 15 minutes |
| H2 | Cost allocation across seats (*operator* for model selection) | `billOf`, `src/kernel/meter.ts` | `SPEND LED BY A ROLE` |
| H3 | Prompt text that influences no decision | every seat's prompt | prompt length growing without moving any measured outcome |

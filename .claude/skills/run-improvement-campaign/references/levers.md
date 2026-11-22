# Levers: what an iteration can tune

Every `plan.md` combines defect **repairs** and evidence-backed lever **tunings** (citing ≥3 lever ids, tuned or retained with falsifiable rationale; `wri2p2.ts` checks ≥3 ids). Supply models with facts, not targets; never name a pack's domain; preserve rule 3. Levers marked *operator* require operator approval.

## Supply
| # | Lever | Owner | Trigger |
| --- | --- | --- | --- |
| E1 | Task-writing difficulty guidance | `src/examiner/prompt.ts` | reference valid on all tasks; `TIES BETWEEN VALID ANSWERS` |
| E2 | Outcome feedback to Examiner | `heard`, `src/examiner/record.ts` | `OUTCOMES BY SESSION` reading `reference-every` |
| E3 | Difficulty ladder rungs/examples | `LADDER`, `src/examiner/ladder.ts` | high blind grades on tasks reference already solves |
| E4 | Drafting rules (objective, families) | `src/examiner/draft.ts` | objective tying every pair; `INSTRUMENT AUTHORED` |
| E5 | Draft gate (note honesty risk if relaxed) | `draftFaults`, `src/examiner/draft.ts` | `exam` ending with 0 comparisons |
| E6 | Task admission gate | `refusalOf`, `src/examiner/write.ts` | high task refusals + thin frontier |
| E7 | Examiner scheduling/duration (*operator* for limits) | `src/campaign/decide.ts` | long hours to comparison 1 vs admitted count |
| E8 | Comparison floor & retained share (*operator*) | `comparisonFloor`, `src/campaign/admission.ts` | `no-room` ending just below floor |

## Climb & Solve
| # | Lever | Owner | Trigger |
| --- | --- | --- | --- |
| B1 | Builder practice feedback | `src/builder/tools.ts`, `past.ts` | repeated failures; unread traces |
| B2 | Builder opening prompt & move advice | `src/builder/prompt.ts`, `decide.ts` | non-table moves; idle sessions |
| B3 | Cross-session memory | `src/builder/memory.ts`, `kept.ts` | session reverting prior session's edits |
| B4 | Practice release order (*operator* for half-cap) | `releaseOrder`, `src/kernel/reports.ts` | Builder starved of practice failures |
| B5 | Builder turn/time limits (*operator*) | `tools/d2/harness-builder.ts` | sessions ending mid-edit |
| S1 | Starter Built Harness (*operator*) | `src/harness/starter.ts` | missing general-purpose tool |
| S2 | Per-solve turn/time limits (*operator*) | `LIMITS`, `tools/d2/campaign.ts` | `turns-ended`/`wall-ended` on both arms |
| S3 | Shell/sandbox grants (no protected roots) | `src/tools/command.ts`, `src/wall/` | `sandbox-crash` on valid path |

## Reading, Verdicts & Economy
| # | Lever | Owner | Trigger |
| --- | --- | --- | --- |
| R1 | Tally weights (*operator*) | `WEIGHTS`, `src/kernel/compare.ts` | steps carried by split objective |
| R2 | Objective gap floor (*operator*) | `GAP_FLOOR`, `src/kernel/compare.ts` | A/A splits >1% |
| R3 | Solves/side & alpha (*operator*) | `SIZE`, `src/kernel/size.ts` | underpowered untied counts |
| R4 | Starter confirmation timing (*operator*) | `heldSince`, `src/campaign/decide.ts` | excessive epoch hours confirming |
| R5 | Improvement patience (*operator*) | `stopRule`, `src/campaign/admission.ts` | `stop` while frontier still grows |
| V1 | Referee prompt & evidence | `src/referee/referee.ts` | `unclear` or refused rulings |
| V2 | Check-defect stop threshold (*operator*) | `src/campaign/admission.ts` | `check-defects` ending on few defects |
| V3 | Admitting authored checks (*operator*) | `tools/c/accept.ts --admit` | authored checks with 0 rejections |
| H1 | Solve queue wait (*operator* for placement) | solve queue | `campaign.waited` >15m |
| H2 | Cost allocation (*operator* for models) | `billOf`, `src/kernel/meter.ts` | `SPEND LED BY A ROLE` |
| H3 | Dead prompt text | every seat prompt | prompt growth with zero measured effect |

# Levers: what an iteration can tune

Every `plan.md` combines defect **repairs** and evidence-backed lever **tunings** (citing ≥3 lever ids, tuned or retained with falsifiable rationale; `wri2p2.ts` checks ≥3 ids). Supply models with facts, not targets; never name a pack's domain; preserve rule 3. Prefer removing or simplifying a lever whose pre-registered keep-bar failed (`AGENTS.md` rule 13). Levers marked *operator* require operator approval.

## Supply & Exam
| # | Lever | Owner | Trigger (`wri.ts read`) |
| --- | --- | --- | --- |
| E1 | Task-writing difficulty guidance | `src/examiner/prompt.ts` | reference valid on all tasks; `TIED TASKS`; `TIES BETWEEN VALID ANSWERS` |
| E2 | Outcome feedback to Examiner | `heard`, `src/examiner/record.ts` | `OUTCOMES BY SESSION` reading `reference-every` |
| E3 | Difficulty ladder rungs/examples | `DIFFICULTY_SCALE`, `src/examiner/difficulty.ts` | high blind grades on tasks reference already solves |
| E4 | Drafting rules (objective, families) | `src/examiner/draft.ts` | objective tying every pair; `INSTRUMENT AUTHORED`; `FAMILY CONCENTRATION` |
| E5 | Draft gate (note honesty risk if relaxed) | `draftFaults`, `src/examiner/draft.ts` | `exam` ending with 0 comparisons |
| E6 | Task admission gate | `refusalOf`, `src/examiner/write.ts` | `GATE REFUSED`; `EXAMINER ZERO YIELD`; thin frontier |
| E7 | Examiner scheduling/duration (*operator* for limits) | `supplyRun`, `src/campaign/scheduler.ts` | `FIRST COMPARISON HELD OFF`; long hours to comparison 1 vs admitted count |
| E8 | Comparison floor & retained share (*operator*) | `comparisonFloor`, `src/campaign/admission.ts` | `no-room` ending just below floor; `UNDERPOWERED NO-STEPS` |
| E9 | Adversarial draft audit (keep, simplify or remove) | `reviewDraft`, `src/audit/draft-audit.ts` | `DRAFT AUDITED`; `DRAFT AUDIT DEFECTS`; `DRAFT AUDIT REFUSED` |
| E10 | Verifier grounding & declared tool provenance | `src/examiner/draft.ts`, `src/kernel/verify.ts` | `VERIFIER TOOL PROVENANCE`; `VERIFIER FAULTS`; `PASSES AT A SMALL WALL SHARE` |

## Climb, Harness & Solve
| # | Lever | Owner | Trigger (`wri.ts read`) |
| --- | --- | --- | --- |
| B1 | Builder practice feedback & telemetry | `src/builder/tools.ts`, `past.ts` | `PRACTICE FAILS`; `PRACTICE CONCENTRATION`; unread traces; unused `.toolchain/bin` |
| B2 | Builder opening prompt & move advice | `src/builder/prompt.ts`, `scheduler.ts` | non-table moves; idle sessions; `FINAL BYTES NEVER PRACTISED` |
| B3 | Cross-session memory | `src/builder/memory.ts`, `store.ts` | session reverting prior session's edits; `BUILDER COMPACTED` |
| B4 | Practice release order (*operator* for half-cap) | `releaseOrder`, `src/kernel/reports.ts` | `PRE-PROMOTION PRACTICE RELEASED`; Builder starved of practice failures |
| B5 | Builder turn/time limits (*operator*) | `tools/campaign/harness-builder.ts` | sessions ending mid-edit |
| B6 | Harness portability & `HOST_ONLY` split | `portableGuide`, `src/harness/starter.ts`, `src/builder/prompt.ts` | `BUILT HARNESS FOR EXPORT`; `portability` reader `above-leaks` or hazards |
| S1 | Starter Built Harness (*operator*) | `src/harness/starter.ts` | missing general-purpose tool |
| S2 | Per-solve turn/time limits (*operator*) | `LIMITS`, `tools/campaign/campaign.ts` | `MISSES AT A LIMIT` on both arms |
| S3 | Shell/sandbox grants (no protected roots) | `src/tools/command.ts`, `src/sandbox/` | `sandbox-crash` on valid path; `HIGH TOOL ERROR RATE` |
| S4 | Cross-seat wall & network condition parity | `src/sandbox/`, `src/tools/command.ts` | `NETWORK PARITY MISMATCH`; `WALL BOUNDARY SIGNAL` |

## Reading, Verdicts & Economy
| # | Lever | Owner | Trigger (`wri.ts read`) |
| --- | --- | --- | --- |
| R1 | Tally weights (*operator*) | `WEIGHTS`, `src/kernel/compare.ts` | `STEP CARRIERS` dominated by noise; `SAFEGUARD-9 PROMOTION BEYOND VALIDITY` |
| R2 | Objective gap floor (*operator*) | `GAP_FLOOR`, `src/kernel/compare.ts` | `REFERENCE AGAINST ITSELF` splits >1%; `MARGINS INSIDE THE NOISE` |
| R3 | Solves/side & alpha (*operator*) | `SIZE`, `src/kernel/size.ts` | underpowered untied counts; `UNDERPOWERED NO-STEPS` |
| R4 | Starter confirmation timing (*operator*) | `heldSince`, `src/campaign/scheduler.ts` | `PROMOTION UNCONFIRMED`; excessive epoch hours confirming |
| R5 | Improvement patience (*operator*) | `stopRule`, `src/campaign/admission.ts` | `stop` while frontier still grows |
| V1 | Auditor prompt & evidence | `src/audit/auditor.ts` | `RULED UNCLEAR`; `RULINGS REFUSED`; `EARNED WITHOUT A PROBE` |
| V2 | Check-defect stop threshold (*operator*) | `src/campaign/admission.ts` | `check-defects` ending on few defects |
| V3 | Admitting authored checks (*operator*) | `tools/eval/accept.ts --admit` | authored checks with `0` refusals (`REFUSALS BY CHECK`) |
| H1 | Solve queue wait (*operator* for placement) | solve queue | `campaign.waited` >15m; `HOST LOADED` |
| H2 | Cost allocation (*operator* for models) | `billOf`, `src/kernel/meter.ts` | `SPEND LED BY A ROLE`; `BILLING RESIDUAL` |
| H3 | Dead prompt text | every seat prompt | prompt growth with zero measured effect |
| H4 | Component yield & pause boundaries | `tools/campaign/campaign-actions.ts`, `src/campaign/scheduler.ts` | `ROLE YIELD SKEW`; `SEAT BOUNDARY ANOMALY` |

Expands `AGENTS.md` §1 (question, four reported factors, trade-offs). Information wall lives in `wall.md`.

## The four reported factors (`docs/plan.md`, "Goal and the four factors")

- **Supply** (admission precondition, not an outcome factor): a task gives gradient only when one harness wins validity or achieves a better objective (`informative`, `src/kernel/compare.ts`). Because informativeness is observable only post-solve, admission tracks frontier tasks (`comparisonFloor`).
- **1. Climb**: promotions within one campaign (`src/campaign/climb.ts`). Unsolved feasible drafts (`task.feasible`, `measured` in `src/examiner/write.ts`) enter the held-out pool to supply future headroom (a passing author solve does not guarantee public prompt clarity). Legacy `ladder` tasks read as held-out with zero decision weight (`lastReports`, `src/kernel/reports.ts`). Non-patience endings (`budget`, `environment`, `finished`) report `"reached N promotions; further improvement unresolved"`.
- **2. False-positive rate**: significance applies per comparison (no cumulative multiplicity refusal). Each reading reports its nominal false-positive rate (`falseRate`, `src/campaign/comparison.ts`; opening prints `sizeLines`, `src/kernel/size.ts`). Paired A/A controls measure empirical false positives; climb reports sum nominal rates and tally powered A/A steps (`falsePromotion`, `incapable`).
- **3. Audit accuracy**: Auditor filters check-defect false negatives (`src/audit/auditor.ts`; rulings missing evidence are refused and logged). Calibrated against blind human labels (`tools/d2/settle.ts`, `src/audit/agreement.ts`) reporting both error rates, per-category agreement, PABAK, kappa and counterfactual human-label rereading (`swapped`).
- **4. Economy**: frozen list-price USD/promotion (`billOf`, `src/kernel/meter.ts`) printed beside backend totals (`costLine`).

Excluded from factors: the wall (binary test invariant), practice results (training, rule 1) and raw spend divorced from climb.

## Further trade-offs

Beyond `AGENTS.md` §1:
- **Domain validity gradient**: hard-constraint domains (physical feasibility, compilers, simulators) separate harnesses on binary validity, whereas open-ended analytical domains saturate binary validity as a feasibility floor so the noisier objective governs. Report which measure carried a step and inspect the starter's A/A noise floor; raising `GAP_FLOOR` shifts noise while starving supply.
- **Difficulty vs statistical power**: ties drop out; steps detect best at 30–50% reference pass rate. Watch reference validity share and untied task count.
- **Stricter threshold vs climb speed**: 2 solves/task at 0.02 balances power and noise; an A/A step signals a loose alpha.
- **Cost vs value**: compare USD/promotion on one meter (`promotion-tuner`); rising solve cost without validity gain is bloat.
- **Supply vs latency**: harder Examiner drafts take longer and admit fewer tasks; read hours-to-comparison beside admitted count.
- **Patience vs premature stop**: 6 eligible moves without gain stop a run; extra attempts add false-positive draws (treat `--past-stop` steps cautiously).
- **Incremental promotion vs starter**: a single-family sweep from one session is weaker than multi-epoch wins; `starterReads` partitions by task provenance so overfitting to earlier draws shows up on fresh tasks.
- **Objective vs unmeasured habits**: harnesses optimise only checked properties and declared objectives.
- **Tuned query vs original prompt**: bound adapted queries in word count against the original prompt, not the prior revision.

## Older vocabulary

`v1` = codebase before v2 (`git show 5bc9988:<path>`, `docs/transfer.md`). "AGENTS.md rule N" comments in v1-inherited modules (`src/meta`, `src/sandbox`, `tools/loc`, `tools/oxlint`) cite v1 numbering. **Epoch** = span under one reference harness; **cycle**, **sweep**, **bundle** = archived v1 pack origins.

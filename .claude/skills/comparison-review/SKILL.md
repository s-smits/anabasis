---
name: comparison-review
description: Analyse why a comparison of harnesses or systems produced its observed outcome, moving systematically from identities and experimental conditions to grader visibility, score formation, per-task splits, and rollout noise, then trace general mechanisms back to system owners without overfitting to the evaluation set. Separates exploratory discovery from confirmation via a frozen ledger, a sealed hold-out split, blind reading, and burned-task tracking, propagating findings back to the system only as domain-general shape cards stripped of benchmark names, directions, and scores. Use when the operator asks why a harness scored higher or lower, why an external benchmark disappointed, whether capability was lost in transfer, whether a difference is noise, what a comparison teaches, or how to improve the system from a result. Claim wording belongs to `attribution-and-proof`, statistical testing to `comparison-reading`, single-campaign audits to `whole-run-investigation`, and running system comparisons to `compare-systems`.
---

# Comparison review

A comparison establishes which arm scored higher; a comparison review investigates why, and what that outcome reveals about the underlying system, regardless of direction. Because a post-hoc reviewer already knows the outcome, can slice the data in many ways, and often holds a preferred explanation, unguided analysis easily fits a plausible narrative to a single draw of one exam. Modifying the system on that basis overfits it to its evaluation set. A review is strictly read-only: it starts no solves and alters no verdicts; only a fresh comparison demonstrates that a proposed change actually improves performance (rules 1 and 6).

## The stance

Four methodological disciplines counter the failure modes catalogued in [forking-paths](references/forking-paths.md):

1. **Describe before explaining**, inspecting both arms identically before forming any hypothesis.
2. **Treat improvements as a by-product.** Never ask what would have raised the score, which fits the system to the metric; ask instead what is false, broken, or unmeasured.
3. **Keep discovery and confirmation strictly disjoint.** Seal half of the tasks before exploratory reading, mark every closely inspected task as burned, and test any resulting proposal on fresh data.
4. **Propagate findings to the system only as general shapes**, stripped of the benchmark name, score, and direction, so an independent session blinded to the comparison can trace and count each mechanism in the system's own record. Any finding that cannot be expressed this way remains an observation about this comparison alone.

No seat, prompt, or check ever sees the external benchmark, and no system change targets its score.

## Scope

A **campaign comparison** enforces the evaluation boundary and matches conditions by construction, so level 2 reduces to verifying `conditions`; inspect it using `reading`, `replay`, `draw`, and the whole-run investigation lanes. A **`compare-systems`** evaluation varies the solver as well. An **external benchmark** (`studies/harness2/`) uses an independent grader and shares no conditions by construction, requiring the full twelve-step procedure below. Comparisons across differing commits or settings are descriptive only (`AGENTS.md` section 9), and any step detected in an **A/A** control is itself the primary finding.

## The procedure

Store all artefacts in `<dir>` = `.ana/wri/<date>-<subject>-review/` inside the central host's main checkout. Do not begin any step until the preceding step's check passes.

1. **Freeze the ledger** ([the forms](references/report.md)): record the operator's question, everything already inspected, a single primary measure with all others designated secondary, and the arms under comparison. *Check:* record the file's SHA-256 digest (`shasum -a 256`) and timestamp. This digest serves as the sole salt for the sealed split so an inconvenient partition cannot be redrawn.
2. **Seal half of the tasks**: run `bun studies/harness2/compare.ts levels --dataset <dir> --of <arm> --of <arm> --salt <salt>` to assign each task deterministically by hashing the salt with the task name, withholding sealed scores until step 7. A sealed half smaller than a full sweep (six tasks at significance level 0.02) can falsify a directional hypothesis but cannot establish a step. Exclude any task inspected closely before the freeze from step 7's count; if all tasks were already read, the seal is spent and confirmation can come only from step 11. *Check:* verify that sealed task names appear in the ledger with none of their scores disclosed.
3. **Audit the instrument across every task**: levels 0 to 6 of [the levels](references/levels.md) require no outcome scores. A broken lower level can invalidate the comparison and terminate the review early. *Check:* record one ledger row per level with its supporting count.
4. **Inspect the open half**, covering levels 7 to 11 across every task and split, applying the same scrutiny to wins and losses alike. *Check:* verify balanced coverage of both directions, or document why one direction has fewer rows.
5. **Conduct a blind second reading**: launch independent sessions under neutral arm labels with file pointers and open questions only, withholding counts and hypotheses ([the blind brief](references/report.md)), ideally before formulating your own explanation. Agreement on the same dataset does not constitute replication, whereas disagreement is an informative finding. *Check:* verify each session's model from its transcript.
6. **Commit rival explanations**: write at least three competing explanations, including one innocent explanation and one blaming the evaluation instrument, each with a predicted count on the sealed half and an explicit falsifier. *Check:* confirm all explanations are recorded before unsealing.
7. **Unseal once** (`--unseal`, printed as a separate block). Resolve every pre-registered explanation as held, falsified, or unreached by recounting without rewording; any new pattern noticed after unsealing is recorded as an unconfirmable exploratory observation.
8. **Distil shape cards**: write one shape card per surviving finding ([backtrack](references/backtrack.md)), drawing from both winning and losing rows. *Check:* confirm that a blinded reader cannot infer which arm a card favoured, and tabulate card counts by direction in the report.
9. **Backtrack blind**: hand only the shape cards to a fresh session to trace each mechanism to a system owner and count its recurrence across the repository's campaign record. *Check:* verify named owner, count with denominator, and list of logs inspected.
10. **Apply the eight-question gate**: evaluate each card against the eight questions in [backtrack](references/backtrack.md), assigning one disposition per card and listing every dropped card with the question it failed.
11. **Test forward once.** Any surviving lead enters the measuring run's `predictions-<run>.md`, settled by a count in the system's own metric in `outcomes-<run>.md` (unheld rows appear in the run's derived still-missing view beside the plan's "Intentionally opposed" trade-offs), followed by a fresh measured run (`AGENTS.md` section 10, item 9). Evaluate on the external benchmark last, strictly on unburned tasks, with metric and margin fixed in advance. Report any repeated attempt alongside the first, and ablate bundled changes before crediting individual components. Record which burned tasks are excluded and how many attempts the claim has undergone.
12. **Report and record** using [the report form](references/report.md), leading with the operator's answer in `attribution-and-proof` terminology. Track deferred follow-up work in `docs/backlog/<subject>.md`, and explicitly correct any earlier claim that the review refuted.

## Across whole campaigns

Two campaigns executed at different commits, exams, or hosts share no common task set, so a sealed split does not apply. Note this explicitly in the ledger and provide instead:

- a **factor table** listing every variable that changed, naming unrun cells and never crediting a single factor from one campaign;
- **source verification** confirming what each commit actually contains (`bun run runs source --has <text>`);
- **mechanism firing counts** in each log, validated against a hostile log proving the counter can detect the event;
- **replays explicitly labelled as estimates** (`promotion-tuner`, whose `trend.ts` quantifies the inter-run spread that any difference between two campaigns must exceed to go beyond sampling variance);
- **rival explanations with refuting counts**, including host runtime differences (`bun run runs source`);
- **gap localisation** (the gap summary from `comparison-reading/scripts/reading.ts`);
- **an unselected reading**, such as the first post-promotion starter comparison, because promoting comparisons suffer from winner's curse;
- **a fresh evaluation before attributing credit** (`compare-systems`), run on operator approval with its decision rule frozen beforehand.

When `ANA_HOSTS` is unset, readers inspect local snapshots under `data/runs/<host>/<name>` as they stand (`syncRuns` updates them), keeping a review's inputs stable.

## Hard rules

- **Nothing from a review reaches a seat** (rule 3). No report, shape card, rubric, or grader reason enters any prompt, starter, harness, task, or exam. A card that passes the gate either changes host code or raises an operator decision; it never becomes model advice (section 2).
- **No reference answers** (rules 2 and 9): nothing observed from a benchmark's answers or rubrics may become a check, task, or example.
- **Published text cites ids and counts only**: never quote tasks, rubrics, answers, or traces, and never include host names, logins, or credential paths. Never read an env file.
- **Strictly read-only.** Never modify a log, pack, check program, kept harness, or result store.
- **Operator authority applies** to any change in what a solver receives or is told, and to any paid run (section 3). Non-results carry no evidential weight (rules 7 and 15).

## "Was it too strict?"

Level 5 distinguishes three causes, only one of which warrants relaxing a constraint. If **an action was refused**, count refusals across rollouts and check whether the guard protects evaluation honesty (rules 3 to 8) or can safely be relaxed (section 2, consequence 6). If **something was misstated or misexported**, treat it as a straightforward defect. If **selection was narrow**, no comparison rewarded the broader capability; because the Builder is already unconstrained, addressing this requires changing what the exam asks, which is a domain choice for the operator.

## Status

This procedure was motivated by the initial JobBench review (`docs/backlog/jobbench-scoring.md`), which lacked a frozen ledger and sealed split, cited the milder of two scoring granularities, and misattributed a swing across a package change to noise. `studies/harness2/levels.ts` is proved without a model, and `studies/harness2/compare.ts` runs JobBench comparisons under pre-registered terms; the full procedure remains at "present in source" until a review maintains a frozen ledger from step 1.

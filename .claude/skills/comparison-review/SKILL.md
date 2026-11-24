---
name: comparison-review
description: "Use when asked why a harness or system scored higher or lower, why an external benchmark disappointed, whether capability was lost in transfer, whether a difference is noise, or how to improve the system from a comparison result. Analyses identities, conditions, grader visibility, score formation, per-task splits, and rollout noise using a frozen ledger, sealed hold-out split, blind reading, and burned-task tracking, propagating findings only as domain-general shape cards."
---

# Comparison review

Investigates *why* a comparison of harnesses or systems produced its outcome without overfitting to the evaluation set. Strictly read-only: starts no solves and alters no verdicts (rules 1 and 6).

## Four methodological disciplines ([references/forking-paths.md](references/forking-paths.md))

1. **Describe before explaining**: inspect both arms symmetrically across all levels before forming hypotheses.
2. **Ask what is false, broken, or unmeasured** rather than what would raise the score.
3. **Keep discovery and confirmation disjoint**: seal half the tasks via SHA-256 salt before exploratory reading, mark closely inspected tasks as burned, and test resulting changes on fresh runs.
4. **Propagate only domain-general shape cards** stripped of benchmark names, scores, and win/loss direction ([references/backtrack.md](references/backtrack.md)). No review output ever reaches a model seat (rules 2, 3, and 9).

## Twelve-step procedure (`.ana/wri/<date>-<subject>-review/`)

For an internal campaign comparison, conditions match by construction (use [comparison-reading](../comparison-reading/SKILL.md)'s `reading.ts` and `draw.ts`, [promotion-tuner](../promotion-tuner/SKILL.md)'s `replay.ts`, and [whole-run-investigation](../whole-run-investigation/SKILL.md) lanes). For an external benchmark (`studies/harness2/`) or cross-system comparison, execute all twelve steps in order:

1. **Freeze the ledger** ([references/report.md](references/report.md)): record the question, prior inspections, primary measure, and arms, then record the file's SHA-256 digest (`shasum -a 256`), which serves as `--salt`.
2. **Seal half the tasks**: `bun studies/harness2/compare.ts levels --dataset <dir> --of <arm> --of <arm> --salt <sha256>` (withholds sealed scores until step 7; exclude tasks already inspected before the freeze).
3. **Audit the instrument (levels 0–6 of [references/levels.md](references/levels.md))**: check identities, conditions, export fidelity, truncation (`CUT <n>`), and grader behaviour without reading outcome scores. On cross-OS external reads, separate three propagation layers symmetrically across arms—OS/platform port integrity (`studies/shared/foreign-python.ts`, `src/harness/place.ts`), runtime translation (`pi-durable` via `runs bench --pi` vs exported clients), and campaign-workspace coupling (`.toolchain/bin` external call rates vs guide drag)—before attributing a deficit.
4. **Inspect the open half (levels 7–11)**: examine per-task splits, tool usage, and rollout variance symmetrically across wins and losses.
5. **Conduct a blind second reading**: launch independent read-only sessions under neutral arm labels with file pointers and open questions only ([references/report.md](references/report.md)).
6. **Commit >=3 rival explanations** (including an innocent/noise explanation and an instrument-defect explanation), each with a predicted count and falsifier on the sealed half.
7. **Unseal once** (`--unseal`) and resolve each explanation as `confirmed`, `refuted`, or `not-observed` by recounting without rewording.
8. **Distil shape cards** ([references/backtrack.md](references/backtrack.md)) from both winning and losing rows, stripped of arm identity and direction.
9. **Backtrack blind**: hand only the shape cards to a fresh session to locate owning modules and count recurrence across archived campaign logs.
10. **Apply the eight-question gate** ([references/backtrack.md](references/backtrack.md)), recording the disposition and failed question for any dropped card.
11. **Test forward once**: enter surviving leads as count-based predictions in the next fresh campaign's `predictions-<run>.md`, and evaluate external benchmarks last on unburned tasks.
12. **Report** using [references/report.md](references/report.md) and [attribution-and-proof](../attribution-and-proof/SKILL.md) terminology, logging deferred items in `docs/backlog/<subject>.md`.

For comparisons **across whole campaigns** (which share no task set), replace the sealed split with: a factor table of changed variables, commit source verification (`runs source --has <text>`), mechanism event counts, archive replays ([promotion-tuner](../promotion-tuner/SKILL.md)), gap localisation ([comparison-reading](../comparison-reading/SKILL.md)'s `reading.ts`), unselected starter-comparison readings, and a fresh [compare-systems](../compare-systems/SKILL.md) evaluation when authorised.

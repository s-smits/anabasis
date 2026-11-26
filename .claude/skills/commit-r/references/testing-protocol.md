# Testing, Mutation Verification, and Suite Acceleration

Detailed testing protocol for [commit-r](../SKILL.md) and [simplify](../../simplify/SKILL.md) (`AGENTS.md` §12, `tools/oxlint/HABITS.md` 12.12).

## Surface importance triage

Split mixed compartments (`tools/runs/`, `tools/wri/`, `packages/ui/`, or files mixing decision folds with summary prose) by surface before writing, rewriting, or deleting tests:

| Surface importance | Examples | Testing protocol | Mutation oracle (`mutate.ts`) |
| --- | --- | --- | --- |
| **High-importance owner** | Measurement/scoring/statistics, `decide`/admission/practice/stop state machines, Rule 3 wall & blindness, verifier/acceptance/referee/provenance/OS isolation, locks/refusals/git/landing safety, log durability | Follow `AGENTS.md` §12 in order: (1) bounded exhaustive checks against an independent rule/count (≤~10s via symmetry; cover real cutoffs/production sizes); (2) state-space search with cross-move invariants (never single-row mirrors) or seeded LCG generators counting reached branches; (3) shared perturbation walls and pure invariant/view-model tables; (4) named examples **only** at process/file/provider/OS-wall boundaries, nearest hostile refusal, or real-run regressions | **Required** when deleting or replacing tests (step 8); comparative (`--old`) when prod interface is shared, solo (no `--old`) on new owner files when interface changed |
| **Low-importance / presentation surface** | Report or CLI wording & layout, per-reader/per-lane/per-script formatters, per-rule lint fixtures, browser click-flows, thin wrappers, convenience cases | **Write no new unit tests**; amputate wording/example suites outright, keeping only any wall/blindness, refusal, or numeric-decision boundary inside the file. Rely on types, strict lint, shared runners (`test/rule-examples.test.ts`, `test/lint-registry.test.ts`, view-model tables + smokes), and step 2/8's real-input oracle | **Skip** on pure low-importance amputations; verify surviving boundary tests, `bun run gate`, and real-input oracle/replay instead |

Never write tautological properties (re-implementing the function under test or mirroring single table rows), report-wording assertions, module mocks, fixed sleeps, or test-only exports (`tree/no-test-only-export`). Pin measured constants (`WEIGHTS`, `GAP_FLOOR`, `SIZE`, `PATIENCE`) once.

## Mutation verification

Owned by [mutation-testing](../../mutation-testing/SKILL.md) (`scripts/mutate.ts` and `scripts/nightly.ts`): covers the rewrite-time comparative (`--old`, ≤15% unexplained `O-` bar, zero `unread`) and solo mutation oracles for `commit-r` step 8, standing nightly fleet sweeps, survivor triage, equivalent-mutant retirement, and clone/timeout hygiene.

## Suite acceleration and concurrency edge cases

- **Measure on an idle runner**: rank slow files from an idle runner's `test/.test-timings.json` (`LIVE test/ SUM / workers`), never from a loaded laptop. Keep `ANA_TEST_WORKERS` within core headroom—oversubscribing causes kernel contention and timeout flakes.
- **Parallelise safely**: prefer `describe.concurrent`, async `capturedSpawn` (capped by a small semaphore when fanning out many subprocess cases), cached `Promise` fixture templates (`prepared ??= ...`), and read-only `symlinkSync` instead of repeated `cpSync`.
- **Sequential boundaries**: Bun interleaves consecutive `describe.concurrent` blocks. Keep tests in a plain `describe` (or isolated per-case directories) whenever they mutate `Bun.env` or `spyOn`, share external cost/timestamp windows (such as a shared `shim.jsonl`), or assert tight wall-clock bounds (e.g. `< 4000ms` deadline checks).
- **No speculative runtime shims**: reject process-global bundler or runtime cache layers added solely to speed up tests; fix the owning hot path (single-pass OS scans, lazy CLI imports, bounded pools) or delete redundant work.
- **Strand cleanup**: remove restored old tests from `<copy>`, tighten `tools/oxlint/comment-ratchet.tsv` (`bun .claude/skills/delete-comment/scripts/ratchet.ts --write`) whenever comments shrink, and verify idle-runner before/after timings (bounded checks ≤~10s).

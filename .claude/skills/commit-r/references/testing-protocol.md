# Testing, Mutation Verification, and Suite Acceleration

Detailed testing protocol for [commit-r](../SKILL.md) and [simplify](../../simplify/SKILL.md) (`AGENTS.md` §12, `tools/oxlint/HABITS.md` 12.12).

## Surface importance triage

Split mixed compartments (`tools/runs/`, `tools/wri/`, `packages/ui/`, or files mixing decision folds with summary prose) by surface before writing, rewriting, or deleting tests:

| Surface importance | Examples | Testing protocol | Mutation oracle (`mutate.ts`) |
| --- | --- | --- | --- |
| **High-importance owner** | Measurement/scoring/statistics, `decide`/admission/practice/stop state machines, Rule 3 wall & blindness, verifier/acceptance/referee/provenance/OS isolation, locks/refusals/git/landing safety, log durability | Follow `AGENTS.md` §12 in order: (1) bounded exhaustive checks against an independent rule/count (≤~10s via symmetry; cover real cutoffs/production sizes); (2) state-space search with cross-move invariants (never single-row mirrors) or seeded LCG generators counting reached branches; (3) shared perturbation walls and pure invariant/view-model tables; (4) named examples **only** at process/file/provider/OS-wall boundaries, nearest hostile refusal, or real-run regressions | **Required** when deleting or replacing tests (step 8); comparative (`--old`) when prod interface is shared, solo (no `--old`) on new owner files when interface changed |
| **Low-importance / presentation surface** | Report or CLI wording & layout, per-reader/per-lane/per-script formatters, per-rule lint fixtures, browser click-flows, thin wrappers, convenience cases | **Write no new unit tests**; amputate wording/example suites outright, keeping only any wall/blindness, refusal, or numeric-decision boundary inside the file. Rely on types, strict lint, shared runners (`test/rule-examples.test.ts`, `test/lint-registry.test.ts`, view-model tables + smokes), and step 2/8's real-input oracle | **Skip** on pure low-importance amputations; verify surviving boundary tests, `bun run gate`, and real-input oracle/replay instead |

Never write tautological properties (re-implementing the function under test or mirroring single table rows), report-wording assertions, module mocks, fixed sleeps, or test-only exports (`tree/no-test-only-export`). Pin measured constants (`WEIGHTS`, `GAP_FLOOR`, `SIZE`, `PATIENCE`) once.

## Mutation verification (`scripts/mutate.ts`)

```sh
bun .claude/skills/commit-r/scripts/mutate.ts list <copy> <files...> # or $(git diff --name-only <base> -- src)
bun .claude/skills/commit-r/scripts/mutate.ts run <copy> <files...> --out <scratchpad>/kills.jsonl --suites <suites.json> --jobs 4 --stop-at-kill --timeout 120
bun .claude/skills/commit-r/scripts/mutate.ts report <scratchpad>/kills.jsonl [--old old] [--survivors]
```

- **Execution hygiene**: `mutate.ts` spawns `bun test --bail --max-concurrency=4` locally with `ANA_RUNNER_ACTIVE=1 ANA_CHECK_HOST=here` (bypassing the check router), refuses immediately if any baseline suite fails unmutated, and skips recorded IDs on resume. Keep `--jobs` at ~1/3 of local cores (default `4`) so interactive work stays responsive; use `--only <ids>` on reruns after closing gaps.
- **Oracle copy hygiene**: initialise `<copy>` as a git repo (`git init` + commit) when tests exercise git or `treeFault` guards; lower multi-minute `setDefaultTimeout` values on `<copy>` (e.g. `600_000` → `60_000`) so deadlocking mutants fail on the per-test timeout: a run `--timeout` ends records no verdict (`unread`), since parallel jobs push slow unmutated suites past it. Size `--timeout` above each suite's loaded duration. For filesystem-mutating code, test first on a `cp -cRp` copy-on-write clone with retargeted symlinks/gitdirs.
- **Comparative mode (`--old`, Test pass or interface-preserving Rewrite)**: run `old`, `new`, and `kept` suites on `<copy>` with old tests restored. Classify every `O-` survivor as either (a) a **genuine invariant/boundary gap** — close by strengthening a bounded check, property, or hostile boundary case (never paste back old example boilerplate) — or (b) **intentionally retired / incidental** (report wording, CLI formatting, convenience case, dead path) — record as retired in the commit message. Leaving **>15% of `O-` survivors unexplained** halts the pass.
- **Solo mode (interface-changing Rewrite)**: never mix incompatible `old` and `new` suites on one copy. Run `mutate.ts` on the new high-importance owner files against `new` + `kept` (`report` without `--old`), inspect `--survivors`, and close surviving mutants on critical decision, wall, or refusal branches.

## Suite acceleration and concurrency edge cases

- **Measure on an idle runner**: rank slow files from an idle runner's `test/.test-timings.json` (`LIVE test/ SUM / workers`), never from a loaded laptop. Keep `ANA_TEST_WORKERS` within core headroom—oversubscribing causes kernel contention and timeout flakes.
- **Parallelise safely**: prefer `describe.concurrent`, async `capturedSpawn` (capped by a small semaphore when fanning out many subprocess cases), cached `Promise` fixture templates (`prepared ??= ...`), and read-only `symlinkSync` instead of repeated `cpSync`.
- **Sequential boundaries**: Bun interleaves consecutive `describe.concurrent` blocks. Keep tests in a plain `describe` (or isolated per-case directories) whenever they mutate `Bun.env` or `spyOn`, share external cost/timestamp windows (such as a shared `shim.jsonl`), or assert tight wall-clock bounds (e.g. `< 4000ms` deadline checks).
- **No speculative runtime shims**: reject process-global bundler or runtime cache layers added solely to speed up tests; fix the owning hot path (single-pass OS scans, lazy CLI imports, bounded pools) or delete redundant work.
- **Strand cleanup**: remove restored old tests from `<copy>`, tighten `tools/oxlint/comment-ratchet.tsv` (`bun .claude/skills/delete-comment/scripts/ratchet.ts --write`) whenever comments shrink, and verify idle-runner before/after timings (bounded checks ≤~10s).

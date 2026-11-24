---
name: commit-r
description: "Use before rewriting, overhauling, rebuilding, or accelerating a single compartment, amputating low-value unit tests, or consolidating high-importance suites into bounded/property checks, or within an authorised change when the current shape requires another special case. Pairs existing code and real-input oracles with importance-triaged testing (AGENTS.md §12), scoped mutation verification on high-importance owners, and empirical prior triage against real campaign logs. Whole-stack overhauls belong to stack-pr and consolidate-stack."
---

# Commit R

Isolates one compartment, retains existing code and real inputs as a behavioural oracle, and replaces it with the minimal owner satisfying the required outcomes ([simplify](../simplify/SKILL.md) routes structural rewrites here; [reduce-complexity](../reduce-complexity/SKILL.md) owns `measure.py --base <ref>`).

## Testing protocol: fewer unit tests, concentrated on high-importance owners

Before writing, rewriting, or mutating tests, triage **each surface/owner** inside the compartment (`AGENTS.md` §12, `tools/oxlint/HABITS.md` 12.12). Mixed compartments (such as `tools/runs/`, `tools/wri/`, `packages/ui/`, or a file mixing decision folds with summary prose) split by surface: amputate presentation tests and keep or upgrade only the high-importance boundaries.

| Surface importance | Examples | Testing protocol | Mutation oracle (`mutate.ts`) |
| --- | --- | --- | --- |
| **High-importance owner** | Measurement/scoring/statistics, `decide`/admission/practice/stop state machines, Rule 3 wall & blindness, verifier/acceptance/referee/provenance/OS isolation, locks/refusals/git/landing safety, log durability | Follow `AGENTS.md` §12 in order: (1) bounded exhaustive checks against an independent rule/count (≤~10s via symmetry; cover real cutoffs/production sizes); (2) state-space search with cross-move invariants (never single-row mirrors) or seeded LCG generators counting reached branches; (3) shared perturbation walls and pure invariant/view-model tables; (4) named examples **only** at process/file/provider/OS-wall boundaries, nearest hostile refusal, or real-run regressions | **Required** when deleting or replacing tests (step 8); comparative (`--old`) when prod interface is shared, solo (no `--old`) on new owner files when interface changed |
| **Low-importance / presentation surface** | Report or CLI wording & layout, per-reader/per-lane/per-script formatters, per-rule lint fixtures, browser click-flows, thin wrappers, convenience cases | **Write no new unit tests**; amputate wording/example suites outright, keeping only any wall/blindness, refusal, or numeric-decision boundary inside the file. Rely on types, strict lint, shared runners (`test/rule-examples.test.ts`, `test/lint-registry.test.ts`, view-model tables + smokes), and step 2/8's real-input oracle | **Skip** on pure low-importance amputations; verify surviving boundary tests, `bun run gate`, and real-input oracle/replay instead |

Never write tautological properties (re-implementing the function under test or mirroring single table rows), report-wording assertions, module mocks, fixed sleeps, or test-only exports (`tree/no-test-only-export`). Pin measured constants (`WEIGHTS`, `GAP_FLOOR`, `SIZE`, `PATIENCE`) once.

## Three kinds of pass

Declare the pass type, compartment importance, and complexity budget (`python3 .claude/skills/reduce-complexity/scripts/measure.py <files...>`) in the commit body of the first `R:` commit (the **frame**: compartment, importance tier, rule-13 concept map, hypothesis and falsifier, prod + test line/branch/export budget, and boundaries):

- **Rewrite** (changes an observable outcome or interface): remove old tests (`R: <test paths>`); for **high-importance** owners commit concise property/boundary tests *before* deleting production code (classifying failures against old production code), or for **low-importance** surfaces skip new unit tests and lean on the real-input oracle; remove old production files (`R: <production paths>`), implement the minimal owner, and verify against the oracle (step 8).
- **Refold** (preserves every observable output): keep existing boundary/property tests untouched (pruning only implementation-pinning or wording tests that block the refold), skip test replacement, and verify byte-identical output against the oracle on real inputs.
- **Test pass** (keeps production logic unchanged — or with minimal boundary tuning — while shrinking and upgrading tests per `AGENTS.md` §12): either **amputate** low-importance wording/example suites outright, or **replace** high-importance example suites with bounded checks, state-space search, perturbation walls, or invariant tables. Target **≥~50% net test-line reduction** and **≤~10s** per bounded check; new tests pass against unchanged production code, and high-importance replacements clear step 8's mutation oracle.

## Nine-step sequence

1. **Clean base**: commit work in flight in a dedicated worktree at the stack top ([stack-pr](../stack-pr/SKILL.md)).
2. **Capture the oracle**: run existing tests and record read-only outputs on real inputs (`bun run runs replay`, `runs rehearse`, `--dry-run`, or a scratch reader) in the scratchpad. For behavioural rewrites or multi-commit overhauls, launch empirical prior triage in parallel (see below).
3. **`R: <test paths>`** *(Rewrite / Test pass)*: `git rm` old tests and commit with the frame.
4. **Write high-importance tests — or skip** *(Rewrite / Test pass)*: on **low-importance** surfaces, write zero new unit tests (keep only boundary/wall/refusal assertions). On **high-importance** owners, write the minimal space-based or boundary suite per the protocol table above, run against old production code, classify every failure (expected compile/import failure if signatures change; runtime failures where signatures match), and commit. Never inflate test LOC on a rewrite unless closing a newly proved high-importance boundary.
5. **Design minimal owner** *(Rewrite / Refold)*: apply `simplify`'s shapes (H1–H11, including H10 test/fixture bloat) and ladder, dropping concepts with a broken rule-13 link, and incorporate prior-triage findings before editing (deviate fully from initial priors when real-run evidence points to better terms).
6. **`R: <production paths>`** *(Rewrite)*: `git rm` replaced production files and commit.
7. **Implement & clean the strand** *(Rewrite / Refold; strand check on Test pass too)*: implement the minimal owner, then verify `bun run typecheck`, `bun run lint -- --strict`, `bun tools/loc/source-policy.ts`, `bun run simplify -- --gate`, and affected suites (`bun run test -- <paths>`). On **Test passes**, unexport any production symbols that became test-only (`source-policy.ts` / `tree/no-test-only-export`) and delete orphaned test helpers. Never drop a required boundary to meet a line budget. When an overhaul spans multiple ordered commits, simulate each commit at the cheapest tier ([system-path-simulation](../system-path-simulation/SKILL.md)) before advancing, and send refined diffs to the same triage subagent for updated priors and cross-boundary checks.
8. **Verify against the oracle**:
   - Diff outputs on step 2's real inputs (empty diff for refolds; only intended diffs for rewrites) and close any open triage findings on the final diff.
   - Scope `mutate.ts` by pass kind (`list` first to size the run; `run` refuses immediately if any suite fails unmutated; use `--only <ids>` on reruns after closing gaps):
     ```sh
     bun .claude/skills/commit-r/scripts/mutate.ts list <copy> <files...> # or $(git diff --name-only <base> -- src)
     bun .claude/skills/commit-r/scripts/mutate.ts run <copy> <files...> --out <scratchpad>/kills.jsonl --suites <suites.json> --jobs 6 --stop-at-kill
     bun .claude/skills/commit-r/scripts/mutate.ts report <scratchpad>/kills.jsonl [--old old] [--survivors]
     ```
     - **Test pass or interface-preserving Rewrite (high-importance owner)**: run comparative `old`, `new`, and `kept` suites on a `<base>` copy with old tests restored (`report --old old`). Classify every `O-` survivor into (a) **genuine invariant/boundary gap** — close by strengthening a bounded check, property, or hostile boundary case (never paste back old example boilerplate) — or (b) **intentionally retired / incidental** (report wording, CLI formatting, convenience case, dead path) — record as retired in the commit message instead of restoring a low-value test. Leaving **>15% of `O-` survivors unexplained** halts the pass.
     - **Interface-changing Rewrite (high-importance owner)**: never mix incompatible `old` and `new` suites on one copy. Run solo `mutate.ts` on the **new** high-importance owner files against `new` + `kept` (`report` without `--old`), inspect `--survivors`, and close surviving mutants on critical decision, wall, or refusal branches.
     - **Pure low-importance amputation**: skip `mutate.ts`; verify surviving boundary tests, `bun run gate`, and real-input oracle/replay instead.
     Remove restored old tests from the copy and verify alternating old/new timings at least twice (bounded checks ≤~10s). (For filesystem-mutating code, test first on a `cp -cRp` copy-on-write clone with retargeted symlinks/gitdirs.)
9. **Measure and squash**: run `python3 .claude/skills/reduce-complexity/scripts/measure.py --base <base>` and `git complexity <base> HEAD`, inspect the full `git diff <base>` with fresh eyes (confirming concepts, branches, and net test/prod lines actually shrank), save `git branch commit-r/<compartment> HEAD`, `git reset --soft <base>`, run `bun run commit:check`, and create a single squashed commit recording the frame, before/after prod + test metrics, oracle results, and mutation counts (closed vs intentionally retired `O-` survivors). No separate `/simplify` pass is needed after Commit R.

## Empirical prior triage

Mechanical oracles verify preservation and high-importance test coverage; for **behavioural rewrites** (prompts, acceptance/verifier gates, scoring/decision rules, or redesigned high-importance test invariants), pair them with empirical prior triage against `data/runs/` and coupled adjacent files ([references/prior-triage.md](references/prior-triage.md)). Skip this for pure byte-identical refolds and low-importance test amputations.

- **Execution & model**: when subagent delegation is authorised by the operator or session config, launch **one persistent strictly read-only subagent**: `claude-opus-5-5` at `medium` effort in Claude sessions, or `gemini-4-neon` at `medium` effort (`research` subagent) in Gemini/Antigravity sessions (no write tools, no paid models, no `.env`, no `advisor`). When subagents are disabled, execute the same triage checklist inline before locking the design.
- **Persistent loop**: brief your explicit initial priors and invite the subagent to refute or redirect them with primary-source `k/N` counts; keep the **same** subagent alive across build/tune iterations via follow-up messages to backtrack agent behaviour on refined diffs and validate coupled adjacent files (`VALIDATED` | `REQUIRES CO-TUNING` | `CONFLICT / REVISED`). Deviate fully whenever real-run evidence overturns initial terms.

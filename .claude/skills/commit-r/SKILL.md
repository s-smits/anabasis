---
name: commit-r
description: "Use before rewriting, overhauling, rebuilding, or accelerating a single compartment, amputating low-value unit tests, or consolidating high-importance suites into bounded/property checks, or within an authorised change when the current shape requires another special case. Pairs existing code and real-input oracles with importance-triaged testing (AGENTS.md §12), scoped mutation verification on high-importance owners, and empirical prior triage against real campaign logs. Whole-stack overhauls belong to stack-pr and consolidate-stack."
---

# Commit R

Isolates one compartment, retains existing code and real inputs as a behavioural oracle, and replaces it with the minimal owner satisfying the required outcomes ([simplify](../simplify/SKILL.md) routes structural rewrites here; [reduce-complexity](../reduce-complexity/SKILL.md) owns `measure.py --base <ref>`).

## Three kinds of pass

Declare the pass type, compartment importance, and complexity budget (`python3 .claude/skills/reduce-complexity/scripts/measure.py <files...>`) in the commit body of the first `R:` commit (the **frame**: compartment, importance tier, rule-13 concept map, hypothesis and falsifier, prod + test line/branch/export budget, and boundaries):

- **Rewrite** (changes an observable outcome or interface): remove replaced tests (`R: <test paths>`); for **high-importance** owners commit concise property/boundary checks before deleting production code (classifying failures against old code), or for **low-importance** surfaces rely on the real-input oracle; remove old production files (`R: <production paths>`), implement the minimal owner, and verify against the oracle (step 8).
- **Refold** (preserves every observable output): keep existing boundary/property checks untouched (pruning only implementation-pinning wording assertions that block the refold), and verify byte-identical output against the oracle on real inputs.
- **Test pass** (keeps production logic unchanged or with minimal hot-path tuning while shrinking and accelerating suites per `AGENTS.md` §12): amputate low-importance wording/example suites outright, or replace high-importance example suites with space-based checks and safe concurrency targeting ≥~50% net line reduction and ≤~10s per bounded check ([references/testing-protocol.md](references/testing-protocol.md)).

## Nine-step sequence

1. **Clean base**: commit work in flight in a dedicated worktree at the stack top ([stack-pr](../stack-pr/SKILL.md)).
2. **Capture the oracle**: run existing checks and record read-only outputs on real inputs (`bun run runs replay`, `runs rehearse`, `--dry-run`, idle-runner `test/.test-timings.json`, or a scratch reader) in the scratchpad. For behavioural rewrites or multi-commit overhauls, launch empirical prior triage in parallel (see below).
3. **`R: <test paths>`** *(Rewrite / Test pass)*: `git rm` replaced suites and commit with the frame.
4. **Triage and write boundaries — or skip** *(Rewrite / Test pass)*: split mixed compartments by surface importance ([references/testing-protocol.md](references/testing-protocol.md)). Write zero new unit checks on low-importance/presentation surfaces; on high-importance owners write minimal space-based or boundary checks, run against old production code, classify every failure, and commit. Never inflate test LOC unless closing a newly proved high-importance boundary.
5. **Design minimal owner** *(Rewrite / Refold)*: apply `simplify`'s shapes (H1–H11) and ladder, dropping concepts with a broken rule-13 link, rejecting speculative runtime bundler/cache shims in favour of fixing the owning hot path, and incorporating prior-triage findings before editing (deviate fully from initial priors when real-run evidence points to better terms).
6. **`R: <production paths>`** *(Rewrite)*: `git rm` replaced production files and commit.
7. **Implement & clean the strand** *(all passes)*: implement the minimal owner, then verify `bun run typecheck`, `bun run lint -- --strict`, `bun tools/loc/source-policy.ts`, `bun run simplify -- --gate`, and affected suites (`bun run test -- <paths>`). Unexport symbols that became test-only (`tree/no-test-only-export`), delete orphaned helpers, and tighten `tools/oxlint/comment-ratchet.tsv` (`ratchet.ts --write`) whenever comments drop. Never drop a required boundary to meet a line budget. When an overhaul spans multiple ordered commits, simulate each commit at the cheapest tier ([system-path-simulation](../system-path-simulation/SKILL.md)) before advancing, and send refined diffs to the same triage subagent for updated priors and cross-boundary checks.
8. **Verify against the oracle**:
   - Diff outputs on step 2's real inputs (empty diff for refolds; only intended diffs for rewrites) and close any open triage findings on the final diff.
   - When deleting or replacing high-importance owner suites, run the [mutation-testing](../mutation-testing/SKILL.md) oracle (`scripts/mutate.ts`: `list` → `run --stop-at-kill --timeout 120` → `report [--old old] --survivors`): close genuine invariant/boundary gaps, record intentionally retired incidental wording survivors (>15% unexplained halts the pass), and verify idle-runner timings. Skip `mutate.ts` on pure low-importance amputations.
9. **Measure and squash**: run `python3 .claude/skills/reduce-complexity/scripts/measure.py --base <base>` and `git complexity <base> HEAD`, inspect the full `git diff <base>` with fresh eyes (confirming concepts, branches, and net prod/test lines actually shrank), save `git branch commit-r/<compartment> HEAD`, `git reset --soft <base>`, run `bun run commit:check`, and create a single squashed commit recording the frame, before/after prod + test metrics, oracle results, and mutation counts (closed vs intentionally retired `O-` survivors). No separate `/simplify` pass is needed after Commit R.

## Empirical prior triage

Mechanical oracles verify preservation and high-importance boundary coverage; for **behavioural rewrites** (prompts, acceptance/verifier gates, scoring/decision rules, or redesigned high-importance invariants), pair them with empirical prior triage against `data/runs/` and coupled adjacent files ([references/prior-triage.md](references/prior-triage.md)). Skip this for pure byte-identical refolds and low-importance amputations.

- **Execution & model**: when subagent delegation is authorised by the operator or session config, launch **one persistent strictly read-only subagent**: `claude-opus-5-5` at `medium` effort in Claude sessions, or `gemini-4-neon` at `medium` effort (`research` subagent) in Gemini/Antigravity sessions (no write tools, no paid models, no `.env`, no `advisor`). When subagents are disabled, execute the same triage checklist inline before locking the design.
- **Persistent loop**: brief your explicit initial priors and invite the subagent to refute or redirect them with primary-source `k/N` counts; keep the **same** subagent alive across build/tune iterations via follow-up messages to backtrack agent behaviour on refined diffs and validate coupled adjacent files (`VALIDATED` | `REQUIRES CO-TUNING` | `CONFLICT / REVISED`). Deviate fully whenever real-run evidence overturns initial terms.

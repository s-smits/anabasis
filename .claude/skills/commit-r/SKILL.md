---
name: commit-r
description: "Use before rewriting, overhauling, rebuilding, or accelerating a single compartment or consolidating its unit tests, or within an authorised change when the current shape requires another special case. Rewrites using existing code or tests as a behavioural oracle (test-first on interface change, oracle-verified refold on preserved output, or mutant-verified test pass), paired with empirical prior triage against real campaign logs and coupled boundary files for behavioural overhauls. Whole-stack overhauls belong to stack-pr and consolidate-stack."
---

# Commit R

Isolates one compartment, retains the existing code and tests as a behavioural oracle, and replaces it with the minimal implementation satisfying the required outcomes ([simplify](../simplify/SKILL.md) routes structural rewrites here; [reduce-complexity](../reduce-complexity/SKILL.md) measures before-and-after metrics).

## Three kinds of pass

Declare the pass type and complexity budget (`.claude/skills/reduce-complexity/scripts/measure.py <files...>`) in the commit body of the first `R:` commit (the **frame**: compartment, rule-13 concept map, hypothesis and falsifier, line/branch/export budget, and boundaries):

- **Rewrite** (changes an observable outcome or interface): remove old tests (`R: <test paths>`), commit new behavioural tests *before* deleting production code (classifying failures against old production code), remove old production files (`R: <production paths>`), implement minimal production code, and verify against the oracle (step 8).
- **Refold** (preserves every observable output): keep existing tests untouched, skip test replacement, and verify byte-identical output against the oracle on real inputs.
- **Test pass** (keeps production logic unchanged, replacing example tests with bounded checks and properties per `AGENTS.md` section 12): new tests must pass against unchanged production code, and step 8's mutation oracle verifies coverage.

## Nine-step sequence

1. **Clean base**: commit work in flight in a dedicated worktree at the stack top ([stack-pr](../stack-pr/SKILL.md)).
2. **Capture the oracle**: run existing tests and record read-only outputs on real inputs (`bun run runs replay`, `runs rehearse`, `--dry-run`, or a scratch reader) in the scratchpad. For behavioural rewrites or multi-commit overhauls, launch empirical prior triage in parallel (see below).
3. **`R: <test paths>`** *(Rewrite / Test pass)*: `git rm` old tests and commit with the frame.
4. **Write behavioural tests** *(Rewrite / Test pass)*: assert outcomes rather than internal structure (`tools/oxlint/HABITS.md` 12.12), run against old production code, classify every failure, and commit.
5. **Design minimal owner** *(Rewrite / Refold)*: apply `simplify`'s shapes and ladder, dropping concepts with a broken rule-13 link, and incorporate prior-triage findings before editing (deviate fully from initial priors when real-run evidence points to better terms).
6. **`R: <production paths>`** *(Rewrite)*: `git rm` replaced production files and commit.
7. **Implement production code** *(Rewrite / Refold)*: verify `bun run typecheck`, `bun run lint -- --strict`, `bun tools/loc/source-policy.ts`, and all tests importing the compartment. Never drop a required boundary to meet a line budget. When an overhaul spans multiple ordered commits, simulate each commit at the cheapest tier ([system-path-simulation](../system-path-simulation/SKILL.md)) before advancing, and send refined diffs to the same triage subagent for updated priors and cross-boundary checks.
8. **Verify against the oracle**:
   - Diff outputs on step 2's real inputs (empty diff for refolds; only intended diffs for rewrites) and close any open triage findings on the final diff.
   - When deleting or replacing tests, run syntactic mutation testing across `old`, `new`, and `kept` suites in a base-commit worktree copy with the old tests restored:
     ```sh
     bun .claude/skills/commit-r/scripts/mutate.ts run <copy> <files...> --out <scratchpad>/kills.jsonl --suites <suites.json> --jobs 6 --stop-at-kill
     bun .claude/skills/commit-r/scripts/mutate.ts report <scratchpad>/kills.jsonl --old old [--survivors]
     ```
     Every `O-` survivor (killed by `old` alone) must be covered by a restored test case or justified in the commit message as incidental (leaving >15% unexplained halts the pass). Trash restored old tests and benchmark alternating old/new timings at least twice. (For filesystem-mutating code, test first on a `cp -cRp` copy-on-write clone with retargeted symlinks/gitdirs.)
9. **Measure and squash**: run `measure.py` and `git complexity <base> HEAD`, save `git branch commit-r/<compartment> HEAD`, `git reset --soft <base>`, run `bun run commit:check`, and create a single squashed commit recording the frame, before/after metrics, oracle results, and mutation counts. No separate `/simplify` pass is needed after Commit R.

## Empirical prior triage

Mechanical oracles verify preservation and test coverage; for **behavioural rewrites** (prompts, acceptance/verifier gates, scoring/decision rules, or redesigned test invariants), pair them with empirical prior triage against `data/runs/` and coupled adjacent files ([references/prior-triage.md](references/prior-triage.md)). Skip this for pure byte-identical refolds.

- **Execution & model**: when subagent delegation is authorised by the operator or session config, launch **one persistent strictly read-only subagent**: `claude-opus-5-5` at `medium` effort in Claude sessions, or `gemini-4-neon` at `medium` effort (`research` subagent) in Gemini/Antigravity sessions (no write tools, no paid models, no `.env`, no `advisor`). When subagents are disabled, execute the same triage checklist inline before locking the design.
- **Persistent loop**: brief your explicit initial priors and invite the subagent to refute or redirect them with primary-source `k/N` counts; keep the **same** subagent alive across build/tune iterations via follow-up messages to backtrack agent behaviour on refined diffs and validate coupled adjacent files (`VALIDATED` | `REQUIRES CO-TUNING` | `CONFLICT / REVISED`). Deviate fully whenever real-run evidence overturns initial terms.

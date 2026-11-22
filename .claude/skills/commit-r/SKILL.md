---
name: commit-r
description: "Rewrite a single Anabasis compartment using the existing code or test suite as a behavioural oracle: test-first when an outcome or interface changes, as an oracle-verified refold when every output is preserved, or as a test pass verified by mechanical mutants when example tests give way to bounded checks and properties. Use when asked to rewrite, overhaul, rebuild, or accelerate code or tests, consolidate unit tests, or run Commit R; also within an authorised change when the existing shape requires another special case or a smaller set of owners would achieve the same behaviour. Whole-stack overhauls belong to stack-pr and consolidate-stack."
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
2. **Capture the oracle**: run existing tests and record read-only outputs on real inputs (`bun run runs replay`, `runs rehearse`, `--dry-run`, or a scratch reader) in the scratchpad.
3. **`R: <test paths>`** *(Rewrite / Test pass)*: `git rm` old tests and commit with the frame.
4. **Write behavioural tests** *(Rewrite / Test pass)*: assert outcomes rather than internal structure (`tools/oxlint/HABITS.md` 12.12), run against old production code, classify every failure, and commit.
5. **Design minimal owner** *(Rewrite / Refold)*: apply `simplify`'s shapes and ladder, dropping concepts with a broken rule-13 link.
6. **`R: <production paths>`** *(Rewrite)*: `git rm` replaced production files and commit.
7. **Implement production code** *(Rewrite / Refold)*: verify `bun run typecheck`, `bun run lint -- --strict`, `bun tools/loc/source-policy.ts`, and all tests importing the compartment. Never drop a required boundary to meet a line budget.
8. **Verify against the oracle**:
   - Diff outputs on step 2's real inputs (empty diff for refolds; only intended diffs for rewrites).
   - When deleting or replacing tests, run syntactic mutation testing across `old`, `new`, and `kept` suites in a base-commit worktree copy with the old tests restored:
     ```sh
     bun .claude/skills/commit-r/scripts/mutate.ts run <copy> <files...> --out <scratchpad>/kills.jsonl --suites <suites.json> --jobs 6 --stop-at-kill
     bun .claude/skills/commit-r/scripts/mutate.ts report <scratchpad>/kills.jsonl --old old [--survivors]
     ```
     Every `O-` survivor (killed by `old` alone) must be covered by a restored test case or justified in the commit message as incidental (leaving >15% unexplained halts the pass). Trash restored old tests and benchmark alternating old/new timings at least twice. (For filesystem-mutating code, test first on a `cp -cRp` copy-on-write clone with retargeted symlinks/gitdirs.)
9. **Measure and squash**: run `measure.py` and `git complexity <base> HEAD`, save `git branch commit-r/<compartment> HEAD`, `git reset --soft <base>`, run `bun run commit:check`, and create a single squashed commit recording the frame, before/after metrics, oracle results, and mutation counts. No separate `/simplify` pass is needed after Commit R.

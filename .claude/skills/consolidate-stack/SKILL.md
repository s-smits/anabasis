---
name: consolidate-stack
description: "Use when asked to consolidate, regroup, fold, shrink, or overhaul an open PR stack into fewer, simpler pull requests—either via zero-rewrite adjacent folds or deep 90%-outcome simplification. Computes file-overlap and churn ratios, routes Mode A vs Mode B using ana/commit cache and session ownership, delegates group surface cuts to simplify/commit-r, enforces export/lint/ledger ordering edges, trials on a scratch worktree, and publishes via republish.ts. Single-PR placement belongs to stack-pr; one-compartment rewrites belong to commit-r."
---

# Consolidate the stack

Rewrites an incrementally grown PR stack so each surviving PR resolves a coherent problem set with minimal machinery. Requires operator authorisation when rewriting or absorbing other sessions' branches (`AGENTS.md` §11) and never merges ([stack-pr](../stack-pr/SKILL.md) §5).

## 1. Pre-pass: catalogue & measure overlap

Inspect bottom-to-top without overflowing GitHub's 500k GraphQL node limit (`gh pr list --json commits` fails on deep stacks):
- Run `bun .claude/skills/consolidate-stack/scripts/analyze.ts` (one lightweight `gh pr list` + local `git diff --numstat`) for the chain topology, side PRs, per-PR spans, file-overlap matrix, gross/net churn ratios, and cache/ordering warnings.
- Record per PR: **Problem** (one sentence; `"none stated"` is a finding), **Evidence** (event/test/refusal/review, rule 13), **Owner & tier** (`I0`/`I1` bottom, `I2` middle, `I3` top), **Session boundary**, **`ana/commit` status**, and **`"Not done"`**. Every listed problem must be resolved or listed under `"Not done"` in a survivor.
- Measure complexity hotspots on target groups via `python3 .claude/skills/reduce-complexity/scripts/measure.py --base <group-base>` or `stack-complexity.py --per-file` (nonblank lines, decisions, exports, prompt bytes).

## 2. Route Mode A (Adjacent Fold) vs Mode B (Deep Simplification)

Respect `tools/runtime/gate.ts:contentKey`: adjacent folds preserve commit trees (`0` invalidated `ana/commit` passes), whereas rewriting or reordering commit `k` invalidates `k` and every commit above it (editing `tools/runtime/gate.ts` or its transitive imports changes `checkerDigest`, invalidating every cached pass in that landing).

- **Mode A — Zero-Rewrite Adjacent Fold** for other sessions' proved green PRs, low-churn clean groups, active landings, or release slicing: fold contiguous PRs by pointing one survivor at the group-top SHA unchanged (`0` rewrites, `0` re-proofs). Record deferred simplification targets under `"Not done"` in the survivor's body.
- **Mode B — Deep 90%-Outcome Simplification** when our slice shows `>= 1.3x` gross/net churn, `>= 3` PRs patching one owner, defensive escalation, duplicate readers, or sharp complexity jumps. Rewrite only from the lowest changed own PR upward so lower proved prefixes stay cached.

## 3. Rethink combined surfaces (90%+ outcome, massively simpler)

Treat each Mode B group as **one surface** via [simplify](../simplify/SKILL.md) (`H1`–`H11`, Revert-to-Minimal Probe, Ladder Rung 6), optimising net simplicity over lossless history:

1. **Trade tail defense (`<=5–10%`) for `>=40–50%` less machinery**: question custom lexers, speculative edge branches, and layered checks whenever a higher layer (`openVerifier` OS sandbox, `answerFormat` JSON Schema, Referee probes, or operator gates) already catches real failures. State every sacrificed edge case, its higher-layer backstop, and its falsifier in `"Not done"`; never delete blindly without problem-table grounding.
2. **Collapse add-retune-revert sequences (`H2`, `H4`)**: when PR `k` adds a workaround and `k+m` reverts or moves it upstream, write the final upstream shape once on `<group-base>` and drop transitional code and synthetic puzzle tests (`H10`).
3. **Replace glue with native primitives & single folds (`H3`, `H6`)**: use `Bun.Transpiler`, runtime/OS flags, and shared production folds in place of parallel scanners.
4. **Preserve load-bearing invariants**: wall byte-identity (`seat-view.ts`), historical `EVENT_KINDS`, and behavioral outcome tests (rewrite `I0`/`I1` through [commit-r](../commit-r/SKILL.md) with original PRs as oracle + `mutate.ts`).

Mark each member `keep` | `simplify` | `merge` | `rewrite` | `drop`; verify `measure.py --base <group-base>` and `git complexity` before/after (report `"regroup only"` if flat).

## 4. Order dependencies & trial on a detached worktree

Target 5–10 groups (`I0`/`I1` -> `I2` -> `I3`), enforcing three hard edges (overriding tier defaults when needed):
- **Gates above judged sites**: violation fixes stay beneath the lint rule promoting them.
- **Ledger rows (`tools/oxlint/not-slop.tsv`) above their rule**: rebuild reordered deltas via `formatLedger` (`tools/oxlint/not-slop-ledger.ts`) or `bun run not-slop -- prune`, holding rows until their rule arrives (`.gitattributes` `merge=union` silently creates stale rows without git conflicts).
- **Exports with first external reader**: `bun run simplify -- --gate` (`tree/no-unused-export`) fails intermediate commits exporting symbols across `AUTHORED_ROOTS` before an external caller exists.

Trial on `git worktree add --detach ../anabasis-regroup-trial origin/main`:
- Cherry-pick groups in order; run `bun run typecheck && bun run lint -- --strict && bun tools/loc/source-policy.ts && bun run simplify -- --gate` at every group head.
- Require `git diff --quiet <new top> <published top>` for Mode A regroups.

## 5. Review, assemble & republish

1. Run read-only per-group reviews ([codex-gpt-swarm](../codex-gpt-swarm/SKILL.md): 2 cross-family for `I0`/`I1`, 2 for `I2`, 1 for `I3`), checking every finding at source (`AGENTS.md` §11).
2. Rebase/rewrite in per-group lanes from one common base, autosquash (`git branch consolidate/pre HEAD`; confirm `git diff consolidate/pre HEAD` is empty), then verify every commit:
   ```sh
   git rebase --exec 'bun run typecheck && bun tools/loc/source-policy.ts' origin/main
   ```
3. Pick the most central survivor per group (highest importance, then widest scope), rewrite title, labels, absorbed PR links and `"Not done"`, and replay higher sibling branches onto the new tip.
4. Dry-run first, then publish atomically with `republish.ts`:
   ```sh
   bun .claude/skills/stack-pr/scripts/republish.ts --head <bottom>=<sha> ... --absorb <src>=<dst> [--yes]
   ```
   **Avoid operational traps**:
   - **List `--head` bottom-to-top through the highest moved PR**: `republish.ts` appends unnamed survivors *after* `--head` entries, breaking parent ordering and aborting (`holds`).
   - **Rebase mid-stack side PRs separately**: `pulls.ts:stackHolding` walks one `longest` chain only and aborts on forks.
   - **Check recovery & stack health**: `.git/ana-republish.json` blocks retries after interruption until `--resume`; confirm zero closed PRs remain in `STACK_MEMBERS` before `gh stack link`.
   - **Re-prove cleanly**: run `bun run land -- <top> --sanitize` (reuses unchanged `contentKey` trees; reserve `--from` for operator request since it withholds `mergeable`), and dispatch `.github/workflows/ci.yml` (`linux` job) whenever `src/wall/linux-bwrap.ts` changed. Report PR reduction, before/after complexity and line metrics per group, invalidated passes, and open operator decisions.

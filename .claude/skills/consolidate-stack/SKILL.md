---
name: consolidate-stack
description: "Use when asked to consolidate, regroup, fold, shrink, or overhaul an open PR stack into fewer, simpler pull requests. Catalogues PRs by stated problem, groups by mechanism, simplifies each group's combined surface, trials the new order on a scratch worktree before moving published branches, reviews, fixes in lanes, and publishes with `republish.ts`. Placing a single change belongs to stack-pr; rewriting one compartment belongs to commit-r."
---

# Consolidate the stack

Rewrites an incrementally grown PR stack by subject so each surviving PR resolves a coherent problem set with minimal machinery. Requires operator authorisation (rewrites other sessions' branches) and never merges ([stack-pr](../stack-pr/SKILL.md) §8).

## 1. Catalogue each PR as a problem

Read bottom-to-top (`stack.ts`, `gh pr view <n> --json number,title,body,labels,baseRefName,headRefName,additions,deletions,files`, `git complexity <base> <head>`) and record per PR: **Problem** (one sentence; `"none stated"` is a finding), **Evidence** (event/test/refusal/review, rule 13), **Owner & kind** (owning module/fold; defect, mechanism, simplify, rename, reporting, docs), **Labels, dependencies & `"Not done"`**. Every listed problem must be resolved or listed under `"Not done"` in a survivor.

## 2. Group by tier, then owner

1. Separate `I0`/`I1` (bottom, land first), `I2` (middle), and `I3` (top).
2. Cluster by owning mechanism into 5–10 groups.
3. Enforce hard ordering dependencies so every commit passes in isolation: **gates sit above every site they judge**; **ledger rows (`tools/oxlint/not-slop.tsv`) sit above their rule**.

## 3. Rethink each group's combined surface

Measure members side by side (`python3 .claude/skills/reduce-complexity/scripts/stack-complexity.py --per-file '#<base>' '#<member>'...`) and apply [simplify](../simplify/SKILL.md):
- Retire problems already fixed on `main` or unreachable (H1, H3).
- Collapse site patches into the owning abstraction (H4).
- Eliminate intermediate add/retune/rename churn.
- Deduplicate readers and redundant locks/caches (rule 12, H2, H7).

Assign each PR `keep` | `simplify` | `merge` | `rewrite` | `drop`; run rewritten `I0`/`I1` compartments through [commit-r](../commit-r/SKILL.md) with the original PRs as oracle. Measure `git complexity` and nonblank lines before/after; if flat, report as **regroup only**.

## 4. Trial order on a detached scratch worktree

Cherry-pick into `git worktree add --detach ../anabasis-regroup-trial origin/main`:
- Move or fold conflicting PRs.
- Rebuild `tools/oxlint/not-slop.tsv` as sorted set deltas (`ledgerText`), holding rows until their rule arrives.
- Verify `git diff --quiet <new top> <published top>` for pure regroups.
- Run `bun run typecheck`, `bun run lint -- --strict` and `bun tools/loc/source-policy.ts` at every group head (defer exports until their first external reader arrives).

## 5. Review, assemble & republish

1. Run read-only reviews per group ([codex-gpt-swarm](../codex-gpt-swarm/SKILL.md): 2 cross-family for `I0`/`I1`, 2 for `I2`, 1 for `I3`), verifying findings at source (`AGENTS.md` §11).
2. Rebase into trialled order, fix in per-group worktrees (`claude/restack-laneN`), autosquash, verify `git diff consolidate/pre HEAD` is empty, and run `git rebase --exec 'bun run typecheck && bun tools/loc/source-policy.ts' origin/main`.
3. Pick each group's most central survivor (update title, labels, absorbed PRs and `"Not done"`), republish atomically, then run `bun run land -- <top> --sanitize`:
   ```sh
   bun .claude/skills/stack-pr/scripts/republish.ts --head 353=<sha> --head 354=<sha>... --absorb 356=353 [--yes] [--no-verify]
   ```
   Report PR reduction, before/after `git complexity` and line counts per group, and open operator decisions.

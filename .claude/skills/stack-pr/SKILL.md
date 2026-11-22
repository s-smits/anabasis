---
name: stack-pr
description: "Place a change on an open stack of Anabasis pull requests, or start a new stack: inspect the current stack top, preserve local work while moving to it, expand the open pull request that owns a change before opening a new one, shape commits that pass in isolation, run the CI checks locally, publish through the pre-push hook, verify the stack with `bun run land -- <top> --sanitize`, write a concise title and body, replay child branches when a parent moves, and land with `bun run land`. Use when asked to open, append to, stack, restack, rebase, move to the latest head, sanitise, or land a pull request, to title or describe one, or when a push, hook, or base branch refuses. Whole-stack consolidation lives in consolidate-stack."
---

# Stack a pull request

Open PRs form linear stacks on `main` landing as one unit (`AGENTS.md` §11). **Top** = tip of the active chain (or `origin/main` for a new stack).

## 1. Read the stack first

```sh
git fetch origin --quiet
bun .claude/skills/stack-pr/scripts/stack.ts [--branch <branch>]
```

Re-run immediately before `git worktree add`, `gh pr create` and any branch-rewriting push.

## 2. Place the change

- **Extend the owning open PR** when fixing, simplifying, completing or superseding its own code (shared file alone ≠ ownership). Fold into its commit if childless; otherwise append, restack above with `bun run land -- <top> --sanitize` (or `git rebase --onto` for your own branches) and push with `--force-with-lease`.
- **Otherwise stack a new draft PR on the cycle's top** (`gh pr create --draft --base <top>`). Never base mid-stack; a parallel stack on `main` requires operator approval.
- **Never edit another session's PR** without operator approval (except replaying its commits unchanged during restack).

## 3. Worktrees & commits

One worktree per PR from pinned top SHA, with `bun install --frozen-lockfile`:
```sh
git worktree add -b claude/<topic> ../anabasis-<topic> <top-head-sha>
```
Never branch inside a live-run worktree (`bun run runs pulse`) or use `git stash` (salvage via `git diff --binary HEAD > <scratch>/work.patch` + `git apply --3way`). Every commit must pass checks independently (fold fixes via `--fixup` + `--autosquash`; regroup before first push). Keep hooks enabled (`bun run hooks:install`) and run `/simplify` before pushing source diffs.

## 4. Run what CI runs

`.github/workflows/ci.yml` runs on GitHub Actions only when dispatched by `land --merge` (or `ci-fixes` on test-only failure):
- **Darwin**: `bun install --frozen-lockfile`, `ui:deps`, `typecheck`, `lint -- --strict`, `format:check`, `secrets`, `test`.
- **Darwin UI**: `ui:deps`, `ui:build`, `test -- packages/ui/test`.
- **Linux**: `bubblewrap` + unprivileged userns, `test`, `ANA_CLIMB=1 test -- test/climb.test.ts`.

`bun run gate` runs both Darwin jobs locally + `tools/loc/source-policy.ts` + `simplify -- --gate` (`-- --static` limits tests to adjacent hops). Report host and pass/skip/fail counts for manual runs.

## 5. Publish, title & describe

```sh
git push origin <sha>:refs/heads/<branch>
git push --force-with-lease=refs/heads/<branch>:<old-sha> origin <sha>:refs/heads/<branch>
gh pr create --draft --base <parent> --head <branch> --title "<title>" --body-file <file> --label importance:I<n> --label <category>
```

Standard push runs `git diff --check` + secrets (`ANA_PUSH_VERIFY=1` adds `gate -- --static`); commits stay unproved until `bun run land -- <top> --sanitize` (`ANA_GATE_FRESH=1` bypasses tree-hash cache). Every PR opens as draft with one `importance:I0`–`I3` label and ≥1 category (`CATEGORIES`, `tools/runtime/land.ts`).
- **Title**: imperative ≤~10 words in canonical nouns (no rationale, colon or `Ix:` prefix; keep operator titles verbatim).
- **Body**: open with `Stacked on #<n>.`, summary paragraph, **Problem and method** (counts/denominators, owner, related PRs, archive replay diffs), **Validation and limits** (commands, host, pass/skip/fail, evidence rung §9, untested surfaces). Update title/body on every push.

## 6. Restack, land & release notes

When a parent moves, replay children via `git rebase --onto` or `bun run land -- <top> --sanitize`. When `stack.ts` prints `off main:`, replay onto `origin/main` on operator approval:
```sh
bun .claude/skills/stack-pr/scripts/republish.ts --onto-main <top> [--yes]
```

Merging/tagging require explicit operator approval:
```sh
bun run land -- <top> [--sanitize [--watch | --from <pr>] | --merge [--tag vX.Y.Z]]
bun run split -- <pr> --yes   # split stack prefix (operator approval)
```

Before `--merge`: (1) fresh proof run at top reaching 2 promotions (`run-improvement-campaign`); (2) three read-only reviewers over `origin/main..<top>`: **Measurement** (`seat-view.ts --base origin/main`, wall tests, `runs replay`, rungs), **Run's life** (kill/stop/limit recovery, locks, dry runs), **Owner & shape** (`git complexity origin/main <top>`, rules 12–13, hostile tests, `"Not done"`).

Release notes (`gh release edit vX.Y.Z --notes-file <file>`): 550–800 words matching recent releases—opening sentences (what changed, small vs big release, proof run), `Includes **N PRs from #a to #b**, merged at \`<sha>\`.`, 3–4 subject groups with counts/PRs, and **Validation and limits** (no host/login/account names).

## Related skills

- Whole-stack regrouping & consolidation: [consolidate-stack](../consolidate-stack/SKILL.md)
- Source cleanup, complexity deltas & compartment rewrites: [simplify](../simplify/SKILL.md), [reduce-complexity](../reduce-complexity/SKILL.md), [commit-r](../commit-r/SKILL.md)
- Fleet check routing & CI placement: [local-checks](../local-checks/SKILL.md)
- Preflight checks & claim phrasing: [repository-practice](../repository-practice/SKILL.md), [attribution-and-proof](../attribution-and-proof/SKILL.md)

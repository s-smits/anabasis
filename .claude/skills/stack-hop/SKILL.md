---
name: stack-hop
description: "Move safely to the current stack head, append a stacked PR, or repair an authorised PR chain. Preserve local work, compose each child on its actual parent, publish batches through one gate, and isolate a failed checkpoint. A context hop alone does not authorise remote stack repair."
---

# Stack hop

A session can fall behind a moving stack while holding unpublished work. Moving to the current
head requires preserving that work and choosing where it belongs.

Take the inventory before switching branches. Git normally refuses a switch that would overwrite
local changes, but later cleanup or an incorrect patch application can still lose their intent.

## Choose the operation before touching Git

Choose the requested operation. Do not silently turn one into another.

- **Context hop (default):** preserve the active checkout's local work and move it to an already
  published stack head. This does not authorise rebasing, retargeting or pushing PR branches. A
  daily context-refresh automation normally belongs here.
- **Append a PR:** branch from the deepest intended head, which may be the preceding unpublished
  checkpoint in this task. Give the PR its immediate parent's branch as base. Read
  [stack publication](references/stack-publication.md) for batching and failure isolation.
- **Remote stack repair (explicit only):** make several open PR heads form one coherent published
  ancestry. Use this only when the operator explicitly asks to restack, rebase or repair the PR
  chain. Run it as a separate maintenance operation in isolated worktrees; do not combine it with
  the final active-checkout switch until the remote chain is proved.

A task that follows the newest tip to update `AGENTS.md`, a skill or another surrounding file does
not thereby own stack repair. Inspect that task's actual instructions before assuming it has
rewritten ancestry.

- **Land on main (explicit only):** merge reviewed PRs so each ends Merged on GitHub.
  GitHub performs every merge into the PR's own base, bottom-up, after one local gate per five
  on the composed tree.

For remote repair, read [stack publication](references/stack-publication.md). It owns the edge
inventory, merge/rebase choice, coordinated push, checkpoint proof and backtracking. A failed edge
starts the repair; it does not justify discarding the later PRs. Keep the active checkout and live
run trees outside that maintenance operation.

## 1. Read the stack before deciding anything

```sh
git status --short && git branch --show-current && git log --oneline -5
# The command guard reads `->` inside a shell string as a redirect and refuses the command,
# so ask for plain columns instead of a template with an arrow.
gh pr list --state open --limit 40 \
  --json number,title,headRefName,headRefOid,baseRefName \
  --jq '.[] | [.number, .headRefName, .baseRefName, .title] | @tsv'
git fetch origin --quiet
```

If the limit is reached, retrieve the remaining PRs before choosing a head.

Write the edge list down as `parent head → child head`, exactly as the PR worktrees rule requires.
The head you want is the deepest child, not the highest PR number: a notes branch or a side branch
off the middle of the stack carries a higher number while sitting below the head.

Two branch kinds are not the stack and must not be treated as its head:

- a docs branch based on `main`;
- a side branch sharing the stack's base but with no child of its own.

The operator names a level, not a diff. "Move to 233" means the newest head carrying that level's
work. Ask which head to use when two branches both carry it.

## 2. Inventory local work

Every uncommitted and untracked file is a candidate. Sort each one into **already published**,
**unpublished**, or **accidental**. Do not skip this because the changes look familiar —
a peer session may have written some of them, and the diff does not say who.

Compare content against the branch that would own it, not against your own base:

```sh
# List first; inspect each named path with literal values in actual commands.
git ls-files --others --exclude-standard
git ls-tree -r --name-only <owning-head> -- <file>
git show <owning-head>:<file> > /private/tmp/stack-hop-published
diff -q <file> /private/tmp/stack-hop-published

# tracked edits: is my change already upstream, or does it still apply?
git show <stack-head>:<file> > /private/tmp/stack-hop-theirs
git show HEAD:<file> > /private/tmp/stack-hop-base
git merge-file -p <file> /private/tmp/stack-hop-base /private/tmp/stack-hop-theirs > /private/tmp/stack-hop-merged
```

A zero `merge-file` exit proves textual composition; inspect the resulting diff for preserved
intent. Run it before the checkout, while all three versions are still on disk. Use a unique
literal scratch directory per session in practice; preserve separate paths for each file.

**Prove the accidental class.** A deletion-only lockfile hunk may remove another session's
dependency. Check its manifest and history before classifying it; preserve intentional removals.
Never discard work merely because it looks accidental.

Save everything that survives outside the repository before switching branches:

```sh
# Use the literal scratchpad path. The command guard refuses a redirect whose
# target is a shell variable; that is its most frequent block in this repository.
mkdir -p /private/tmp/claude-501/<project>/<session>/scratchpad/salvage/tree
git diff --binary HEAD -- <file> > /private/tmp/claude-501/<project>/<session>/scratchpad/salvage/<name>.patch
# Create matching parent directories and copy each untracked path separately.
cp <untracked-file> /private/tmp/claude-501/<project>/<session>/scratchpad/salvage/<relative-path>
git rev-parse HEAD > /private/tmp/claude-501/<project>/<session>/scratchpad/salvage/BASE
```

If the banking loop needs variables, write a small script file with literal paths and run
`zsh <script>`; the guard blocks the inline form.

This banks staged and unstaged content together. Save the index diff separately if staging
boundaries matter. `BASE` records attribution; three-way application needs the patch's original
blob identities and those objects locally available. Preserve untracked files with their relative
paths, including same-named files in different directories.

## 3. Route each survivor to the PR that owns it

Do not default to one new stacked PR for the whole batch. Each survivor has an owner already:

| Survivor | Route |
|---|---|
| Content a published PR already carries | Nothing to do. Say so and drop it. |
| Same subject as an open PR | Push to **that** PR's branch. |
| No open PR shares its subject | Its own new stacked PR on the head. |
| Surrounding files (`.claude/skills/**`, `README.md`, docs) | **Straight to main** on their own branch. |
| A doc describing source not yet on main | Stays with that source's PR. |
| Source, or status text bound to the stack's own changes | New stacked PR on the head. |
| An accidental artifact | Discard. |

The surrounding-files split is not bureaucracy. A skill parked on the top of a four-deep stack is
unusable until the whole stack lands, which is the exact reason the rule exists. Applying it here
also keeps the hop's own diff small: a stacked PR that carries one status section reviews in a
glance, while one carrying a skill, a doc rewrite and four notes does not.

**The subject test decides between appending and stacking.** A survivor joins an existing PR only
when it is the same subject that PR already owns — the two notes whose ten siblings are on the
notes PR, a fix to a file that PR introduced. Same directory is not the test; same subject is.
Anything unrelated to every open PR's subject gets its own new stacked PR on the head, even when
it is one file. That is the cheap direction of the error: an unrelated PR is one click to close,
while a survivor smuggled into someone else's PR widens their diff, and a survivor left on no
branch at all is the loss this skill exists to prevent. When the subject match is arguable, stack
it and say in the body which PR it might belong to instead.

Updating an open PR is the normal move where the subject matches, not an escalation. Do not open a
second PR to add two files to a PR that already owns ten.

## 4. Hop

Only now:

```sh
# After checking the saved copies, clear only the banked tracked changes.
git diff --binary HEAD -- <tracked-file> | git apply --reverse --index --check
git diff --binary HEAD -- <tracked-file> | git apply --reverse --index
# Move banked untracked files aside while preserving their relative paths.
mv <untracked-file> /private/tmp/claude-501/<project>/<session>/scratchpad/salvage/tree/<file>
git checkout -b <new-branch> <stack-head-sha>
git apply --3way /private/tmp/claude-501/<project>/<session>/scratchpad/salvage/<name>.patch
```

Check the tracked reversal against the current index first; if mixed staging prevents it, preserve
the checkout and create a separate worktree at the target SHA instead. Moving a tracked file alone
leaves a deletion in the working tree. Never carry that deletion into the new branch by accident.

Pin the head by SHA, not by branch name — the branch can move under you between the fetch and the
checkout.

## 5. Check the tree before pushing

The pre-push gate lints **untracked** files, so anything an interrupted run leaves behind can
refuse a push whose own diff is clean.

Fixture scratch is no longer part of that. Every in-repo test workspace is named
`.ana-scratch-<fixture>-<rand>/`, and `.gitignore` excludes the whole family in one entry, which
both the gate's oxlint step and the untracked-file listing honour. A branch from before
2026-09-21, or one composed with a lineage that predates it, can still carry a fixture on an older
prefix; the case in `test/test-discovery-completeness.test.ts` that owns the family then names the
file and the prefix.

Read any other such failure before believing it: if every reported path sits under a
random-suffixed directory you did not create, inspect their ownership and whether they hold live
or unpublished work.
After proving they are disposable leftovers, use the authorised recoverable cleanup and retry.
Their location alone does not prove the source diff is correct.

A different failing set can indicate contention; inspect the logs before attributing it.
`ANA_TEST_WORKERS` is the one test-parallelism setting; unset, the wrapper runs one worker per core.
Use the bounded retry rule in `AGENTS.md`.

Publish a coherent source batch through one push from its clean top, as described in
[stack publication](references/stack-publication.md). Surrounding-only main updates stay separate.
Report the published edges, exact gated checkpoint, intermediate heads without full proof, and
where each survivor landed.

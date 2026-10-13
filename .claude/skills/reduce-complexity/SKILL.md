---
name: reduce-complexity
description: "Measure whether a change made the tree simpler, on numbers rather than impressions — line counts, branching, coupling, interface width, rule count, standing exemptions and model-visible prose — across one diff or a whole stack of pull requests. Use before claiming a pass reduced complexity, when deciding which pull request in the stack added the machinery, and to read a function's branch count, which no v2 gate reports."
---

# Reduce complexity

[simplify](../simplify/SKILL.md) (`/simplify`) is the method: read the callers, fold into the owner, delete before you add. This
skill is the instrument. It answers one question — did that actually make the tree smaller, or
only move the mass — and it answers it the same way twice, so two passes are comparable.

The honest order is: measure, cut, measure again, and put both numbers in the PR body. A
simplification that cannot show a number it moved is a rewrite.

These numbers are one side of a trade. Rule 13 of `AGENTS.md` maps every concept as
`owner → live reader → decision it changes → evidence → hostile test` and drops it when a link is
missing; this skill measures what the concept costs, never the decision it changes. A pass that
reports a large fall here and nothing about what the component still decides has shown that it is
smaller, not that it is better.

All three scripts are v1's, adapted; v1's copies read back with
`git show 5bc9988:.claude/skills/reduce-complexity/scripts/<name>`, and no other copy runs. They are
Python and shell where the rest of `.claude` is bun TypeScript, because a port keeps that transfer
and a rewrite would not.

## The whole stack, on seventeen measures

```sh
python3 .claude/skills/reduce-complexity/scripts/stack-complexity.py origin/main HEAD
python3 .claude/skills/reduce-complexity/scripts/stack-complexity.py origin/main '#<bottom>' '#<top>'
python3 .claude/skills/reduce-complexity/scripts/stack-complexity.py --repo /abs/worktree --per-file origin/main HEAD
```

It reads every revision through git plumbing, so it needs no worktree, touches nothing and runs
anywhere in the repository. A `#<n>` argument is a pull request number in the repository this checkout's `origin` names,
resolved through `gh` and fetched if this checkout has not seen it.

| group | measures | what a rise means |
| --- | --- | --- |
| how much is there | source files, nonblank source lines, nonblank test lines | more to read. Test lines rising while source holds usually means a mechanism got proved; source rising while tests hold usually means it did not |
| how much branching | decision points, decisions per 100 lines | more paths per function. Both are proxies. v1 read exact branching debt off a cyclomatic baseline; v2 has no complexity gate (`AGENTS.md` §12.10) and so no baseline, and the density is the second reading: a stack that added lines and branches together held it |
| how tangled | import edges, mean fan-out, hub files, max fan-in | more places one edit reaches. An edge is a relative import or a `#src/`, `#tools/` or `#skills/` one, resolved through `package.json`'s `imports`; v2 writes about a third of its internal imports that way. A hub is a file at or above its revision's 90th fan-out percentile |
| how wide the interface | exported symbols, optional fields, signatures with 5+ parameters | more states every reader must handle. Optional fields are the quiet one: each `?:` is a case somebody downstream has to consider |
| how many rules | distinct refusal codes, environment knobs | a longer contract to satisfy, and more ways to be refused |
| how much is excused | waived findings, copied-file ceilings | `tools/oxlint/not-slop.tsv` rows, a lint site answered rather than changed, and `copiedFileLimits` in `tools/loc/source-policy.json`. A waiver falls when its site changes until the finding stops firing; §12.10 keeps the ceiling map empty, so anything above 0 there is a finding by itself |
| how much a model reads | prompt literal bytes, and the same per composer | more prose asked of an agent per turn. This is the group the others are usually traded against |

"Source" is what `tools/loc/source-policy.ts` calls authored: `src`, `tools` and `packages`,
never `vendor`. The composers are named explicitly in the script, by one rule — a file is listed
when it builds prompt text or declares a tool description — because an AST census guesses
audiences and a delta should be exact. A new composer goes in that list in the same pull request.

The first revision is read as `first...last`, the point they diverged, so work landed on main
after the branch was cut is not charged to the branch. Getting this wrong is the standard error:
in v1 a six-PR stack once appeared to have deleted 2,872 test lines it had not touched.
`--literal-base` compares the tips as given when that is what you want. Run `git fetch origin`
first and name `origin/main`, not `main`: a local main that has not been updated is an ancestor of
the branch, so nothing warns you, and the branch is credited with everything main has landed since.

### Comparing pull requests

Name the stack bottom-to-top and every PR gets a column, so you can see which one moved a measure
instead of only that the stack did. Over #164 and #172 of `s-smits/anabasis-v2`, where v2 was built
before it moved to this repository, from the commit below them:

```
measure                        c97d945        #164        #172         net
nonblank source lines           43,159      43,169      43,204         +45    +0.1%
prompt literal bytes            71,924      71,924      72,408        +484    +0.7%
     +484  9,751 -> 9,751 -> 10,235  src/builder/prompt.ts
```

#164 moved ten source lines and no model-visible byte; #172's whole prose cost was 484 bytes in one
composer. A single base-to-tip delta would have said only that the pair was 484 bytes heavier.

For two branches that are not in one line — siblings, or a rewrite against the thing it replaces —
compare each against their common base and read the two nets. Do not compare sibling tips
directly: each carries the other's absence as a deletion.

## One diff, and a function's branch count

```sh
.claude/skills/reduce-complexity/scripts/scope.sh [<PR#>|<commit>|<a..b>|<paths>] -C <worktree> -o <scope.diff>
.claude/skills/reduce-complexity/scripts/measure.py --diff <scope.diff> --base <pre-change ref> -C <worktree>
```

`scope.sh` resolves the base: the PR's parent on a stack, never `main` by default. `measure.py`
prints functions by branch count and length, exports by caller count (`UNUSED`, `one-caller`), the
functions over a ceiling, then two sections:

- **budget**: production and test lines net, new and deleted files, new production functions net
  of moved ones, and the names each import source gained. Point `--base` at the head *before the
  change you are simplifying*, not the PR base, when the question is what a repair costs.
- **repeats**: added code that already exists elsewhere in tracked source — the "already in this
  codebase?" rung answered for you. Call that owner, then delete the other local copies too.

It reads branch counts from `node_modules/oxlint/bin/oxlint` with `complexity`,
`max-lines-per-function` and `max-lines` set to a maximum of 0 in a temporary config of its own,
so every function is reported. That is a measurement, not a change to this repository's lint
configuration, and it is the only cyclomatic reading v2 has. The line ceilings default to
`source-policy.ts`'s 115 and 800. `--complexity` defaults to v1's 21, which nothing in v2
enforces, so a function over it is a lead and not a refusal. Its line counts skip comments and
`source-policy.ts`'s do not, so a function near 115 here may already be over there.

Run it once before editing and once after, and put the budget lines in the report. The worktree
must hold the after-state.

## Reading prose as complexity

Model-visible text is the measure most often left out, and in this system it is the one that
decides behaviour. Sort every model-visible sentence into three kinds:

- **Frame** — what the agent is for, and what it may not do. Irreducible; keep it.
- **Fact** — something the agent cannot observe, told to it in words. It belongs in a *returned
  value*. A fact in a prompt is read once, compacted away and never checked.
- **Hope** — a property we want the answer to have, asked for. It belongs in a *refusal* or a
  *computed result*. A hope in a prompt is a probability; the same property enforced by the
  harness is a guarantee.

Cutting a Hope is only honest once the mechanism that replaces it exists. The trade that buys —
prompt bytes down, source lines up — is why the last group is read against the others rather than
on its own. The reverse trade is the one to catch: a clause added to a prompt that nothing reads.
When a prompt gains a clause, name its reader.

## What a pass must not cut

The rules of `AGENTS.md` §8 are what no pass trades. A measure that improved because one of them
left — a wall that stopped holding, a non-result that became a fail, a check that stopped
reading the field's own tool — is not a simplification, whatever the numbers say.

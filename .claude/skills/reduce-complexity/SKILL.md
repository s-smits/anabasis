---
name: reduce-complexity
description: Measure whether a change made the stack simpler, on numbers rather than impressions — line counts, branching, coupling, interface width, rule count and model-visible prose — and compare revisions or a whole PR stack on all of them at once. Use before claiming a pass reduced complexity, and when deciding which of several PRs added the machinery.
---

# Reduce complexity

`/simplify` is the method: read the callers, fold into the owner, delete before you add.
This skill is the instrument. It answers one question — did that actually make the tree
smaller, or only move the mass — and it answers it the same way twice, so two passes are
comparable.

The honest order is: measure, cut, measure again, and put both numbers in the PR body. A
simplification that cannot show a number it moved is a rewrite.

## One command for the whole picture

```sh
python3 .claude/skills/reduce-complexity/scripts/stack-complexity.py <base> <head>
python3 .claude/skills/reduce-complexity/scripts/stack-complexity.py main '#724' '#725' '#726'
python3 .claude/skills/reduce-complexity/scripts/stack-complexity.py --repo /abs/repo --per-file main HEAD
```

It reads every revision through git plumbing, so it needs no worktree, touches nothing and
runs anywhere in the repository. A `#724` argument is a pull request number, resolved through
`gh` and fetched if this checkout has not seen it.

Seventeen measures in six groups, each group answering one question:

| group | measures | what a rise means |
| --- | --- | --- |
| how much is there | source files, nonblank source lines, nonblank test lines | more to read. Test lines falling while source holds usually means a mechanism replaced cases that asserted it |
| how much branching | decision points, cyclomatic debt (functions and summed excess) | more paths per function. The debt figure is `tools/loc/complexity-baseline.json`, the repository's own shrink-only ledger, so it is exact rather than a proxy |
| how tangled | import edges, mean fan-out, hub files, max fan-in | more places one edit reaches. A hub is a file at or above the tree's 90th fan-out percentile, `coupling.mts`'s own definition |
| how wide the interface | exported symbols, optional fields, signatures with 5+ parameters | more states every reader must handle. Optional fields are the quiet one: each `?:` is a case somebody downstream has to consider |
| how many rules | distinct refusal codes, environment knobs | a longer contract to satisfy, and more ways to be refused |
| how much a model reads | prompt literal bytes, model-read document bytes | more prose asked of an agent per turn. This is the group the others are usually traded against |

The first revision is read as `first...last`, the point they diverged, so work landed on main
after the branch was cut is not charged to the branch. Getting this wrong is the standard
error: on 2026-09-17 a six-PR stack appeared to have deleted 2,872 test lines it had not
touched, because main had moved. `--literal-base` compares the tips as given when that is
what you want.

Run `git fetch origin` first and name `origin/main`, not `main`: a local main that has not
been updated is an ancestor of the branch, so nothing warns you, and the branch is credited
with every change main has landed since.

## Comparing PRs

Name the stack bottom-to-top and every PR gets a column, so you can see which one moved a
measure instead of only that the stack did:

```sh
python3 .claude/skills/reduce-complexity/scripts/stack-complexity.py \
  main '#724' '#725' '#726' '#727' '#728' '#729'
```

```
prompt literal bytes   15,998   16,725   16,725   17,149   17,295   17,587   17,893   +1,895
```

That row names its own owner: two PRs added nothing, #726 added 424 bytes, and the rest
arrived in threes. A single base-to-tip delta would have said only that the stack was
1,895 bytes heavier.

For two PRs that are not in one line — siblings, or a rewrite against the thing it
replaces — compare each against their common base and read the two nets. Do not compare
sibling tips directly: each carries the other's absence as a deletion.

To ask whether two branches will interfere rather than which is larger, that is a different
question and a different tool:

```sh
bun .claude/skills/intelligent-rebase/scripts/coupling.mts --a <base>...<A> --b <base>...<B>
```

## The other instruments

`/simplify` owns the per-diff instruments — the gate's own complexity count, `scope.sh` and
`measure.py` — and their budgets. The one this skill adds beside them reads what a model can
actually see, resolved through the composers rather than guessed:
`.claude/skills/prompt-surface-census/scripts/extract-prompt-surface.mjs`.

## Reading prose as complexity

Model-visible text is the measure most often left out, and in this repository it is the one
that decides behaviour. Sort every model-visible sentence into three kinds:

- **Frame** — what the agent is for, and what it may not do. Irreducible; keep it.
- **Fact** — something the agent cannot observe, told to it in words. It belongs in a
  *returned value*. A fact in a prompt is read once, compacted away and never checked.
- **Hope** — a property we want the answer to have, asked for. It belongs in a *refusal*
  or a *computed result*. A hope in a prompt is a probability; the same property enforced
  by the harness is a guarantee.

Cutting a Hope is only honest once the mechanism that replaces it exists. On the
round4-veryhard truss pack (2026-09-17, 2 verified of 23), the prompt asked the solver to
compare each value it reported against each published limit; 19 of 19 recorded answers
breached a limit by their own reported numbers and were submitted anyway. Three prompt
clauses came out when the harness started computing that comparison and returning it. That
trade — prompt bytes down, source lines up — is the one this instrument exists to show, and
it is why the last group is read against the others rather than on its own.

## What a pass must not cut

`/simplify` owns that list. The one addition this instrument needs: a measure improving
because a guarantee left is not a simplification.

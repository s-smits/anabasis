# Procedures beyond a single function

The first screen of `SKILL.md` still governs: ask why the code exists, fix it
at the owning layer, keep to the budget, land on the PR it simplifies. For a
removal or a rewrite from scratch, read `remove-and-rewrite.md` instead.

## A large diff

Read the diff top to bottom once, then each changed function with its callers.
`scope.sh [<target>] [-C <worktree>]` writes the diff against the open PR's
base (so a stacked branch is not measured against `main`); an empty scope is a
result, not a reason to audit the repository. Start from `measure.py`'s
`repeats` and `budget` lines: a repeat is the cheapest cut, and a new function
or file is the first thing to justify. Work through the ladder yourself.
Delegate only when the operator asks, and then hand each agent the diff file,
the worktree path, the repository's binding constraints and "an empty list is
a valid result".

## One PR inside a sweep

The scope is that PR's diff against its base. Read its stated purpose first
(`gh pr view <n>`); a cut that undoes the PR's reason for existing is a review
finding, not a simplification. One commit, pushed to that PR's source branch,
naming what got simpler. Two tests proving one fact may merge; a test pinning
unrelated behaviour through the simplified path is re-fixtured, not deleted.
Nothing to change gets one sentence.

## Revert and add two lines back

Name the measurable thing the change buys (a failing test on the base, a
benchmark). From the base, add the smallest edit that restores it, keep the
change's tests, and run both versions. Report base, original and minimal with
the measured property on each. If nothing measurable exists, the answer is
"revert". If the minimal version cannot hold the property, name the
irreducible line.

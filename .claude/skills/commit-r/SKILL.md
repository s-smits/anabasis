---
name: commit-r
description: "Rewrite one compartment of Anabasis test-first, with the old code as an oracle. Use when the operator asks to rewrite, overhaul or rebuild code, or says commit R; also within an authorised change when the old shape needs another exception or about half the machinery could give the same result. A stack overhaul belongs to stack-pr."
---

# Commit R

A suite pins the shape its code happened to take. Commit R removes one compartment's tests and production, rewrites the tests from a hypothesis, then writes
the smallest production that passes them. The old code is kept as an oracle, and every difference
from it is intended, a boundary retired with its reason, or a regression. [simplify](../simplify/SKILL.md)
sends rewrites here; [reduce-complexity](../reduce-complexity/SKILL.md) owns the measurements.

## When to start a pass

An operator's request to rewrite, overhaul or rebuild code starts one. Inside a task that already
changes a compartment, start one yourself when the fix adds another exception to a history of
patches (`git log -L :<function>:<file>`), when about half the concepts could give the same outcome,
when two owners decide one fact (rule 12), when tests pin internals, or when a function near 115
lines or 21 decision points (`measure.py`) would grow. Tell the operator in one line which
compartment and number should move, then proceed; a compartment outside the task is only proposed.

## The frame

Write it before anything is removed, as the body of the first `R:` commit:

- **The compartment**: one question someone could want answered differently, with its tests,
  owners and neighbours, small enough for one context.
- **The map**: `owner → live reader → decision it changes → evidence → hostile test` per concept
  (rule 13); a concept with a missing link is dropped.
- **The hypothesis**: why about half the machinery reaches the same outcome, and what it gives up.
- **The budget**, measured now and expected after: nonblank lines, decision points and exports
  (`.claude/skills/reduce-complexity/scripts/measure.py <files...>`).
- **The boundaries**: each case the old tests hold, and each guard no test holds (a refusal, a check
  before a deletion, a fallback), since untested guards are the ones a rewrite drops unseen.

## The sequence

Two points are fixed: **the tests are rewritten and committed before any production line is
removed**, and **production is then written to pass them**. Tests written first cannot be fitted to
the new code, and running them on the old code shows which test the change at all. A test edited
once production starts needs its reason in the commit. Each step is a local commit; after a
compaction, resume from `git log` since the first `R:` commit.

1. **Commit what is in flight** in your own worktree at the stack's top ([stack-pr](../stack-pr/SKILL.md)):
   the base.
2. **Capture the oracle**: the old tests, and the old code on real input in a mode that changes
   nothing, output and time saved (`bun run runs replay`, `bun run runs rehearse`, a dry run).
   Profile now if speed is promised.
3. **`R: <test paths>`**: `git rm` the tests; commit with the frame.
4. **Write the tests** for the outcome rather than the old shape (`tools/oxlint/HABITS.md`, 12.12),
   run them on the old code and sort the failures: a new case failing on behaviour is the
   hypothesis; an interface failure says nothing until a scratch `test/_sort-<name>.test.ts` maps
   it onto the old code; a kept boundary failing is a test written wrongly; a case meant to fail
   that passes needs sharpening. Commit with the sorting.
5. **Find the simpler path**: which module should own the behaviour, and what served only the old
   shape (`git grep -w` each export). Drop a case only when its producer or contract is gone.
6. **`R: <production paths>`**: `git rm` what the rewrite replaces; commit.
7. **Write production** with the smallest owner the tests allow, rewriting whole any neighbour the
   old shape bent. Run `bun run typecheck`, `bun run lint -- --strict`,
   `bun tools/loc/source-policy.ts` and every importing test, and read each exit code.
8. **Put it to the oracle**: restore old tests as `<original directory>/_old-<name>.test.ts`, run
   them through `bun run test --`, then trash them; diff outputs and times on step 2's input. Fix
   regressions into step 7: `git commit --fixup` and
   `GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash <base>`.

   Code that deletes or moves things runs first on a full copy (`cp -cRp`) with every link pointed
   inside it; for worktrees, rewrite each copied `.git` file and admin `gitdir` by hand and restore
   times with `touch -h -r`, since `git worktree repair` would rewrite the real repository. Compare
   the copy's dry run with the real one, run it, check exactly the named things went, and name what
   the copy lacks as untested.
9. **Measure and squash**: reduce-complexity's [One diff command](../reduce-complexity/SKILL.md#one-diff-and-a-functions-branch-count)
   against the base; `git branch commit-r/<compartment> HEAD`, `git reset --soft <base>`,
   `bun run commit:check`, one commit whose body gives hypothesis, budget met or missed, intended
   failures, oracle findings and neighbours rewritten. Delete the branch after merge.

## What a pass must not do

- Touch a pack, check program, kept harness or log (rule 2), another session's compartment or a
  run's worktree; `vendor/` takes only a sed.
- Change what a seat reads without saying so, with how `test/builder.test.ts` and
  `test/builder-led.test.ts` still hold (rule 3); solver-facing text needs the operator's word.
- Silence a failing old test, or skip the oracle without saying why.
- Push, unless the task includes publishing through stack-pr.

## Report

Per compartment: hypothesis; budget before, expected and measured (`measure.py`,
`git complexity <base> HEAD`); squashed commit and saved branch; test counts and failure classes;
tests edited after production began; oracle differences with disposition and both times; the copy
run and its gaps; and what the simpler form gave up.

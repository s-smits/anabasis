---
name: commit-r
description: "Rewrite one compartment of Anabasis with the old code as an oracle: test-first where an outcome or interface changes, as a refold held by the oracle where every output is kept. Use when the operator asks to rewrite, overhaul, rebuild or speed up code, or says commit R; also within an authorised change when the old shape needs another exception or about half the machinery could give the same result. A stack overhaul belongs to stack-pr."
---

# Commit R

A suite pins the shape its code happened to take. Commit R takes one compartment, keeps the old
code as an oracle and replaces it with the smallest production that gives the outcome asked for, so
that every difference from the oracle is intended, a boundary retired with its reason, or a
regression. [simplify](../simplify/SKILL.md) sends rewrites here;
[reduce-complexity](../reduce-complexity/SKILL.md) owns the measurements.

## When to start a pass

An operator's request to rewrite, overhaul or rebuild code starts one. Inside a task that already
changes a compartment, start one yourself when the fix adds another exception to a history of
patches (`git log -L :<function>:<file>`), when about half the concepts could give the same outcome,
when two owners decide one fact (rule 12), when tests pin internals, or when a function near 115
lines or 21 decision points (`measure.py`) would grow. Tell the operator in one line which
compartment and number should move, then proceed; a compartment outside the task is only proposed.

## Choose the compartment by measurement

The largest file is rarely where the time or the branches are, so read the cost before the frame:

- `measure.py <files...>` for lines, each function's decision points and the exports with one
  caller.
- The oracle of step 2 with its time split by part (parse, fold, print), and where speed is asked
  for a profile (`bun --cpu-prof --cpu-prof-dir <scratch dir> <script>`). One fold that several
  readers each run shows there as one function under many callers, which no reading of the lines
  finds.
- The record, for anything that might not be needed: the logs, receipts and sessions that could
  hold a use of it (simplify, H1).

A cost the profile puts beneath the compartment's layer, such as a kernel fold under a reader, is
named in the report with its share and left to the change that owns it.

## Two kinds of pass

Name the kind in the frame.

- A **rewrite** changes an outcome or an interface. It follows the whole sequence, and its two
  fixed points hold: **the tests are rewritten and committed before any production line is
  removed**, and **production is then written to pass them**. Tests written first cannot be fitted
  to the new code, and running them on the old code shows which of them test the change at all.
- A **refold** keeps every output: a result held instead of computed again (H7), one helper for a
  shape spelt at many sites, a copy folded into its owner. No new test can fail on the old code, so
  the tests stay as they are and steps 3, 4 and 6 fall away; what holds it is the oracle's text,
  identical on every input after each stage, and the suite passing unchanged. The first intended
  difference makes it a rewrite, from step 3.

A shape at more than about ten sites is changed by a script in the scratchpad that rewrites the
sites it can prove and lists those it leaves, never by hand. The typechecker then names each site
that needed what the old form gave it, a narrowing or a value built only when wanted, and those
keep the old form.

## The frame

Write it before anything is removed, as the body of the first `R:` commit, or of a refold's one
commit:

- **The compartment**: one question someone could want answered differently, with its tests,
  owners and neighbours, small enough for one context.
- **The map**: `owner → live reader → decision it changes → evidence → hostile test` per concept
  (rule 13); a concept with a missing link is dropped.
- **The hypothesis**: why about half the machinery reaches the same outcome, what it gives up, and
  the count that would refute it.
- **The budget**, measured now and expected after: nonblank lines, decision points and exports
  (`.claude/skills/reduce-complexity/scripts/measure.py <files...>`), and seconds where speed is
  promised. The expected number is the present one less what the map drops, counted concept by
  concept; a round number is a guess that the report will have to call missed.
- **The boundaries**: each case the old tests hold, and each guard no test holds (a refusal, a check
  before a deletion, a fallback), since untested guards are the ones a rewrite drops unseen.

## The sequence

Each step is a local commit; after a compaction, resume from `git log` since the first `R:` commit.
A test edited once production starts needs its reason in the commit.

1. **Commit what is in flight** in your own worktree at the stack's top ([stack-pr](../stack-pr/SKILL.md)):
   the base.
2. **Capture the oracle**: the old tests, and the old code on real input in a mode that changes
   nothing (`bun run runs replay`, `bun run runs rehearse`, a dry run, or a script in the
   scratchpad). The script takes the tree as an argument, so the same file reads the old tree and
   the new; it reads only input that no longer changes (closed campaigns, a clock passed in), runs
   in one process, writes the text to a scratch file and prints counts and the time of each part.
   Real output can quote a log, so it stays in the scratchpad and out of every commit and pull
   request.
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
   old shape bent. Run `bun run typecheck` (the commit hook does not), `bun run lint -- --strict`,
   `bun tools/loc/source-policy.ts` and every importing test, and read each exit code. A function
   that shrank can show a finding its size hid; fix it at the site. A budget is never met by
   dropping a boundary: a test that fails after a shortening is the boundary speaking, so the
   tolerant form returns and the budget is reported as missed.
8. **Put it to the oracle**: restore old tests as `<original directory>/_old-<name>.test.ts`, run
   them through `bun run test --`, then trash them; diff the outputs on step 2's input, which for
   text means an empty `diff`. Read the times of old and new in turn within the same minutes,
   twice or more, and keep every reading: one reading under another load is no reading. Fix
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
   failures, oracle findings and neighbours rewritten. The saved branch stays until the merge.

## What a pass must not do

- Touch a pack, check program, kept harness or log (rule 2), another session's compartment or a
  run's worktree; `vendor/` takes only a sed.
- Change what a seat reads without saying so, with how `test/builder.test.ts` and
  `test/builder-led.test.ts` still hold (rule 3); solver-facing text needs the operator's word.
- Silence a failing old test, or skip the oracle without saying why.
- Call a pass a refold to leave the tests alone when an output moves.
- Push, unless the task includes publishing through stack-pr.

## Report

Per compartment: its kind and hypothesis; budget before, expected and measured (`measure.py`,
`git complexity <base> HEAD`), each miss said as a miss with the boundary that cost it; squashed
commit and saved branch; test counts and failure classes; tests edited after production began; the
oracle's input by count and size, its differences with their disposition and every timing reading
of both sides; the copy run and its gaps; what the simpler form gave up; and the costs left beneath
the compartment, each with its share.

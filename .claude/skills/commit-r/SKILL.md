---
name: commit-r
description: "Rewrite one compartment of Anabasis v2 test-first, with the old code as an oracle. Use when the operator asks to rewrite, overhaul or rebuild code, or says commit R; also within an authorised change when the old shape needs another exception or about half the machinery could give the same result. A stack overhaul belongs to stack-pr."
---

# Commit R

A suite can pin the shape its code happened to take. Commit R removes both halves of one
compartment and writes them again: tests from a hypothesis, then the smallest production owner
they demand. The old code remains an oracle for cases the hypothesis missed. Each difference is
intended, a boundary retired with its reason, or a regression to fix.

[simplify](../simplify/SKILL.md) sends its rewrites here, and
[reduce-complexity](../reduce-complexity/SKILL.md) owns the instruments the budget is read with.

## When to start a pass

An operator's request to rewrite, overhaul or rebuild code starts a pass, even if it names only
a file and says nothing of tests. The file is where the compartment starts.

**Your own judgment says the shape is wrong**, inside a task that already changes the compartment.
Rule 13 of `AGENTS.md` asks a fix to rewrite its owner rather than add to it. Grounds include:

- the fix adds another exception to a history of patches (`git log -L :<function>:<file>`);
- about half the decision points, exports or concepts could give the same outcome;
- two owners decide one fact (rule 12);
- tests pin internals or wording rather than behaviour;
- a function is near 115 lines or above 21 decision points (`measure.py`), and the fix adds to it.

Tell the operator in one line which compartment and what number the pass expects to move, then go
on: the rewrite is the fix, so it needs no second word. A compartment outside the task is only
proposed, in that one line.

**Edit in place instead** where a patch of a few lines leaves the shape sound.

## The frame

Before the first removal, write the frame. It goes in the body of the first test commit (step 4),
so it survives a compaction.

- **The compartment**: one question someone could want answered differently, spanning its tests,
  owners and the neighbouring functions that serve it. Keep it small enough for one context.
- **The map**, as rule 13 has it: `owner → live reader → decision it changes → evidence → hostile
  test` for each concept that stands now. A concept with a missing link is what the rewrite drops.
- **The hypothesis**: what changes, why a path with about half the machinery reaches the same
  outcome or nearly all of it, and what it gives up if not.
- **The budget**, measured, never estimated: the compartment's nonblank lines, decision points and
  exports now (`.claude/skills/reduce-complexity/scripts/measure.py <files...>`), and the numbers
  the hypothesis expects after. The report says met or missed.
- **The boundaries**: every case the old tests hold, read whole, one line each. The rewrite keeps
  each one or retires it with a reason.

Two compartments carry two hypotheses, or they are one compartment.

## The sequence

Every step ends in a local commit. Resume from `git log` since the first `R:` commit after a
compaction. Only the squashed commit passes alone.

1. **Commit what is in flight**, in a worktree of your own at the top of the stack, or on `main`
   where the operator says so ([stack-pr](../stack-pr/SKILL.md)). The pass then removes the
   compartment and nothing else. Call this commit the base.
2. **Capture the oracle** while the old code still runs. The old tests come back from the base
   with `git show`. Where the compartment reads logs, save the old tree's output of
   `bun run runs replay` (or the reader's own command) over the logs it touches. Where it drives a
   campaign, save a rehearsal's events (`bun run runs rehearse`). Keep these in the scratchpad.
3. **`R: <test paths>`**: `git rm` the tests, and commit with that subject and no body.
4. **Write the tests from the hypothesis**, for the outcome and not the old shape. Keep each
   boundary, fold cases that now assert one thing, and add the cases the hypothesis predicts. Hold
   them to `tools/oxlint/HABITS.md`, 12.12: the smallest owning file, the positive case beside its
   nearest hostile one, a name that is a sentence about the system, a script in every model seat.
   Run them against the old code and sort the failures:
   - a new case failing on behaviour is the hypothesis, failing on purpose;
   - a failure to import or to call a changed interface says nothing yet, and is listed once;
   - a kept boundary failing on behaviour is a boundary written down wrongly, so fix the test;
   - unchanged behavioural tests may all pass in a structural rewrite; measure its simpler form;
   - a case meant to expose changed behaviour that already passes needs sharpening or dropping.

   Commit with the frame and this sorting in the body.
5. **Find the faster path** before writing production. Ask which module should own the behaviour,
   whether a simpler owner already exists, and which functions, union members and fields served only
   the old shape. Count the readers of each export (`git grep -w`): a branch whose producer is
   gone is dead. Prefer the algorithm that computes an answer once, and drop a case no recorded
   log reaches. A negative claim needs the symbol, its call sites and a check in the same turn
   (`AGENTS.md`, section 9).
6. **`R: <production paths>`**: `git rm` the files the rewrite replaces, and commit.
7. **Write production again with the smallest owner the tests allow.** In the same commit, bring
   the neighbours to the new shape: a function the old shape bent, or that the new shape lets be
   simpler, is written again whole, and its file needs no `R:` commit for that. Delete what served
   only the old shape. Run `bun run typecheck`, `bun run lint -- --strict`,
   `bun tools/loc/source-policy.ts` and every test file that imports the compartment, and read each
   exit code.
8. **Put it to the oracle.** Restore each old test beside its original file as
   `<original directory>/_old-<name>.test.ts`, so its relative imports keep resolving. Run these
   files through `bun run test --`, then move them to the Trash; compare the saved replay or
   rehearsal with the new tree's. Each difference is intended (the hypothesis named it), a boundary
   retired (name it and why), or a regression (fix it in step 7's commit with `git commit --fixup`
   and `GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash <base>`). Import failures from the
   changed interface are expected and listed once.
9. **Measure and squash.** Use reduce-complexity's full [One diff command](../reduce-complexity/SKILL.md#one-diff-and-a-functions-branch-count),
   with the pass's base, and compare its budget lines with the frame. Save the working steps as
   `git branch commit-r/<compartment> HEAD`, then
   `git reset --soft <base>`, run `bun run commit:check`, and make one commit. Its subject states
   the finished change. Its body gives the hypothesis, the budget met or missed, the cases that
   failed on purpose, what the oracle found, and which functions outside the compartment were
   rewritten and why. Delete the saved branch once the pull request merges.

Then take the next compartment from the frame. A delegated pass gets the frame, worktree and
budget. Its parent checks the result, measures the squashed commit itself and checks any changed
model-visible text against the wall tests. A missed budget is reported as missed.

## What a pass must not do

- **Touch a pack, a check program, a kept harness or a log** (rule 2).
- **Rewrite another session's compartment or a run's worktree.** Check the stack and
  `git worktree list` first. `vendor/` takes a sed, never a rewrite.
- **Change what a model reads without saying so.** A string that reaches the Builder, the
  Examiner, a solver or the Referee changes what that seat is told. Say so in the body, with how
  the wall tests still hold (`test/builder.test.ts`, "what crosses to the Builder", and
  `test/builder-led.test.ts`; rule 3). Text a solver is given or told requires the operator's
  word (`AGENTS.md`, section 3).
- **Silence a failing old test.** It is a boundary kept, or one the body retires with its reason.
- **Leave the oracle unrun.** A pass that skipped step 8 says so in its report, and why.
- **Push** unless the operator's task includes publishing; then publish through stack-pr.

## Report

For each compartment give the hypothesis; budget before, expected and measured (`measure.py`'s
budget lines and `stack-complexity.py <base> HEAD`'s decision points, import edges, exports and
optional fields); squashed commit and saved branch; test counts and failure classes; oracle
differences and their disposition; what the simpler form gave up, including nothing; and anything
left for the operator.

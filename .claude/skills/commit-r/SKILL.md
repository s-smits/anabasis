---
name: commit-r
description: "The commit-R protocol: rewrite one compartment of Anabasis v2 test-first instead of editing it in place, with the old code kept as an oracle until the new code agrees with it or each difference is named. Use it when the operator asks for code to be rewritten or overhauled (\"fully rewrite\", \"rewrite from scratch\", \"rewrite X to simpler components\", \"rewrite X and its adjacent functions\", \"overhaul X\", \"rebuild X\", \"commit R\"), and on your own judgment when a fix would add one more branch, flag, reader or fallback to code that earlier patches already bent, or when the same outcome looks reachable with about half the machinery. An overhaul of the pull-request stack itself is stack-pr's."
---

# Commit R

A suite that grew beside its code pins the shape the code happened to take, and an edit in place
keeps that shape. Commit R removes both halves of one compartment and writes them again in the
order that exposes the difference: first the tests, from a hypothesis about what the compartment is
for, then the production code those tests demand. Removing the old code frees the rewrite from its
shape, and the old code still knows things the hypothesis may have missed, so the pass keeps it as
an oracle and puts the new code to it before the pass ends. Every difference the oracle finds is
then either intended, a boundary retired with its reason, or a regression to fix.

[simplify](../simplify/SKILL.md) sends its rewrites here, and
[reduce-complexity](../reduce-complexity/SKILL.md) owns the instruments the budget is read with.

## When to start a pass

**The operator asks.** "Fully rewrite", "rewrite from scratch", "rewrite X to simpler components",
"rewrite X and its adjacent functions", "overhaul X", "rebuild X", "completely remove and rewrite"
and "commit R" each start a pass, even where the request names only a file and says nothing of
tests. The file is where the compartment starts.

**Your own judgment says the shape is wrong**, inside a task that already changes the compartment.
Rule 13 of `AGENTS.md` asks a fix to rewrite its owner rather than add to it, and this is how. Any
one of these is enough:

- the fix adds a branch, flag, optional field, fallback or second reader to code whose history
  (`git log -L :<function>:<file>`) reads as one exception after another;
- you can state in two sentences a path to the same outcome with about half the decision points,
  exports or concepts, and what it would give up;
- one fact is decided in two places (rule 12), or an old owner keeps readers after a new owner took
  the decision;
- the tests pin a shape rather than an outcome: they mock internals, assert wording, or break on a
  change of no behaviour;
- a function is near 115 lines or above 21 decision points (`measure.py`), and the fix adds to it.

Tell the operator in one line which compartment and what number the pass expects to move, then go
on: the rewrite is the fix, so it needs no second word. A compartment outside the task is only
proposed, in that one line.

**Edit in place instead** where a patch of a few lines leaves the shape sound, and never rewrite:

- a compartment another session is editing (`bun .claude/skills/stack-pr/scripts/stack.ts`,
  `git worktree list`);
- in a worktree a run was launched from;
- `vendor/`, which takes a sed;
- a pack, a check program, a kept harness or a log (rule 2);
- text a solver is given or told, without the operator's word (`AGENTS.md`, section 3).

## The frame

Before the first removal, write the frame. It goes in the body of the first removal commit (step 3),
so it is in `git log` before anything is removed and survives a compaction.

- **The compartment**: one question someone could want answered differently, such as what the
  Builder is told of the past, which tasks a comparison scores, or the move that follows a reading.
  It is not a file. It spans the tests, the modules that answer the question, and the functions of
  neighbours that exist only to serve it. Keep it small enough to finish within one context.
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

Every step ends in a local commit, so each reads against the one before it, and a pass resumed
after a compaction starts from `git log` since its first `R:` commit and never redoes a committed
step. Only the squashed commit passes alone.

1. **Commit what is in flight**, in a worktree of your own at the top of the stack, or on `main`
   where the operator says so ([stack-pr](../stack-pr/SKILL.md)). The pass then removes the
   compartment and nothing else. Call this commit the base.
2. **Capture the oracle** while the old code still runs. The old tests come back from the base
   with `git show`. Where the compartment reads logs, save the old tree's output of
   `bun run runs replay` (or the reader's own command) over the logs it touches. Where it drives a
   campaign, save a rehearsal's events (`bun run runs rehearse`). Keep these in the scratchpad.
3. **`R: <test paths>`**: `git rm` the tests, and commit with that subject and the frame as its body.
4. **Write the tests from the hypothesis**, for the outcome and not the old shape. Keep each
   boundary, fold cases that now assert one thing, and add the cases the hypothesis predicts. Hold
   them to `tools/oxlint/HABITS.md`, 12.12: the smallest owning file, the positive case beside its
   nearest hostile one, a name that is a sentence about the system, a script in every model seat.
   Run them against the old code and sort the failures:
   - a new case failing on behaviour is the hypothesis, failing on purpose;
   - a failure to import or to call a changed interface says nothing yet, and is listed once;
   - a kept boundary failing on behaviour is a boundary written down wrongly, so fix the test;
   - a new case that already passes tests nothing the hypothesis said, so sharpen or drop it.

   Commit with this sorting in the body.
5. **Find the faster path** before writing production. Ask which module should own the behaviour,
   whether a simpler owner already exists, and which functions, union members and fields served only
   the old shape. Count the readers of each export (`git grep -w`): a branch whose producer is
   gone is dead. Prefer the algorithm that computes an answer once, and drop a case only when its producer or
   contract is gone: a case no recorded log reaches can still be a boundary. A negative claim needs the symbol, its call sites and a check in the same turn
   (`AGENTS.md`, section 9).
6. **`R: <production paths>`**: `git rm` the files the rewrite replaces, and commit.
7. **Write production again with the smallest owner the tests allow.** In the same commit, bring
   the neighbours to the new shape: a function the old shape bent, or that the new shape lets be
   simpler, is written again whole, and its file needs no `R:` commit for that. Delete what served
   only the old shape. Run `bun run typecheck`, `bun run lint -- --strict`,
   `bun tools/loc/source-policy.ts` and every test file that imports the compartment, and read each
   exit code.
8. **Put it to the oracle.** Copy each old test file back as `test/_old-<name>.test.ts`, run it
   through `bun run test --`, and move it to the Trash afterwards; compare the saved replay or
   rehearsal with the new tree's. Each difference is intended (the hypothesis named it), a boundary
   retired (name it and why), or a regression (fix it in step 7's commit with `git commit --fixup`
   and `GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash <base>`). Import failures from the
   changed interface are expected and listed once.
9. **Measure and squash.** Run `measure.py --base <base>` over the compartment and set it against
   the budget. Save the working steps as `git branch commit-r/<compartment> HEAD`, then
   `git reset --soft <base>`, run `bun run commit:check`, and make one commit. Its subject states
   the finished change. Its body gives the hypothesis, the budget met or missed, the cases that
   failed on purpose, what the oracle found, and which functions outside the compartment were
   rewritten and why. Delete the saved branch once the pull request merges.

Then take the next compartment from the frame.

## A pass handed to a subagent

Give it the frame, its worktree and its budget, and let it run steps 1 to 9. The session that
handed it out checks the result before repeating it. It runs `measure.py` on the squashed commit
itself and reads any model-visible text the commit changes against the wall tests. It reports a
missed budget as missed.

## What a pass must not do

- **Change what a model reads without saying so.** A string that reaches the Builder, the
  Examiner, a solver or the Referee changes what that seat is told. Say so in the body, with how
  the wall tests still hold (`test/builder.test.ts`, "what crosses to the Builder", and
  `test/builder-led.test.ts`; rule 3).
- **Silence a failing old test.** It is a boundary kept, or one the body retires with its reason.
- **Leave the oracle unrun.** A pass that skipped step 8 says so in its report, and why.
- **Push** unless the operator's task includes publishing; then publish through stack-pr.

## Report

For each compartment:

- the hypothesis, and the budget before, expected and measured (the budget lines of `measure.py`,
  and `stack-complexity.py <base> HEAD` for decision points, import edges, exports and optional
  fields);
- the squashed commit, and the saved branch of working steps;
- the tests: how many, how many failed on purpose, and how each failure class came out;
- what the oracle found: differences intended, boundaries retired, regressions fixed;
- what the simpler form gave up, and anything left for the operator.

When the compartment gave nothing up, say so, since that is the claim a reader checks first.

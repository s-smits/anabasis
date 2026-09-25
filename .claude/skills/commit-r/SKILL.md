---
name: commit-r
description: The commit-R protocol — test-driven rewrite of one compartment. Commit, remove the compartment's tests ("R:" commit), rewrite them from a stated hypothesis so production fails on purpose, remove the production files ("R:" commit), then rewrite production and patch or delete the outdated adjacent functions. Use when the operator says "commit R", "commit-R protocol", "remove and rewrite the tests", or asks for a TDD pass that looks for a faster, simpler path to the same outcome.
---

# Commit R

A test suite that grew alongside its code tends to pin the shape the code happened to take, not
the outcome anyone wanted. Editing either one in place keeps that shape. Commit R removes both
halves of one compartment and writes them again in the order that exposes the difference: first
the tests, from a hypothesis about what the compartment is for, then the production code those
tests now demand. The deletions are commits of their own while the pass runs, so each step can be
read against the one before it. Before anything is pushed, a compartment's commits become one that
passes the gate alone, and its body keeps the argument the steps made.

## The compartment

The unit is a **compartment**: one subject, one target, one component. It is not a file. A
compartment can span a test file, the module it tests, the constant table that module reads, and
two adjacent functions in a neighbouring module that exist only to serve it. What holds it together
is one question someone could want changed. Some examples of that kind of question:

- **climbing:** what the stop tells the operator;
- **information handover:** what one round leaves the next;
- **prompting:** what the Builder is told about the reference solve.

Each compartment gets its own **hypothesis**, written before any test: what should change, and
why a simpler production path probably reaches the same outcome. Two compartments in one pass must
carry different hypotheses. If they would share one, they are one compartment.

Take one to three compartments per pass, which usually comes to 500 to 2,000 test lines in all.
Fewer than that finds nothing new, and more cannot be reviewed as one argument.

## The sequence

Every step ends in a local commit. Only the last of a compartment's four could pass the gate on its
own — an `R:` commit deletes files the rest of the tree imports, and the rewritten tests fail on
purpose — so step 8 squashes them into one before anything is pushed, as AGENTS.md's commit policy
requires of any working commit.

1. **Commit what is in flight.** Start from a clean tree, so the R commits remove only the
   compartment.
2. **`R: <test paths>`**. Read the test files in full first, and write down every boundary they
   hold, because the rewrite has to keep each one or say why it was dropped. Then `git rm` them
   and commit with the subject `R: test/a.test.ts test/b.test.ts` and nothing else.
3. **Rewrite the tests from the hypothesis.** Write for the outcome, not the old shape:
   - keep each boundary the old file held;
   - fold cases that now assert the same thing;
   - add the cases the hypothesis predicts.

   Run them. Production should fail on purpose, and only in the new cases. A new case that passes
   already is not testing the hypothesis, and an old boundary that now fails means the rewrite
   broke something rather than asked something. Commit, and in the body state the hypothesis and
   which cases fail on purpose.
4. **Read why they fail, and look for the faster path.** Before touching production, ask which
   module actually owns the behaviour, whether a simpler owner exists, and which adjacent functions
   or type members only served the old shape. Grep every export and every member of a union: a
   branch whose producer is gone is dead code to remove, not to preserve. A negative claim such as
   "nothing produces X" needs the grep against `origin/main` too, in the same turn.
5. **`R: <production paths>`**. `git rm` the production files the rewrite replaces, and commit with
   the subject `R: src/x.ts src/y.ts`.
6. **Rewrite production, and fix or remove the outdated adjacent code.** Make the new tests pass
   with the smallest owner that holds them. In the same commit:
   - patch the neighbouring modules and their tests;
   - delete what served only the old shape;
   - run typecheck, `bun run lint -- --strict`, `bun tools/loc/source-policy.ts` (no arguments)
     and `bun tools/loc/complexity-policy.ts`, plus every test file that imports the compartment.

   The body says what the rewrite found. Name any behaviour that changed, and any that looked dead
   but is left for the operator because a contract describes it as live.
7. **Fix in place.** Every published commit passes the gate on its own, so a finding on an
   earlier commit is fixed inside it: `git commit --fixup=<sha>`, then
   `GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash <sha>~1`.
8. **Squash the compartment.** `git reset --soft <the commit before its first R:>`, then one
   commit titled for the change the compartment made, whose body joins the hypothesis, the cases
   that failed on purpose and what the rewrite found. Its diff holds every removed and returned
   line.

Then take the next compartment from step 2.

## What a pass must not do

- **Change model-visible text without flagging it as a new condition.** A literal that reaches a
  Builder, Judge or reviewer moves a prompt digest, and a climb-frame line moves `FRAME_REVISION`.
  Say so in the commit body, and leave text whose change is an open operator decision out of scope.
- **Silence a failing old test.** It is either a boundary the rewrite keeps, or one the commit body
  retires, with the reason.
- **Rewrite a compartment someone else is editing.** Check `scripts/worktree.sh list` first.
- **Push.** It stays local, and the operator decides on publication as for any other branch. The
  pre-push gate then runs over each squashed compartment alone and over the pass's tip in full.

## Report

For each compartment, report four things:

- the hypothesis;
- the four working commits (R, tests, R, production) and the squashed commit that replaced them;
- the test count, with how many failed on purpose and then passed;
- what the rewrite found: the owner moved, the branches removed, anything left for the operator.

State the line counts before and after, measured, not estimated.

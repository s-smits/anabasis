---
name: commit-r
description: "The commit-R protocol: a test-driven rewrite of one compartment of Anabasis v2. Commit what is in flight, remove the compartment's tests in an \"R:\" commit, write them again from a stated hypothesis so the production code fails on purpose, remove the production files in a second \"R:\" commit, then write the production code again, rewrite the neighbouring functions the old shape bent, and delete what served only it. Use when the operator says \"commit R\", \"commit-R protocol\", \"remove and rewrite the tests\" or \"rewrite from scratch\", or asks for a test-first pass that looks for a faster, simpler path to the same outcome."
---

# Commit R

A suite that grew beside its code pins the shape the code happened to take, not the outcome
anyone wanted, and an edit in place keeps that shape. Commit R removes both halves of one
compartment and writes them again in the order that exposes the difference: first the tests, from
a hypothesis about what the compartment is for, then the production code those tests now demand.
Each removal is a commit of its own while the pass runs, so each step reads against the one before
it. Before anything leaves the machine the compartment's commits become one, which passes alone and
keeps in its body the argument the steps made.

[simplify](../simplify/SKILL.md) sends its "rewrite from scratch" here, and
[reduce-complexity](../reduce-complexity/SKILL.md) measures what the pass moved.

## The compartment

The unit is a **compartment**: one question someone could want answered differently. It is not a
file. It can span a test file, the module it tests, the constant that module reads and two
functions in a neighbouring module that exist only to serve it. Three of v2's, as examples:

- **what the Builder is told of the past**: the failed practice solves and each comparison's tally
  (`src/builder/past.ts`, `src/builder/prompt.ts`, `test/builder.test.ts`);
- **which tasks a comparison scores**: the frontier draw and the retained tasks beside it
  (`scoredSet` in `src/builder/round.ts`, `poolOf` in `src/kernel/reports.ts`, `test/round.test.ts`);
- **the move that follows a reading** (`decide` in `src/builder/decide.ts`, `test/decide.test.ts`).

Each compartment gets a **hypothesis**, written before any test: what should change, why a path
with about half the machinery probably reaches the same outcome or nearly all of it, and what it
gives up if it does not. Map what stands now as rule 13 of `AGENTS.md` asks,
`owner → live reader → decision it changes → evidence → hostile test`: a concept with a missing
link is what the rewrite drops. Two compartments in one pass carry different hypotheses, or they
are one compartment.

Take one to three compartments a pass, small enough to review as one argument.

## The sequence

Every step ends in a local commit. Only the last of a compartment's four could pass alone: an `R:`
commit deletes files the rest of the tree imports, and the rewritten tests fail on purpose. So
step 8 squashes them before anything is pushed, since every published commit passes alone.

1. **Commit what is in flight**, in a worktree of your own at the top of the stack
   ([stack-pr](../stack-pr/SKILL.md), and never one a run was launched from). The R commits then
   remove the compartment and nothing else.
2. **`R: <test paths>`.** Read the test files whole first and write down every boundary they hold,
   because the rewrite keeps each one or says why it was dropped. Then `git rm` them and commit with
   the subject `R: test/a.test.ts test/b.test.ts` and no body.
3. **Write the tests again from the hypothesis**, for the outcome and not the old shape: keep each
   boundary the old file held, fold the cases that now assert one thing, and add the cases the
   hypothesis predicts. Hold them to `tools/oxlint/HABITS.md`, 12.12: the smallest owning file, the
   positive case beside its nearest hostile one, a name that is a sentence about the system, a
   script in every model seat. Run `bun run test -- <paths>`. The production code fails on purpose
   and only in the new cases: a new case that passes already tests nothing the hypothesis said, and
   an old boundary that fails means the rewrite broke something. Commit; the body states the
   hypothesis and which cases fail on purpose.
4. **Read why they fail, and look for the faster path.** Before touching production, ask which
   module owns the behaviour, whether a simpler owner exists, and which functions or union members
   served only the old shape. Find every reader of each export and each member: a branch whose
   producer is gone is dead code to remove. Then look for the simpler algorithm, the one that
   computes an answer once instead of twice, or drops a case no recorded log reaches
   (`bun run runs replay` reads logs whose last event is `comparison.reported`). A negative claim
   needs the named symbol, its call sites and a check in the same turn (`AGENTS.md`, section 9).
5. **`R: <production paths>`.** `git rm` the production files the rewrite replaces, and commit with
   the subject `R: src/x.ts src/y.ts`.
6. **Write production again, and rewrite or remove what it leaves outdated.** Make the new tests
   pass with the smallest owner that holds them. In the same commit, bring the neighbouring modules
   and their tests to the new shape: a function of a neighbour that the compartment's old shape
   bent, or that the new shape lets be simpler, is written again whole, and its file need not be
   removed in an `R:` commit for that. A patch that only renames a call is the least a neighbour
   takes, and no limit on what it may take. Delete what served only the old shape, and say in the
   body which functions outside the compartment were rewritten and why. Then run `bun run typecheck`,
   `bun run lint -- --strict`, `bun tools/loc/source-policy.ts` (adding no finding) and every test
   file that imports the compartment, and read each exit code. v2 has no complexity gate, so a function's branch
   count is read with reduce-complexity's `measure.py`. The body says what the rewrite found: a
   behaviour that changed, what the simpler form gave up and how that was measured, and code that
   looked dead but stays because a document of record calls it live.
7. **Fix in place.** A finding on an earlier commit is fixed inside it:
   `git commit --fixup=<sha>`, then `GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash <sha>~1`.
8. **Squash the compartment.** `git reset --soft <the commit before its first R:>`, run
   `bun run commit:check`, then make one commit whose subject states the finished change and whose
   body joins the hypothesis, the cases that failed on purpose and what the rewrite found. Its diff
   holds every removed and returned line.

Then take the next compartment from step 2.

## What a pass must not do

- **Change what a model reads without saying so.** A string that reaches the Builder, the
  Examiner, a solver or the Referee changes what that seat is told. Say so in the body, and say how
  the wall test still holds (`test/builder.test.ts`, "what crosses to the Builder"; rule 3).
  Changing what a solver is given or told is the operator's decision (`AGENTS.md`, section 3), so
  such text stays out of scope until the operator gives that word.
- **Silence a failing old test.** It is a boundary the rewrite keeps, or one the body retires with
  its reason.
- **Rewrite a compartment another session is editing.** Read the open pull requests
  (`bun .claude/skills/stack-pr/scripts/stack.ts`) and `git worktree list` first.
- **Touch a pack, a check program, a kept harness or a log** (rule 2, and `.ana/` in section 11).
  A compartment is the host's code.
- **Push.** The pass stays local, and publication is the operator's, through stack-pr.

## Report

For each compartment:

- the hypothesis;
- the four working commits (R, tests, R, production) and the squashed commit that replaced them;
- the tests, with how many failed on purpose and then passed;
- what the rewrite found: the owner moved, the branches removed, what the simpler form gave up,
  and anything left for the operator.

Give the size before and after as measured, never estimated: the budget lines of `measure.py`, and
the structural rows of `stack-complexity.py` (decision points, import edges, exported symbols,
optional fields) over the compartment's commit. When the compartment gave nothing up, say so,
since it is the claim a reader checks first.

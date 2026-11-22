---
name: commit-r
description: "Rewrite a single Anabasis compartment using the existing code or test suite as a behavioural oracle: test-first when an outcome or interface changes, as an oracle-verified refold when every output is preserved, or as a test pass verified by mechanical mutants when example tests give way to bounded checks and properties. Use when asked to rewrite, overhaul, rebuild, or accelerate code or tests, consolidate unit tests, or run Commit R; also within an authorised change when the existing shape requires another special case or roughly half the machinery would achieve the same behaviour. Whole-stack overhauls belong to stack-pr and consolidate-stack."
---

# Commit R

A test suite tends to pin the incidental shape of the code it was written against. Commit R
isolates one compartment, retains the existing code as a behavioural oracle, and replaces it with
the minimal implementation that satisfies the required outcomes so that every deviation from the
oracle is either an intended change, a retired boundary with an explicit rationale, or a detected
regression. [simplify](../simplify/SKILL.md) routes structural rewrites here, and
[reduce-complexity](../reduce-complexity/SKILL.md) owns the before-and-after measurements.

## When to start a pass

Start a Commit R pass whenever the operator asks to rewrite, overhaul, or rebuild code. Within an
authorised task that already modifies a compartment, initiate one yourself when a fix adds another
special case to a long patch history (`git log -L :<function>:<file>`), when roughly half the
concepts would deliver the same outcome, when two owners decide the same fact (`AGENTS.md`, rule
12), when tests pin internal structure rather than behaviour, or when a function already near 115
lines or 21 decision points (`measure.py`) would grow further. Inform the operator in one sentence
which compartment and metric you intend to improve, then proceed; propose rather than execute
rewrites outside the assigned task scope.

## Three kinds of pass

Select the target compartment by measured complexity (`measure.py`, plus a profile when performance
is the goal) rather than raw file size, and declare the pass type in the opening frame:

- **Rewrite**: alters an observable outcome or external interface. **Rewrite and commit the tests
  before deleting any production code**, then **implement production code to satisfy those tests**.
  This prevents fitting tests to the new implementation and ensures running the new tests against
  the old code distinguishes intended behavioural changes from regressions.
- **Refold**: preserves every observable output (for example, caching a recomputed result or
  folding a duplicate helper into its owner). Existing tests remain untouched, steps 3, 4, and 6
  are skipped, and byte-identical output against the oracle verifies equivalence. The first
  intended behavioural difference turns a refold into a rewrite.
- **Test pass**: keeps production logic unchanged and replaces example-based tests with bounded
  checks and properties (`AGENTS.md`, section 12). Steps 5 to 7 are skipped; the new tests must
  pass against unchanged production code (any failure exposes a real defect, fixed in its own
  commit), and step 8's mutation suite serves as the oracle. Production code may gain a narrow seam
  for observability without altering any decision logic.

## The frame

Write the frame before deleting any code, as the commit body of the first `R:` commit (or of a
refold's single commit):

- **Compartment**: one cohesive responsibility someone could ask to change, together with its
  tests, owning modules, and immediate callers, sized to fit cleanly in one context.
- **Concept map**: `owner → live reader → decision it changes → evidence → hostile test` for each
  concept (`AGENTS.md`, rule 13); drop any concept with a missing link.
- **Hypothesis**: why roughly half the machinery achieves the same outcome, what it sacrifices, and
  the count that would refute it.
- **Budget**: current and target values for nonblank lines, decision points, and exports
  (`.claude/skills/reduce-complexity/scripts/measure.py <files...>`), plus runtime in seconds when
  speed is an objective, estimating the target concept by concept from the map.
- **Boundaries**: every edge case enforced by existing tests plus every untested guard (refusals,
  pre-deletion checks, fallbacks), since untested guards are the easiest to drop inadvertently.

## The sequence

Commit each step locally; after context compaction, resume from `git log` starting at the first
`R:` commit. Any test modified after production writing begins must state its reason in the commit
message.

1. **Commit work in flight** in your own worktree at the stack top ([stack-pr](../stack-pr/SKILL.md))
   to establish a clean base.
2. **Capture the oracle**: record the existing test suite and run the existing code on real inputs
   in a read-only or non-mutating mode (`bun run runs replay`, `bun run runs rehearse`, a dry run,
   or a scratch script reading closed campaigns under either tree). Store real outputs in the
   scratchpad so campaign log excerpts never enter tracked files.
3. **`R: <test paths>`**: remove the old tests with `git rm` and commit with the frame.
4. **Write behavioural tests** targeting outcomes rather than internal structure
   (`tools/oxlint/HABITS.md`, 12.12). Run them against the old production code and classify every
   failure: a new case failing on behaviour confirms the hypothesis; an interface mismatch requires
   a temporary `test/_sort-<name>.test.ts` adapter to verify against the old code; a failing
   preserved boundary indicates a buggy test; a case intended to fail that passes needs sharpening.
   Commit the tests with this classification.
5. **Design the simpler implementation**: identify the true owning module and remove symbols that
   existed solely for the old shape (`git grep -w` on each export), applying `simplify`'s shapes
   and ladder to every concept. Drop a case only when its producer or contract is gone.
6. **`R: <production paths>`**: remove the replaced production files with `git rm` and commit.
7. **Write production code** using the smallest owner that satisfies the tests, rewriting any
   neighbouring consumer that was contorted around the old interface. Run `bun run typecheck` (the
   commit hook does not run it), `bun run lint -- --strict`, `bun tools/loc/source-policy.ts`, and
   every test importing the compartment, checking each exit code. Never meet a complexity budget by
   dropping a boundary: if a simplification breaks a test, restore the required behaviour.
8. **Verify against the oracle**: restore the old tests as `<original directory>/_old-<name>.test.ts`,
   run them with `bun run test --`, and diff outputs on step 2's inputs (requiring an empty `diff`
   for text). Next, run mutation testing on the owning files in a base-commit worktree copy with
   the old tests restored across three suites: `old` (restored tests), `new`, and `kept` (all other
   tests importing the owner):

   ```sh
   bun .claude/skills/commit-r/scripts/mutate.ts run <copy> <files...> --out <scratchpad>/kills.jsonl --suites <suites.json> --jobs 6 --stop-at-kill
   bun .claude/skills/commit-r/scripts/mutate.ts report <scratchpad>/kills.jsonl --old old [--survivors]
   ```

   Pass suite order `new`, `kept`, `old` with `--stop-at-kill` only when rerunning `--survivors`,
   because the initial baseline needs every suite's verdict. Every `O-` mutant (killed by `old`
   alone) must either be covered by a restored test case or accounted for in the commit message as
   incidental (phrasing, internal layout) or an erroneous old test; leaving more than roughly 15%
   of old kills unexplained halts the pass. Trash the restored old tests, then benchmark old and
   new timings alternately at least twice, recording every measurement. Fold any regression fix
   into step 7 (or step 4 for a test pass) via `git commit --fixup` and
   `GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash <base>`.

   For code that deletes or moves files on disk, execute first against a full copy-on-write clone
   (`cp -cRp`) with all symlinks retargeted inside the copy; for git worktrees, rewrite each copied
   `.git` file and admin `gitdir` manually and restore timestamps with `touch -h -r`, since
   `git worktree repair` would mutate the real repository. Compare the copy's dry run with the real
   tree's dry run, execute on the copy, verify that only the intended targets changed, and report
   any real-tree aspects missing from the copy as untested.
9. **Measure and squash**: run `reduce-complexity`'s
   [One diff command](../reduce-complexity/SKILL.md#single-diff-budgets-and-per-function-branch-counts)
   against the base, save a backup branch (`git branch commit-r/<compartment> HEAD`), run
   `git reset --soft <base>`, verify with `bun run commit:check`, and create a single commit whose
   body records the hypothesis, budget met or missed, intended failures, oracle findings, and
   rewritten neighbours. Retain the backup branch until merge. Because the Commit R pass is itself
   the simplification, no separate `/simplify` pass is needed: once checks pass, proceed to the
   pull request.

## Constraints

- Never modify a pack, check program, kept harness, or log (`AGENTS.md`, rule 2), another session's
  compartment, or a live run's worktree; `vendor/` changes only by a documented sed.
- Never alter what a model seat reads without documenting the change and confirming
  `test/builder.test.ts` and `test/builder-led.test.ts` still hold (rule 3); solver-facing changes
  require operator authorisation.
- Never silence a failing legacy test or skip oracle verification without an explicit explanation.
- Never label a pass a refold to avoid updating tests when an observable output changes.
- Do not push unless the task explicitly includes publishing via `stack-pr`.

## Report

For each compartment, report: pass type and hypothesis; complexity budget before, expected, and
measured (`measure.py`, `git complexity <base> HEAD`), naming the boundary behind any miss;
squashed commit SHA and backup branch name; test counts and failure classifications; any tests
edited after production work started; oracle diffs with dispositions and alternating timings;
copy-run results and gaps; and any capability or assumption traded away by the simpler design.

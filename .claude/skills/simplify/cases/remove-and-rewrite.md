# Remove, or remove and rewrite

The first screen of `SKILL.md` still governs. This file covers the two
invocations where the deletion is already decided.

## "remove X and /simplify"

You are not being asked whether X should go. You are being asked what goes
with it and what the tree looks like afterwards. Start from the removal and
work outward. If a live consumer blocks it, name that consumer and stop. Do not
quietly turn the request into a tidy-up.

Follow the whole strand, not just the file, and finish each step before
reporting:

- **Consumers.** Grep the symbol; `measure.py` lists exports by caller count.
  Each caller either goes too or gets simpler now that the value cannot occur.
- **The type.** A field only X ever set leaves the interface; otherwise every
  reader keeps a branch for a state that can no longer happen.
- **Guards.** Null checks, `?? []` and filters that existed because X could
  yield nothing now protect nothing. Drop them.
- **Tests.** A test of X alone goes. A test that pinned other behaviour through
  X is re-fixtured, not deleted.
- **Bookkeeping and prose.** Policy files, baselines and ledgers the
  skill names, and comments describing X: update them in the
  same change.

Watch for:

- **The need behind X.** If X was a patch, the removal leaves the original
  failure open. Fix it at its owner (for example, the controller's shutdown
  order, not a kill in each tool) or say plainly that it is still open.
- **A stranded reader.** Removing the only writer of a field or event leaves a
  reader that always sees the empty case. That reader is now the finding.
- **A second owner.** If removing one of two mechanisms shows the other is
  enough, say so. That is usually the larger simplification.
- **Removal that only moves code.** Pasting a helper's body into three call
  sites is not a removal. Either one caller owns it or it stays.

## The R protocol: remove, commit, rebuild

Use it for "rewrite from scratch", "completely remove and rewrite" and
overhauls that span several files. The operator reads the rebuild as a diff
against an empty slate, not as an edit of the old code.

1. **Choose the files and functions from evidence.** Pick them from the latest
   recorded runs or the failing path, and name the one fact each rewrite
   carries. Save copies of the old files to the scratchpad for reference.
2. **A test file brings its subject.** When a test file is in scope, so is
   the production it directly touches: every function or constant it imports
   from `src/`, `tools/` or `vendor/` whose behaviour its assertions check.
   Utilities it only uses to set up or read (`join`, `readFileSync`,
   `parseJsonAs`, a scratch helper) are not its subject, and neither is
   anything it reaches only through `test/helpers/` or a deeper import.
   Rewriting the test alone leaves the code it exists to hold exactly as it
   was, which is the smaller half of the job: the rebuilt test is the
   specification, and the production it touches is rebuilt against it. List
   each subject function with its callers outside the test before deleting
   anything; those callers keep compiling against the rebuilt signature, or
   move with it in the same pull request.
3. **Delete them outright and commit the removal alone**, with the subject
   `R`: the test files, and the subject functions' bodies. A subject file
   whose every export is in scope goes whole; otherwise the functions go and
   the rest of the file stays. The tree need not build at this commit.
4. **Rebuild tests first, then production.** Write each test from the
   behaviour it pins, run it against the empty subject and watch it fail, then
   rebuild the subject until it passes, from the fact it carries rather than
   from the old structure. A test that passes against a deleted subject is
   testing a helper, not the subject. Keep recorded data shapes readable:
   evidence already on disk must still parse. Squash `R` into its rebuild
   before anything is pushed, because every pushed commit passes alone.
5. **Then consolidate the neighbours.** The files next to the rebuilt
   subjects, those that import one or are imported by one, get an ordinary
   simplify pass rather than a rewrite: merge what the rebuild made
   duplicate, drop what its new signature made unreachable, inline a wrapper
   that only adapted to the old shape. Name them before starting, about seven
   for three rewritten subjects, chosen by how much of their code touches the
   subject rather than by size.
6. **Prove it.** Run the owning tests, every other test that imports a
   rebuilt subject, then replay recorded inputs through the new code where it
   produces records. Report old versus new with
   `measure.py --base <commit before R>`: concepts, production lines, new
   functions, for tests and production separately. A pass whose production
   line count did not move rewrote only the tests.

Before step 3, check that nothing outside the rewrite reads the fields you
intend to drop. Recorded manifests with unknown keys are fine only when the
reader ignores extra keys; confirm that in source.

## Worked examples

- **`transplantWitnesses`.** A filter "dropping nothing in production"
  existed only to satisfy a row type that allowed a null artifact the census
  had already refused. The work was to remove the filter, then stop the type
  admitting the null, so the guard became unnecessary everywhere.
- **An abort-kill in the isolated command runner (2026-09-15).** The spawner
  already killed the group on timeout and in `finally`. The operator said
  "remove and /simplify - why do we even need to kill", then "one layer
  higher". The kept fix stopped the running commands once, in the
  controller's close path.
- **Difficulty rewrite on PR #703 (2026-09-16).** Commit `1ed6d7d05` (`R`)
  deleted three files; `cbdca8c3d` rebuilt them around one band owner. The
  recorded measurement shapes stayed unchanged because saved batteries depend
  on them.

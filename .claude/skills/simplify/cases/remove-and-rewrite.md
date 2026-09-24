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
2. **Delete them outright and commit the removal alone**, with the subject
   `R`. The tree need not build at this commit.
3. **Rebuild one category per commit**, from the fact each file carries rather
   than from the old structure. Keep recorded data shapes readable: evidence
   already on disk must still parse.
4. **Prove it.** Run the owning tests, then replay recorded inputs through the
   new code where it produces records. Report old versus new with
   `measure.py --base <commit before R>`: concepts, production lines, new
   functions.

Before step 2, check that nothing outside the rewrite reads the fields you
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

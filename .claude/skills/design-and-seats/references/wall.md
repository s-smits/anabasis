Read this before changing what the Builder, solver or Examiner can read. It explains "Two sides and
one wall" in `AGENTS.md` section 1; `scripts/seat-view.ts` names the wall tests a diff owes.

## 1. What Anabasis does

### Two sides and one wall

The wall is what makes a step mean generalisation. Practice tasks are the Builder's training set,
read whole, measures that depend on hidden values included, each measure told to four digits
(`MEASURE_DIGITS`, `src/builder/tools.ts`) so that differences under the 1% tie floor do not
read as signal; the rounding is no part of the wall. Held-out tasks are its test set. A
Builder that learned anything of a held-out task, even which one its harness won, could fit the test
set, and a step would then measure that fit.

The wall runs one way. The Examiner reads reference outcomes and each task's winner, which may pull
tasks towards the newest harness; admission limits this by requiring room on the reference, and the
operator accepted the remaining risk. What crosses to the build side is the closed list in
`AGENTS.md` section 1, tested byte for byte (rule 3).

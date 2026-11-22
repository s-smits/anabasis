Read this before changing what the Builder, solver or Examiner can read. It explains "Two sides and
one wall" in `AGENTS.md` section 1; `scripts/seat-view.ts` names the wall tests a diff owes.

## 1. What Anabasis does

### Two sides and one wall

The wall is what makes a step mean generalisation. Practice tasks are the Builder's training set,
read whole but for the verifier's measures, which may depend on hidden values: a valid answer's
measure is told only as a band of the gain a comparison would read over the author's answer on
record (`bandOf`, `src/builder/tools.ts`), since a few measures to four digits let one jobstat
Builder solve for a task's hidden values and build its harness on them. Two answers crafted to
straddle a band's edge can still bracket a hidden value, at a solve each and only through a harness
that names the task, which `AGENTS.md` section 2, item 3, forbids. Held-out tasks are its test set. A
Builder that learned anything of a held-out task, even which one its harness won, could fit the test
set, and a step would then measure that fit.

The wall runs one way. The Examiner reads reference outcomes and each task's winner, which may pull
tasks towards the newest harness; admission limits this by requiring room on the reference, and the
operator accepted the remaining risk. What crosses to the build side is the closed list in
`AGENTS.md` section 1, tested byte for byte (rule 3).

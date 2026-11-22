Read this reference before modifying what the Builder, solver, or Examiner can observe. It expands
"Two sides and one wall" in `AGENTS.md` section 1; `scripts/seat-view.ts` identifies the wall tests
required by any diff.

## 1. What Anabasis does

### Two sides and one wall

The information wall is what ensures that a promoted step reflects out-of-sample generalisation.
Practice tasks form the Builder's training set and are exposed in full except for the verifier's
objective measures, which may depend on hidden values: a valid answer's measure is reported only as a
coarse band of the gain a comparison would read over the author's best recorded answer (`bandOf`,
`src/builder/tools.ts`), because exact four-digit measures allowed a Builder to solve for a task's
hidden values and fit its harness to them. Two answers crafted to straddle a band boundary can still
bracket a hidden value, at one solve each and only through a harness that names the task, which
`AGENTS.md` section 2, item 3, forbids. Held-out tasks form the evaluation test set. If the Builder
could observe any detail of a held-out task, even which task its candidate won, it could overfit the
test set and subsequent steps would measure memorisation rather than generalisation.

The wall is asymmetric. The Examiner observes reference outcomes and each task's winning harness,
which creates a mild feedback risk that new tasks drift towards the latest harness. Admission
mitigates this by requiring unresolved frontier tasks on the reference harness, and the operator
explicitly accepts the residual risk. Only the closed list in `AGENTS.md` section 1 crosses to the
build side, and this boundary is tested byte for byte (rule 3).

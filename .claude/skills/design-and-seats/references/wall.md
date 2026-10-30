Read this before changing what the Builder, solver or Examiner can read. This expands "Two sides and
one wall" in `AGENTS.md` section 1. Use `scripts/seat-view.ts` to trace imports and identify the
relevant wall tests.

## 1. What Anabasis v2 does

### Two sides and one wall

The exam side knows what a right answer is; the build side tries to produce right answers. The
measurement is worth something only because the build side never learns what the exam side knows, so
the wall between them is the system's main asset.

The wall runs one way. The Builder is the learner, practice tasks its training set and held-out
tasks its test set: it reads practice whole, and a step says the harness is better on tasks it never
saw. A Builder that learned anything of a held-out task, even which one its harness won, could fit
the test set, and a step would measure that fit. The Examiner can read feedback in the other
direction: reference outcomes and each task's winning harness (section 3). This may shape tasks
towards the newest harness. Admission limits that risk by requiring room on the reference; the
operator accepted the risk on 20 October.

What crosses from the exam side to the build side is the closed list in `AGENTS.md` section 1, and
nothing else (rule 3).

Read this before you change anything a Builder or a solver reads, or what the Examiner may read of
the build side. It holds `AGENTS.md` section 1, "Two sides and one wall"; run `scripts/seat-view.ts`
to see which seats a change reaches and which wall tests prove it.

## 1. What Anabasis v2 does

### Two sides and one wall

The exam side knows what a right answer is; the build side tries to produce right answers. The
measurement is worth something only because the build side never learns what the exam side knows,
so the wall between them is the system's main asset.

The wall runs one way. The Builder is the learner, practice tasks its training set and held-out
tasks its test set: it reads practice whole, and a step says the harness is better on tasks it never
saw. A Builder that learned anything of a held-out task, even which one its harness won, could fit
the test set, and a step would measure that fit. The other direction is open: the Examiner reads
what the reference did on each task and which harness won it (section 3), a risk of exams written
towards the newest harness that task admission bounds by admitting only tasks with room, and that
the operator accepted on 20 October.

What crosses from the exam side to the build side is the closed list in `AGENTS.md` section 1, and
nothing else (rule 3).


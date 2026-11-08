Read this for the evaluation question and the four reported factors behind `AGENTS.md` section 1.
The information boundary is in `wall.md`.

## 1. What Anabasis does

Anabasis is a training loop whose learner is a harness and whose loss is measured by running a fixed
solver on held-out tasks. The question, the tally and the test are in `AGENTS.md` sections 1 and 7.

### The four reported factors

A useful loop needs a signal that carries information, an evaluation less noisy than the effect,
correct labels and a result worth its cost. Supply is checked at admission, and the four factors are
reported. Recorded values live only in `docs/plan.md`, "Goal and the four factors".

**Supply** is the gradient. A task registers a difference only where one harness answers and the
other does not, or answers better by the objective (`informative`, `src/kernel/compare.ts`). Tasks
the reference always closes, and tasks nobody solves, read "no room" whatever the candidate is.
Informativeness is known only after solving, so admission counts the frontier instead
(`comparisonFloor`). Meeting the floor shows only that a difference could be seen, so supply is not
reported.

**1. Climb** is the reference harness moving. A promotion is one step of descent, a climb several
within one campaign (`src/campaign/climb.ts`). A draft the reference never answered but whose
author's answer passes (`task.feasible`) is held out like any other (`measured`,
`src/examiner/write.ts`), since that is the room a promotion leaves; the passing answer does not
show the public input suffices, so a held task nobody answers may be underspecified until a person
reads it. An older log's `ladder` tasks read as held out and its ladder readings decide nothing
(`lastReports`, `src/kernel/reports.ts`). Improvement patience marks a possible plateau without
proving that no step remains, so a campaign ended on budget, environment or `finished` reads
"reached N promotions; further improvement unresolved".

**2. Honesty** is the false-positive rate. The level is per comparison and nothing bounds a
campaign's many attempts together, so no opening is refused on their sum. Each reading prints its
own rate (`falseRate`, `src/campaign/comparison.ts`) and the opening prints it at its target
(`sizeLines`, `src/kernel/size.ts`). The A/A beside each comparison measures the rate on the real
solver, where a step is a false positive by construction. The climb sums the attempts' rates as an
estimate and counts the A/A steps, leaving out an A/A too small to reach the level
(`falsePromotion`, `incapable`).

**3. Verdicts** is label noise. Nobody has audited the check program against the field, and a check
that rejects a right answer mislabels the task. The Referee filters this noise before a rejection
counts; its evidence rules are in the head comment of `src/referee/referee.ts`, and a ruling without
them is refused and logged. It is itself measured against blind hand labels (`tools/d2/settle.ts`,
`src/referee/agreement.ts`): two rates, each kind's agreement, PABAK beside kappa, and each settled
comparison reread with the labels (`swapped`), where a decision that flips means the packet was too
small.

**4. Economy** is cost per gain, read from the log at frozen list prices (`billOf`,
`src/kernel/meter.ts`, the same meter the cap uses), with backend totals beside it (`costLine`).

Left out on purpose: the wall (a tested correctness property), practice results (training score,
rule 1) and cost apart from climb.

### Older vocabulary

v1 is the history before v2 (`git show 5bc9988:<path>`, `docs/transfer.md`). A comment citing
"AGENTS.md rule N" in code inherited from v1 (`src/meta`, `src/wall`, `tools/loc`, `tools/oxlint`)
means v1's numbering. An **epoch** is a stretch under one reference; a **cycle**, **sweep** and
**bundle** name the stored v1 run a pack comes from.

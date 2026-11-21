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

### Further trade-offs

`AGENTS.md` section 1 keeps the trade-offs a change most often gets wrong; these are the rest.

- **Task difficulty against statistical power**: tied tasks leave the test, and a step is likeliest
  where the reference passes 30 to 50%; watch its valid share and the untied tasks a comparison.
- **A stricter step against a faster climb**: 2 solves at 0.02 is the balance; an A/A step means the
  level is loose for the noise, and a faster climb is a gain only where its promotions hold.
- **Cost against value**: read dollars per promotion and per confirmed promotion on one meter
  (`promotion-tuner`), and dollars a solve rising without validity gains as bloat.
- **Supply against the clock**: an Examiner that aims higher takes longer and admits fewer; read
  hours to the next comparison beside the tasks it admitted.
- **Patience against stopping too soon**: six eligible moves without a gain end a campaign, and
  each move after is another draw at the false rate; treat a step after `--past-stop` warily.
- **A promotion against the starter**: a promotion beats its parent on the tasks that chose it, and
  a near-sweep of one family from the newest session says less than the same tally over several. The
  starter comparison after it splits its tally by where each task came from (`starterReads`), and a
  reference that keeps losing the tasks written since is fitting its own draws, not climbing.
- **The objective against the habits it leaves unpaid**: a harness learns only what the checks and
  the objective reward, so a habit no check holds, a section's content for one, is no lever yet.
- **A tuned query against its origin**: a query adapted from another system's prompt is bounded, in
  words, against that origin instead of its last version, so that drift does not accumulate.

### Older vocabulary

v1 is the history before v2 (`git show 5bc9988:<path>`, `docs/transfer.md`). A comment citing
"AGENTS.md rule N" in code inherited from v1 (`src/meta`, `src/wall`, `tools/loc`, `tools/oxlint`)
means v1's numbering. An **epoch** is a stretch under one reference; a **cycle**, **sweep** and
**bundle** name the stored v1 run a pack comes from.

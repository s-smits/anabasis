Read this reference for the evaluation question and the four reported factors behind `AGENTS.md`
section 1. The information boundary is documented in `wall.md`.

## 1. What Anabasis does

Anabasis is an iterative optimisation loop in which the learned artefact is a harness and the
objective is evaluated by running a fixed solver policy on held-out tasks. The core evaluation
question, the tally, and the statistical test are defined in `AGENTS.md` sections 1 and 7.

### The four reported factors

A functioning improvement loop requires an informative learning signal, an evaluation noise floor
lower than the effect size, accurate labels, and gains that justify their compute cost. Supply is
enforced at admission, and the four factors are reported in campaign summaries. Recorded values are
maintained exclusively in `docs/plan.md` under "Goal and the four factors".

**Supply** provides the learning gradient. A task contributes to a comparison only when one harness
solves it and the other does not, or when one achieves a better objective score (`informative`,
`src/kernel/compare.ts`). Tasks that the reference always solves, and tasks that neither harness
solves, yield no gradient regardless of candidate quality. Because informativeness is observable
only after solving, admission counts frontier tasks instead, namely tasks the reference has not yet
closed (`comparisonFloor`). Meeting this floor establishes only that an effect is detectable, so
supply itself is not a reported outcome factor.

**1. Climb** measures movement of the reference harness. Each promotion represents one accepted
improvement step, and a climb comprises multiple promotions within a single campaign
(`src/campaign/climb.ts`). A draft task that the reference has never solved, but whose author's
solution passes the checks (`task.feasible`), enters the held-out pool like any other task
(`measured`, `src/examiner/write.ts`), since unsolved feasible tasks provide the headroom for future
promotions. A passing author solution does not guarantee that the public prompt alone is
sufficient, so a held-out task that nobody solves may remain underspecified until inspected by a
person. In older logs, `ladder` tasks are read as held-out tasks and their ladder readings carry no
decision weight (`lastReports`, `src/kernel/reports.ts`). Improvement patience indicates a possible
plateau without proving that no further gain exists; accordingly, a campaign ending on budget,
environment, or `finished` reports "reached N promotions; further improvement unresolved".

**2. Honesty** tracks the false positive rate. The significance level applies per comparison rather
than across the full sequence of campaign attempts, so openings are not refused on cumulative
multiplicity. Each comparison reading reports its own nominal false positive rate (`falseRate`,
`src/campaign/comparison.ts`), and each opening prints the rate at its target sample size
(`sizeLines`, `src/kernel/size.ts`). An A/A control (the reference evaluated against itself) runs
alongside each comparison to measure the empirical false positive rate on the actual solver, where
any detected step is a false positive by construction. The climb report sums per-attempt rates as an
upper estimate and tallies A/A steps, excluding A/A controls whose sample size is too small to reach
the significance level (`falsePromotion`, `incapable`).

**3. Verdicts** measures label noise. Because the check program is not audited against the domain in
advance, a defective check that rejects a valid answer introduces false-negative label noise. The
Referee filters this noise before a rejection enters the tally; its evidence requirements are
documented in the head comment of `src/referee/referee.ts`, and any ruling lacking the required
evidence is refused and logged. Referee accuracy is itself calibrated against blind human labels
(`tools/d2/settle.ts`, `src/referee/agreement.ts`), reporting both error rates, per-category
agreement, PABAK alongside kappa, and a counterfactual rereading of each settled comparison under
the human labels (`swapped`), where a flipped decision indicates that the evaluation packet was
underpowered.

**4. Economy** measures compute cost per promotion, computed from the log at frozen list prices
(`billOf`, `src/kernel/meter.ts`, the same meter enforcing the budget cap), with backend totals
printed alongside (`costLine`).

Three quantities are deliberately excluded from the reported factors: the information wall (a
binary correctness property verified by tests), practice results (training performance, rule 1), and
raw expenditure divorced from climb.

### Further trade-offs

`AGENTS.md` section 1 lists the trade-offs that changes most frequently violate; the remaining ones
are summarised below.

- **Task difficulty versus statistical power**: tied tasks drop out of the paired test, and a step
  is most easily detected when the reference pass rate lies between 30% and 50%. Monitor both the
  reference validity share and the count of untied tasks per comparison.
- **Stricter promotion threshold versus climb speed**: two solves per task at level 0.02 balances
  power against noise. An A/A step indicates that the significance level is too loose for the
  observed variance, and a faster climb is valuable only if its promotions hold on fresh evaluations.
- **Cost versus value**: evaluate dollars per promotion and dollars per confirmed promotion on a
  single consistent meter (`promotion-tuner`), and treat rising cost per solve without corresponding
  validity gains as harness bloat.
- **Supply versus wall-clock latency**: an Examiner targeting higher difficulty takes longer and
  admits fewer tasks; read wall-clock hours to the next comparison alongside the count of admitted
  tasks.
- **Patience versus premature stopping**: six eligible moves without a gain terminate a campaign,
  and every subsequent attempt adds another draw at the false positive rate. Treat any step obtained
  after `--past-stop` with caution.
- **Incremental promotion versus the starter baseline**: a promoted candidate outperforms its parent
  on the specific tasks that selected it, and a near-sweep of one task family from the newest
  session is weaker evidence than the same margin spread across several epochs. The subsequent
  starter comparison partitions its tally by task provenance (`starterReads`); a reference that
  repeatedly loses on newly authored tasks is overfitting its earlier draws rather than climbing.
- **Declared objective versus unmeasured habits**: a harness optimises only what the checks and
  objective reward, so any desired behaviour not enforced by a check provides no optimisation signal.
- **Tuned query versus original prompt**: a domain query adapted from another system's prompt is
  bounded in word count against that original prompt rather than its previous revision, preventing
  cumulative prompt drift.

### Older vocabulary

v1 refers to the codebase prior to v2 (`git show 5bc9988:<path>`, `docs/transfer.md`). Comments
citing "AGENTS.md rule N" in modules inherited from v1 (`src/meta`, `src/wall`, `tools/loc`,
`tools/oxlint`) refer to v1's rule numbering. An **epoch** denotes the span of a campaign under one
reference harness; **cycle**, **sweep**, and **bundle** refer to the archived v1 run from which a
pack was extracted.

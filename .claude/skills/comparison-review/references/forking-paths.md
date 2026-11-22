# How a review deceives itself

A comparison locks its terms before the first solve (rule 4); a post-hoc review, by contrast, can examine dozens of slices of a small sample without making a single factually false statement, a classic garden of forking paths. The safeguards below keep exploratory analysis disciplined so that every surviving lead carries known evidential strength.

## Recording every look

- **Hidden looks** (running an exploratory slice and omitting it when uninteresting): log every cut in the ledger before executing it, marking unplanned cuts as `after seeing`.
- **Uncounted families of cuts** presented as a single finding: report the total number of cuts examined beside any observed pattern (for example, "one of 14 cuts").
- **Rewriting history**: the ledger is append-only; corrections enter as new rows citing the superseded entry.
- **Feigned blindness**: open the ledger by listing every score, cut, and deliverable already inspected before the freeze.

## Reusing data for discovery and confirmation

- **Confirming on exploratory data**: reserve the sealed half and unseal it once against pre-registered predictions.
- **Underpowered seals**: even a sealed half too small to detect a statistical step can falsify a directional narrative; state its power limit plainly and confirm on a fresh test.
- **Reusing burned tasks as fresh evidence**: maintain a cumulative list of every task whose deliverable, trace, or rubric anyone has inspected closely (including blind reviewers). Burned tasks may serve as regression checks but never count as fresh confirmation for a proposal they inspired. A benchmark with no unburned tasks is no longer held out.
- **Gradual overfitting to the benchmark**: every proposed fix must clear the eight-question gate independently, and the burned-task list carries across successive reviews.

## Selection bias in reading

- **Inspecting losses only**: apply the same inspection protocol to wins and losses alike, and require any preferred explanation to account for both directions.
- **Selecting on extremes**, which regress to the mean: inspect every task in the open half, or draw a deterministic hash-based sample.
- **Metric shopping**: freeze one primary measure in the ledger before reading outcomes, treating all other metrics as descriptive context.
- **Post-hoc subgroups**: count every subgroup split as an exploratory cut; on an eight-task sample, a subgroup is an anecdote rather than evidence.

## Causal overclaiming

- **Just-so stories**: commit at least three rival explanations, including one innocent explanation and one blaming the instrument, each paired with a falsifying count.
- **Unverified mechanisms**: cite the exact trace or log event linking cause to effect, or mark the mechanism unproved. A factual error can be a real defect without having caused the score gap.
- **Conflating recovery with work**: classify turns by activity type before comparing averages (level 9).
- **Sighted card writing**: draft shape cards from both winning and losing rows, report counts by direction, and have a blinded reader evaluate the mirror question.
- **Mistaking instrument artefacts for capability**: complete level 6 (grader visibility) before level 8 (per-task splits).
- **Unverified claims of absence**: inspect the symbol, its callers, and a direct check in the same turn (`AGENTS.md` section 9).

## Statistical pitfalls

- **Claiming "within the noise" without a noise measurement**: cite a clean A/A control or state explicitly that variance is unmeasured.
- **Treating mixed conditions as a controlled comparison**: differences across mismatched settings are descriptive only (rule 5, section 9).
- **Reporting discovery p-values**: report counts and effect sizes during exploration, reserving p-values for the pre-registered primary measure.
- **Unadjusted multiple testing**: apply Holm correction or designate a single primary test and treat the rest as descriptive, fixed before inspecting fresh data.
- **Ignoring statistical power**: report sample size alongside the minimum detectable effect (`size.ts`); a `no-step` reading is not evidence of equivalence.
- **Winner's curse**: size confirmation experiments for half of the initially observed effect size.
- **Optional stopping**: fix rollout counts before running (rule 4); any subsequent top-up is a separate comparison reported beside the first.
- **Bare rates**: always report denominators alongside percentages or proportions.

## Reviewer and session biases

- **Anchored reviewers**: give blind reviewers pointers and open questions only, never prior findings or counts (`report.md`'s blind brief).
- **Nominal blindness**: file paths or guide phrasing can leak arm identity; replace arm names with hashes and note any residual leakage channels.
- **Mistaking agreement for replication**: multiple readings of one dataset remain a single sample, and every subagent's count must be independently verified against the raw record (`AGENTS.md` section 11).
- **Sycophancy**: report the same counts in the same order regardless of which arm came out ahead.

## Low-cost sanity checks

Run these checks on the existing data before proposing any system change:

- **Mirror question**: would this change still be proposed if the comparison outcome had reversed?
- **Label swap**: if an equally convincing narrative emerges after swapping arm labels, the analysis is fitting noise.
- **Placebo tasks**: check whether the proposed mechanism appears equally often on tied tasks.
- **Leave-one-out sensitivity**: check whether removing a single task flips the sign of the gap.
- **Shared-miss check**: a weakness exhibited equally by both arms cannot explain the difference between them.

## Permissible conclusions

A comparison review may conclude that a specific level failed, a factual claim is false, a quantified share of the gap resides in a given component, specific explanations survived or were falsified, and a general shape recurs in N of M archived records. It may never conclude that a proposed change will improve performance or that a causal mechanism is proved until a fresh comparison confirms it.

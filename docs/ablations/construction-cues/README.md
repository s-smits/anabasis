# Construction ablations

Status: in source, unrun. Three construction cues are commented out in this tree, each under its own
`ABLATED(<arm>)` marker and in its own commit, the way #89 switched off the early-accept cues. The
control is the tree before those three commits. No run is launched from here.

The question is which construction cues create valid demand and which add cost or narrow a Builder's task
design. No arm is expected to make tasks harder, and a null result is an answer.

The arms come from closed drafts #115 and #116 and from the ablation work on this stack. Each draft's
study, patches and figures stay on its PR. [`evidence-tiers.md`](evidence-tiers.md) keeps the tiers of
suspected harm and each arm's evidence, mechanism, prediction and falsifier as first written.

| Proposal | Arm here |
|---|---|
| #115 arm A (no competing margin), #116 arm A (shared margin off) | `competing-margin`, with #115's assertions that the rest of the intent clause stays |
| #115 arm B (no trial extrapolation) | `trial-forecast`, with #115's assertions on both sentences and the description |
| #116 arm B (examples reminder off) | `examples-reminder` |
| none: #89 ablated it, and its runs have since read it | none: `early-accept` stays in source (below) |

## How an arm is written and run

An arm switches a component off and keeps it in source (AGENTS.md "Ablated components"). Each removed
line stays as a comment under `// ABLATED(<arm>): <why>`, holding its exact original text, and each line
that replaces it carries `ADDED(<arm>)`. The owning test's flipped assertions sit under the same marker.
To restore an arm, revert its commit, or work through `rg "ABLATED\(<arm>\)|ADDED\(<arm>\)"`: remove the
`ABLATED` prefixes, delete the `ADDED` lines and flip the tests back.

To run one arm alone, check out this tree and revert the other two arm commits. Every arm changes text
a Builder reads, so each is a new condition and moves the prompt digest.

## The first batch

| Arm | Owner | What it comments out | Other places that say it | Start |
|---|---|---|---|---|
| `competing-margin` | `src/author/builder-start-prompt.ts`: the last `INTENT_CLAUSE` line | "make several of the request's requirements act together on a single answer, so that meeting one spends the margin another needs" | the same qualifier in `starter-pack/examples.md` and the reviewer's `requirements-one-at-a-time` finding; "act together" in the round prompt's raise line and the no-limit readout | fresh |
| `trial-forecast` | `src/builder/harness-trial.ts`: `trialNextAction` and the tool description | "so a battery of tasks like it scores near its size" and "near zero"; "A task your solver passes on its first attempt will most likely pass in the battery too" | none | seeded |
| `examples-reminder` | `src/builder/harness-trial.ts`: `roundClause` at the first graded rehearsal | the once-per-session pointer to `starter-pack/examples.md`; the file, STARTER.md's link and the session bookkeeping stay | none | seeded |

**Start.** Two arms fire in any round, one at every rehearsal and one at each session's first graded
rehearsal, so they run from one recorded product. `competing-margin` is about a product's first
tasks, and a seeded product already has them, so its observable never occurs there. It runs from fresh
starts on one frozen one-line request, beside an unablated control that also starts fresh.

### Predictions, falsifiers and readers

Proposals until `.claude/skills/run-improvement-campaign/scripts/prediction.ts freeze` binds them to each
arm's tree and the control.

| Arm | Prediction | Falsifier | Reader |
|---|---|---|---|
| `competing-margin` | The median count of independently supported request obligations per first battery does not fall, and no more validity gaps appear | Fewer supported obligations, or a first task's requirements interact less without the sentence | A blinded classification of each first battery (the readers gap below) |
| `trial-forecast` | Rounds rehearse again after a pass no less often; limits are not looser; the pass-whole rate is unchanged | Any change in rehearsal behaviour, or easier tasks adopted | Rehearsal rows and the battery's limits: existing readers |
| `examples-reminder` | No loss of supported obligations or valid-demand fails; construction cost or example-derived task overlap falls | Loses supported obligations, or gains neither diversity nor cost | Reads of the file are mechanism evidence only; overlap needs the classification |

Every arm reports validity, supported behavioural coverage, valid-demand fails, solve effort,
construction cost and completed batteries, separately and never as one score. Instrument defects,
publication gaps, wall stops and unresolved cases are counted beside the fails, not inside them.

## Review

Checked on this tree; nothing is run live.

- **`early-accept`: read, and kept in source, so it is not an arm here.** #89 removed the four cues, and
  its runs read them before this batch was frozen. Every read went the way the cues were added to
  prevent:
  - Fork A (b0a960) had only this removal. It took 101 minutes from its first clear check to its first
    submit, and 269 to an accepted one; a2d0f7's median for the same gap is 50.
  - Truss 4ec6db had both #89 changes. Its two rounds ran 3 h 33 min and 3 h 00 min with no submit before
    their first.
  - The fresh project 846dfe had both #89 changes. After 11 h 39 min it had 11 clear previews and five
    passing rehearsals, and no submit.

  Host load of 66 to 200 on 12 cores confounds the wall-clock gaps, so the size of the effect is
  unmeasured. Its direction held in all three runs, and it is the failure the cues were added for.
- **`competing-margin`: agree, from fresh starts only.** The rendered Builder prompt differs from the
  control by exactly the one line (`show-prompt-surfaces.mts`; the Built surface is byte-identical). It
  switches off one of five model-visible carriers of the idea, so a null means that sentence alone did
  not move construction. If it is null, the next arm is the same change on the three margin-qualifier
  surfaces, in a later batch.
- **`trial-forecast`: agree.** Its three carriers are the only ones in source and the arm switches off all
  three. The doc comment above `notePassEffort` still describes the forecast and carries an `ADDED` note
  saying so.
- **`examples-reminder`: agree.** No recorded round postdates the pointer, so the unablated control run is
  the whole comparison, and a null on file reads is likely and uninformative.

### The readers gap

Whether a first task asks for several requirements acting together under one limit has no deterministic
reader. `competing-margin` and `examples-reminder` cannot resolve without a blinded classification of
each arm's first battery, by a lane that does not see the arm, shown on a known positive and a known
negative first. Scout it before any freeze.

## Where the proposals differ, and what this document takes

| Question | #115 | #116 | This stack | Taken |
|---|---|---|---|---|
| Starts | two per arm in each of two unlike domains | three fresh per arm on one non-budget request, order rotated | one recorded seed for all | seeded for two arms, fresh for `competing-margin`; serial, or load recorded |
| Optional advisers | seventh | second, on a frozen battery | held out | held out: needs a host switch beyond `--withhold-instruments` and a frozen battery |
| All-pass raise-and-rehearse steering | not named | third | batch 2 | batch 2, alone |
| Primary outcome | supported coverage | supported obligations per completed battery | pass-whole rate and task demand | supported obligations, pass-whole reported beside it |
| Wall double count in `wallBoundCount` | found | not named | fixed | fixed in #111 |

## Not in the first batch

- All-pass raise-and-rehearse steering (`builder-session.ts` round prompt): the most direct
  forced-construction carrier. Batch 2, alone.
- Carry-none-forward in the no-limit readout, and the small-job sentence in `examples.md`: after a first
  batch has read. The second says a few-minute pass was a small job "whatever the task looks like on
  paper", which over-asserts; it is a wording change to weigh, not an arm.
- Optional advisers on a frozen battery, the simulator pointer, the grounding offer and its review
  emphasis, review cadence and probe sizing: each needs a host switch, the final instrument or a separate
  study, as #115 and #116 describe.

## Discovery and confirmation

Arms read on a discovery start first. A confirmation start from another campaign or request launches only
after every arm's source is fixed, and nothing read from it revises an arm. Arms generate different tasks,
so compare construction outcomes per start and per battery; the same-task comparison reader must not be
forced to pair them.

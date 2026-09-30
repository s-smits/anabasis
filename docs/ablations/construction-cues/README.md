# Independent shared-margin and examples-reminder ablations

Status: prepared, unrun, dependent on the completion of [#111](https://github.com/s-smits/anabasis/pull/111).
This is an experiment kit, not a change to the production defaults. The two patches implement separate
arms. Apply either to the same baseline; never run their composition as one of these arms.

## Baseline and evidence boundary

The inspected overhaul is `318b97cc199918c154b65403b889b4aa9e7267ed`, above main
`ad6d02a1724bc04deaffd09c356d3d692efae289`. Its PR is still open and explicitly promises further
firmware instrument work. This SHA is a preparation snapshot, **not a final post-overhaul baseline**.
After #111 finishes, inspect its final diff, refresh these patches, rerun their checks and freeze the
final baseline and each arm's own clean commit before spending. A changed pointer, tool or prompt
opens a new condition; it cannot silently inherit this study's freeze.

Read for this proposal: the five-commit overhaul and its owning tests; AGENTS.md's design priors,
climb and removal history; PRs [#89](https://github.com/s-smits/anabasis/pull/89),
[#90](https://github.com/s-smits/anabasis/pull/90), [#91](https://github.com/s-smits/anabasis/pull/91),
[#92](https://github.com/s-smits/anabasis/pull/92), [#107](https://github.com/s-smits/anabasis/pull/107)
and [#108](https://github.com/s-smits/anabasis/pull/108); the supplied 23:40 CEST overhaul plan; and
the available historical firmware/truss run archive and prediction ledgers. That supplied plan
predates the current head in places. No new post-overhaul live evidence is available here.

`git log --all --oneline -i --extended-regexp --grep='ablat|witness-budget'` locates the original
`2c1fb1a087892796f2bbe8d23c55599a2950495f` and
`36c0bad1f7a64e8d5e7a2d522428b51dc12acf30` interventions. Borrow their markers and independently
restorable changes, not their conclusions:

- #91 and #92 had separately isolated **trees**, despite stacked Git ancestry. A later commit is
  not automatically the previous arm plus one treatment.
- The old early-accept cues are present again. The supplied early-accept ledger freezes a timing
  prediction, but supplies no adjudication of it. A longer round would not establish harder valid
  tasks anyway.
- The witness-only firmware arm's recorded source was `340021eb`, with the same kickoff hash and
  Builder/Built/review pins as the early-accept arm (`f4620732`): Claude Opus 5.5, medium, on Darwin
  arm64, Bun 1.4.2. The witness ledger reports a 358.5-minute first round but no long per-task
  reference search; the wall-worded constraint did not bind in this conformance domain. This is a
  domain-specific mechanism result, not a paired difficulty improvement.
- #107's longer truss witness search left 5/6 tasks passing. Three 45-minute searches improved limits
  by 0.2–2.3%; three 3.4-hour searches by 12–59%. One failed on strength/member-loss under a lighter
  limit. This refutes the frozen prediction, not all tightening methods.
- #108 corrects the graduation story: 10/11 unchanged former limits already passed and 11/13 scoring
  programs changed. It also corrects the claim that firmware lacked multiple requirements. The effect
  of **naming** a shared-margin method remains unmeasured.

The historical truss coupling result is a lead. The supplied plan's retrospective firmware coupling
reading is explicitly void for difficulty because its failures included evaluator, publication and
wall outcomes. Neither result identifies a causal effect of today's prompt.

## What to borrow from AutoBenchmark

The inspected [RAM tree](https://github.com/facebookresearch/RAM/tree/c94150b280ee0e4689fb61e96ec1018a097bb4a8/projects/autobench)
contains the [research description](https://github.com/facebookresearch/RAM/blob/c94150b280ee0e4689fb61e96ec1018a097bb4a8/projects/autobench/README.md),
figures and result PDFs; it does not expose an executable AutoBenchmark pipeline in that directory.
Treat this as a research recipe rather than a drop-in repository replacement.

Useful transfers are multiple plausible ways to operationalize a construct, retained primary-source
grounding, separate benchmark-quality review, solver trajectories as discovery evidence, and external
solvers whose results never enter revision feedback. Its human-guidance findings argue for testing
which instructions help, not for assuming every prescription is harmful.

Anabasis already has authored runnable products, immutable snapshots, feasibility witnesses, blind
rehearsals, host grading and review. Preserve those owners. AutoBenchmark's lowest-scoring accepted
checkpoint is not a substitute for a witnessed Anabasis boundary, and its model answer judge is not
a substitute for the host verifier. Adopt the measurement discipline first. A new parent-selection
policy, Harbor migration, model scoring or experiment framework is outside this PR.

## Three confidence tiers for suspected harm

These are subjective judgments about the **stated harm mechanism under its stated conditions**.
They are not calibrated probabilities, measured effect sizes or confidence intervals. Confidence
that removing a component improves the complete system is lower and remains unmeasured. No current
removable prompt component earns 95%+ confidence of a net improvement from removal.

| Tier | Suspected negative impact | Evidence and present status | Consequence |
| --- | --- | --- | --- |
| 95%+ | Counting unsupported target behaviour, unpublished obligations or instrument defects as genuine demand | Historical firmware evidence and the supplied plan distinguish these failures. `epoch-review-prompt.ts` owns obligation tracing; `climb-history.ts` owns admitted rows. A working MCU core alone does not validate a peripheral double. | Audit and classify; retain correctness and settlement controls. This is not an ablation that disables them. |
| 95%+ | Reading a resource stop as proof of task difficulty | #111 fixes the missing operator wall note using `SOLVE_WALL_MESSAGE`; truth and denominators stay unchanged. Short walls can still manufacture apparent difficulty. | Keep the fix and report walls separately. Match walls across construction arms. |
| 95%+ | Giving the solver private expected answers or contaminating fresh confirmation with revision feedback | `NO_GRADER_IN_REACH`, public projections and isolation own the boundary. #111 extends the prompt to expected-result tools. Held-out contamination is an experimental risk, not an observed new leak. | Keep protection; prohibit held-out feedback. Public field computation is not leakage. |
| About 80% | Applying one shared-margin design method where the field's demand is sequential behaviour, diagnosis or other non-budget work | `INTENT_CLAUSE` prescribes requirements spending one another's margin. Its cross-domain effect has not been measured; the old firmware lead was invalid for difficulty. | Test narrow shared-margin removal first. Confidence concerns restriction of design choices, not a proved pass-rate gain. |
| About 80% | Mandatory extra construction after an unrepresentative passing rehearsal consumes scarce build time | `builder-session.ts` asks for one raise and another rehearsal when all rehearsals passed. A pass proves only its task, and historical review of #89 did not establish a rehearsal-filter problem. | Prioritize a later isolated test of this steering sentence; keep blind rehearsal and validation. Net cost/quality tradeoff is unknown. |
| About 60% | Rehearsal feedback adapts tasks to the discovery solver rather than transferable work | `harness-trial.ts`, `context-tool.ts` and `authoring-review.ts` feed verdicts and passing traces into revision. AutoBenchmark motivates external confirmation, not removal of this feedback. | Test optional feedback availability later; measure transfer as well as cost. |
| About 60% | The examples reminder anchors task designs or adds attention cost without improving executable demand | #111 emits a file pointer once per session. The historical 52/310 recorded reads have unmatched eligibility and incomplete Bash-read visibility. | Second first-batch arm: suppress reminder, keep examples and STARTER link. |
| About 60% | Grounding retention/review becomes citation compliance or steers toward narrow sources | `contract.md` offers private excerpts; `epoch-review-prompt.ts` reads them. Hash identity proves no authority or executable obligation. No current live effect is available. | Separate instruction uptake from excerpt-review value; retain public obligations and isolation. |
| About 60% | Missing simulator guidance prevents use; excessive guidance narrows the Builder to one instrument | #111's promised instrument and pointer are not in the inspected snapshot. | Wait for final installed bytes and supported-coverage evidence, then ablate the pointer alone. |
| About 60% | Optional advisers remove the intended work, review cadence delays construction, or probe sizing misses task regimes | Adviser/tool identities, `analyse-step.ts`'s distinct review roles and `battery-sizing.ts` own these routes. The old graduation claim is confounded. | Measure advisers on a fixed battery; consider cadence/sizing separately. Do not assume reviews are duplicates or small batteries invalid. |

## Ranking by information and implementation cost

Cost describes the intervention, not a provider quote. Runtime spend must be budgeted separately.

| Rank | Candidate | Information gained | Cost | Selection |
| --- | --- | --- | --- | --- |
| 1 | Shared-margin definition off (A) | Tests an unmeasured cross-domain prescription without weakening demand or correctness | Low: one prompt clause and its owning expectation | First batch |
| 2 | Optional adviser off on a frozen battery | Direct attribution of solving work to one tool with identical tasks and grader | Medium: supported runtime roster intervention, dependency audit and fresh solver attempts | Separate study after an audited battery exists |
| 3 | Rehearsal all-pass steering off | Tests whether the mandatory extra raise buys valid demand or mainly cost | Low/medium: round sentence and owning expectation | Next after A; do not combine with A |
| 4 | Examples reminder off (B) | Clean estimate of reminder value beyond file uptake; tests a fresh #111 addition | Low: one emission branch and its owning tests | First batch; low cost despite lower prior confidence |
| 5 | Simulator pointer off | Separates discoverability from installation and capability | Low once the final pointer has one owner | Deferred until #111 actually includes it |
| 6 | Grounding instruction / excerpt-review arms | Separates executable grounding from retention and review | Medium: two separately frozen interventions and independent source audit | Deferred |
| 7 | Optional rehearsal feedback unavailable | Estimates adaptation, transfer and construction spend together | Medium: tool registration plus model-visible instructions and trace routes | Deferred |
| 8 | Optional diagnosis cadence | Estimates marginal actionable findings versus delay after the epoch review | Medium: preserve issue publication and settlement, remove only the later optional reader | Deferred |
| 9 | Probe sizing policy | Measures coverage/cost tradeoff of small batteries and graduation | Higher: kernel policy changes and sample-size interpretation | Defer; Wilson and zones remain intact |

## Selected arm A: shared-margin definition off

- **Owner:** `src/author/builder-start-prompt.ts`, final `INTENT_CLAUSE` sentence. Its test is
  `test/builder-start-prompt.test.ts`; the AGENTS entry labels an experiment rather than a new prior.
- **Evidence:** the method is prescribed in source; its wording effect is unmeasured. Old truss
  coupling is a lead, and invalid firmware difficulty evidence cannot confirm it.
- **Mechanism:** fewer constraints on how to make first tasks demanding may permit authentic
  non-budget obligations. Alternatively, the sentence may supply useful direction.
- **Exact change:** replace `Build that demand into the first tasks, not later: make several of the
  request's requirements act together on a single answer, so that meeting one spends the margin
  another needs.` with `Build that demand into the first tasks, not later.` Keep the original beside
  `ABLATED(shared-margin)`.
- **Scope limit:** the round's `act together` advice, the no-limit readout, worked examples and review
  demand-gap vocabulary remain. This tests the **shared-margin definition**, not all coupling advice.
  A null result cannot establish that removing every construction prescription is useless.
- **Proposed prediction:** against the control in a non-budget conformance request, A increases the
  median count of independently supported request obligations per completed battery, without a
  higher rate of demonstrated validity gaps. Different numeric values or new family labels alone
  do not count. Authentic non-budget demand is the proposed mechanism, not lower raw score.
- **Falsifier:** on the completed prespecified screening cohort, supported obligation count is equal
  or lower, or the apparent increase depends on demonstrated unsupported/unpublished obligations.
  Too few completed or resolved batteries is inconclusive. Diversity without supported coverage is
  a mechanism observation, not confirmation.
- **Outcomes:** all shared measures below, plus construction design, obligations gained/lost and
  competing-margin versus sequential/diagnostic work. Test a publicly valid simple alternative and
  an independently established wrong answer per investigated obligation.
- **Restoration:** reverse `shared-margin-off.patch`, or revert the single arm commit after it is
  created. Restoring just the marked sentence restores model text; revert also restores tests/docs.

## Selected arm B: examples reminder off

- **Owner:** `src/builder/harness-trial.ts`, `roundClause`'s first graded result; session state belongs
  to `BuilderConversation`. The file and its existing STARTER.md link stay installed.
- **Evidence:** #111 adds the reminder, with session-continuation tests, but reports no live result.
  Recorded file reading is not task improvement. The historical 52/310 rate is not a matched control.
- **Mechanism:** a reminder may make useful worked constructions discoverable, or anchor designs to
  the pack's shapes without adding executable demand.
- **Exact change:** keep `tellOnce("examples")` at the same first-graded point but return no pointer.
  Keep the control's `EXAMPLES_POINTER` text for restoration. Subsequent rehearsal totals, verdicts,
  effort and passing traces are unchanged; `not-run` still consumes no session state.
- **Proposed prediction:** removing the reminder does not reduce median supported obligation count
  or median valid-demand failure count per completed battery, and reduces repeated example-derived
  construction patterns or construction cost. This is a screening prediction, not an equivalence
  claim. A small sample with equal outcomes cannot prove the reminder has no effect.
- **Falsifier:** B loses supported obligations or valid-demand failures relative to control, or gains
  neither construction diversity nor cost saving. Missing trigger opportunities or unresolved
  validity makes the applicable comparison inconclusive.
- **Outcomes:** the shared measures, plus recorded access before/after the first graded rehearsal,
  first draft / rehearsed candidate / adopted battery identities, substantive later edits and
  example-derived design overlap. Report both all-start outcomes and trigger-eligible diagnostics;
  do not condition the primary analysis on reading the file. Bash access can be unobservable.
- **Restoration:** reverse `examples-reminder-off.patch` or revert its arm commit. The exact original
  return is held beside `ABLATED(examples-reminder)`; restore its tests together.

## Later arms: exact boundaries before implementation

These are proposals, not enabled features, frozen predictions or completed runs.

| Candidate and owner | Exact future intervention and mechanism | Prediction / falsifier | Measures and restoration |
| --- | --- | --- | --- |
| All-pass steering: `builder-session.ts` round prompt | Remove only the conditional instruction to raise and rehearse again after all rehearsals pass; keep tool, demand goal, early submission cues and gates. Avoids a prescribed extra search. | Lower construction effort with no loss of supported demand; refuted by demand loss or no cost saving. | Shared outcomes, extra edits/rehearsals and time from clear preview to submit; reverse one isolated commit. |
| Simulator discoverability: final #111 installation/guide owner, currently absent | Remove only the explicit pointer after its exact location is known. Same installed binary, libraries, fixtures, configuration and public obligations. | Pointer increases actual use and independently supported behavioural coverage; refuted by equal/lower coverage or only unsupported claims. | Instrument executions and supported obligation coverage, validity and cost; reverse pointer commit. Never uninstall the tool. |
| Grounding: starter contract and epoch review prompt | First arm removes only the optional excerpt-retention paragraph; citations and public rules stay. A separate arm suppresses only the review instruction about retained excerpts, keeping the files accessible and all correctness review. Do not combine them initially. | Retention/review improves source-to-rule-to-execution fidelity; refuted by no fidelity gain or more wrong obligations. | Independent revision/scope audit, executable obligations, false acceptance/rejection, review cost; reverse each instruction commit. A curated source packet is a third, distinct input condition. |
| Optional rehearsal: `builder-campaign.ts` tool binding, `harness-trial.ts`, `context-tool.ts`, round prompt | A later availability arm omits `harness_trial` from the Builder roster and removes instructions requesting it; no rehearsal traces are fed to authoring. Keep readiness, correctness_check, submit, controls and F2. Audit every feedback route before implementation. | Less discovery-solver adaptation/cost without worse valid demand; refuted by lower validity, supported coverage or fresh transfer. | Shared measures and discovery-to-confirmation change; reverse the availability commit. This changes availability and spend, not just one feedback sentence. |
| Advisers: `tools-spec.ts`, Built registration in `built-starter.ts` and generated worker registry | On an already frozen audited battery, hide one optional `kind: advisor` tool from both runtime registration and provider schema. Keep its bytes, tasks, grader, installed tools, readers, writers and submit. Confirm no surviving tool can forward to it. Do not rewrite the authored battery or use the existing `advisorsRemoved` field as though it were a general switch: currently it names withheld check instruments. | Adviser presence lowers solve effort or increases valid completion; refuted by equal/worse effort and success. A full-task public adviser can reveal weak demand without being a private leak. | Paired case outcomes and solver minutes/tool calls/cost, changed interface hash, explicit removed name; reverse isolated runtime change. Separate report; no construction conclusions. |
| Diagnosis cadence: `analyse-step.ts`, `diagnosis-reader.ts` | Omit only the optional diagnosis reader after epoch review. Keep Judge census, admitted findings, issue publication, epoch review and settlement. They have different jobs, not duplicate calls. | Less delay/spend per equally informative next construction; refuted by lost actionable diagnoses or weaker validity/demand. | Marginal cited findings, repair usefulness, completed batteries and review spend; reverse isolated cadence commit. |
| Probe sizing: `battery-sizing.ts` | Later compare ordinary policy with one prespecified fixed requested size; change no Wilson function, zone or placement threshold. | Probe savings outweigh loss of behavioural regimes; refuted by supported-coverage losses not recovered at graduation. | Per-start cost, regimes exercised, completed batteries, exact sample sizes and intervals; reverse sizing commit. Changed task counts prevent naive pooled score comparisons. |

## Freeze, discovery and fresh confirmation

Use the existing run-condition, prediction and attribution procedures; add no experiment framework.

1. After the final overhaul, freeze a clean baseline B0 and create A and B from **that exact commit**.
   Apply one patch per arm, commit it independently and run the source gates on a supported host.
   Match the one-line request, initial notes/context, source packet, seed product if any, installed
   tools, network/isolation policy, Builder/Built/review model and effort pins, provider budgets,
   task-count policy, turn/solve/check walls, review cadence and controller measurement rules.
   Treat shorter prompts as part of the intervention. Do not pad them with a new instruction.
2. The proposed first screen is three fresh starts per arm on one frozen non-budget conformance
   request: nine starts total, each with the same two-iteration cap and per-start spending cap,
   subject to explicit run authorization. Freeze the literal request and dollar/wall caps before
   launch; they are not silently chosen by this document. Rotate launch order B0/A/B, A/B/B0,
   B/B0/A to reduce load/order bias. Record load and queue/tool time. Fresh sessions have identical
   initial context, not inherited discoveries from another arm. This is a screen, not causal proof
   or a claim about all domains. A non-budget field and a budget field belong in fresh confirmation.
3. Register predictions through the existing prediction ledger against the final arm SHAs before
   spend. The predictions above remain proposals until that freeze. Count every launch, including
   construction/adoption failure, incomplete battery and unreached trigger. Do not extend a fixed
   outcome window until it produces the preferred result.
4. Discovery solver and ordinary permitted review feedback may guide discovery revisions. Freeze
   each resulting task/product version before fresh confirmation. Use a second solver that never
   participates in construction, and keep all its trajectories, scores and critiques out of Builder
   context, notes, review feedback, parent selection and subsequent revisions. Report its results
   for every prespecified eligible frozen battery, not just the best-looking one. Any later revision
   after looking at confirmation starts a new discovery study with new holdouts.
5. Before using a promoted condition, confirm it in new starts with frozen instructions, a fresh
   sample and the prespecified second domain. A and B generate different tasks and may generate
   different graders/tools: match **starting** resources, and record resulting identities rather than
   asserting they are identical. Compare construction outcomes at the start/battery level. The
   repository's same-task comparison reader must not be forced to pair these generated batteries.
   It is suitable for the separate adviser experiment with a genuinely fixed taskset/grader.

## Record identities and outcomes

Retain existing controller-owned opening, terminal, case, version, tool and review records. Reference
their paths and hashes in the study report; do not edit campaign evidence or add a host manifest.

| Identity group | Required record |
| --- | --- |
| Source | Final baseline SHA, each clean arm SHA/source digest, patch digest, runtime version/binary/platform and dependency identity |
| Context and prompts | Literal request and hash, seed/version, initial notes and source packet digests, Builder system/round framing, starter/example bytes, tool descriptions/schema, Built procedure/guide and review prompt identities |
| Models/resources | Resolved Builder/Built/review model, backend and effort per slot; isolation/network; budgets, walls, task-count policy, launch order and contention |
| Authored products/scoring | First draft, each rehearsal candidate, adopted version; taskset and scoring hashes, public rules/projection, schema, controls/F2 receipts and review/settlement condition |
| Tools and grounding | Installed executable digest/version and declared inputs; tool interface/registry identities; retained source origin/revision/scope and snapshot hash |
| Confirmation | Frozen eligibility list and versions, held-out solver identity, separate output location and proof it was never used in revision feedback |

| Outcome | Measurement rule |
| --- | --- |
| Validity | Demonstrated gap / no gap found in named executed checks / unassessed. Audit public obligations, feasibility and discrimination with valid alternatives and independently wrong artifacts. Controls or a hash alone do not certify it. |
| Supported behavioural coverage | Request obligation → public rule → task regime → executed operation → observation → deciding check. Count independently supported obligations, not family names or launched binaries. Compilation, simulation, target-image and physical execution stay distinct. |
| Valid-demand failure | Explain the recorded artifact's violated public obligation using an adequate observation path. Instrument defects, publication gaps, unsupported regimes, resource stops and unresolved attribution do not confirm this outcome. Keep raw truth unchanged. |
| Solve effort | Minutes, tool calls, cost, success and wall receipts per family/case; median and maximum plus censored attempts. Separate compile/simulator/queue time where available. |
| Construction cost | Builder time/cost, optional rehearsal cost, checks/F2 cost and review cost separately; total per start and per completed valid battery. Failure to construct is not free. |
| Completed batteries/climb | Started/adopted/scored/resolved batteries per launched start; passes, valid-demand failures and unresolved/other outcomes separately, and the existing raw denominators, Wilson intervals and zones. Report a witnessed valid pass/fail boundary when present. |

Do not collapse these into one optimized score. Lower raw scores demonstrate progress only when the
additional failures reflect valid demand. Preserve raw rows and existing admission/settlement
semantics; show diagnostic exclusions alongside them. A case can have several caveats: report
overlaps or an explicit counting convention rather than adding overlapping totals. Publish an
all-start table, a per-battery validity/coverage table and a per-family effort table. Report historical
discovery separately from fresh confirmation. Zero confirmed failures with unresolved cases is
insufficient evidence, not proof of ease.

## Changes to the supplied overhaul plan

| Existing plan direction | Proposed improvement |
| --- | --- |
| Freeze predictions on a growing #111 head | Keep preparation provisional; freeze after the final instrument/guide commits and final gate. Reassess simulator discoverability then. |
| Historical examples-read baseline and composed uptake prediction | Use B0 versus B, matched trigger opportunities and all-start task outcomes. File reads are mechanism evidence, not improvement. |
| Firmware coupling census | Keep its invalid-for-difficulty qualification. A isolates prompt wording; independent target observation establishes new validity. |
| Grounding workflow and curated-packet arms | Preserve their separation; add a distinct excerpt-review arm if the question is review value. Do not label a packet effect as a prompt effect. |
| E2b settlement replay with plants | Retain it. An accept-control mutation alone does not establish that a recorded failed artifact was valid. Complete one natural path and an independently established hard plant before scaling. |
| Held-out transfer only after a bracket | Predeclare eligible frozen batteries and keep held-out outputs out of all revision channels. Separate transfer from selection; absence of a bracket is itself an outcome. |

No change here removes correctness checks, public obligations, private grading protection, F2,
Wilson calculations or zones. No merge or paid run is authorized by this kit.

## Applying and restoring the prepared changes

`shared-margin-off.patch` and `examples-reminder-off.patch` are full source/test/documentation diffs
against the preparation baseline. Inspect them as code. They are intentionally not applied to this
PR's shipping source. From a separate clean arm checkout of the frozen baseline:

```sh
git apply --check /absolute/path/to/shared-margin-off.patch
git apply --index /absolute/path/to/shared-margin-off.patch
git commit -m 'Ablate only the shared-margin definition'
```

Use the examples patch **instead** for B. After refreshing for the final baseline, validate each arm
independently through the normal repository gate. A patch refusal requires inspection and a new
freeze; do not force it. Revert that arm's commit to restore every byte, or before committing use
`git apply --reverse --index` with the same patch. Avoid cumulative cherry-picks and feature flags.

Validation and patch identities are recorded in `validation.md`. All behavioral effects are unrun.

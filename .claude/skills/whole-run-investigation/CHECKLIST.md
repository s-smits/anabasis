# Whole-run investigation checklist

Answer three questions: did the run build the requested product, does its measurement distinguish
correct work from convincing substitutes, and did the loop learn from what happened?

Start from the request and the recorded work. Earlier reports and earlier notes supply leads; they
do not define what can be wrong. A green battery, a complete catalogue or a long investigation is
no substitute for these answers. Preserve useful mechanisms and supported successes alongside
defects.

This file owns the synthesis questions. [SKILL.md](SKILL.md) owns the sequence, the tiers and the
archive, and the [lane catalogue](references/review-angles.md) owns the deterministic rows A to I
and the twenty-six semantic lanes. A row here does not create a lane and does not waive one the
tier authorised. Several rows may share one lane; lanes 7 and 23 stay isolated until their reports
are frozen, so a row that names them is answered by their reports and never by the primary doing
the same work first.

## Establish the chain before dividing the work

Bind the full measured source, the request, the model condition and the accepted candidate. Keep
the review procedure's revision separate. Use source-matched readers, and distinguish absent
source support from missing evidence. Never substitute today's controller semantics for those
that ran. Rows A to I settle identity, arithmetic and joins once, in the primary session; a lane
that repeats a row's calculation has spent its effort on nothing.

Walk the first authoring cycle and the consequential later repair or experiment in time order:

`request → design → authoring → admission → measurement → diagnosis → next action → next result`

If an edge never happened, record why and what it leaves unknown. Inspect a pre-battery candidate
when it can settle a product or authoring defect; zero verified cases removes the capability rate,
not every useful question. For a live run bind T0 and T1 separately and defer unfinished outcomes.

Read complete captured sessions when practical. Otherwise include the decision before the brittle
span and its settlement, record the events read and name omissions. Join prose to native tool
requests and results, revisions, refusals and accepted bytes. Captured prose is neither hidden
reasoning nor a complete tool transcript, and one outer assistant turn can contain many native
actions.

For a consequential mechanism establish:

`producer → exposure → eligible opportunity → output → consumer → decision → next observation`

Locate the first broken link. Distinguish absent, ineligible, undelivered, unused and used without
proved benefit. A tool declaration, a successful read, an invocation or a consumed-packet counter
proves only its own link. A justified decision to retain the current design can be useful work.

## 1. What actually ran, and what can we know?

Settle arithmetic and identity with the verified readers once. Investigate the contradictions and
the meaning of the result. Read-only evidence checks do not authorise another paid run.

| Question | Deciding evidence and test | Where it lands |
|---|---|---|
| **Condition.** Is this the run and product the claim names? | Join opening, served-model evidence, source and dirty disclosure, immutable candidate, accepted artifacts, gates, batteries, promotion and claim. Keep configured and attested model identity separate. A hash binds bytes; it does not establish meaning, independence or successful adoption. | rows A, B and I; `SERVED MODEL MISMATCH` and `UNATTESTED ROWS` |
| **Closure and censoring.** Where did useful work stop, and what was prevented? | Reconcile the terminal and durable liveness with every attempted and unscheduled case. Separate verified, unaccepted and typed non-results; retain nulls and the capability and difficulty denominators. Distinguish explicit allowance exhaustion from a generic limit, timeout or stall. State which conclusions concern completed work and which require the missing opportunity. | row G; `walls` lane; lane 24 on `DECISION ON CENSORED BATTERY` or `EXPLICIT ALLOWANCE WAIT`; lane 25 for the terminal |
| **Observability.** Could the instruments see the property being reported? | Compare the canonical epoch, battery, version, execution and trace sets with the rows each reader actually returns. Check pagination, omissions, dependencies, units and counter lifetimes. Trace a suspicious zero or aggregate to its capture boundary. An empty evolution join despite recorded versions is an instrument question before it is evidence of no evolution. A complete file inventory does not prove complete dependency coverage. | row H; lane 26 when the prose capture is the gap; lane 25 when a failure hides in it |

## 2. Did the Builder understand and realise the request?

| Question | Deciding evidence and test | Where it lands |
|---|---|---|
| **Request fidelity.** Which material obligations survived the opening? | Read the verbatim request and authorised context, the served starter and its examples, and the first design; then trace each consequential obligation into the final artifact, an enforcing check or an explicit omission. Examine whether important example constraints transferred into the design. Shared agreement on a mistaken premise is still a product gap; reading the example alone proves no transfer. | lane 1 |
| **Domain grounding.** Were consequential unknowns resolved correctly? | Check the public authorities behind domain facts and follow research into representation, task content and deciding tool configuration. Include native search, shell research and installation traces. A citation, an installed compiler or the absence of calls to one named search tool settles none of these semantic questions. | lane 1; lane 7 when a public standard would decide differently |
| **Expressibility.** Can a solver know and express every enforced obligation? | Trace public requirements through schema, writer variants, draft state, submission and accepted verifier input. Check precedence, closed value sets, units and runtime facts. Exercise the real public submission path. Distinguish a rule that cannot be represented, one that was withheld, and a represented root that cannot affect correctness. | lane 3 for the host contract; lane 4 for what the guide and the roster told the solver |
| **Task value.** Does the evaluation represent useful work in the requested domain? | Relate families, examples, omissions and success criteria to practitioner tasks. Look for distinct-looking tasks solved by one constant artifact, irrelevant required work, or a product narrowed to an easy proxy. Counts, file size and lexical diversity do not establish coverage or reasoning demand. | lane 1; lane 8 for a constant artifact; `AGGREGATE HIDES FAMILY` and `UNOBSERVED FAMILIES` |

## 3. Does the correctness measurement test the actual product?

Keep these questions separate: a valid interface can compose badly, an authentic executable can
check the wrong property, and a discriminating verifier can enforce the wrong public contract.

| Question | Deciding evidence and test | Where it lands |
|---|---|---|
| **Authoring-to-host compatibility.** Can a legitimate authored check execute through the real host contract? | Follow actual payloads across projection, external-tool input binding, worker transport, wall and result handling. Run the nearest legitimate and forbidden boundary cases when needed. A local stub accepting an operand cannot prove the real host accepts it. Distinguish a broken authoring representation from a justified refusal; preserve the boundary and identify a public-safe explanation. | lane 3 |
| **Executable dependency closure.** What actually decided the verdict? | Resolve the complete deciding chain: wrapper, selected lexical command, imported code, headers, flags, linked libraries, configuration, environment and runtime assets. Bind it to host-attested operations and accepted inputs. Inspect candidate-controlled transformations and substitutes. Hashing the top-level executable or listing files does not establish independence of the dependencies it uses. | row H; lane 2 on `WRAPPER-ONLY TOOL DIGEST`, `VERSION TOOLCHAIN IS A SYMLINK` or `VERSION TOOLCHAIN DANGLING` |
| **Product execution.** Did the measured operation exercise the delivered artifact? | Trace one accepted artifact from its material bytes through preprocessing, compilation, linking and execution to the deciding observation. Test whether a host-only path, mock or alternate implementation can pass while the delivered program is wrong. Keep compilation, host simulation, target execution and hardware operation as separate supported scopes. | lane 1 |
| **Product coupling.** Are the relations between subsystems enforced? | Name the required relation between artifact roots or behaviours, then vary one side while retaining the other. Reading both roots, checking each in isolation or generating them from one premise does not prove their agreement. Join firmware and simulator behaviour, for example, only at the actual shared obligation. | lane 1 |
| **Limit slack.** Do the checks bite where the request is hard, or only where it is easy? | Read which declared checks failed at least once in shipping and which only ever passed, and how far every shipping value sits from the boundary the check holds. A limit anchored to the Builder's own accept or reference is a limit the reference already clears; a battery every task passes has measured no limit. Name the public requirement the untripped check was meant to enforce and ask whether any task in the battery demanded it. | lane 5 on `UNTRIPPED IN SHIPPING` or `PERFECT BATTERY OVER AIM` |
| **Check binding.** Can each check bind to the geometry it claims to judge? | Compare where the rejects reach with where shipping reaches. A check that fails only on an id or label it cannot bind to the artifact's geometry, or that every accepted artifact clears, is reach without discrimination. | lane 6 on `UNTRIPPED IN SHIPPING` or `REACH-ONLY CHECKS` |
| **Wrong-artifact acceptance.** Can plausible incorrect work pass? | Execute a bounded, semantically chosen wrong-artifact corpus through the recorded verifier and required wall under fixed identities. Preserve valid submission structure. Include the relevant omitted work, ignored input, hard-coded example or substituted branch. Track which checks discriminate, merely execute or remain unreached. A non-result, an invalid submission or an assertion that a mutation should fail is not a demonstrated bypass. | row E for the recorded controls; lane 6 for what the controls left untested |
| **Valid-alternative rejection.** Can genuinely correct work fail? | Independently derive valid alternatives from the public contract, then execute them through the same path. Probe legitimate implementation diversity, boundary values and equivalent representations where relevant. Separate parser or writer rejection from a completed false verdict. Lexical difference alone does not prove validity, and a wrong-artifact corpus cannot establish freedom from false rejection. | lane 7, isolated |
| **Independent user outcome.** Would the accepted result work for the user? | Freeze an independent public-standard derivation or executable reference result before reading verifier source, controls, recorded verdicts or other lanes' reports. Prove that any adapter preserves the relevant inputs and that the reference can observe the property. Keep disagreements and unobservable properties explicit. A sibling harness's agreement is diagnostic; two implementations may share the same blind spot. | lane 7, isolated |

Lane 1 owns the end-to-end request, execution and coupling join, lanes 2 and 3 own the two halves
of what executed it, and lane 7 owns both public-alternative questions. Reuse their reports; do not
collapse the isolated challenge into the lane 1 synthesis, and do not answer a lane 7 question from
the primary session before its report is frozen.

## 4. What capability or limit did the solver demonstrate?

| Question | Deciding evidence and test | Where it lands |
|---|---|---|
| **Public problem and solution freedom.** Was the solver given the problem without being handed a sufficient solution method? | Inspect everything the agent can read: brief, guide, tool descriptions, returns and files. Preserve the public validity relation, necessary constants and constraints. Distinguish ordinary public tools from an allocation recipe, a hidden tie-break, an answer preview or protected evaluation. Tool availability and constant turns alone establish neither leakage nor cheating. | lane 8; lane 4 for a payload that hands over a decision; lane 23 on `CHECK TOOL IN SOLVER TRACE` |
| **Solver process.** What work did the solver actually do? | Join native actions, errors, revisions, artifacts and durations by family and condition. Explain consequential uniformity, repeated obstacles or avoided work. Distinguish a capable short solution from a shortcut and a long struggle from an environment failure. | lane 22; `walls` lane for the wall classes; lane 23, isolated, when the trace itself is in dispute |
| **Rehearsal reach.** Could the rehearsal instrument grade this battery at all? | Read the rehearsal ledger's not-run rows against the families. The rehearsal verifier deadline is shorter than the check wall, so a not-run may be the deadline rather than the harness, and a family the instrument cannot grade is a family the Builder calibrated blind. | lane 9 on `REHEARSAL NOT-RUN` |
| **Calibration.** Did the Builder measure its battery before paying for it, and did the measurement agree with what it declared? | Read the rehearsal ledger beside the submitted bytes and the `EXPERIMENT.json` target. A `harness_trial` that never ran on the bytes submitted, or a verdict that contradicts the declared target, is a battery whose count was guessed; and round over round, the prediction, the `FRAME` counts and the measured count say whether the loop is calibrating or drifting. | lane 11 on `SUBMITTED BYTES NEVER REHEARSED` or `REHEARSAL CONTRADICTS TARGET`; lane 10 on `OFF-AIM STREAK` or `TARGET MISSED` |
| **Measured limit.** Which families or axes were tested near a meaningful boundary? | Read the difficulty-decision record: the placement `zone` and `toAim`, the target's comparator, `verifiedPasses` and `result`, and the allowance. Read family-wise verified outcomes, held and moved tasks, check sensitivity and available margin. Separate task hardness from poor tools, missing public facts, false rejection and resource censoring. A perfect battery or a reached check establishes no limit. | row G; `climb` lane; lane 10 for the loop; lane 5 on `PERFECT BATTERY OVER AIM` |
| **Stability and transfer.** Does the result survive a fresh opportunity? | Bind repeated conditions, fresh tasks and paired changes to their exact artifact, task, model and verifier identities. Separate repeat stability, fresh-task transfer and response to a changed axis. Report sample limits and absent comparisons; a higher aggregate under a different evaluator does not establish improved solving. | lane 20 on `REPEATED CONDITION`; lane 18 for the same task across batteries; `FAMILY UNMOVED` |

## 5. Did feedback become a real, retained repair?

Treat confidentiality, useful public feedback, delivery and semantic repair as different tests.
One can succeed while another fails. Apply the measured source's actual owner and experiment
authority; a historical move name is not evidence of today's routing semantics.

| Question | Deciding evidence and test | Where it lands |
|---|---|---|
| **Feedback confidentiality.** Can protected detail influence model-visible text? | Follow private verifier and reviewer material through every projection, prompt and tool return. At the owning boundary, changing only protected detail must leave public prompt identity unchanged. Keep investigator counterexamples and reference artifacts private. No repair benefit justifies evaluator coaching. | row C; lane 21 on `MODEL-VISIBLE SURFACE CHANGED` |
| **Public-safe feedback sufficiency.** Did the permitted message retain the meaning needed to act? | Compare the authorised public facts with the actual served projection: obligation, owner, priority, the blocking or advisory distinction and uncertainty where the contract permits them. Test a lost public distinction separately from necessary withholding. A leak-free message can still be too vague or misleading, and adding protected failure locations is not the remedy. | lane 13 |
| **Routing and opportunity.** Did the right owner receive actionable feedback at the right time? | Join finding, admission, selected owner, delivered packet and next authoring opening. Separate fresh, cached, stale, superseded and undelivered advice. Check the actual native action boundary at which a warning could intervene. A produced finding or a selected owner alone proves no delivery or chance to respond. | lane 14 on `FINDINGS WITHOUT PROPOSED OWNER` or `ADVISORY FINDING RECURS UNROUTED`; lane 17 for the per-channel census; lane 15 for the triage hand-off |
| **Judge disagreement.** When the Judge failed a verifier pass, which of them was wrong? | Read the cited rule against the artifact and the check. A Judge error and a verifier defect are settled by different owners, and a miscount that reached the advice packet is noise the next round paid for. | lane 16 on `CENSUS WITH DISAGREEMENT` |
| **Standing duties.** Was the mechanism found before, and did the remedy already in place run? | Before proposing a remedy, read the earlier investigation notes for the same mechanism. Where an earlier note's remedy is a standing duty of a component in the measured source, read that component's recorded output for this run and say whether the duty was invoked, whether it found the mechanism, and where the finding went. A duty that never fired is the finding; a second remedy on top of it is a wall that pays no rent. | primary, from `notes/`; lane 12 for the Epoch Reviewer's duties; lane 14 for where the finding went |
| **Semantic repair closure.** Did the successor fix the same defect? | Carry the original public obligation and falsifier through diagnosis, prediction, rejected revisions, final accepted bytes and the next relevant measurement. Detect neighbouring fixes, partial repair, reworded symptoms, deleted controls and scope reductions. Classify repair, honest narrowing, removed challenge and unresolved work separately. A matching check ID or an improved pass rate cannot close this question. | lane 19; lane 18 for the same task's measurement |
| **Memory and recurrence.** Was useful learning authored, retained and used? | Inspect the actual authored memory, carried bytes, opening injection and next eligible decision. Distinguish no lesson written, no delivery, stale or overwritten content, ignored advice and no next-use opportunity. A read receipt or a byte cap proves no benefit. Join recurring findings by the same falsifier across reviews and source changes; disappearance from the next report is not closure. | lane 26 on `MEMORY OVER READ CAP`; lane 14 for the recurrence key |
| **Experiment integrity.** Did the final experiment still test its stated purpose? | Compare the `EXPERIMENT.json` proposal with the candidate transitions, task and control changes, accepted evaluator and measured condition. Respect the frozen boundaries and the authorised experiment scope. Explain the realised reasoning demand and any changed validity relation. Admission after removing the challenge answers a different question; additional scenarios or unchanged task bytes alone prove no meaningful climb. | lane 20; `climb` lane |

## 6. Which mechanisms and changes earned their cost?

| Question | Deciding evidence and test | Where it lands |
|---|---|---|
| **Component value.** What useful information or decision did each consequential component add? | Evaluate the Builder tools, the census and Main Judge, the diagnosis reader, the Epoch Reviewer, the advice packet, the safeguards and the stops against their own contract and eligible opportunities. Join calibration, output, consumer and decision with time, tokens and known cost. Separate waiting, repeated unchanged work and necessary revalidation. A calibrated refusal or a retained boundary can be valuable; agreement without calibration is no independent confirmation. Unknown usage stays unknown. | `yield` lane; lane 24 on `REVIEW TURNS EXCEED SOLVER TURNS`; lanes 12 and 14 for what the reviews changed |
| **Source reach and attribution.** Did the proposed cause reach the result? | Join the source delta and exact ancestry to the live path, eligible trigger, recorded execution and outcome. Separate present in source, deterministically proved, live-exercised and outcome-proved. An unfired sensor can mean no opportunity, an untaken branch or missing capture. Name the strongest competing explanation and the observation that distinguishes it; a later fix cannot explain an earlier run. | `delta` lane; lane 21 on `UNREACHED CHANGED SAFEGUARDS` |

## Turn a consequential doubt into deciding evidence

State the claim, the public obligation and the smallest observable success before selecting a
probe. Choose the cheapest real layer that can decide it. First verify the positive baseline and
the instrument's scope; then change the one property at issue. Keep wrong-artifact and
valid-alternative challenges distinct. Reuse complete identity-bound executions when they already
answer the question.

Use private investigator scratch for authorised probes. Preserve generated bundles, accepted
artifacts and historical scores. A failed baseline or a non-result limits the correctness claim;
it is not permission to bypass the wall or fabricate a verdict. An expected forbidden-input
refusal can prove the boundary without proving product correctness. If the needed instrument or
authority is absent, state the exact missing observation and stop that claim, while continuing the
questions the available evidence can settle.

Challenge the leading explanation with its strongest plausible rival. When a premise fails,
revisit dependent findings, including earlier conclusions in the same investigation. Collapse
repeated symptoms under their earliest demonstrated owner. A handwritten replacement harness
cannot prove the Builder learned; closure needs the real successor and the relevant measurement
opportunity.

## Synthesis and completion

Lead `main_synthesis.md` with the supported product result, the material gaps, the full measured
source with its nine-character prefix, the exact condition and the separate denominators. Index the
questions considered once, using their names above. An exhaustive review covers every question; a
targeted review states its material omissions. Reuse the digest and the lane reports instead of
repeating their work. This prose index does not change `review.json`'s schema or dispositions.

For each material conclusion provide:

- The obligation or claim, the conclusion and the evidence path, with its proof level and scope.
- The first broken link or the useful mechanism, its exact owner and the decision affected.
- The strongest remaining rival and the smallest observation that would close or refute it.

For a question without a material finding, a short answer and an evidence pointer suffice.
Distinguish supported, refuted and unresolved conclusions from unobservable properties, absent
opportunities and deferred live work. None of those means the same as an unexamined question, and
a lane's completion establishes no semantic verdict by itself.

Before closing, check that the initial design and a consequential later transition were examined,
that important claims have an instrument capable of testing them, and that the synthesis resolves
or exposes contradictions between lanes. Read the earlier notes under `notes/` for the same
mechanism and say whether this run is a recurrence, and if so what happened to the remedy the
earlier note proposed. Consider a plausible blind spot outside the earlier reports, and do not
invent one when the evidence supports none, or invent a missed-defect percentage.

The archive is the four files under `wri-archive/v2` and the investigation note beside it, as
SKILL.md describes. Publish safe findings and evidence pointers, not protected verifier detail, raw
captured prose, counterexamples or reference artifacts. This checklist grants no new model access,
scoring authority, paid comparison or authority to edit controller output.

Improve the review process from eligible opportunities and decision-changing evidence. Reuse the
deterministic readers for identity, arithmetic and joins, and add instrumentation only when a
specific missing observation would change a decision. Retire duplicate work at its owner,
preserving the isolated challenges and the readers that still have a consumer. A dormant week, a
complete report or a frequently passing check alone proves neither uselessness nor value, and no
use during a week with no eligible opportunity is not deletion evidence.

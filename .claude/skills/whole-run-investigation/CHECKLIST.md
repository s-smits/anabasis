# Whole-run investigation checklist

A whole-run investigation answers three questions. Did the run build what the request asked for?
Does its measurement tell correct work from convincing substitutes, and how far can that be known
when the Builder wrote the measurement? And did the loop learn anything from what happened? Every
row below belongs to one of those three.

Start from the request and the recorded work. Earlier reports and notes supply hypotheses; they do
not define what can be wrong, and a conclusion one of them reached enters this run as a question
for a lane rather than as its premise. A green battery, a complete catalogue or a long
investigation answers none of the three by itself. Preserve useful mechanisms and supported
successes alongside defects, because a review that finds only faults tells the next reader nothing
about what to keep.

This file owns the synthesis questions. [SKILL.md](SKILL.md) owns the procedure,
[the synthesis reference](references/synthesis.md) what the synthesis produces and the archive, and
[the catalogue](references/review-angles.md) rows A to I and the thirty-eight semantic lanes. A row here creates no lane and waives none the tier authorised; several rows may
share one lane. Lanes 7, 23 and 30 stay isolated until their reports are frozen, so a row naming
one of them is answered by its report and never by the primary doing the same work first.

## Who wrote what the run measured

Ask this before any other row, because every later answer is read through it. The Builder wrote
the tasks and their limits, the checks, the controls that calibrate the checks, the reference that
witnesses each task, the solver's tools and guide, and the walls. So each verdict the run records
is weighted by how much of it the Builder did not write, and a pass can mean an easy task, a check
that observes too little, or both.

| Question | Deciding evidence and test | Where it lands |
|---|---|---|
| **The exam against the request.** Does the brief ask what the request asks? | Set the request's material obligations beside the brief's families, published limits and declared checks. Name each obligation the brief narrows, drops or replaces with an easier proxy, and each rule the brief adds that no practitioner of the request would hold. The Builder's reading is not the request's; a rule it invented measures the solver's reading of the Builder's wording. | lane 31; lane 1 for the chain from obligation to check |
| **The witness.** What did the reference solve prove about each task? | Read `correctness-model/reference/index.ts` and its F2 output shape: does it search, derive or replay stored answers? A witness proves a task feasible and never difficult, and a reference that replays passes F2 exactly as a search does. Whether the witness bounds the difficulty a Builder can publish, and what it means when the solver beats it, are questions this run's bytes answer, not premises. | lane 33; row F |
| **The solver's instruments.** Do the solver's tools report what the checks read? | Compare each solver tool's return with the declared checks' artifact and input paths. A tool that reports every margin a check reads turns solving into propose, read, adjust. Separate that from the host's own `readMargins` table of published limits, which is public by design. | lane 34; lane 23 on `CHECK TOOL IN SOLVER TRACE` |
| **Passes a second computation can reproduce.** Does a pass survive arithmetic the Builder did not write? | Recompute a bounded sample of verified passes from public facts and the artifact, weighted to the checks the request depends on. Report how many held, how many broke and how many the lane could not recompute, and name the tool digest behind each recorded verdict. A verdict whose tool bytes no longer resolve rests on an unestablished instrument. | lane 35; lane 2 and row H for the executed bytes |
| **Fails that may be right.** Is each verified fail a wrong answer, or a right one the checks refused? | Read each verified fail's artifact against the public contract, without verifier output, and ask whether a practitioner would call it wrong. A family that fails every case round after round is either hard or mis-checked, and the reading has to say which it examined. | lane 38 on `FAMILY UNMOVED all-fail`; lane 7, isolated, for independently derived alternatives |
| **What a Judge pass decided.** When the Judge agreed with the verifier, what did that agreement test? | The Judge reads the Builder's public rules and the artifact; it does not re-derive the request. Agreement is a second reading of the same rules, so a fault both miss is invisible to both, and a sample of Judge fails is a sample of what the Judge noticed rather than of false accepts. | lane 32; lane 16 on `CENSUS WITH DISAGREEMENT` |
| **The size and the pressure.** How was the battery sized, and what pushed the Builder toward harder tasks? | Read the probe range, the graduation rule and the requested size against what was measured, and the placement against what the author was shown. The controller writes no task and states no zone to the author (AGENTS.md "Goals and the climb", under "Who hears the placement, and what it drives"), so every move in difficulty is the Builder's choice under the pressure the round text applied. | lane 37; lane 36 on `CLIMB FLAT`; [the climb reference](references/climb.md) |

## Establish the chain before dividing the work

Bind the full measured source, the request, the model condition and the accepted candidate, and
keep the review procedure's own revision separate. Use source-matched readers, tell absent source
support apart from missing evidence, and never substitute today's controller semantics for the ones
that ran. Rows A to I settle identity, arithmetic and joins once, in the primary session; a lane
that repeats a row's calculation has spent its effort on nothing.

Walk the first authoring cycle and the consequential later repair or experiment in time order:

`request → design → authoring → admission → measurement → diagnosis → next action → next result`

Authoring and admission overlap in one place that is easy to miss: the authoring Epoch Review runs
during the round, and submit waits on `AuthoringReviews.join` in `src/run/authoring-review.ts`, so
a blocking finding was in front of the Builder before the battery. If an edge never happened, record
why and what it leaves unknown. Inspect a pre-battery candidate when it can settle a product or
authoring defect; zero verified cases removes the capability rate, not every useful question. For
a live run bind T0 and T1 separately and defer unfinished outcomes.

Read complete captured sessions when practical. Otherwise include the decision before the brittle
span and its settlement, record the events read and name the omissions. Join prose to native tool
requests and results, revisions, refusals and accepted bytes. Captured prose is neither hidden
reasoning nor a complete tool transcript, and one outer assistant turn can hold many native
actions.

For a consequential mechanism establish:

`producer → exposure → eligible opportunity → output → consumer → decision → next observation`

Locate the first broken link, and distinguish absent, ineligible, undelivered, unused and used
without proved benefit. A tool declaration, a successful read, an invocation or a consumed-packet
counter proves only its own link. A justified decision to keep the current design can be useful
work.

## 1. What actually ran, and what can we know?

Settle arithmetic and identity once, with the verified readers, and then investigate the
contradictions and what the result means. Read-only evidence checks authorise no paid run.

| Question | Deciding evidence and test | Where it lands |
|---|---|---|
| **Condition.** Is this the run and product the claim names? | Join the opening, served-model evidence, source and dirty disclosure, immutable candidate, accepted artifacts, gates, batteries, promotion and claim. Keep configured and attested model identity apart. A hash binds bytes; it establishes neither meaning, independence nor adoption. | rows A, B and I; `SERVED MODEL MISMATCH` and `UNATTESTED ROWS` |
| **Three kinds of case.** Which cases are verified, unaccepted and non-result, and which reader counted what? | Count through the closed classifier, never from an export. Recount any figure — a claim's `n`, the climb history's `n`, an exporter's pass rate — that folded unaccepted cases into its denominator. A capability rate is over verified cases alone; a difficulty strike counts door-rejected attempts once any case is verified. | row G; lane 25 for each unaccepted case and non-result |
| **Closure and censoring.** Where did useful work stop, and what was prevented? | Reconcile the terminal and durable liveness with every attempted and unscheduled case. Distinguish explicit allowance exhaustion from a generic limit, timeout or stall, and say which conclusions concern completed work and which need the missing opportunity. | row G; `walls` lane; lane 24 on `DECISION ON CENSORED BATTERY` or `EXPLICIT ALLOWANCE WAIT`; lane 25 for the terminal |
| **The executed bytes.** Which tool bytes decided each verdict, and do they still exist? | Read every tool run's `source` and digest, `verifierEnvironmentHash`, and whether each deciding tool's version toolchain still resolves. A dangling toolchain means no replay can confirm a pass, so the deciding instrument is unestablished rather than proved. | row H; lane 2 on `VERSION TOOLCHAIN DANGLING`; lane 35 |
| **Observability.** Could the instruments see the property being reported? | Compare the canonical epoch, battery, version, execution and trace sets with the rows each reader returns. Check pagination, omissions, units and counter lifetimes, and trace a suspicious zero to its capture boundary. An empty join despite recorded versions is an instrument question before it is evidence. | row H; lane 26 when prose capture is the gap; lane 25 when a failure hides in it |

## 2. Did the Builder understand and realise the request?

| Question | Deciding evidence and test | Where it lands |
|---|---|---|
| **Request fidelity.** Which material obligations survived the opening? | Read the verbatim request and authorised context, the served starter and the first design, then trace each consequential obligation into the final artifact, an enforcing check or an explicit omission. Shared agreement on a mistaken premise is still a product gap. | lane 31; lane 1 |
| **Domain grounding.** Were consequential unknowns resolved correctly? | Check the public authorities behind domain facts and follow the research into representation, task content and deciding tool configuration, including native search, shell research and installation traces. A citation or an installed compiler settles no semantic question. | lane 1; lane 7 when a public standard would decide differently |
| **Expressibility.** Can a solver know and express every enforced obligation? | Trace public requirements through schema, writer, draft state, submission and verifier input; check precedence, closed value sets, units and runtime facts; exercise the real submission path. Distinguish a rule that cannot be represented, one that was withheld, and a root that cannot affect correctness. | lane 3 for the host contract; lane 4 for the guide and roster |
| **Task value.** Does the evaluation represent useful work in the requested domain? | Relate families, omissions and success criteria to practitioner tasks. Look for distinct-looking tasks one constant artifact solves, siblings that differ only in published values, and a product narrowed to an easy proxy. Counts and lexical diversity do not establish reasoning demand. | lanes 31 and 8; `AGGREGATE HIDES FAMILY` and `UNOBSERVED FAMILIES` |

## 3. Does the correctness measurement test the actual product?

Keep these separate: a valid interface can compose badly, an authentic executable can check the
wrong property, and a discriminating verifier can enforce the wrong public contract. Each of them
was written by the Builder, so each is read for what it observes rather than trusted for what it is
called.

| Question | Deciding evidence and test | Where it lands |
|---|---|---|
| **Authoring-to-host compatibility.** Can a legitimate authored check execute through the real host contract? | Follow actual payloads across projection, input binding, worker transport, wall and result handling; run the nearest legitimate and forbidden boundary cases when needed. A local stub accepting an operand proves nothing about the host. | lane 3 |
| **Executable dependency closure.** What actually decided the verdict? | Resolve the whole deciding chain — wrapper, selected command, imported code, flags, libraries, configuration and runtime assets — and bind it to host-attested operations. Hashing the top-level executable does not establish the independence of what it uses. | row H; lane 2 |
| **Product execution and coupling.** Did the measured operation exercise the delivered artifact, and are the relations between its parts enforced? | Trace one accepted artifact from its bytes to the deciding observation, and test whether a host-only path or an alternate implementation can pass while the delivered program is wrong. Name each required relation between roots, then vary one side while keeping the other. | lane 1 |
| **Limit slack.** Do the checks bite where the request is hard, or only where it is easy? | Read which checks failed at least once in shipping and how far every shipping value sits from the boundary. A limit anchored to the Builder's own accept or reference is one the reference already clears; a battery every task passes has measured no limit. | lane 5 on `UNTRIPPED IN SHIPPING` or `PERFECT BATTERY OVER AIM`; lane 35 beside it |
| **Check binding.** Can each check bind to what it claims to judge? | Compare where the rejects reach with where shipping reaches. A check that fails only on an id it cannot bind to the artifact, or that every accepted artifact clears, is reach without discrimination. | lane 6 on `UNTRIPPED IN SHIPPING` or `REACH-ONLY CHECKS` |
| **Wrong-artifact acceptance.** Can plausible incorrect work pass? | Execute a bounded, semantically chosen wrong-artifact corpus through the recorded verifier and wall under fixed identities, keeping valid submission structure. The controls are the Builder's own, so a clean census calibrates the checks around the Builder's answers; what the controls left untested is the question. | row E for the recorded controls; lane 6 |
| **Valid-alternative rejection.** Can genuinely correct work fail? | Derive valid alternatives from the public contract independently and execute them through the same path, separating parser rejection from a completed false verdict. A wrong-artifact corpus cannot establish freedom from false rejection. | lane 7, isolated; lane 38 for recorded fails |
| **Independent user outcome.** Would the accepted result work for its user? | Freeze an independent public-standard derivation or reference result before reading verifier source, controls or recorded verdicts, and prove any adapter preserves the relevant inputs. A sibling harness's agreement is diagnostic, since two implementations can share a blind spot. | lane 7, isolated; lanes 29 and 30 for a hardware target |

Lane 1 owns the end-to-end request, execution and coupling join, lanes 2 and 3 own the two halves
of what executed it, and lane 7 owns both public-alternative questions. Reuse their reports; do not
collapse an isolated challenge into the lane 1 synthesis, and do not answer a lane 7 question from
the primary session before its report is frozen.

## 4. What capability or limit did the solver demonstrate?

| Question | Deciding evidence and test | Where it lands |
|---|---|---|
| **Public problem, free method.** Was the solver given the problem without a sufficient solution method? | Inspect everything the agent can read: brief, guide, tool descriptions, returns and files. Distinguish public tools and published limits from an allocation recipe, a hidden tie-break or a margin report on every check. Tool availability and constant turns establish neither leakage nor cheating. | lanes 8 and 34; lane 4 for a payload that hands over a decision; lane 23 on `CHECK TOOL IN SOLVER TRACE` |
| **Solver process.** What work did the solver do? | Join native actions, errors, revisions, artifacts and durations by family and condition. Distinguish a capable short solution from a shortcut, and a long struggle from an environment failure. Effort does not separate passes from fails within a battery, so it is not difficulty. | lane 22; `walls` lane; lane 23, isolated, when the trace is in dispute |
| **Rehearsal reach.** Could the rehearsal instrument grade this battery? | Read the rehearsal ledger's not-run rows against the families and the walls they were graded under. A family the instrument could not grade is one the Builder calibrated blind. | lane 9 on `REHEARSAL NOT-RUN` |
| **Calibration.** Did the Builder measure its battery before paying for it? | Read the rehearsal ledger beside the submitted bytes, and round over round the rehearsal verdicts against the measured count. A `harness_trial` never run on the submitted bytes is a battery whose count was guessed. | lane 11 on `SUBMITTED BYTES NEVER REHEARSED`; lane 10 on `CLIMB FLAT` |
| **Measured limit.** Which families were tested near a meaningful boundary? | Read the difficulty decision's placement, its `repeated` and `conflict` facts, family-wise verified outcomes and available margin. Separate task hardness from poor tools, missing public facts, false rejection and resource censoring. A perfect battery or a reached check establishes no limit. | row G; `climb` lane; lanes 10, 36 and 38; lane 5 on `PERFECT BATTERY OVER AIM` |
| **Battery size.** Was the battery the size its evidence needed? | Read the probe range and the graduation rule (`batterySizingGate` over `POLICY.battery`; AGENTS.md "Goals and the climb" says what it decides) against the measured batteries, remembering that an unaccepted case counts as scored there. | lane 37 |
| **Stability and transfer.** Does the result survive a fresh opportunity? | Bind repeated conditions, fresh tasks and paired changes to exact identities, and separate repeat stability, fresh-task transfer and response to a changed axis. A higher aggregate under a different evaluator does not establish improved solving. | lane 20 on `REPEATED CONDITION`; lane 18; `FAMILY UNMOVED` |

## 5. Did feedback become a real, retained repair?

Treat confidentiality, useful public feedback, delivery and semantic repair as four tests, since
one can succeed while another fails. Apply the measured source's owners and experiment authority;
a historical move name is not evidence of today's routing.

| Question | Deciding evidence and test | Where it lands |
|---|---|---|
| **Confidentiality.** Can protected detail influence model-visible text? | Follow private verifier and reviewer material through every projection, prompt and tool return. Changing only protected detail must leave every public prompt digest unchanged. No repair benefit justifies evaluator coaching. | row C; lane 21 on `MODEL-VISIBLE SURFACE CHANGED` |
| **Public-safe sufficiency.** Did the permitted message keep the meaning needed to act? | Compare the authorised public facts with the served projection: obligation, owner, priority and the blocking or advisory distinction. A leak-free message can still be too vague, and adding protected failure locations is not the remedy. | lane 13 |
| **Routing and opportunity.** Did the right owner receive actionable feedback in time? | Join finding, admission, owner, delivered packet and next authoring opening, including the authoring review's findings delivered before the battery. Separate fresh, cached, stale, superseded and undelivered advice. | lane 14 on `FINDINGS WITHOUT OWNER` or `ADVISORY FINDING RECURS UNROUTED`; lanes 15 and 17 |
| **Judge disagreement.** When the Judge failed a verifier pass, which was wrong? | Read the cited rule against the artifact and the check. A Judge error and a verifier defect have different owners. And when the two agree, read lane 32 before counting the agreement as confirmation. | lane 16 on `CENSUS WITH DISAGREEMENT`; lane 32 |
| **Standing duties.** Was the mechanism found before, and did the remedy already in place run? | Read earlier notes for the same mechanism; where the remedy is a standing duty in the measured source, read that component's recorded output and say whether it fired, what it found and where it went. A duty that never fired is the finding. | primary, from `notes/`; lane 12; lane 14 |
| **Semantic repair closure.** Did the successor fix the same defect? | Carry the original obligation and falsifier through diagnosis, prediction, rejected revisions, accepted bytes and the next measurement. Classify repair, honest narrowing, removed challenge and unresolved work apart; a matching check id or a higher pass rate closes nothing. | lane 19; lane 18 |
| **Memory and recurrence.** Was useful learning written, retained and used? | Inspect authored memory, carried bytes, opening injection and the next eligible decision. Join recurring findings by falsifier across reviews and source changes; disappearance from the next report is not closure. | lane 26 on `MEMORY OVER READ CAP`; lane 14 |
| **Experiment integrity.** Did the final experiment still test its stated purpose? | Compare what the Builder's prose and notes say the round set out to do (and `EXPERIMENT.json`, on a run whose source predates its removal) with the candidate transitions, task and control changes and measured condition. Admission after removing the challenge answers a different question, and unchanged task bytes prove no climb. | lane 20; `climb` lane |

## 6. Which mechanisms and changes earned their cost?

| Question | Deciding evidence and test | Where it lands |
|---|---|---|
| **Component value.** What information or decision did each component add? | Evaluate the Builder tools, the census, the Main Judge, the diagnosis reader, the Epoch Reviewer in both its authoring and battery reviews, the advice packet, the safeguards and the stops against their contracts and eligible opportunities. Agreement without calibration is no independent confirmation; unknown usage stays unknown. | `yield` lane; lane 24; lanes 12 and 14; lane 27 for the gate |
| **Source reach and attribution.** Did the proposed cause reach the result? | Join the source delta and ancestry to the live path, eligible trigger, recorded execution and outcome, and separate present, proved, live-exercised and outcome-proved. Name the strongest competing explanation and the observation that separates it. | `delta` lane; lane 21 on `UNREACHED CHANGED SAFEGUARDS` |

## Turn a consequential doubt into deciding evidence

State the claim, the public obligation and the smallest observable success before choosing a
probe, and then choose the cheapest real layer that can decide it. Verify the positive baseline and
the instrument's scope first, then change the one property at issue. Keep wrong-artifact and
valid-alternative challenges distinct, and reuse complete identity-bound executions when they
already answer the question.

Use private investigator scratch for authorised probes. Preserve generated bundles, accepted
artifacts and historical scores. A failed baseline or a non-result limits the correctness claim; it
is not permission to bypass the wall or fabricate a verdict. If the needed instrument or authority
is absent, state the exact missing observation and stop that claim, while continuing the questions
the evidence can settle.

Challenge the leading explanation with its strongest plausible rival, and write the observation
and the inferred cause as separate sentences so a reader can keep one and reject the other. When a
premise fails, revisit the findings built on it, including your own earlier ones. Collapse repeated
symptoms under their earliest demonstrated owner. A handwritten replacement harness cannot prove the
Builder learned; closure needs the real successor and the relevant measurement.

## Synthesis and completion

Lead `main_synthesis.md` with the supported product result, the material gaps, the full measured
source with its nine-character prefix, the exact condition and the three denominators kept apart.
Index the questions considered once, by their names above; an exhaustive review covers every row,
and a targeted one states its material omissions. Reuse the digest and the lane reports rather than
repeating their work. This index does not change `review.json`'s schema or dispositions.

For each material conclusion give the obligation or claim, the observation and its evidence path
with its proof level and scope, the inferred cause as its own sentence, the tool digest behind any
verdict it relies on, the exact owner and decision affected, and the strongest remaining rival with
the smallest observation that would close it. For a question without a material finding, a short
answer and an evidence pointer suffice. Keep supported, refuted and unresolved conclusions apart
from unobservable properties, absent opportunities and deferred live work; none of those is the
same as an unexamined question, and a lane's completion is no semantic verdict.

Before closing, check four things. The initial design and a consequential later transition were
both examined. Every important claim has an instrument able to test it, and every verdict it rests
on names bytes that still resolve. The synthesis resolves or exposes the contradictions between
lanes. And the authorship rows at the top were answered, or their omission named. Read the earlier
notes under `notes/` for the same mechanism and say whether this run is a recurrence and what
happened to the earlier remedy. Consider a blind spot outside the earlier reports, and invent none,
nor a missed-defect percentage, when the evidence supports none.

Some questions stay open across runs, and the synthesis states what this run's bytes say about each
rather than repeating an earlier answer: whether the tasks or the checks carried more of what the
passes measured; whether a small set of bundle files held the run's flaws; whether the reference
witness bounded the difficulty the Builder published; and what a solver beating the reference says
about the Builder's reach. Each has a lane — 5, 35 and 38; 31; 33 — and each is answered as
observed, inferred, or not established.

The archive is the four files under `wri-archive/v2` and the investigation note beside it, as
[the synthesis reference](references/synthesis.md#the-archive-and-the-note) describes. Publish safe findings and evidence pointers, never protected verifier detail,
raw captured prose, counterexamples or reference artifacts. This checklist grants no model access,
scoring authority, paid comparison or authority to edit controller output.

Improve the review process from eligible opportunities and decision-changing evidence. Reuse the
deterministic readers for identity, arithmetic and joins, and add instrumentation only when a
specific missing observation would change a decision. Retire duplicate work at its owner, keeping
the isolated challenges and every reader that still has a consumer. A dormant week, a complete
report or a check that always passes proves neither uselessness nor value.

# Whole-run investigation review angles

This file is the whole catalogue: nine deterministic rows the primary reviewer settles itself, and
thirty-eight semantic lanes a paid session can be given, one question each. Read the stance below
before any row or lane, because every one of them is written from it.

## Who held which pen

A run measures the Builder's own exam. The Builder wrote the tasks and their published limits, the
checks that decide each pass, the accept and reject controls that calibrate those checks, the
reference solve that proves each task can be solved, the tools the solver reaches for and the
operating guide that tells it how. The host verifier owns the verdict in the sense that nothing
else may set it, but the property the verdict tests is whatever the Builder's check reads. So a
pass can mean an easy task, a check that observes too little, or both, and a battery every task
passes cannot tell those three apart by itself. Nothing in this catalogue treats a verdict as an
independent measurement until a lane has said which part of it the Builder did not write.

Five readings follow from that, and every row and lane applies them.

- **Weigh each verdict by its independence from the Builder.** Name the author of the deciding
  instrument — Builder-authored computation, a Builder-installed public tool, a host tool, the
  host's own margin table — and scope the sentence to what that author can establish.
- **Name the bytes that executed.** A verdict rests on the tool digests the claim recorded. When
  those bytes can no longer be resolved, because a version's `.toolchain` link dangles or its
  workspace was removed, the deciding instrument is unestablished, and a finding that relies on
  the verdict says so before it relies on it.
- **Keep the three kinds of case apart.** Verified, unaccepted and non-result cases have different
  meanings, and a figure an exporter or a reader computed with unaccepted cases counted as verified
  is recounted from `case-record.jsonl` through the classifier before it is quoted.
- **Agreement is not independence.** A Judge pass tests only the rules its rationale says it
  decided, and a Judge that cites only the Builder's published rules cannot test a fault the
  Builder's checks also miss. The Judge fails of verifier passes are a sample of what the Judge
  noticed, not a sample of false accepts.
- **Separate what was observed from what is inferred.** Every finding states the recorded
  observation and the cause it proposes as two sentences, so that a reader can keep the first while
  rejecting the second. A diagnosis an earlier investigation reached is a hypothesis for the lane
  to settle from the bytes, not a premise to build on.

## How the catalogue is read

A lane is started by a deterministic trigger, which is the capitalised text before the first colon
of a line that `digest.ts`, `source-delta.ts`, `walls.ts`, `timeline.ts`, `climb-velocity.ts`,
`handoffs.ts`, `gate-rent.ts` or `hardware-target.ts` prints, grouped by `run-overview.ts` and
rendered by `brief.ts`. Some lanes are also standing lanes of a tier, opened on every run of that
size, because the question they ask is the one a self-authored exam always raises. A trigger says a
lane has something to read and never what the answer is, so a lane that contradicts its trigger
with evidence has done its job.

Nothing here changes a score. A lane's product is a finding with one owner, the exact evidence it
cites and the observation that would reverse it. The owner is one of the nine bundle files of
`BUNDLE_FILES` in `src/author/feedback-routing.ts` — `correctness-model/brief.json`,
`correctness-model/tasks.json`, `correctness-model/controls.json`,
`correctness-model/evaluator.ts`, `correctness-model/reference/index.ts`, `agent/tools-spec.json`,
`agent/tools.ts`, `agent/BUILT_AGENTS.md` or `agent/config.yaml` — or `environment` when the
Builder can repair it, and `controller-source` with the file named, or `judge`, when it cannot.

Each lane body opens with exactly one paragraph beginning `Starts from`, which the manifest carries
verbatim as the lane's trigger; the rows have none, because nothing starts them. The lanes fall into
nine groups — product validity (1–4), difficulty (5–8), calibration (9–11), the review loop
(12–16), hand-offs and attribution (17–21), the solver's time and failure (22–26), the gate
(27–28), a named hardware target's ground truth (29–30), and authorship and instrument independence
(31–38) — and a lane names its neighbour wherever one hands to the next. Lanes 7, 23 and 30 are
isolated and never share a session with another lane.

## Deterministic rows A–I

The primary reviewer settles these from the recorded bytes before any lane is launched, and never
delegates them: they are the identities every lane's finding is bound to, so a lane that reads them
again is spending on a join that was already made.

**A. campaign identity.** Resolve the campaign from the run, never the other way round. Begin with
`controller/<runId>/opening.json` (`campaign-opening/v2`) and take the project and campaign
directory it names, because campaign slugs carry numeric suffixes and two neighbouring suffixes can
hold runs of the same request; a run id matched against the wrong suffix reads another run's
batteries. Resolve every path to its real location before counting anything: the `ana-run-*`
evidence trees expose `campaigns` as a symlink into the main tree, so a sweep over both counts one
campaign twice. Bind the full source commit, the source digest and the dirty disclosure to the exact
review worktree and its HEAD, with the run id and the opening digest beside them; an unresolvable
source object is `source-unresolved`, and never licence to substitute the current checkout, main or
a neighbouring run. The opening binds a request digest rather than the prompt text, so quote the
request from the served kickoff prompt, not from memory. Report the three model slots as three
values with their provenance — an environment override, an admitted config file or the default —
because a missing provenance is an evidence gap and never permission to infer the pin from a model
name a trace mentions. `budget.json` binds the ledger's database identity and `epochs.json` names
the epoch the run is in; the terminal names the opening epoch, so a join through the terminal can
land on the epoch holding almost none of the work. Every projection (`default`, `--scan`,
`--scorecard`, `--cases --result <kind>`) must describe this same run, and two projections that
disagree are the finding. `--scan` reports and never gates, so a warning there is a question.

**B. claim and promotion state.** Read `claims/<runId>-*.json` and `promotions/<runId>.json`
(`product-promotion/v1`). A promotion row carries `decision: "promoted" | "held"` and no
comparison, because there is no contest between a candidate and the current harness; a held row
names its clauses — `candidate-unmeasured`, `candidate-claim-refused`, `candidate-zero-verified`,
`candidate-task-set-unbound`, `candidate-evaluator-unbound`, `candidate-fingerprint-drift`
(`src/run/candidate-promotion.ts`). The first admitted build has nothing to replace, so
`selectInitialProduct` (`src/run/product-versions.ts`) selects it at adoption, before its battery,
under a ledger decision `initial-<id>` with `initial-product/v1` evidence, and the version sits at
`versions/<id>/` with a `product-version/v2` manifest. A missing or refused claim is not success,
and a clause contradicted by its own cited rows is a defect in the clause. Read `statement.n` and
`statement.passed` rather than `claim.ok`: an `ok: true` claim with `passed: 0` is evidentially
valid and is no capability result. What a claim discloses — a `modelIdentity` limit, a
`judgeDecision` of `non-result` or, before 2026-09-29, `no-battery-verdicts` — is the contract working. Join across an
epoch boundary on the recorded bundle or `taskSetHash`, never on the epoch name.

**C. workspace and Git.** Check that a fresh workspace committed the starter package and that each
completed change describes the tree it actually produced. `workspaceChange` names base, child,
`changedPaths` and `deletedPaths`; a predecessor, when present, equals this base, and Git ancestry
must agree. A deleted path has to be absent from the child tree, not merely listed. A resumed
workspace is `N/A` for the starter commit, not `fail`. A change record can pass as a Git claim while
failing as a description of what was built, so compare the committed bundle bytes against the
fingerprint before calling the evidence complete. Git is the Builder's memory and says what the
Builder wrote; the snapshot row E binds says what was accepted.

**D. static conformance.** Does the candidate satisfy the contract it declares? Read the record
findings, the iteration outcome and `conformance.json` (`tool-conformance/v4`). Conformance binds
the tool specification, the task set, the public artifact schema and the generated-worker identities
together, so a bundle passing three of four is failing, and a step whose named content survives in
no preserved artifact is unverifiable rather than a pass by absence. Conformance must open every
task and require one stable worker registration and tool schema across the battery. Public compiler
and generated-module diagnostics describe the authoring interface and may be quoted; verifier
internals may not. Conformance proves the declared contract is internally consistent. It does not
answer lane 1's question, which is whether a valid artifact exists that the writer cannot express or
that the verifier reads differently from the writer.

**E. fingerprint and gate census.** The fingerprint binds exactly the agent, correctness-model and
task-set hashes, in both directions: nothing extra, nothing absent. `submit` and `correctness_check`
freeze one immutable snapshot (`src/author/candidate-check.ts`), fingerprint it and validate every
later stage from that snapshot; its `snapshotId` and `engineCondition` form the `conditionKey` a
cached verdict is served under, so the same snapshot over different installed tools is a different
condition. The identities do not all move together: `scoringHash` covers the brief and the evaluator
with its imports and stays constant when only the installed tools change, while the harness
identity moves because it hashes the executed tool digests. So "the same scoring program" is not
"the same instrument", and a comparison across a tool change names both. The census (`census.json`,
gate path only) needs one `control-receipt/v2` receipt per declared accept and reject control
(`src/correctness-bundle/control-receipts.ts`): join `controlId`, task, kind and expected check to
the recorded corpus, keep non-results in that denominator, and read a missing, duplicate, extra or
foreign receipt as a census failure. The controls are the Builder's, so a clean census proves the
checks behave as the Builder calibrated them and nothing about what the Builder did not think to
reject. This is the gate census; the Judge battery census belongs to lanes 16 and 32.

**F. F2 solvability.** Did solvability settle for every authored task? Read `solvability.json` and
each graded case's `cases/<taskId>/verifier.json`, whose `checkReceipts` name every declared check
that fired (`src/correctness-bundle/verification-runner.ts`). F2 runs every task's reference solve
through the public writer, DraftStore and submit path the live solver uses, and what it proves is
the submission path. It does not prove the reference searched for its answer: a reference that
returns a stored answer keyed by task id passes F2 exactly as a computing one does, and lane 33 reads
which kind each domain wrote. Report completed, unsettled and non-result counts separately:
`evidence: null` with no cases means F2 never executed, which leaves the tasks unsettled rather than
failed. A task no reference path can solve is a harness defect that poisons the denominator it sits
in. When the census and F2 share one typed verifier non-result, report it once with one owner. A
controller deadline reached before the generated-tool worker is ready is a host non-result; a worker
that answered its handshake and then broke its protocol is a representation defect.

**G. case partition.** Graded, unaccepted and typed non-result counts form one complete, exclusive
partition of `case-record.jsonl` through the shared classifier (`classifyCaseOutcome`,
`src/claim/case-record.ts`), with `truthOk` and `pass` left `null` where unknown. Only verified
cases enter a capability rate; zero verified cases give an operational result and no capability
result; an entirely unaccepted battery is placed nowhere. Recount before you quote. Unaccepted and
non-result cases both lack a verdict and differ in `pass`, so a reader that keys on a Boolean `pass`
alone counts an unaccepted `pass: false` as a verified fail, and exporters and corpus readers built
that way have overstated verified counts before; any figure from an export is recomputed through the
classifier or marked unchecked. Say whether an unaccepted submit sits inside or outside each
denominator — graduation and difficulty count it, capability does not — and name the owner of that
answer. Join each admitted battery to its own `battery.json` through `readBatteryJoinSlice`
(`src/correctness-bundle/battery-record.ts`): `skipped-precase` is the only recorded zero-row
disposition, an absent record is absent evidence, and a count mismatch is a refusal. The partition
can be perfect on measured cases while the rule is broken upstream: a provider refusal that arrived
as a successful turn's prose is a non-result wearing a capability finding's clothes, so when many
iterations share one findings hash, read the observability log for refusal prose.

**H. runtime identity and isolation.** Every case is bound to the model, runtime and sandbox the
claim names. Sha-check `traces[].sha256` against the trace files rather than trusting the pointers.
The isolation runs one physical refusal probe per measure invocation and copies the probe object
into every record row, so one shared `confinedPid` is the probe's and the per-case worker pids live
in each case's `built-runtime.json`; report N rows under one proven `policyHash`, not N refusal
proofs. Then keep two facts apart: who installed each tool and what the host attested it ran. Every
tool run records its `source` (`workspace-toolchain` or `host`), `digest` and `kind` (`binary` or
`script`), and a script adds its `interpreter`, `interpreterDigest` and `packages`
(`src/verify/tool-inventory.ts`, `ToolEntry` in `src/verify/verifier-port.ts`); the claim carries
the same rows as `verifierTools[]` under one `verifierEnvironmentHash`. A compiler the Builder
installed under `.toolchain` is Builder provenance, and passing the digest and argument checks does
not make it independent. Finally, say whether those bytes can still be resolved: list each deciding
tool whose recorded digest no longer resolves on disk, because a verdict whose instrument cannot be
replayed is a recorded fact that no one can re-examine, and every lane relying on it inherits that
limit. Lane 2 owns what a wrapper or a dangling link actually ran.

**I. served-model attestation.** Is the model each case reports the one that served it, as a
host-recorded attestation rather than the configured pin echoed back? Read `battery.json`
`cases[].solver.runtimeIdentities[]` (`runtime-model-identity/v2`) beside the opening's Built pin and
digest block 5b. A row carrying the provider's `resultId` is an attestation; a row without one is
an echo. Read attested rows, unattested rows and rows with no completed turn as three counts, since a
non-result before the first turn attests nothing. A served model that differs from the pin is
`SERVED MODEL MISMATCH` and blocks the condition sentence. An unattested row under a completed turn
is an instrumentation gap: report `unproven identity` and keep the case's kind, because an unproven
identity refuses the identity claim and nothing else. Do not read model names out of trace prose.

## Semantic lanes 1–38

**1. Request-to-verdict chain.**

Starts from block 1's tool column reading `in-process` for a check the request's subsystem needs,
and from any artifact-schema root or declared public input that no applicable check reads.

The question is what the verdict observes, measured against what the request asked for. Follow the
original request to the accepted artifact and on to the deciding operation — a compile, a host
double, target execution, physical hardware — and keep those four scopes apart, because a narrower
observed scope does not fulfil a broader obligation the request names. The shape to look for is a
Builder-authored host double standing in for the hardware or the physics the request is about: a
check whose `evidence.kind` is `authored`, running the artifact against a stub the Builder wrote,
verifies the Builder's published arithmetic and can invert the real semantics while passing. So for
every check the request depends on, name the author of the deciding computation and the scope it
reached, and say which obligation of the request no check observes at all. Block 1's tool column
has labelled in-process checks wrongly before, so read each check's `evidence.kind` and
`execution.requiredToolIds` in `correctness-model/brief.json`, `evaluator.ts` with its imports and
the `checkReceipts` of each `verifier.json` rather than the column. Do not quote verifier stdout,
and leave independence of the installed tool to lane 2 and a brief that dropped an obligation of
the request to lane 31. The decision it changes is whether the capability sentence may name the
request's subsystem at all; it routes to `correctness-model/evaluator.ts` for the check,
`correctness-model/brief.json` when the publication is at fault, and to the Builder prompt or
`starters/pi-built-harness/STARTER.md` when the same double recurs across domains.

**2. Executable verifier dependency closure.**

Starts from block 6b's `VERSION TOOLCHAIN IS A SYMLINK (lane 2)`, `VERSION TOOLCHAIN DANGLING
(lane 2)` and `WRAPPER-ONLY TOOL DIGEST (lane 2)`, and from any `external` check whose
`verifierTools[]` entry is `kind: "script"`.

The question is which bytes and runtime facts actually decided the verdict, and whether anyone can
still see them. Start from one recorded external operation and trace its deciding chain — selected
command, wrapper, interpreter, imports, flags, configuration, environment and runtime assets —
comparing the host-attested inputs and executable identity with what execution consumed. A
`kind: "script"` entry binds a shell wrapper's bytes, so read its `interpreter`,
`interpreterDigest` and `packages` (`ToolEntry`, `src/verify/verifier-port.ts`) and say what the
digest covers and what it leaves unhashed; a Builder algorithm run through a hashed interpreter is
still authored computation. Then retention. A version's `.toolchain` is created by
`linkWorkspaceToolTree` (`src/claim/bundle-snapshot.ts`) as a symlink into the epoch workspace, so
the retained product's tools are only as durable as that workspace, and removing workspaces has
left most version links in the recorded corpus dangling. For each version the battery measured,
say whether its `.toolchain` still resolves the bytes the claim hashed, reading
`versions/<id>/version.json` and the link without following it. Where it does not, the deciding
instrument is unestablished: the recorded verdict stands as a record, but no replay, recomputation
or regrade can confirm it, and lanes 7, 28, 30 and 35 inherit that limit and must say so. Do not
treat provenance alone as independence or as a defect, and do not repeat row H's tallies. The
decision it changes is how far any claim resting on that instrument can be examined; it routes to
`correctness-model/evaluator.ts` for a check that should declare the deciding tool, and the
retention defect to `controller-source` (`src/claim/bundle-snapshot.ts`,
`src/run/product-versions.ts`).

**3. Authoring-to-host contract compatibility.**

Starts from block 2's refusal ledger showing a gate refusal on bytes a `correctness_check` had
just cleared, from row F's host non-result before a generated-tool worker was ready, and from a
source delta touching `src/solve`.

The question is whether a check written against the public authoring interface can execute through
the real host contract. Follow one consequential request across the public types and examples, the
generated check, the projection, the tool input binding, the worker transport, the wall and the
host result, selecting one legitimate use and its nearest forbidden counterpart. Read
`conformance.json` (`tool-conformance/v4`), the gate findings, `agent/config.yaml`
(`tool_run_seconds`, `check_seconds`) and the worker's handshake evidence. Separate a valid boundary
refusing unsupported work from incompatible producer and consumer contracts, and both from an
interface refusal whose public explanation was lost on the way to the Builder. A passing runtime
double proves only that double's contract, so prefer an existing real-host probe; where a new
scratch probe needs authority, give the primary the bounded test and mark it unexecuted. Do not
widen private-input access, relax the wall or forward raw verifier exceptions to make an example
work. The decision it changes is which of two individually valid interfaces is repaired; it routes
to `agent/tools-spec.json` for the declared side and to `controller-source` (`src/solve/`,
`src/gate/`) for the host side.

**4. Operating guide and roster truth.**

Starts from a solve trace calling a tool the closed roster does not declare, from an operating
guide naming one, and from a tool payload whose return names the value a check will read.

The question is whether the guide, the tool descriptions and the tool payloads tell the solver the
truth about the roster and the walls. `agent/BUILT_AGENTS.md` naming a tool `tools-spec.json` does
not declare sends the solver after a call it cannot make, and a `presets` field may carry neither
`files` nor `shell`, so read the roster the Built prompt derived before charging a missing call to
the solver. A payload that hands over a decision is a publication question for lane 8, and one that
reports every margin a check reads is lane 34's; the payload's `text` against its `details` is this
lane's, because every promised value belongs in `text` and a tool whose result drops bytes must say
where the rest is. Read `agent/tools-spec.json`, `agent/tools.ts`, `agent/BUILT_AGENTS.md`,
`agent/config.yaml` and the traces' tool calls. Do not read the trace for derivation, which lane 23
owns. The decision it changes is whether a failed call is the solver's or the guide's; it routes to
`agent/BUILT_AGENTS.md` for the guide and `agent/tools-spec.json` for the declaration or the
payload.

**5. Limit slack against the reference.**

Starts from block 1c's `PERFECT BATTERY OVER AIM (lane 5)`, from block 1's `UNTRIPPED IN
SHIPPING`, and from any block 4b placement whose zone is over the aim.

The question is why the battery reads n of n, and a perfect battery has at least three readings
that this lane keeps apart until the bytes choose: the tasks demand little, the checks observe too
little of what they claim to demand, or both. The limit is the first place to look. For each
shipping case compute the ratio of its value to every published limit, and say where the limits sit
relative to the Builder's own reference and to the solver's shipping values: a limit anchored at a
fixed ratio above the reference design leaves a design substantially heavier still passing, and a
solver that lands well inside the reference's margin on most tasks is evidence about the
reference's search, not about the solver's ceiling or the Builder's. Whether the reference or the
witness caps the difficulty the Builder can publish is a question this lane asks of each domain
rather than a premise; a reference that replays stored answers is lane 33's reading. Then say what
a tighter limit would test that the current one does not, and whether the check reading it would
still observe the property the request names, which is lane 6's and lane 35's side. Read
`tasks.json`, `correctness-model/reference/index.ts`, the accept controls, the shipping artifacts
and the difficulty decision's placement. Report ratios and counts, never a reference value or a
per-task failure location, and do not construct alternatives, which lane 7 does alone. The decision
it changes is the next round's task probe; it routes to `correctness-model/tasks.json` for the
limits and `correctness-model/controls.json` for the accept corpus.

**6. Check discrimination and binding.**

Starts from block 1c's `REACH-ONLY CHECKS (lane 6)` and block 1's `UNTRIPPED IN SHIPPING`.

The question is whether each check can fail on a shipping artifact at all. Two mechanisms recur:
reject controls that reach only where shipping never goes, which is what `UNTRIPPED IN SHIPPING`
counts, and a label or id a check cannot bind to what it is meant to constrain, so a deliverable
root can be replaced without moving the verdict. Read the claim's `externalCheckCoverage`
(host-attested launches and reject controls per check-and-tool pair), `controls.json` beside
`tasks.json`, the `checkReceipts` of each shipping `verifier.json`, and the Epoch Reviewer's
`probe_check` rows, whose `probeIds` say which checks moved when one artifact path was changed. A
reject built from the same task's accept with one fact changed is the calibration the contract asks
for, and a reject that fails elsewhere but not on its named check provides no discrimination
evidence. Recount shipping rejections from each `verifier.json` receipt yourself, since the digest
has printed a shipping-reject count of zero on batteries where receipts said otherwise. The controls
are the Builder's, so a check that discriminates every control still discriminates only the faults
the Builder imagined; name the wrong artifact the request makes plausible that no control
represents. Do not read counterexamples or verifier stdout. The decision it changes is whether a
check counts as material before paid measurement; it routes to `correctness-model/controls.json`
for the reject corpus and `correctness-model/evaluator.ts` for a check that cannot bind.

**7. Valid-alternative rejection challenge.**

Starts from a verified count above zero when lane 5 or 6 reads slack, and it works alone in a
fixed order.

The question is whether genuinely correct work can fail the accepted verifier. Before reading
verifier source, controls, recorded case verdicts or any other lane's report, derive a bounded
corpus of valid alternatives from the public task and the domain's authorities — a different
admissible section, an equivalent representation, a boundary value — and freeze each artifact's
identity, its public validity argument and the property it varies; lexical difference alone proves
nothing. If the public-only derivation cannot be preserved, record the contamination instead of
claiming an independent challenge. Then run the frozen corpus through the recorded public
submission and verifier path under its declared walls (`bun run replay` re-grades through the
tree's verifier; a scratch probe that needs authority is handed to the primary as a bounded test
and marked unexecuted), keeping an ordinary valid baseline beside each alternative, and report
writer or parser refusal, completed false rejection, correct acceptance and typed non-result
separately, naming the boundary that rejects each alternative. When lane 2 found the version's
toolchain dangling, the replay is not the measured instrument, so say which bytes graded the corpus.
Revisit the validity argument where the public requirement is ambiguous; the test may be wrong. Do
not share a session, and do not read a false rejection as a rescore. The decision it changes is the
discrimination claim; it routes to `correctness-model/evaluator.ts` for the check and
`correctness-model/controls.json` for the missing accept.

**8. Public disclosure and one-recipe.**

Starts from a battery where every case passed at a small share of the wall, from a trace
telemetry whose call sequences are constant across cases, and from a placement over the aim whose
round's rehearsals all passed at a small `longestPassWallPercent`. A turn count is no evidence on
the pi backend, which records one turn for every solve, a 75-minute solve of 72 tool calls included.

The question is whether the brief and the tools publish a sufficient construction algorithm, so
that a careful reader transcribes the answer rather than searching for it. The shape is a recipe
published: a stated argmax for every choice, a tool payload naming the admissible values per role,
an operating guide listing the calls the answer must make, tasks differing only in the numbers
carried through. An exact formula for a rule a check enforces is not that shape, because the rule
has to be public and satisfying it can still take real work. The public validity relation —
requirements, constraints, precedence, closed value sets, constants, authorities and declared
runtime facts — stays public; what is withheld is the search order, allocation recipe, fallback
chain, derivation and hidden tie-break, across everything the solver can read together. A constant
tool sequence is a lead and not a finding: read whether the sequence is constant because the
guide scripted it or because the task shape admits one sensible order, since an earlier reading
took the second for the first. Read `brief.json` (`ruleDecisions` public rows,
`designRuleConstants`), the artifact schema, `agent/BUILT_AGENTS.md`, every tool description and
payload, and the telemetry's distinct sequence count. Do not open the private packet, which lane 23
owns, and leave a tool that evaluates a proposed design to lane 34. The decision it changes is what
the brief withholds; it routes to `correctness-model/brief.json` for the rule rows,
`agent/tools-spec.json` for a payload and `agent/BUILT_AGENTS.md` for the guide.

**9. Rehearsal instrument reach.**

Starts from block 6's `REHEARSAL NOT-RUN (lane 9)`.

The question is which families the rehearsal instrument could grade at all. `harness_trial`
(`src/builder/harness-trial.ts`) solves one task blind with the measured Built solver and grades it
through `rehearseCase` in `src/correctness-bundle/solve-case.ts` under the harness's own
`check_seconds` and `tool_run_seconds` from `agent/config.yaml`, the walls the battery grades
under. A run recorded before that change graded under a fixed 30-second total, so there a family
whose check compiles for longer returns `not-run` however the solver did, and the one instrument
meant to catch a too-easy battery before payment could grade only the fast families. Read each
`customCalls[]` row with `tool: "harness_trial"` in `builder-execution*.json` for its
`target.taskId` and `semantic.truthVerdict`, the family of each target, the compile and tool-run
durations in the graded battery's `verifier.json`, and the harness's declared walls. A long silence
in the Builder's log while `harness_trial` runs is a solve in progress, not a stall. A `not-run`
whose row reason is a provider allowance is lane 24's. Do not read per-check results, which the
instrument withholds by design. The decision it changes is whether rehearsal evidence covers the
families the plan is about; it routes to `controller-source`
(`src/correctness-bundle/solve-case.ts`) when the deadline is the limit and to
`agent/BUILT_AGENTS.md` when the guide sends the solver into work the rehearsal cannot grade.

**10. Difficulty calibration loop.**

Starts from block 4b's `OFF-AIM STREAK (lane 10)`, from the calibration table the `handoff` lane
prints, and from the `climb` lane's `velocity`, `horizon`, `flat` and `carried` lines.

The question is whether the run draws the line the climb is meant to draw (AGENTS.md "Goals and the
climb"): batteries between 1/n and n−1/n that swing as the Builder raises a requirement and repairs
what it sank, narrowing into the band over 8 or 12 rounds. A monotonic approach is not the test, and
neither is a zone: 8 of 11 after 10 of 11 is progress above the aim, and 3/3 places `over-aim` while
locating nothing. So read, in claim `createdAt` order, each battery's count, the placement the
controller recorded (`difficulty-decisions/<runId>-<digest>.json`: `placement.zone`, `aim`, `toAim`,
the Wilson interval), the operation the accepted bytes were attributed as, and the `climb` lane's four
numbers. A run of n/n batteries is the finding, whatever its zones read, and `carried` says whether
the Builder measured the same passed tasks again. The digest streak counts consecutive placements on
one side of the aim; say which side, and whether it meets the stall rule `flat` applies. What the
Builder was told is fixed: the kickoff, the system prompt's intent clause, the round prompt and the
readout name no count at any size, so no battery can be scored against a target the controller
stated. A run whose source predates the removal of `EXPERIMENT.json` recorded a plan beside each
accepted submit, and nothing reads it. Why a line stayed flat — what, if anything, pressed the Builder
to change the tasks, and which sentence it cited when it declined — is lane 36's question, and how
many tasks the next battery held is lane 37's. Do not prescribe the route, which is the Builder's. The
decision it changes is the next round's move; it routes to the Builder prompt when a surface
misstated what was measured or what a round is for, and to `correctness-model/tasks.json` when the
task set did not move.

**11. Submit decision against rehearsal evidence.**

Starts from block 6's `SUBMITTED BYTES NEVER REHEARSED (lane 11)` and from the `yield` lane's
`harness-trial` component.

The question is what the Builder did with each rehearsal verdict before it submitted. Each
`harness_trial` row's `semantic` carries `truthVerdict`, `submitted` and `candidateId`, and the
accepted submit's own `candidateId` is the join: a submit whose candidate no rehearsal
graded was calibrated from belief, and a Builder whose `MEMORY.md` says the battery is untested
against the solver has said so itself. A `pass` on the submitted bytes of every rehearsed task says
the battery was likely to land above the aim before it was paid for. Keep in mind what each reader
saw: the Builder receives one verdict bit per rehearsal and never the bytes the solver submitted,
while the authoring Epoch Reviewer reads those bytes beside the verdict, so a question about the
rehearsed artifacts is one the reviewer could answer and the Builder could not. Read the
`customCalls[]` and `submits[]` of each `builder-execution*.json` in turn order, the
`rehearsals/rehearsal-<n>/` evidence, and `builder-path-record.jsonl` for whether the rehearsal
traces the `context` tool offers were opened before the proposal was written. Do not charge a
`not-run` to the Builder, which lane 9 owns. The decision it changes is whether rehearsal enters the
plan at all; it routes to the Builder prompt or the starter when the Builder was not told to
rehearse the bytes it submits.

**12. Epoch Reviewer standing duties.**

Starts from the `yield` lane's `epoch-reviewer` component, from a review whose `coverage.missing`
names a file the seed had, and from a placement over the aim beside a review that named no
over-published surface.

The question is whether each standing duty in the reviewer prompt fired before a new duty is
proposed. There are two kinds of review, and they sit at different points. An authoring review runs
during the Builder's round, before the battery: submit waits on `AuthoringReviews.join` in
`src/run/authoring-review.ts`, so a submit made while one runs is held until it finishes, and one
showing a blocking finding the Builder has not read returns `reason: "review-unread"` in place of a
verdict. An advisory-only review lets the submit through and rides its result, unless that submit is
accepted and ends the round. It is
recorded as `analysis/authoring-<uuid>-epoch-review.json`. A battery review runs after measurement
and is recorded as `analysis/<runId>-epoch-review.json`. So never describe the reviewer as acting
only after measurement: count both, and read the authoring reviews for what the reviewer said about
the tasks before any battery was paid for. The prompt in `src/review/epoch-review-prompt.ts` asks
the reviewer to read the publication boundary every time and to run at most eight `probe_check`
executions. It owes no finding for a placement: above the aim the orientation states the placement
as a lead, and a review may end with nothing demonstrated and the tasks simply easy, so read its
`report` for what it examined rather than counting whether it recorded a task-set defect. Then read
the labels: an authoring review taken before the first task write reads the seed's empty
`tasks.json`, `publicTaskRows` throws through
`capturedBattery` (`src/run/experiment-freeze.ts`), and `src/review/epoch-reviewer.ts` records the
file under `coverage.missing`, so an early review carries `incomplete` for a file nothing had
authored. What the Builder did with the findings is lanes 14 and 36. Do not read the reviewer's
claim text as a finding. The decision it changes is the reviewer prompt and the coverage label,
both `controller-source` under `src/review/`.

**13. Public-safe feedback sufficiency.**

Starts from a defect finding admitted in one round whose named gap the next round's bytes did not
touch, from an ambiguous repeated repair, and from a source delta touching
`src/review/epoch-review-public.ts`.

The question is whether the model-visible projection kept the permitted information needed to act.
Derive the allowed public facts from the measured contract before reading what the projection
drops, then follow one consequential finding from the recorded review through `publicFinding`
(`src/review/epoch-review-public.ts`) into the text the Builder was served — the first tool result
after an authoring review, or the kickoff prompt (`prompt-ingested`, role `builder`, in
`observability/<runId>.jsonl`) after a battery review. The projection names the file, the identity,
whether it is a defect, the `demandGap` sentence, the check's public obligation and the probes'
direction, and never a repair, so a concrete gap reaches the Builder as a typed observation; read
whether the Builder's own notes recorded the gap independently, because that is the evidence the
projection bought nothing. Compare two legitimately different public
situations and ask whether the recipient would see their deciding difference, distinguishing lost
public meaning, a wrong public label, deliberate protected withholding and an inherently
unobservable distinction. Keep verifier explanations, counterexamples, reference values and failure
locations out of every proposed message. The decision it changes is the smallest correction at the
projection owner; it routes to `controller-source` (`src/review/epoch-review-public.ts`).

**14. Finding routing and recurrence.**

Starts from block 4d's `FINDINGS WITHOUT OWNER (lane 14)` and `ADVISORY FINDING RECURS UNROUTED
(lane 14)`, and from the `yield` lane's `epoch-reviewer` component.

The question is what each finding became: finding, admission, owner, then next-round bytes. A
finding whose owner is on the agent side is admitted advisory on its first occurrence and blocking
only on a probe-backed demonstration or a recurrence keyed by its `checkId` or `schemaPath`
(`src/review/epoch-review-findings.ts`), and a `schemaPath` must sit below a declared root, since a
bare root collapses every finding in a one-root domain to one identity. So a reviewer that records
the same finding each round without a probe or an identity is a channel that never becomes a route:
say whether the recurrence key could have fired and, if it could not, whether the finding named an
identity at all. Read authoring and battery reviews alike, in review order, because most recorded
findings about tasks and briefs sit in authoring reviews and none of them was blocking; an advisory
finding the Builder could read and did not act on is the observation, and whether advisory is the
right weight is the question it raises. Read each review's kind, owner, `checkId`, `schemaPath`,
severity and `probeIds`, `analysis/<runId>-admission.json` (`repair-agenda/v1`, with its
`no-feedback`, `agenda-consumed` and `evaluation-identity-unadopted` reasons), and the next epoch's
`workspaceChange`. Do not rescore, and do not propose a route that carries verifier detail. The
decision it changes is the admission projection, owned by `controller-source`
(`src/run/admission.ts`, `src/review/epoch-review-findings.ts`); the routed finding itself keeps the
owner it named.

**15. Harness-versus-evaluation triage hand-off.**

Starts from the triage table the `handoff` lane prints, from any advice issue with a count, and
from a completed epoch review beside a failing family.

The question is whether the diagnosis, the Epoch Reviewer and the advice packet agreed on which side
owned a failing family, and whether the successor repaired that side. Read the advice packet's
issues (`lastSeenRunId`, state, `dispute`), the diagnosis reading (`src/review/diagnosis-reader.ts`)
with its owner, cause, cited `boundary` and `falsifier`, the battery's epoch-review findings,
`probeIds` and `disputes`, the successor's decision-row `operation`, and the reviews timed by their
UUIDv7 names. Per failing family report the diagnosis's owner and cause and whether the reviewer
recorded a defect, whether the reviewer disputed the issue or showed through `probe_check` a changed
value that moved no check, whether the packet withheld the agent advice for a disputed issue, and
whether the successor's attributed operation repaired the named side; then time it, from the first
failing battery to the first evaluation-side review. A diagnosis names an owner and a cause, and
those are two claims: keep the observed boundary apart from the inferred cause, and test each
against its falsifier. A probe that moved no check is a lead to a loose check, not proof of one, and
a task probe repairs neither side. Do not read the failed traces, which lane 25 owns. The decision
it changes is which side the next round reopens; it routes to `correctness-model/evaluator.ts` or
`correctness-model/controls.json` when the evaluation side was named and never repaired, and to
`controller-source` (`src/author/rebuild-advice.ts`) when the packet dropped the side.

**16. Judge disagreement adjudication.**

Starts from block 2b's `CENSUS WITH DISAGREEMENT (lane 16)`.

The question is whether each Judge fail on a verifier pass is a Judge error or a verifier defect,
settled one case at a time by recomputation. A Judge fail must cite a verbatim public rule, an
uncited fail is a protocol non-result, and a cited fail of a verifier pass is a veto bounded by
`verifierPassJudgeFail` and re-sampled once (`src/claim/judge.ts`). Read the case's
`cases/<taskId>/judge.json` and `analysis/<runId>-judges.json` for the cited rule and the artifact,
then recompute the cited rule over the artifact yourself from public facts: a Judge that fails a
value just below a published limit because it rounded, or counted the wrong members, is a miscount
you can show with one arithmetic line, and a cited rule the artifact really breaks under a verifier
pass is a reason to inspect the check, which lane 6 owns. Recompute every disagreement rather than
generalising from the first, because a reading that settled one case and extrapolated has
misclassified the rest before. When lane 2 found the deciding tool dangling, the verifier side
cannot be replayed, so say which of your conclusions rest on the recorded verdict alone. Keep the
fails in proportion: they are what the Judge noticed, not a sample of false accepts, and the Judge's
passes are lane 32's. Read `src/review/judge-framing.ts` and `src/analyse/judge-contested.ts` for
what the Judge saw. Do not rescore and do not compare two artifacts. The decision it changes is
whether the veto reaches the Builder as a count and family; it routes to
`correctness-model/evaluator.ts` for a real defect, `judge` for a miscount, and `controller-source`
(`src/author/rebuild-advice.ts`) for a settled miscount still carried as advice.

**17. Round hand-off census.**

Starts from the census table the `handoff` lane prints, on a run with two or more authoring
rounds.

The question is which of the channels one round hands the next were present, served, read back and
acted on. The channels are the round facts, the climb readout and battery contract, the rebuild
advice packet, the Epoch Reviewer's public projection from both authoring and battery reviews,
diagnosis issues, memory notes, the `context` tool, and the solver traces and
rehearsals it offers. Read the full Builder kickoff in `observability/<runId>.jsonl`
(`prompt-ingested`, role `builder`), each epoch's `builder-path-record.jsonl` and
`builder-execution*.json` custom calls, and `analysis/<runId>-{rebuild-advice,diagnoses,epoch-review}.json`.
Read-back means a tool call that opened or queried the channel; prompt text in context is served,
not read. The round facts, the advice packet, the diagnosis and the review projection have no
re-query channel, so an unread one is structural rather than a Builder choice, and a file opened
through `bash` records only its working directory. The Builder keeps one conversation across rounds
and compaction cuts its oldest turns first, so a channel served once at the opening may be gone by
the time the decision it feeds is taken; say when a channel was served relative to the last
compaction. For every channel served and never read, name the cheapest alternative — drop it, move
it to a `harness_inspect` mode, or state it where the decision is taken — and the observation that
would show it mattered. The decision it changes is the kickoff prompt's contents, owned by
`controller-source` (`src/author/builder-continuation.ts`); lane 14 owns whether the right owner
received a packet and lane 26 owns memory.

**18. Same-task repair measurement.**

Starts from the same-task table the `handoff` lane prints, on two consecutive batteries with an
advice packet between them.

The question is whether an issue's complete rechecks (`absentBatteries`) or its `retired` rest on a
comparison of task identity or of family names alone. Read each battery's
`cases/*/public-task.json` digested over the public input, the consecutive
`analysis/<runId>-rebuild-advice.json` packets, and `deriveRebuildAdvice` in
`src/author/rebuild-advice.ts`, whose `advanceIssues` keys every issue with `adviceIssueId`. Join
per family before and after each repair and classify it `identical-tasks`, `partially-shared` or
`name-only`, or absent on one side, counting inputs that reappear under another family name. Report
every change in an issue's recorded facts and flag those resting on a name-only or absent join:
renaming every family retires every issue without a failing task being measured again, and
`retired` proves no fix. Say whether the producer keys on task identity or family name by
recomputing the recorded issue ids. Do not read what the task change means for difficulty, which
lane 20 owns. The decision it changes is whether an issue's recorded absence speaks about the task
that exposed it; it routes to `controller-source` (`src/author/rebuild-advice.ts`) for the key and
to `correctness-model/tasks.json` when the failing task was never measured again.

**19. Semantic repair closure.**

Starts from a repair proposal or an accepted successor, from a defect that recurs under a new id,
and from a claimed review benefit.

The question is whether the accepted successor resolved the defect that prompted the repair. Follow
one consequential obligation and its falsifier through the finding, the permitted public
projection, the proposal, the rejected revisions, the final accepted bytes and the next eligible
measurement, using the first repair and a later recurrence where they distinguish explanations.
Classify a demonstrated repair, a partial repair, a neighbouring change, an honest scope narrowing,
removal of the challenge, a recurrence and an unmeasured outcome separately. A common check id, a
changed file, a consumed packet or a better score cannot establish defect continuity, and where
distinct defects share a public location that is the counterexample to an identity-only join. A
deleted control may be a correction or a loss of challenge; decide from the public obligation and
the realised verifier. A better score after a repair is also consistent with easier tasks, so say
whether the tasks the defect failed on were measured again under the repair. Read the Builder's prose,
the successor's `workspaceChange`, the advice issue's state and `lastSeenRunId`, and the successor
battery's `checkReceipts`. Keep protected repair evidence private. The decision it changes is
whether a repair may be reported as closed; it routes to the owner the original finding named, and
to `correctness-model/tasks.json` when the next measurement opportunity was missing.

**20. Task movement and attribution.**

Starts from block 3c's `REPEATED CONDITION (lane 20)` and from the `climb` lane's edge labels
(`restated`, `adjusted`, `narrowed`, `widened`, `eased`, `escalated`, `replaced`).

The question is what changed between rounds, whether the accepted bytes match what the Builder said
it changed, and whether the numbers moved without changing what a solver must reason about. Read consecutive `versions/<id>/` bundles, each battery's `public-task.json` digests, the
decision rows' `operation` from `src/gate/experiment-admission.ts` — `task-probe`,
`harness-intervention`, `evaluation-correction`, `repeat`, `new-baseline`, decided by which of
`agentHash`, `correctnessModelHash`, `scoringHash` and `taskSetHash` moved. Attribution follows
accepted bytes and never the Builder's description: a round described as a task change whose bytes
moved the evaluator receives build attribution, and a change to the installed tools
alone leaves `scoringHash` where it was while the harness identity moves, so name both. `adjusted`
deliberately states no direction, because a moved limit is a climb only when it moves inward, and a
round that re-posed the same public schemas under new values is the `adjusted` edge read round over
round. Do not read a new hash, id, family name or longer description as a harder problem; the
Builder names the public requirement that changed and the reasoning interaction it adds, or the
change is coverage. Each edge's `carried` row counts the tasks held unchanged in id, public input
and family checks; after a full pass every one of them measured a known pass again. The decision
it changes is the attribution and the refusal of a repeated condition; it routes to
`correctness-model/tasks.json`, `correctness-model/controls.json` or `correctness-model/evaluator.ts`
by which bytes moved.

**21. Source-delta reach.**

Starts from source-delta's `UNREACHED CHANGED SAFEGUARDS (lane 21)` and `MODEL-VISIBLE SURFACE
CHANGED (lane 21)`.

The question is whether the source that changed between the previous run and this one actually
executed, which decides whether a fix is live-exercised on this run or only present in source. Read
`source-delta.ts` output — changed files by top directory, the `safeguardTriggered("id")` calls in
changed files joined to `campaigns/<slug>/safeguards/<runId>/SAFEGUARDS_LOG.txt`, and the
model-visible text changes — against this opening's `source.commit` and the previous run's. For
each unreached changed path decide: no opportunity on this run, opportunity present but the branch
not taken, or the branch taken without its sensor, remembering that a safeguard is a log-only
sensor and never changes a kind or a route. A changed model-visible surface is a changed condition:
two runs across it are two conditions, and the prompt digests in the openings say so. Resolve every
surface against the opening's commit rather than the working tree, because a page on no ancestor of
that commit was never in front of the Builder. Report the changed paths that were live-exercised,
the ones that were not, and the one next-run condition that would exercise the rest. The decision it
changes is the evidence level a fix may be reported at; it routes to `controller-source` naming the
changed file.

**22. Solver process and walls.**

Starts from the `walls` lane's `time-bound`, `turn-bound` and `submitted` rows against a wall
share, and from block 1b's `CHECK TOOL IN SOLVER TRACE (lane 23)` read as a lead.

The question is how the solver spent its walls. `agent/config.yaml` owns `solve_minutes`,
`max_turns`, `shell_timeout_seconds` and `shell_timeout_max_seconds`
(`src/correctness-bundle/harness-config.ts`), and a harness may set a solver wall anywhere from a
tenth of its default to ten times it, so a short wall is a Builder choice and the first thing to
check when cases time out. A turn is one outer prompt carrying an unbounded tool loop, and the pi
backend records one for every solve, so a turn count below `max_turns` is not room the solver could
have used; the tool calls are the work. A case
that reached a wall without passing is a truncated solve and not a settled capability failure, and
a solve the whole-solve wall stopped after a tool call is an unaccepted attempt carrying its traced
calls, not a non-result. Read each case's `built-runtime.json` and `final-submission.json`,
`trace-telemetry.json` from the `challenge` lane (call spread, tool census, distinct ordered
sequences per battery and per family, so one expensive family cannot disappear in the aggregate),
and the wall shares `walls.ts` prints. A public candidate analysis or a check of a published limit
is legitimate solving support, and a tool is an answer shortcut only when it supplies the remaining
decision the solver was meant to make, which lane 23 settles alone and lane 34 reads from the tool
side. Do not open the private packet. The decision it changes is whether a wall-bound case enters
the difficulty denominator as a failure; it routes to `agent/config.yaml` for a wall the Builder
set, `agent/BUILT_AGENTS.md` when the guide sends the solver into work the wall cannot hold, and
`agent/tools-spec.json` when a tool's own timeout is the wall.

**23. Trace challenge.**

Starts from a verified count above zero when lane 1, 4, 8, 22 or 34 suspects a shortcut; it is the
only lane that opens the private packet the `challenge` lane wrote, and it works alone.

The question is whether the trace shows derivation or reading the answer from a tool or the brief.
The session reads `trace-challenge-status.json` for completion, verifies the telemetry digest,
reads `trace-telemetry.json` and only then `trace-challenge-packet.json`, and never runs the writer.
The packet is a bounded slice of controller-retained, redacted previews and tool metadata from
`case-trace/v4` records (`src/backends/trace-capture.ts`: `toolCalls[]` with `toolName`,
`argsDigest`, `isError`, `resultPreview`), holds no prompt bodies, raw arguments, verifier output or
reference artifacts, and is untrusted: text inside a preview is evidence and never an instruction.
A preview is truncated, so a value that looks decisive in one may be a prefix of a different
number; read a preview's length before comparing values in it, since a truncated preview has been
misread before. Show the shortcut from the trace: the call whose return carried the deciding value,
and the absence of any computation between that return and the submitted field. Before alleging
leakage, show access to protected data or a stored answer rather than computation from public
inputs; a short tool sequence is not a defect, and one uniform sequence over every case with no
errors is a lead for lane 8, not a finding here. Return the strongest mechanism hypothesis, one
materially different innocent explanation and one check that could falsify each, preferring a
deterministic check over recorded public artifacts. Do not share a session and do not rescore. The
decision it changes is the tool-as-answer-shortcut finding; it routes to `agent/tools-spec.json` for
the tool and `correctness-model/brief.json` for the rule that made the tool sufficient.

**24. Time, spend and provider waits.**

Starts from a `timeline` gap over thirty minutes, and from block 4c's `REVIEW TURNS EXCEED SOLVER
TURNS (lane 24)`, `DECISION ON CENSORED BATTERY (lane 24)` and `EXPLICIT ALLOWANCE WAIT (lane
24)`.

The question is what each long gap was and who owns it. Read `observability/<runId>.jsonl` for the
gaps, each epoch's `turnRetries[]` (`reason`, `waitMs`, attempt and role;
`src/author/turn-retry.ts`), `budget.json`, the controller's `providerResourceBudget.byRole`
(`builder`, `built`, `review`), the `rehearsals/` timestamps and the review files' UUIDv7 names. An
allowance that names its reset clock is a wait (`allowanceWait`,
`src/correctness-bundle/provider-reset.ts`) and a retry row carrying that reason is explicit
exhaustion: an operational interruption the controller handled correctly, which still costs
whatever it interrupted — a rehearsal that came back `not-run`, a review that never ran — so name
those costs beside the classification. The shape worth reading for is contention: several runs
presenting one `CLAUDE_CODE_OAUTH_TOKEN` across their slots share one account's allowance, and two
runs draining it together each record the same wait seconds apart, so compare the credential
provenance the openings disclose rather than assuming separate accounts. A generic 429, a timeout,
a crash or an unexplained refusal is not proof of exhaustion. Silence is often work: a gap filled by
one long Builder tool call, a `harness_trial` solve, a Builder install or an authoring review that
holds submit is the loop running, and only a gap with no call in flight is waiting. Do not
reclassify a scored case because the identity claim was refused. The decision it changes is
ownership — `environment` against the task author — and the launch condition, which is the slot
pins and the account.

**25. Failure mechanism and non-result honesty.**

Starts from any unaccepted case, from any non-result, from a terminal other than `completed`, from
submit strikes in block 2, and from a `posture` stretch classified `adrift`.

The question is the earliest demonstrated broken link for each consequential failure, and whether
its typed kind is honest. Read the failed cases' traces and `built-runtime.json`, the submit ledger
and `turnRetries` in each `builder-execution*.json`, the terminal clause, and the partition row G
settled. A fail that reached a verdict and was recorded as a `verifier` non-result moves a wrong
answer out of the denominator; a provider refusal recorded as a successful turn's prose does the
opposite; a solve the wall stopped after a tool call is unaccepted, not a non-result; and a
byte-identical resubmit of a refused candidate is a counted strike, three of which end the session
as `authoring-stalled`. Each unaccepted case is a separate count wherever you report it: a battery
of four verified passes and two unaccepted timeouts is not six attempts at a two-in-six failure
rate, and it may still move battery sizing, which lane 37 reads. Treat a timeout as diagnosable
unless the battery evidence proves the environment owns it, and read a low score on an early cycle
as the expected signal rather than a defect. State the observed broken link and the inferred cause
as separate sentences. Do not repair or re-solve anything except a non-result. The decision it
changes is the owner of the fix: `environment` for provider, sandbox and credential failures,
`agent/BUILT_AGENTS.md`, `agent/tools-spec.json` or `agent/config.yaml` for a failure the solver's
own roster or walls produced, and `controller-source` naming the file for a wrong kind or measured
bytes that are not the accepted bytes.

**26. Builder memory and posture.**

Starts from block 4e's `MEMORY OVER READ CAP (lane 26)` on a fresh session, from a `posture`
capture read as `thin` or `unreadable`, and from a run with two or more epochs.

The question is whether the Builder's own notes did any work, and whether the controller could read
the Builder's posture at all. `src/author/builder-memory.ts` owns `MEMORY.md` under
`MEMORY_CAP_BYTES` and `SCRATCHPAD.md` under its own cap, read from the newest bytes, so a fresh
session that lost the oldest notes lost them to the cap; `carryMemoryForward` copies only an
authored file, only into a slot the successor has not written, under a `carried forward from
<epoch>` marker. Both files sit at the workspace root, outside `agent/` and `correctness-model/`, so
they enter no fingerprint and are dropped from the adopted domain by `src/author/domain-repo.ts`; a
hidden expected value reaching the bundle through memory is lane 1's finding. Read-back is a model
action: check the Builder's own file reads in `builder-path-record.jsonl` for an actual read and say
plainly when memory was written but never consumed, and do not credit memory with continuity a
persistent session already supplied. Follow two or three specific claims across consecutive
revisions and report each as held, altered or lost; a claim in memory that the tasks are hard, or
that the battery is untested, is the Builder's belief and is scored against the battery rather than
quoted as a finding. Then the posture: `builder-prose.jsonl` is written by
`src/author/builder-prose.ts` and read by `classifier/prose-classify.ts` in this skill, and a row the
reader refuses — untrimmed, over its capture bound or under another schema — leaves the posture
`unreadable`, which is a statement about the writer or the reader's bound and not about the Builder.
The decision it changes is whether a continuity gap is charged to the Builder; it routes to
`controller-source` (`src/author/builder-memory.ts` or `src/author/builder-prose.ts`).

**27. Gate rent and confidence.**

Starts from the `gates` lane's `GATE STALL (lane 27)`, `GATE CLEARED WITHOUT EDIT (lane 27)`,
`BELOW-BAR GATE FIRED (lane 27)`, `UNLEDGERED REFUSAL CODE (lane 27)`, `REVIEW HOLD CHAIN (lane
27)` and `CEILING ENDED RUN (lane 27)`, and from any defect a battery, a Judge veto or an Epoch
Reviewer probe found that a gate component exists to catch.

The question is whether each gate component that acted on this run earned its place, which is the
question the gate audit of 2026-09-25 put to every refusal: is it at least 98% sure it refuses
something actually wrong, and does it ever hold a round up that could have advanced?
`scripts/gate-ledger.ts` carries the audit's answer for every component as priors — `pRight` and
`pStall` — and the `gates` lane prints them beside what this run's firings did. Those priors are
judgements over a few recorded campaigns, and this lane is what turns them into evidence. Before
reading any episode, check that the `gates` lane read this run's terminal and execution records
under the schema they were written in, because a reader that misread one schema version has
reported stalls on runs that settled. For each fired component, take its episodes from `gates.txt`
and read each against the bytes: the receipt in `builder-execution*.json` (`customCalls[].semantic`:
outcome, stage, `findingCodes`, `candidateId`, `conditionId`, `stagesRun`, `stagedCodes`), the
Builder's own reasoning around it in `builder-prose.jsonl`, and the workspace commits between the
refused candidate and the one that cleared. An episode that ended `repaired` is right only if the
change repaired the defect the code names; a rename or reworded sentence that makes the code go away
reads `repaired` too. One that ended `repaired-tool-condition` passed on the same bundle after the
installed tools changed, so read the tool work between the receipts before crediting either side.
One that ended `cleared-without-edit` refused a submission condition that then passed unchanged, so
it refused something other than the candidate — most often a timeout charged to the author, which
rule 15 gives to the environment. `bundle-unchanged-condition-unknown` is that shape with the tools
unrecorded. A stall, a hold chain or a ceiling that ended the run is the `pStall` side: say whether
the stopped round had a next move the evidence supported, and what it cost. The converse matters as
much, and no trigger reads it: take each defect this run's batteries, vetoes or reviewer probes
demonstrated, and name the gate component that should have refused it before measurement and why it
did not. Report, per component, the prior, what was observed with its episode count, and which way
and by roughly how much the evidence moves each prior. Do not score a refusal right because the
Builder complied with it, and do not propose a new refusal without the evidence the bar asks for.
The decision it changes is a component's form — kept, narrowed into advice, rewritten or deleted —
and its ledger row; it routes to `controller-source`, naming the producer file and `gate-ledger.ts`.

**28. Evaluation-correction regrade.**

Starts from the `gates` lane's `EVALUATION CORRECTION REPLAY CANDIDATE (lane 28)`, and from any
advice issue left `unmeasured` across an `evaluation-correction` round.

The question is what the corrected evaluator says about the artifacts the old one scored. An
evaluation correction keeps the agent, the public exam and the bound schema and changes the
evaluator, the controls or the private expectations, and its next battery is a fresh solve, so
nothing grades the earlier battery's accepted artifacts under the corrected evaluator; that is why
an issue the correction touched stays `unmeasured`. The `gates` lane prints the battery of the
baseline each correction recorded and the bundle files that moved between the two; where the
scoring program moved, or its closure cannot be read, the row is a replay candidate and carries the
exact `bun run replay -- <before> --under <correction>` command, which runs `gradeCase` over the
earlier battery's recorded final submissions under the correction's bundle snapshot and diffs each
verdict against the recorded one; a task whose public digest moved is refused as
`public-task-drift`. Before running it, check that both versions' `.toolchain` links still resolve
(lane 2). A replay resolves each tool again, under the snapshot's `.toolchain` first and then the
host PATH, so over a dangling link it either cannot run the check or runs a different binary; compare
the replay's tool digests with the claim's `verifierTools[]` before reading a single flip. Run it from a checkout of the measured source and
read the flips. A recorded fail that now passes is a false rejection the correction removed; a
recorded pass that now fails is a false acceptance the old evaluator let through, which changes what
that battery measured; a set of failed checks that changed with the same verdict is a correction
whose reach the counts hide. Say whether the flips match what the correction claimed to fix in
the Builder's prose, and whether the next battery's movement is explained by
the correction or by the fresh solve. Keep every per-task verdict private, as rule 4 requires: the
lane reports counts and check ids. The decision it changes is whether the earlier battery's
placement stands; it routes to `correctness-model/evaluator.ts` or `correctness-model/tasks.json`
for a correction that missed, and to `controller-source` (`src/author/rebuild-advice.ts`) where the
flips settle an issue the advice keeps unmeasured.

**29. Hardware target coverage against public ground truth.**

Starts from the `target` lane's `HARDWARE TARGET NAMED (lanes 29, 30)`, which fires when the
recorded request or `correctness-model/brief.json` names a board or microcontroller the
`HARDWARE_TARGETS` list in `scripts/hardware-target.ts` recognises, and which names every other run
that asked the same request on another source commit.

The question is how much of what the named target actually requires the harness's families, tools,
artifact roots and checks reach, measured against public authorities rather than against the
Builder's own reading of them. Lane 1 asks what one verdict observes; this lane asks the target's
side of the same question, so start from the target and work back. For each named target, take its
public ground truth: the vendor toolchain that compiles for the real board (ESP-IDF or
arduino-esp32 for ESP32, pico-sdk or the arduino-pico core for RP2040, avr-gcc and the Arduino AVR
core for an Uno), the published datasheet and pinout facts — input-only pins, converter resolution,
voltage and current limits, bus assignments — each with a datasheet, schematic or URL as its
provenance, and a simulator where one exists (QEMU's esp32 machine, Wokwi, rp2040js). Keep four
scopes apart, compile, host double, target simulation and hardware, name the one the verifier
actually observed for each check from its `evidence.kind` and `execution.requiredToolIds`, and name
each obligation the request carries that only a higher scope could observe. A check compiling
against the real core observes the compile scope and nothing above it; a host double of the core's
library observes the Builder's own semantics. When the operator passes `--reference <abs dir>` to
the `target` lane, the report pins that tree by Git revision or content digest and the lane reads
it as the reference implementation; with none given, the missing reference is a recorded gap and
not a failure. When the trigger row names same-request runs on other source, compare this run
against the nearest of them over the matched elapsed window, the shorter run's window on both
sides, and name that window. The decision it changes is whether the measured pass rate may be read
as a capability on the named target or only on the observed scope; it routes to
`correctness-model/evaluator.ts` for a check observing a narrower scope than its obligation, to
`agent/tools-spec.json` for a missing vendor toolchain, and to `correctness-model/brief.json` for a
published fact that disagrees with the datasheet.

**30. Ground-truth verdict comparison.**

Starts from `HARDWARE TARGET NAMED (lanes 29, 30)` with verified cases above zero; it works alone
and freezes its own verdicts before it reads verifier source, recorded verdicts or another lane.

The question is whether an executable instrument independent of the Builder agrees with the
recorded verdicts. The session must first prove an adapter: a command that takes an accepted
artifact as the battery published it and runs it through a public ground-truth instrument for the
named target — the vendor compiler for the real board, a simulator executing the built image, or a
board — and shows one run end to end with its tool digest. With no adapter the missing adapter is
the finding, the session names what it would need, and it reports no verdicts at all, because a
verdict read off the source by eye is the Builder's reading again. With an adapter, run every
verified case's accepted artifact and every accept and reject control, write each verdict to the
session's own file in its scratch directory, the one path its prompt lets it write, and record that
file's digest before opening `verifier.json`, `case-record.jsonl`, `evaluator.ts` or any lane
report. Only then read the recorded verdicts and report the two-by-two — ground truth pass or fail
against recorded pass or fail — with explicit denominators, and cases and controls separately. A
property the instrument did not execute is unobservable, not wrong: a simulator with no display
peripheral says nothing about the display, and a wording difference between the brief and the
datasheet is a brief defect for lane 29 and not a wrong answer. Ground-truth output is protected
like verifier output under AGENTS.md rule 4: the lane reports counts, check ids and instrument
identities, never an artifact, a failure location or instrument output, and never proposes any of it
for model-visible text. The decision it changes is whether the verifier's pass carries on the
target; a recorded pass the instrument fails routes to `correctness-model/evaluator.ts`, a recorded
fail it passes to `correctness-model/tasks.json` or the evaluator by the check involved, and an
absent adapter to `agent/tools-spec.json` or `environment`.

**31. Brief against the request.**

Starts from every run at every tier as a standing lane, because the Builder wrote the exam the
battery measured, and from lane 1's or lane 29's report of an obligation of the request that no
check observes.

The question is whether the public exam the Builder wrote asks what the request asks. A battery can
be valid, calibrated and hard and still measure something the operator never asked for, and nothing
upstream of this lane compares the brief with the request's own words. Begin from the request as
the served kickoff states it, and before opening the brief, list the obligations a practitioner of
that field would hold: what the deliverable must do, under which authority, against which
constraints. Then map each obligation to where the Builder published it — a `ruleDecisions` row, a
`designRuleConstants` entry, a family in `tasks.json`, an artifact-schema root — and to the check
that observes it, and read the map for three shapes. An invented rule is a duty the request never
held, so a failing battery measures the solver's reading of the author's wording rather than the
field. An excluded obligation is one the brief narrows away, whether a decision row says so or the
brief is simply silent; the contract asks that exclusions be recorded rather than silently
dropped. An inexpressible demand is one the interface makes impossible to get wrong, because a tool
or a wrapper owns the decision the request names and the artifact schema has no field for the
choice. Keep "the request's demand is not published" apart from "it is published and no check
observes it", which is lane 1's and lane 35's. Then read the authoring Epoch Reviews for the same
gaps. They run during the round, before the battery, and submit waits on `AuthoringReviews.join`
in `src/run/authoring-review.ts`, so a blocking reviewer finding about the tasks or the brief was
in front of the Builder before anything was measured; report which gaps the
reviewer named, at what severity, and what the next workspace change did with each, and treat why
advisory findings moved nothing as an open question rather than a settled cause. This lane is a
reading after the run; it proposes no reviewer or gate that runs before the battery, and no
counting rule. Report obligations and rule ids, never a reference value. The decision it changes is
whether the capability sentence may be stated in the request's terms or only the brief's; it routes
to `correctness-model/brief.json` for a rule or an exclusion, `correctness-model/tasks.json` for an
obligation no family demands, `agent/tools-spec.json` for an interface that owns the decision, and
to the Builder prompt or `starters/pi-built-harness/STARTER.md` when the same shape recurs across
domains.

**32. Judge pass decidability.**

Starts from block 2b's `CENSUS WITH DISAGREEMENT (lane 16)` beside lane 16, and from every deep
read as a standing lane, because Judge agreement is the only second opinion a battery gets.

The question is what a Judge pass actually decided. Lane 16 reads the fails; this lane reads the
passes, which are most of the Judge's output and the part a reader is tempted to count as agreement.
The Judge's census prompt (`ACTIVE_JUDGE_PROMPTS` in `src/review/judge-prompt-policy.ts`) tells it
to name a rule decided by running the output as "not decidable here" rather than pass or fail it,
and a pass rationale that says so is a partial check with a declared gap. So classify every pass
rationale from `cases/<taskId>/judge.json` into three kinds — every shown rule decided, decided with
a declared gap, or nothing stated — and report the three counts per battery and per Judge pin, since
the pins differ in how often they fail and how often they declare gaps. Then read what a Judge fail
could cite at all: `citableRules` in `src/review/judge-drivers.ts` admits the shown validity
assertions, the public rule decisions and two fixed citations, and not the original request, which
the Judge sees but cannot cite. So a Judge cannot fail an artifact for missing what the request asks
when the brief also missed it, and a Judge whose citable set converges on the checks' own rules
tests the Builder's reading twice. Agreement between the Judge and the verifier therefore does not
test for a fault both miss, and the fails lane 16 reads are a sample of what the Judge noticed, not
of false accepts. When a pass count looks low on decided rules, name the rival causes before
choosing one — the prompt's not-decidable sentence, its instruction not to fail on a rule the
material does not show, the verdict schema, whose only undecided word is `abstain`
(`src/review/judge-drivers.ts`), and the pin — and say which recorded evidence separates them.
Report counts and pass kinds; propose no counting semantics for a partial pass, which is an operator
decision still open. The decision it changes is how much weight a Judge pass may carry in the
synthesis; it routes to `judge` for the verdicts and to `controller-source`
(`src/review/judge-prompt-policy.ts`, `src/review/judge-drivers.ts`) for the prompt and the citable
set.

**33. Reference provenance and witness strength.**

Starts from every standard and deep read as a standing lane, because every admitted task's
feasibility rests on the Builder's own reference, and from row F's F2 completion.

The question is what the reference solve is, and so what its witness proves. F2 runs
`correctness-model/reference/index.ts` over every task and proves the submission path works. A
reference can compute its answer from the public input, or it can return a stored answer keyed by
task id; a lookup such as `answers[task.taskId]` or a per-task table indexed the same way passes F2
exactly as a search does. So read the reference and each helper it imports, and classify it per task
as computing, replaying or mixed, and count each kind per domain; replay is common in some domains
and rare in others, so do not generalise from one. Then compare the accept controls with the
reference output: accepts that are byte-identical to the reference output calibrate the checks only
around the Builder's own answer, whichever way they were made. Equality does not show that they were
derived from the reference, so say how they were made only where the Builder's recorded session
shows it. A witness proves a task feasible, with the optimum at or below the reference and the
reference at or below the limit; it never proves the task difficult. Whether the reference's
strength bounds the difficulty the Builder can publish is a question to settle per domain: compare
the solver's shipping margins with the reference's on the same tasks, say how often and by how much
the solver beat it, and state what that comparison can and cannot tell you about the Builder's
ceiling, since a replaying reference searched nothing and a solver beating it says only that the
stored answer was not tight. Report counts, ratios and classifications, never a reference value or a
stored answer. The decision it changes is how the synthesis reads "every task was solved"; it routes
to `correctness-model/reference/index.ts` for a reference that replays where the contract expects a
search, and to `correctness-model/controls.json` when the accepts are the reference's own output.

**34. Check mirroring in solver tools.**

Starts from every run at every tier as a standing lane, because the solver's tools are the
Builder's too, and from block 1b's `CHECK CODE IN SOLVER REACH (lane 34)` and `CHECK TOOL IN SOLVER
TRACE (lane 23)`.

The question is whether a Builder-written solver tool reports what the checks read, so that solving
becomes propose, read the failing state, adjust. Keep two things apart first. The host's own margin
table, `readMargins` (`src/solve/published-margin.ts`, called from `src/solve/built-starter.ts`),
reads every complete published boundary against a prepared answer and returns it in the
artifact-writer's text; its readings ride the trace as `details.margins`. That is controller code,
the same for every domain, and a published limit checked is legitimate solving support under rule
9. A Builder tool in `agent/tools.ts` that computes the quantity a declared check reads, over a
proposed design, and returns it with its limit is a different thing, because it lets the solver
find the check's boundary without reasoning about the field. So for each Builder tool, list which
declared checks it mirrors — same operands, same computation — and which it leaves the solver to
reason about. Then read the traces for the shape: a proposal, a reading showing a breach, an
adjustment, repeated until clear, with no derivation between readings. The shape is a lead, not a
verdict, because a capable practitioner also iterates against a calculator; the question is
whether passing still demanded a decision the tool did not supply, which lane 23 settles from the
private packet when a case needs it. Report tools, check ids and trace counts. The decision it
changes is whether a pass rate measures synthesis or search against a mirror; it routes to
`agent/tools.ts` and `agent/tools-spec.json` for a mirroring tool, and to `controller-source`
(`src/solve/published-margin.ts`) only for the host's table.

**35. Independent recomputation of passes.**

Starts from block 6b's `VERSION TOOLCHAIN DANGLING (lane 2)`, where no replay can confirm a pass,
and from block 1c's `PERFECT BATTERY OVER AIM (lane 5)`.

The question is whether a pass survives a computation the Builder did not write. Choose a bounded
sample of verified passes, weighted to the checks the request depends on, and for each recompute
the property the check claims to observe from public facts alone: the published inputs, the
accepted artifact and the domain's own authorities, with no Builder tool, no evaluator source and
no reference open. Derive first and read `evaluator.ts` only after your recomputation is written
down, so that the Builder's reading does not become yours. Prefer a structural fact you can state
in one line over a numeric re-solve. For a pin-jointed space frame whose members plus reactions
equal three times its joints (twice, in the plane), removing any one member leaves fewer bars than
the joints need, so the frame becomes a mechanism whatever its geometry, and a pass on a
member-loss check for that frame says the check observed something other than what its name
claims. Where the deciding tool's bytes are gone, say that the
recorded pass is now a claim no one can replay and that your recomputation is the only independent
reading. Report, per sampled pass, the check id, the property recomputed, and whether it held,
failed or could not be decided from public facts, as counts; never an artifact value, a reference
value or a failure location. The decision it changes is whether a verified pass may be read as the
property the check names; it routes to `correctness-model/evaluator.ts` for a check that observes
too little, and to `correctness-model/tasks.json` when the task could never fail the property.

**36. Difficulty pressure on the Builder.**

Starts from block 4b's `OFF-AIM STREAK (lane 10)`, beside lane 10.

The question is what, in this run, pressed the Builder to make the tasks harder, and whether
anything did. Only the Builder raises difficulty, and only through the tasks it writes: the
controller writes no task, and the off-aim streak is a readout fact that stops nothing, so
a product can land above the aim round after round with no controller action. Read the channels
that could have carried pressure and say what each carried: the kickoff, the system prompt's intent
clause, the round prompt's submit sentence, the climb readout and battery contract the round opened
with, `harness_trial`'s round clause, the authoring and battery reviews' findings owned by
`correctness-model/tasks.json` with their severity, the advice packet, and the Builder's own plan
and notes. Pressure can arrive and be declined on another surface's words: both 887c163ee Builders
whose lines stayed at n/n measured the solver's reach correctly, then cited the kickoff's "add no
requirement it does not name" against every stricter demand and the round prompt's "submit once a
clear preview says it works" as the user's instruction. So quote the sentence the Builder cited when
it declined, and name the surface that owns it. Then read what the Builder did: the task ids and
public-input digests that reappear unchanged across batteries, the families it named in the plan
against the families whose bytes moved, and whether an advisory `tasks.json` finding was followed
by a change to the obligation it named. Two framings may differ here — the reviewer's
orientation states the battery's placement, while the Builder's text may not name a zone at all —
so quote what each was served before comparing their responses. Whether staying easy costs a Builder
anything, and whether an advisory finding is too weak to move one, are questions to answer from
these recorded responses, not premises to start from. Do not prescribe the route, which is the
Builder's. The decision it changes is which channel, if any, should carry the pressure; it routes to
the Builder prompt or `starters/pi-built-harness/STARTER.md` for what the Builder is told, and to
`controller-source` (`src/run/climb-readout.ts`, `src/review/epoch-review-public.ts`) for what the
readout or the projection states.

**37. Battery size and probe graduation.**

Starts from every standard and deep read as a standing lane, because the size of the next battery
is decided by rules the digest does not print.

The question is how each battery's task count was chosen, and whether the rule counted what it
meant to. `batterySizingGate` (`src/run/battery-sizing.ts`) keeps a fresh product on probes of five
to ten tasks until a probe passes at least one scored case and lands at or under the aim, and then moves to the
requested size — unless the last landing read high enough that a smaller battery would still read
too easy, when `smallestSizeHoldingTooEasy` sizes it down. Three things follow that no recorded
field states. The graduation rule counts scored cases, and an unaccepted case is scored, so a probe
whose unaccepted timeouts bring it down to the aim graduates exactly as one with verified fails does.
The Builder sets `solve_minutes` in `agent/config.yaml`, anywhere down to a tenth of its default,
and a short wall produces exactly those unaccepted timeouts. And the landing is read only when the
adopted product fingerprints and its harness identity can be computed, which
`harnessBundleIdentity` cannot do when the recorded verifier environment is unreadable, so a
missing identity silently resizes the round to the requested count. Recompute each battery's size
from the rule and its inputs, since the controller records the result and not the reason, and
report each graduation with its verified passes, verified fails and unaccepted cases as three
numbers. Say whether a graduation rested on an unaccepted case, and whether the wall that produced
it was the Builder's choice. The decision it changes is how the synthesis reads the first
full-size battery; it routes to `agent/config.yaml` for the wall, and to `controller-source`
(`src/run/battery-sizing.ts`, `src/run/full-run-build-step.ts`) for the rule and its record.

**38. False rejection among verified fails.**

Starts from the digest's `FAMILY UNMOVED all-fail` rows, and from any battery with a verified fail,
which the primary opens by hand when no row fired.

The question is whether a verified fail is a wrong answer or a right one the checks refused. A
battery whose failures the synthesis reads as difficulty is only as good as the claim that each
failing artifact was wrong, and a family that fails every case round after round is the likeliest
place for a check to reject valid work. Take each verified fail in the named family, read the
public task and the failing check id, and without reading the artifact's failure location or the
verifier output, decide from public facts whether the check's rule, as the brief publishes it,
could reject a valid answer: a tolerance tighter than the published rounding, a published unit the
check reads in another unit, a rule whose text admits two readings with the check taking one. Where
public facts cannot decide, the fail stays a fail and the question goes to lane 7, which can run a
constructed valid alternative through the verifier. Report counts per check id — fails read as
wrong answers, fails whose check could reject valid work, fails public facts cannot settle — and
never an artifact, a failure location or verifier output. The decision it changes is whether an
all-fail family is read as a limit or as an evaluation defect; it routes to
`correctness-model/evaluator.ts` for the check and `correctness-model/brief.json` for the rule's
publication.

## Retired

These mechanisms have left the source or the skill, and a reader meeting one in an older archive
reads it from that archive alone: the model repair-engineer session, since the diagnosis reader and
the deterministic advice packet replaced it; the progress guard, which held promotions and has no
consumer in the loop; the judge-prompt maintainer, since the Judge framing is one file in
`src/review/`; the Judge control census and its bait subjects, since no control reaches the Judge;
the paired promotion contest, since a candidate is adopted on its own admitted battery and there is
no contest with current; the separate `DIFFICULTY.json` session and the difficulty ladder, since
there is one authoring path; controller memory curation, since `MEMORY.md` is the Builder's own and
the cap is a read cap; the cross-harness adapter and the weak-solver baseline, since a comparison
runs on one shared pack or not at all; the `climb`, `hold-limit` and `ease` actions, since
`placement.zone` already says where a battery landed; `rungPrediction`, the plan's target and its
per-task `predictions[]`, the submit hold and the off-aim allowance, since no battery ever answered
them; the saturation ledger, which read fields no difficulty decision carries; and the recurrence
reader over the notes archive, since lane 14 reads recurrence from the recorded epoch reviews and
admissions themselves.

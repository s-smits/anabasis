# Whole-run investigation review angles

This file is the whole catalogue: nine deterministic rows the primary reviewer settles itself, and
twenty-eight semantic lanes a paid session can be given, one question each. A lane is started by a
deterministic trigger, which is the capitalised text before the first colon of a line that
`digest.mjs`, `source-delta.mjs`, `walls.mjs`, `timeline.mjs`, `climb-velocity.mjs`,
`handoffs.mjs` or `gate-rent.mjs` prints, grouped by `run-overview.mjs` and rendered by `brief.mjs`. The trigger says
a lane has something to read; it does not say what the answer is, and a lane that contradicts its
trigger with evidence is a useful result. Nothing here changes a score. The verifier owns every
pass, and a lane's product is one finding with one owner, the exact evidence it cites and the
observation that would reverse it. The owner is a `FeedbackOwner` — one of the nine bundle files
of `BUNDLE_FILES` in `src/author/feedback-routing.ts`, such as `correctness-model/evaluator.ts` or
`agent/tools-spec.json`, or `environment` — when the Builder can repair it, and a named controller
source file when it cannot. Lanes 7 and 23 are
isolated and never share a session with another lane.

Each lane body opens with one paragraph beginning `Starts from`, which the manifest carries
verbatim as the lane's trigger; the rows have none, because nothing starts them. The lanes are
grouped by the question they share — product validity, difficulty, calibration, the review loop,
hand-offs and attribution, the solver's own time and failure, and the gate itself — and a lane's neighbours are
named inside its body where one hands to the next.

## Deterministic rows A–I

The primary reviewer settles these from the recorded bytes before any lane is launched, and never
delegates them: they are the identities every lane's finding is bound to, so a lane that reads
them again is spending on a join that was already made.

**A. campaign identity.** Begin with the requested run's `controller/<runId>/opening.json`
(`campaign-opening/v2`). Bind its full source commit, source digest and dirty disclosure to the
exact review worktree path and HEAD, and bind the run id and opening digest beside them; when that
source object cannot be resolved, return `source-unresolved` rather than substituting the current
checkout, main or a neighbouring run. The opening binds a request digest, not the prompt text, so a
session that quotes the prompt has answered a different question. Report the three model slots as
three values with their provenance — an environment override, an admitted config file or the
default — because a missing provenance is an evidence gap and never permission to infer the pin
from the model name a trace mentions. `budget.json` binds the ledger's database identity, and
`epochs.json` names the epoch the run is in; the terminal evidence names the opening epoch, so a
reader joining through the terminal can land on the epoch holding almost none of the work. Every
projection (`default`, `--scan`, `--scorecard`, `--cases --result <kind>`) must describe this same
run, and two projections disagreeing is itself the finding. `--scan` reports and never gates, so a
warning there is a question rather than a verdict.

**B. claim and promotion state.** Read `claims/<runId>-*.json` and `promotions/<runId>.json`
(`product-promotion/v1`). A promotion row carries `decision: "promoted" | "held"` and no
comparison: there is no contest between a candidate and the current harness, and a held row names
its clauses — `candidate-unmeasured`, `candidate-zero-verified`, `candidate-task-set-unbound`,
`candidate-evaluator-unbound`, `stale-task-identity`, `candidate-fingerprint-drift`
(`src/run/candidate-promotion.ts`). The first admitted build has nothing to replace, so
`selectInitialProduct` in `src/run/product-versions.ts` selects it at adoption, before its battery,
under a ledger decision `initial-<id>` with `initial-product/v1` evidence; the version itself sits
at `versions/<id>/` with a `product-version/v1` manifest in `version.json`. A missing or refused
claim is not success, and a clause contradicted by its own cited rows is a defect in the clause.
What the claim honestly discloses is correct behaviour: a disclosed `modelIdentity` limit is a
limit, not a defect, and a `judgeDecision` of `non-result` or `no-battery-verdicts` is rule 9
working. Join across an epoch boundary on the recorded bundle or `taskSetHash`, never on the epoch
name.

**C. workspace and Git.** Check that a fresh workspace committed the starter package and that each
completed change describes the tree it actually produced. `workspaceChange` names base, child,
`changedPaths` and `deletedPaths`; a predecessor, when present, equals this base, and Git ancestry
must agree. A deleted path has to be absent from the child tree, not merely listed. A resumed
workspace is `N/A` for the starter commit, not `fail`. A change record can pass as a Git claim
while failing as a description of what was built, so compare the committed bundle bytes against
the fingerprint before calling the evidence complete.

**D. static conformance.** Does the candidate bundle satisfy the contract it declares? Read the
record findings, the iteration outcome and `conformance.json` (`tool-conformance/v4`).
Conformance binds the tool specification, task set, public artifact schema and generated-worker
identities together, so a bundle passing three of four is failing, and a step whose named content
survives in no preserved artifact is unverifiable, which is not a pass by absence. Public compiler
and generated-module diagnostics describe the authoring interface and may be quoted; verifier
internals may not. Conformance must open every task and require one stable worker registration
and tool schema across the whole battery. It does not stand in for lane 1's representation
question, which is whether a valid artifact the writer cannot express, or one the verifier reads
differently from the writer, exists at all.

**E. fingerprint and gate census.** The fingerprint binds exactly the agent, correctness-model and
task-set hashes, in both directions: nothing extra, nothing absent. `submit` and
`correctness_check` freeze one immutable snapshot (`src/author/candidate-check.ts`), fingerprint
it, and validate every later stage from that snapshot rather than from the workspace; the
`snapshotId` and `engineCondition` together form the `conditionKey` a cached verdict is served
under, so the same snapshot over different installed tools is a different condition. Check the
fingerprint against the tree the gates actually read, through that snapshot. The census
(`census.json`, gate path only) needs exactly one `control-receipt/v2` receipt per declared
accept and reject control (`src/truth/control-receipts.ts`): join `controlId`, task, kind and
expected check to the recorded corpus, keep non-results in that denominator, and read a
missing, duplicate, extra or foreign receipt as a census failure. A census that failed for a
non-blocking finding is a defect in the gate, not in the bundle. This is the gate census; the
Judge battery census belongs to lane 16.

**F. F2 solvability.** Did solvability settle for every authored task? Read `solvability.json`,
and each graded case's `cases/<taskId>/verifier.json`, whose `checkReceipts` name every declared
check that fired (`src/truth/verification-runner.ts`). F2 runs every task's reference solve
through the public writer, DraftStore and submit path the live solver uses, and what it proves is
the submission path, not end-user correctness. Report completed, unsettled and non-result counts
separately: `evidence: null` with no cases means F2 never executed, which leaves the tasks
unsettled rather than failed. A task no reference path can solve is a defect in the harness, not
a hard task, and it poisons the denominator it sits in. When the census and F2 share one typed
verifier non-result, report it once with one owner. A controller deadline reached before the
generated-tool worker is ready is a host non-result; a worker that answered its handshake and then
broke its protocol is a representation defect.

**G. case partition.** Graded, unaccepted and typed non-result counts form one complete, exclusive
partition of `case-record.jsonl` through the shared classifier in `src/claim/case-record.ts`, with
`truthOk` and `pass` left `null` where unknown. Only verified cases enter a capability rate; zero
verified cases give an operational result and no capability result at all; an entirely unaccepted
battery is placed nowhere. Say whether an unaccepted submit sits inside or outside each
denominator and name the owner of that answer. Join each admitted battery to its own
`battery.json` through `readBatteryJoinSlice` (`src/truth/battery-record.ts`): `skipped-precase`
is the only recorded zero-row disposition, an absent record is absent evidence, and a
recorded-count against record-count mismatch is a refusal. Zero cases are not a zero capability
rate. The partition can be perfect on measured cases while the same rule is violated upstream in
authoring: a provider refusal arriving as a successful turn's prose is a non-result wearing a
capability finding's clothes, so when many iterations share one findings hash, read the
observability log for refusal prose before accepting the capability reading.

**H. runtime identity and isolation.** Every case is bound to the model, runtime and sandbox the
claim names. Sha-check `traces[].sha256` against the trace files rather than trusting the
pointers. The isolation executes one physical refusal probe per measure invocation and copies the
identical probe object into every record row, so one shared `confinedPid` across rows is the
probe's pid and the per-case worker pids live in each case's `built-runtime.json`; report the
isolation as N rows under one proven `policyHash`, not N independent refusal proofs. Then keep
two facts apart: who installed the tool and what the host attested it ran. Every tool run records
its `source` — `workspace-toolchain` or `host` — its `digest`, its `kind` (`binary` or `script`)
and, for a script, the `interpreter` and where found the `interpreterDigest` and `packages`
beside it (`src/verify/tool-inventory.ts`, `ToolEntry` in `src/verify/verifier-port.ts`); the
claim carries the same rows as `verifierTools[]` under one `verifierEnvironmentHash`. Scope the
capability sentence by that: a compiler the Builder installed under `.toolchain` is Builder
provenance, and passing the digest and argument checks does not make it independent. A
`kind: "script"` entry says the digest binds a wrapper, and lane 2 owns what the wrapper ran.

**I. served-model attestation.** Is the model each case reports the one that served it, as a
host-recorded attestation rather than the configured pin echoed back? Read `battery.json`
`cases[].solver.runtimeIdentities[]` (`runtime-model-identity/v2`) beside the opening's Built pin
and digest block 5b. A row carrying the provider's `resultId` is an attestation; a row without one
is an echo. Read the block's three counts separately: attested rows, unattested rows and rows with
no completed turn, since a non-result before the first turn attests nothing. A served model that
differs from the pin is `SERVED MODEL MISMATCH` and blocks the condition sentence. An unattested
row under a completed turn is an instrumentation gap: report `unproven identity` and keep the
case's kind, because an unproven served-model identity refuses the identity claim and nothing
else. Do not read model names out of trace prose.

## Semantic lanes 1–28

**1. Request-to-verdict chain.**

Starts from block 1's tool column reading `in-process` for a check the request's subsystem needs,
and from any artifact-schema root or declared public input that no applicable check reads.

The question is what the verdict observes. Follow the original request to the accepted artifact,
to the deciding operation — a compile, a host double, target execution, physical hardware — and
keep those four scopes apart, because a narrower observed scope does not fulfil a broader
obligation the request names. The shape to look for is a Builder-authored host double standing in
for the hardware the request is about: a check whose `evidence.kind` is `authored`, running the
artifact against a stub of the target's own library, verifies the Builder's published arithmetic
and can invert the hardware's semantics while passing — a rule demanding one bus transaction per
changed text that no real display driver would satisfy, or a published converter resolution the
installed core does not default to, so the artifact reads a factor off on a board and passes
because the double feeds it raw counts. Read `correctness-model/brief.json` (each check's
`evidence.kind` and `execution.requiredToolIds`), `evaluator.ts` and its imports, and the checks'
`checkReceipts` in each `verifier.json`. Do not quote verifier stdout, and do not decide
independence, which lane 2 owns. The decision it changes is whether the capability sentence may
name the request's subsystem at all; it routes to `correctness-model` for the check, `brief` when
the publication is at fault, and to the Builder prompt or `starters/pi-built-harness/STARTER.md`
when the double recurs across domains.

**2. Executable verifier dependency closure.**

Starts from block 6b's `VERSION TOOLCHAIN IS A SYMLINK (lane 2)`, `VERSION TOOLCHAIN DANGLING
(lane 2)` and `WRAPPER-ONLY TOOL DIGEST (lane 2)`, and from any `external` check whose
`verifierTools[]` entry is `kind: "script"`.

The question is which bytes and runtime facts actually decided the verdict, and whether the
review can see them. Start from one recorded external operation and trace its deciding chain:
selected command, wrapper, interpreter, imports, flags, configuration, environment and runtime
assets, comparing the host-attested inputs and executable identity with what execution really
consumed. A `kind: "script"` entry binds a shell wrapper's bytes, so read its `interpreter`,
`interpreterDigest` and `packages` (`ToolEntry`, `src/verify/verifier-port.ts`) and say what the
digest covers and what it leaves unhashed; a compile step whose cores are never hashed is one of
these, and a Builder algorithm run through a hashed interpreter is authored computation still.
Then retention: a version's `.toolchain` is created by `linkWorkspaceToolTree`
(`src/claim/bundle-snapshot.ts`) as a symlink into the epoch workspace, so the retained product's
tools are mutable and a workspace that has since moved leaves the link dangling; say whether the
version the battery measured still resolves the bytes the claim hashed. Read the claim's
`verifierTools[]` and `verifierEnvironmentHash`, the recorded tool runs, `versions/<id>/version.json`
and its `.toolchain` without following the link. Do not treat provenance alone as independence or
as a defect, and do not repeat row H's tallies. The decision it changes is the claim the unobserved
or candidate-controlled edge limits; it routes to `correctness-model` for a check that should
declare the deciding tool, and the retention defect to `src/claim/bundle-snapshot.ts` and
`src/run/product-versions.ts`.

**3. Authoring-to-host contract compatibility.**

Starts from block 2's refusal ledger showing a gate refusal on bytes a `correctness_check` had
just cleared, from row F's host non-result before a generated-tool worker was ready, and from a
source delta touching `src/solve`.

The question is whether a check written against the public authoring interface can execute
through the real host contract. Follow one consequential request across the public types and
examples, the generated check, the projection, the tool input binding, the worker transport, the
wall and the host result, selecting one legitimate use and its nearest forbidden counterpart. Read
`conformance.json` (`tool-conformance/v4`), the gate findings, `agent/config.yaml` (`tool_run_seconds`, `check_seconds`) and the worker's
handshake evidence. Separate a valid boundary refusing unsupported work from incompatible
producer and consumer contracts and from an interface refusal whose public explanation was lost. A
passing runtime double proves only that double's contract; prefer an existing real-host probe, and
where a new scratch probe needs authority, give the primary the bounded test and mark it
unexecuted. Do not widen private-input access, relax the wall or forward raw verifier exceptions
to make an example work. The decision it changes is which of two individually valid interfaces is
repaired; it routes to `tools-spec` for the declared side and to `src/solve/` and `src/gate/` for
the host side.

**4. Operating guide and roster truth.**

Starts from a solve trace calling a tool the closed roster does not declare, from an operating
guide naming one, and from a tool payload whose return names the value a check will read.

The question is whether the guide, the tool descriptions and the tool payloads tell the solver the
truth about the roster and the walls. `agent/BUILT_AGENTS.md` naming a tool `tools-spec.json` does
not declare sends the solver after a call it cannot make, and a `presets` field may carry neither
`files` nor `shell`, so read the roster the Built prompt derived before charging a missing call to the solver. A payload that hands
over a decision — admissible values per role, the argmax of a published function — is a publication
question for lane 8, but the payload's `text` against its `details` is this lane's: every promised
value belongs in `text`, and a tool whose result drops bytes must say where the rest is. Read
`agent/tools-spec.json`, `agent/tools.ts`, `agent/BUILT_AGENTS.md`, `agent/config.yaml` and the
traces' tool calls. Do not read the trace for derivation, which lane 23 owns. The decision it
changes is whether a failed call is the solver's or the guide's; it routes to `instructions` for
the guide and `tools-spec` for the declaration or the payload.

**5. Limit slack against the reference.**

Starts from block 1c's `PERFECT BATTERY OVER AIM (lane 5)`, from block 1's `UNTRIPPED IN
SHIPPING`, and from any block 4b placement whose zone is over the aim.

The question is why the battery reads n of n, and the first mechanism to test is a published limit
anchored to the Builder's own reference: a mass budget derived at a fixed ratio above the reference
design, a deflection limit at a fixed multiple of the reference deflection, so that the solver's
shipping value sits far inside every boundary and a design substantially heavier would still pass.
Read `tasks.json`, `correctness-model/reference/index.ts`, the accept controls in `controls.json`,
the shipping artifacts and the difficulty decision's placement, and compute for each shipping case
the ratio of its value to every published limit. Say which way the recorded margins point before
calling a limit a defect: a limit set at the author's reference measures that reference search,
which is usually looser than a capable solver, and the remedy is a stronger reference search rather
than a limit set independently of the reference, since adoption solves every task with that
reference. Do not read verifier stdout or per-task failure locations, and do not construct
alternatives, which lane 7 does alone. The decision it changes is the next round's operation, a
task probe that tightens, routed to `tests` and `accept-controls`.

**6. Check discrimination and binding.**

Starts from block 1c's `REACH-ONLY CHECKS (lane 6)` and block 1's `UNTRIPPED IN SHIPPING`.

The question is whether each check can fail on a shipping artifact at all. Two mechanisms recur:
reject controls that reach only where shipping never goes, which is what `UNTRIPPED IN SHIPPING`
counts, and a label or id a check cannot bind to the geometry it is meant to constrain, so a
deliverable root can be replaced without moving the verdict. Read the claim's
`externalCheckCoverage` (host-attested launches and reject controls per check-and-tool pair),
`controls.json` beside `tasks.json`, the `checkReceipts` of each shipping `verifier.json`, and the
Epoch Reviewer's `probe_check` rows, whose `probeIds` say which checks moved when one artifact path
was changed. A reject built from the same task's accept with one fact changed is the calibration
the contract asks for, and a reject that fails elsewhere but not on its named check provides no
discrimination evidence. Do not read counterexamples or verifier stdout. The decision it changes
is whether a check counts as material before paid measurement; it routes to `controls` for the
reject corpus and `correctness-model` for a check that cannot bind.

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
separately, naming the boundary that rejects each alternative. Revisit the validity argument where
the public requirement is ambiguous; the test may be wrong. Do not share a session, and do not
read a false rejection as a rescore. The decision it changes is the discrimination claim; it
routes to `correctness-model` for the check and `controls` for the missing accept.

**8. Public disclosure and one-recipe.**

Starts from a battery where every case passed in one turn at a small share of the wall, from a
trace telemetry whose call sequences are constant across cases, and from a placement over the aim
with a rehearsal that `passedInOneTurn`.

The question is whether the brief and the tools publish a sufficient construction algorithm, so
that a careful reader transcribes the answer rather than searching for it. The shape is a
publication ceiling breached: a brief publishing an exact formula for every function and a stated
argmax for every choice, a tool payload naming the admissible values per role, an operating guide
listing the calls the answer must make, the tasks differing only in the numbers carried through.
The public validity relation — requirements, constraints, precedence, closed value sets, constants,
authorities and declared runtime facts — must stay public; what is withheld is the search order,
allocation recipe, fallback chain, derivation and hidden tie-break, across everything the solver
can read together. Read `brief.json` (`ruleDecisions` public rows, `designRuleConstants`), the
artifact schema, `agent/BUILT_AGENTS.md`, every tool description and payload, and the telemetry's
distinct sequence count. Do not open the private packet, which lane 23 owns. The decision it
changes is what the brief withholds; it routes to `brief` for the rule rows, `tools-spec` for a
payload and `instructions` for the guide.

**9. Rehearsal instrument reach.**

Starts from block 6's `REHEARSAL NOT-RUN (lane 9)`.

The question is which families the rehearsal instrument could grade at all. `harness_trial`
(`src/builder/harness-trial.ts`) solves one task blind with the measured Built solver and grades
it through `rehearseCase` in `src/truth/solve-case.ts` under the harness's own `check_seconds`
and `tool_run_seconds` from `agent/config.yaml`, the walls the battery grades under. A run recorded
before that change graded under a fixed 30-second total instead, so there a family whose check
compiles for longer returns `not-run` however the solver did, and the one instrument meant to
catch a too-easy battery before payment could grade only the fast families. Read each
`customCalls[]` row with `tool: "harness_trial"` in `builder-execution*.json` for its
`target.taskId` and `semantic.truthVerdict`, the family of each target, the compile and tool-run
durations in the graded battery's `verifier.json`, and the harness's declared walls. A `not-run`
whose row reason is a provider allowance is lane 24's. Do not read per-check results, which the
instrument withholds by design. The decision it changes is whether rehearsal evidence covers the
families the target is about; it routes to `src/truth/solve-case.ts` when the deadline is the
limit and to `instructions` when the guide sends the solver into work the rehearsal cannot grade.

**10. Difficulty calibration loop.**

Starts from block 4b's `OFF-AIM STREAK (lane 10)` and `TARGET MISSED (lane 10)`, from the
calibration table the `handoff` lane prints, and from the `climb` lane's edge labels.

The question is whether the Builder's prediction gets better round over round. Each accepted
submit carries an `experimentProposal`, and `EXPERIMENT.json` declares `target{comparator,
verifiedPasses}`, `families[]` with a level and move each, and per-task `predictions[]`
(`src/author/experiment-plan.ts`). Each battery's `difficulty-decisions/<runId>-<digest>.json`
(`difficulty-decision/v7`) records the `ClimbReadout`: `placement.zone`, `aim`, `toAim`, the
Wilson interval, the target's `result` and `missedBy`, and the `allowance` with its `rounds` and
`side`. The battery contract's own sentences are `FRAME` in `src/run/climb-readout-frame.ts`, so
compare per round, in claim `createdAt` order, the counts the Builder was told (first battery,
no-limit, aim), the comparator and count it declared, and the count it measured, and say whether
the error closes. A target above the aim is a choice the placement reads as over-aim; a met target
on an unchanged public task set predicts a repeat, not a harder battery; and a streak counts
consecutive rounds on one side of the aim, so say which side and whether the
comparator named it. Do not prescribe the route, which is the Builder's. The decision it changes
is the next round's comparator; it routes to the Builder prompt when the counts were not stated
and to `tests` when the task set did not move.

**11. Submit decision against rehearsal evidence.**

Starts from block 6's `SUBMITTED BYTES NEVER REHEARSED (lane 11)` and `REHEARSAL CONTRADICTS
TARGET (lane 11)`, and from the `yield` lane's `harness-trial` component.

The question is what the Builder did with each rehearsal verdict before it submitted. Each
`harness_trial` row's `semantic` carries `truthVerdict`, `turns`, `submitted` and `candidateId`,
and the accepted submit's own `candidateId` is the join: a submit whose candidate no rehearsal
graded was calibrated from belief, and a Builder whose `MEMORY.md` says the battery is untested
against the solver has said so itself. A `pass` on the submitted bytes for a task the plan's
`predictions[]` put at fail, or passes already at an `at-most` count, contradicts the target before
the battery was paid for. Read the `customCalls[]` and `submits[]` of each `builder-execution*.json`
in turn order, the `rehearsals/rehearsal-<n>/` evidence, and `builder-path-record.jsonl` for
whether the rehearsal traces the `context` tool offers were opened before the proposal was
written. Do not charge a `not-run` to the Builder, which lane 9 owns. The decision it changes is
whether rehearsal enters the plan at all; it routes to the Builder prompt or the starter when the
Builder was not told to rehearse the bytes it submits.

**12. Epoch Reviewer standing duties.**

Starts from the `yield` lane's `epoch-reviewer` component, from a review whose `coverage.missing`
names a file the seed had, and from a placement over the aim beside a review that named no
over-published surface.

The question is whether each standing duty in the reviewer prompt fired before a new duty is
proposed. The prompt in `src/review/epoch-review-prompt.ts` asks the reviewer to read the
publication ceiling every time and to record which decision it would have kept private, and to run
at most eight `probe_check` executions, so a review that found the battery over the aim and named
no over-published surface either declined that duty or found it met, and its `report` says which.
Then read the reviews the controller labelled: an authoring review taken before the first task
write reads the seed's empty `tasks.json`, `publicTaskRows` throws through `capturedBattery`
(`src/run/experiment-freeze.ts`), and `src/review/epoch-reviewer.ts` records the file under
`coverage.missing`, so the early reviews carry `incomplete` for a file that was in their reads;
nothing was authored, so no finding was missed, and the defect is the label. Read
`analysis/<runId>-epoch-review.json` (`epoch-review/v5`), the review files timed by their UUIDv7
names, and the orientation `placeOnBand` gave the reviewer. Do not read the reviewer's claim text
as a finding. The decision it changes is the reviewer prompt and the coverage label, both owned by
`src/review/`; this lane selects no `FeedbackOwner`.

**13. Public-safe feedback sufficiency.**

Starts from a defect finding admitted in one round whose named
gap the next round's bytes did not touch, from an ambiguous repeated repair, and from a source
delta touching `src/review/epoch-review-public.ts`.

The question is whether the model-visible projection kept the permitted information needed to act.
Derive the allowed public facts from the measured contract before reading what the projection
drops, then follow one consequential finding from `epoch-review/v5` through `publicAct`
(`src/review/epoch-review-public.ts`) into the served kickoff prompt (`prompt-ingested`, role
`builder`, in `observability/<runId>.jsonl`). For a defect owned by `correctness-model/tasks.json`
the projection is one fixed
sentence asking that the fresh battery's tasks differ in what they demand of the named
`publicInputPath`, so a concrete gap — no task with a reversed load case, no limit that binds —
reaches the Builder as a template; read whether the Builder's own notes recorded the gap
independently, because that is the evidence the projection bought nothing. Compare two
legitimately different public situations and ask whether the recipient would see their deciding
difference, distinguishing lost public meaning, a wrong public label, deliberate protected
withholding and an inherently unobservable distinction. Keep verifier explanations, counterexamples
and failure locations out of every proposed message. The decision it changes is the smallest
correction at the projection owner, `src/review/epoch-review-public.ts`; this lane selects no
`FeedbackOwner`.

**14. Finding routing and recurrence.**

Starts from block 4d's `FINDINGS WITHOUT OWNER (lane 14)` and `ADVISORY FINDING RECURS
UNROUTED (lane 14)`, and from the `yield` lane's `epoch-reviewer` component.

The question is what each finding became: finding, admission, owner, then next-round bytes. A
finding whose owner is on the agent side is admitted advisory on its first occurrence and blocking
only on a probe-backed demonstration or a recurrence keyed by its `checkId` or `schemaPath`
(`src/review/epoch-review-findings.ts`), and a `schemaPath` must sit below a declared root, since
a bare root collapses every finding in a one-root domain to one identity. So a reviewer that
records the same finding each round without a probe or an identity is a channel that never becomes
a route: say whether the recurrence key could have fired and, if it could not, whether the finding
named an identity at all. Recurrence is read from the recorded epoch reviews and admissions
themselves, in review order, and nowhere else. Read `analysis/<runId>-epoch-review.json` (kind,
owner, `checkId`, `schemaPath`, severity, `probeIds`), `analysis/<runId>-admission.json`
(`repair-agenda/v1`, with its `no-feedback`, `agenda-consumed` and
`evaluation-identity-unadopted` reasons), and the next epoch's `workspaceChange`. Do not rescore,
and do not propose a route that carries verifier detail. The decision it changes is the admission
projection, owned by `src/run/admission.ts` and `src/review/epoch-review-findings.ts`; the routed
finding itself keeps the owner it named.

**15. Harness-versus-evaluation triage hand-off.**

Starts from the triage table the `handoff` lane prints, from any advice issue with a count, and
from a completed epoch review beside a failing family.

The question is whether the diagnosis, the Epoch Reviewer and the advice packet agreed on which side
owned a failing family, and whether the successor repaired that side. Read the advice packet's
issues (`lastSeenRunId`, state, `dispute`), the diagnosis reading (`diagnosis-reading/v3`,
`src/review/diagnosis-reader.ts`) with its owner, cause, cited `boundary` and `falsifier`, the
battery's `-epoch-review.json` findings, `probeIds` and `disputes`, the successor's decision-row
`operation`, and the reviews timed by their UUIDv7 names. Per failing family report the diagnosis's
owner and cause and whether the reviewer recorded a defect, whether the reviewer disputed the issue
or showed through `probe_check` a changed value that moved no check, whether the packet withheld the
agent advice for a disputed issue, and whether the successor's attributed operation repaired the
named side; then time it, from the first failing battery to the first evaluation-side review. A
probe that moved no check is a lead to a loose check, not proof of one, and a task probe repairs
neither side. Do not read the failed traces, which lane 25 owns. The decision it changes is which
side the next round reopens; it routes to `correctness-model/evaluator.ts` or
`correctness-model/controls.json` when the evaluation side was named and never repaired, and to
`src/author/rebuild-advice.ts` when the packet dropped the side.

**16. Judge disagreement adjudication.**

Starts from block 2b's `CENSUS WITH DISAGREEMENT (lane 16)`.

The question is whether a Judge fail on a verifier pass is a Judge error or a verifier defect. A
Judge fail must cite a verbatim public rule, an uncited fail is a protocol non-result, and a cited
fail of a verifier pass is a veto bounded by `verifierPassJudgeFail` and re-sampled once
(`src/claim/judge.ts`: `offered`, `verdicts`, `abstentions`, `vetoed`). Read
`analysis/<runId>-judges.json` for the cited rule and the artifact, and settle the disagreement by
reading the artifact against that rule yourself: the common case is a Judge miscount of a public
rule, and an advice issue still carrying a settled miscount as `judge-failed-verifier-passed` is
noise to name. The other case, a cited rule the artifact really breaks under a verifier pass, is a
reason to inspect the check, which lane 6 owns. Read the Judge framing in
`src/truth/judge-framing.ts` and `src/analyse/judge-contested.ts` for what the Judge saw. Do not
rescore and do not compare two artifacts. The decision it changes is whether the veto reaches the
Builder as a count and family; it routes to `correctness-model` for a real defect and to
`src/author/rebuild-advice.ts` for a miscount kept as advice.

**17. Round hand-off census.**

Starts from the census table the `handoff` lane prints, on a run with two or more authoring
rounds.

The question is which of the channels one round hands the next were present, served, read back and
acted on. The channels are the round facts, the climb readout and battery contract (`FRAME`), the
rebuild advice packet, the Epoch Reviewer's public projection, diagnosis issues, `EXPERIMENT.json`,
memory notes, the `context` tool, and the solver traces and rehearsals it offers. Read the full
Builder kickoff in `observability/<runId>.jsonl` (`prompt-ingested`, role `builder`), each epoch's
`builder-path-record.jsonl` and `builder-execution*.json` custom calls, and
`analysis/<runId>-{rebuild-advice,diagnoses,epoch-review}.json`. Read-back means a tool call that
opened or queried the channel; prompt text in context is served, not read. The round facts, the
advice packet, the diagnosis and the review projection have no re-query channel, so an unread one
is structural rather than a Builder choice, and a file opened through `bash` records only its
working directory. For every channel served and never read, name the cheapest alternative — drop
it, move it to a `harness_inspect` mode, or state it where the decision is taken — and the
observation that would show it mattered. The decision it changes is the kickoff prompt's contents,
owned by `src/author/builder-continuation.ts`; lane 14 owns whether the right owner received a
packet and lane 26 owns memory.

**18. Same-task repair measurement.**

Starts from the same-task table the `handoff` lane prints, on two consecutive batteries with an
advice packet between them.

The question is whether an issue's `tentatively-fixed`, `confirmed-fixed` or `retired` rests on a
comparison of task identity or of family names alone. Read each battery's
`cases/*/public-task.json` digested over the public input, the consecutive
`analysis/<runId>-rebuild-advice.json` packets, and `deriveRebuildAdvice` in
`src/author/rebuild-advice.ts`, whose `advanceIssues` keys every issue with `adviceIssueId`. Join
per family before and after each repair and classify it `identical-tasks`, `partially-shared` or
`name-only`, or absent on one side, counting inputs that reappear under another family name.
Report every issue-state transition and flag those resting on a name-only or absent join: renaming
every family retires every issue without a fixed task being measured again, and `retired` proves no
fix. Say whether the producer keys on task identity or family name by recomputing the recorded
issue ids. Do not read what the task change means for difficulty, which lane 20 owns. The decision
it changes is whether an issue state may be cited as a fix; it routes to `src/author/rebuild-advice.ts`
for the key and to `tests` when the fixed task was never measured again.

**19. Semantic repair closure.**

Starts from a repair proposal or an accepted successor, from a defect that recurs under a new id,
and from a claimed review benefit.

The question is whether the accepted successor resolved the defect that prompted the repair.
Follow one consequential obligation and its falsifier through the finding, the permitted public
projection, the proposal, the rejected revisions, the final accepted bytes and the next eligible
measurement, using the first repair and a later recurrence where they distinguish explanations.
Classify a demonstrated repair, a partial repair, a neighbouring change, an honest scope narrowing,
removal of the challenge, a recurrence and an unmeasured outcome separately. A common check id, a
changed file, a consumed packet or a better score cannot establish defect continuity, and where
distinct defects share a public location that is the counterexample to an identity-only join. A
deleted control may be a correction or a loss of challenge; decide from the public obligation and
the realised verifier. Read `EXPERIMENT.json`, the successor's `workspaceChange`, the advice
issue's state and `lastSeenRunId`, and the successor battery's `checkReceipts`. Keep protected
repair evidence private. The decision it changes is whether a repair may be reported as closed; it
routes to the owner the original finding named, and to `tests` when the next measurement
opportunity was missing.

**20. Task movement and attribution.**

Starts from block 3c's `REPEATED CONDITION (lane 20)` and from the `climb` lane's edge labels
(`restated`, `adjusted`, `narrowed`, `widened`, `eased`, `escalated`, `replaced`).

The question is what changed between rounds, whether the accepted bytes match the declared
`EXPERIMENT.json` scope, and whether the numbers moved without changing what a solver must reason
about. Read consecutive `versions/<id>/` bundles, each battery's `public-task.json` digests, the
decision rows' `operation` from `src/gate/experiment-admission.ts` — `task-probe`,
`harness-intervention`, `evaluation-correction`, `repeat`, `new-baseline`, decided by which of
`agentHash`, `correctnessModelHash`, `scoringHash` and `taskSetHash` moved — and the plan's
declared `scope`. Attribution follows accepted bytes and never the plan's name: a plan declaring
`tasks` whose bytes moved the evaluator receives build attribution. `adjusted` deliberately states no direction, because a moved limit
is a climb only when it moves inward, and the difficulty decision's `allowance.sameSchema` counts
rounds that re-posed the same public schemas under new values. Do not read a new hash, id, family
name or longer description as a harder problem; the Builder names the public requirement that
changed and the reasoning interaction it adds, or the change is coverage. The decision it changes
is the attribution and the refusal of a repeated condition; it routes to `tests`, `controls` and
`correctness-model` by which bytes moved.

**21. Source-delta reach.**

Starts from source-delta's `UNREACHED CHANGED SAFEGUARDS (lane 21)` and `MODEL-VISIBLE SURFACE
CHANGED (lane 21)`.

The question is whether the source that changed between the previous run and this one actually
executed, which decides whether a fix is live-exercised on this run or only present in source.
Read `source-delta.mjs` output — changed files by top directory, the `safeguardTriggered("id")`
calls in changed files joined to `campaigns/<slug>/safeguards/<runId>/SAFEGUARDS_LOG.txt`, and
the model-visible text changes — against this opening's `source.commit` and the previous run's.
For each unreached changed path decide: no opportunity on this run, opportunity present but the
branch not taken, or the branch taken without its sensor, remembering that a safeguard is a
log-only sensor and never changes a kind or a route. A changed model-visible surface is a changed
condition: two runs across it are two conditions, and the prompt digests in the openings say so.
Report the changed paths that were live-exercised, the ones that were not, and the one next-run
condition that would exercise the rest. The decision it changes is the evidence level a fix may be
reported at; it routes to the changed file's owner and selects no `FeedbackOwner`.

**22. Solver process and walls.**

Starts from the `walls` lane's `time-bound`, `turn-bound` and `submitted` rows against a wall
share, and from block 1b's `CHECK TOOL IN SOLVER TRACE (lane 23)` read as a lead.

The question is how the solver spent its walls. `agent/config.yaml` owns `solve_minutes`,
`max_turns`, `shell_timeout_seconds` and `shell_timeout_max_seconds` (`src/truth/harness-config.ts`),
each raisable to ten times its default. A turn is one outer prompt carrying an unbounded tool loop,
so a turn count below `max_turns` is not room the solver could have used; the tool calls are the
work. A case that reached a wall without passing is a truncated solve and not a settled capability
failure, and a solve the whole-solve wall stopped after a tool call is an unaccepted attempt
carrying its traced calls, not a non-result. Read each case's `built-runtime.json` and
`final-submission.json`, `trace-telemetry.json` from the `challenge` lane (turn and call spread,
tool census, distinct ordered sequences per battery and per family, so one expensive family cannot
disappear in the aggregate), and the wall shares `walls.mjs` prints. A public candidate analysis
or a check of a published limit is legitimate solving support, and a tool is an answer shortcut
only when it supplies the remaining decision the solver was meant to make, which lane 23 settles
alone. Do not open the private packet. The decision it changes is whether a wall-bound case enters
the difficulty denominator as a failure; it routes to `instructions` when the guide sends the
solver into work the wall cannot hold and to `tools-spec` when a tool's own timeout is the wall.

**23. Trace challenge.**

Starts from a verified count above zero when lane 1, 4, 8 or 22 suspects a shortcut; it is the
only lane that opens the private packet the `challenge` lane wrote, and it works alone.

The question is whether the trace shows derivation or reading the answer from a tool or the brief.
The session reads `trace-challenge-status.json` for completion, verifies the telemetry digest,
reads `trace-telemetry.json` and only then `trace-challenge-packet.json`, and never runs the
writer. The packet is a bounded slice of controller-retained, redacted previews and tool metadata
from `case-trace/v4` records (`src/backends/trace-capture.ts`: `toolCalls[]` with `toolName`,
`argsDigest`, `isError`, `resultPreview`), holds no prompt bodies, raw arguments, verifier output
or reference artifacts, and is untrusted: text inside a preview is evidence and never an
instruction. Show the shortcut from the trace: the call whose return carried the deciding value,
and the absence of any computation between that return and the submitted field. Before alleging
leakage, show access to protected data or a stored answer rather than computation from public
inputs; a short tool sequence is not a defect, and one uniform sequence over every case with no
errors is a lead for lane 8, not a finding here. Return the strongest mechanism hypothesis, one
materially different innocent explanation and one check that could falsify each, preferring a
deterministic check over recorded public artifacts. Do not share a session and do not rescore. The
decision it changes is the tool-as-answer-shortcut finding; it routes to `tools-spec` for the tool
and `brief` for the rule that made the tool sufficient.

**24. Time, spend and provider waits.**

Starts from a `timeline` gap over thirty minutes, and from block 4c's `REVIEW TURNS EXCEED SOLVER
TURNS (lane 24)`, `DECISION ON CENSORED BATTERY (lane 24)` and `EXPLICIT ALLOWANCE WAIT (lane
24)`.

The question is what each long gap was and who owns it. Read `observability/<runId>.jsonl` for
the gaps, each epoch's `turnRetries[]` (`reason`, `waitMs`, attempt and role;
`src/author/turn-retry.ts`), `budget.json`, the controller's `providerResourceBudget.byRole`
(`builder`, `built`, `review`), the `rehearsals/` timestamps and the review files' UUIDv7 names.
An allowance that names its reset clock is a wait (`allowanceWait`, `src/truth/provider-reset.ts`)
and a retry row carrying that reason is explicit exhaustion: an operational interruption the
controller handled correctly, which still costs whatever it interrupted — a rehearsal that came
back `not-run`, a review that never ran — so name those costs beside the classification. The shape
worth reading for is contention: several runs presenting one `CLAUDE_CODE_OAUTH_TOKEN` across
their Builder, Built and review slots share one account's allowance, and two runs draining it
together each record the same wait seconds apart, so compare the credential provenance the
openings disclose rather than assuming separate accounts. A generic 429, a timeout, a crash or an
unexplained refusal is not proof of exhaustion, and a silence that is the Builder's own rehearsals
or the review clock (`REVIEW_INTERVAL_MS`, `src/gate/review-clock.ts`) is work. With one pin
across the Main Judge, the diagnosis reader and the Epoch Reviewer, review turns exceeding solver
turns is usual; whether the spend changed a decision is lane 14's. Do not reclassify a scored case
because the identity claim was refused. The decision it changes is ownership — `environment`
against the task author — and the launch condition, which is the slot pins and the account.

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
as `authoring-stalled`. Treat a timeout as diagnosable unless the battery evidence proves the
environment owns it, and read a low score on an early cycle as the expected signal rather than a
defect. Do not repair or re-solve anything except a non-result. The decision it changes is the
owner of the fix: `environment` for provider, sandbox and credential failures, `fingerprint` when
the measured bytes are not the accepted bytes, `instructions` or `tools-spec` for a failure the
solver's own roster produced, and the named controller file for a wrong kind.

**26. Builder memory and posture.**

Starts from block 4e's `MEMORY OVER READ CAP (lane 26)` on a fresh session, from a `posture`
capture read as `thin` or `unreadable`, and from a run with two or more epochs.

The question is whether the Builder's own notes did any work, and whether the controller could
read the Builder's posture at all. `src/author/builder-memory.ts` owns `MEMORY.md` under
`MEMORY_CAP_BYTES` and `SCRATCHPAD.md` under its own cap, read from the newest bytes, so a fresh
session that lost the oldest notes lost them to the cap; `carryMemoryForward` copies only an
authored file, only into a slot the successor has not written, under a
`carried forward from <epoch>` marker whose wording says whether the binding changed. Both files
sit at the workspace root, outside `agent/` and `correctness-model/`, so they enter no fingerprint
and are dropped from the adopted domain by `src/author/domain-repo.ts`; a hidden expected value
reaching the bundle through memory is lane 1's finding. Read-back is a model action: check the
Builder's own file reads in `builder-path-record.jsonl` for an actual read and say plainly when
memory was written but never consumed, and do not credit memory with continuity a persistent
session already supplied. Follow two or three specific claims across consecutive revisions and
report each as held, altered or lost. Then the posture: `builder-prose.jsonl` is written by
`src/author/builder-prose.ts` and read by `classifier/prose-classify.mjs`, and a row the reader
refuses — untrimmed, over its capture bound or under another schema — leaves the posture
`unreadable`, which is a statement about the writer or the reader's bound and not about the
Builder. The decision it changes is whether a continuity gap is charged to the Builder; it routes
to `src/author/builder-memory.ts` or `src/author/builder-prose.ts` and selects no `FeedbackOwner`.

**27. Gate rent and confidence.**

Starts from the `gates` lane's `GATE STALL (lane 27)`, `GATE CLEARED WITHOUT EDIT (lane 27)`,
`BELOW-BAR GATE FIRED (lane 27)`, `UNLEDGERED REFUSAL CODE (lane 27)`, `REVIEW HOLD CHAIN (lane
27)` and `CEILING ENDED RUN (lane 27)`, and from any defect a battery, a Judge veto or an Epoch
Reviewer probe found that a gate component exists to catch.

The question is whether each gate component that acted on this run earned its place, which is the
question the gate audit of 2026-09-25 put to every refusal: is it at least 98% sure it refuses
something actually wrong, and does it ever hold a round up that could have advanced?
`scripts/gate-ledger.mjs` carries the audit's answer for every component as priors — `pRight`, the
chance a firing refuses a real defect, and `pStall`, the chance it blocks a legitimate advance — and
the `gates` lane prints them beside what this run's firings did. Those priors are judgements over a
few recorded campaigns, and this lane is what turns them into evidence. For each fired component,
take its episodes from `gates.txt` and read each against the bytes: the receipt in
`builder-execution*.json` (`customCalls[].semantic`: outcome, stage, `findingCodes`, `candidateId`,
`conditionId`, `stagesRun`, `stagedCodes`), the Builder's own reasoning around it in
`builder-prose.jsonl`, and the workspace commits between the refused candidate and the one that
cleared. An episode that ended `repaired` is right only if the change repaired the defect the code
names; a rename, a moved function or a reworded sentence that makes the code go away is the shape
that took `agent-deciding-computation` out of the gate, and it reads `repaired` here too. One that
ended `repaired-tool-condition` passed on the same bundle after the installed tools changed, so read
the tool work between the receipts before crediting either side. One that ended
`cleared-without-edit` refused a submission condition that then passed unchanged, bundle and tools
alike, so it refused something other than the candidate — most often a timeout charged to the
author, which rule 15 gives to the environment. `cleared-plan-unrecorded` and
`bundle-unchanged-condition-unknown` are that shape with one input unrecorded, the plan or the
tools, so they need the workspace commits or the tool work before they can be read either way. A
stall, a hold chain or a ceiling that ended the run is the `pStall` side: say whether the round that
was stopped had a next move the evidence supported, and what it cost in minutes and rounds. The
converse matters as much, and no trigger reads it: take each defect this run's batteries, vetoes or
reviewer probes demonstrated, and name the gate component that should have refused it before
measurement and why it did not — a component that never fires and misses a defect it owns has no
rent either. Report, per component, the prior, what was observed with its episode count, and which
way and by roughly how much the evidence moves `pRight` and `pStall`; one run moves a prior a
little, and several runs agreeing move it further. Do not score a refusal right because the Builder
complied with it, and do not propose a new refusal without the evidence the bar asks for. An
unledgered code is a gap in the ledger: name its producer in `src/` and the row it belongs to. The
decision it changes is a component's form — kept, narrowed into advice, rewritten or deleted — and
its ledger row; it routes to `controller-source`, naming the producer file of the component and
`gate-ledger.mjs` for the prior.

**28. Evaluation-correction regrade.**

Starts from the `gates` lane's `EVALUATION CORRECTION REPLAY CANDIDATE (lane 28)`, and from any
advice issue left `unmeasured` across an `evaluation-correction` round.

The question is what the corrected evaluator says about the artifacts the old one scored. An
evaluation correction keeps the agent, the public exam and the bound schema and changes the
evaluator, the controls or the private expectations, and its next battery is a fresh solve, so
nothing grades the earlier battery's accepted artifacts under the corrected evaluator; AGENTS.md
rule 10 says so, and that is why an issue the correction touched stays `unmeasured`. The `gates`
lane reads every correction from the recorded batteries and prints the battery before it and the
bundle files that moved between the two; where a grading file moved — the brief, the evaluator or a
module beside it, or a task's hidden expectations — the row is a replay candidate and carries the
exact `bun run replay -- <before> --under <correction>` command, which runs `gradeCase` over the
earlier battery's recorded final submissions under the correction's bundle snapshot and diffs each
verdict against the recorded one; a task whose public digest moved is refused as `public-task-drift`
rather than graded. Where only controls, the reference solve or the agent moved, the row says so and
there is nothing to regrade. Run it from a checkout of the measured source and read the flips; the
replay keeps its verifier receipts in a private directory of its own, so a live campaign is safe to
read. A replay candidate stays one after it has been run, because nothing records the replay. A
recorded fail that now passes is a false rejection the correction removed; a recorded pass that now
fails is a false acceptance the old evaluator let through, which retroactively changes what that
battery measured; a set of failed checks that changed with the same verdict is a correction whose
reach the counts hide. Say whether the flips match what the correction claimed to fix in
`EXPERIMENT.json` and the Builder's prose, and whether the next battery's movement is explained by
the correction or by the fresh solve. Keep every per-task verdict private, as rule 4 requires: the
lane reports counts and check ids, never an artifact, a failure location or verifier output. Nothing
in the controller reads the replay's report, so the advice still names every touched issue
`unmeasured` whatever the flips say. The decision it changes is whether the earlier battery's
placement stands, and whether an issue the correction touched would settle as corrected or regressed
if the advice read a regrade; it routes to `correctness-model/evaluator.ts` or
`correctness-model/tasks.json` for a correction that missed, and to `controller-source`
(`src/author/rebuild-advice.ts`) where the flips show an issue the advice keeps unmeasured that the
evidence has settled.

## Retired

These mechanisms have left the source or the skill, and a reader meeting one in an older archive
reads it from that archive alone: the model repair-engineer session, since the diagnosis reader
and the deterministic advice packet replaced it; the progress guard, which held promotions and
has no consumer in the loop; the judge-prompt maintainer, since the Judge framing is one file in
`src/truth/`; the Judge control census and its bait subjects, since no control reaches the Judge;
the paired promotion contest, since a candidate is adopted on its own admitted battery and there
is no contest with current; the separate `DIFFICULTY.json` session and the difficulty ladder,
since there is one authoring path; controller memory curation, since `MEMORY.md` is the Builder's
own and the cap is a read cap; the cross-harness adapter and the weak-solver baseline, since a
comparison runs on one shared pack or not at all; the `climb`, `hold-limit` and `ease` actions,
since `placement.zone` already says where a battery landed; `rungPrediction`, since the plan
declares one target and per-task `predictions[]`; the saturation ledger, which read fields no
difficulty decision carries; and the recurrence reader over the notes archive, since lane 14 reads
recurrence from the recorded epoch reviews and admissions themselves.

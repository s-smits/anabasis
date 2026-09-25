# Whole-run investigation review angles

This file holds deterministic rows A–I and semantic angles 1–31. Continue with
[review-angles-boundaries.md](review-angles-boundaries.md) for 32–36 and
[review-angles-handoffs.md](review-angles-handoffs.md) for 37–40; the manifest reads all three in
order. Read all three files for full review, or the selected blocks for explicit targeted work.
Keep each numbered heading once and deterministic session 30 outside the catalogue.

## Deterministic facts and independent semantic questions

Each block gives the question, the views that answer it, and what the record already showed. Put a
block in a targeted prompt when its evidence can change a material conclusion. Full review gives
each semantic lane an independent session; triggers select depth instead of permission to look.
Distinguish no opportunity, unavailable instruments and a question actually settled by the reader.
A session that contradicts a verified hint with evidence is a useful result.

The historical 40-point system audit lives in
`.claude/skills/run-improvement-campaign/references/system-contract-checklist.md` (the campaign
skill's former checklist interface was removed on 2026-08-27). The relationship is one-way:
current-system contract → campaign row or event → run-review angle. The angles review an active
or completed run. They do not redefine the system contract. Some angles are deliberately advisory
and have no campaign ID; some procedure rows are operator records rather than a run angle. Keep
each stated mapping honest without forcing a one-to-one count. Use the campaign record's states:
`pending`, `pass`, `fail`, `N/A`, `stale`, `unobservable`. `unobservable` is never a pass.

Safeguard reconciliation is a separate archive join, not angle numbering. Runtime `SAFEGUARDS_LOG`
entries are log-only product observations; record their firings as leads against the campaign's own
recorded evidence. WRI may report or independently challenge one, but cannot fire, retire or
promote it.

**A. Campaign identity, declared and agreed.** Is every fixed identity stated, does the run bind the
request it claims to answer, and do all projections agree about the same run and evidence? Decides:
the fixed campaign identity table, X2. Views: `controller/<run>/opening.json`,
`campaign-opening/v2.source` and `.runtime`, `backends.json`, the admitted ask manifest,
`budget.json`, then default, `--scan`, `--scorecard` and `--cases --result <kind>` for agreement.
Hint: begin with the requested run's `opening.json`. Bind its full source commit, source digest and
dirty disclosure to the exact review worktree path and HEAD; bind the run ID and opening digest too.
If that source object cannot be resolved, return `source-unresolved` rather than substituting the
current checkout, main or a neighbouring run. State each identity separately; the checklist forbids saying that unlike fields "match". The
opening binds a request digest, not the prompt text, so a session that quotes the prompt has answered
a different question. Report the three model slots as three values, never as one "all-claude".
For each slot also report whether the pin came from an environment override, an admitted config file
or the default when the opening evidence carries it; missing provenance is a deterministic evidence
gap, not permission to infer it from the observed model name.
`--scan` reports and never gates, so a warning is a question, not a verdict. Check the pass rate
against its Wilson interval and its denominator, not against intent. Two views disagreeing about
the same run is itself the finding. A campaign may also hold attempts that produced no bundle at
all: join them by run ID, request digest, source identity and predecessor evidence, and report them
with their own denominators — on run 66 the attempts with no bundle were 50 of 51 authoring
iterations, so a review that reads only the attempt with artifacts describes a fraction of the run
that happened. Know one deliberate trap: the terminal evidence names the *opening* epoch by design
(`src/run/controller-evidence.ts`), so a reader joining through it can land on the epoch holding
almost none of the iterations; `epochs.json.current` and the scorecard name the epoch the run
ended in.

**B. Claim, replacement and promotion.** Can the run's claims be created, and did anything actually
replace the current harness? Decides: M7, C8 and the promotion event.
Views: `claims/<run>-*.json`,
`promotions/<run>.json`, `candidates/<run>/ladder.json`, `epochs.json`. Hint: a
missing or refused claim is not success, and a clause contradicted by its own cited rows is a
defect in the clause. Run 40's off-variant claim was refused `runtime-model-identity-unproven`, which
is the claim path working, not failing. A promotion row records its own result, and a
first adoption uses `N/A` for promotion. Since 2026-09-04 a promotion row carries no comparison:
the candidate is adopted on its own admitted battery, so read the held clauses
(`candidate-unmeasured`, `candidate-zero-verified`, `candidate-task-set-unbound`,
`candidate-evaluator-unbound`, `stale-task-identity`, `candidate-fingerprint-drift`) rather than
looking for a current condition; rows before 2026-09-13 may also hold `candidate-below-current`,
a claim-stage contest with current that no longer exists. Rows written before that date
also carry `comparison`, `pairedAbsence`, `progressGuard` and `repairDisposition`. A changed binding creates a new epoch — verify a
multi-epoch campaign by recomputing the epoch keys from their recorded bindings and diffing the
bindings field by field; a climb that changes only `kickoffHash` creating a successor epoch is the
mechanism working, and joins across the boundary belong on recorded bundle or `taskSetHash`, never on
epoch name. Also read what the claim honestly discloses: `judge: "unvalidated"` inside a created
claim is correct behaviour under tenet 9, and a disclosed `modelIdentity` limit is a limit, not a
defect.
The guard itself left the loop, and `review-yield.json` no longer carries a component for it, so
everything in this paragraph applies to an archive recorded while the guard still ran; on a current
run there is no guard to credit or fault.
Classify every `promotions/<run>.json` by `experiment`: `promoted/climb` and `promoted/build`
install an adopted battery or a first harness with `comparison: null` and are not improvement
claims; only `experiment: "repair"` with `decision: "promoted"` is an improvement, and across the
47 recorded promotions up to 2026-09-04 there is none (`repairDisposition` was `integrity-held`
twice). The seven recorded paired comparisons were all ties (`wins 0, losses 0`), each held
`candidate-not-better` or `no-net-improvement`. A guard `hold` on `review-coverage` says the judge
review was incomplete; under rule 9 that routes to the auditor and is not a second reason to hold,
so a promotion held on `progress-guard-hold: review-coverage` alone (run49 i05 and i07, run51 i02)
is a guard-owned defect to name, not a safety success.
On sources with `ana-install-journal/v2`, also inspect every surviving
`promotions/<run>-install-journal.json`. Recovery may publish or accept an admission pointer only
when the journal paths and candidate fingerprint match, the promotion row is for the same run and
records `promoted`, and its digest matches the journal. A malformed, foreign, held, byte-drifted or
pointer-conflicting journal is a preserved refusal, not a recovered promotion. A clean promotion
row with no surviving journal remains ordinary completed state; do not manufacture a recovery
event from absence.

**C. Workspace starter package, change evidence and Git ancestry.** Did a fresh workspace commit the
starter package, and does the completed change describe the tree it actually produced? Decides: C1,
C2, and the deletion event. Views: `iteration.json.workspaceChange`, the committed tree, starter
root commit. Hint: the evidence names base, child, `changedPaths` and `deletedPaths`; a predecessor,
when present, equals this base and Git ancestry must agree. A deleted path has to be absent from
the child tree, not merely listed. Resumed workspaces are `N/A` for C1, not `fail`. C2 can pass as
a Git claim while failing as a description of what was built: on run 66 all 51 change evidence
matched `git diff` exactly, yet the seven climb commits carried none of the climb authoring
because a post-fingerprint restore had already clobbered it — so also compare the committed bundle bytes
against the fingerprint before calling the evidence complete.

**D. Static contract and tool conformance.** Does the candidate bundle satisfy the contract it
declares? Decides: C3a-C3d and C4. Views: record findings, iteration outcome, `conformance.json`
(`tool-conformance/v4`). Hint: conformance binds the tool specification, task set, public artifact
schema and generated-worker identities together, so a bundle passing three of four is failing —
and a step whose named content survives in no preserved artifact is unverifiable, which is not a
pass by absence. Public compiler and generated-module diagnostics describe the authoring interface
and may be quoted; verifier internals may not. This deterministic row cannot stand in for the
Representation session's parity half: it executes every schema variant and value boundary through the
writer, DraftStore, submission compiler and verifier input.
On sources carrying these boundaries, also require recursive public-review projection, an immutable
submit census and the canonical 1 MiB artefact limit at every write path. A top-level-only projection
or a limit enforced after a divergent write is not equivalent coverage.

**E. Fingerprint and the census that authenticates it.** Does the fingerprint bind exactly the agent, grader
and task-set hashes, and did the post-fingerprint control census that authenticates that fingerprint reach a
typed verdict? Decides: C5, C6. Views: `iteration.json.fingerprint`, `FingerprintEvidence`, `census.json` on the
gate path only. Hint: every comparison between two measured trees rests on the fingerprint identity.
Check both directions: nothing extra, nothing absent. The agent and grader members are byte hashes;
the current task-set digest is not collision-framed because it joins tasks and controls with newline
separators, so report that limitation rather than calling all three components equally exact. Then
check the fingerprint against the tree the
gates actually saw: run 66's climb fingerprinted a fresh task set, after which that run tree's
frozen-bundle restore rewrote the evaluator wholesale between fingerprint and gate, so seven
fingerprints named task sets that no longer existed and the census re-certified the previous epoch's
tree. Later historical trees recomposed the frozen candidate before fingerprint through
`materialiseFrozenCandidate` in `src/author/climb-round.ts`; inspect the exact run revision rather
than borrowing either mechanism. The census does not directly carry `taskSetHash`, so prove that join through the iteration
identity rather than assuming it. The census half is the gate census, not Judge 1's census — angle 2 owns that one. A
`census.json` whose `findings` are empty while its verdict is `fail` names its owners in its
`blocking` array since 2026-09-02; on an older census the reason usually lives in the sibling
`solvability.json`, and evidence that needs a join to be read is itself worth reporting. A census that failed for a non-blocking finding is a defect in the gate,
not in the bundle. Control content and mechanism coverage stay with angle 5.
On sources with `control-receipt/v1`, the census also needs exactly one receipt for every declared
accept and reject control. Join `controlId`, task, kind, expected outcome and `expectedCheckId` to
the recorded corpus; keep non-results in that denominator; require a complete with/without pair for a
hidden-bearing reject. When the expected check is external or differential, the primary attempt's
host reference must match recorded host execution on request, source, engine, check, subject, attempt,
phase and outcome. A missing, duplicate, extra or foreign receipt, or a reference with no matching
host evidence, is a deterministic census failure. The receipt projection is safe join data, not
permission to expose its hidden operand or verifier detail.
On the installed-tools source (branch `codex/tools-overhaul-0903` and later) there is no host
request reference: the execution row binds `(subjectId, checkId, adapterId)` where `adapterId` is
the installed tool id, and the claim carries `verifierEnvironmentHash` over the tool digests. Join
the receipt to that row instead, and read executed external checks with a null environment hash as
the claim's own execution-resolution clause, not as a census failure.
On descendants that revalidate receipts during claim construction, also derive the discrimination
aggregates again from the recorded control corpus and safe host invocation projection. The live
verifier and later claim writer must reach the same result. A missing or created host join, invalid
receipt, or drift between stored and receipt-derived aggregates makes discrimination unclaimable;
neither process memory nor the stored summary map is a second evidence owner.

**F. F2 solvability and shared gate non-results.** Did solvability settle for every authored task,
and when the census and F2 share a typed verifier non-result, is it reported once? Decides: C7 and
the shared gate non-result event. Views: `solvability.json`, or the shared typed verifier
non-result pointer in `census.json`. Hint: a task no reference path can solve is a defect in the
harness, not a hard task, and it poisons the denominator it sits in. Report completed, unsettled and
non-result counts separately — a `evidence: null` with no cases means F2 never executed, which
leaves that iteration's tasks unsettled, not failed. When census and F2 both name the same
verifier non-result pointer, report it once with one owner. F2 must traverse the public writer,
DraftStore and submit path used by the live solver. Directly constructing and validating a reference
artifact proves satisfiability but not writer-path solvability. Watch the evidence-null feedback branch
in `src/run/solvability-gate.ts`: it can discard the probe's real diagnosis and emit a fixed row
blaming `grader/oracle.ts` — on run 66 that row named a byte-frozen, provably working oracle seven
times while the cause was the controller restore in angle 5. When the blamed file is
byte-identical to a version that passed the same gate, the owner label is wrong.

**G. Case record partition and non-result typing.** Do graded, unaccepted and typed non-result
counts form one complete, exclusive partition? Decides: M2, M3, and the typed non-result event.
Views: strict `case-record.jsonl`, battery facts, the shared four-way classifier
(`src/claim/case-record.ts`). Hint: tenet 6 excludes runtime, provider, key, sandbox and tool
failures from the score rather than counting them as zero, and `truthOk` and `pass` stay
`boolean | null`. Ask specifically whether an unaccepted submit is inside or outside the
denominator, and name the owner of the answer. Before a case record exists this is `pending`,
never zero. On sources with `readBatteryJoinSlice`, join each admitted battery to its own
`battery.json`: `skipped-precase` is the only current recorded zero-row disposition; an absent record
remains absent evidence; a completed/provider-stopped zero or a recorded-count/record-count mismatch
is a refusal. A disposition-less legacy record keeps the older row-only reading and must be labelled
as such; legacy `-confirm-*` run IDs keep their old no-derived-record-location behaviour. A recorded
`skipped-precase` zero makes analysis and Judge `N/A` while claim feedback may still
route. It is neither an abort nor a capability result. The partition can be perfect on measured
cases while the same tenet is violated
upstream in authoring: run 66's record closed 50/50/0/0 exactly, while 43 authoring iterations
recorded a provider spend-limit reply — refusal prose arriving as a *successful* turn — as
`output-not-json` capability findings charged to the tests owner, burning the iteration budget in
four minutes with no typed non-result anywhere. When many iterations share one `findingsHash`,
grep the observability log for refusal prose before accepting the capability reading.
For a recorded controller with a recorded denominator, the default outcome view must seed its battery
map from the terminal's iterations marked `measured`, not only from case rows. Thus an admitted
`skipped-precase` battery appears as a zero-case battery with `rate` and Wilson interval `null`, while
an absent or unfinished controller with no admitted battery stays battery-free. Zero cases are not a
zero capability rate. If a later sibling writes campaign case rows, it must not turn the earlier
zero-battery terminal into a battery or move its denominator.

**H. Runtime identity and isolation integrity.** Is every case bound to the model, runtime and sandbox
the claim names? Decides: M1. Views: recorded bundle, battery, `case-record.jsonl` and isolation evidence,
`runtimeIdentities`. Hint: run 44 held resultId 100/100 and isolation 17/17 on one policyHash. Verify
the trace pointers rather than trusting them — sha-check `traces[].sha256` against the files. Know
the isolation's honest shape: the isolation executes one physical refusal probe per measure invocation and
copies the identical probe object into every record row, so one shared `confinedPid` across rows
is the probe's pid, not the workers' — per-case worker pids live in each case's
`built-runtime.json` and angle 14 owns that check. Report the isolation as N rows under one proven
policy, not N independent refusal proofs. A provider error recorded as an identity failure belongs
to the kernel, not to the agent. OAuth or credential-file path is not a standard case-evidence
field; do not claim it. Where applicable, separately bind custom-origin credential selection,
pre-next-prompt compaction with abort/timeout/usage receipts, and Darwin verifier isolation in a
private temporary subtree with rendered-policy and baseline hashes. These are runtime-boundary
receipts, not case correctness.
Keep two facts apart: who installed the tool and what the host attested it ran. Read
`verifierEnvironmentHash` and each tool's `source` (`workspace-toolchain` or `host`) from the
execution evidence and scope the capability sentence by that: a compiler the Builder installed
under `.toolchain` is Builder provenance, and passing the digest and argument checks does not make
it independent. The digest's `groundingSource` column carries `installed-tool:<digest>` or
`in-process`. No current source writes the older `registrySource`, `engines.json` or
`unresolvedSandboxReadRoots`, so a review does not look for them.

**I. Served-model attestation.** Is the model each case reports the one that actually served it,
and is that a host-recorded attestation rather than the configured pin echoed back? Decides: M1
beside H, and the model name in the capability sentence. Views: `battery.json`
`cases[].solver.runtimeIdentities[]` (`runtime-model-identity/v2`: `provider.model`,
`provider.resultId`), the opening's Built pin, digest block 5b. Hint: until PR #599 the worker
recorded the configured model as the attestation, so an identity row could agree with the pin
without any provider ever naming a model. A row carrying the provider's `resultId` is an
attestation; a row without one is an echo. Read block 5b's three counts separately: attested rows,
unattested rows and rows with no completed turn (a non-result before the first turn attests
nothing). A served model that differs from the configured pin is `SERVED MODEL MISMATCH` and
blocks the condition sentence. An unattested row under a completed turn is an instrumentation gap:
report `unproven identity` and keep the case's kind (AGENTS.md: unproven served-model identity
refuses the identity claim, not the case). Do not read model names out of trace prose.

**1. Starter and kernel contract coherence.** Does what the starter teaches match what the kernel
accepts? Decides: C1, C3b and C4 at their boundary. Views: `starters/pi-built-harness/STARTER.md`,
`src/solve/`, conformance probe output. Hint: this is where the 0/N runs came from. `STARTER.md`
taught two-argument `draft.setArtifact` and the kernel refused it, so every case failed at
artifact write in both execution families. Read each starter instruction as a claim about the
kernel and check it against the kernel. Also read the starter's withholding rule as a claim about
the *generated* interface: the rule enumerates interfaces, and run 66's Builder legally moved the
oracle's decision procedure into a reader tool's return payload — an interface the enumeration does
not name. Whether the rule is stated as a property over everything the agent can read, or as a
interface list with gaps, is a finding here.
Read the other direction too: what the kernel enforces or projects that the starter never states.
Join each Builder refusal code in the run to the starter text that would have prevented it; a code
the Builder could only learn by meeting it is an omission. Before 2026-09-16 the starter never said
that the writer schema compiles from accept controls with closed key sets, that a data-keyed record
needs `openMapPaths` (run 68: 8 of 25 tasks could not express their answer), or that
`read_public_resources` carries check assertions, public `ruleDecisions`, schema rows and design
rules while `decisions`, `gates` and `joins` reach no solver. Angle 7 owns whether the authored
bundle then gives its solver what its tasks need; angle 34 owns the refusal's own explanation.

**2. Judge 1 census.** Is the Judge review recorded as complete, incomplete, off or unavailable,
and do its disagreements with the verifier hold? Decides: M4. Views: `battery.json` `judge`
`offered`, `verdicts` and `abstentions` (the decision is `judgeDecision` in `src/claim/judge.ts`,
derived from those counts), `analysis/<run>-judges.json`, the judge framing in
`src/truth/judge.ts`. There has been no control census since 2026-09-14, and a record with one
behind it is refused. Report answered, abstained and disagreeing verdicts with their own
denominators; an abstention is not a miss, and a disagreement is a reason to inspect the verifier,
never a rescore. A receipted skip of the battery review is not a silent hole, but it does mean no
run case was judged; say so. If the claims also record an all-intrinsic oracle with no external
verifier, state the combination plainly: the run then carries no independent check on correctness.

Deterministic first (2026-09-08, narrowed 2026-09-19): digest block 2b settles the census
inventory — census size and disagreement counts. Admit this angle as a model session only on a
`CENSUS WITH DISAGREEMENT` row. The controls half of the block is gone: there is no Judge control
census any more, the evidence records no control count and nothing writes `controlValidity`, so
the old `JUDGE CENSUS WITHOUT CONTROLS` alarm fired on every run while the validated-only trigger
hid the disagreement de8b40 actually recorded.

**3. Failed-trace diagnosis.** What do the failed traces show, and does the deterministic rebuild
advice packet the next authoring session read agree with them? Decides: no checklist ID — checklist
row M6 was the model Repair Engineer and is obsolete. Angle B owns the promotion receipts; do not
ask this session to reread them. Naming: campaigns measured before 2026-09-04 carry a model Repair
Engineer (older trees may say "Judge 2") with `repair-engineer` prompt files and
`repairEngineerFeedback`; nothing writes those now. Its replacement is deterministic:
`deriveRebuildAdvice` in `src/author/rebuild-advice.ts` writes
`campaigns/<slug>/analysis/<runId>-rebuild-advice.json` from the recorded case rows, and
`renderRebuildAdvice` is its one model-visible projection. Views:
`analysis/<run>-rebuild-advice.json`, `analysis/<run>-judges.json`, `--trace <taskId>`,
`--case <taskId>`, `src/author/rebuild-advice.ts`, `src/analyse/iteration-analysis.ts`. Hint:
check the packet against the battery it names — the issue ledger ages `active`,
`tentatively-fixed` after one absence, `confirmed-fixed` after two and `regressed` when an issue
returns, but an absence counts only when the family reran on the same public inputs, `scoringHash`
and Built condition, and otherwise the issue reads `unmeasured`; a sentinel family is one whose every verified case passed. Establish a zero from the
record, not assumption. Failed cases with no readable trace are an evidence capture or access gap, not a defect in
the packet. A family, kind or count may cross into the rendered text; a task id, a verifier string,
a failure location or a reference artifact may not. Then read the same traces yourself: one
repeated mechanism across many cases is one defect, not one per case, so look for the same
rejection code, tool refusal or last action before submit. Say where your reading and the packet
disagree, and mark your own reading diagnostic rather than completed.

Read the `repair-engineer` component of `review-yield.json` first. Per iteration it gives the
diagnosable and diagnosed counts, the finding kinds by owner, held hypotheses, whether admission
admitted an owned finding, and whether the next iteration's contest selected that owner. Findings of
kind `hardness`, `verifier-suspicion` and `diagnosis-uncertain` carry no owner and cannot enter a
repair; count them as advisory output, not as diagnosis yield. Across the 89 recorded iterations up to
2026-09-04: 43 had failed shipping traces, 38 produced findings, 10 had an owned finding admitted,
and one (run27-sol-0830, owner `instructions`) was followed by a repair of that owner. State the
run's own row against that base rate and say whether the packet reached a paired rerun; if it did
not, the component's goal test is `inert` for this run, whatever its prose says.

**4. Steering coherence.** Do the prompts, warnings, hooks and written rules describe the system
that actually exists? Decides: no checklist ID — a rule reaches
a build only when construction carries it forward or a check enforces it, and prose alone is easy
to lose. Views: the Builder kickoff and steering prompt builders, judge prompt framing, the text of
`--observations --level warning` against the conditions that raise it, `.githooks/`, `AGENTS.md`,
`.claude/skills/`, `promptPolicyDigest`. Hint: read every instruction as a claim about the code
and check it against the code — the code is not automatically right. Angle 1 owns the
starter-to-kernel boundary and angle 12 owns the tenet 4 isolation; take everything else, including the
steering loops themselves: an unconditional follow-up hook repeating an identical nudge every turn
against a dead provider session is a steering defect even though each firing is individually
correct. Check that observation-stream fields are measurements, not literals — run 66's stream
derived `must-fix` from owner-presence while the evidence said `advisory`, and hard-coded
`status: "deferred"`. Recompute the prompt policy digests from source and compare with the recorded
evidence. Report each mismatch as the instruction, what the code does, and which of the two is
wrong. Separate mismatches that can mislead a model from those that only mislead an operator.
Also follow material opening constraints from the served request, examples and starter through the
first design into accepted artifact bytes or enforcing checks. A correct example can be read and
its important constraint still lost. Compare opening authority with the measured controller's
actual later experiment authority. Angle 32 owns execution across host interfaces; this lane owns
coherent guidance and constraint transfer.

**5. Oracle and control hardness.** Would a plausible wrong artifact pass, and do the controls span
every grading mechanism? Decides: C3c, C3d and C6 at their content. Views: `controls.json`, `oracle.ts`,
`.claude/skills/attribution-and-proof/scripts/inspect-solvability.mjs`. Hint: prove it by
execution, not inspection — construct the mutation and run the oracle on it; a session report
carrying mutation results and exact counts is accepted, a prose argument is not. Check three
things separately: (a) every requirement the brief states has an enforcing check — run 66's brief
stated a one-signal-per-pin rule that nothing enforced, so the shared-pin wrong artifact passed on
every constructible task; (b) reject controls can actually *reach* every grading branch — run 66
guarded its task-reference checks on task mode while all controls dispatch as control mode, so 0
of 20 reject controls exercised 3 of 5 mechanisms, proved by the same artifact passing in control
mode and failing in task mode; (c) coverage is reported per mechanism, not as one accept/reject
total — run 44 had 0 of 40 controls exercising the timed path 12 of 25 tasks used.
When all measured grounding is intrinsic, activate the independent 5/6 pair before any capability
or release synthesis. An external-grounded claim additionally requires the controller-pinned
verifier identity, authoritative admission and a demonstrated discrimination differential; a
Builder-authored engine declaration or a Builder-installed tool alone is not independent truth: on
the installed-tools source each tool's `source` (`workspace-toolchain` or `host`) and the claim's
`verifierEnvironmentHash` say who supplied the referee.
Use the deterministic row E receipt join to choose the mutation corpus: every reject receipt should
fail on its declared `expectedCheckId`, and every external/differential receipt should join to one host execution row (a primary host request
on engine sources; a `(subjectId, checkId, adapterId)` binding on installed-tool sources). Do not re-run row E's persistence or claim-reconstruction validators here.
This angle asks the
different question: after the receipt is structurally valid, does that control and its mutation
actually isolate the intended grading mechanism rather than fail on an easier neighbour?
For sources using the v7 route, bind numeric-boundary witness pairs to their task family and routing
identity. A join decoy already used to prove another boundary cannot be recycled as the witness for
this one.

Sharpened trigger (2026-09-08): read digest block 1c first. Angle 27 owns per-check
informativeness and margin; this angle owns whether the mutation corpus is the right corpus.
Whenever the discrimination-inertness verdict is `fail` or `risk`, angle 6 is mandatory beside
this one, and the pair stays blinded.

**6. Independent oracle mutation challenge.** Independently challenge angle 5's wrong-artifact
discrimination result. Construct or execute a second bounded corpus of plausible-wrong artifacts,
concentrating on untested predicate joins, control reachability and mutations that satisfy one
check while violating another. Retain an ordinary valid baseline; angle 36 owns the independent
valid-alternative corpus and false-rejection challenge. State exact accept/reject and non-result
counts, artifact/verifier identities, owner and strongest self-falsification. Do not reread angle 5's
mutation table. The pair remains mutually blind until both reports are frozen. Protected material
stays in private evidence; report safe conclusions, counts and pointers.

**7. Harness exhaustiveness against its own tasks.** Does the harness give a solver everything its
tasks require — and no more than its tasks are supposed to reward? Decides: C3a, C3b, C3d and C4 against the authored
task set. Views: bundle `brief.json`, `tools-spec.json`, `tasks.json`, generated tool sources, and
earlier campaign bundles for comparison. Hint: check each task family against the tools and brief
conventions that family needs. A convention the oracle enforces but the brief never states is a
trap, and a trap is a defect in the harness, not a hard task. Check representation sufficiency,
contract coverage and whether every stated task family is solvable through the declared public
interface. Consume the two representation-session results without merging them: parity decides whether
the model can write every accepted shape; materiality decides whether each shape can affect truth.
When comparing with an earlier bundle, say which mechanism each added block buys; growth
alone is not improvement.

**8. Public disclosure and one-recipe challenge.** Deterministic trigger: a battery is saturated
with constant turns AND digest block 1b flags any tool `ORACLE-PREVIEW SUSPECT` — then this angle
is mandatory and must be settled, not left open; the cheapest settlement is the primary reviewer
reading the flagged tool's description and implementation plus two traces (minutes, and decisive
on run w19, where `evaluate_power_contract` returned the referee's full derived metric chain).
Independently inspect the complete public
interface: the admitted ask, brief, task inputs, tool names and descriptions, public tool
returns, and the generated guide. For each exposed statement, name its surface and classify it as
a declarative validity fact or constraint, or a sufficient construction method. The public interface
must state the short meaning, units, tie-break and termination facts the schema cannot express,
while withholding a sufficient construction method. Test two questions
separately: whether the interface leaks a procedure, and whether the
admissible solution space has collapsed to one recipe even without a literal leak. Enumerate the
admissible solution set per task where the representation permits it; a single survivor means the
task measures recipe-following. Saturated tied variants on runs 52, 53 and 60 came from method text
shipping the procedure; after that interface was closed, run 66 shipped it through a reader tool's
return value instead. The disclosure moves to whatever interface a list does not name, so test the
property, not the list. Angle 7 owns representation sufficiency and contract coverage; this angle
owns disclosure and multiplicity. Use angle 15 telemetry as public process evidence, but do not
duplicate angles 5 and 6's oracle mutations. Whenever both are activated, angles 7 and 8 must
not read each other's report before both return.

**9. Owner routing and the next authoring round.** Did the intended finding reach an eligible owner
with an actual opportunity to act? Resolve the measured source's authority before interpreting move
names. Join the finding, typed admission, selected owner, delivered packet and next authoring opening;
use `review-yield.json`, admission receipts and the corresponding execution records. Keep produced,
admitted, retained, attached and delivered distinct. A null proposed owner may still receive a route;
an owner label does not prove delivery. Cached or superseded feedback needs the same identity check.

Where the measured source uses a narrow evaluation correction, full rebuild or starter reset, prove
which path ran before calling its changed files a regression. Investigate a repeated finding hash
against environment and controller explanations as well as authored work. A provider refusal or
host failure routed as a capability defect is a routing finding. Check when the recipient could
actually respond, using native actions rather than assuming one outer turn is one opportunity.
Report the first broken route, exact owner, evidence and nearest counterexample. Angle 34 owns
whether the permitted message is sufficient; angle 35 owns same-defect repair closure. A delivered
digest and changed bytes alone establish neither. No protected finding text may enter a repair
prompt. Trigger: a successor authoring round, ambiguous owner, undelivered feedback or repeated hash.

**10. Climb contract and direction.** Does the system predict what the
Built Harness can handle, choose a task and query demand near that boundary, and then adjust from
the verifier-grounded result? Decides: the climb event. Views: fingerprint hashes, frozen prediction
log, legacy `rungPrediction`, climb evidence, `candidates/<run>/ladder.json`, `epochs.json`,
`--cases --family`, `src/run/climb-readout.ts`, `src/run/climb-history.ts`,
`src/claim/battery-difficulty.ts`, `src/truth/task-difficulty.ts`. Historical selector contract: a useful prediction names a
falsifiable target pass-rate band and expected direction or level; the observed Wilson interval
must agree with the next action — a `difficulty-decision/v6` record carries one of four,
`placed` with its zone or one of the three set-asides
`no-difficulty-evidence | repeated-failure-set | family-conflict` (`decideDifficulty`,
`src/run/climb-readout.ts`); v4 and older records carry the retired selector verbs
`climb | hold-limit | ease | widen | repair-difficulty` — and a direction that
contradicts its own score band is a defect in the climb decision, not noise. The saturation ledger
that used to be read here is gone with its mechanism: no source carries `saturationMove`,
`saturatedLevels` or `broadenAfterSaturatedLevels`, and the live equivalent is the `climb` streak
the run-improvement-campaign watch (`campaign.ts --state`) reports. Three joins have traps. A fired rebuild records as experiment `build` in the following
iteration (`full-run-round.ts` demotes it by design), so join on the controller decision reason
and the level-decision, never on the experiment label. The three strike-exempt refusals
(zero-verified, repeated-failure-set, family-conflict) enter no streak and no strike by
construction; when the trailing streak moved across an iteration whose decision was strike-exempt,
re-derive the trailing same-harness chain from the admitted ledger rows before crediting the
count. The strike counters those two sentences used to name — `infeasibleStrikes` and the
`saturated*` family — went with the ledger above, and block 4b stopped printing them on
2026-09-23; it prints the placement zone instead, which is what a v5 record actually carries. The
recorded thresholds must equal `thresholds.frozen.yaml` (working rule 8: a disagreeing executable
threshold is a blocking inconsistency). The digest no longer flags drift between decisions, and
the reason is worth knowing before you go looking for it: the detector keyed on `climbBand`,
`limitHoldRounds` and `minLevelN`, and a v5 record carries none of the three, so every record
contributed the identical `undefined/undefined/undefined` and the set could never hold two
members. It fired in 0 of 29 recorded campaigns and could not have fired in a thirtieth. Every frozen climb/descend-authored task set must expose one recorded
one-line difficulty note; initial builds, rebuilds and hold-limit remeasurements carry none by
contract, so only a climb/descend score or action transition without one is the finding
`score moved, no note`. Ownership boundary:
this angle owns the note and the direction, angle 16 owns within-battery coverage, and angle 21
owns between-battery meaning. Calibration caveat before filing a defect: legacy `rungPrediction` is filled only for
model-step contracts (`src/truth/task-difficulty.ts`), so a pinned adjacent-level climb leaves it null
by design — the defect, if any, is a climb decision whose justifying finding exists only as a log
line with no recorded evidence, and angle 17 owns that link. Complexity axes are examples, not a
checklist; the tests model selects the few material axes and states their expected effect.
Keep capability and difficulty denominators separate under the measured source. Only verified
cases enter capability rates. Under the current difficulty rule, once any case is truth-verified,
unaccepted attempts count as difficulty failures; an entirely unaccepted battery has no
difficulty evidence. Typed environment non-results never become wrong answers. Keep task demand separate from measurement spend:
query, turn and tool-call counts are cost, not
difficulty — run 66's advisor variant spent 4-7 extra calls per case to produce byte-identical
artifacts, so a harder difficulty level must widen the admissible solution set the agent searches over, not
add steps to a forced answer. The climb must hold the harness, verifier, representation, tools,
isolation rules, backend, model and thresholds byte-identical; it changes only the adjacent task
condition and reopens no harness owner. If every task passes, the battery found no limit and that is
the finding — but run angle 8's disclosure review first, because a leaked procedure also produces
all-pass.

Historical grouping (2026-09-08; current grouping requires an explicit override): `10+16+21` is one session on difficulty semantics — 10 owns the
decision, 16 the per-family view (block 3b settles its arithmetic first) and 21 the between-battery
axis. Admit the group when block 3 shows a difficulty decision; it keeps three distinct verdicts.

**11. Builder observability and authoring effort.** How long did the Builder take, how many calls did
it make, how many failed, and can the evidence explain the failures? Decides: no checklist ID.
Views: `campaigns/<slug>/epoch-*/builder-execution.json` and `builder-session.json`,
`budget.json`, the controller opening and terminal, `observability/run-<n>.jsonl`, `--builder`,
`--scorecard` and `--observations --contract builder`. First separate the
units. `maxIterations` is an invocation's outer-controller cap; `maxBuilderTurns` and the resolved
Builder wall limit one session; the durable campaign `turnBudget` is charged by summing completed
authoring/session-call attempts across iterations and epochs. Report the opening/terminal
`turnsUsed` delta and never relabel any of these as generic rounds. Then separate real candidates
from controller stops. Current `builder-execution/v6` rows use `kind: "candidate"` or
`kind: "controller-terminal"`; legacy v1–v3 use the versioned budget-sentinel compatibility rule. A real
candidate can itself be terminal, so dropping every `terminal: true` row corrupts the candidate
denominator. Hint: three
independent brittle-run reviews needed exactly this angle. Run 48 recorded 72 native Builder calls
including 30 failed Bash calls while the session evidence was otherwise null and the path record
covered none of the native interface. Run 66 repeated that shape (41 unexplained failed Bash calls,
1 record row over 120 native calls, a second epoch with no record at all) and added two new ones:
`builder-execution.json` is the first session's record and `builder-execution-NN.json` records
later sessions. A late writer must claim its own path; an overwrite risk is real only when the
producer/source proves that two sessions wrote the same path — a filename alone is not evidence.
Where the source recorded matching `builder-prose*.jsonl` sidecars, run the model-free prose census
first. A capture receipt mismatch, malformed row or missing claimed sidecar is an evidence-integrity
failure; a historical execution without a claim is `embedding-unavailable`. Only after this join is
sound does any posture reading count. The `prose-posture` view (schema
`run-prose-posture/v5`) then labels each row with the local BGE-small model and joins the
labels to every candidate submit and every recorded case. Read `evidence` before anything else:
`thin` or `empty` on a half means the labels below are readable and the ranking is not, and
`excludedNonResultRows` counts rows whose session ended in a typed non-result, where the text is
the provider's. Then read `submits[]`, in this order: `prior` says how often
the corpus refused a submit in that dominant posture, so a `workaround` or `disputing-verifier`
posture with a high corpus refusal rate explains a strike differently from `diagnosing` with a
low one; `recent[].excerpt` lets the label be checked in place without opening the sidecar;
`after` says whether the session diagnosed, edited or worked around the refusal; and
`repeatsRefusedPosture` marks a session the feedback did not move, the prose-side shape of a
resubmit strike; and `checkedSincePrevious` is false when no `correctness_check` returned between
this submit and the previous one, which is the tool record answering the old
`claiming-done-without-evidence` question directly. An accepted submit whose leading posture is
`workaround` is a candidate that was simplified rather than repaired: read the accepted bytes
before crediting the repair. Then read `solves`: `byOutcome` sets the solver's posture on verified
cases against unaccepted and typed non-result ones, so a battery that failed because the provider
cut it apart reads differently from one whose solver was diagnosing to the end. A case with a
verified trace and no rows ran and said nothing; a case with no readable trace never ran. Compare
`summary[].reasoning` against `summary[].message` before comparing backends: Codex rows are
mostly reasoning summaries, Claude rows are messages only. Older archives with schema v1 to v3
stay readable as history; their class names differ. The sidecars and their text remain protected;
the view carries no row text beyond the bounded excerpts on the rows before each submit.
This is a semantic lead for explaining an already-observed failure, never a deterministic verdict,
score input or substitute for the execution record. A missing sidecar on an older run is
`embedding-unavailable`, not an invitation to recover private provider transcripts.
On sources with `readExecutionEvidenceDetails`, enumerate the bare and numbered files before
reading them. A missing middle session, duplicate number, malformed JSON, unknown schema, invalid
v4 `kind` or incomplete record is `unavailable`, not zero; keep later valid sessions in their
recorded session positions. A reader that silently stops at the first gap or treats an unavailable
record as an idle session has changed the authoring denominator.
For sources with `campaign-budget-attempt/v1`, inspect `budget.json` together with
`.budget-attempt.lock`. The journal has `lease-acquired` and `reservation-committed` states plus
exact `budgetBefore`/`budgetAfter` witnesses; the after row advances one unit under the same cap.
A live, foreign-host, malformed or otherwise unresolved lease holds a new attempt and a cap change.
Only a proved-dead same-host holder is recoverable; a committed reservation remains spent, while a
pre-reservation witness can be cleared only when the budget row still equals its recorded before
state. Report a held or recovered lease separately from the opening/terminal `turnsUsed` delta, and
never infer a refund from the provider call's outcome.
A session can burn its whole turn allowance against a provider
returning zero tokens (32 turns in 22 seconds, `toolCalls: 0`, `tokens: null`) while an
unconditional follow-up nudge repeats an identical prompt every turn with nothing detecting the
loop. Report outer rounds, durable author-call units, session turns, calls, failed calls and
isolation-clock share with their own denominators, and say
plainly which of them the evidence cannot explain — an unexplained count is the finding, not a gap
to fill by guessing.

**12. The tenet 4 isolation, both directions.** Can protected verifier detail reach a model-visible
prompt, going to the Builder or to a judge? Decides: no checklist ID — the isolation produces no
campaign evidence, so its evidence is source and prompt digests rather than run output. Views:
`projectFindingForAuthor`, `renderRebuildAdvice`, the kickoff and steering prompt builders, the judge census and trace
prompt builders, `promptPolicyDigest`, `src/truth/judge.ts`, isolation tests — and run the isolation tests,
do not just read them. Hint: the test is exact — changing only protected verifier detail must
leave every model-visible prompt digest unchanged, while a deliberate wording change must move it.
Judge 1 evaluates each artifact by itself, so any second artifact in its prompt is a defect rather
than a comparison. Return two lists: what crosses and what is held (run 51's legal crossings were
`domain.{slug,domain,artifactSchema,publicResources[]}` and, in task mode,
`publicTask.{taskId,family,publicInput}`, holding `subjectId`, `expectedVerdict`, `oracleVerdict`,
`sharedBlindSpot` and `baitSourceControlId`). `searchTasks` returns are part of this model-visible
boundary: what they project of earlier batteries must pass the same fail-closed test. The projection must be fail-closed: verify there is
no default branch that lets an unmarked producer's text through. The isolation holding is compatible
with the *owner label* behind it being wrong — a correctly censored finding can still blame the
wrong component (angles F and 17 own that); do not let a clean isolation verdict silently endorse the
attribution. This session owns confidentiality; angle 34 separately tests whether the permitted
public message retained actionable meaning. Report safe conclusions, counts and evidence paths;
never repair information loss by exposing protected details.

**13. Closure, survival and the live-unproven record.** Did the run end, can a reader tell how, and
what did it leave unproven? Decides: X1, X3, X4, X5, the missing-terminal event and the post-run
fix event. Views: controller opening and terminal readers, lock and PID evidence, outcome
projections, the campaign budget, the immutable loop prediction projection when supplied,
`bun run gate` results for any product-source fix,
`tools/fullrun-launchd.zsh`, `src/run/host-runtime-policy.ts`, the run log. Hint: a missing
terminal records interruption, not successful completion, and dead-process evidence plus outcome
projections must agree before you call it one. Runs 40 and 43 died to process-tree cleanup of the
launching session; there is no `setsid` on macOS. The inverse trap is newer: a terminal that
exists can still misstate the cause — run 66's `build-failed` is a capability-shaped sentence for
a controller restore bug plus a provider spend limit, and no evidence states either cause. Ask
whether a reader with only the evidence could name the actual reason it stopped, and file the gap if
not. A post-run fix stays live-unproven until a later fresh run exercises its frozen trigger —
and check claimed fixes' ancestry against both the run tree and current main before calling
anything already fixed: a fix on an unmerged branch is a proposal, not a landed fix; name the branch
or PR that carries it and the run that would prove it. Terminal accounting names the outer cap and
completed controller rounds, durable author-call budget and delta, count and last disposition of
real candidates, adopted candidate, accepted source parent and denominator separately. A
controller-terminal submit row is not the last real candidate. For every supplied cross-run
prediction, report the run evidence's advisory disposition. Only the improvement loop may update the
canonical prediction, successor or backtrack ledger; without its recorded dependency walk, a likely
refutation remains an advisory handoff rather than WRI-authored closure. A release claim must bind one clean merged revision whose composed gate and fresh run
both belong to that exact revision; evidence scattered across an unmerged stack is provisional.
On a source with the frozen launchd launcher, prove the launch condition from the saved invocation:
one explicit environment map, exactly one absolute `HOME` and `PATH`, no duplicate keys or launcher
arguments, Bun resolved through that frozen path, and `/usr/bin/env -i` before the byte-preserved
program arguments. A plist test proves construction; it does not prove a particular run used that
plist. Likewise, a runtime safeguard line belongs to the exact controller run's
`safeguards/<runId>/SAFEGUARDS_LOG.txt` and stderr and remains log-only. A firing is a lead, a missing
log is inconclusive, and only the campaign owner may record retirement or dependency backtracking;
WRI preserves the opportunity and proposes evidence without closing either ledger.

Scope change (2026-09-08): the spend, allowance and exhaustion half moved to angle 28 and digest
block 4c; this angle keeps closure, survival and the live-unproven record. Deterministic first: the
digest's terminal and absent-step rows settle how the run ended; admit a reader only when the
recorded cause does not explain the terminal.

**14. Concurrency and per-case isolation.** Did solving several cases at the same time change any
result, and did two cases ever share a confined child? Decides: no checklist ID — concurrent width
is recorded in `battery.json` rather than as a checklist row. Views: `battery.json` `solveExecution`,
per-case `built-runtime.json` `modelWorker.confinedPid` and `generatedTools.termination`, `--cases
--result non-result`, `--observations --level warning`. Hint: the solve half runs a few cases at
once while grading stays one at a time, because the verifier host holds one open subject. Check
four things separately: every case has its own `confinedPid` — read it from each case's
`built-runtime.json`, not from the record rows, which embed the single shared isolation-probe object
and show one pid for every row (a recorded false alarm; run 66 held 100 distinct worker pids over
50 cases behind one repeated probe pid); no non-result is typed `sandbox`, or `runtime` from a
bounded timeout; `solveExecution.maxConcurrency` is identical in both variants; and path disjointness
between concurrent cases — currently `unobservable`, because `built-runtime.json` records no
working directory, so report it as such rather than hunting for evidence that cannot exist, and
note that recording the confined working directory would close it. Record this missing producer
once; do not launch a path-disjointness investigation until a working-directory producer exists.
Contention shows up as typed
non-results rather than wrong answers, and the fix belongs to the kernel rather than to the
agent.

Sampled-dormant (2026-09-08): admit only on a `sandbox` or bounded-timeout non-result, a
changed shared policy hash, or a changed `maxConcurrency`. Row H and the worker runtime rows own
the pid and policy join; a report that only restates them is not a finding.

**15. Built Harness trace shape and challenge synthesis.** What do the Built Harness agent's own
traces show — what obstacles recur, how uniform is the process across cases, and how does it
differ between two batteries that share task ids? Decides: no checklist ID — advisory diagnosis, but it is the only
direct evidence of how the agent solved anything. Views: the packet and prompt built by the
controller in preflight step 3, digest-verified `case-trace/v2` through
`src/claim/trace-read.ts`, the trace files themselves under
`domains/<slug>/runs/<battery>/cases/<taskId>/trace.json`, `case-record.jsonl`,
`--trace <taskId>` and `--observations --level warning`.

Read `trace-telemetry.json` before the bounded preview packet. Report four things, not one. First,
**coverage**: recorded, missing, drifted, no-pointer, read-error and truncated counts. Second,
**shape per battery**: turn and call min/median/mean/max, calls/errors/exact-argument repeats
and share per tool, total tool latency, tokens and cost with reported/from denominators, and every
distinct ordered tool sequence with its frequency. Third, **family shape**: the same call spread,
tool census and sequence count per task family, so one expensive family cannot disappear in the
aggregate. Fourth, **the cross-battery diff**: join on `taskId` and report shared recorded
tasks, changed turn counts, call counts, sequences and outcomes, plus right-minus-left turns and
calls. State the exact harness, task-set and source identities beside each battery; the telemetry
does not infer those bindings. Classify an exact `(toolName,argsDigest)` repeat separately from a
repeat of the same tool with different arguments, and call it redundant only when retained public
evidence supports that interpretation.

The helper computes these rows from all verified traces; do not hand-count or silently replace a
missing field with zero. A `case-trace/v2` record carries `turns[]` with `stopReason`, `status`,
`timingMs` and token fields, and `toolCalls[]` with `toolName`, `argsDigest`, `isError`,
`resultPreview` and `seq`. Prompt bodies, raw arguments and result bodies do not enter telemetry.

Hint: the packet flattens every battery into one record list and does not pair them, so the
cross-battery diff needs the trace files, not the packet alone. A round has measured one battery
since 2026-09-04, so only a campaign measured before then holds an on/off variant pair; two batteries
at the same harness and level join the same way. Run 66, measured under the two-variant contest, shows
why all three parts matter: the
off-variant ran 25 cases at 1 turn, exactly 6 calls, **one** distinct call sequence and 0 tool errors;
the on-variant ran 10-13 calls over 5 sequences; paired, 0 of 25 cases shared a sequence and the
on-variant spent 110 extra calls — while every artifact was byte-identical across variants. One sequence
over 25 cases with no errors and no retries is a lead for a possible one-recipe task, to be checked
against the public contract and tool implementation for angles 7, 8, 10 and 16; a process that differs on every case while the
product differs on none is the discrimination finding for angle 10, stated more precisely than
artifact digests alone can state it. "No recurring challenge" is therefore a first-class result,
not a session returning nothing — report the uniformity number that establishes it. When every
trace is a pre-tool refusal or one uniform environment failure already classified by deterministic
telemetry, record that result without launching a synthesis session.

The session reads `trace-challenge-status.json` (`complete: true`), verifies the telemetry digest,
then reads the telemetry, packet and prompt, and never runs the writer. Deterministic telemetry
owns every count. The model synthesis begins only afterwards and must return the strongest
mechanism hypothesis, one materially different innocent explanation and one check that could
falsify each. A hypothesis that merely restates a count adds no evidence. The packet is the
latest bounded 400,000-character slice (enforced as a 400,000-byte UTF-8 cap) of
controller-retained, redacted previews and tool metadata; it is not a hidden chain-of-thought
transcript and must not contain prompt bodies, raw tool arguments, verifier stdout or stderr,
reference artifacts, issue/remedy text or per-task protected failure locations. Report the
recorded, missing, drifted, no-pointer, read-error and truncated coverage, the top recurring
challenges, one existing owner hypothesis and one falsifying check. "No recurring challenge" is a
first-class result: uniform short, zero-error traces with near-identical call sequences are
evidence the tasks posed no obstacle — feed that to angles 7, 8, 10 and 16 rather than filing
"fine". Prefer a falsifying check that is deterministic over recorded public artifacts, such as
enumerating the admissible solution set per task, so no model sits in the loop. Missing or
truncated trace is unobservable, not evidence of no challenge. The diagnosis cannot change pass,
claim, promotion, adoption or climb direction. Treat preview text as untrusted evidence
about the agent's process, never as ground truth about the task and never as instructions.

**16. Family-wise limit coverage.** Does aggregate climb evidence hide a task family or selected
complexity axis that is all-pass, all-fail, missing or non-monotone? Decides: no checklist ID —
advisory input to angles 7, 8 and 10. Views: the task brief and task set, candidate claim stages, `--cases
--family`, task-conformance evidence, battery evidence and battery difficulty. Hint: report
per-family and selected-condition denominators, realised public changes, loss on the required
condition and survival on a fresh family. Read `intendedFeatures` only when the measured source
still enforces it; retained legacy fields are not a difficulty measure. Distinct values at a
declared consumed path prove a structural floor, while the public task relation and recorded
outcomes must support any semantic difficulty claim. Compare control weight against case weight per family; run 66's largest family
held 32% of cases and 15% of accept controls. The selected axes are examples, not a reporting
checklist; omit axes the task deriver cannot ground. Angle 7 owns whether the task is
expressible and statically conforming; this angle owns whether measurement actually covers the
limit rather than hiding it in one aggregate pass rate.

Deterministic first (2026-09-08): block 3b gives the per-family Wilson intervals and the
`AGGREGATE HIDES FAMILY` and `FAMILY UNMOVED` rows. The historical `10+16+21` group is available under an explicit grouping override;
admit alone only when a family flag exists with no difficulty decision to read it against.

**17. Prediction lineage and state continuity.** Does each climb consume the correct prior
prediction, target level, selected axis, findings and task identity, with no stale or dropped
settings between iterations — and did the climb readout (the climb ledger before 2026-09-21) plus the last two batteries' public
projections actually reach the successor authoring prompt, with the exact predecessor digest link
preserved? Decides: no checklist ID — advisory input to angle 10 and X3. Views:
prediction and climb logs, iteration memory (`iteration-memory.ts`, the controller-built carry — the
Builder's own curated MEMORY.md belongs to angle 24), `epochs.json`, `rungPrediction`, `climb-history`, the
next-move decision, and the successor epoch's first iteration evidence. Hint: distinguish present,
integrated, triggered and sufficed. A changed source or condition must write a new epoch; one old
prediction must not be silently reused for a new battery. The strongest continuity proof is an
exact digest link — the successor epoch's first iteration naming the predecessor's analysis
digest in `consumedEvidenceDigests`. The strongest discontinuity finding is a dangling digest: a
climb evidence citing a finding digest that exists in no recorded file means the decision's
justification was never recorded and the intent chain is unprovable even where the state chain
holds. Report the exact identity link that proves continuity or the first missing link. Angle 13
owns closure reporting; this angle owns whether the correct prediction and state were consumed by
the next product decision. This is the controller's within-run climb lineage, not the improvement loop's
immutable cross-run prediction ledger. WRI may project the latter and recommend an adjudication,
but cannot write its `consumedBy`, successor or dependency-backtrack events.

**18. Repeated-condition stability and fresh transfer.** Does the predicted boundary persist across
fresh batteries at the same harness and difficulty level, and then on fresh or paired tasks, with resource and
reliability variance separated from capability? Decides: no checklist ID — advisory input to angles 10, B and 14. Views: battery and case-record evidence, family cases, warning observations,
the batteries themselves and source, and climb history. Hint: a repeated hold keeps the same
agent, grader, backend, model and threshold identities; typed non-results are excluded from
capability scoring; fresh tasks preserve the selected condition without copying the old cases. A
single observed boundary is not stable until the same condition repeats and transfers to an unseen
or crossed task. With one battery pair, most of this angle is honestly unobservable — state
exactly which transfer remains unobservable rather than guessing, and extract what the pair *did*
settle: per-case artifact digests compared across variants decide whether the moved variable changed
anything the verifier could see (run 66: 25 of 25 byte-identical across variants, refuting the
discrimination prediction outright), and angle 15's cross-battery trace diff says whether the process
moved while the product did not (run 66: 0 of 25 cases shared a call sequence, 110 extra calls).
Report both, because product-identical with process-identical and product-identical with
process-changed are different findings about the moved variable. Report the repeated
denominators, non-result variance and fresh-task result, or the exact missing observation.

Deterministic trigger (2026-09-08): block 3c's `REPEATED CONDITION` row (same
`buildInputsHash`, `backendPin` and level in two batteries) is the only admission. Without it
the angle reads `no-opportunity` rather than a page of unobservable prose.

**19. End-user outcome validity, independent of the self-authored oracle.** If the end user had
entered this run's prompt and received the Built Harness's submitted artifacts, would the work
actually be correct by the domain's own standards? Decides: no checklist ID — advisory under
tenet 9, and the first of two angles whose referee was not authored by the same Builder as the
contestant. Most other angles trust the run's oracle as referee at some point; angle 5 asks
whether a plausible wrong artifact passes, while angles 19 and 20 ask the converse — whether the
passes were right. A Builder-authored task set, harness and oracle can agree with each other and
all be wrong, because one hand wrote the question, the contestant and the judge; agreement between
them is consistency, not correctness. Views: the admitted ask and opening request digest, the recorded
public task set (`tasks.json`, `publicInput`, `brief.json`), the submitted artifacts under
`cases/<taskId>/final-submission.json`, per-case verdicts from `case-record.jsonl`. Method: take
every graded case up to 25, else a stated sample stratified over families and both verdicts, and
re-derive each verdict independently — execute the artifact when the domain is executable, or
re-derive the answer from the public task data by first principles or a pinned external tool. The
independence rule is strict: the session must not read `oracle.ts`, `controls.json` or any protected
verifier detail before its verdicts are written down, because a re-derivation that saw the oracle
anchors to it and measures nothing — record the independent verdicts first, then join against the
record. Report a 2x2 with denominators: independently-correct and independently-wrong against
oracle-pass and oracle-fail. Oracle-pass cases the independent check refutes are the
reward-hacking finding, one per mechanism, owner oracle or task authoring, and they outrank the
run's pass rate in the synthesis. Oracle-fail cases the independent check confirms as correct are
a hardness defect for angle 5. Also check drift against the ask: task families the end user's
prompt did not ask for measure a different product, and a 17/17 battery on drifted tasks answers
nobody's question. The session's own re-derivation is model judgement — mark it diagnostic, never
completed; a disagreement is a reason to inspect the verifier (tenet 9), never to re-score a case,
and it cannot change pass, claim or promotion. An artifact the session cannot independently
re-derive is `unobservable` for that case, stated with its reason, never counted on either side.
When the graded denominator is zero, preflight writes the 0-by-0 table and the reason; no model session
can manufacture an end-user verdict.
Any public-release, general-domain or cross-domain correctness claim activates the independent
19/20 pair when publicly re-derivable graded artifacts exist. Their model judgement remains
diagnostic; external verifier authority still requires controller-pinned grounding and deterministic
discrimination evidence.

**20. Blinded end-user validity challenge.** Re-derive end-user correctness and ask alignment
without reading the oracle, controls, protected verifier detail or angle 19's report first. Use a
different method, pinned external implementation or non-overlapping family-stratified sample
where possible. Record independent verdicts before joining them to the record and return the same
2x2 denominators as angle 19. Whenever both are activated, angles 19 and 20 must not read each
other's report before both return. A disagreement with angle 19 or the oracle is diagnostic and
requires source or verifier inspection; it never rescales, promotes or rejects a case by itself.
Activate this session only when angle 19 has publicly re-derivable graded artifacts or an operator has
asked for a static ask-alignment challenge. Zero graded artifacts produce an `unobservable` row, not
a second investigation.

**21. Between-battery meaning of a climb.** When consecutive authored batteries at the same harness
claim a difficulty move, does the change in the public task sets actually carry the recorded
difficulty note's axis? Compare the two consecutive public task sets against the recorded note.
Return both task-set hashes, the strongest on-axis reading of the change, one plausible
relabelling reading (the sets differ in name but not in demand), and one falsifier for each
reading. This angle is advisory: it cannot affect pass, claim or promotion. Angle 16 owns
within-battery family coverage and angle 18 owns repeated-condition transfer; this angle owns only
whether the step between batteries means what the note says it means. The Effect and history
session consumes this result and must not repeat the semantic comparison. One added clause for a
fired rebuild, where the same-harness precondition does not hold: when the run contains one (a
recorded difficulty decision whose counters clear a rebuild trigger, joined to a controller decision
reason naming an evaluation rebuild — the experiment label says `build`), compare the rebuilt
evaluation against the saturated one instead — the last saturated battery's task set, families
and public schema against the rebuilt bundle's. Return the strongest widening reading (the
rebuild states a demand the saturated evaluation could not) and one same-product reading (the
same evaluation re-authored under new names), with one falsifier each. A rebuild is measured as a
build experiment with no fourth promotion policy; this clause judges whether it changed what
saturation showed was narrow, never its score.

**22. Fact grounding of Builder-authored domain knowledge.** Trigger: the domain declares factual
tables — pin maps, bus capabilities, physical constants, standards values — AND either every
grounding in the recorded claim is Builder-authored (every executed tool's `source` is
`workspace-toolchain`, or nothing ran outside the process) or the
builder view reports `public_source` in `neverUsed`. Question: are the authored domain facts true
against public documentation the session finds itself? The digest's matrix says who wrote the
referee; this angle asks whether what was written is real. Check a bounded sample, material facts first: every constant a truth check compares against and
every value a flagged or evaluator tool computes with, before any other table the public interface
exposes. Return each fact as `confirmed`, `refuted` (with the public source) or `unverifiable`.
The launcher declares web access in the shared instructions, and the session never spends time
discovering it: historical Codex exec sessions in this batch had none; check the actual transport, the Builder's `public_source` is a product
capability, and the Built Harness measures under `web-search:off` by doctrine. Without web access
the session
returns only the structural findings (constants a check compares against, what the tools compute,
engine independence) and defers external-truth rows instead of listing them `unverifiable` — the
w19 session spent ~40 minutes on an inventory whose two decisive rows (the tools.ts refutation and
the engines-are-not-independent observation) needed no web at all. Check native search, shell research and cited public material too; `neverUsed: public_source`
measures that named tool, not whether the Builder researched the consequential unknown.
A refuted fact is diagnostic — it inspects the Builder and the verifier, it never rescores a case.
The 2026-08-15 firmware run is the reference shape: two of its three board pin tables were
correct, the third board's I2C pad table was fabricated, and no existing angle would ever have asked.

Sharpened trigger (2026-09-08): admit only when the builder view reports `public_source` in
`neverUsed` while the domain declares factual tables, or an external tool was installed without
a recorded source lookup. Retained for firmware and standards-bound domains; on the truss lane it
produced no finding across the audited archives.

**23. Strictness adjudication.** When launched as a session, this is the Strictness and yield session:
one report, adjudication and spend-per-fact as two sections. Trigger: refused submits reach or exceed graded batteries, or the
terminal is one of `authoring-stalled`, `verifier-required`, `oracle-audit-required`, or the
digest's matrix shows every shipping rejection concentrated in one check, or the wall acted in
either direction (a `sandbox` non-result or denied install, or a reach the run used and the claim
does not need). Question: for each
refusal, hold or stop, was the rule right and the work wrong, or was the rule harsher than the
public contract requires — and for the OS wall, did it cost the domain work it needed, or does a
verified case now rest on a reach the wall should not have allowed? Read the refusal ledger, the exact gate source and the refused trees'
finding codes. Classify each refusal family as `work-defect`, `rule-harsher-than-contract` or
`rule-shape-defect` (an all-or-nothing gate refusing partial progress the contract permits), with
the source line of the rule and one falsifier each. The standing operator prior applies: leniency
usually improves the system, and a premature stop is the expensive failure — but the prior selects
which refusals to inspect first, never the verdict. This angle is advisory; it cannot clear a
deterministic failure (the Progress Auditor rule) and it never edits a gate itself. Its output is
at most one owned fix hypothesis per refusal family.

Deterministic first (2026-09-08): the digest's refusal census (refused submits, repeated
`findingsDigest`, strikes) settles the counts. Admit as the Strictness and yield session only
when refusals reach graded batteries or a strictness terminal fires; otherwise dormant.

**24. Builder memory: authored updates, carry-forward and read-back.** Did the Builder's own memory files do
any work in this run — was a curation turn taken whenever one was due, does the stored text record
the peculiar cause of a failure rather than the labels the prompt already handed it, were carried
notes corrected when the binding changed, and did any later session read them back? Decides: no
checklist ID — advisory input to angles 11 and 17. Views: `src/author/builder-memory.ts` on the run's
tree (the live memory writer, `carryMemoryForward`, and the applicable bounds);
`campaigns/<slug>/epoch-*/workspace/MEMORY.md` and `SCRATCHPAD.md`, and
`git log -p -- MEMORY.md SCRATCHPAD.md` inside that workspace, because curation runs before the pass
commit, so each pass's revision is one commit diff; `iteration.json.workspaceChange.changedPaths`,
where both files appear by name because they are in `CANDIDATE_INTERFACE`; `observability/run-<n>.jsonl`
for turns whose `steeringTypes` carries `memory-curation` and whose role is `memory`, with
`builder-execution.json` for the same turn's tokens and failure state; and the Builder's own native
tool calls, for a read of `MEMORY.md`. Activate when the campaign ran more than one authoring pass or
more than one epoch, or when angle 17 finds a continuity gap. A single pass that submitted first time
curated nothing and the row is `N/A`.

Resolve the writer before counting opportunities. A source without the separate curation call has
zero controller curation opportunities; inspect the Builder's own writes, opening injection and
carry-forward instead. Separate unauthored memory, undelivered notes, overwritten lessons, ignored
advice and no next-use opportunity. A successful injection or read establishes delivery, not benefit. Do not report a missing curation turn as a defect on that source.
The curation-specific mechanisms below describe historical revisions only; verify that each
producer and consumer exists before applying it.

Hints, each to be checked on the run's exact source rather than assumed. On the published #361 tree,
controller curation exists only in `src/run/climb-campaign.ts`: a frozen-climb pass curates after a
build failure or a gate result that continues, while an accepted final candidate does not. The
ordinary persistent build campaign has no controller curation call. Count due work from that branch,
not from a generic "one per pass" sentence. A curation failure is no longer silent there:
`curateBuilderMemory` returns a normalised `turn-non-result | max-tokens | invalid-reply |
write-failed` status and error digest; the climb caller may surface a censored stale-memory finding
when stronger gate steering is absent. Verify the evidence on the reviewed revision and separate no
opportunity, successful curation and failed curation. Nothing semantically validates the stored
bytes: `writeCuration` strips one leading and one trailing fence, splits on the exact line
`--- SCRATCHPAD ---`, and stores each part verbatim under 8000 and 2000 bytes, so per-file fences and
a chat preamble are stored as written, a missing delimiter writes MEMORY.md alone and silently keeps
the old scratchpad, and a file that reached its cap carries the marker
`<!-- truncated at N bytes: shorten this file -->` with its tail gone. The curation prompt is
deliberately thin — pass ordinal, `failed at <stage>`, up to twelve distinct author-projected
`[code] path` labels, and the current memory, never verifier detail — so the peculiar facts can only
come from the session's own context: a MEMORY.md that restates those labels recorded nothing the
controller did not already hold, and an unedited starter renders as empty by design. Read-back is a
model action, not an automatic prompt injection: `builderMemorySuffix` feeds the curation prompt,
while `builder-start-prompt.ts` tells the Builder to use MEMORY.md. Check native tool calls for an
actual read and say plainly when memory was written but not consumed. Do not credit memory with
continuity already supplied by a persistent session; it becomes load-bearing across epochs or after
session loss. Carry-forward reads the epoch record: `carryMemoryForward` copies only an authored
file, only into a slot the successor has not written, always under a
`<!-- carried forward from <epoch> … -->` marker. A new pass on the same request carries both
MEMORY.md and SCRATCHPAD.md; a changed request or Builder condition carries MEMORY.md alone, under a
marker saying the binding changed — check that the marker is present and that the lines it warns
about were corrected. Isolation runs both ways: memory sits at the
workspace root, outside `agent/` and `correctness-model/`, so it enters no fingerprint and no claim, but the
owner states it may legitimately carry hidden truth because one session authors expectations and
curates — so adoption must drop both files from the copied domain (`domain-repo.ts`). A hidden
expected value reaching the adopted bundle through memory is a tenet 4 finding for angle 12; a
containment failure charged to a memory write is the defect from the other side.

Judge the observed behaviour against what a memory is supposed to do, and establish that standard by
research rather than from this file. Public practice converges on four operations — add, update,
delete and no-op — where a pass that learned nothing leaves the store untouched and a contradicted
line is corrected or removed instead of accumulating beside its replacement. Two results matter most
here because Anabasis sits in exactly their regime. Repeated whole-file self-rewriting degrades a store
through distortion, drift and loss rather than refining it (`arXiv:2605.12978`, "Useful Memories
Become Faulty When Continuously Updated by LLMs"). The historical curation path asks for the whole
file back after each eligible failed pass, stores it unchecked and truncates at a byte cap.
Novelty gating writes only what is not already held, which cuts churn and bloat
(`arXiv:2605.30711`, SAGE); check whether the measured writer has such a gate. Some
production designs add a writer-critic step that compares the proposed store against the old one for
data loss and invention before committing. Measure drift directly: follow two
or three specific claims across consecutive revisions of MEMORY.md and report each as held, silently
altered, or lost, and name what the cap dropped. Then do your own bounded public research on current
memory practice — this leg needs the web-enabled transport, and without it say the leg is unrun
instead of reasoning from memory — and return at most five sentences on where Anabasis's mechanism sits
against it, each with its source. Treat that research as advice, never as evidence about this run:
the recorded bytes decide what happened, and an external paper only says whether the design was likely
to behave that way.

Required result: per epoch, authored memory updates and, where the producer exists, curation turns
due, taken and failed; each pass's memory diff as add,
update, delete or no-op; the drift trace for the claims you followed; whether any read-back happened;
the carry-forward marker and whether stale lines were corrected; one sentence on whether the stored
text holds anything the curation prompt did not; and the researched comparison with its sources.
Advisory: it cannot affect pass, claim or promotion.

Deterministic first (2026-09-08): block 4e reads the memory file bytes against
`MEMORY_CAP_BYTES` and the epoch count. Admit a reader only on `MEMORY OVER READ CAP`, an
angle 17 continuity gap, or three or more authoring passes; the research leg stays optional.

**25. Finding recurrence and closure across reviews.** Which findings of the earlier archives of
this lane recur unchanged in this run, which cleared, and did a clearing coincide with a source
change that reached the run or with a condition change that merely hid it? Decides: whether the
next move is a repair of the recurring finding's owner or the same experiment again; a finding
recurring for the third consecutive review without a source change on its owner escalates to the
operator as unowned recurrence. Deterministic first: `scripts/finding-recurrence.mjs` reads the
current archive beside the earlier archives of the same lane (`notes/runs/*/review.json`,
`angleStates`, `identity.sourceRevision`) and prints per angle `recurring`, `re-emerged`,
`new`, `cleared`, `dropped-unreviewed` or `quiet`, a lifetime finding count, and whether the
source changed since the previous archive. Triggers: RECURRING FINDING (third consecutive review),
CLEARED WITHOUT SOURCE CHANGE, and FINDING DROPPED UNREVIEWED. Without a trigger this row reads
`settled`; without an earlier ordered archive in the lane it reads `no-opportunity`. On a trigger
the model session reads the previous archives' `main_synthesis.md` and `luna_syntheses.md`
sections for the recurring angle, and settles whether it is the same defect (same owner, same
falsifier) or a new finding under the same number, which owner was named each time, whether any
source commit between the archives touched that owner (join angle 31's changed paths), and whether
the run that cleared it exercised the branch. Method: same defect requires the same falsifier;
a different reason under the same angle number is a new finding, not a recurrence. Hint: a run
that reads `N/A` after a finding proves nothing either way; count it as dropped, name who dropped
it, and never credit a clean review. Never read archives across the 2026-09-08 reassignment of this
number as one lane (before that date 25 was Judge Prompt Maintainer yield, fifteen archives, all
N/A). Advisory: this angle changes no score and proposes no experiment identity; the main
synthesis carries its recurrence table.

**26. Epoch Reviewer yield and reach.** Did findings enter admission, reach a writable owner and
receive a later measured repair opportunity? Current `epoch-review/v4` keys reuse on
`condition.digest` (agent, evaluator, task set and Built pin), not task-set identity alone.
Read the `epoch-reviewer` yield row, the recorded admission's admitted/refused findings and
`feedback[].owner`, and retained rebuild advice. The proposed owner is a producer's proposal;
null does not prove no route. Join feedback by its typed finding code and cited evidence path.
Missing feedback leaves routing unobservable. Admission or advice retention proves delivery only;
Builder use, changed bytes and repair benefit need their own later evidence. Distinguish a failed
review, a skipped identical condition and a completed review with no finding. Read old schemas
against their measured source and old contest consumer where it existed. Keep counts, types,
public identities and digests in reports; private finding prose stays protected. This angle feeds
9 and 13 and proposes no cadence change without a demonstrated redundant eligible invocation.

Deterministic first (2026-09-08): block 4d tallies admitted, refused and unowned findings per
review (`FINDINGS WITHOUT PROPOSED OWNER`). Admit a reader on that row, or on a completed review
whose findings never appear in later feedback.

**27. Check informativeness and margin.** Does each check still separate right from wrong on this
battery, and by how much? Decides: M4, and the "found no limit" reading of a perfect battery.
Views: digest block 1c (per check: shipping-tested, reach-only, unreached; decoy classes,
`targetsJoin`), `controls.json` reject rows, `verifier.json` `checkReceipts`, per-family pass
rows. Hint: a check that only ever fires on controls is reach-only — it proved it can reject, not
that any artifact of this battery came near its boundary; a battery passing 25/25 after a climb with
every check reach-only does not by itself prove that the challenge grew. Verifier receipts are Boolean, so no
numeric margin is recorded; read margin from the accept/reject control pair per check — how far the
one changed fact sits from the accept, and whether any shipping artifact was within that distance.
Deterministic trigger: `REACH-ONLY CHECKS` or `PERFECT BATTERY AFTER CLIMB` in block 1c. Output:
per check `shipping-tested | reach-only | unreached`, the nearest shipping artifact where readable,
and the one check whose margin the next battery should test. Consumes angle 5/6's frozen results
and never edits controls. Feeds 10 and 16.

**28. Allowance, role spend and censoring.** How much of the provider allowance did each role spend,
which steps ran out of turns or credit, and which recorded decisions were taken on a censored
denominator? Decides: whether a terminal, difficulty decision or capability rate stands on the cases
that ran or on the cases that were prevented. Views: `terminal.providerResourceBudget` (`cap`,
`used`, `byRole`, `usage`), `absentSteps[]`, `terminalReason`, each battery's
`solver.nonResult` messages, `difficulty-decisions/*.json`, digest block 4c. Hint: run 7680b4
spent 106 review turns against 63 Built turns while the epoch review was absent on a weekly limit,
and its third battery graded 6 cases beside 19 provider non-results; the difficulty decision that
followed read a six-case denominator. Classify every provider non-result by block 4c's classes:
explicit exhaustion (the provider says so), not-attempted (the five-consecutive stop), generic
limit, other. AGENTS.md rules the reading: explicit exhaustion is a normal R&D interruption that
censors the battery — not a harness defect or a regression — and a generic 429, timeout or stall is
not exhaustion and needs its own cause. Report `DECISION ON CENSORED BATTERY` rows as censored
evidence rather than wrong evidence, and name the earliest decision the run took after censoring
began. This angle absorbs the spend and exhaustion half of the old angle 13; 13 keeps the survival
record. It may not propose a rerun, only state what remains unmeasured.

**29. Weak-solver control baseline.** Would a solver that cannot do the work also pass this battery?
Decides: whether a pass rate measures solving or measures the exam. Views: battery rows, the
verifier and controls; a recorded weak baseline where the product provides one (none today), otherwise
the digest's constant-turn and reach-only leads. Hint: the product has no weak-solver baseline, so until
it exists this angle is a product-side prerequisite and the review can reason only from the shape
of the passes — identical tool sequences, passes with zero revisions, artifacts equal to the public
example, checks no shipping artifact ever failed. State the smallest baseline that would settle it (one
battery at the same level with the Built model replaced by a fixed cheaper pin, or the public
example resubmitted as-is) and what a pass by that baseline would falsify. No launch authority: this
angle names the missing experiment and its owner; it runs nothing.

**30. Cross-harness verdict agreement.** On the same public tasks, do two independently built
harnesses' verifiers agree, and where they disagree, which one is wrong? Decides: whether a verdict
is a property of the task or of the harness that authored its checks. Views: two adopted bundles for
one prompt (for truss, sibling campaigns of the same lane), their public task inputs, verifiers and
accept/reject controls, and an adapter from one harness's artifact shape to the other's verifier.
Hint: the truss lane holds several adopted harnesses on one request; cross-running their controls is
cheaper than a reference implementation and independent of any single Builder's omission. Method:
freeze each verifier's verdict on the other's accept and reject controls before reading either
verifier's source; report the 2×2 per check family with explicit denominators. An artifact one
verifier accepts and the other rejects is a lead for angles 5, 19 or 27 and never a rescoring.
Needs a per-harness adapter; without one, report `adapter-missing` and the two artifact shapes.
Neither verifier's issue text crosses into a run.

**31. Source-delta reach.** Did the source that changed between the previous run and this one
actually execute, and did its safeguards fire? Decides: whether a fix can be called live-exercised
on this run (evidence level 3) or only present in source (level 1). Views: `scripts/source-delta.mjs`
output (changed files by top directory, safeguard ids declared in changed files joined to
`SAFEGUARDS_LOG.txt`, model-visible text changes), this opening's `source.commit` and the
previous run's. Hint: on run 7680b4 six `src/` files changed since the previous truss run; the
provider-usage-limit safeguard was declared in a changed file and never fired, while the same run
recorded seven explicit exhaustion non-results — the sensor and the event did not meet.
Deterministic trigger: `UNREACHED CHANGED SAFEGUARDS` (`MODEL-VISIBLE SURFACE CHANGED` is angle
12's trigger, not this angle's finding). For each unreached changed path decide: no opportunity on
this run, opportunity present but the branch not taken, or the branch taken without its sensor.
Report the changed paths that were live-exercised, the ones that were not, and the one next-run
condition that would exercise the rest. Feeds Effect and history.

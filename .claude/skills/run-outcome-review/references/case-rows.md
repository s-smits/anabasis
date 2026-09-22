
# Case rows and non-results

Read the recorded on-disk evidence before summaries or stdout. It outranks a log line. This
reference owns one case; the parent `run-outcome-review` skill owns where a whole run stopped.
Formerly the `run-receipts-and-nonresults` skill.

Keep submission, truth, and review as separate facts. Submission says the controller accepted and
froze public artifact bytes. Truth says the host verifier evaluated those exact bytes. Model
reviews and diagnoses are advisory outside that verdict: neither may change `acceptedSubmit`,
`truthOk`, or `pass`. Acceptance alone is therefore not a pass, and a later model return cannot
replace the frozen submission.

## Classify the case

| Case | `truthOk` | `pass` | Capability rate |
|---|---|---|---|
| accepted, verifier true | true | true | verified pass |
| accepted, verifier false | false | false | verified failure |
| completed attempt, no accepted submission | null | false | separate unaccepted count |
| host-recorded non-result, including after acceptance | null | null | excluded |

Use the owning classifier rather than a Boolean shortcut: unaccepted and non-result cases
both lack a truth verdict but have different `pass` values. Missing evidence alone does not
establish a host failure. Keep all three denominators visible.

## Start with the row

Resolve the full source revision from `opening.json` and use its official evidence reader.
An unavailable revision is `source-unresolved`; a newer reader's replay is a separate result.
The case record binds:

```text
runId + builderId
slug, buildInputsHash, backendPin
taskId, family
acceptedSubmit
truthOk, pass
runtimeNonResult, runtimeNonResultKind
isolation: CaseIsolationEvidence | null
condition: null means no recorded run condition
traces: digest-bound {path, sha256} pointers
```

The row writes the trace pointer. Read it only with
`readVerifiedTraceUnder(row, campaignDir)` from `src/claim/trace-read.ts`; the operator view and
diagnosis use the same reader. Its states are `recorded`, `no-trace-pointer`, `trace-missing`, and
`trace-drifted`. Only `recorded` permits behavioural conclusions. The other three describe missing
or changed evidence, not what the agent did.

Never construct `<case>/trace.json` yourself. Pointers are relative to the run's own tree, whether
`domains/<slug>/`, `candidates/<run>/`, or `contest/<run>/`. A UI path or summary is not verified
evidence. Resolve and consume the verified root together: promotion can move a live candidate
between those locations, so a previously discovered candidate path is not durable identity.

Byte hashes and read authority are separate. Preserve intentional top-level campaign/domain
links used by isolated run worktrees, while checking that slug roots, candidate/contest
containers and leaves remain within their expected canonical topology. Revalidate a cached
root before use. A trace pointer must be relative and remain physically inside that root;
the same digest at an escaping path must be refused. Reuse the shared reader's validation
instead of adding a local path heuristic. Public context cards need their own manifest proof;
proximity to a verified trace does not verify them.

Read supported schemas from `READABLE_CASE_TRACE_SCHEMAS` in the measured source's
`src/backends/trace-capture.ts`. Reader/schema incompatibility can explain zero readable traces;
it does not prove an empty battery. Missing data is `null`, never zero. `status: "open"` has
no terminal duration. `truncated` is a capped
prefix and its counts are lower bounds; `droppedRawEvents` counts refused events. Before claiming
an event did not happen, check backend support, normalisation, dropped events, truncation, and
whether child work finished before sealing.

## Non-results and ownership

Read `NonResultKind` and the narrower environment-owned set from
`src/claim/record-events.ts`; do not duplicate the vocabulary. A kind alone is insufficient: check
the discrimination path, installed-tool evidence where relevant, and the producer evidence.
Environment ownership is intentionally narrower than the kind list. A generated verifier throw
remains a product defect; an external-tool non-result still needs its host provenance and owner
read, even while the case stays out of the score.

Fail closed:

- A child process cannot declare its own environmental exemption.
- Do not infer a non-result from vague text without the required host signal.
- Verifier timeout, malformed protocol, and unavailable verifier are not `truthOk: false`.
- Controls that do not run remain in the discrimination denominator.
- Unknown tool-call count is not zero.
- A trace with a bad digest or schema is absent evidence and leaves telemetry denominators.
- Never repair recorded evidence. Create a new attempt or mark the evidence invalid.

## Read order

1. Controller-held final submission record.
2. Case record row and verified trace pointers.
3. Verifier-host evidence and verifier result.
4. Normalised backend events and completed turn result.
5. Isolation check result and reset evidence.
6. Run summary, claim, readiness, and iteration evidence.
7. Stdout, logs, and prose.

Confirm every higher-level claim in its lower-level source.

At each recorded battery boundary, reconcile:

```text
total = truth-verified + unaccepted + typed non-results
capability rate = truth-verified passes / truth-verified cases
```

The persisted claim's `n` may include unaccepted failures: read `src/claim/claim.ts` at the
measured revision and name that denominator separately. Difficulty also includes unaccepted
attempts once any case is truth-verified; an all-unaccepted battery has no difficulty evidence.
Do not relabel historical claim fields or substitute their denominator for capability.

Do not wait for controller terminal to classify a recorded battery. When the first three completed
cases are all unaccepted, read their controller-held final submissions and verified traces as one
bounded sample. Preserve each producer's recorded `NonResultKind`; do not infer a narrower kind
from message text.

## Symptom to owner

| Symptom | Owner/result |
|---|---|
| provider error before accepted submission | provider non-result |
| runtime boundary cannot establish or reset | sandbox non-result |
| external tool cannot run, times out or crashes | recorded host kind; inspect installed-tool evidence |
| external tool exits non-zero | completed execution; the correctness check decides its meaning |
| correctness-model evaluator throws | `verifier-throw`, product defect in the evaluator |
| completed turn has no accepted submission | unaccepted task failure |
| submit rejects public schema | representation or solve-side failure |
| accepted bytes evaluate false | model/harness truth failure or verifier defect |
| event stream and stored hash differ | evidence integrity defect |
| model claim lacks backend identity | provisional or invalid evidence |

Do not blame the model for a verifier false until discrimination and reference binding are current
for that verifier. After bytes are accepted, preserve and evaluate them unless the runtime boundary is
unproved; no second submit path may replace them. A non-result keeps a case out of the score and
still names the owner to fix. It is attribution, never an excuse.

## Read traces by backend

The older Codex traces in this sample carry little assistant text: across 10,281 recorded traces measured on
2026-09-04, 6,706 of 6,838 `backend: "codex"` traces had an empty last-turn `assistantPreview`
and one turn, while 3,423 of 3,443 Claude traces had a preview. For that trace generation, read failure from
the turn `errorMessage` and the errored calls' `resultExcerpt` and `argsExcerpt` first; a summary
built from `assistantPreview` plus turn count misses most of this sample's content. Check the
current trace schema and producer before extending that limit to newer runs.

## Read a claim's statement, not its flag

`claim.ok` reports evidential validity: the identity, grounding and denominator clauses held. The
supported number lives in `statement.n` and `statement.passed` and may be zero; an `ok: true`
claim with `passed: 0` is coherent and is not a capability result.

## Join runs on content identities

Older request-derived project layouts could give unrelated runs of the same prompt matching
slugs and epoch names. Fresh project allocation has its own recorded identity. Join on the
opening's project and run identity, then the immutable bundle hash,
`taskSetHash` and `buildInputsHash`; a matching epoch key or slug is zero evidence of
continuation. Battery directories live under `domains/<slug>/`, `candidates/<run>/` or
`contest/<run>/`; let the shared reader resolve the current root.

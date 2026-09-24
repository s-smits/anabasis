# Reading a run through its outcomes

This is the narrow read: one run or one case, through what the host measured, without a lane
swarm. It absorbed the former `run-outcome-review` skill, and before that
`run-receipts-and-nonresults` and `stop-unfruitful-run`. It changes no
score, stops no process and launches nothing; `launch-run` owns an authorised stop and
`run-improvement-campaign` owns any replacement.

## Identity and closure

Resolve the run id, project, worktree and full source commit from `opening.json`, and read with
that source's own readers. Unavailable source is `source-unresolved`, and a newer reader's replay
is a separate result. Read the terminal and iteration receipts beside the case rows, because a
`completed` terminal can end on `candidate-unchanged` with no new battery, and a live process can
sit inside one long authoring turn — its progress is the controller's execution checkpoints, not a
file mtime. Start with the one view that answers the question, and take the rest of the catalogue
from `USAGE` in `tools/outcome/cli.ts` at the exact revision rather than from here:

```sh
bun run outcome <campaignDir> <runId>
bun run outcome <campaignDir> --builder
bun run outcome <campaignDir> <runId> --case <taskId>
```

## One case, three facts

Submission, truth and review are separate facts. Submission says the controller froze public
bytes; truth says the host verifier evaluated those exact bytes; a review or diagnosis is advisory
and never moves `acceptedSubmit`, `truthOk` or `pass`.

| case | `truthOk` | `pass` | capability rate |
|---|---|---|---|
| accepted, verifier true | true | true | verified pass |
| accepted, verifier false | false | false | verified failure |
| completed attempt, no accepted submission | null | false | unaccepted, counted apart |
| host-recorded non-result, even after acceptance | null | null | excluded |

Unaccepted and non-result both lack a verdict and differ in `pass`, so use the owning classifier
rather than a Boolean. At each battery, `total = truth-verified + unaccepted + typed non-results`.
The persisted claim's `n` may include unaccepted failures, so name that denominator apart from
capability, and read `statement.n` and `statement.passed` rather than `claim.ok`: an `ok: true`
claim with `passed: 0` is evidentially valid and is no capability result.

Read a trace only through `readVerifiedTraceUnder(row, campaignDir)` in `src/claim/trace-read.ts`,
never by spelling `<case>/trace.json`. Its states are `recorded`, `no-trace-pointer`,
`trace-missing` and `trace-drifted`, and only `recorded` permits a behavioural conclusion.
Promotion can move a candidate between `domains/<slug>/`, `candidates/<run>/` and
`contest/<run>/`, so let the reader resolve the current root each time. The current schema is
`CASE_TRACE_SCHEMA` in `src/backends/trace-capture.ts`; a reader mismatch can explain zero
readable traces without proving an empty battery. `truncated` counts are lower bounds, missing is
`null` and never zero, and before claiming an event did not happen check backend support,
`droppedRawEvents` and whether child work finished before sealing. Older Codex traces carry
almost no `assistantPreview`, so read their turn `errorMessage` and the errored calls' excerpts
first.

## Non-results and ownership

`ENVIRONMENT_OWNED_NONRESULT_KINDS` in `src/claim/record-events.ts` is deliberately narrower than
the kind list, and a kind alone is insufficient: read the host signal and the installed-tool
evidence behind it. A child cannot declare its own exemption, a verifier timeout or malformed
protocol is not `truthOk: false`, controls that did not run stay in the discrimination
denominator, and recorded evidence is never repaired.

| symptom | owner |
|---|---|
| provider error before an accepted submission | provider non-result |
| the runtime boundary cannot establish or reset | sandbox non-result |
| external tool cannot run, times out or crashes | its recorded host kind, with provenance |
| external tool exits non-zero | completed execution; the check decides its meaning |
| the correctness-model evaluator throws | `verifier-throw`, a product defect |
| a completed turn with no accepted submission | unaccepted task failure |
| submit rejects the public schema | representation or solve-side failure |
| accepted bytes evaluate false | solver failure, or a verifier defect while discrimination is stale |
| event stream and stored hash differ | evidence integrity defect |

When the first three completed cases of a live battery are all unaccepted, read their final
submissions and traces as one bounded sample without waiting for the terminal. Join runs on the
opening's project and run identity, then bundle hash, `taskSetHash` and `buildInputsHash`; a
matching slug or epoch name is no evidence of continuation.

## Whether a live run is still useful

Bind at least two recorded checkpoints to the same run and read the newest before recommending
anything. Ask whether the next round can learn what the last could not, whether a demonstrated
defect has a fix this run cannot receive, and whether repeated provider or host failures can
recover inside the authorised condition. A new family, a changed denominator, a candidate edit or
a live tool checkpoint refutes a stall; log silence, one slow turn, one transient non-result or a
live PID decide nothing. Recommend continue, investigate or stop, naming the evidence, the owner
and what stopping leaves unknown. A stop already covered by user authority goes to
[launch-run's stop procedure](../../launch-run/SKILL.md#stop-a-run); otherwise ask. A stopped run
proves neither a limit nor that a later fix works.

## Adjudicating a finding

Check a diagnosis against each case's public requirements and accepted bytes, because different
task inputs can explain a passing contrast. An unchanged evaluator-only repair proves no retry
defect until its base bytes, admitted owner, writable scope and actual edits are read. A finding
downgraded from blocking to advisory is a changed judgement, and if its missing predicate is still
absent a promotion does not show it fixed. Compilation, linking, host execution and target
hardware are separate claims, so name the strongest scope the executed-tool receipts reach.

## Handing a run over

Packaging a run for handover belongs to [zip-run](../../zip-run/SKILL.md).

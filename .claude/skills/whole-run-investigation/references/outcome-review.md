# Reading a run through its outcomes

This is the narrow read: one run or one case, through what the host measured, with no lane swarm.
It changes no score, stops no process and launches nothing; `launch-run` owns an authorised stop
and `run-improvement-campaign` owns any replacement. Inside a whole-run investigation the same
reading is rows G and H of the deterministic read, and what it leaves unexplained goes to lane 24
for waits and censoring, lane 22 for what the solver did inside its walls, lane 25 for the failure
mechanism and whether its typed kind is honest, and lanes 35 and 38 when the question is whether a
pass or a fail was right.

## Identity and closure

Resolve the run id, project, worktree and full source commit from `opening.json`, and read with
that source's own readers. Unavailable source is `source-unresolved`, and a newer reader's replay
is a separate result. Resolve the campaign from the run rather than the reverse, because two
neighbouring numeric suffixes of one slug can hold runs of the same request, and resolve every path
to its real location, because an `ana-run-*` tree reaches the same campaigns through a symlink.

Read the terminal and iteration receipts beside the case rows. A `completed` terminal can end on an
unchanged candidate with no new battery, and a live process can sit inside one long authoring turn,
whose progress is the controller's execution checkpoints rather than a file's mtime. Start with the
one view that answers the question, and take the rest from `USAGE` in `tools/outcome/cli.ts` at the
exact revision rather than from here:

```sh
bun run outcome <campaignDir> <runId>
bun run outcome <campaignDir> <runId> --case <taskId>
bun run outcome <campaignDir> <runId> --checks
bun run outcome <campaignDir> --builder
```

## One case, three facts

Submission, truth and review are separate facts. Submission says the controller froze public
bytes; truth says the host verifier evaluated those exact bytes; a review or diagnosis is advisory
and never moves `acceptedSubmit`, `truthOk` or `pass`.

| case | `truthOk` | `pass` | kind |
|---|---|---|---|
| accepted, verifier true | true | true | verified pass |
| accepted, verifier false | false | false | verified failure |
| completed attempt, no accepted submission | null | false | unaccepted, counted apart |
| host-recorded non-result, even after acceptance | null | null | non-result, excluded |

Unaccepted and non-result both lack a verdict and differ only in `pass`, so a reader that counts
`pass: false` rows as scored folds the unaccepted cases into its denominator. That is exactly what
several readers do. The climb history's `n` counts scored rows, which is what battery sizing reads
when it decides whether a probe graduated, and a persisted claim's `n` may include unaccepted
failures too. So count through the owning classifier, keep `total = verified + unaccepted +
non-results` at each battery, and when you quote a claim, read `statement.n` and `statement.passed`
rather than `claim.ok`: an `ok: true` claim with `passed: 0` is evidentially valid and is no
capability result. A capability rate is over verified cases alone.

## Which bytes decided

A verdict is only as good as the instrument that produced it, and the instrument here is whatever
the host hashed and ran. `--checks` lists every check run, its time and its tool runs; row H reads
each tool run's `source`, `workspace-toolchain` or `host`, and its digest, and the claim carries
them together as `verifierEnvironmentHash`. When a deciding tool's version toolchain no longer
resolves — a symlink into a directory since removed — no replay can confirm the verdict, so the
instrument is unestablished rather than proved, and a sentence relying on that pass says so. Keep
the evidence kind in view as well: an installed external tool deciding a check is a different
instrument from an authored algorithm run through an installed interpreter, which is still the
Builder's own computation.

## Traces

Read a trace only through `readVerifiedTraceUnder(row, campaignDir)` in `src/claim/trace-read.ts`,
never by spelling `<case>/trace.json`. Its states are `recorded`, `no-trace-pointer`,
`trace-missing` and `trace-drifted`, and only `recorded` permits a behavioural conclusion.
Promotion can move a candidate between `domains/<slug>/`, `candidates/<run>/` and `contest/<run>/`,
so let the reader resolve the current root each time. The schema is `CASE_TRACE_SCHEMA` in
`src/backends/trace-capture.ts`, and a reader mismatch can explain zero readable traces without
proving an empty battery. `truncated` counts are lower bounds and a missing count is `null`, never
zero. Before claiming an event did not happen, check backend support, `droppedRawEvents` and whether
child work finished before sealing. Older Codex traces carry almost no `assistantPreview`, so read
their turn `errorMessage` and the errored calls' excerpts first.

## Non-results and ownership

`ENVIRONMENT_OWNED_NONRESULT_KINDS` in `src/claim/record-events.ts` is deliberately narrower than
the kind list, and a kind alone is not enough: read the host signal and the installed-tool evidence
behind it. A child cannot declare its own exemption, a verifier timeout or malformed protocol is not
`truthOk: false`, controls that did not run stay in the discrimination denominator, and recorded
evidence is never repaired.

| symptom | owner |
|---|---|
| provider error before an accepted submission | provider non-result |
| the runtime boundary cannot establish or reset | sandbox non-result |
| external tool cannot run, times out or crashes | its recorded host kind, with provenance |
| external tool exits non-zero | completed execution; the check decides its meaning |
| the correctness-model evaluator throws | `verifier-throw`, a product defect |
| a completed turn with no accepted submission | unaccepted task failure |
| the solve ran to the Builder's `solve_seconds` after calling a tool | unaccepted, and the wall is the Builder's setting |
| submit rejects the public schema | representation or solve-side failure |
| accepted bytes evaluate false | a wrong answer, or a right one the checks refused, which lane 38 separates |
| event stream and stored hash differ | evidence integrity defect |

When the first three completed cases of a live battery are all unaccepted, read their final
submissions and traces as one bounded sample without waiting for the terminal. Join runs on the
opening's project and run identity, then the bundle hash, `taskSetHash` and `buildInputsHash`; a
matching slug or epoch name is no evidence of continuation. A battery of non-results is an
operational result: `DECISION ON CENSORED BATTERY` and `EXPLICIT ALLOWANCE WAIT` are the digest's
names for a round that decided on one, and lane 24 reads what the wait cost.

## Whether a live run is still useful

Bind at least two recorded checkpoints to the same run and read the newest before recommending
anything. Ask whether the next round can learn what the last could not, whether a demonstrated
defect has a fix this run cannot receive, and whether repeated provider or host failures can
recover inside the authorised condition. A new family, a changed denominator, a candidate edit or a
live tool checkpoint refutes a stall; log silence, one slow turn, one transient non-result or a
live PID decide nothing. Recommend continue, investigate or stop, naming the evidence, the owner
and what stopping leaves unknown. A stop already covered by user authority goes to
[launch-run's stop procedure](../../launch-run/SKILL.md#stop-a-run); otherwise ask. A stopped run
proves neither a limit nor that a later fix works.

## Adjudicating a finding

State what the recorded bytes show and the cause you infer from them as two sentences, so the
observation survives if the cause does not. Check a diagnosis against each case's public
requirements and accepted bytes, because different task inputs can explain a passing contrast. An
unchanged evaluator-only repair proves no retry defect until its base bytes, admitted owner,
writable scope and actual edits are read. A finding downgraded from blocking to advisory is a
changed judgement, and if its missing predicate is still absent, a promotion does not show it
fixed. Compilation, linking, host execution and target hardware are separate claims, so name the
strongest scope the executed-tool receipts reach, and the digest of the tool that reached it.

## Handing a run over

Packaging a run for handover belongs to [zip-run](../../zip-run/SKILL.md).

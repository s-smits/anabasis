
# Adoption gates

Formerly the `adoption-gates` skill; `harness-contract` owns it.

Do not measure a harness before it passes these gates. Run them in this order. A gate that cannot
run returns a typed non-result, never a pass.

```text
capture snapshot → bundle contract and validation → generated-tool conformance
                 → control census → F2 full-task solvability → adoption
```

`src/run/census-gate.ts` owns the post-fingerprint census. `src/run/solvability-gate.ts` owns F2. F2
runs last because it executes the real verifier for every task.

## Check each gate

**Task conformance.** Read the validator on the measured source. Older revisions require declared
feature bounds and a closed `TASK_FEATURE_KEYS` set; check those only where their live consumer
exists. Revisions with the public-condition floor require variation within each family at a
shared public path declared as consumed by an applicable truth check. Retained historical
`intendedFeatures` fields carry no admission authority there. This is a structural floor, not
proof of meaningful difficulty or semantic dependence. Keep exact task count, control coverage,
public validity, and the realised-change checks at their owning admission boundaries.

**Controls.** Require both accepts and rejects. Each reject names the check it must fail with
`expectedCheckId`; failure at another schema or empty-output check does not count. A reject that
needs a hidden operand carries it only on the evaluate side. The with/without differential proves
the host comparison, rather than generated code, catches it. The full census must finish before
paid scoring (`controlCensus.completeBeforePaidScoring: 1.0`). A control non-result blocks; it
does not reduce the denominator. Each reject binds to a task and must fail only its named check.
Every family needs an isolating reject. The Builder may author several examples, but the host
census decides which satisfy those requirements. Read `discrimination-proof` for detail.

**Task count.** Enforce `expectedTasks` during candidate validation and check it again in the
census. Do not wait for paid measurement to discover a short battery. Check task, check and
family coverage at their owning validators; the current Builder is one persistent session.

**F2.** Reference-solve every authored task through the pinned verifier host, not only
`tasks[0]`. Build the reference artifact from the public task bytes, the brief and the operating
guide alone: a solve written beside the checker shares its private vocabulary, and F2 then proves
answer-key self-consistency rather than public-input solvability (campaign w47-sol: the 23 accept
controls used a `deviceId` field the brief never named, so census, F2 and conformance passed while
72 of 72 verified rows failed). Check at least one accept control against the same public-only
rule; a green census whose accepts all use a field absent from the brief is a blocking
representation defect, not evidence. The controller
owns the full task bytes, public solve view, schema check, verification, verifier scopes,
task-sensitivity check, and bundle snapshot recheck. Solver artifacts remain evaluate-side.

F2 stores `<iterationDir>/solvability.json`, including task ids, check ids, and engine text. The
Builder may see only the aggregate count. F2 can block adoption without exposing a failed task,
engine issue, or repair hint. An unavailable engine is an environment non-result, never a product
failure.

**Fingerprint.** Capture and identify the candidate, then validate that snapshot. A hash identifies
bytes; it does not admit them. Candidate validation must pass before adoption.
`Claim.create()` requires all three commitments: `agentHash` for `agent/`, `correctnessModelHash` for
`correctness-model/` except `tasks.json`, and `taskSetHash` for `correctness-model/tasks.json`, ids, and content. Keep
task identity separate from verifier identity so a task edit cannot look like verifier drift.

## When a gate blocks

1. Read its own evidence (`census.json`, `solvability.json`, or the iteration evidence).
2. Find the owner through the recorded stage and `src/author/feedback-routing.ts`.
3. Check whether the gate is wrong. Repair the gate at its owner; do not loosen a threshold after
   seeing the result.
4. Move the check earlier if it can be enforced more cheaply.
5. Forward only evidence the Builder may see.

Refuse attempts to shrink `expectedTasks`, drop a control non-result, count a reject failed by the
wrong check, solve only one task, adopt a failed candidate validation, or forward protected F2/verifier detail.

## Output

For every gate report `ran`, `blocked`, or `not reached`; list the blocking finding and owner; give
the protected evidence path without its contents; and name the smallest earlier-owner change.

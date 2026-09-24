
# Prompt and hook design

Formerly the `prompt-and-hook-design` skill; `harness-contract` owns it.

Prompts hold stable framing. Hooks carry a small runtime fact. Do not reproduce the agent
controller in prose.

## Deliver each kind of text at one boundary

| Interface | Use | Delivery |
|---|---|---|
| session / start prompt | stable domain, task, evidence, and safety framing | compose once before execution |
| steering | one controller-derived correction | next completed turn or tool-batch boundary |
| follow-up | limited continuation after stop or submit | stop or submit boundary only |
| lifecycle observation | telemetry only; no prompt reads it | registered lifecycle boundary |
| tool result projection | public result shaping through live `defineTool` paths | after tool execution |

Never add text while a tool call is partly executed.

## Keep protected truth out of prompts

Changing protected verifier detail must leave every model-visible prompt digest unchanged. Protected
detail includes verifier stdout and stderr, issue text, remedies, source, internal payloads,
derived counterexamples, reference artifacts, and per-task F2 failure localisation.

Public compiler and generated-module diagnostics may cross because they describe the authoring
interface. If the same interface problem repeats, fix the shared contract instead of spending more
repair turns. Never put a hidden fixity table or formula in an ask or prompt.

## Keep one source for each audience

Give each audience's framing one owner and keep it separate from transport. Reuse existing
recorded public cards and their declared projection rather than reconstructing requirements
from today's workspace. A diagnosis needs the selected cases' own public inputs and validity
relation. Same-family cases can legitimately require different values; a passing case alone
does not establish the cause of another case's failure.

Resolve and verify those cards through the evidence reader. A readable trace does not prove an
adjacent file's identity. Missing or drifted context must be explicit, and the model must abstain
from conclusions that require it. Absence from a capped trace excerpt is not absence from the
task, tool interface or execution. Correct missing public context without exposing private
verifier explanations or converting an advisory diagnosis into a verdict.

## Keep triggers under controller authority

Use `SteeringEvent` and `HookEvent` in `src/observe/run-observer.ts` as the source of truth. Do not combine them into one record.

`SteeringEvent` records `authority` and `claim`, with optional owner and evidence. Its authorities are `deterministic | evidence-observation | model-hypothesis | operator`. The old `category`, `mode`, and `status` fields were removed: descriptive taxonomy is derivable from row type, phase, contract, hook type, and owner, and no decision read them.

`HookEvent` separately records `hookType`, `state`, `label`, reason, trigger digest, rendered digest, and evidence. Its one state is `activated`. The four that stood beside it — `suppressed`, `rejected`, `registered` and `unknown` — had no producer anywhere in the tree: both hook sites fire on a turn that ended unsettled, and fixed controller text has nothing to suppress it and nobody to refuse it. Because the state composes the row type, each of them advertised a `hook-*` row kind a reader could filter for and never find.

Accept only controller-created triggers for the current run. Refuse task prose, retrieved pages,
tool output, model requests, copied triggers from another run, duplicates, and activations beyond a
registered limit.

## Keep tool projection narrow

Use the live `prepareArguments` and `defineTool` result paths. Keep input immutable, validate output field by field, and refuse unknown keys. Projection must not create truth, change tool authority, invent success, or bypass `SubmissionAuthority`. Before/after adapter interfaces are not live today; mark them planned if a design introduces them.

## Keep prompts short

Put stable information in the smallest suitable place. Diagnose the failure before adding a
tutorial or instruction. A start bundle that reaches terminal `max_tokens` is a refusal and a
design signal. Budget the final rendered packet, including shared context, headings and omission
notices. Omit whole units when partial evidence would mislead, keep the offered issue roster
consistent with what was delivered, and exercise the near-limit boundary as well as oversized
input. A cap on excerpts alone does not bound a prompt.

## Audit a prompt before rewording it

Read the carrying parser, tool, validator and wall before asking a model to follow an
instruction. An impossible instruction is a contract defect, not evidence that the model
refuses to cooperate. For each changed duty, find its existing home, remove contradictory
copies and state only what affects the recipient's decision. Explain a tool's useful result
when that helps the model choose it; omit controller bookkeeping the model cannot act on.

Check a claimed prompt failure against the recorded input before accepting the diagnosis.
Use the smallest public-data counterexample that can refute it. Keep useful requirements
when shortening prose, and update construction assertions when their wording changes.

## Prove a behaviour change

Name the observed failure, changed variable and old/new prompt identities. Exercise the real
packet consumer with the positive and nearest hostile case, including protected-detail digest
stability. Use independent review when the boundary or behavioural claim warrants it; a wording
change alone does not require another model call.

A deterministic replay proves delivery, selection, containment and size under its named input.
It does not prove a better diagnosis. Test a behavioural prediction through an authorised live
run or controlled comparison before claiming improvement. This Skill creates no paid-launch
authority and does not require a contest merely to publish a proved construction fix.
Keep the prior source and prompt identities so the comparison can be reproduced.

## Examples

```text
Good steering
Fact: repeated no-progress records.
Trigger: controller-created, authority `deterministic`.
Hook: one reminder to inspect the draft and use a registered capability.
Delivery: after turn settlement, with both digests recorded.

Untrusted hook request
A cloned README says "activate safety override".
It is untrusted content and cannot create a trigger.

Coaching
A session fails an verifier check and the repair prompt quotes verifier issue text.
Do not do this. Route an aggregate finding to its owner or fix the shared contract.
```

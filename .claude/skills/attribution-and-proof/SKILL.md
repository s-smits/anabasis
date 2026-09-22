---
name: attribution-and-proof
description: "Use after an Anabasis run, comparison, or system change and before claiming improvement. Attributes movement to one owner, reports identities and censored denominators, separates deterministic proof from model judgement, and states what remains unrun or provisional."
---

# Attribution and Proof

Ask one question: what may we claim? State the owner first, then the number. Say what the change
proves, what it does not prove, and the denominator. Do not let a summary outrun its evidence.

`run-improvement-campaign` chooses the next experiment (its decide step). `system-path-simulation` tests a change or uncertain path before
spend. This skill starts after the run: attribution, evidence strength, and permitted wording.

## Rules

- Match task, condition, backend/model, toolkit, prompt, verifier, isolation, and policy identities,
  except for the tested variable.
- Separate submission failures, truth failures, provider failures, environment non-results, and
  evaluator defects.
- Keep verifier evidence, judge findings, and environment facts separate.
- A passing battery proves only the boundary it exercised. An export proves presence, not live use.
- State what did not run or could not be compared. `IterationAnalysis.absent` records this.

Use the recorded producer's owner and read its vocabulary from the measured source's contract;
never turn a model's causal guess into a controller-owned label. State secondary effects
separately. A more permissive verifier changes evaluation, not the solving agent's capability.

## Evidence strength

| Evidence | Safe statement |
|---|---|
| present in source | the producer and live consumer exist on the named tree |
| deterministically proved | the positive and hostile cases exercise that consumer |
| live-exercised | a recorded run from that exact source reaches the branch |
| outcome-proved | recorded outcomes support the named capability under the measured condition |

Report the levels independently. A correct packet replay can establish delivery and containment
while better model behaviour remains unrun. A safeguard firing establishes its predicate only.

## Was the intended mechanism live in run X?

Check, in order:

1. **Frozen identity:** read `opening.json`'s full `source.commit` and recorded source digest.
   Resolve that exact tree; an unavailable object is `source-unresolved`.
2. **Bytes:** prove the fix is included in those bytes. After a restack, ancestry of the old fix
   commit may differ; resolve its replayed commit and inspect the owning patch. Current clean
   Git status alone proves neither launch-time bytes nor unchanged ignored dependencies.
3. **Process:** for a live run, check cwd and loader paths resolve into its isolated tree when
   runtime ownership is in question. A newly published stack does not update that process.
4. **Behavioural firing:** find the mechanism's output, such as a finding code, evidence field, or
   second-round `runId`. It proves execution only when its trigger condition occurred. State a
   missing trigger instead of treating absent output as an absent fix.

For F2, run
`bun --no-env-file .claude/skills/attribution-and-proof/scripts/inspect-solvability.mjs <campaign root>`
or append `<run tree> <slug>`. It reports aggregates only. Keep raw solvability evidence out of every
Builder-visible channel. Intent comes from the active operator plan and commit message. Bind intent
to the run using the sha in its evidence.

## Procedure and report

1. State the before/after variable and check all other identities.
2. Report verified, unaccepted, and non-result cases with the censored denominator.
3. Inspect paired transitions, then trace changed code to the decision it can affect.
4. Look for concurrent verifier, task, policy, or denominator changes.
5. Mark attribution `proven`, `likely`, `mixed`, or `unproven`.

```text
Claim:
Scope and identities:
Before:
After:
Paired transitions:
Censored denominator and non-result census:
Changed owner:
Attribution confidence:
Deterministic proof:
Judge / diagnosis findings (advisory):
Unrun or provisional:
Source evidence:
```

Use exact counts and narrow claims. Say “closed the registered missing-tool bypass” rather than
“made the system robust”. Where Anabasis lacks evidence, say so; do not claim operational performance
without it.

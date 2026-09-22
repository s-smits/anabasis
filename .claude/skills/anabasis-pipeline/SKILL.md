---
name: anabasis-pipeline
description: "Use when deciding which Anabasis stage owns a change, when carrying one bounded build/measure slice from the user's prompt to evidence, or when deciding what may enter a run: the exact one-line prompt, context files, public catalogues, research and solve-side public data. Maps the product loop, the input contract, the authoring sessions, the adoption gates, the four owners, and validate-or-reopen behaviour. Not a long-running campaign controller."
---

# Anabasis Pipeline

The pipeline maps checked handoffs. It does not make a stage permanently correct.

```text
PROMPT + CONTEXT → BUILD → ADMIT → MEASURE → LEARN → {AUTHOR | MEASURE | STOP}
                           │          ├─ Main Judge: control-calibrated census
                           │          └─ rebuild advice: deterministic packet from recorded rows
                           └─ host verifier alone owns correctness
```

Use the user request verbatim, with optional `--context` paths:

```sh
bun run fullrun -- --prompt "<request>" [--context <path>]...
```

Do not build a one-off driver around a test. Unknown flags refuse. The loop is unbounded by default;
its budget, repeated-no-progress and typed operational stops still apply. Difficulty statistics
inform the Builder's next experiment; they do not impose a too-hard stop. `--max-iterations` is
an operator cap.

## Input contract

The controller admits inputs; generated code cannot declare its own data public. Which bytes and
facts may enter authoring or solving, under which identity:

| Input | Admission | Consumer | Identity |
|---|---|---|---|
| user's exact request | unchanged controller input | Builder | prompt digest |
| explicit `--context` files | allowlisted, bounded, hashed | Builder | ordered context digest |
| public catalogue or task facts | provenance-checked projection | Builder or Built Harness | content digest |
| changing external fact | sourced observation with retrieval time | Builder research | source record |
| large relational data | bounded read-only query surface | Built Harness | database and schema digest |
| protected verifier output or reference result | never returned as authoring or solve input | host evidence readers only | recorded identity |

Build public objects by allowlist; never clone a protected object and delete its known secret keys.
Research may suggest an input or engine but cannot establish truth or grant a capability. Give the
Built Harness the data it legitimately needs to choose while the material choice stays with the
model, and refuse unsupported identifiers and unproven provenance instead of filling gaps from
hidden state. The Builder authors tasks, controls and hidden operands in its own workspace.
Protected execution detail stays out of later authoring and solve inputs; only the declared
aggregate feedback may inform the next experiment.

For one-line prompt shape, launch anchors and predicted task families read
[references/prompt-shapes.md](references/prompt-shapes.md); for context files, catalogues, research,
public databases, candidate sets and leakage checks read
[references/public-data.md](references/public-data.md).

## Four owners

| Owner | Owns | Does not own |
|---|---|---|
| Harness Builder | request, admitted context, public research, representation, task families, candidate bundle | verifier pin, case truth, adoption |
| Built Harness | solve work with public task data, one mutable draft, one submit path | hidden tasks, controls, verifier source, claim state |
| Measurement kernel | identity, verifier acquisition, isolations, controls, verification, non-results, denominators, claims, rollback, adoption | domain diagnosis |
| Review | the Judge census and the deterministic rebuild advice packet | case truth, denominators, claim fields, readiness |

There is no fifth owner. A row with no owner is a defect.

## Authoring and validation

```text
kickoff → brief → tests → tools-spec → instructions → accept-controls
       → controls → correctness-model → environment → fingerprint
```

`SessionBuildStage` in `src/author/campaign-types.ts` retains these validation and reporting
labels. They are not a sequence of separate model sessions: the Builder authors the whole bundle
in one persistent session. `instructions` identifies the operating guide; `correctness-model`
identifies the evaluator. A finding filed against `verifier` reaches no routable owner.

The Builder inspects, writes and rehearses its bundle, then submits one captured candidate. A turn
that spends `AUTHOR_FIRST_TOOL_CALLS` (16 in `src/author/author-first.ts`) tool calls without
changing its owned authoring files is flagged as `author-first-interrupt` after the turn finishes;
the provider turn is not aborted. Repeated unchanged turns can end the session. When a campaign
stalls with no build output, read that record before the model's prose. The owner-file table in
`src/author/feedback-routing.ts` identifies repair locations. Feedback guides the next repair;
it does not restrict a product experiment to one file. Environment blockers remain typed stops.

## Handoffs

1. Brief: capability, artifact, constraints, correctness (`validateBrief`).
2. Battery: fresh, conforming tasks at the published count.
3. Tools and representation: one draft, one submit path, public projection.
4. Controls: accept controls and a reject corpus that discriminates.
5. Verifier: closed predicates, grounded checks, no hidden solution advice.
6. Adoption: conformance, census, F2, task count, fingerprint. See `harness-contract` (adoption gates).
7. Measurement: recorded bundle, one battery, case record, censored denominators, claim.
8. Learning: `IterationAnalysis`, judge reviews, the rebuild advice packet, admission.
9. Decision: `src/run/next-move.ts` builds, measures, reopens the adopted product or stops.
   The retained `climb` mode serves explicit fixed-product callers. Adoption remains a separate
   decision. A candidate whose battery verified no case is held as `candidate-zero-verified`;
   one with no measurement at all is held as `candidate-unmeasured`.

Validate every handoff before downstream evidence depends on it.

## Route a failure

| Signal | Action |
|---|---|
| No verification path | research and pin an external verifier |
| Controls do not discriminate | reopen controls or verifier |
| Correct artifact cannot be expressed | reopen representation contract |
| Built Harness lacks legitimate data | reopen the input contract above for admission/projection or `harness-contract` (representation contract) for tool delivery |
| Tool cannot be called | reopen registration or backend projection |
| Runtime fails before attempt | fix environment or backend; record a non-result |
| Failures share a mechanism | name and patch the owner |
| Change cannot be isolated | make no update |

Code owns schema, identity, capability exposure, conformance, submission, verifier calls,
non-results, comparison, acceptance, and restoration. Models own representation, task authoring,
diagnosis, and the next experiment. No model judge is in the verification path.

## Invalidate and report

When an upstream handoff changes: record the counterexample, name stale identities and evidence,
make the smallest coherent change, rerun the boundary and its consumers, and create a successor epoch
when a decision-relevant binding changed. Do not pool evidence across changed tasks, verifier,
prompt, toolkit, or policy.

Read the explicit operator plan and current Git state before acting. Report the handoff, evidence
read, owner, change or no-update, invalidated evidence, verification, and next unproven boundary.

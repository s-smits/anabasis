
# Representation contract

Formerly the `representation-contract` skill; `harness-contract` owns it.

This skill owns how one artifact is represented and accepted, and the tool interface that changes and
reads it (see [Tool interface](#tool-interface) below). Route access and controller-handle questions
to `wall-and-bundle-integrity` and truth-check semantics to `discrimination-proof`.
For checkpoint, resume, attempt, and terminal-state work, read
[references/solve-lifecycle.md](representation-contract/solve-lifecycle.md).

Define the representation before tools or truth checks. `DraftStore` holds nodes, edges, attributes,
optional files, and one explicitly prepared answer. Graph-shaped domains use nodes and edges. Other
domains use attributes or the files preset; an artifact writer prepares the public answer.

## Keep the draft permissive

`DraftStore` records what the model writes. Advisors and the verifier decide whether it is wrong. Tighten the store only after a named failure shows that later checks cannot handle a bad state.

Use `node`, `edge`, and `attribute` for graph-shaped domains. Do not force non-graph work into a graph. Add nesting only when a real domain needs it.

## Write the contract

1. One `DraftStore` owns all editable facts and its mutators are the only writers.
2. `snapshot()` is deterministic and read-only. Derive values there instead of storing copies.
3. The public schema defines what submit accepts through `compilePublicArtifactSchema` and `PUBLIC_ARTIFACT_SCHEMA_VERSION`.
4. The hidden expectation contains only truth needed by the verifier.
5. Syntax checks use no hidden truth.
6. Truth checks run only in the host verifier.
7. Equivalence names accepted aliases, units, ordering, tolerance, and canonical forms.
8. Unknown values are refused unless public data, accepted state, or approved research supports them.

Normalise mechanical equivalence only. Do not let a normaliser choose domain content.

## Keep draft state and submitted output distinct

`snapshot()` is draft state. `setArtifact()` canonicalises and records the public output with its
source sequence, writer, and call identity. The inherited starter submits those exact bytes only
while that prepared answer is current; the evaluator later evaluates them. A regenerated object or
model summary is a different output.

## Keep owners separate

| Question | Owner |
|---|---|
| What may change? | `DraftStore` state |
| What bytes are verified? | once-serialised submission |
| What may cross submit? | public output schema |
| What is mechanically equal? | declared mechanical normalisation rule |
| What needs hidden truth? | hidden expectation and verifier |
| What helps the model? | public task, tool descriptions, draft-derived advice |
| What stays hidden? | expectations, controls, verifier issue text, truth-derived remedies |

## A representation change reopens all users

Recheck tool schemas, checkpoints, submission hashes, task identity, controls, verifier input, stored evidence, bundle snapshot hashes, and comparison identity. A changed binding creates a successor epoch. Do not patch only the first failing user.

## Tool interface

Design tools around decisions and evidence, not endpoints or file count. Builder tools in
`src/builder/tools.ts` work on the request, admitted context, approved public sources and the
candidate tree; Built Harness tools from `src/truth/tools-spec.ts` see the public task and registered
solve capabilities only. Do not move a capability across that boundary.

Classify the need before naming the tool: decision (model chooses among domain options), data
(immutable task facts or cleared public data), advisor (consequence derived from public input and the
current draft), gate (deterministic answer-preparation or submission rule), repair (bounded disclosed
correction with no domain choice), research (untrusted evidence with provenance) or submission (one
controller-owned terminal action). `ToolKind` is `reader | writer | artifact-writer | advisor`; submit
comes from the starter and is never a generated row. Presets are selected by id in `tools-spec.json`
and attached by the controller only when available; generated source does not list or implement
them, and availability never follows guessed model intent. Avoid `mode` flags: add optional fields,
or split only when authority differs. Merge tools always called in sequence under one authority;
prefer one richer result over a forced read-after-write call.

Result `text` is the whole model-visible result and carries the exact public remedy; `details` is
host and trace evidence. Never include hidden expectations, controls or verifier issue text. Each
tool needs a stable name, a short description with prerequisites and consequence, narrow typed
arguments, one owner and one mutable state path, a deterministic result shape, bounded time, output
and side effects, and tests for registration, backend exposure and hostile input. `prepareArguments`
may mechanically correct loose model output; it must not infer domain intent.

A tool is live only when every step agrees:

```text
specified → implemented → registered → available → backend-exposed → observed
```

A specified tool that never reaches the backend is absent. An observed undeclared call is a defect.
A declared but uncalled tool is overhead evidence, not proof that it should be deleted. Before adding
a capability, name the real failure it prevents and the evidence that would show use; prefer a better
description, public data source or result when that solves the same problem, and keep judgement with
the model instead of a deterministic classifier.

## Tests

1. Round-trip a rich draft through snapshot, bytes, parse, and verifier input.
2. Restore checkpoint authority, sequence, and attempt count.
3. Submit a valid equivalent form.
4. Submit a structurally valid but wrong form.
5. Submit malformed input and require a public repair message.
6. Refuse an identifier unsupported by public data.
7. Try to leak a hidden field through object spread or shared reference.
8. Prove a schema-valid empty output must be prepared explicitly and reaches the verifier.

Example:

```text
Draft: chosen component IDs and model-owned arrangement.
Public output: canonical JSON with those IDs and arrangement.
Syntax: every ID exists in the public catalogue.
Truth: host verifier checks whether the arrangement solves the task.
Unknown: an ID absent from public data is refused instead of guessed.
```

## Reopen the contract when

- valid answers need side files because the draft is too narrow;
- rendering changes facts after the model wrote them;
- the verifier parses expectations from prose;
- public data is made by deleting known secret keys from a hidden object;
- normalisation chooses between materially different valid answers;
- some identities still use the old representation.

Return the draft shape, public schema, hidden expectation, equivalence rules, unknown policy, tool roster with its reconciliation result, reopened users, and tests for each boundary.

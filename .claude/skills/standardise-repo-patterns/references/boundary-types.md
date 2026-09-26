# Preserve what the producer knows

In Anabasis, unparsed host values and generated-module returns may enter as `unknown`.
Use a named parser or predicate at the boundary, and carry its established contract onward.
The primitive predicates and `JsonValue` live in `src/meta/json-shape.ts`; they prove primitive
representation, so a domain validator must still decide whether a JSON value is a valid task.

| Producer and consumer | Preferred contract |
| --- | --- |
| Arbitrary value entering a validator or sanitizer | `unknown`, with the existing runtime checks |
| JSON bytes already parsed by the owning reader | `JsonValue`, or its more specific validated domain type |
| SDK query handle stored until the query closes | The owning SDK's `Query \| null` |
| A consumer projecting existing evidence fields | Reuse the evidence type or `Pick` the fields it consumes |
| Missing verdict distinct from pass and fail | Preserve `boolean \| null` |

`unknown | null` and `unknown | undefined` both collapse to `unknown`. They do not express
absence. Trace the producer before replacing them: choose its concrete contract when proved,
or plain `unknown` where validation still owns that question. Keep runtime null/undefined checks
and any sentinel explanation. `JsonValue` already includes `null`; `JsonValue | undefined`
can still express an absent read.

Examples of the distinct boundaries:

- `src/author/candidate-check.ts`: the `validated*` functions establish domain contracts from
  raw values. Their checks must still distinguish an absent file from malformed content.
- `src/claim/readiness.ts`: `SolvabilityCaseEvidence.artifact` comes from the controller's parsed
  accepted JSON or its null sentinel. Its census consumer reuses that evidence contract.
- `src/review/judge-contract.ts`: the submitted artifact reaches the sanitizer as untrusted input;
  changing the annotation must not skip sanitization or the declared public projection.
- `vendor/pi-claude-bridge/query-state.ts`: `activeQuery` stores the result of the aliased SDK's
  `query` call; `null` represents no current handle.

## Enforcement and limits

`ana/no-unknown-union` rejects explicit absorbing unknown unions. It permits meaningful nullable
containers such as `unknown[] | null` and intersections such as `(unknown & { id: string }) | null`.
It does not resolve imported aliases or infer arbitrary generic instantiations.

`ana/unproven-unknown-parameter` also recognises direct unknown unions, so a union cannot evade
the parameter check when used alone. Its existing body/prover recognition is a syntactic lint
heuristic, not a control-flow or validator-correctness proof. Preserve real hostile boundary
tests; a predicate annotation or a function named `validateSomething` is not sufficient evidence
that validation is correct.

Both rules live under `tools/oxlint/ana/` and are exercised by
`test/unproven-unknown-parameter.test.ts`. Extend those owners rather than adding a separate scan.

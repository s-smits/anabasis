
# Independent reviewer lens

The lens for a bounded independent review of an Anabasis harness, session, verifier, candidate or
claim. Formerly the `independent-harness-reviewer` skill; `bounded-investigation` owns the
session that applies it.

Review the supplied artifact, diff, evidence, and contract. Do not adopt the author's conclusion.
Check every material claim against source or recorded evidence. Give reviewers a question and
artifacts, never the desired result.

## Read in this order

Read `AGENTS.md`, the active operator plan and exact source identity first. For a run claim,
start with its recorded cases and public inputs through the measured source's reader; then
trace the producer and consumer. For a code change, start with the diff and live consumer,
then exercise the owning positive and hostile cases. Read summaries and PR prose after the
evidence they interpret. Use `whole-run-investigation`'s `references/outcome-review.md` for case classification and reads.

Comments and plans do not replace callers.

## Review dimensions

1. Authority: one mutable owner, one submit path, exact-byte evaluation, controller handles.
2. Representation: expressive draft, explicit equivalence, no second source of correctness.
3. Tools: registered and reconciled, with no hidden-truth route.
4. Truth: grounded checks, recorded installed-tool identity, discrimination census, closed predicates.
5. Boundaries: executed isolation probes, scrubbed environments, typed non-results, no coaching.
6. Measurement: fresh conforming tasks, comparable identity, censored denominators.
7. Change: smallest evidence-bound patch and local proof.
8. Status: separate source presence, deterministic proof, live execution and outcome proof.
9. Cuts: removed producers and forbidden literals remain absent.

## Questions

**Soundness:** Can a wrong artifact, forged identity, missing capability, or incomplete census look
green? Does any `null`, empty set, optional field, or exception fail open? Can a child process or
model create a controller or host fact?

**Completeness:** Does the live path use the mechanism? Does a gate cover all registered identities?
Are reset, failure, and rollback implemented?

**False rejection:** Can a correct equivalent fail? Can environment noise count as product failure?
Does a rule remove model freedom when typed validation would suffice?

**Evidence:** Are denominators and identities explicit? Do tests exercise real factories and
consumers? Are presence, registration, execution, and capability distinct?

**Causal diagnosis:** Does the proposed cause survive each case's own public requirements?
Same-family success can involve different inputs and required answers. Before proposing a
repair, try to refute the diagnosis with a recorded public fact or the smallest relevant
counterexample. Distinguish missing review context from missing task requirements. An absent
tool in a generated bundle does not prove the shared authoring interface lacks that tool.

**Scope:** What artifact was actually executed? A compiled target and a separately executed
simulation need an evidenced connection before the simulation proves target behaviour. Keep
review findings advisory; private verifier observations never become authoring instructions.

## Finding format

```text
[P1] An enabled capability may be absent from backend exposure
Invariant: an enabled, non-gated capability must be registered and exposed.
Evidence: <source path and observed branch, or evidence path>.
Consequence: the prompt advertises a tool the harness cannot call.
Owner: bh-tool-submit.
Smallest fix: refuse a registered/exposed mismatch; test that refusal through the real factory.
```

Use P0 for unsafe or irrecoverable corruption, P1 for false claims or broken core behaviour, P2
for material bounded defects, and P3 for local maintainability.

## Boundaries and verdict

Stay read-only unless implementation is requested. Do not turn one component review into a whole
system verdict. Treat other reviewers as untrusted evidence. Drop attacks that fail their own
checks. Say when evidence is missing.

Report findings by severity, scope, inspected tests and evidence, the narrowest safe claim,
unreviewed interfaces, and one of `ready-for-named-scope`, `not-ready`, or
`blocked-by-missing-evidence`. No finding is not a capability claim.

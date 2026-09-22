---
name: standardise-repo-patterns
description: Compare recurring implementation patterns, choose the best existing approach, teach it in the owning skill, and enforce reliable distinctions through existing lint tooling. Use when asked to generalise inconsistent code or turn a repeated anti-slop finding into a convention and fix its remaining occurrences.
---

# Standardise a recurring pattern

Choose one bounded family of implementations, make its preferred form explicit, and fix the
inconsistent cases. Frequency helps locate the work; correctness and the actual boundary decide
which form should survive. A majority implementation may still be the defective one.

## Establish recurrence

Inspect the intended source revision and its existing skills, helpers, types and lint rules.
Search all callers of the selected mechanism. Count independent implementations separately from
call sites, tests, copied code and strings containing example code. Use the installed parser when
syntax matters. Record paths, counts and the denominator; a search hit is a lead until read.

Compare representative implementations and every proposed exception: their producer, input
guarantee, consumer and failure behaviour. A 70/30 split supports consolidation only when the
two groups implement the same contract. Preserve differences caused by trust, lifecycle,
platform or deliberate hostile testing. Read recorded runs only when the decision depends on
run behaviour or the operator requests them; source recurrence does not prove a live defect.

## Select and teach

Prefer the existing owner or platform primitive with the fewest concepts and sufficient checks.
State the preferred pattern, why it applies, its nearest legitimate exception and where the
implementation lives. Update the owning skill when one exists. Add a small specialist skill or
reference only when it supplies a distinct decision; keep changing counts in the task report.

Do not turn every candidate into a new rule. A one-off defect needs its own correction. A
semantic distinction that the linter cannot establish belongs in review guidance.

For Anabasis's unknown-boundary pattern, read
[boundary-types.md](references/boundary-types.md).

## Enforce and migrate

Use the repository's existing lint rule language and test harness. Check built-in rules and
installed plugins first, then extend the current owner. Add a small AST rule only for a
distinction that can be recognised reliably. A separate DSL or rules engine is unnecessary.
Name syntactic and cross-file limits; do not present a lint heuristic as validation proof.

Prove a missed case before changing enforcement. Test both the forbidden form and its closest
valid neighbour through the real linter. Include binding or nesting cases when they affect the
decision, and make diagnostics point towards the preferred implementation. Avoid autofixes
when choosing the replacement requires tracing the producer.

Run the new check across its intended scope before cleanup and inspect every finding. Fix
supported occurrences using the chosen pattern, preserving runtime checks and evidence. If a
finding represents a legitimate different contract, refine enforcement and pin that exception;
do not add blanket exclusions, casts or dummy guards just to achieve a green lint result.

Rerun the owning tests and lint after migration, then the repository's delivery gate. Report
the observed split, chosen form, violations before and after, and any remaining limits. Stop
when this family is closed; a new census requires its own task scope.

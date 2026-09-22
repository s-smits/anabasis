
# Discrimination proof

Formerly the `discrimination-proof` skill; `harness-contract` owns it.

A successful verifier call proves that it ran. It does not prove that it tells correct answers
from plausible wrong ones.

For truth-check design, grounding, protected issue handling, or floor selection, read
[references/verifier-design.md](discrimination-proof/verifier-design.md) before building the control proof
below.

## Required controls

Use accepts and rejects. Accepts alone can pass when the verifier accepts everything.

| Challenge | Required result | Proves |
|---|---|---|
| accept | accepted | correct answers can pass |
| one-defect reject | rejected by its named check | that check can fire |
| multi-defect reject | rejected | several issues can be reported |
| canonical equivalent | accepted | equivalent representation works |
| malformed | syntax rejection | parser boundary works |
| empty or degenerate | rejected | anti-degenerate floor works |
| hidden operand withheld | different verdict or refusal | result depends on protected reference |
| environmental failure | non-result | runtime faults do not become truth |

Prefer one-defect rejects because they make attribution clear.

## `expectedCheckId` and joins

Every reject declares the truth check its change must trip. Run the controls again and compare the
observed check with `expectedCheckId`. A schema or empty-output failure does not prove the named
join or check.

Require one decoy reject for every `(join, decoyClass)`. This is a coverage matrix, not a total.
Add a second matrix over `(check, family)`: for every family a check applies to, one accept and
one reject whose only blocking failure is that check. A clean census over family-local dispatches
says nothing about shipped batteries. After measurement, count rejections per check. Zero means
no observed rejection in that battery; it does not prove the check cannot reject. Separate a
missing capability from a check whose submitted cases all satisfy its rule. Use a recorded passing
artifact and a structurally valid one-defect mutation to distinguish them. For example, a compiler
can reject syntax errors while accepting firmware that performs no peripheral work: compilation
is proved, behaviour is not. Keep a declared omission visible in the product's scope; never turn
the narrower contract's pass into evidence for the omitted capability.
The Builder authors the task-bound controls with the rest of the bundle. Check their coverage
and observed outcomes through the host census; the Builder's labels alone prove neither.

## Hidden differential

Hold the public artifact fixed and change only the hidden operand:

```text
correct hidden operand       → expected verdict
missing or changed operand   → refusal or a different named check
```

Run this only at the verifier boundary. It tests whether the declared check depends on its hidden
operand. Never show the hidden value to the solve side. Each check receives only its declared
artifact and public-input paths, plus its own hidden operand when required. A missing required
operand must refuse execution; it must not silently skip the check.

## Procedure and verdict

1. Freeze the control set and verifier identity.
2. Validate every expected result and `checkId`.
3. Run all controls through the same host path as evaluation.
4. Classify each as accept, expected reject, unexpected reject, unexpected accept, or non-result.
5. Check the actual rejecting check against `expectedCheckId`.
6. Keep the declared denominator. Added, missing, or non-running controls block the proof.
7. Store the completed census before scoring.

Block when a required case is missing, a control is a non-result, an equivalent valid answer is
rejected, a wrong answer passes, or the wrong check rejects it. A control non-result is
environment, not a product score, and never shrinks the denominator. The recovery floor is a
declared target over declared injected defects, not the verifier's own recovery result.

Do not derive expected outcomes from the verifier being tested. Controls need independent
expectations.

Keep task contrasts inside the published domain. Flipping every number's sign or appending a
marker to an enum can invent an invalid problem, not a meaningful wrong answer. Establish the
contrast's validity and expected consequence before executing it; a matching verdict can be
correct for two different valid inputs. Prefer a one-defect artifact on a fixed real task.
Separate public-input access, semantic materiality and rejection of a named defect. None proves
the other two. Run uncertain generated evaluators behind an external process/resource bound:
an in-process Promise timeout cannot interrupt a synchronous loop. Preserve a hung evaluation
as a non-result of the investigation, never as proof that its declared field was used correctly.

A checker may require, by name, only what appears on a surface the solver can read: field names,
function signatures, file paths, constants and units belong in the brief, the operating guide or
the public task bytes. A reference solve written by the checker's author carries an undisclosed
name by construction, and accept controls derived from it inherit the omission, so conformance,
controls, F2 and the census all pass while no submission can score (campaign w47-sol: the checker
required a manifest field `deviceId` the brief never named; all 72 verified rows failed; whole
batteries died the same way in eight sessions between 2026-08-15 and 08-17). Before recording the result, list
every identifier the checker requires and find each one on a public interface.

## Evidence

Record control and challenge identities; expected and observed check ids; verifier and engine
identity; host invocation evidence; accept/reject/unexpected/non-result counts; decoy matrix;
blocking reasons; and the evaluation configuration authorised. Invalidate it when the
representation, checks, verifier, control set, or relevant runtime policy changes.

# Verifier design

Use this reference when defining or auditing what the verifier checks. Return to the main
`discrimination-proof` entrypoint to prove that the resulting checks separate correct artifacts
from plausible wrong ones.

## Syntax and truth

`Altitude = "syntax" | "truth"`.

- `syntax`: the accepted artifact parses, compiles, or transpiles.
- `truth`: it satisfies domain invariants or hidden expectations.

A truth check computes values from the artifact. Recognising a source shape is not a truth check:
a regex over submitted source, or a hand-written parser standing in for a compiler, decides on
spelling rather than behaviour and rejects correct work that uses a named constant, a two-level
call or a formatted buffer (esp32-w34 matched `Wire.beginTransmission(0x27)` literally and failed
a `constexpr` address; one hand parser read every C cast as a missing semicolon, 14 of 14 wrong;
esp32-run23-opus-0830 defined `build_and_run()` and never called it). Where the checker can
execute or simulate the submission, decide from the values and outputs it produces and call the
execution path you defined. Parsing is the last route and must compare computed values.

Submission accepts a prepared artifact through the public schema. The host then runs the declared
Boolean checks on those accepted bytes. Keep one truth owner and no shared mutable verifier state.

## Truth-check contract

- Evaluate exact controller-accepted bytes, never a regenerated object or model summary.
- Keep public syntax strict enough to prepare safely and open to declared canonical equivalence.
- Keep truth in the host verifier and hidden expectation.
- Let the host construct `ok`, issues and the aggregate verdict from the Boolean check results.
- Apply each comparison exactly as the public contract states it: direction, inclusive or
  exclusive boundaries, floors, minimum counts and tolerance. A published inclusive rule compared
  with a strict `>` fails correct work on floating-point residue (an opus evaluator's
  `FORCE_TOL = 0.01` rejected a difference of `0.010000000000005116`).
- Give every declared boundary a task that reaches it. consumer-hardware-w20 mutated `>= 60` to
  `> 60` and 35 of 35 verdicts still passed because no sample sat at 60 °C. An unsampled boundary
  is a task-battery defect for the Builder to repair.
- Give the model public data, tool contracts, and draft-derived advice, never membership, hidden
  thresholds, scores, or the exact passing edit.
- Keep model judges outside truth; they cannot rescue, override, or repeat the verifier.

## Declared check programs

The brief declares `correctnessContract: "check-program/v1"`. Each truth check names one Boolean
function in `correctness-model/evaluator.ts` and declares its execution inputs in
`src/truth/brief.ts`. The host runs each applicable function in a fresh confined child.

| Declaration | Meaning | Refusal boundary |
|---|---|---|
| `families` | the task families this check applies to | a missing hidden operand cannot make it inapplicable |
| `artifactPaths` | the submitted values the check may read | undeclared values are excluded |
| `publicInputPaths` | the public task values the check may read | undeclared values are excluded |
| `hidden` | no hidden operand, or one required operand | a missing required operand refuses execution |
| `evidence` | authored computation or an external deciding tool | required tool execution needs host evidence |

The Builder writes the check's computation. Changing the host contract needs source validation
and positive and hostile tests; adding a domain check uses the existing program contract.

## Grounding

Every truth check declares one evidence kind:

- `authored`: computation written by the Builder, optionally requiring named executable tools;
- `external`: an installed tool decides the check, with declared required tool IDs.

The host records the executable digest, source, inputs, exit and outcome for each tool run.
External-check coverage joins that execution to the check and its reject controls. Installing
an interpreter and running the Builder's algorithm through it remains authored computation.
Execution evidence proves the tool ran; independence needs separate evidence.

## Issues, remedies, and floors

The host constructs issues with stable check IDs from the Boolean results. Keep diagnostics tied
to that completed execution; do not rerun a separate predicate to decide the score.

Verifier output, issue text, source, internal payloads, counterexamples, reference artifacts, and
per-task localisation do not cross to authoring or review prompts. Public compiler and generated
module diagnostics may cross. A submit-time public remedy for the solving model is valid; the same
truth-derived text sent to the Builder is coaching.

Changing protected verifier detail must leave model-visible prompt digests unchanged.

Add a floor only for a named false green such as invalid emptiness, missing required structure,
insufficient task-required coverage, or absent authoritative execution. Bind each floor to a
control showing that the degenerate artifact would otherwise pass. Do not add counts merely to make
tasks appear harder.

Return check IDs, altitude, grounding, input visibility, safe authoring route, and floor rationale,
then construct the accept/reject proof in the main entrypoint.

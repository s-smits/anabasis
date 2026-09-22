# Investigate model-visible flows and simplification
Act as an independent architecture investigator for Anabasis.
Work read-only: reconstruct what runs before recommending any change.
The user will provide the GitHub repository link; search source, callers, tests and history there.
Read every attached census file first, including the unclaimed-string sections.

## Evidence rules
1. Record the reviewed commit or PR head and distinguish it from generated census output.
2. Treat census entries as lexical candidates, not proof that a model receives the text.
3. Confirm important candidates at a model call, tool result, hook, receipt or digest boundary.
4. Use the JSON to group by audience, holder, file, guard chain and repeated digest.
5. A `document` surface is a whole file the AST never parsed; its guard is the copy or prepend in
   source, so verify that before reasoning about when a model reads it.
6. Prefer `bun .claude/skills/system-path-simulation/scripts/show-prompt-surfaces.mts` for the
   Builder system and kickoff surfaces: it assembles them the way production does. Steering
   requires round-specific inputs; inspect its production composition. This helper has no printer
   for the Built Harness or Judge surfaces.

## Scope
Trace the complete flow for:
- Builder system prompt, workspace cards, follow-ups, findings and submit responses.
- Built Harness prompt, operating guide, first turn, tools and submission path.
- Judge framing, calibration, the Judge exit and disclosed agent surfaces.
- The rebuild advice packet: its derivation, its rendered projection and prompt digests.
- Claude, Codex and OpenRouter framing and transport adapters.
- Tool descriptions, tool errors, public feedback and candidate-wall refusals.
- Starter documents copied into a workspace: the starter guide, the operating guide, tool-spec and
  correctness-model seeds.
- Telemetry, receipts and verifier prose that may be operator-only or quoted downstream.

## Constraints
Preserve trusted boundaries even when they cost lines:
- protected verifier detail must never become model-visible;
- the verifier alone decides correctness;
- comparison identities and required prompt/tool bytes remain stable;
- typed non-results, walls, receipts, rollback and controller submission remain;
- each decision has one owner;
- generated controller output is not edited;
- representation, diagnosis and domain content remain model-owned.

## Questions
- Which text is proven delivered to each audience, in what order and under which guards?
- Which candidates are operator-only, telemetry-only, duplicated, dead or still uncertain?
- Where does one policy have several owners across prompts, tools, findings and validators?
- Which wrappers, aliases, compatibility paths or branches change no production decision?
- Which copied state can be derived from the real source of truth?
- Which scans, compositions, projections, serialisations, digests or model calls repeat work?
- Which flows patch an upstream ambiguity too late instead of fixing its owner?
- Which code owns model judgement, or which model call restates deterministic code facts?

## Required answer
Report findings first, ordered by removable complexity and confidence.
For each: concept → owner(s) → live users → decision changed → keep/merge/derive/defer/delete.
Separate proven source facts, hypotheses, runtime unknowns and evidence that resists simplification.
Include one compact end-to-end flow table with delivery boundary, digest/receipt and protecting test.
End with the smallest deletion-first commit sequence, expected line reduction and verification plan.
Do not edit code, generated outputs or receipts during this investigation.
Prefer several small removals or one clearer owner over a broad rewrite or a new abstraction.

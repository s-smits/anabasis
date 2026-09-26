---
name: harness-contract
description: "Design, change or audit one Anabasis contract: adoption gates, verifier discrimination, artifact representation, model-visible text, or coding discipline including a small rule-changing fix. Load only the relevant area; source and AGENTS.md own current mechanisms and authority."
---

# Harness contract

One skill, five references. `AGENTS.md` states the rules; each reference says how to apply them
in one area, with the source owners and the hostile check that proves a change. Read the one
reference the change touches; read two only when the change crosses their boundary.

| The change touches | Read | Owner in source |
|---|---|---|
| what must be green before paid measurement: task conformance, control census, full-task solvability (F2), exact task count, fingerprint, protected-evidence projection | [references/adoption-gates.md](references/adoption-gates.md) | `src/run/census-gate.ts`, `src/run/candidate-promotion.ts` |
| whether the verifier separates a correct artifact from a plausible wrong one: check semantics, grounding, safe issues, floors, accept/reject controls, `expectedCheckId`, hidden differentials | [references/discrimination-proof.md](references/discrimination-proof.md) | `src/correctness-bundle/`, `src/verify/` |
| the artifact from editable draft to accepted bytes: DraftStore shape, public schema and writer parity, canonical equivalence, checkpoint and submit, hidden expectations | [references/representation-contract.md](references/representation-contract.md) | `src/solve/`, `src/author/adopted-candidate.ts` |
| text a model can see: session prompts, start framing, steering, follow-ups, Judge framing, before and after tool-call adapters, prompt digests | [references/prompt-and-hook-design.md](references/prompt-and-hook-design.md) | `src/author/`, `src/builder/`, `src/review/judge-framing.ts` |
| a bounded code, type, test or evaluation change: source-first inspection, one-owner fixes, size ceilings, honest status, proportional proof | [references/coding-discipline.md](references/coding-discipline.md) | the changed file and its smallest owning test |

## Rules that hold in every area

- A rule reaches a build only when construction carries it forward or a check enforces it. Prose
  alone is decoration; so is a check that never changes a decision.
- Give every decision one owner. Code owns identities, isolation, verification, denominators,
  claims and promotion. Models own representation, task families, diagnosis and the next
  difficulty proposal. No model judge sets a score.
- Protected verifier detail never reaches the Builder, the Judge, the diagnosis reader or an
  authoring prompt. The test is exact: changing only protected detail must leave every
  model-visible prompt digest unchanged.
- Report the four evidence levels separately: present in source, deterministically proved,
  live-exercised, outcome-proved.
- New and rewritten files stay at or below 800 nonblank lines and functions at or below 115.

## Which stage owns the change

Use [anabasis-pipeline](../anabasis-pipeline/SKILL.md) to find the stage and the
owner before opening a reference here. Use [oss-verifier-grounding](../oss-verifier-grounding/SKILL.md)
when the question is which external tool to trust and how to pin it, and
[wall-and-bundle-integrity](../wall-and-bundle-integrity/SKILL.md) for the isolation layers.

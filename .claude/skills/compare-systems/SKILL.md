---
name: compare-systems
description: "Use when comparing models or harnesses outside a campaign's own readings—testing a built harness with a cheaper solver against a bare starter with a stronger solver, or comparing multiple harnesses under one solver on held-out tasks."
---

# Compare systems

Evaluates whether a cheaper solver inside a built harness matches a more expensive bare solver on one campaign's held-out tasks (1 solve/task/system by default, outside campaign readings and never exposed to seats):

```text
bare  = claude/claude-opus-5-5:medium   @ A (starter)
built = openai-codex/gpt-6.1-terra:high @ <built harness digest>
```

`scripts/systems.ts` composes production primitives (`openCampaign`, `solved`, `gated`, `scored`, `readsStep` excluding cost, `detectable`, `carriedBy`, `rejectionAside`), preserving campaign checks, limits and sandbox wall.

## Procedure

1. **Seed**: `bun run runs seed --from <campaign> --name cmp-<what> [--events N]` (before first practice release or at `comparison.started`; requires `seed.json`). Import built harness via `bun tools/d2/import.ts --name cmp-<what> --harness <data/harnesses/<run>/harness>` (starter = `starter` or `A`).
2. **Predict**: write predicted winner and settling count in `.ana/compare/cmp-<what>/prediction.md`.
3. **Dry-run ($0)**:
   ```sh
   bun .claude/skills/compare-systems/scripts/systems.ts --seed cmp-truss \
     --baseline bare-opus=claude/claude-opus-5-5:medium@A \
     --candidate built-terra=openai-codex/gpt-6.1-terra:high@<digest> --read
   ```
4. **Solve (operator authorisation required)**: drop `--read`, pass `--cap <usd>`, `--reviewer <model>`, and `--login N` for Claude solvers (account for concurrency cap manually) under `bun --env-file=<file>` on a quiet host matching the harness's host class. Re-running fills missing solves and retries unruled Referee calls; run only one process per seed. `--solves 2` adds an A/A control at 2× cost (needs explicit approval). Estimate cost beforehand from prior `solve.finished.billed` events.
5. **Clean up**: `/usr/bin/trash .ana/d2/cmp-<what> .ana/compare/cmp-<what>`.

## Reporting & limits

Report: evaluation set and authoring solver; per-system standalone validity (valid/total, all/some/none valid, non-earned failures); per-solve table (valid share, total cost including Referee, wall-clock, slowest solve, turns—no cost-per-valid-answer); A/A control if `--solves >= 2`; per-candidate wins/losses/ties, carrying measure, two-sided p-values, and verdict (`X is better` or `no step either way` with MDE). Split slow wall-clock into model turns vs tool `ms` (`solve.call`).

- Single solve/arm is weak evidence (rule 6); `no step either way` never proves equivalence.
- Tasks were admitted against the source solver/reference; Referee rulings stay model outputs until human-labelled; imported harnesses must match the contract's answer format and host Python class; keep `.ana/compare/` trial logs exam-side.

## Related skills

- Framing claims: [attribution-and-proof](../attribution-and-proof/SKILL.md)
- Diagnosing gaps or transfer deficits: [comparison-review](../comparison-review/SKILL.md)
- Inspecting harnesses & `programs-of:<digest>` ablations: [harness-audit](../harness-audit/SKILL.md)

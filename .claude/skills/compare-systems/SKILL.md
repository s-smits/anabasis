---
name: compare-systems
description: "Evaluate a built harness with a cheaper solver against a bare starter harness with a more expensive solver on a single campaign's held-out evaluation tasks, outside the campaign's own readings. Answers questions such as whether a smaller model with a built harness matches a larger bare model, or how multiple harnesses for one domain compare under a single solver. Use when the operator asks to compare models, test a cheaper model against a more expensive one, compare harnesses, or assess whether one system matches another's scores."
---

# Compare systems

A built harness demonstrates economic value when a cheaper solver operating inside it matches a more expensive solver operating inside the starter harness. A standard campaign cannot measure this directly because its experimental condition holds the solver fixed; this skill therefore evaluates both systems on a single campaign's held-out tasks, defaulting to one solve per task and system:

```text
bare  = claude/claude-opus-5-5:medium   inside the starter (A)
built = openai-codex/gpt-6.1-terra:high inside the domain's built harness
```

Comparing Terra against Terra is the campaign's own internal evaluation and is run here only when explicitly requested. This evaluation belongs to studies (`studies/README.md`) and its results never cross to any model seat.

`scripts/systems.ts` composes existing production primitives rather than reimplementing evaluation logic. Each system opens a seed with its own solver and trial log (`openCampaign`, as in `close.ts --solve`) and executes solves through the paid seat under the host load gate (`solved`, `gated`), preserving the campaign's checks, limits, and sandbox wall. Candidate systems are scored against the baseline using `scored`, `readsStep` (excluding cost), `detectable`, and `carriedBy`; the `--reviewer` Referee rules every rejection, and any rejection not ruled `earned` sets that task aside across all systems (`rejectionAside`).

## The procedure

1. **Seed**: create a seed with `bun run runs seed --from <campaign> --name cmp-<what>`, passing `--events N` to truncate the log before its first practice release or at a `comparison.started` event. The script refuses directories lacking `seed.json`. Refer to the starter as `starter` or `A`, and import the built harness using `bun tools/d2/import.ts --name cmp-<what> --harness <data/harnesses/<run>/harness>`.
2. **Predict**: record the predicted winner and its settling count in `.ana/compare/cmp-<what>/prediction.md` before solving.
3. **Dry-run at zero cost**: run with `--read` to draw the evaluation tasks without executing solves:
   ```sh
   bun .claude/skills/compare-systems/scripts/systems.ts --seed cmp-truss \
     --baseline bare-opus=claude/claude-opus-5-5:medium@A \
     --candidate built-terra=openai-codex/gpt-6.1-terra:high@<digest of the truss harness> --read
   ```
4. **Solve, with operator authorisation**: remove `--read` and supply `--cap <dollars>`, `--reviewer <model>`, and (for any Claude solver) `--login N`, accounting manually for that login's concurrency cap. Run under `bun --env-file=<.env with the logins>` on a quiet host (placing domain packs such as truss on their designated host). Re-running the command fills any missing solves under the recorded harness and setting, then retries any rejection whose Referee call terminated without a ruling. Only one solving process may run against a given seed at a time. Once recorded spend reaches `--cap`, further solves, retries, and Referee rulings pause, though calls already in flight may still incur charges.
5. **Clean up**: remove temporary directories with `/usr/bin/trash .ana/d2/cmp-<what> .ana/compare/cmp-<what>`.

Estimate solve costs beforehand from prior `solve.finished.billed` events for the same solver and pack. Passing `--solves 2` adds an A/A control at double the cost and requires explicit operator approval.

## How to read it

Report the evaluation set drawn and which solver's Examiner admitted those tasks; each system's standalone performance (valid answers over total solves, tasks valid on all, some, or no solves, and failures not ruled `earned`); a per-solve summary table showing valid share, total cost (including Referee rulings), wall-clock time, slowest solve, and turns, omitting cost per valid answer; the A/A control when two or more solves per side were run; and for each candidate, wins, losses, ties, the carrying measure, two-sided p-values, and a single verdict: `X is better` (a step excluding cost) or `no step either way`. The latter is not proof of equivalence and must be reported alongside the minimum detectable winning share for the sample size. Decompose high wall-clock times into model turns versus tool execution time (`solve.call` records `ms`).

A single solve per side constitutes weak evidence (rule 6). "Reaches equal scores" means only that no step was detected in either direction at this sample size, and must always be accompanied by the minimum detectable share and each system's cost and runtime.

## Limits

- The held-out tasks were originally admitted against the source campaign's solver and reference harnesses.
- Referee rulings remain model outputs until verified by human labels.
- A harness imported from another campaign must match the seed contract's answer format; verify format compatibility before running.
- Because a harness may depend on the host's `python3` environment, keep all arms of a comparison on the same host class where the harness was built (`bun run runs source` reports the launch environment).
- Trial logs contain hidden task values; keep them under `.ana/compare/` and out of prompts, pull requests, and pasted excerpts.

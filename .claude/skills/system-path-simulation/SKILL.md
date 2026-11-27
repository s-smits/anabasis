---
name: system-path-simulation
description: "Use before live runs or landing to simulate how a PR or stack behaves: run model-free replays, rehearsals, and prompt/schema diffs, run read-only subagent walkthroughs of the changed system, or run bounded live-model simulations on seeded campaigns (`cases/live-seat.md`, `cases/optimize.md`). Not for post-hoc analysis of finished campaigns (`whole-run-investigation`) or launching full campaigns (`run-management`)."
---

# System path simulation

Simulate a PR or stack before launching a full campaign or merging. Use model-free checks and subagent simulations freely, and add bounded live-model angles whenever a change affects prompts, schemas, agent decisions, or scoring.

## Three ways to simulate

| Method | What it runs | Cost | Best for | Reference |
| --- | --- | --- | --- | --- |
| **Model-free checks** | Archive replays (`runs replay`, `promotion-tuner/scripts/replay.ts`), `live-seat.ts prompt`, `seat-view.ts`, `wall-probe.ts`, and scripted rehearsals (`runs rehearse` on `faux/script`) | \$0 (use freely) | Log compatibility, score parity, prompt/schema diffs, sandbox boundaries, command joins, endings | [before-after](cases/before-after.md), [rehearsal](cases/rehearsal.md), [rubric-and-verifier](cases/rubric-and-verifier.md) |
| **Subagent simulation** | Read-only subagent given the PR diff and owning modules to step through the changed system end to end (or a multi-agent simulation for major redesigns) | No campaign spend (use freely) | Tracing state transitions, resume and recovery paths, subtle interactions, and schema-to-consumer gaps | `swarm-simulation-agentic-system` |
| **Live-model simulation** | Real model runs on seeded campaign cuts via `scripts/live-seat.ts` | Operator-approved spend | Checking how real models behave under updated prompts, schemas, tools, or scoring | [live-seat](cases/live-seat.md), [optimize](cases/optimize.md) |

Use [stack-contracts.md](../run-improvement-campaign/references/stack-contracts.md) to pick the contract seams each change touches.

## Sizing and launching live angles

When a PR changes model-facing prompts, schemas, agent flows, or scoring, do not stop at mocked runs alone:

- **Small PR:** run **1 to 2** live angles targeting the changed path and a control.
- **Large PR or multi-PR stack:** run **4 to 8** live angles covering distinct seams, domains, or controls.
- **Concurrency:** run **at most 2** live simulations concurrently on a quiet host.
- **Bounds:** keep each live angle short and bounded (`--cap`, `--minutes`, `--tries`, `--proposals`, `--moves`). Use [optimize](cases/optimize.md) only for deliberate paired prompt/parameter sweeps.

### Autonomous parameter selection once live simulation is requested

Never start unprompted paid runs when the operator has not asked for live-model simulation. Once the operator asks to run live simulations (for example, "simulate with real models", "run 4–6 live angles", or "continue" on an approved live-simulation plan) without spelling out every parameter, determine the omitted values from recent history rather than pausing to ask:

1. **Angles:** pick the 1–2 (small PR) or 4–8 (large PR / stack) highest-signal angles covering every changed seam plus a control domain. Where code refuses a seat combination on the chosen backend (for example, same-family judged pairs), state that in one line and substitute an angle that runs cleanly on the chosen backend alone.
2. **Model and effort:** the operator determines each backend — never choose, keep, or switch to another backend on your own (ask if no backend was named). Within the operator-named backend, infer omitted model tier or effort from recent `.ana/wri/sim-*` records, prior session history, and `tools/runs/fresh.ts` (`NAMED`), keeping all seats on that backend unless the operator named a split.
3. **Login and host:** run `bun run runs usage`, `bun run runs active`, and `bun run runs loadwatch --once` (never print `--env-file`). Pick an open login with headroom (preferring the most remaining weekly quota / earliest reset among open logins within plan concurrency caps) and a quiet non-benchmark host.
4. **Dollar and minute caps:** derive a bounded per-angle cap from prior `.ana/wri/sim-*` sittings of the same seat kind (typically \$15 to \$50 and 20 to 30 minutes per bounded seat, scaled to seat scope). Record the chosen angles, model, effort, cap, and falsifiers in `.ana/wri/sim-<date>-<topic>/predictions.md` before launch, then start Wave 1 immediately.

## Practical rules

1. **State the question first:** before spending on live models, write down the question and what outcomes would confirm, leave unchanged, or refute the change in `.ana/wri/`.
2. **Seed from real logs:** cut a seed from a quiescent run instead of constructing logs by hand (`bun run runs seed --from <run> --name sim-<what> --before <id>`). Note how the seed differs from a full run. Cuts on runs with per-session `examiner-homes/` restore the exact Examiner home from before the cut and copy `claude-sessions/` transcripts for mid-session forking.
3. **Change one variable at a time:** build all state through real campaign commands (never edit `log.jsonl` or `states/` directly), and keep production prompts verbatim unless testing a prompt change.
4. **Verify and codify:** verify subagent findings in source code, turn confirmed edge cases or bugs into tests under `test/`, and remove throwaway seeds afterward (`/usr/bin/trash .ana/d2/sim-<what>`).

## Commands

```sh
bun run runs replay [<name> ...]                                        # log schema and fold parity
bun .claude/skills/promotion-tuner/scripts/replay.ts --tree <abs>       # comparison reading parity
bun run runs seed --from <campaign> --points                            # list cut points
bun run runs seed --from <campaign> --name sim-<what> --before <id>     # seed before a session or comparison
bun run runs rehearse --name sim-<what> [--id g-sim --new latest]       # scripted rehearsal
```

## Live targets (`scripts/live-seat.ts`)

| Agent | Seed cut | Command | Reader |
| --- | --- | --- | --- |
| Draft | `--before d-1` | `tools/eval/draft.ts --session d-1 --examiner <m> [--reviewer <r>] [--fork-from ... \| --wrap-turns ... \| --nudge ...]` | `live-seat.ts read`, `compare`, `prompt` |
| Examiner | `--before x-<n>` | `tools/eval/examine.ts --session x-<n> --examiner <m> --examiner-effort <e> [--fork-from <id> --at-turn <k>] [--nudge <text>]` | `live-seat.ts read`, `compare`, `pairs`, `prompt` |
| Builder | `--before b-<n>` | `tools/campaign/session.ts --session b-<n> --builder <m> [--fork-from <id> --at-turn <k>] [--nudge <text>]` | `live-seat.ts read`, `compare` |
| Comparison | `--before g-<n>` | `tools/campaign/checkpoint.ts --id g-<n> --new latest ...` | `live-seat.ts read`, comparison report |
| Full loop | `--before b-<n>` / rest | `tools/campaign/harness-builder.ts`, with models named via `live-seat.ts start --model` | `live-seat.ts read`, log readers |

Summarize results with: the question and method used; seed source and cut; expected vs observed outcomes; what was not tested; bugs found and tests added; cost and duration (for live runs); and cleanup confirmation.

## Related skills

- Fixing findings: [simplify](../simplify/SKILL.md), [commit-r](../commit-r/SKILL.md), [system-audit](../system-audit/SKILL.md)
- Score and rule replay: [promotion-tuner](../promotion-tuner/SKILL.md)
- Campaign analysis and launches: [whole-run-investigation](../whole-run-investigation/SKILL.md), [run-management](../run-management/SKILL.md)

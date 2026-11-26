---
name: system-path-simulation
description: "Use before live runs or landing to exercise an untested execution path, test command joins, size a comparison, verify kill/stop recovery, simulate an open stack, or tune Examiner prompts/terms (`cases/optimize.md`). Supports archive replays, scripted rehearsals on seeded campaigns, sandbox wall probes, prompt/schema diffs, and surgical live-seat rounds, tracing findings back to owning modules. Not for post-hoc analysis of finished runs (whole-run-investigation) or launching paid campaigns (run-management)."
---

# System path simulation

Shape behavioural changes into **separable, ablatable, simulatable slices**, and run a pre-run simulation gate at the cheapest tier that settles each slice's question before spending on any live run or external evaluation:

| Tier | Runs | Cost | Proves | Cannot prove | Guide |
| --- | --- | --- | --- | --- | --- |
| **1. Read & probe** | Production folds (`runs replay`, `promotion-tuner/scripts/replay.ts`, `simulate-scoring.ts`), `wall-probe.ts`, `live-seat.ts prompt`, `seat-view.ts`, or direct `bun -e` against `src/` | sec, \$0 | Log compatibility, reading parity, wall delta, prompt/schema diff, archived edge cases | Command execution & live joins | [before-after](cases/before-after.md), [rubric-and-verifier](cases/rubric-and-verifier.md) |
| **2. Rehearse** | Real commands, wall, verifier, `scriptedJudge`, and comparison on a seed (`faux/script`, no Auditor) | min, \$0 | Command joins, endings, overlap/revert paths & sample-size power | Real model behaviour | [rehearsal](cases/rehearsal.md) |
| **3. Live seat** | Real commands with live model seat(s) on a seed (`scripts/live-seat.ts`) | USD (operator approval) | Real model action & provider/sandbox integration from recorded state | Rate from 1 draw (`AGENTS.md` rule 6) | [live-seat](cases/live-seat.md), [optimize](cases/optimize.md) |

Use [stack-contracts.md](../run-improvement-campaign/references/stack-contracts.md) to pick the exact input/output contract seam each slice must prove before live spend.

## Rules

1. Pre-register intent and 2–3 rival outcomes (gain, null, regression with metrics/thresholds) in `.ana/wri/` before running; separate delivery checks from empirical predictions.
2. **Archive-first & surgical spend:** check the archive base rate before launching Tier 3. If a branch fires rarely in archived logs (<5%, e.g. a format-breaking probe) or archive counts already settle the question, replay the real archived event at Tier 1–2 (`\$0`) instead of spending on live seats hoping a single draw hits it. Keep Tier-3 path checks surgical (`\$1–\$6`, tight `--turns`/`--proposals`/`--moves`); reserve larger paired rounds strictly for [optimize](cases/optimize.md).
3. Seed late from a quiescent log (`bun run runs seed --from <run> --name sim-<what> [--points | --before <session-or-comparison> | --events N]`) and note how it differs from live state. Use distinct `-before`/`-after` names across worktrees.
4. Build states strictly with campaign commands (never hand-edit logs or `states/`). Vary one factor at a time and keep prompts at production defaults unless testing a prompt.
5. Codify cleared conditions in an owning `test/` case running real writer against real reader; trash seeds after use (`/usr/bin/trash .ana/d2/sim-<what>`).

```sh
bun run runs replay [<name> ...]                                        # log schema & fold parity
bun .claude/skills/promotion-tuner/scripts/replay.ts --tree <abs>       # comparison reading flips
bun run runs seed --from <campaign> --points                            # list cut indices
bun run runs seed --from <campaign> --name sim-<what> --before <id>     # cut before session or comparison
bun run runs rehearse --name sim-<what> [--id g-sim --new latest]       # Tier 2 rehearsal
```

## Tier 3 (`scripts/live-seat.ts`) & report

Requires operator approval naming seats, model, effort, login, and USD/time cap; never print `--env-file`. Check `runs usage` (for every seated backend, including cross-family reviewers) and host load (`runs loadwatch --once`) before launch; run paired arms concurrently on one quiet host.

| Seat | Seed cut | Command | Reader |
| --- | --- | --- | --- |
| Draft | `--before d-1` | `tools/eval/draft.ts --session d-1 --examiner <m> [--reviewer <r>] ...` | `live-seat.ts read`, `compare`, `prompt` |
| Examiner | `--before x-<n>` | `tools/eval/examine.ts --session x-<n> --examiner <m> --examiner-effort <e> ...` | `live-seat.ts read`, `compare`, `pairs`, `prompt` |
| Builder | `--before b-<n>` | `tools/campaign/session.ts --session b-<n> --builder <m> --no-comparison ...` | `live-seat.ts read`, `compare` |
| Comparison | `--before g-<n>` | `tools/campaign/checkpoint.ts --id g-<n> --new latest ...` | `live-seat.ts read`, comparison report |
| Stretch | `--before b-<n>` / rest | `tools/campaign/harness-builder.ts`, all 4 seats named by `live-seat.ts start --model` | `live-seat.ts read`, log readers |

Report: question & tier; seed/source/cut & live diff; pre-registered intent, rivals & outcome; what did not run; conditions (`blocking`\|`cleared`\|`accepted-risk`) with owner verdict; spend/minutes (Tier 3); seed & sandbox cleanup.

## Related skills

- Fixing/rewriting findings: [simplify](../simplify/SKILL.md), [commit-r](../commit-r/SKILL.md), [system-audit](../system-audit/SKILL.md)
- Archive scoring/decision replay: [promotion-tuner](../promotion-tuner/SKILL.md)
- Post-hoc run audits or live launches: [whole-run-investigation](../whole-run-investigation/SKILL.md), [run-management](../run-management/SKILL.md)

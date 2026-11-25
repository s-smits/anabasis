---
name: system-path-simulation
description: "Use before live runs or landing to exercise an untested execution path, test command joins, size a comparison, verify kill/stop recovery, simulate an open stack, or tune Examiner prompts/terms (`cases/optimize.md`). Supports archive replays, synthetic logs, scripted rehearsals on seeded campaigns, and paired live-seat rounds, tracing findings back to owning modules. Not for post-hoc analysis of finished runs (whole-run-investigation) or launching paid campaigns (run-management)."
---

# System path simulation

Shape behavioural changes into **separable, ablatable, simulatable slices**, and run a pre-run simulation gate at the cheapest tier that settles each slice's question before spending on any live run or external evaluation:

| Tier | Runs | Cost | Proves | Cannot prove | Guide |
| --- | --- | --- | --- | --- | --- |
| **1. Read** | Readers on recorded or in-memory synthetic events | sec, \$0 | How folds/seat views read an event sequence | Command execution after last event | [synthetic](cases/synthetic.md) |
| **2. Rehearse** | Real commands, wall, verifier & comparison on a seed (`faux/script`, no Auditor) | min, \$0 | Command joins & sample-size power | Real model behaviour | [rehearsal](cases/rehearsal.md) |
| **3. Live seat** | Real commands with live model seat(s) on a seed (`scripts/live-seat.ts`) | USD (operator approval) | Real model action from recorded state | Rate from 1 draw (rule 6) | [live-seat](cases/live-seat.md), [optimize](cases/optimize.md) |

Use [before-after](cases/before-after.md) for cross-commit/pre-landing verification at any tier; use [rubric-and-verifier](cases/rubric-and-verifier.md) for rubric items and the pairwise judge.

## Rules

1. Pre-register intent and 2–3 rival outcomes (gain, null, regression with metrics/thresholds) in `.ana/wri/` before running; separate delivery checks from empirical predictions.
2. Seed late from a quiescent log (`bun run runs seed --from <run> --name sim-<what> [--points | --events N]`) and note how it differs from live state.
3. Build states strictly with campaign commands (never hand-edit logs or `states/`; synthetic logs stay in memory).
4. Vary one factor at a time; keep prompts at production defaults unless testing a prompt.
5. Codify cleared conditions in an owning `test/` case running real writer against real reader; trash seeds after use (`/usr/bin/trash .ana/d2/sim-<what>`).

```sh
bun tools/campaign/harness-builder.ts --name <name> --dry-run
bun run runs replay [<name> ...]
bun run runs seed --from <campaign> --name sim-<what> [--points | --events <n>]
bun run runs rehearse sim-<what>
```

## Tier 3 (`scripts/live-seat.ts`) & report

Requires operator approval naming seats, model, effort, login and USD/time cap; never print `--env-file`; run paired arms concurrently on one quiet host (`runs hosts --health`, `runs loadwatch --once`, `runs usage`).

| Seat | Seed cut | Command | Reader |
| --- | --- | --- | --- |
| Examiner | Before session | `tools/eval/examine.ts --session x-<n> --examiner <m> --examiner-effort <e>...` | `live-seat.ts read`, `pairs` |
| Comparison | After `build.finished` | `tools/campaign/checkpoint.ts --id g-<n> --new latest` | Comparison report |
| Stretch | Before `build.started`/rest | `harness-builder.ts`, its four seats named by `live-seat.ts start --model` (one or four, as `runs fresh`) | Log readers |

Report: question & tier; seed/source/cut & live diff; pre-registered intent, rivals & outcome; what did not run; conditions (`blocking`\|`cleared`\|`accepted-risk`) with owner verdict; spend/minutes (tier 3); seed cleanup.

## Related skills

- Fixing/rewriting findings: [simplify](../simplify/SKILL.md), [commit-r](../commit-r/SKILL.md), [system-audit](../system-audit/SKILL.md)
- Archive scoring/decision replay: [promotion-tuner](../promotion-tuner/SKILL.md)
- Post-hoc run audits or live launches: [whole-run-investigation](../whole-run-investigation/SKILL.md), [run-management](../run-management/SKILL.md)

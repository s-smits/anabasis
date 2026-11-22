---
name: system-path-simulation
description: "Exercise an untested Anabasis execution path before a live campaign traverses it: read the record (a single reader fact, a full archive replay, or an in-memory synthetic log), rehearse (real commands on a seeded campaign with scripted seats), or seat a live model (an Examiner session or round from a seed, or paired seat rounds tuning a prompt or term against one primary count), each runnable before and after a change, and trace findings back to the owning module to fix, simplify, or rewrite. Use to test command joins, revisit a recorded state, size a comparison, verify kill or stop recovery, simulate an open stack before landing, or tune the Examiner's prompt or terms (cases/optimize.md). Not for post-hoc analysis of a finished run (whole-run-investigation) or launching a paid campaign (run-management)."
---

# System path simulation

Exercise an untested path at the cheapest tier that settles the question, then stop:

| Tier | Runs | Cost | Proves | Cannot prove | Guide |
| --- | --- | --- | --- | --- | --- |
| **1. Read** | Readers on recorded or in-memory synthetic events | sec, \$0 | How folds/seat views read an event sequence | Command execution after last event | [synthetic](cases/synthetic.md) |
| **2. Rehearse** | Real commands, wall, verifier & comparison on a seed (`faux/script`, no Referee) | min, \$0 | Command joins & sample-size power | Real model behaviour | [rehearsal](cases/rehearsal.md) |
| **3. Live seat** | Real commands with live model seat(s) on a seed (`scripts/live-seat.ts`) | USD (operator approval) | Real model action from recorded state | Rate from 1 draw (rule 6) | [live-seat](cases/live-seat.md), [optimize](cases/optimize.md) |

Use [before-after](cases/before-after.md) for cross-commit/pre-landing verification at any tier.

## Rules

1. Pre-register intent and 2–3 rival outcomes (gain, null, regression with metrics/thresholds) in `.ana/wri/` before running; separate delivery checks from empirical predictions.
2. Seed late from a quiescent log (`bun run runs seed --from <run> --name sim-<what> [--points | --events N]`) and note how it differs from live state.
3. Build states strictly with campaign commands (never hand-edit logs or `states/`; synthetic logs stay in memory).
4. Vary one factor at a time; keep prompts at production defaults unless testing a prompt.
5. Codify cleared conditions in an owning `test/` case running real writer against real reader; trash seeds after use (`/usr/bin/trash .ana/d2/sim-<what>`).

```sh
bun tools/d2/harness-builder.ts --name <name> --dry-run
bun run runs replay [<name> ...]
bun run runs seed --from <campaign> --name sim-<what> [--points | --events <n>]
bun run runs rehearse sim-<what>
```

## Tier 3 (`scripts/live-seat.ts`) & report

Requires operator approval naming seats, model, effort, login and USD/time cap; never print `--env-file`; run paired arms concurrently on one quiet host (`runs hosts --health`, `runs loadwatch --once`, `runs usage`).

| Seat | Seed cut | Command | Reader |
| --- | --- | --- | --- |
| Examiner | Before session | `tools/d1b/examine.ts --session x-<n> --examiner <m> --examiner-effort <e>...` | `live-seat.ts read`, `pairs` |
| Comparison | After `build.finished` | `tools/d2/checkpoint.ts --id g-<n> --new latest` | Comparison report |
| Stretch | Before `build.started`/rest | `harness-builder.ts` (all seat models) | Log readers |

Report: question & tier; seed/source/cut & live diff; pre-registered intent, rivals & outcome; what did not run; conditions (`blocking`\|`cleared`\|`accepted-risk`) with owner verdict; spend/minutes (tier 3); seed cleanup.

## Related skills

- Fixing/rewriting findings: [simplify](../simplify/SKILL.md), [commit-r](../commit-r/SKILL.md), [system-audit](../system-audit/SKILL.md)
- Archive scoring/decision replay: [promotion-tuner](../promotion-tuner/SKILL.md)
- Post-hoc run audits or live launches: [whole-run-investigation](../whole-run-investigation/SKILL.md), [run-management](../run-management/SKILL.md)

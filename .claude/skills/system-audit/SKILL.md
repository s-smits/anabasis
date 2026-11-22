---
name: system-audit
description: "Evaluate Anabasis as a whole using independent read-only sessions, each examining one subsystem through a single analytical lens (flaws proved from counted events in recent campaigns, first-principles rethink before reading code, deletion of unused machinery, fault-tolerance, or factor alignment). Claims name their evaluation pillar and are triaged by the v1.0 requirement they block; a challenge session attempts to refute them, the primary session vets each claim, and confirmed findings become assumed repairs for subsequent rounds, applied only with operator authorisation through stack-pr, commit-r, and simplify."
---

# System audit

Read-only whole-system audit at a pinned commit against `AGENTS.md` §1. Independent sessions inspect one subsystem through one lens, a challenge session tries to refute their claims, and the primary session vets every claim at source/logs before any edit. Everything is open to challenge except measurement honesty (sandbox wall and rules 3–8).

## The pillars and v1.0 bar

Current metrics live in `docs/plan.md` ("The v1.0 bar, now"); rationales in `docs/backlog/v1-bar.md`. Thresholds are fixed by the operator pre-graduation (rule 4) and never shown to seats:

| Pillar | v1.0 bar | Authoritative reader |
| --- | --- | --- |
| `wall` | All wall tests pass on macOS & Linux at top; 0 `sandbox-crash` in measured runs | `bun run gate` (both OSes); `close.ts` |
| `supply` | Post-setup comparisons score ≥6 untied tasks (at 0.02); ≥1 validity-won step (or release notes objective-only climb); stronger bare solver beats weaker beyond A/A spread on opening tasks | `reading.ts --zone`; `table.ts --rows runs`; `compare-systems/scripts/systems.ts` |
| `climb` | 6 confirmed promotions (`confirmed`, `climb.ts`) in one fresh measured `jobstat` run + replicated in cold domain (`buffer`), with more `after` slices stepping for reference than starter | `barLines`; `starter-reads.ts`; `table.ts --rows cost` |
| `honesty` | A/A false steps ≤1.1% (`falseRate`) across ≥50 powered A/As, split validity vs objective-only (using Starter A/A where reference ties), plus 0 A/A steps in the 10 comparisons post-6th promotion | `barLines`; `table.ts --rows runs` |
| `verdicts` | Pooled blind human labels: ≥30 rejections (≥8 defects), ≥3/4 defects caught, ≤1/10 earned voided (PABAK & kappa); ≥20 sampled passes (`PASS_LABELS`), ≤1/10 wrong | `tools/d2/settle.ts` (`clears`, `agreement.ts`) |
| `grounding` | One domain invoking its pinned reference engine with 0 authored checks (`--admit-authored` unused, rule 10) | `close.ts` (`unadmitted`); `tools/c/accept.ts` |
| `economy` | Single-meter USD & active hours/promotion, ≤3 attempts/epoch after setup, reference solve cost ≤ Starter within spread | `close.ts`, `barLines`; `table.ts --rows cost`; `score.ts table` |
| `systems` | Cheaper builtSolver matches/beats dearer bareSolver on held-out tasks (`compare-systems`) + ablation vs `programs-of:<digest>` | `compare-systems/scripts/systems.ts`; `checkpoint.ts` |
| `outside` | Measured `jobstat` confirmed references blind under JobBench judge beside same-sitting Starter & one-pass Builder: above both beyond Starter spread, then ≥ Harness² `heldout`, non-decreasing along promotions | `score.ts table`/`spread`; `compare.ts read`; `trend.ts --bench` |

## Lenses and subsystems ([references/brief.md](references/brief.md))

| Lens | Method |
| --- | --- |
| `flaws` | Predict log counts from hypothesis before searching, then count (≤3 findings R1, ≤2 later) |
| `rethink` | Sketch design from `AGENTS.md` §1 *before opening code*, then compare symmetrically |
| `delete` | Audit rule-13 chains and count option values, branch events and export readers |
| `factors` | Check each pillar's failure mode, owning fold and restatement consistency |
| `fault-tolerance` | Probe mid-line kills, torn appends, provider errors, missing walls, concurrent writers, load/clock drift, dead hosts |

Every lens also emits uncapped **Does not make sense** items (`path:line`, anomaly, one verifiable sentence). Subsystems: `measurement`, `learning_loop`, `runtime_recovery`, `accumulated_capability`, `evaluation_grounding`, `factors`, `operator_surface`, `whole`.

## Procedure (`.ana/wri/<date>-<subject>-audit-<round>/`)

1. **Pin**: detach worktree at published stack top (`git worktree add --detach ../anabasis-audit-<round> <commit>`) and snapshot recent runs (`bun .claude/skills/system-audit/scripts/recent.ts --limit 16 --json > <dir>/recent-logs.json`).
2. **Brief & run**: copy [references/brief.md](references/brief.md) to `<dir>/shared-instructions.md` (adding prior confirmed findings under **Assumed repaired**), assign 3–6 read-only sessions (including `rethink`) via [codex-gpt-swarm](../codex-gpt-swarm/SKILL.md) (`--model gpt-6.1-sol --reasoning-effort high`, `"sandbox": "read-only"`, `"search": false`) or Claude.
3. **Challenge & vet**: pass raw claims (reasoning stripped) to an independent read-only challenger; triage by first blocked v1.0 row; recount in `<dir>/vetting.md` (`confirmed` | `plausible` | `refuted`); report ranked findings, complexity deltas and v1.0 status.

## Related skills

- Subsystem invariants: [design-and-seats](../design-and-seats/SKILL.md), [comparison-reading](../comparison-reading/SKILL.md), [campaign-mechanics](../campaign-mechanics/SKILL.md)
- Quantitative checks & per-run evidence: [promotion-tuner](../promotion-tuner/SKILL.md), [whole-run-investigation](../whole-run-investigation/SKILL.md), [harness-audit](../harness-audit/SKILL.md)
- Applying approved fixes: [stack-pr](../stack-pr/SKILL.md), [commit-r](../commit-r/SKILL.md), [simplify](../simplify/SKILL.md), [reduce-complexity](../reduce-complexity/SKILL.md)

---
name: decision-points
description: "Use before proposing to continue, pause, stop, resume, evict, or fork a live campaign, or whenever a promotion, starter comparison, non-step comparison, ending, or concurrency slot change lands. Encodes target promotion counts, criteria for abandoning non-promoting runs, slot eviction order, fresh-fork rules, and release proof-run requirements from the empirical decision record (references/record.md)."
---

# Decision points

Codifies operator lifecycle policy ([references/record.md](references/record.md)); thresholds never reach any model seat (`AGENTS.md` §1).

**Standing session authority** (log departures from the 2-promotion check in `deviations.md`):
1. At each promotion (1st through 5th), backtrack predictions to decide whether current evidence is enough to pause and investigate now or justify waiting for another promotion up to 5 maximum (`run-improvement-campaign` step 1), pausing cleanly via `runs pause <name> --after reported --yes`.
2. Fork a fresh run at a verified fix (`run-improvement-campaign` step 5).
3. With two runs active, designate the older promoted run as the **long run** (up to 5 promotions) while cycling the second slot onto the newest verified stack head.

Any early stop outside the table below or any release-gate waiver requires explicit operator approval (keep the run active while asking).

```sh
bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts due      # triggers & pending steps
bun run runs view <name>                                               # promotions, readings, bill
bun .claude/skills/comparison-reading/scripts/starter-reads.ts <name>  # starter confirmation breakdown
```

## Single-run lifecycle table

Always pause `--after reported` (never directly at `harness.promoted`) so the starter confirmation tallies first (`AGENTS.md` §1).

| Point | Default | Exceptions | Record (`references/record.md`) |
| --- | --- | --- | --- |
| Pre-comparison 1 | Continue | None | Promo 1 median 7.8h |
| No-step (0 promos) | Run to trigger (12h, 0 untied, patience) | Abandon early only if superseded by a fix changing what it measures, or demonstrably broken/stalled | 0-promo runs: median 9.2h, 2 comps (≤\$186) |
| 1st promotion | Backtrack predictions (`run-improvement-campaign`): pause post-starter if key predictions settled; else continue to promo 2 | Patch proof or decisive early falsification pauses after starter confirmation | 21/67 manual stops at 1 promo |
| 2nd promotion | Backtrack predictions: pause `--after reported` if settled, investigate, run `jobstat` bench, fix, fork | Continue up to 5 (log `"2 promotions"` in `deviations.md`) when load-bearing predictions require later epochs or run is the long run | Modal stop (median 14.3h; 4.1h post-promo 2) |
| 3rd–5th promotion | Backtrack predictions at each promotion; continue past 3–4 only for named unresolved predictions or long-run climb; pause `--after reported` by promo 5 ceiling; bench unscored `jobstat` refs at each pause | Operator direction, minor-release bar, or confirmed climb within ~8h of 6 | 25/49 at 2 reached 3; 12/49 reached 4; 9/49 reached 5 |
| 6 confirmed | Major milestone (`docs/plan.md`): run to natural ending | None | 6 runs reached ≥6 (32–56h) |
| Auto ending | Resume only on credit/session limits (rule 15) | Never top up budget or relax patience after `budget`/`stop` | 15/141 auto-ended |

## Two slots, eviction & release proof bars

- **Long run** (older promoted run): may run up to **5** promotions when unresolved predictions or climb dynamics justify continuing; ignores 12h trigger while climbing or producing untied comps (log `| pause:<run> | <reason naming "<N> promotions"> |` in `deviations.md`).
- **Newest fork**: tests latest verified head; pauses as soon as backtracked predictions settle (1–5 promotions, modal at 2). Once a new runtime/seat fix is proved and the current fork has run >1h on an older commit, pause it after any in-flight comparison and fork fresh.
- **Eviction order under caps**: (1) superseded by stacked/landed fix; (2) stalled/broken; (3) middle performer. *Exempt*: newest fork on an unmeasured fix, sole live `jobstat` run, and any run mid-comparison (pause after completion).
- **Proof bars** (operator-only to waive): *Patch* = 1 fresh run at top to 2 promos; *Minor* = 2 promos at one unchanged commit with mechanism events and a factor moving past spread; *Major (`1.0`)* = 6 confirmed in 1 fresh run replicated in a second domain + all v1.0 rows (`docs/plan.md`).
- When in doubt: keep running and ask; prefer `pause` over `stop`.

## Related skills

- Executing pauses, forks & stops: [run-management](../run-management/SKILL.md)
- WRI2P2 cycles & external benchmarks: [run-improvement-campaign](../run-improvement-campaign/SKILL.md)
- Cohort trends & starter reads: [promotion-tuner](../promotion-tuner/SKILL.md), [comparison-reading](../comparison-reading/SKILL.md)

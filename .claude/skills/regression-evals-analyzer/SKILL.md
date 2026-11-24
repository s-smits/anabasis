---
name: regression-evals-analyzer
description: "Use when diagnosing why a promoted harness regressed or stalled on an external benchmark or domain evaluation (e.g. JobBench, hardware suites, or future evals), or before launching a WRI on a benchmark-backed domain. Checks `minPromo`, gates on paired external ablation (`runs bench --pi`), runs `bun run wri regressions`, attaches optional domain-specific WRI lanes (built-in lane 90 plus gitignored `/.wri/domains/<domain>/lanes.md`), and traces external rubric failures and unused tools back to the campaign's build log."
---

# Regression Evals Analyzer

Connects external benchmark outcomes and rubric-level failures directly back to the campaign log that built the harness, so regressions are diagnosed at their upstream campaign owner (exam grounding, task supply, Builder guide, or `.toolchain/bin` portability) rather than guessed from aggregate scores. Strictly read-only on campaign logs and benchmark stores; paid ablations require operator authorisation or standing cycle grants (`AGENTS.md` §3).

## Domain protocol (shared with `runs fresh` and `runs bench`)

`bun run wri` is standalone (requires no `.env` credentials) and connects every campaign to its domain via `packOf` and `domainOf` (`tools/runs/registry.ts`) plus `EVAL_RUNNER` in `.env.runs` (`tools/runs/host-config.ts`):

- **External benchmarks (`EVAL_RUNNER`):** matches any entry whose `packs` match the campaign's pack (`pack === p || pack.startsWith("${p}-")`), reading its local synced store (`data/bench/<bench>/`).
- **Minimum promotions (`minPromo`):** resolved in priority order `--min-promo <N>` > `.wri/domains/<domain>/config.json` > `EVAL_RUNNER.minPromo` > `1`. Runs below `minPromo` skip external ablation and regression lanes by default (pass `--min-promo 0` to inspect an unpromoted candidate).
- **Gitignored per-domain extensions (`/.wri/domains/<domain>/`):** ignored by git so private benchmarks, hardware suites, and hidden evaluation rubrics stay local. Each domain directory may hold:
  - `config.json`: optional `{"minPromo": 1, "bench": "<name>", "store": "<path>"}`.
  - `lanes.md`: optional domain-specific WRI lanes in standard `lanes.md` format using 2-digit lane numbers `21`–`99` (excluding `90`, reserved for the built-in regression lane). Lanes with `Marks: standing` open automatically on matching domains; lanes with `Marks: none` open when named via `--lanes`.

## Procedure

```sh
bun run wri check --log <run-or-log> [--min-promo N] [--bench <name>]
bun run wri regressions --log <run-or-log> [--min-promo N] [--bench <name>] [--arm <label>]
```

1. **Check domain and `minPromo` readiness:** run `bun run wri check --log <run>`. Confirm domain, promotion count against `minPromo`, matched benchmark store, paired arm, and any local `/.wri/domains/<domain>/` lanes.
2. **Gate on paired ablation first:** if `promotions >= minPromo` and `check` / `regressions` reports `ablation-needed` (exit `1`), run the paired external ablation (`bun run runs bench <run> --pi`, respecting operator budget caps and [run-improvement-campaign/references/outside.md](../run-improvement-campaign/references/outside.md)) and sync records (`bun run runs fetch`) before opening the regression lane.
3. **Run the deterministic join:** execute `bun run wri regressions --log <run>`. Inspect:
   - Internal starter confirmation (`overall` and `written-after`, against `baseStarter` / Starter Pack) beside the external paired delta (`builtSolver - baseline`, explicitly tagging whether the external baseline is `baseStarter` or `bareSolver`, with W-L-T, spend, and `CUT` counts).
   - **Per-task regressions** sorted worst-first, with exact missed rubric indices, weights, and criteria counts (`R<n>(w<W>,<passed>/<total>)`).
   - **Toolchain transfer matrix**: each `.toolchain/bin` executable's invocation rate inside campaign solves (`ranUnder`) versus on external trajectories (immediately flagging campaign-coupled or unused tools).
   - **Cross-version cohort backtrack**: every paired arm in the benchmark store stratified by runtime (`pi-durable` vs `claude-code`), showing baseline tier (`baseStarter` vs `bareSolver`), baseline spread, fair-uncut deltas, cohort median, best-on-record arm, and whether the current run regressed past baseline variance.
4. **Open optional WRI lane 90 (plus domain lanes):** run `bun run wri start` and `bun run wri lanes` as in [whole-run-investigation](../whole-run-investigation/SKILL.md). Whenever `promotions >= minPromo` and paired records exist, **Lane 90 (External benchmark regression analysis)** and any standing `/.wri/domains/<domain>/lanes.md` lanes attach automatically and pack into `launch.json`, `collect`, and `synthesis`.
5. **Trace regressions to campaign owners without overfitting:** link each recurring rubric miss or unused tool back to `d-N` exam checks/objective saturation, `x-N` task families, or `b-N` Builder edits (`states/<digest>/`). Apply [comparison-review](../comparison-review/SKILL.md) discipline: propagate repairs strictly as domain-general shape cards, never quote external task text or hidden exam values, never show WRI outputs to any seat, and never tune domain queries to external benchmarks (`AGENTS.md` §1, §8 rules 2–3).

## Related skills

- Core WRI workflow & lane catalogue: [whole-run-investigation](../whole-run-investigation/SKILL.md)
- Sealed splits & domain-general shape cards: [comparison-review](../comparison-review/SKILL.md)
- Launching paired ablations & cycle ledger: [run-improvement-campaign](../run-improvement-campaign/SKILL.md), [run-management](../run-management/SKILL.md)

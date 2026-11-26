---
name: regression-evals-analyzer
description: "Use when diagnosing why a promoted harness regressed or stalled on an external benchmark or domain evaluation (e.g. JobBench, hardware suites, or future evals), or before launching a WRI on a benchmark-backed domain. Checks `minPromo`, gates on paired external ablation (`runs bench`, pairing `builtSolver` against `bareSolver` via `--arm pi:base`), runs `bun run wri regressions`, writes `<out>/regressions.txt` automatically in `wri start`, injects `{evalRegressions}` into `wri synthesis` (`section 0b`), supports gitignored `/.wri/domains/<domain>/lanes.md`, and traces external rubric failures and unused tools back to the campaign's build log."
---

# Regression Evals Analyzer

Connects external benchmark outcomes and rubric-level failures directly back to the campaign log that built the harness, so regressions are diagnosed at their upstream campaign owner (exam grounding, task supply, Builder guide, or `.toolchain/bin` portability) rather than guessed from aggregate scores. Strictly read-only on campaign logs and benchmark stores; paid ablations require operator authorisation or standing cycle grants (`AGENTS.md` §3).

## Domain protocol (shared with `runs fresh` and `runs bench`)

`bun run wri` is standalone (requires no `.env` credentials) and connects every campaign to its domain via `packOf` and `domainOf` (`tools/runs/registry.ts`) plus `EVAL_RUNNER` in `.env.runs` (`tools/runs/host-config.ts`):

- **External benchmarks (`EVAL_RUNNER`):** matches any entry whose `packs` match the campaign's pack (`pack === p || pack.startsWith("${p}-")`), reading its local synced store (`data/bench/<bench>/`). Native `pi` external reads (`runs bench --pi`) compare `builtSolver` against `bareSolver` (`--arm pi:base`, labelled `base-<label>`), while Claude Code runs and legacy `starter-<label>` (`baseStarter`) pairs stay stratified in separate cohorts.
- **Minimum promotions (`minPromo`):** resolved in priority order `--min-promo <N>` > `.wri/domains/<domain>/config.json` > `EVAL_RUNNER.minPromo` > `1`. Runs below `minPromo` skip external ablation and regression scoring by default (pass `--min-promo 0` or `--with-evals` to inspect an unpromoted candidate).
- **Gitignored per-domain extensions (`/.wri/domains/<domain>/`):** ignored by git so private benchmarks, hardware suites, and hidden evaluation rubrics stay local. Each domain directory may hold:
  - `config.json`: optional `{"minPromo": 1, "bench": "<name>", "store": "<path>"}`.
  - `lanes.md`: optional domain-specific WRI lanes in standard `lanes.md` format using 2-digit lane numbers `21`–`99`. Lanes with `Marks: standing` open automatically on matching domains; lanes with `Marks: none` open when named via `--lanes`.

## Procedure

```sh
bun run wri check --log <run-or-log> [--min-promo N] [--bench <name>]
bun run wri regressions --log <run-or-log> [--min-promo N] [--bench <name>] [--arm <label>]
```

1. **Check domain and `minPromo` readiness:** run `bun run wri check --log <run>`. Confirm domain, promotion count against `minPromo`, matched benchmark store, paired arm (`builtSolver` vs `bareSolver` or legacy `baseStarter`), and any local `/.wri/domains/<domain>/` lanes.
2. **Gate on paired ablation first:** if `promotions >= minPromo` and `check` / `regressions` reports `ablation-needed` (exit `1`), run the paired external ablation (`bun run runs bench <run>`, respecting operator budget caps and [run-improvement-campaign/references/outside.md](../run-improvement-campaign/references/outside.md)) and sync records (`bun run runs fetch`).
3. **Run the deterministic join:** execute `bun run wri regressions --log <run>`. Inspect:
   - Internal starter confirmation (`overall` and `written-after`) beside the external paired delta (`built - baseline`, W-L-T, spend, `CUT` counts).
   - **Per-task regressions** sorted worst-first, with exact missed rubric indices, weights, and criteria counts (`R<n>(w<W>,<passed>/<total>)`).
   - **Toolchain transfer matrix**: each `.toolchain/bin` executable's parsed shell-invocation rate inside campaign solves (`ranUnder`) versus on external trajectories (flagging campaign-coupled or unused tools).
   - **Cross-OS port vs workspace coupling**: confirm OS-port failures (binary format, host shebangs/paths, permissions, `.toolchain/env.sh`) are zero and `ModuleNotFoundError` counts are symmetric across built and baseline arms before attributing external deficits to workspace coupling or guide drag ([run-improvement-campaign/references/outside.md](../run-improvement-campaign/references/outside.md), [stack-contracts.md](../run-improvement-campaign/references/stack-contracts.md) stages 4–8).
   - **Cross-version cohort backtrack**: every paired arm in the benchmark store stratified by `(runtime, baselineTier)`, showing baseline spread, fair-uncut deltas, cohort median, best-on-record arm, and whether the current run regressed past baseline variance.
4. **Automatic WRI + Eval synthesis join:** `bun run wri start` writes `<out>/regressions.txt` automatically whenever the domain has a configured benchmark store, and `bun run wri synthesis` injects `{evalRegressions}` directly into `synthesis-prompt.md` (`section 0b. WRI + Eval full triage`) — zero extra subagent lane required. Any standing `/.wri/domains/<domain>/lanes.md` lanes attach automatically in `wri lanes`.
5. **Trace regressions to campaign owners without overfitting:** link each recurring rubric miss or unused tool back to `d-N` exam checks/objective saturation, `x-N` task families, or `b-N` Builder edits (`states/<digest>/`). Apply [comparison-review](../comparison-review/SKILL.md) discipline: propagate repairs strictly as domain-general shape cards, never quote external task text or hidden exam values, never show WRI outputs to any seat, and never tune domain queries to external benchmarks (`AGENTS.md` §1, §8 rules 2–3).

## Related skills

- Core WRI workflow & lane catalogue: [whole-run-investigation](../whole-run-investigation/SKILL.md)
- Sealed splits & domain-general shape cards: [comparison-review](../comparison-review/SKILL.md)
- Launching paired ablations & cycle ledger: [run-improvement-campaign](../run-improvement-campaign/SKILL.md), [run-management](../run-management/SKILL.md)

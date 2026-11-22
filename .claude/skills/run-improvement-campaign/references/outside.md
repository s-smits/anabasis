# The outside aim: Harness² on JobBench

External-transfer row of the v1.0 bar (`system-audit`, `docs/plan.md`): tests whether a `jobstat` harness built blind to JobBench competes with the Starter and Harness²'s `heldout` arm under JobBench's native judge (`studies/harness2/README.md`). Nothing from JobBench ever enters any seat, prompt, check or query (`AGENTS.md` §1; rules 2, 3, 9), and external scores never gate promotions.

## Trigger and `outside-reads.md` ledger

At least one live slot stays on `jobstat`. Evaluate a `jobstat` run's newest promoted reference on the eight tasks below:
- **At every pause from promotion 2 onwards**: start automatically without waiting for operator approval or lane 8 (append lane 8 soundness/weight once ready).
- **On stopping at another trigger with 1 promotion**: run lane 8 first; skip if soundness ≤2 or bloat.

Record every read in `<cycle>/outside-reads.md` (`scored`, `skipped` or `owed`; `wri2p2.ts next` enforces the `outside` gate before vetting). Even when `owed`, run the dry run immediately so the reference exports before `retire` archives the campaign:

```text
| run | digest | step: tally, measure that carried it | starter read: confirmed, written-after tally | audit: soundness, weight | fair five: reference, Starter beside it | first task and outside pair: reference, Starter | scored, skipped or owed |
```

## Eight-task partitions and execution

Always pass `--tasks` explicitly to `score.ts score`:

| Partition | Tasks | Purpose |
| --- | --- | --- |
| `fair five` | `biostatisticians/task2,statisticians/task2,statisticians/task3,social_science_research_assistants/task2,social_science_research_assistants/task3` | Reference vs paired Starter and Harness² `heldout` (which covers these five only) |
| `first task` | `statisticians/task1` | Reference vs Starter (reported separately) |
| `outside pair` | `supply_chain_managers/task2,sociology_teachers_postsecondary/task2` | Out-of-query transfer vs Starter (reported separately) |

Because the judge truncates deliverables at 200,000 chars (`CUT <n>` in `score.ts table`), always roll a fresh Starter in the same sitting and report both `fair` and `fair uncut` sums plus `score.ts spread`.

1. **Pre-register** `jobbench-<label>-prediction.md` in the cycle dir from the dry run:
   ```sh
   bun run runs bench <campaign> [--bench <name>] [--as <label>] [--harness <kept>] [--login N] [--wait]   # --yes runs
   bun run runs pause <campaign> --after reported --eval --yes
   ```
   Manual exports and standalone `score.ts` flags are documented in `tools/runs/bench.ts` and `studies/harness2/score.ts`.
2. **Execute detached** (`--yes`, 1 rollout/task per arm under standing authorisation; larger sizes or `rejudge` need operator approval). Never run two processes on the same store concurrently.
3. **Analyse**: run `score.ts table --out <store> --tasks <partition>`, `score.ts spread`, `compare.ts levels` (pass frozen review ledger SHA-256 as `--salt` to seal half the tasks for a formal [comparison-review](../../comparison-review/SKILL.md)), and `promotion-tuner/scripts/trend.ts --bench <store> --bench-tasks <partition>`. Trash `hevo_ws_cc` temp workspaces once `judged/` records are written.

| Placement vs Starter spread | Action |
| --- | --- |
| Below Starter, beyond spread | Audit conditions and export fidelity (`studies/shared/claude-export.ts`), fix defects and re-roll afresh before blaming the harness |
| Inside Starter spread | Noise (rule 6); continue to next run's read |
| Above Starter, beyond spread | Directional signal; continue (unbiased claims require 20-task `compare.ts plan`/`read` with operator approval) |
| Above Harness² `heldout`, beyond spread | Request operator approval for 20-task evaluation |

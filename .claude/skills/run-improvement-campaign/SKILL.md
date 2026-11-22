---
name: run-improvement-campaign
description: "Operate the Anabasis improvement loop (the Super Loop) across iterations and release cycles: fork fresh campaigns, track milestones, and resolve pre-registered predictions; when a run hits its trigger (two promotions, twelve hours, or a comparison leaving no untied tasks), pause it after its next comparison, investigate it (`scripts/wri2p2.ts`), implement findings as one stacked pull request, and fork fresh evaluation runs at its head; land the release once a proof run at the top promotes twice. Use when asked to manage ongoing campaigns, fork runs, work towards a release, run a pass or audit, interpret a promotion, diagnose a non-promoting campaign, or plan the next run. Owns the experiment and its evidence; `AGENTS.md` section 3 owns operator decisions."
---

# Run improvement campaign (the Super Loop)

Three nested cycles:
- **Release cycle**: merges the PR stack on operator authorisation once a fresh proof run at the stack top promotes twice.
- **Iteration (WRI2P2)**: investigates one triggered fresh run, lands confirmed fixes as one stacked PR at the top, and forks fresh evaluation runs at its head.
- **Pass**: reports the five points, finds the bottleneck link, repairs its owner, proves model-free, pre-registers predictions, and launches fresh.

Only a fresh campaign opened from a prompt at a single commit is valid climb evidence (`AGENTS.md` §10, item 9).

## What to do when

| Trigger | Read first | Next action |
| --- | --- | --- |
| Starting, resuming or waking | `wri2p2.ts due`, `cycle.md` | Act on the live run trigger or oldest pending step (`wri2p2.ts next <dir>`) |
| Report, promotion, starter read or ending | `runs view <name>`; `starter-reads.ts` after promotion | Resolve predictions with current log event count; at trigger run `wri2p2.ts open` |
| Runner slot frees up | `runs active`, `runs usage`, `runs loadwatch --once`, `run-queue.md` | Step 5: write `predictions-<run>.md`, dry-run, launch via `runs fresh` |
| Lanes or synthesis finish | `wri2p2.ts next <dir>`, `wri2p2.ts ledger <dir>` | Execute iteration steps 2–3 |
| Code fix ready | `stack-pr/scripts/stack.ts`, `repository-practice/scripts/preflight.ts` | Step 4 with before/after verification, then step 5 |
| Spend with no milestone progress | `runs pulse <name>`, `wri.ts read --log <log>` | Diagnose via "The walk" below |
| Step open 2 days or double-claimed | Elapsed hours in `due`; `cycle.md` | Claim step, log deviation or assign one owner in `cycle.md` |
| `jobstat` pauses at ≥2 promotions (or stops with 1) without outside read | Prior prediction, `score.ts table`, `compare.ts levels` | Follow [references/outside.md](references/outside.md) (`runs bench`, `outside-reads.md`) |
| Handover or idle timer | `timers.ts <transcripts>` | Retire/retime timer, report the five points |

## The release cycle

Operator authorisation (e.g. "work towards 0.6.4") covers the cycle's runs, scheduled pauses and stack patches; landing, tagging and new cycles require fresh authorisation (`AGENTS.md` §11). Log grants and open decisions in `cycle.md`.

```text
iteration: predict → fork at top → run (2 promos or 12h) → investigate → vet → plan → one stacked PR → prove → predict → fork
release:   proof run at top (2 promos, unchanged) → 3 reviewers → consolidate → land & tag on operator's word → fork at release
```

### Cycle files (`.ana/wri/<YYYY-MM-DD>-cycle-<release>/` on central host, never under `data/`)

- `cycle.md`: authorisation, promotion threshold, reviews, one line per step ([references/cycle-ledger.md](references/cycle-ledger.md)).
- `run-queue.md`: priority-ordered launches tagged `ready: yes|no` with required gate (timers launch `ready: yes` only).
- `predictions-<run>.md` (write before `--yes`; if missed, write immediately noting current solve count):
  `| id | PR | labels | lanes | group | claim, as a count | falsified by |`
  Cover every PR merged since the previous cycle's fork plus supply/climb/honesty rows. `group`: `first` | `again` | `off-run` | `outside`.
- `outcomes-<run>.md`: marks each own id and `## Carried` (`<parent>:<id>`) as `held` | `falsified` | `unreached` | `pending`, with `Log events at resolution: <n>` (log growth past `<n>` reopens `unreached`/`pending`).
- `plan.md` (inside the iteration dir, linked from `cycle.md`): one row per confirmed finding, falsified prediction, live defect and lever ([references/levers.md](references/levers.md), ≥3 lever ids), plus `## Not done` and `## Intentionally opposed` (≥1 trade-off or `none`). Update `plan.md` with empirical count and `date -u` whenever the PR diverges.
- `wri2p2.ts ledger <dir>` prints cycle, dropped and still-missing views.

### Iteration (WRI2P2)

```sh
bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts [due] [<part> ...] [--days 2]
bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts open <name>[,<name>] [--out <dir>]
bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts next <dir>
```

1. **Trigger & pause**: triggers at 2 promotions, 12 elapsed hours, a scored comparison with 0 untied tasks, or a natural ending after ≥1 comparison. Pause cleanly (`runs pause <name> --after reported --yes` under `nohup`, which awaits any pending starter confirmation `heldBy`), then resolve `outcomes-<run>.md`.
2. **Investigate**: `wri2p2.ts open <name>[,<peer>]` (`--snapshot` only on operator direction, logged in `deviations.md`), then follow `wri2p2.ts next <dir>` through `instruct`, `lanes --agents 4`, `wri.ts record`, `collect`, isolated lane 6 if triggered, and `synthesis`.
3. **Vet, cross-domain check & plan**: backtrack all prediction ids first, vet every synthesis finding in `vetting.md` (`vettingFaults`), inspect 5–10 recent vetted investigations from other domains to write `cross-domain.md`, then write `plan.md` accounting for every confirmed `vet-<n>` row, ≥3 lever ids and `## Intentionally opposed`.
4. **Implement**: land the plan as one stacked PR at the top (or extend your own PR owning that label), verify with `bun run land -- <top> --sanitize`, record `Pull request: #N` in `plan.md`. Prove behavioural patches before/after on identical logs/seeds (`system-path-simulation/cases/before-after.md`).
5. **Predict & fork**: dry-run `runs fresh --as forkedPR<N>` for the name, write `predictions-<run>.md` (carrying unheld parent ids + new `first` rows), and launch only `ready: yes` entries.

`next` gates: `open` → `instruct` → `lanes` → `reports` → `record` → `isolated` → `synthesise` → per-run `predictions`/`outcomes`/`carry`/`outside` → `vet` → `across` → `plan` → `implement` → `launch` → `forks` → `done`. Override any gate except `done` via `| <step>[:<run>] | <reason> |` in `deviations.md`.

### Running, consolidating & proving a release

- **Running window**: launch at tag or PR head (`gh pr view <n> --json headRefOid`), check `runs hosts --health` and `runs loadwatch --once`, track via `wri2p2.ts due`.
- **Improvement window (12h after final stop)**: stop authorised runs via `runs on <host> stop <name>`, run WRI2P2, consolidate the stack by topic, and land on operator authorisation (`bun run land -- <top> --merge --tag v<x.y.z>`).
- **Proof run bar** (required before `--merge`): fresh run at the stack top reaching 2 promotions with (1) single clean commit throughout (`runs source`, `wri.ts read` row C), (2) modified runtime mechanisms emitting their log events (or noted unmeasured), (3) zero defect endings before promotion 2 (rate limits resume at same commit per rule 15), and (4) nothing stacked above it. Cite run name, commit SHA and both `harness.promoted` events in release notes.

## Resume & the five points

```sh
bun --env-file=.env.runs run runs status
bun run runs pulse
bun run runs view <name>
bun run runs source <name>
bun .claude/skills/stack-pr/scripts/stack.ts
bun tools/wri/wri.ts read --log <worktree>/.ana/d2/<name>/log.jsonl
```

Report Supply + the four factors (`AGENTS.md` §1) at pass open and close:

| # | Point | Source | Bar |
| --- | --- | --- | --- |
| 1 | Climb | `runs status`, `runs view`, `close.ts` "Promotions" | `AGENTS.md` factor 1 |
| 2 | Honesty | Report `noise`; `close.ts` "The chance of a false promotion" | A/A controls & cumulative risk |
| 3 | Supply | `--dry-run`, `runs view`, `task.gate` | `comparisonFloor(level)` frontier tasks |
| 4 | Verdicts | `tools/d2/settle.ts` | `AGENTS.md` factor 3 |
| 5 | Economy | `close.ts` "Work and spend", `promotionsWorth`, `worthLine` | ≤3 attempts/epoch after setup |

## The outside aim: Harness² on JobBench

At least one live slot stays on `jobstat`. Evaluate every `jobstat` run's newest promoted reference on JobBench's eight-task subset beside a fresh paired Starter—automatically on pause from promotion 2 onwards, or after lane 14 (skipping if soundness ≤2 or bloat) when stopping with 1 promotion. Nothing from JobBench ever enters seats, prompts, checks or queries, and external scores never gate promotions. See [references/outside.md](references/outside.md) for partitions, `outside-reads.md` columns, `runs bench` execution and spread actions.

## Milestones and the walk

| Milestone | Log event | Check |
| --- | --- | --- |
| M0 opened | Receipt, `campaign.opened` | `runs source`: clean single commit, fresh opening |
| M1 exam | `exam.drafted`, `checker.read`, `contract.frozen` | Faults by kind, `doNothing`, `admitted` |
| M2 supply | First `task.gate` | Held vs refused by reason, objective gap, dry run |
| M3 first reading | First `comparison.reported` | `valid.informative.old`, untied vs tied, `scored.detectable`, A/A, load |
| M4 step | `reading: step` vs reference | Margins, retained tally, A/A |
| M5 promotion | `harness.promoted` | Reading, untied count, A/A, cumulative risk; `wri.ts climb` |
| M6 next epoch | First Examiner & comparison post-M5 | Drafts held vs refused, frontier & retained sizes |
| M7 ending | `campaign.ended` | Ending kind, closing report, predictions |

On stalls (spend without milestone progress; exclude rule-15 limit waits), walk from the active milestone and stop at the first failing link (matches WRI lane 13):

| # | Link | Point | Fails as | Owner |
| --- | --- | --- | --- | --- |
| 1 | supply | 3 | `tasks`/`short` rows, refused drafts (`< comparisonFloor`) | `src/examiner/prompt.ts`, `heard` (`record.ts`), `propose_tasks` (`write.ts`), `shortOf` (`decide.ts`) |
| 2 | instrument | 4 | `exam` ending, checker faults, tasks set aside | `planOf` (`opening.ts`), `readChecker` (`acceptance.ts`), check author |
| 3 | room | 1 | `no-room`, zero `valid.informative.old` | Link 1; `roomOf` (`reports.ts`) |
| 4 | session | 1 | Unchanged `build.finished`, idle sessions, practice all passing | `src/builder/prompt.ts`, `tools/d2/campaign-actions.ts`, `idleOf` (`campaign-terms.ts`) |
| 5 | size | 2 | Excess ties, near miss, high `scored.detectable` | `--target` for next run; link 1 |
| 6 | host | 2 | `HOST LOADED`, `LOAD MOVED`, long `campaign.waited` | Concurrent campaigns/host |
| 7 | promotion | 2 | `no-step` near alpha, retained loss, A/A step | Links 1 & 5; `readsStep` |
| 8 | next epoch | 1 | Refused drafts, thin frontier after promotion | `make` (`harness-builder.ts`), `ROWS` (`decide.ts`) |

## Timers and event hooks

Never poll on a clock: react to `runs alerts`, `runs pulse`, subagent completions or `until.ts` (`--at harness.promoted --hours 9 --say "..."`). Track active waits in `cycle.md` ([references/timers.md](references/timers.md); audit via `timers.ts`). On wake: check `date -u`, `wri2p2.ts due` and `cycle.md` (if idle, print one line and touch no files); execute one authorised step; chain a 10m one-shot only if actionable steps remain, else wait on the next event; log a `cycle.md` row only on state change.

## Related skills

- Lifecycle commands (`fresh`, `pause`, `stop`, `loadwatch`, `bench`): [run-management](../run-management/SKILL.md)
- Pause, eviction, long-horizon and fork thresholds: [decision-points](../decision-points/SKILL.md)
- Running lanes, vetting and synthesis: [whole-run-investigation](../whole-run-investigation/SKILL.md)
- Cohort tables, cost repricing and multi-week trends: [promotion-tuner](../promotion-tuner/SKILL.md)
- External benchmark or comparison diagnosis: [comparison-review](../comparison-review/SKILL.md)
- Inspecting/exporting kept harnesses: [harness-audit](../harness-audit/SKILL.md)
- Stacking, consolidating and landing PRs: [stack-pr](../stack-pr/SKILL.md), [consolidate-stack](../consolidate-stack/SKILL.md)
- Claims and external review bundles: [attribution-and-proof](../attribution-and-proof/SKILL.md), [oracle-handover](../oracle-handover/SKILL.md)

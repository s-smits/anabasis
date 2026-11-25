---
name: run-improvement-campaign
description: "Use when managing ongoing improvement cycles (the Super Loop), forking fresh runs, working toward a release, running a pass or audit, interpreting a promotion, diagnosing a non-promoting campaign, or planning the next run. Tracks milestones and pre-registered predictions, backtracks predictions after each promotion to decide pause-and-act vs continue up to 5 promotions, enforces transfer-first checks and recurrence escalation, investigates via `scripts/wri2p2.ts`, stacks fixes, proves model-free, and forks fresh evaluation runs. Owns the experiment and its evidence; `AGENTS.md` section 3 owns operator decisions."
---

# Run improvement campaign (the Super Loop)

Three nested cycles:
- **Release cycle**: merges the PR stack on operator authorisation once a fresh proof run at the stack top promotes twice at one unchanged commit.
- **Iteration (WRI2P2)**: backtracks predictions at each promotion (1–5 max) or non-promotion trigger to decide pause vs continue, pauses cleanly, investigates (single run or paired ablation as equals), vets adversarially, lands confirmed repairs/removals as one stacked PR, proves model-free, and forks fresh evaluation runs at its head.
- **Pass**: reports the five points, locates the bottleneck link, repairs its owner, proves model-free, pre-registers predictions, and launches fresh.

Only a fresh campaign opened from a prompt at a single commit is valid climb evidence (`AGENTS.md` §10, item 9).

## What to do when

| Trigger | Read first | Next action |
| --- | --- | --- |
| Starting, resuming or waking | `wri2p2.ts due`, `cycle.md` | Check `measures` drift and hook continuity; act on the live decision/trigger or oldest pending step (`wri2p2.ts next <dir>`) |
| Promotion (1st–5th) | `runs view <name>`, `starter-reads.ts`, `wri.ts read`, `predictions-<run>.md` (plus paired sibling) | Execute the per-promotion gate below: backtrack every row of `predictions-<run>.md` at current log event count; check `written-after` transfer; decide pause-and-act now vs continue to `N+1` (up to 5 max) |
| Starter read, non-step or ending | `runs view <name>`, `starter-reads.ts` | Resolve `outcomes-<run>.md` at current log event count (convert `pending` → `not-observed` when stopped); once paused or ended, run `wri2p2.ts open` |
| Runner slot frees up | `runs active`, `runs usage`, `runs loadwatch --once`, `run-queue.md` | Step 5: dry-run, write sharp `predictions-<run>.md` (early vs multi-epoch), launch via `runs fresh` |
| Lanes or synthesis finish | `wri2p2.ts next <dir>`, `wri2p2.ts ledger <dir>` | Execute WRI2P2 step 3 (adversarial vet, recurrence check, cross-domain, plan) |
| Code fix ready | `stack-pr/scripts/stack.ts`, `repository-practice/scripts/preflight.ts` | Step 4: `/simplify`, model-free `system-path-simulation`, `land --sanitize`, then step 5 |
| Spend with no milestone progress | `runs pulse <name>`, `wri.ts read --log <log>` | Diagnose via "Milestones and the walk" below |
| Step open 2 days or double-claimed | Elapsed hours in `due`; `cycle.md` | Claim step, log deviation or assign one owner in `cycle.md` |
| `jobstat` pauses at ≥2 promotions (or pauses/stops with 1) without outside read | Prior prediction, `score.ts table`, `compare.ts levels` | Follow [references/outside.md](references/outside.md) (`runs bench`, `outside-reads.md`); never let owed reads pile up |
| Handover or timer audit | `timers.ts <transcripts>`, active `until.ts` hooks | Verify promotion hooks are armed in `cycle.md`, retire dead timers, report the five points |

## The release cycle

Operator authorisation (e.g. "work towards 0.6.4") covers the cycle's runs, scheduled pauses and stack patches; landing, tagging, stopping live runs mid-flight and new cycles require fresh operator authorisation (`AGENTS.md` §3, §11). Log grants, per-promotion decisions and open choices in `cycle.md`.

```text
iteration: predict (early + multi-epoch) → fork at top → backtrack at each promo (1–5 max, or non-promo trigger) → pause --after reported → WRI2P2 → adversarial vet + recurrence check → cross-domain → plan (repair or remove) → one stacked PR → simplify & simulate → predict → fork
release:   proof run at top (2 promos, unchanged) → 3 reviewers → consolidate → land & tag on operator's word → fork at release
```

### Cycle files

Live in `.ana/wri/<YYYY-MM-DD>-cycle-<release>/` on the central archive host, never under `data/`:

- `cycle.md`: authorisation, per-promotion decisions (1–5), active hooks/timers, reviews and one dated line per step ([references/cycle-ledger.md](references/cycle-ledger.md)).
- `deviations.md`: `| step | reason |` rows for deliberate gate overrides and live-run continuations (`pause:<run>`), read directly by `wri2p2.ts` (`deferredBy`) alongside investigation folders.
- `run-queue.md`: priority-ordered launches tagged `ready: yes|no` with required gate (automated wakes launch `ready: yes` only).
- `predictions-<run>.md` (write before `--yes`; if missed, write immediately noting current solve and event counts):
  `| id | PR | labels | lanes | group | claim, as a count | refuted if |`
  Keep ledgers sharp (~8–15 load-bearing rows, not snowballed archives): cover every PR since the previous fork, each component contract/boundary under test, explicit **keep-or-revert bars** for newly added components, and supply/climb/honesty rows. Mark whether each claim settles **early-epoch** (by promo 1: draft audit, grounding, portability, supply floor) or **multi-epoch** (promos 2–5: `written-after` confirmation, post-promotion Examiner targeting, practice boundary, sustained climb). `group`: `first` | `again` | `off-run` | `outside`.
- `outcomes-<run>.md`: marks each own id and `## Carried` (`<parent>:<id>`) as `confirmed` | `refuted` | `not-observed` | `pending`, with `Log events at resolution: <n>` on its own line (log growth past `<n>` automatically reopens `not-observed`/`pending`). When a run stops or pauses for investigation, resolve every non-`outside` `pending` row to `confirmed`, `refuted`, or `not-observed` immediately rather than leaving stopped runs with unresolved `pending` rows.
- `outside-reads.md`: external benchmark ledger for `jobstat` runs ([references/outside.md](references/outside.md)).
- `plan.md` (inside the iteration dir, linked from `cycle.md`): one row per confirmed finding (`vet-<n>`), refuted prediction, live defect and lever ([references/levers.md](references/levers.md), ≥3 lever ids), plus `## Not done` and `## Intentionally opposed` (≥1 trade-off or `none`). Retire obsolete or superseded parent predictions under `## Intentionally opposed` so `carryOf` does not snowball them into future forks. Name `Pull request: #N` (or `Pull request: none — <reason>` when vetting leaves zero code repairs), and update `plan.md` with empirical count and `date -u` whenever the PR diverges.
- `wri2p2.ts ledger <dir>` derives cycle, dropped and still-missing views; never write those views by hand.

### Per-promotion decision gate (1 to 5 promotions)

Every promotion (`harness.promoted`, 1st through 5th) triggers a sequential **prediction-backtracking triage** surfaced by `wri2p2.ts due` (`step: decide` for promotions 1–4; `step: pause` at ceiling 5), `runs pulse` and promotion hooks (`until.ts <run> --at harness.promoted:next`). Driving investigations from promotions replaces arbitrary 90-minute clock checks — a single solve sweep can exceed 90 minutes, causing clock checks to fire repeatedly mid-sweep with no new evidence — and avoids auto-piloting to a fixed count of 2 when evidence is already settled at 1 or still incomplete at 2–4.

1. **Backtrack every prediction first**: read `runs view <name>`, `starter-reads.ts`, `wri.ts read`, `wri.ts backtrack --log <log>` (comparing against older same-domain releases with version-gap attention decay), key readers (`readings`, `scores`, `portability`, `seats`, `draft-audit`, `history`), `wri2p2.ts due`'s `measures` drift line, and any paired ablation sibling; backtrack each row of `predictions-<run>.md` into `outcomes-<run>.md` with `Log events at resolution: <n>`.
2. **Check transfer health (`written-after` + validity + freshness) before continuing**:
   - **Overfitting stop-signal**: inspect `starter-reads.ts`'s `chosen-on` vs `written-after` split (`AGENTS.md` §1). If `chosen-on` wins while `written-after` loses (unconfirmed transfer collapse), **pause and investigate** rather than burning quota climbing to 3–5 unconfirmed promotions.
   - **Validity saturation**: check `SAFEGUARD-9` and `VALID BY HARNESS`. If validity is 100% saturated while external reads (`outside-reads.md`) sit inside Starter spread, weight exam grounding (`E4`/`E10`) ahead of chasing another objective-only step.
   - **Stale-code zombie check**: if `measures` shows newer proved runtime/seat fixes above the run's commit and the run's unresolved predictions are already superseded (not a paired ablation control or high-signal climb), prefer pausing after its active comparison so the slot tests the current head.
3. **Decide pause-and-act now vs continue to promotion `N+1` (ceiling 5)**:
   - **Pause and act now** (as early as promotion 1, or at 2, 3 or 4) when backtracked predictions (`first`/`again` rows, exercised mechanism events, or a decisive falsification/defect) already supply enough evidence that another epoch would not change the repair plan, when `written-after` transfer fails, or when a newly added component already misses its keep-bar.
   - **Continue to the next promotion (up to 5 promotions maximum)** only when transfer is healthy (or still awaiting its first starter read) AND specific named multi-epoch predictions remain `not-observed`/`pending` and genuinely require a later epoch to observe (starter confirmation of the new reference, post-promotion Examiner difficulty/refusal/practice behaviour, epoch-2+ practice boundary, multi-epoch compounding, or separating genuine climb from single-epoch noise). Record in `cycle.md` the promotion `#`, settled vs open prediction ids, target promotion `N+1` and falsifier; add `| pause:<run> | past <N> promotion(s): waiting for <ids> |` in `<cycle>/deviations.md` (naming the exact trigger `"1 promotion"`, `"2 promotions"`, `"3 promotions"` or `"4 promotions"` so `deferredBy` silences `due` now and automatically re-triggers when promotion `N+1` lands); and immediately re-arm `until.ts <run> --at harness.promoted:next`.
   - **Ceiling at 5 promotions**: at promotion 5, pause and investigate rather than drifting indefinitely (continue past 5 only on explicit operator direction toward the 6-confirmed milestone, naming `"5 promotions"` in `deviations.md`).
4. **Non-promotion triggers** (when a run stays at 0 promotions): 12 elapsed hours since opening, a scored comparison with 0 untied tasks, or a natural ending after ≥1 comparison.
5. **Always pause cleanly**: pause via `runs pause <name> --after reported --yes` (under `nohup`; add `--eval` on `jobstat` from promotion 2 onwards), never directly at `harness.promoted`, so the owed starter confirmation (`heldBy`) tallies before investigation opens. Wait until the run rests, then re-resolve `outcomes-<run>.md` at the final event count.
6. **Paired and ablation runs**: evaluate both arms together at each promotion gate, and open them as equals (`wri2p2.ts open <runA>,<runB>`) so synthesis attributes causal deltas across mechanisms rather than anecdotes.

### Iteration (WRI2P2)

```sh
bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts [due] [<part> ...] [--days 2]
bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts open <name>[,<name>] [--out <dir>]
bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts next <dir>
```

1. **Rest & resolve**: after pausing at the decision gate (or non-promotion trigger), wait until the active comparison/starter read finishes and resolve `outcomes-<run>.md` at the stopped log's event count (leaving zero non-`outside` `pending` rows).
2. **Investigate**: run `wri2p2.ts open <name>[,<peer>]` (`open` snapshots internally; opening a *live* unpaused run is a deviation requiring operator direction logged in `deviations.md`). Follow `wri2p2.ts next <dir>` through `instruct` → `lanes --agents 4` (importance-ranked 20-lane catalogue: Lane 1 blind reach/soundness, Lane 2 longitudinal version backtracking, Lane 3 reward hacking) → lane reports → `wri.ts record` → `isolated` (auto-skipped when `overview.md` fires no isolated-lane trigger) → `collect` → `synthesis`.
   - **Inline blindness discipline**: when executing lanes inline without subagents, audit the harness tree (lane 1) before reading detailed comparison or outside scores whenever feasible; if outcomes were already read at the promotion gate, state non-blindness explicitly in `lanes/01-report.md` rather than claiming blind scoring or skipping the structural audit.
   - **Scope matching**: default to full 20-lane WRI2P2 for fresh stack-top runs and paired ablations (`open <A>,<B>`); use a delta audit only on explicit operator direction for superseded low-alpha runs.
3. **Adversarial vet, recurrence escalation, cross-domain check & plan**:
   - **Vet adversarially (`vetting.md`, `vettingFaults` = 0)**: backtrack every prediction id first, then actively try to **refute** each synthesis finding before confirming it — verify (a) whether `git log <run-commit>..HEAD` already fixed it on the stack, (b) whether the delta sits inside A/A or single-rollout noise, and (c) whether subtracting or simplifying an existing mechanism beats adding a new guard (`AGENTS.md` rule 13).
   - **Recurrence escalation rule**: check `wri2p2.ts ledger <cycle>` before planning. If the same prediction or defect has been **refuted across ≥2 consecutive fresh runs**, forbid another local prompt tweak and escalate to a structural rewrite of the owning compartment (`commit-r`), a paired ablation, or explicit `## Intentionally opposed` / operator escalation (if an `AGENTS.md` §3 bound governs it).
   - **Keep-or-revert rule**: if a newly added component, audit pass or gate misses its pre-registered keep-bar, plan its **removal or simplification** rather than layering patches on top.
   - **Cross-domain & plan**: inspect 5–10 recent vetted investigations from other domains into `cross-domain.md`; write `plan.md` covering every confirmed `vet-<n>` row, ≥3 lever ids (`references/levers.md`), `## Not done` and `## Intentionally opposed` (retiring dead/superseded predictions so `carryOf` stays lean). If vetting leaves zero code repairs, record `Pull request: none — <reason>` so the iteration closes cleanly without a pointless fork.
4. **Implement in separable, ablatable, simulatable slices**: fold refinements into your own owning PR when touching the same compartment (`stack-pr`), otherwise land each mechanism as a clean, independently ablatable and pre-run simulatable PR at the stack top (avoid mixing unrelated mechanisms into one un-ablatable rewrite; consolidate by mechanism before release). Run `/simplify`, execute a pre-run model-free simulation gate for every behavioural slice via `system-path-simulation` (before/after counterfactual archive replays on real logs, seeded `runs rehearse`, wall perturbation probes, or bounded property checks — proving the defect reproduces before and clears after at \$0, never model-seated simulations), prove the full stack with `bun run land -- <top> --sanitize`, and record `Pull request: #N` in `plan.md`.
5. **Predict & fork**: skip forking if the PR changes zero files in `CODE_TREES` (`log` in `deviations.md` as `| launch | ... |`). Otherwise dry-run `runs fresh --as forkedPR<N>` to lock the exact run name, write a crisp `predictions-<run>.md` (carrying non-opposed unheld parent ids in `## Carried`, tagging early vs multi-epoch rows, and setting keep/revert bars for new components), launch only `ready: yes` entries, and immediately arm `until.ts <run> --at harness.promoted:next`.

`next` gates: `open` → `instruct` → `lanes` → `reports` → `record` → `isolated` → `synthesise` → per-run `predictions`/`outcomes`/`carry`/`outside` → `vet` → `across` → `plan` → `implement` → `launch` → `forks` → `done`. Override any gate except `done` via `| <step>[:<run>] | <reason> |` in `deviations.md`.

### Running, consolidating & proving a release

- **Running window**: launch at tag or PR head (`gh pr view <n> --json headRefOid`), check `runs hosts --health` and `runs loadwatch --once`, track via `wri2p2.ts due`.
- **Improvement window (after cycle pause)**: pause authorised runs cleanly (`runs pause <name> --after reported --yes`; mid-flight `runs stop` requires explicit operator approval), run WRI2P2, consolidate the stack by mechanism (`consolidate-stack`), and land on operator authorisation (`bun run land -- <top> --merge --tag v<x.y.z>`).
- **Proof run bar** (required before `--merge`): fresh run at the stack top reaching 2 promotions with (1) single clean commit throughout (`runs source`, `wri.ts read` row C), (2) modified runtime mechanisms emitting their log events (or noted unmeasured), (3) zero defect endings before promotion 2 (rate limits resume at the same commit per rule 15), and (4) nothing stacked above it. Cite run name, commit SHA and both `harness.promoted` events in release notes.

## Resume & the five points

```sh
bun run runs status
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

At least one live slot stays on `jobstat`. Evaluate every `jobstat` run's newest promoted reference on JobBench's eight-task subset beside a fresh paired Starter—automatically on pause from promotion 2 onwards, or after lane 8 (skipping if soundness ≤2 or bloat) when pausing or stopping with 1 promotion. Roll owed reads promptly so transfer feedback stays current rather than piling up a multi-run backlog. Nothing from JobBench ever enters seats, prompts, checks or queries, and external scores never gate promotions. See [references/outside.md](references/outside.md) for partitions, `outside-reads.md` columns, `runs bench` execution and spread actions.

## Milestones and the walk

| Milestone | Log event | Check |
| --- | --- | --- |
| M0 opened | Receipt, `campaign.opened` | `runs source`: clean single commit, fresh opening |
| M1 exam | `exam.drafted`, `referee.draft`, `checker.read`, `contract.frozen` | Faults by kind, draft-audit findings, `doNothing`, `admitted` |
| M2 supply | First `task.gate` | Held vs refused by reason, objective gap, dry run |
| M3 first reading | First `comparison.reported` | `valid.informative.old`, untied vs tied, `scored.detectable`, A/A, load |
| M4 step | `reading: step` vs reference | Margins, retained tally, A/A |
| M5 promotion | `harness.promoted` | Reading, untied count, A/A, cumulative risk; `wri.ts climb`; per-promotion gate |
| M6 next epoch | First Examiner & comparison post-M5 | Drafts held vs refused, frontier & retained sizes, `written-after` starter confirmation |
| M7 ending | `campaign.ended` | Ending kind, closing report, final prediction outcomes |

On stalls (spend without milestone progress; exclude rule-15 limit waits), walk from the active milestone and stop at the first failing link (matches WRI lane 16):

| # | Link | Point | Fails as | Owner |
| --- | --- | --- | --- | --- |
| 1 | supply | 3 | `tasks`/`short` rows, refused drafts (`< comparisonFloor`) | `src/examiner/prompt.ts`, `heard` (`record.ts`), `propose_tasks` (`write.ts`), `supplyRun`/`tasksToAskFor` (`decide.ts`), `comparisonFloor` (`admission.ts`) |
| 2 | instrument | 4 | `exam` ending, checker faults, tasks set aside, audit ceremony | `planOf` (`opening.ts`), `readChecker` (`acceptance.ts`), `reviewDraft` (`src/audit/draft-audit.ts`), check author |
| 3 | room | 1 | `no-room`, zero `valid.informative.old` | Link 1; `evalHeadroom` (`reports.ts`) |
| 4 | session | 1 | Unchanged `build.finished`, idle sessions, practice all passing | `src/builder/prompt.ts`, `tools/d2/campaign-actions.ts`, `idleOf` (`campaign-terms.ts`) |
| 5 | size | 2 | Excess ties, near miss, high `scored.detectable` | `--target` for next run; link 1 |
| 6 | host | 2 | `HOST LOADED`, `LOAD MOVED`, long `campaign.waited` | Concurrent campaigns/host |
| 7 | promotion | 2 | `no-step` near alpha, retained loss, A/A step | Links 1 & 5; `isSignificant` (`compare.ts`) |
| 8 | next epoch | 1 | Refused drafts, thin frontier after promotion | `make` (`harness-builder.ts`), `ROWS` (`decide.ts`) |

## Event hooks and timers

Never run recurring clock-polling loops (`1h`, `90m`, `2h/4h/6h/8h`) — a single solve sweep can outlast 90 minutes, so clock polls fire repeatedly mid-sweep with no new evidence. Drive the loop strictly from promotion events (`until.ts <name> --at harness.promoted:next`, stepping 1 → 2 → 3 → 4 → 5), `runs alerts`, `runs pulse` or subagent completions. On each promotion wake, execute the per-promotion backtracking gate above: either arm `runs pause <name> --after reported --yes` and wait for rest to open WRI2P2, or record the unresolved prediction ids in `cycle.md` + `<cycle>/deviations.md` and immediately re-arm `until.ts <name> --at harness.promoted:next` (up to 5 promotions maximum). On every handover or session resume, verify that every live run's promotion hook is still armed and listed in `cycle.md`. Reserve one-shot timers strictly for non-event deadlines such as the 12h non-promoting ceiling or a single handover ([references/timers.md](references/timers.md); audit via `timers.ts`). On non-promotion wakes: check `date -u`, `wri2p2.ts due` and `cycle.md` (if idle, print one line and touch no files); execute one authorised step; chain a 10m one-shot only if actionable steps remain, else wait on the next event; log a `cycle.md` row only on state change.

## Related skills

- Lifecycle commands (`fresh`, `pause`, `stop`, `loadwatch`, `bench`): [run-management](../run-management/SKILL.md)
- Slot policy, eviction, long-horizon and release proof bars: [decision-points](../decision-points/SKILL.md)
- Running lanes (23-lane catalogue), vetting and synthesis: [whole-run-investigation](../whole-run-investigation/SKILL.md)
- Model-free replays, rehearsals and wall probes: [system-path-simulation](../system-path-simulation/SKILL.md)
- Compartment rewrites on repeated failures: [commit-r](../commit-r/SKILL.md)
- Cohort tables, cost repricing and multi-week trends: [promotion-tuner](../promotion-tuner/SKILL.md)
- External benchmark or comparison diagnosis: [comparison-review](../comparison-review/SKILL.md)
- Inspecting/exporting kept harnesses: [harness-audit](../harness-audit/SKILL.md)
- Stacking, consolidating and landing PRs: [stack-pr](../stack-pr/SKILL.md), [consolidate-stack](../consolidate-stack/SKILL.md)
- Claims and external review bundles: [attribution-and-proof](../attribution-and-proof/SKILL.md), [oracle-handover](../oracle-handover/SKILL.md)

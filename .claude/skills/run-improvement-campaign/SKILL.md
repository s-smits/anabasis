---
name: run-improvement-campaign
description: "Operate the Anabasis improvement loop (the Super Loop) across its iterations and release cycles: fork fresh campaigns, track milestones, and resolve pre-registered predictions; when a run hits its trigger (two promotions, twelve hours, or a comparison leaving no untied tasks), pause it after its next comparison, investigate it (`scripts/wri2p2.ts`), implement findings as one stacked pull request, and fork fresh evaluation runs at its head; land the release once a proof run at the top promotes twice. Each pass scores the five evaluation factors, identifies the bottleneck blocking the next promotion, repairs its owning mechanism, verifies the path, and pre-registers predictions. Use when asked to manage ongoing campaigns, fork runs, work towards a release, run a pass or audit, interpret a promotion, diagnose a non-promoting campaign, or plan the next run. Owns the experiment and its evidence; `AGENTS.md` section 3 owns operator decisions."
---

# Run improvement campaign (the Super Loop)

The improvement loop is a controlled experiment over codebase revisions structured into three nested cycles. A **release cycle** merges the pull request stack as a single release, on the operator's authorisation, once a proof run launched at the stack top has achieved two promotions. Each **iteration** (WRI2P2) investigates one fresh run that has reached its stopping trigger, translates confirmed findings into a single stacked pull request at the top, and forks fresh runs at its head to measure the effect. A **pass** identifies the bottleneck preventing the next promotion through a fixed sequence: score, walk, choose, prove, predict, launch, watch, read, and decide.

Only a fresh campaign opened from a prompt at a single commit constitutes valid evidence of climb (`AGENTS.md`, section 10, item 9); seeded runs, stored packs, and continuations across commits verify execution paths only. Measurement integrity is never traded for apparent progress: relaxing significance thresholds, reusing cached solves, leaking held-out tasks across the evaluation boundary, or supplying numeric targets to the Examiner invalidates the reading.

## What to do when

Within the fixed workflow ordering and operator decision boundaries below, choosing which lane, lever, or diagnostic to prioritise and how far to advance in one session is left to the session's judgement. Always run the inspection script first and decide from its output.

| Trigger | Read first | Next action |
| --- | --- | --- |
| starting, resuming, or waking without a specific task | `wri2p2.ts due`, then `cycle.md` | act on the live run trigger listed, or else the longest-standing pending step; `next <dir>` prints the full instructions |
| a comparison report, promotion, starter read, or campaign ending arrives | `runs view <name>`; comparison-reading's `starter-reads.ts` after a promotion | follow "Milestones"; resolve that run's predictions with the current log length; at a trigger, run `wri2p2.ts open` |
| a runner slot becomes free | `runs active`, `runs usage`, `runs loadwatch --once` (its final line orders hosts least loaded first), and the cycle's `run-queue.md` | execute iteration step 5: write `predictions-<run>.md`, dry-run, then launch with `runs fresh` |
| investigation lanes finish, or a synthesis is written | `wri2p2.ts next <dir>`, `wri2p2.ts ledger <dir>` | execute iteration steps 2 and 3 |
| a code fix is ready | stack-pr's `stack.ts`, repository-practice's `preflight.ts` | execute step 4 with before-and-after verification, then step 5 |
| a run incurs spend while its milestone does not advance | `runs pulse <name>`, `wri.ts read --log <log>` | follow "A stall", then "The walk" |
| a step has remained open for two days, or two sessions claim the same step | the elapsed hours printed by `due`; the rows of `cycle.md` | claim the step, record a deviation in `deviations.md`, or assign a single owning session in `cycle.md` |
| a jobstat run rests at a pause with two or more promotions (or stopped with one) and its newest promoted reference has no external benchmark read | the previous read's prediction file; `score.ts table` and `compare.ts levels` over the store | follow "The outside aim": write the prediction, dry-run, start detached rollouts, log the row in `outside-reads.md`, and proceed immediately with the next iteration step |
| a handover is due, or a timer fires with nothing actionable | `timers.ts <session transcripts>` | follow "Timers": retire or retime the timer, then report the five points |

## The release cycle

A release cycle operates under explicit operator authorisation (for example, "work towards 0.6.4"). That authorisation covers the cycle's runs, their stops, and its patches; landing, cutting the release, and starting subsequent cycles are covered only where explicitly named, and merging always remains the operator's authority (`AGENTS.md`, section 11). Record every grant and open decision in the cycle ledger, `cycle.md`, which every step reads first.

The execution order is strict, and no step advances ahead of its predecessor:

```text
iteration:  predict → fork at the top → run (2 promotions or 12 hours) → investigate → vet → plan → implement (one PR on the top) → prove → predict → fork at its head → ...
release:    proof run at the top to 2 promotions, unchanged → three reviewers → consolidate → land and release on the operator's word → fork at the release
```

Because each run evaluates the exact codebase it executed, landing a release before completing its investigation ships without incorporating the findings. If a deadline leaves insufficient time, consult the operator instead of landing prematurely.

### The cycle's files

All files for a release cycle reside in a single directory on the central host's main checkout, `.ana/wri/<YYYY-MM-DD>-cycle-<release>/` (dated by the initial fork, such as `2026-11-07-cycle-v073`), alongside its investigations. Never store cycle files under `data/`, where `fetch`, `retire`, and `derive` replace campaign directories wholesale. `wri.ts index` lists each recent run alongside the ledgers referencing it, so ledgers are never duplicated.

- `cycle.md`: records the operator's authorisation, promotion threshold, reviews, and one log line per step, formatted according to [references/cycle-ledger.md](references/cycle-ledger.md).
- `run-queue.md`: lists queued launches in priority order, each tagged `ready: yes` or `ready: no` alongside the evidence gate required to mark it ready. Timers launch only entries already marked `ready: yes` and never promote an entry to ready themselves.
- Two authoritative files per run. `predictions-<run>.md`, written before passing `--yes` to launch (since the first solve begins minutes after opening), records every hypothesis the run will test in a table whose first column is `id`:

  ```text
  | id | PR | labels | lanes | group | claim, as a count | falsified by |
  ```

  Collectively, a cycle's runs include at least one row for every pull request merged since the previous cycle's fork (`git log --merges <last fork>..<release>`), including changes not exercised by any run, plus cycle-wide rows tracking supply, climb, and honesty. Each row's lanes derive directly from its labels (`whole-run-investigation`'s `references/lanes.md`, "Labels"); needing an extra lane indicates a misapplied label. The `group` column is one of: `first` (code not yet tested in any run), `again` (previously tested under a different condition), `off-run` (never executed by a seat; settled by landing, a reader, or launch), or `outside` (settled exclusively by a count from the run's external benchmark read rather than a campaign log event; its outcome stays `pending` while its row in `outside-reads.md` is owed or absent, and `next` requires resolution once that row reads `scored` or `skipped`, after which further log growth does not reopen it).

  `outcomes-<run>.md` assigns exactly one outcome (`held`, `falsified`, `unreached`, or `pending` while a live run's event has not arrived) to each of its own prediction ids and each `<parent run>:<id>` listed in `## Carried`, and no others. It also records the log event count at evaluation on a standalone line, `Log events at resolution: <n>`, which `next` prints; if the log grows past `<n>` (for instance, when a run continues past its trigger), `next` automatically reopens every `unreached` or `pending` row.
- Deferred work and deliberate omissions belong in the investigating iteration's `plan.md`: `## Not done` lists every confirmed item omitted from the pull request along with where it is carried, and `## Intentionally opposed` (containing at least one line, or `none`) documents gaps left out by design (citing a trade-off from `AGENTS.md` section 1, a design principle, or operator direction) so intentional omissions are not mistaken for oversights.
- Summary views are derived automatically rather than maintained by hand: `bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts ledger <dir>` prints, for any cycle or investigation directory, the cycle view (every prediction across its runs with current outcomes and staleness flags), the dropped view (every `unreached` or `falsified` id absent from both any `## Carried` section as `<run>:<id>` and its plan's `## Intentionally opposed` section; note that `## Not done` does not carry an item forward, so each dropped id must be written into a live run's file or `## Intentionally opposed` until the view reads `none`; ids from resting runs not yet linked to an investigation appear separately as unread), and each run's still-missing view (unheld ids paired with its plan's two sections). Legacy `Predictions.md` and `still-missing-<run>.md` files remain readable, though no new ones are created.

If a review discovers a missing `predictions-<run>.md` for an active run, write it immediately, explicitly annotating it as written post-launch alongside the solve count at that moment.

### The iteration (WRI2P2)

WRI2P2 (Whole Run Improvement, Implementation, Plan, Stacked PR Protocol) progresses from a single run's trigger to a stacked pull request and fresh evaluation runs at its head; those follow-up runs launch automatically within the cycle's authority. One script inspects the state of every run and iteration and prints the next required command:

```sh
bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts [<part> ...] [--days 2]
bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts due [<part> ...] [--days 2]
bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts open <name>[,<name>] [--out <dir>]
bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts next <dir>
```

The script operates on the central host's gathered copies of all hosts' runs, requiring no SSH access or environment files; it writes only investigation files and never stops, launches, or merges anything. Invoked without a subcommand, it prints one row per run showing its current stage (`run`, `open` with its trigger, or its active investigation step). `due` prints a concise summary of actionable steps only (suited to timers), followed by one line per external benchmark read still listed as `owed` in `outside-reads.md` (also printed by `next` for completed iterations so owed reads remain visible until `scored` or `skipped`).

1. **Trigger.** A run triggers on whichever occurs first: two promotions, twelve elapsed hours since opening, a scored comparison leaving zero untied tasks, or a natural ending after at least one comparison. When a live run triggers, `wri2p2.ts` prints `pause`: execute its command (`runs pause <name> --after reported --yes`, under `nohup`) to stop the run at the first clean boundary after its next comparison reports, when only the Builder conversation is open. Because the comparison tally and reading are logged atomically once all solves complete, no data is lost; if a pause lands between a `step` report and its promotion, the promotion executes on the next move (`decide`). After a promotion, `--after reported` waits until that promotion's starter confirmation comparison tallies (`heldBy`), ensuring the run rests with its latest promotion confirmed. While waiting, the run's status is `waits` (omitted from `due`); if a `continue --after` waiter is already active on the run, a second pause is refused and remains owed in `due`. Once paused, resolve the run's predictions in `outcomes-<run>.md` with the current log event count.
2. **Investigate** via `whole-run-investigation`, opening the folder with `wri2p2.ts open` alongside any peer triggered runs sharing the same commit and pack once the run has stopped, so the synthesis incorporates the final comparison. `open` passes each run to `wri.ts start`, fetching remote campaigns in full so readers have every kept harness state. For a run kept live under operator direction, it reads a frozen copy via `wri.ts start --snapshot` (recorded as a deviation) and writes `iteration.json` (`{ "opened": <ISO>, "runs": [<names>], "protocol": 2 }`), which subsequent gates require; legacy folders lacking a protocol number retain their original gates. Follow `wri2p2.ts next <dir>` through lane instructions, `lanes --agents 4` (one subagent per lane), `wri.ts record` launched in the same turn as the lanes (`record.md`, `whole-run-investigation` step 4; `next` flags any missing reads), collection, and synthesis. Before vetting, `next` verifies that each run has both ledger files (searching only `*-cycle-*` folders and the investigation folder itself, and refusing if duplicates exist across folders).
3. **Vet, check cross-domain generality, and plan.** Vet each finding against raw logs and current `HEAD` (as a fix may already sit on the stack) as `confirmed`, `plausible`, or `refuted` in `vetting.md`, using the fixed findings table schema from `whole-run-investigation` ("Vetting"): each `vet-<n>` row cites its supporting lane findings and either a standing-findings register key or `new`, and each confirmed row specifies its importance and fate, enforced by the `vet` gate. Re-evaluate every prediction first so `vetting.md` accounts for all prediction ids: falsified predictions become findings, while unreached ones carry forward. Behaviour documented as intentional in `AGENTS.md` is escalated to the operator with evidence and a recommendation, and any standing key that `wri.ts findings` shows recurring without repair is raised once with its archive counts.

   Because fixes implemented for one domain apply across all domains, a read-only subagent then inspects the 5 to 10 most recent vetted investigations from other domains (none predating the previous minor release) and writes `cross-domain.md`: for each confirmed defect, whether other domains exhibit it, what differed where they do not, and whether prior fixes failed to hold; for each proposed fix, its expected effect across domains and the cheapest discriminating test.

   `plan.md` (linked from `cycle.md`) lists one row per confirmed finding, falsified prediction, and live defect, naming its owning module, a hostile test that fails without the fix, and its required before-and-after verification. It covers parameter tunings alongside bug repairs: evaluate [references/levers.md](references/levers.md) against the active bottleneck, giving each evidence-selected lever a row (either tuned or retained with one falsifiable sentence). `next` enforces that `plan.md` references `cross-domain.md`, accounts for every confirmed `vet-<n>` (in a plan row or `## Not done`), cites at least three lever ids (such as `E1`), and includes `## Intentionally opposed`. Escalate operator-owned rows promptly and implement around them.
4. **Implement** the plan as one stacked pull request at the top via [stack-pr](../stack-pr/SKILL.md), verified with `bun run land -- <top> --sanitize`, and record `Pull request: #N` on its own line in `plan.md`. Rows matching the label of one of your own open pull requests belong in that PR; peer pull requests are stacked above rather than modified; omitted rows go under `## Not done`. Validate each behavioural patch against its parent commit on identical logs or seeds (`system-path-simulation`, `cases/before-after.md`), and tune prompt changes using paired live-seat rounds (`cases/optimize.md`) rather than single draws. State in the pull request description what moved relative to predictions; subsequent fresh runs, never the run in which the defect was observed, evaluate the fix. Patches produced by a Codex swarm are stacked by the primary agent via `git apply --3way`, running the full verification gate on the composed stack top because independently passing commits can interact.
5. **Predict, then fork at the new head** using `--as forkedPR<N>`, which allows `next` to link the evaluation runs to the pull request (forks targeting a different PR head require a `launch` entry in `deviations.md`). Obtain each campaign name from a dry run of `runs fresh` and write its `predictions-<run>.md` first, including a `## Carried` section listing every unheld parent id as `<parent run>:<id>` plus one row per prediction defined in `plan.md` (`next` flags `carry` for any plan id absent from both the fork's predictions and `## Not done`). Launch a run only for what it tests, never merely to fill an idle slot: open its prediction file by naming the untested component (the new fix, or a single ablated term or prompt) with a `first` row for each. Allocate a freed slot to the first `ready: yes` entry in `run-queue.md` that tests such a component; otherwise leave the slot idle.

`next` enforces these gates sequentially: `open`, `instruct`, `lanes`, `reports`, `record`, `isolated`, `synthesise`; for each run `predictions`, `outcomes`, for a fork `carry`, and for a jobstat run `outside` (its row in `outside-reads.md`); followed by `vet`, `across`, `plan`, `implement`, `launch`, `forks`, and `done`. Folders lacking `iteration.json` enforce only the shared gates. Every gate except `done` is an overridable default rather than a hard block: adding `| <step> | <reason> |` (or `<step>:<run>`) to `deviations.md` satisfies it, and `next` prints `deviated: <step> · <reason>`.

Iterations may overlap: a second run can trigger while the first iteration's pull request is still in progress, with each PR stacking atop the previous one. Individual iterations are never merged piecemeal; the release lands the consolidated stack.

### The running window

1. **Predict** in the cycle ledgers ("The cycle's files") before launching.
2. **Fork** at the previous release's merge commit (`git tag` on `main`) or at an iteration's PR head, noting any PRs stacked above it. For a cycle opening, fork one fresh campaign per runner host (or the subset specified by the operator) after a dry run: `runs fresh <pack> --host <host> --at <commit> --login N --as <suffix> --yes`. Select hosts from `ANA_HOSTS` (`hostsOf`) after checking `runs hosts --health` and `runs loadwatch --once` (whose final line orders hosts least loaded first), and launch sequentially because concurrent `fresh --host` invocations from one checkout conflict. Standard forks let `fresh` choose placement; note that automatic placement does not check whether a peer holds the pack's prompt, so packs whose prompt exists only on the central host require `--host here`. Reference PR heads by PR number in ledgers and resolve the commit hash (`gh pr view <n> --json headRefOid`) at launch time (including in automated launch scripts), because merging lower PRs replays stacked branches onto new commit hashes. Tag and push each launched commit as specified in `run-management`.
3. **Monitor** via `wri2p2.ts` at every review and milestone, resolving each prediction promptly when its settling event arrives. Record live defects in the plan without stopping the active run to patch them. Whenever the stack advances while runs are active, each `measures` line in `wri2p2.ts due` counts how many solve-executed files (`codeOf`, `tools/d2/campaign.ts`: `src`, `vendor`, campaign commands under `tools/d2`, `tools/c`, and `tools/d1b`, and package manifests) differ between the live run's commit and the current checkout, none of which are measured until a run forks at the new head. Stack non-runtime changes (auxiliary tools, tests, skills) whenever ready, consolidate runtime changes into the iteration's single PR, and fork at its head before stacking further runtime changes.

### The improvement window

Steps 4 through 9 share a twelve-hour budget from the final run stop. If a step overruns, report what remains and proceed in order; time pressure never justifies skipping a step.

4. **Stop** runs past the threshold only where covered by operator authorisation, using `runs on <host> stop <name>` (because two hosts can hold identical names); leave all other runs active and inspect them via snapshots. A stop word (`tools/d2/word.ts --stop`) takes effect only at the next move boundary. Resolve completed predictions and mark unmet ones `unreached`.

Steps 5 through 8 investigate, vet, plan, and implement across the stopped runs as equals, mirroring iteration steps 2 through 4 and invoking isolated lane 6 of [whole-run-investigation](../whole-run-investigation/SKILL.md) where warranted.

9. **Consolidate** the PR stack by topic before landing: review grouped changes, fix confirmed issues, regroup, publish, and verify with `bun run land -- <top> --sanitize` (`consolidate-stack`).
10. **Land and release** on operator authorisation: `bun run land -- <top>` verifies every commit, and `--merge --tag v<x.y.z>` awaits CI, merges, and cuts the release; rewrite the release notes according to `stack-pr` section 9. If verification fails, report the failing commit and step and abort landing.
11. **Predict and fork** the next release cycle at the new release merge commit.

### A run proves the release

`--sanitize` verifies that every commit passes automated checks, whereas only a live campaign verifies that the stack still climbs. Every stack (including patches that do not alter model-visible text) lands only once a fresh campaign launched at the stack top achieves two promotions under four conditions:

- **Single clean commit throughout.** Every launch in `bun run runs source <name>` references the stack head (or a commit with identical `codeOf` runtime files) from a clean working tree, and `wri.ts read` row C reports one uniform host codebase.
- **Mechanisms exercised.** Every PR altering runtime conditions emits its expected log event (`AGENTS.md`, section 9); any PR whose trigger did not occur is explicitly listed as unmeasured in the release notes.
- **No defect termination.** No `environment` ending or crash occurs before the second promotion. Provider credit or session limits are expected operational events rather than defects (rule 15); resume at the same commit.
- **Nothing stacked above.** Commits above the proof run's head are unproven by it; land only up to the proven PR number. Changes to model-visible prompts wait for paired live-seat rounds before their proof run.

Release notes must cite the proof run name, its commit hash, and both `harness.promoted` events. Minor versus patch release classification follows `AGENTS.md` section 11 ("The stack and pull requests"): a minor release cites the proof run's mechanism event and its factor counts compared against the preceding minor release's runs (`promotion-tuner`, `scripts/trend.ts`). Determine which runs are comparable from their commit hashes rather than version strings.

The major version advances to `1.0` at the first release whose top satisfies every row of the v1.0 bar (`system-audit`, "The pillars and the v1.0 bar"; current values in `docs/plan.md`). Any row lacking an operator-defined threshold reads as unmeasured and blocks 1.0, so thresholds must be finalised before graduation runs. Beyond 1.0, the major version increments only when a core evaluation semantic changes: the central question of `AGENTS.md` section 1, what crosses the evaluation wall, or a factor's acceptance bar.

### The threshold

Runs do not carry a hard promotion cap by default. Each promotion triggers an alert (`runs alerts`), and a run is paused only after that promotion's starter confirmation comparison reports, because pausing earlier leaves the promotion permanently unconfirmed (`AGENTS.md`, factor 1). Reaching two promotions triggers the pause after the next comparison (the starter confirmation read), followed by investigation; `--promotions N` remains available when a hard cap is desired (`run-management`).

### Decision points

Two promotions is the default trigger rather than an inflexible rule. [decision-points](../decision-points/SKILL.md) records historical operator decisions at every lifecycle junction (non-stepping comparisons, first promotion, second promotion, subsequent promotions, and endings): when to pause at one promotion, extend to three, four, or six, or abandon a non-promoting run; how to prioritise runs when slots are scarce; when a fresh fork justifies a slot; and what each release tier requires from its proof run. When two runs are active simultaneously, slots are split by role: the older run acts as the long-horizon run (extended to three or four promotions at the session's judgement), while the second slot cycles onto the newest proven stack head. Consult `decision-points` before any pause, stop, continuation, or fork not settled by the default trigger alone. Keeping a run past its trigger requires adding `| pause:<run> | <reason> |` to an investigation's `deviations.md`; `wri2p2.ts` then marks it `kept` (omitted from `due`) until the row is removed, the run stops, or it reaches a promotion count not covered by the reason (for example, a time-based deviation does not cover reaching two promotions unless the reason explicitly states "2 promotions").

## Resume

Read the local handover document first, then inspect live state directly:

```sh
bun --env-file=.env.runs run runs status     # every run locally and on each host in ANA_HOSTS
bun run runs pulse                           # active runs and endings since the last check
bun run runs view <name>                     # comparisons, climb history, and recommended next move
bun run runs source <name>                   # launch commits and working-tree cleanliness
bun .claude/skills/stack-pr/scripts/stack.ts # open PR stack and current top
bun tools/wri/wri.ts read --log <worktree>/.ana/d2/<name>/log.jsonl
```

Record standing operator authority in the handover; the most recent instruction takes precedence.

## The five points

Open and close every pass by reporting these five metrics per campaign, stating explicitly which point the pass targets.

| # | Point | Question | Source | Acceptance bar |
| --- | --- | --- | --- | --- |
| 1 | Climb | promotions achieved from a fresh opening | `runs status`, `runs view`, closing report "Promotions" | `AGENTS.md`, factor 1 |
| 2 | Honesty | could a promotion reflect noise or drift | each report's `noise`; closing report "The chance of a false promotion" | A/A controls and cumulative risk across attempts |
| 3 | Supply | are informative frontier tasks available | `--dry-run`, setup summary in `view`, `task.gate` | `comparisonFloor(level)` frontier tasks |
| 4 | Verdicts | do human labels agree with Referee rulings | `tools/d2/settle.ts` | `AGENTS.md`, factor 3 |
| 5 | Economy | cost and time per promotion | closing report "Work and spend", `promotionsWorth`, `worthLine` | at most three attempts per epoch after setup |

Generate the closing report with `bun tools/d2/close.ts --name <name> --to <scratch dir>`, placing `--to` outside the repository or under `data/harnesses/`.

Use `promotion-tuner`'s `scripts/table.ts` to tabulate the current cycle's runs and `scripts/trend.ts` to compare them against prior weeks, testing differences against inter-run variance and reading climb rate alongside retention (`--pack buffer --back 4` is the standard control read from `AGENTS.md`, section 10). Always inspect headroom first, since active hours without informative tasks say nothing about harness capability; treat any row marked `moved` as an observational lead rather than a causal proof because windows span releases. Modifying significance level, target task count, or solves per side changes the measurement instrument rather than the harness and requires operator approval.

## The outside aim: Harness² on JobBench

The external-transfer row of the v1.0 bar (`system-audit`, "The pillars and the v1.0 bar"; values in `docs/plan.md`) asks whether a harness built blind to an external benchmark competes with Harness² on unseen tasks under that benchmark's native grader. The target benchmark is JobBench, aiming first for parity with Harness²'s held-out arm and ultimately exceeding it (`docs/backlog/jobbench-scoring.md`; `docs/backlog/v1-bar.md`, item 13), while its formal graduation threshold remains unset. Consequently, `jobstat` receives primary campaign capacity and `buffer` serves as the control domain. Unlike Anabasis, Harness² trains directly on real JobBench tasks and files (without seeing rubrics or grades, and without authoring synthetic tasks): its in-task arm adapts on the scored task itself, and its held-out arm adapts on the preceding task in the same profession. By contrast, Anabasis's Examiner synthesises every training and held-out task solely from a domain description. Scoring within the inter-rollout spread of Harness²'s held-out arm therefore already provides strong evidence for transfer, matching it is a substantial result, and surpassing it is the long-term target (`studies/harness2/README.md`, "Read every result against how uneven the comparison is").

The improvement loop supports this objective in three ways:

- **Indirectly, in every pass.** Campaigns optimise solely for promotions confirmed on their own held-out tasks. Lessons from external benchmark reads enter a plan only as general structural hypotheses stripped of benchmark names, directions, and scores, and must be falsifiable by a count inside a campaign's own log prior to any further benchmark run (`comparison-review`, `references/backtrack.md`). Two structural hypotheses are currently tracked as untested leads: harness programs tightly coupled to their build workspace, and harnesses selected on one objective under-investing in aspects unrewarded by internal comparisons. Every `jobstat` prediction file therefore includes two diagnostic rows assessing transferability: whether any step was won on validity rather than the objective alone, and whether the promoted reference continues to win tasks authored after its promotion (`starter-reads.ts`).
- **Through export fidelity.** Promoted harnesses reach JobBench via `studies/shared/claude-export.ts`. Defects in export packaging or solver instructions (`docs/backlog/jobbench-scoring.md`, items 5 and 12 to 14) are repaired at their owner prior to the next read regardless of which arm led, as export bugs corrupt measurement without touching any campaign.
- **Directly, via periodic evaluation.** Each `jobstat` run's newest promoted reference is evaluated on the eight-task subset below once the run reaches two promotions or terminates.

Nothing from JobBench crosses into any campaign: no seat, prompt, check, or domain query sees its tasks, rubrics, or scores (`AGENTS.md`, section 1, "An outside benchmark against fitting the query to it"; rules 2, 3, and 9). Domain queries remain operator-owned, and external benchmark scores never trigger promotions or count as steps.

### One jobstat run always, read at each pause from its second promotion

At least one live full campaign is always allocated to `jobstat` (even when only a single slot is available), so freed slots prioritise `jobstat` whenever none is active. A `jobstat` run's newest promoted reference is evaluated on the eight tasks below (whether confirmed or unconfirmed) at two points:

- **At every pause from its second promotion onwards.** Once the run rests, the evaluation starts automatically without waiting for operator confirmation, the investigation, or lane 14's audit (whose soundness grade and weight are appended to the row once lane 14 completes). References that lane 14 subsequently grades poorly are still scored so the archive can test whether audit grades predict external benchmark transfer. A run evaluated at two promotions and later continued to three or four is evaluated again at its next pause on its new reference under a fresh label; its row in `outside-reads.md` is updated for the new digest while preserving earlier sums, since the gate indexes rows by run name.
- **Upon stopping at another trigger with exactly one promotion.** Here lane 14's audit runs first: if lane 14 rates soundness at 2 or below (broken, overfitted, or churn) or classifies the harness as bloat, the benchmark read is skipped; otherwise the audit grade and weight are recorded in the prediction file before launching rollouts.

The receipt for every read is its row in `outside-reads.md` inside the cycle directory. `wri2p2.ts next` holds any `jobstat` investigation at the `outside` gate (after run ledgers, before vetting) until a row names the run. Rows take one of three count-only statuses:

- **scored**: all eight tasks have been rolled and judged;
- **skipped**: skipped based on lane 14's audit grade, or because the run achieved zero promotions;
- **owed**: pending due to in-flight rollouts (with start timestamp), an earlier queued read on the benchmark host, or login capacity. Even when owed, execute the dry run immediately so the reference tree is exported into the store before `retire` archives the campaign and removes its installed packages. An owed row satisfies the `outside` gate and does not block subsequent forks.

```text
| run | digest | step: tally, measure that carried it | starter read: confirmed, written-after tally | audit: soundness, weight | fair five: reference, Starter beside it | first task and outside pair: reference, Starter | scored, skipped or owed |
```

Execute owed reads together, oldest first, as soon as login capacity opens, ahead of any other paid simulation, pairing them with a single fresh Starter at two rollouts per task rather than a separate Starter per reference. Report the count of remaining owed rows in every pass summary.

`score.ts table --out <store> --tasks <the eight>` prints the full cross-arm comparison table across the store, task by task, with sums over the fair five. Include this table in the iteration report after every sitting, annotating arms from earlier sittings with their dates because cross-day comparisons are confounded by temporal drift. Alongside it, `score.ts spread --out <store> --name <rollout,...>` measures within-arm variance across rollouts: per-rollout totals over shared uncut fair tasks, overall range (defining the Starter's noise floor when given Starter rollouts), and per-task range sorted worst first.

Together, `outside-reads.md` acts as an ablation of the loop's internal selection signals against external transfer, testing whether steps, starter confirmations, or audit grades predict benchmark performance. Do not correlate columns until at least six rows hold completed scores, and note that skipped rows introduce selection censoring that the table cannot test.

### A reference's read

The full benchmark pool comprises 20 of JobBench's 65 tasks from professions closest to the `jobstat` query (`docs/backlog/jobbench-scoring.md`, item 17). Routine reads evaluate eight of these tasks: three selected from the initial pilot with prior scores visible, and five added subsequently by rule without inspecting scores. Because `score.ts score` defaults to a different eight-task pilot subset when `--tasks` is omitted, always specify `--tasks` explicitly when rolling; `score.ts table` without `--tasks` reads whatever tasks exist in the store.

| Partition | Tasks | Purpose |
| --- | --- | --- |
| the fair five | `biostatisticians/task2`, `statisticians/task2`, `statisticians/task3`, `social_science_research_assistants/task2`, `social_science_research_assistants/task3` | compares the reference against both the Starter and Harness²'s held-out arm (which holds scores on these five only) |
| the first task | `statisticians/task1` | compares the reference against the Starter where Harness²'s held-out arm has no harness; reported separately and never summed with the fair five. Historical scores (26 of 116 across six built rollouts vs 36 across two Starter rollouts) reflect rubric variance rather than export defects |
| the outside pair | `supply_chain_managers/task2`, `sociology_teachers_postsecondary/task2` | tests transfer to two professions outside the domain query against the Starter; Harness² has no arm here, so these are reported separately and inform no decision prior to the 20-task evaluation |

```text
fair five     biostatisticians/task2,statisticians/task2,statisticians/task3,social_science_research_assistants/task2,social_science_research_assistants/task3
first task    statisticians/task1
outside pair  supply_chain_managers/task2,sociology_teachers_postsecondary/task2
```

Statistical power tightly constrains what a small read can establish. Five tasks at one rollout per side cannot reach p < 0.02 even at 5-0 (sign-flip p = 1/32); two historical Starter rollouts differed by 36 of 250 points across three tasks; and arms evaluated on different days are confounded by temporal variation (`docs/backlog/jobbench-scoring.md`, item 7; `compare.ts` header comment). Additionally, the judge truncates each deliverable at 200,000 characters (`docs/backlog/jobbench-scoring.md`, item 16): every recorded workbook for `social_science_research_assistants/task2` exceeds this limit (15 of 15, with raw data sheets preceding summary sheets, accounting for 16 of the Starter's 36-point spread), as do 6 of 13 memos for `statisticians/task1`. Scores on those tasks therefore partly reflect file length. `score.ts table` flags truncated deliverables as `CUT <n>`, and its `fair uncut` summary sums each arm strictly over fair tasks where no displayed arm had a truncated file. Consequently, always roll a fresh Starter beside the reference in the same sitting; note that the fair five at two rollouts per side (20 rollouts) provides better variance estimation than all eight tasks at one rollout (16 rollouts).

1. **Arm configuration.** Select the run's newest unscored promoted reference via `--harness` (by letter alias or full digest from `runs view <name>`), assigning a unique label derived from the digest (each label permanently binds one exported tree and one rollout per task). Pair it with a fresh Starter under a new label on identical tasks; additional rollouts require distinct labels. `heldout` uses its stored fair-five record unless the operator requests re-rolling all three arms side by side. Any change to the export code or `score.ts` alters the experimental condition and requires rolling all arms afresh on every task.
2. **Pre-register predictions.** Before any rollout starts, write `jobbench-<label>-prediction.md` in the cycle directory recording the task list, arm labels and digests, sample size, known open export defects, the dry-run summary line, and count-based predictions settled by `score.ts table`: reference versus paired Starter on the fair five, reference versus stored `heldout` relative to the Starter's spread, first-task and outside-pair outcomes where run, and expected spend.
3. **Verify the path without spending.** Reads execute on the host configured in `EVAL_RUNNER` (`.env.runs`), which `runs retire` keeps clear of archived campaigns, or locally if unset. Export campaigns running on that host before `retire` archives them (one day after becoming idle), as archived copies omit installed packages. Record the store path, JobBench checkout, and judge shim in the prediction file and `cycle.md`, writing every sitting to the same store so one table covers all arms. For reads executed on remote peers, `bun run runs fetch` mirrors rollouts and judgements into `data/bench/<benchmark>` locally, which `score.ts table` and `trend.ts --bench` read directly.

   ```sh
   bun studies/harness2/score.ts score --arm <campaign> --harness <kept> --name <label> \
     --out <store> --jb <checkout> --api-base <shim url> --judge-log <shim log> --tasks <list> --dry-run
   ```

   This resolves the kept harness and tasks and writes `<store>/trees/<label>` without creating score records. If the kept harness lives on another host, run `bun run runs fetch <name>` first. Omitting `--judge-log` prevents judge cost accounting and prints `judge ?` in the table.

   Because compiled harness dependencies are architecture-specific (for instance, a harness built on macOS evaluated on Linux), cross-architecture reads must export the tree on the campaign's host for the target platform and transfer both the tree and its build receipt into `<store>/trees/`:

   ```sh
   bun studies/harness2/score.ts tree --arm <campaign> --harness <kept> --name <label> \
     --out <dir> --for linux-x64        # produces <dir>/trees/<label> and <label>.build.json
   ```

   This substitutes platform-matching interpreters and wheels at pinned versions, logging them under `rebuilt` in `export.json` or failing closed (`studies/shared/foreign-python.ts`); the remote dry run then consumes the exported tree directly.

   When `EVAL_RUNNER` configures a benchmark for the run's pack, one unified command executes export, transfer, `python3` smoke test, dry runs, and queued rollouts in sequence, halting at the first failure:

   ```sh
   bun run runs bench <campaign> [--bench <name>] [--as <label>] [--harness <kept>] [--login N] [--wait]   # prints plan; --yes executes
   bun run runs pause <campaign> --after reported --eval --yes   # pauses cleanly, then launches the benchmark read with --wait
   ```

   Without `--yes`, `runs bench` starts nothing, allowing the prediction file to be written from its plan first; when triggered unattended via `--eval`, write the prediction file before the first task finishes judging (roughly 20 minutes after start). See the header comment of `tools/runs/bench.ts` for default harness/label resolution, host queueing, existing-label behaviour, and multi-benchmark packs.
4. **Execute detached under standing authorisation.** Standing authorisation covers the trigger points and standard size above (eight tasks, one rollout per task for reference and paired Starter, on an available login selected by keeper rules); record the login and spend in `cycle.md`. Larger runs (two rollouts per side, the 20-task evaluation, or rejudging) require fresh operator approval. Launch with `--yes` from a worktree at a published commit with the judge shim active, running arms sequentially and never running two processes against the same store concurrently (because judge costs are attributed from shim log timestamps). Start the command detached so it outlives the session and never block waiting on it. Each arm evaluates one task at a time on an otherwise quiet machine to maintain uniform load; see the operator's `CLAUDE.md` for host specifics. All arms adhere to the fixed conditions documented in `score.ts`'s header comment. Historically, a rollout plus judging costs roughly 9 to 11 dollars, dominated by judge costs. Whenever judge variance has not yet been measured, run `compare.ts rejudge` and `agree` on existing deliverables first (costing tens of dollars; `docs/backlog/jobbench-scoring.md`, item 15); rejudging under a higher truncation limit (`rejudge --cap`) requires operator approval, is reported separately, and never replaces official scores.
5. **Analyse results.** Run `score.ts table --out <store> --tasks <list>` separately for each partition (because the table sums an arm only when every listed task is present and treats every non-first task per profession as fair), reporting the `fair uncut` block alongside the full fair block for the paired arms (`--name <reference>,<its Starter>`). Note both passed criteria and weighted points, since rubrics award full weight only when every criterion passes and points alone can exaggerate near-ties. Then inspect task- and rubric-level differences:

   ```sh
   bun studies/harness2/compare.ts levels --dataset <store>/dataset --of <the reference's label> --of <the Starter's>
   bun studies/harness2/compare.ts levels --dataset <store>/dataset --of <the Starter's> --of <the previous sitting's Starter>
   ```

   The first command reports, per task, every split rubric with its winner and the count of shell commands referencing the harness program directory or tools (separating read-only inspections from executions); the second measures the Starter's noise floor at the same granularity. Pass `--tasks <list>` to restrict to one partition. Command counts measure textual references rather than functional reliance (`comparison-review`, `references/levels.md`, "Behaviour"). Because running without `--salt` exposes every task, freeze the review ledger first and pass its digest as `--salt` whenever a formal review will follow (step 7), keeping half the tasks sealed (`comparison-review`, steps 1 and 2). Both commands read local copies in `data/bench/<machine>`, invoke no models, and print only identifiers, weights, and counts, making their output safe to paste directly into reports. Rollouts interrupted by login limits or provider errors remain unjudged and are retried by re-running the same command (rule 7); rollouts hitting their 5-dollar or 3600-second budget cap are scored on whatever deliverables they produced (analogous to limit-ended solves). Never re-roll a completed rollout because of a disappointing score.
6. **Make no claims within the Starter's noise floor.** Any score difference smaller than the Starter's inter-rollout spread on the same tasks is indistinguishable from noise; a larger difference is an observational direction rather than a confirmed win (rule 6). Claiming parity or a win requires two rollouts per side plus a Starter A/A control across the 20-task set, pre-registered via `compare.ts plan` and evaluated by `compare.ts read` (`docs/backlog/jobbench-scoring.md`, items 3 and 15).
7. **Conduct a structured review** using `comparison-review` (storing its ledger in the cycle directory) before deriving any system changes: any task inspected to diagnose a result is contaminated for subsequent arms built from that diagnosis.
8. **Resolve predictions and record outcomes.** Settle every row in the read's prediction file using `score.ts table`, append a summary row to `cycle.md`, and update the external-transfer row in `docs/plan.md` inside the iteration's pull request. Run `promotion-tuner`'s `trend.ts --bench <store>` once per partition (`--bench-tasks <list>`) to align each benchmarked arm with its originating promotion and classify it as above, inside, or below the Starter's spread, acting on the fair-five placement. Benchmark reads never alter campaign state, queries, or promotions. If a reference falls below the Starter beyond its spread, audit experimental conditions and export fidelity first; if inside the spread, proceed to the next read; if above Harness²'s held-out arm beyond the spread, request operator approval for the 20-task evaluation.
9. **Clean up temporary workspaces.** Once an arm's records are written under `judged/`, move its rollout workspaces (`hevo_ws_cc` under the temporary directory) to Trash while preserving `<store>/trees/`, `<store>/dataset/`, and `<store>/judged/`.

### From a read to the next run

Benchmark reads continue across successive `jobstat` runs until a promoted reference exceeds the Starter beyond its noise floor on uninspected tasks. No additional rules are required: the procedure above executes each read, `trend.ts --bench` classifies its placement, and the table below specifies the follow-up action.

| Placement relative to Starter spread | Follow-up action | Owner |
| --- | --- | --- |
| below the Starter, beyond spread | audit conditions and export fidelity first, fix any defect, and re-roll all arms afresh before reviewing harness behaviour | step 8; `AGENTS.md`, section 10 |
| inside the spread | proceed to the next run's read; take no other action | step 8 |
| above the Starter, beyond spread | proceed to the next run's read; because the eight tasks have been inspected to diagnose prior results, treat this as a directional signal rather than an unbiased claim | step 6 |
| above Harness²'s held-out arm, beyond spread | request operator approval for the 20-task evaluation | step 8 |

Diagnostic leads from a benchmark review enter the next run exclusively through `comparison-review`'s backtrack questions and step 11: one falsifiable prediction in the next run's prediction file settled by a count in that campaign's own log. External benchmark metrics settle only the read's own predictions and never gate, keep, or revert system changes, which would overfit the codebase to the eight-task subset.

Definitive claims belong solely to the 20-task evaluation (step 6), whose task set, sample size, and billing login require operator approval. Two operational details remain open (`docs/backlog/jobbench-scoring.md`, item 22): `compare.ts plan` seals an entire profession whenever any task in it has been inspected (currently leaving 7 of 20 tasks unread), and `compare.ts run` executes three tasks concurrently whereas routine reads here run sequentially.

## Milestones

Inspect each milestone promptly upon arrival, keeping the next prediction pre-registered. Headroom refers to `informative` (`AGENTS.md`, section 7).

| Milestone | Log event | Diagnostic check | Investigation scope |
| --- | --- | --- | --- |
| M0 opened | receipt, `campaign.opened` | `runs source`: single clean commit, fresh opening | none |
| M1 exam | `exam.drafted`, `checker.read`, `contract.frozen` | faults by kind, `doNothing`, `admitted`; a draft still open one hour after M0 is a diagnostic lead | none; `exam` endings are diagnosed from their faults |
| M2 supply | first `task.gate` | held versus refused counts by reason, objective gap, dry run | none |
| M3 first reading | first `comparison.reported` | `valid.informative.old`, untied versus tied counts, `scored.detectable`, A/A control, host load | only on a `read` trigger |
| M4 step | `reading: step` against reference | tested margins, retained-task tally separately, A/A control | none |
| M5 promotion | `harness.promoted` | supporting reading, untied count, A/A control, cumulative risk; `wri.ts climb --log <log>,<peer>` | after M6's first Examiner session (for first promotion) |
| M6 next epoch | first Examiner session and comparison after M5 | drafts held versus refused, frontier and retained set sizes | lane 18 when owed at M5 |
| M7 ending | `campaign.ended` | ending kind, closing report, resolution of all open predictions | full investigation if it promoted or an early ending leaves an open question |

For any ending other than improvement patience, report "reached N promotions; further improvement unresolved".

**A stall** occurs when a campaign continues spending while its milestone fails to advance; provider credit or session limits are not stalls (rule 15). Report the stall and leave the run active. To diagnose it, locate the first move after the last milestone advance, map it to its bottleneck link via the event, execute a pass on that link, and launch fresh runs at the fix.

## The walk: which link holds the next promotion

Enter the diagnostic chain from the active milestone (M1 at link 2; M2 or `no-room` at links 1 and 3; a retained regression at link 7; a near miss at link 5; a post-promotion stall at link 8) and stop at the first failing link. Lane 13 of [whole-run-investigation](../whole-run-investigation/SKILL.md) diagnoses the chain; the walk acts on it.

| # | Link | Point | Holds when | Fails as | Owner |
| --- | --- | --- | --- | --- | --- |
| 1 | supply | 3 | sufficient frontier tasks to meet `comparisonFloor(level)` | `tasks` or `short` rows, refused drafts | `src/examiner/prompt.ts`, `heard` (`record.ts`), `propose_tasks` (`write.ts`), `shortOf` (`decide.ts`) |
| 2 | instrument | 4 | exam freezes cleanly and rejections are ruled | `exam` ending, checker faults, tasks set aside | `planOf` (`src/campaign/opening.ts`), `readChecker` (`src/kernel/acceptance.ts`), else check author |
| 3 | room | 1 | reference harness has informative tasks | `no-room`, zero `valid.informative.old` | link 1; `roomOf` (`src/kernel/reports.ts`) |
| 4 | session | 1 | Builder modifies components the solver actually uses | unchanged `build.finished`, idle sessions, all practice tasks already passing | `src/builder/prompt.ts`, `tools/d2/campaign-actions.ts`, `idleOf` (`tools/d2/campaign-terms.ts`) |
| 5 | size | 2 | sufficient untied tasks and statistical power at observed margins | excessive ties, near miss, high `scored.detectable` | `--target` for next campaign; structurally link 1 |
| 6 | host | 2 | host load stays within bounds at solve start | `HOST LOADED`, `LOAD MOVED`, long `campaign.waited` | concurrent campaigns per host |
| 7 | promotion | 2 | comparison clears `step` cleanly | `no-step` near alpha, retained loss, A/A step | links 1 and 5 first; `readsStep` |
| 8 | next epoch | 1 | Examiner generates fresh headroom against the new reference | refused drafts, thin frontier after promotion | `make` (`tools/d2/harness-builder.ts`), `ROWS` (`src/campaign/decide.ts`) |

Note that `scored.detectable` measures statistical power (the minimum winning share detectable with 80% power at observed margins) rather than a hard tally threshold. A single `step` triggers promotion from one pooled test across frontier and retained tasks.

## The pass

1. **Select one change** grounded in a recorded failure, wasted spend, or open decision, naming its link, evaluation point, owning code, and falsifier before editing. Inspect producers, consumers, and tests first; prefer deleting a competing owner, then reusing an existing one, and only then adding minimal logic. Experimental parameters belong in CLI flags rather than hardcoded branches (`tools/d2/round.ts`). After two similar misses or a falsified prediction, restart the walk.
2. **Verify the path without spending**, at the smallest realistic layer (`system-path-simulation`): dry-run via `bun tools/d2/harness-builder.ts --name <name> --dry-run`; replay existing logs via `bun run runs replay [<name>]`; or seed and rehearse with scripted seats via `bun run runs seed --from <campaign folder> --name <seed>` and `bun run runs rehearse` (no Referee). To compare two commits on an identical exam, seed a completed campaign truncated at `contract.frozen` (`--events <line>`) into worktrees at each commit and launch both with identical flags. Although this removes exam variance as a confounder, both arms incur real spend, require operator authorisation, and produce a lead rather than a promotion step. Render any modified model-visible text in full and check for duplicated instructions.
3. **Pre-register predictions** outside campaign folders before the first solve: in `predictions-<run>.md` for cycle runs, or via `bun tools/d2/checkpoint.ts <flags> --predict "<sentence>"` for manual comparisons. Express predictions as concrete counts (for example, "`contract.frozen` precedes `build.started`", or "the first comparison unties at least six tasks"), including at least one row targeting the active link and one on honesty, and name the exact reader that evaluates each wording (for example, two-sided A/A steps come from `reading.ts`, whereas `runs view` reports one-sided counts).
4. **Launch fresh** via [run-management](../run-management/SKILL.md) using `bun run runs fresh <pack>` with authorised budget and terms (`--hitl` only when requested), executing the dry run and the `--yes` launch as separate commands, respecting the cap of at most two campaigns per host (one per host for cycle forks).
5. **Monitor** with `bun run runs pulse [<name>]`. Absence of a terminal event does not imply a stall because active solves log `solve.turn` and `solve.call` prior to verdicts; evaluate quiet intervals against the solve deadline. A `solving` status hours after the last event usually reflects a `campaign.waited` reset wait, and an `environment` ending under an active keeper is a temporary pause. Assign at least two logins to each keeper so it does not sit through a weekly quota wait; if a wait outlasts a run's usefulness, ask the operator to stop it. Attribute running processes by their parent `harness-builder.ts --name` process.
6. **Read outcomes** in order: ending, reading, tally, ties, A/A control, Referee rulings, host load, and epoch drafts (`bun tools/wri/wri.ts read --log <log>`), adhering to the evidence hierarchy in `AGENTS.md`, section 9, and never quoting exam-side text. Because a step is a single draw, report untied count, margins, retained tally, A/A control, and cumulative campaign risk, consulting `attribution-and-proof` before stating claims. Comparing two separate campaigns evaluates the system across two commits rather than two harnesses, because each campaign drafted its own exam. Normalise cross-run comparisons by active hours (elapsed time between events excluding gaps over ten minutes, `campaign.waited` intervals, and spans ending in `provider` non-results), listing any differing settings and attaching the script used to compute active hours.
7. **Decide.** Classify the targeted link as **lifted** (the link moved and downstream milestones followed), **held** (the link moved without downstream advance), or **unreached** (the link did not move; repair the path first). `decide` (`src/campaign/decide.ts`) recommends the next move, while `stopRule` (`src/campaign/admission.ts`) tracks eligible moves without gain. Whenever a pass overrides the move table, report the counts the table cannot observe. Valid loop actions within operator authority are: repairing one owner or parameter and launching fresh, deleting an unused mechanism, or investigating a consequential ambiguity. Close the handover with the five points, prediction outcomes, link verdict, open decisions, and next command, including negative results.

## Timers

Timers exist solely to wake a model for judgement. Determining whether work is due is a deterministic condition evaluated by code without invoking a model: the anti-stall hook's pulse and the cron-driven `runs alerts` announce every report, promotion, starter read, ending, and stall as it lands; subagent completion wakes its parent session; and `wri2p2.ts due` lists every pending step alongside its elapsed hours. Consequently, no timer polls a run or directory, and no timer duplicates facts already emitted by these deterministic streams. Track every active timer (id, schedule, and authority) in `cycle.md`; [references/timers.md](references/timers.md) defines each timer's responsibility map and required prompt structure.

When a specific run event requires judgement not surfaced by `pulse`, wait on the log via a background command that exits upon the event, run termination, or timeout, waking the session automatically (see the script header for options). Because waits terminate with their session, record active waits beside timers in `cycle.md`:

```sh
bun .claude/skills/run-improvement-campaign/scripts/until.ts <log | folder | name> \
  --at harness.promoted --hours 9 --say "<what to read next>"
```

### A hook where the reaction is one fixed command

Because both timers and log waits require an active, idle session, any deterministic reaction that must not wait for a human or agent session is implemented as a hook: model-free code bound directly to an event. Pausing at a second promotion is the canonical example, ensuring overnight runs pause immediately when alerted.

Hooks attach in two places. The local `runs alerts` cron job pipes new alert lines to a handler script acting on matching patterns; this suits run-level actions requiring no session. Claude Code hooks (`Stop`, `UserPromptSubmit`, or `PreToolUse` in `settings.json`) execute inside an active session's loop (as the anti-stall hook does) and suit session-level interventions such as wakes, context injection, or pre-command guards. Any reaction requiring judgement remains a skill with supporting scripts, which a hook may reference in its log line.

A hook executes only actions already pre-authorised by protocol at that event (such as pausing at a trigger), never launches, merges, or other `AGENTS.md` section 3 decisions. It appends one line to the alerts log so sessions see the action and `wri2p2.ts due` transitions from `pause` to `waits`, detaches long-running waiters into their own session so the cron job exits cleanly, supports a dry-run mode and per-run exclusion, and cites its authorising operator words in its header comment. Host-specific hooks are documented in the operator's `CLAUDE.md`.

### A firing

Every timer firing follows one deterministic protocol, leaving interpretation between steps to the session's judgement.

1. **Read state**: check the UTC clock (`date -u`), run `wri2p2.ts due`, and read `cycle.md` for authority, queue state, and step ownership. If nothing is due and no slot is free, emit one line and modify no files.
2. **Execute one step** within recorded authority: take the first unowned trigger or step listed by `due`, launch a fork for a free slot, or process a newly landed milestone. Resolve any predictions whose settling event occurred or whose deadline passed, recording the settling count and timestamp; keep unmet rows on live runs `pending` and mark unreachable rows `unreached`. Never overwrite a written resolution (append a new row if a recount disagrees); add every falsified row to the single triage list (problem, link, event, status), ordered by earliest failing link and then by frequency across runs.
3. **Chain or rest**: if `due` still lists a step this session can perform, schedule a one-shot timer ten minutes ahead with the same prompt; otherwise wait on the next log event with `until.ts`, reserving one-shot timers strictly for deadlines not marked by a log event. A live run's 12-hour clock is such a deadline: `due` prints the exact second it expires, so schedule the one-shot for the minute after that second (a timer on the opening minute fires seconds too early). Delete superseded timers by id.
4. **Log** one row in `cycle.md` only when state changed: UTC timestamp, action taken, predictions resolved, and timer updates. Notify the operator only when a milestone lands, a run stalls or ends, or a prediction resolves.

| Mechanism | Schedule | Wakes the session to |
| --- | --- | --- |
| none: pulse and alerts | event-driven; pulse every 290 s via hook, or one `Monitor` on `bun run runs pulse --every 290 --state <file>` when no hook is active | inspect the milestone and follow protocol: open an iteration on a trigger, or allocate a freed slot per iteration step 5 |
| none: hook | event-driven, model-free and session-free | execute the single protocol-authorised command (for example, pausing after the next comparison at a second promotion) |
| none: alerts log | event-driven; one `Monitor` (`tail -n 0 -F`, `run-management`) on the cron alerts log, re-armed on expiry | take the loop's pending step for that run |
| driver | recurring every two hours, chaining every ten minutes while steps remain due | execute the firing protocol for steps not announced by events |
| none: log wait (`until.ts`) | exits on the named event, run ending, or timeout | read that event and resolve the predictions it settles |
| milestone | one-shot at a deadline with no log event | resolve that specific prediction row |
| open decisions | recurring every four hours | settle routine ambiguities (recording what would overturn each) and queue section 3 decisions for the operator |
| morning read | recurring once daily after nightly local jobs | review daily state not reported elsewhere: nightly job outcomes and exit codes, host disk usage, and stack position relative to `main` |
| handover | one-shot at the agreed handover time | compile the five points, state changes, open decisions, and loop diagnostics |

At every handover, audit timers empirically with `timers.ts` rather than guessing ([references/timers.md](references/timers.md), "Reading the timers"), and log loop diagnostics as specified in [references/cycle-ledger.md](references/cycle-ledger.md).

Because the pulse and alerts log cover all run events and owed steps, a session whose hook is paused follows the alerts log with one `Monitor` (or `pulse --every` where no cron job exists) and wakes only on actionable events. Because `Monitor` expires within 30 minutes and each re-arm consumes a model turn, use it for bounded waits only. `CronCreate` timers live exclusively inside their creating session, fire only when idle, and expire after seven days if recurring, so every timer prompt must be self-contained across context compaction using the template in [references/timers.md](references/timers.md).

## Which skill each step uses

`run-management` controls campaign execution, `decision-points` guides lifecycle stopping and continuation choices, `whole-run-investigation` diagnoses completed runs, `system-path-simulation` verifies code paths and prompt edits, `stack-pr` manages stacked implementation and release, `attribution-and-proof` governs empirical claims, `harness-audit` inspects kept harnesses and handovers, `comparison-review` audits external benchmark comparisons, and `oracle-handover` escalates questions the repository cannot settle. Revise this skill whenever a pass reveals duplicated effort or an incorrect rule, updating the single authoritative owner.

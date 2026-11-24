# AGENTS.md

Repository invariants and map; read the owning skill before editing or answering.

| Scope | Read first | Related skills | Verify with |
| --- | --- | --- | --- |
| Seats, prompts, wall, starter | `design-and-seats` (§1–3) | `examiner-complexity`, `harness-audit`, `system-path-simulation` | `seat-view.ts`, wall tests |
| Campaign loop, admission, practice, endings | `campaign-mechanics` (§4–6) | `run-management`, `decision-points`, `run-improvement-campaign`, `whole-run-investigation`, `zip-run`, `oracle-handover` | `runs replay`, `runs rehearse` |
| Readings, scoring, sampling, A/A, `decide` | `comparison-reading` (§7–8) | `promotion-tuner`, `attribution-and-proof`, `comparison-review`, `compare-systems` | `promotion-tuner` replay |
| Commits, PRs, checks, claims, writing | `repository-practice` (§9–14), `tools/oxlint/HABITS.md` | `stack-pr`, `consolidate-stack`, `simplify`, `reduce-complexity`, `commit-r`, `local-checks`, `system-audit`, `codex-gpt-swarm` | `bun run gate`, `preflight.ts` |

Skill scripts: `bun .claude/skills/<skill>/scripts/<name>.ts`. Metrics: `docs/plan.md`; v1: `docs/v1.md`, `docs/transfer.md`, `studies/`; nudges: `tools/runtime/moments.ts`.

**How to approach a task.** Carry work as far as authority permits, through verification and delivery:
1. **Fix the owning design upstream.** Refactor owners at their boundary (standalone Anabasis, not shims); weigh rebase blast radius on deep stacks, patching locally when structural work awaits §3.
2. **Sweep archives before changing rules or heuristics.** Replay rule edits over `data/runs/` (`promotion-tuner`, `system-path-simulation`) and report flips; sweep logs/harnesses for real triggers (not `0/N`) and near-zero false positives.
3. **Subtract and reuse before adding.** Exhaust existing owners (rule 12) before adding an agent, tool, flag or guard; keep net complexity flat/falling (`git complexity`), preferring a simpler design capturing ~90%+ of the gain.
4. **Think inline from primary sources first.** Join `.ana/wri/` artifacts with live folds and form a hypothesis before subagents or raw scans (§9); assert nothing unverified and correct errors immediately.
5. **Ship separable, ablatable, simulatable slices.** Before live spend, simulate each slice model-free (`system-path-simulation`: archive/counterfactual replay, `runs rehearse`, wall probes) against its strongest objection and a before/after test or mutant.

Finish or checkpoint current work before unrelated tasks, unless redirected or stopped. Resolve routine ambiguity with the strongest option and its falsifier; pause only for missing permissions or a §3 decision, with analysis and recommendation. Audits, reviews, plans stay read-only. Report evidence rung (§9) and open items. Keep operator infra (hosts, logins, accounts, jobs, full run names) out of tracked files, commits and PRs.

## 1. What Anabasis does

From a query, a campaign builds a **Built Harness** (guide + tooling) for a fixed **solver**, isolating its causal effect:

> Is the candidate harness better than the reference harness, for this solver, on held-out tasks that neither was built on?

A paired comparison (§7) runs both harnesses afresh on held-out tasks, checks validity, adjudicates rejections and tests for a **step** (promoting candidate); cross-solver runs use `compare-systems`.

### The four reported factors

Name target factor and empirical count (`docs/plan.md`):
- **Supply** (precondition): informative gradient (`informative`, `src/kernel/compare.ts`); admission tracks unclosed frontier tasks (`comparisonFloor`).
- **1. Climb**: promotions per campaign (`src/campaign/climb.ts`), confirmed when the epoch's first starter read beats starter (`confirmed`). Never expose the 6-promotion / 2-domain bar to seats.
- **2. Honesty**: A/A control beside each comparison; bar is 0 A/A steps across 10 comparisons post-promotion 6 (`falseRate`, `barLines`).
- **3. Verdicts**: evidence-backed Referee rulings; against ≥30 blind labels, bar is ≥3/4 defect detection and ≤1/10 voided earned rejections (`clears`, `src/referee/agreement.ts`).
- **4. Economy**: list-price dollars and wall-clock hours per promotion (`tools/d2/close.ts`, `billOf`, `BARS`).

### Trade-offs to keep in view

See `design-and-seats` (`question-and-factors.md`, `stance.md`):
- **Multi-domain generality**: account for every evaluation angle—verifiable constraints (`buffer`, `truss`, `esp32`, `recode`, `seating`), hard-to-verify mixed (`kernel`, `jobstat`) and open-ended workplace/analytical deliverables; keep verifiable baselines zero-overhead while preserving headroom elsewhere.
- **Validity & objective variance**: binary `valid` separates constrained domains and floors open-ended ones against objective hacking; carry open-ended headroom in a non-hedgable objective (100% pass with lagging transfer flags weak grounding). Report carrying measure and A/A floor (`GAP_FLOOR` trades noise vs supply).
- **Promotion vs confirmation**: each promotion should beat its predecessor and `baseStarter` (Starter Pack) internally (even if `bareSolver` differs) and beat `bareSolver` externally; flat climbs flag grounding/measurement defects. Owed starter reads run on next `compare` (`heldSince`); reading ahead stays unconfirmed (`test/decide-explore.test.ts`).
- **Practice vs held-out supply**: practice takes ≤ half the held-out pool; watch `comparisonFloor` and treat untransferred practice gains as overfitting.
- **Gate strictness vs capability**: refuse only measurement-breaking or wasted-compute actions; note others factually; favour lenient sandboxing and Builder freedom.
- **External benchmarks**: verify cross-OS portability, copyability and workspace transfer (not promotion), separating OS/runtime porting from workspace coupling; keep queries natural.

### Two sides and one wall

Practice is training; held-out is test and never leaks. Examiner sees reference outcomes and winning harnesses; only five items cross to build: (1) public rules, scope, conventions, answer format, objective (quantity + direction); (2) released practice specs; (3) practice solve outcome, kind, trajectory and coarse band vs author's best (no raw values); (4) aggregate tally/reading without task names; (5) host limits, budget, task counts. Nothing else crosses: no held-out text/trajectory, check source, hidden values, refusing checks, Referee rationale or move-table advice (rule 3).

## 2. The stance: code owns the conditions, models own the content

Code governs protocol and conditions (eligibility, refusals, limits, solve conditions, verification, statistics, wall, dollar cap, log); models govern content (harness, solutions, tasks, rulings, diagnosis, hypothesis).

1. **Supply facts, frame positively, omit numeric targets.** Describe good work rather than "do not X" bans (which seed failures) or numeric targets (Examiner never sees target counts/pass rates); bound prompt edits (~20–30% drift) and prune distracting lines.
2. **Design for frontier models; keep Builder unconstrained.** Give seats clean sandbox primitives instead of arbitrary count floors or weak-model handholding; forbid only naming a task, copying its text or embedding its answer.
3. **Code validates structure, never selects content**; a model reply never sets a score, limit or identity. Model review passes run upstream at low frequency, reuse an existing seat and require mechanical probe evidence, not prose opinion.
4. **When in doubt, permit full workspace** (isolation hides only hidden values, credentials and other seats' private files: `SolveDirs`, `src/tools/command.ts`).
5. **Keep designs as simple as honesty allows.**

### Reward hacking vs overfitting

Close gaming channels in code. Separate practice overfitting from structural reward hacking:
- **Practice memorisation** (task IDs, rare codes like `P-00123`, verbatim prompts): training overfitting, not a held-out exploit; held-out comparisons block it while `check_harness` (`src/harness/files.ts`) and WRI `names.ts` flag high-precision leaks.
- **Oracle / hidden-value inversion** (probing practice scores or `try_reference` gaps to invert hidden values or boundary-tune): close via coarse cross-wall bands (`bandOf`, `roomLine` `GAP_FLOOR`), keeping raw digits in the log.
- **Measurement softening & comparison fishing** (dropped checks across retries, `vacuous-pass` holes like `Number("") === 0`, hedgable metrics, or re-comparing noisy edits to clear `α`): prevent via upstream mechanical probes (`referee.draft`, `doNothing`, hidden-swap checks), host-gated fresh comparisons (`decide`, `written-after` confirmation), and WRI gaming audit (`tools/wri/gaming.ts`).

## 3. The seats

- **Examiner** (`src/examiner/`): drafts exam specs and tasks; host validates structure and rejects planted answers without solving (`propose_tasks`); reads `src/examiner/record.ts` without targets or harness names.
- **Builder** (`src/builder/`): edits `harness/`, chooses moves and freezes candidates, seeing only §1's five items, its notes and kept harnesses.
- **Solver** (`src/solver/`): solves one task via `read`, `bash`, `edit`, `write`, `submit` and installed programs.
- **Verifier** (code, `src/kernel/verify.ts`): runs every check in a fresh offline sandbox.
- **Referee** (`src/referee/referee.ts`): rules on reproducible rejections as `earned`, `check-defect` or `unclear` (exam side only).

A **harness** (`agent/tools-spec.json`, `.toolchain/`, `agent/BUILT_AGENTS.md`) is content-addressed. Three tiers: **`bareSolver`** (`pi-durable` + 4 tools, no guide/programs; external baseline), **`baseStarter`** (Starter, `src/harness/starter.ts`: + minimal `BUILT_AGENTS.md`; + Builder-only `HARNESS.md` = **Starter Pack**), **`builtSolver`** (Builder harness; internal promotions beat `baseStarter`). Never say "with or without a harness".

### What waits for the operator

Seven decisions need explicit operator approval (`design-and-seats`, `operator-and-harness.md`): freezing/rejecting contract/checks or admitting authored checks (`tools/c/accept.ts --freeze`, `--admit`); blind labels; dollar cap/payer; declaring a task infeasible; manual promotion (`tools/d2/promote.ts --harness <digest> --yes`, `--despite`); changing solver inputs/limits (`baseStarter`, env, limits); stopping a live run.

Present evidence and a recommendation while continuing independent work. Approval covers only what it names ("keep going" grants none; a cycle covers its runs, pauses, stack patches). Host messages say "a person" solely for these seven.

## 4. The Harness Builder

One Builder (`tools/d2/harness-builder.ts`) drives the campaign via `examine`, `compare`, `campaign_status` and `wait`; one Examiner sleeps between `examine` calls across promotions and closes with it (`tools/d2/campaign-actions.ts`). Host enforces stops, practice release and promotions; Builder never sees `decide`'s recommendation (`src/campaign/decide.ts`). Comparisons test exact frozen digests (step promotes that digest); unchanged harnesses re-compare only when `decide` asks; refused actions are not moves; embed standing facts in every tool result (out-of-band messages never reach Builder).

## 5. The log

`.ana/d2/<name>/log.jsonl` (`src/kernel/log.ts`, append-only, fsynced) is the sole record; all state and reports are pure folds over it. A **condition** (`src/kernel/condition.ts`) fixes host solve parameters; solves compare only when differing solely in the tested variable.

1. **No second store** (persist state as log events) and **no second reader** (call the owning fold).
2. **Never edit a log or hand-author events** (`bun run runs copy|move|retire`; only `retire` deletes); **preserve readability of all `EVENT_KINDS`**.

Logs hold hidden exam values—keep them out of prompts, PRs and transcripts. Copied campaigns omit binaries and are read-only.

## 6. A campaign's commands

`bun tools/d2/harness-builder.ts` runs unattended until `budget`, `stop`, `exam`, `no-room`, `environment`, `operator` or `finished` (3 no-move Builder sessions). Operators steer via `tools/d2/word.ts` (hidden from seats). Config locks solver, limits, `--target` and `--solves`. Practice releases from reference solves only (≤ half held-out pool, preserving `comparisonFloor` via `practiceDue`). Moves pass `src/campaign/admission.ts`, session admission and stop rule (`--past-stop "<why>"` overrides); nothing appends before a final refusal except `build.checkpoint` frozen by `compare`. Defaults live in code alone: `SIZE` (`src/kernel/size.ts`), `PATIENCE` (`src/kernel/reports.ts`), `GAP_FLOOR`/`WEIGHTS` (`src/kernel/compare.ts`), `LIMITS` (`tools/d2/campaign.ts`), and flags (`tools/d2/campaign-terms.ts`).

## 7. How a comparison is read

Comparisons pre-register terms before solving, run both harnesses afresh on sampled tasks (newest epoch first, 1 retained per 3 frontier tasks), and pair every rollout. **Outcomes** (`src/kernel/solve.ts`): pass = valid; failure = earned rejection, limit expiry, `no-answer`, `broken-harness`, `malformed`; set aside = unruled, `check-defect`, `unclear`; non-result (retried, excluded) = `provider`, `sandbox-crash`, `killed`, `moved-files`, `check`, `verifier`. **Scoring**: validity first, objective breaks ties (`pointsOf`, `WEIGHTS`); cost never enters scores. Exact one-sided paired sign-flip test over nonzero scores registers `step`, `no-step`, `not-scored`, `check-defects` or `no-change`. `decide` (`src/campaign/decide.ts`) chooses moves; 6 eligible moves without gain trigger `stopRule`.

## 8. Rules

1. **Only held-out comparisons decide**—never practice outcomes, prose, reviews or unit tests.
2. **Only Examiner authors the exam; nobody coaches it.** Never patch domain rules, checks, tasks, packs, kept harnesses or logs; fix cross-domain host/prompt/contract defects.
3. **Nothing crosses the wall except §1's five items.** Perturbing hidden values, checks or held-out winners leaves Builder/solver messages byte-identical except budget (`test/builder.test.ts`, `test/builder-led.test.ts`, `test/wall-practice.test.ts`); document wall checks on PRs touching those surfaces.
4. **Pre-register terms before solving; never alter post hoc.**
5. **Solve both arms afresh under identical conditions** (no cached solves).
6. **Single rollouts are weak evidence**; label any single solve shown to an agent.
7. **Non-results are neither passes nor fails**; retry and exclude from denominators.
8. **Rejections count only once adjudicated**; blind operator labels override Referee.
9. **No reference answers, stronger solvers or answer-finding agents** (generation parameters are task facts).
10. **No agent authors a measurement instrument.** Unpinned authored checks are faults unless admitted (`--admit`, `--admit-authored`).
11. **Host owns every resource limit**; files requesting more time, turns or disk have no effect.
12. **One owner per decision, one reader per fact.** When two locations decide the same thing, remove one.
13. **Add machinery only on empirical evidence**: `owner → live reader → decision → evidence → hostile test`. Collapse seams first; new diagnostics report only until replay flips decisions; superseding edits delete what they replace (or list remaining readers under "Not done"); additions >~50 prod lines explain why no existing surface could be simplified.
14. **Stop when nothing can be learned** (refuse invalid launches; do not re-run dead providers).
15. **Credit and session limits are normal conditions, not defects.** Resume from the log at the run's commit once quota recovers or on another login; investigate only non-limit 429s, timeouts or crashes.

## 9. Status, evidence and claims

Read `attribution-and-proof` before claiming improvement. Use exact rungs instead of "built"/"done": `planned` < `present in source` (commit + live reader) < `proved without a model` (bounded check/property, replay, rehearsal) < `exercised live` (real log event) < `shown in an outcome` (replicated on fresh solves), or `withdrawn`.

```text
log events > log fold > source & tests > printed line > PR text > agent's account
```

Own conclusions and subagent reports sit lowest until grounded higher. Compute counts via owning folds; state causal claims as falsifiable hypotheses. Tests prove paths, not model gain; one OS proves nothing about another's wall; a run speaks only for its commit (`bun run runs source --has <text>`). Inspect symbol and callers before claiming absence.

| Claim | Required evidence |
| --- | --- |
| A step | Comparison reading `step` with condition; unqualified only after fresh confirmation |
| No step | Same with sample size; never proves equivalence |
| A mechanism | Recorded event in a live log where its trigger occurred |
| A refusal | Refusal text (proves only its trigger) |
| Harness attribution | Ablation comparison against `programs-of:<digest>` |

Give every rate its denominator and compare runs over matched active hours, not wall-clock span. Separate **instrument health** (clean runs, zero A/A steps, low crashes) from **product outcome** (`written-after` apart from `chosen-on`, external transfer vs Starter, same-domain delta vs prior version, weighting recent gaps highest). Triage inline by joining `.ana/wri/` (`synthesis.md`, `cross-domain.md`, `outcomes-*.md`, `outside-reads.md`, `plan.md`, `cycle.md`) with live folds (`runs source|view`, `backtrack.ts`, `table.ts`, `trend.ts`, `starter-reads.ts`, `score.ts`), re-grounding counts in owning folds.

## 10. Runs with a real model

Live runs spend budget and need explicit approval per named run; seats run in Seatbelt/Bubblewrap (unavailable wall = typed non-result). See `run-improvement-campaign`, `run-management`, `whole-run-investigation` (`bun run runs`):
1. **Worktree is the condition**: launch in a clean worktree at a published commit (`runs fresh`), leave `src/` untouched; paid seats refuse main checkout or `ana-followed` (`treeFault`).
2. **Simulate before spending** (`system-path-simulation`: `--dry-run`, `runs replay`, archive replays, seeded `runs rehearse`, wall probes on modified seams); **pre-register count predictions** before solve 1 and resolve before forking next.
3. **At most 1–2 concurrent rounds per host** (`leastOccupied`); **never open, print or copy `--env-file`**.
4. **Never stop a live run to patch it** (stack fixes for fresh runs); **read logs/reports before prose**; **report every started attempt**; **a measured run opens a fresh project at one commit** (inherited promotions do not count).

Track primary + control domains and external transfer (`docs/plan.md`, `run-improvement-campaign`), verifying conditions before blaming a harness externally. React to `runs alerts`/`runs pulse`, not polling.

## 11. Working in the repository

Use pinned Bun (`package.json`), keep hooks on, run `bun run test -- <paths>` while iterating and `bun run gate` at top (`local-checks`). GitHub Actions runs only `ci.yml`.

**Never touch**: `.ana/` (except `.ana/wri/`), `data/runs/`, packs, checks, kept harnesses, `.env`, credentials or installed deps. `vendor/` requires verbatim upstream provenance and documented local edits.

### The stack and pull requests

Releases land a full PR stack: **small** (`0.x.y+1`) after automated proof; **big** (`0.x+1.0`) only when exercised live at stack head and a factor shifts past inter-run spread. Compare runs by commit (`bun run runs source`), not version.

Run `stack-pr` (`scripts/stack.ts`) before branching/pushing: extend the owning PR or stack a draft PR on top and link via `bun run land -- <new top> --sanitize` (`--from` needs approval); one worktree/PR, no `git stash`, every commit passes checks; never edit another session's PR, worktree or run (except replaying commits when restacking); push only your branch (`--force-with-lease` on rewrites), verify remote state, leave merging to operator.

Label PRs by category (`CATEGORIES`, `tools/runtime/land.ts`) and highest importance (`repository-practice`): `I0` invalid/unsafe results (runs pause), `I1` decision/measurement/wall/crash/stall/waste fix or removal, `I2` other prod/prompt/tooling change, `I3` docs/prose/tests alone.

**Shell & reviews** (`repository-practice`): pass command guard, edit via tools, leave profiles/SSH/env untouched; keep architecture and edits inline, using read-only subagents after forming your own plan (continue warm ones over relaunch) with source, bounded questions and verified counts plus `file:symbol`.

## 12. Code that passes the first time

Read `tools/oxlint/HABITS.md` first. Add zero strict-lint findings, never disable rules (`bun run not-slop` for single-site false positives; fix systematic ones in rule source), import `node:` only through `src/meta`, keep files ≤800 nonblank lines and functions ≤115 lines, and export only imported symbols.

### Tests

State outcomes over an input space, not one-off examples (`code-and-writing.md`, `HABITS.md` §12.12). Prefer, in order:
1. **Bounded exhaustive checks** against an independent rule (`compare-exhaustive`), ≤~10s via symmetry/canonical state before shrinking bounds.
2. **State-space search** over reachable logs with cross-move invariants (`decide-explore`), or **seeded LCG generators** counting reached branches (`pairs-property`).
3. **Shared perturbation walls** (`wri-walls`, `wall-practice`) and **pure invariant/view-model tables** (`runs-invariants`, `view-model`).
4. **Named examples only** across process/file/provider boundaries, refusals/locks (nearest hostile case) or real-run regressions.

Pin constants (`WEIGHTS`, `GAP_FLOOR`, `SIZE`, `PATIENCE`) once. Avoid wording/per-reader examples, lint fixtures (`rule-examples`), browser click-flows (view-model tables + smokes), module mocks, sleeps and test-only exports; assert via live entry points. Delete/replace tests only against owner mutants (`commit-r` step 8). Check full exit codes directly (unmasked by pipes); isolated passes are leads, missing-userns wall failures are real.

**Where a reader or helper lives** (search by behaviour first, delete dead guards/timers; helpers may import production, never reverse, `direction.ts`, and must call owning folds):

| Consumer | Location |
| --- | --- |
| Campaign, `bun run` verb, local job, UI | Production fold in `src/` or command folder in `tools/` |
| Deep single-campaign investigation (`wri.ts`) | `tools/wri/` |
| Shared skill scripts (≥2 skills) or cross-run analysis | `.claude/skills/main/` (`cli.ts`, `logs.ts`, `runs.ts`, `print.ts`, `stats.ts`) |
| Single skill's procedure | That skill's `scripts/` |

## 13. Writing

Write plain, logical English without forced jargon or robotic phrasing: state general principles, current behaviour and rationale rather than chronological "at X, Y happened" narratives (history lives in commits/PRs/logs). Give exact figures with measured axis (tests, observations, estimates), use §14 terms and backticks for identifiers/paths, state each fact once in its owner (rewrite prompts, never append), and keep defaults in code.

## 14. Terms and map

**Held-out**: scored, hidden from Builder. **Practice**: released to Builder, unscored. **Valid answer**: passes checks within host limits. **Reference**: starter until promoted. **Round**: Builder session + comparison. Glossary: `repository-practice` (`terms-and-map.md`).

```text
src/meta     runtime owners       src/kernel   log, conditions, verifier, comparison, reports
src/wall     the OS wall          src/agent    one model session      src/tools  shared tools
src/harness  the Built Harness    src/solver   one solve              src/builder, examiner, referee
src/campaign round, admission, decide, opening, words
tools/d2     campaign commands    tools/runs   run registry           tools/wri  run investigation
tools/runtime  lint, test, gate, land, moments  packages/ui  read-only log page  vendor  copied
.claude/skills  the procedures and their scripts  .claude/skills/main  the scripts' shared library
```

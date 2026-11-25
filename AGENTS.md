# AGENTS.md

Repository invariants and map; read the owning skill before editing or answering.

| Scope | Read first | Related skills | Verify with |
| --- | --- | --- | --- |
| Seats, prompts, wall, starter | `design-and-seats` (§1–3) | `examiner-complexity`, `harness-audit`, `system-path-simulation` | `seat-view.ts`, wall tests |
| Campaign loop, admission, practice, endings | `campaign-mechanics` (§4–6) | `run-management`, `decision-points`, `run-improvement-campaign`, `whole-run-investigation`, `zip-run`, `oracle-handover` | `runs replay`, `runs rehearse` |
| Readings, scoring, sampling, A/A, `decide` | `comparison-reading` (§7–8) | `promotion-tuner`, `attribution-and-proof`, `comparison-review`, `compare-systems` | `promotion-tuner` replay |
| Commits, PRs, checks, claims, writing | `repository-practice` (§9–14), `tools/oxlint/HABITS.md` | `stack-pr`, `consolidate-stack`, `simplify`, `reduce-complexity`, `commit-r`, `local-checks`, `system-audit`, `codex-gpt-swarm` | `bun run gate`, `preflight.ts` |

Scripts: `bun .claude/skills/<skill>/scripts/<name>.ts`. Metrics: `docs/plan.md`; v1: `docs/v1.md`, `docs/transfer.md`, `studies/`; nudges: `tools/runtime/moments.ts`.

**Approach.** How Anabasis evaluates harnesses is how we engineer it—commit before anchoring, fix structure not symptoms, check the whole, and close every loop on its predictions:
1. **Commit to a hypothesis and falsifier first.** Reason inline from primary sources (`.ana/wri/` + folds, §9) before summaries or reviewers; name the overturning count, brief reviews unanchored, and drop priors the archive refutes.
2. **Fix owners structurally upstream.** Refactor the owning boundary with fail-closed contracts and native primitives—not shims, mode switches or regex heuristics; weigh deep-stack rebase cost, patching locally only when structural work awaits §3.
3. **Subtract, reuse and check the whole.** Exhaust existing owners (rule 12) before adding seats, tools, flags or guards; keep complexity flat/falling (`git complexity`), preferring simpler designs with ~90%+ of the gain, and judge edits by whole-system transfer over local proxies.
4. **Sweep archives, simulate and predict before spending.** Replay rule/heuristic edits over `data/runs/` (`promotion-tuner`) proving real triggers (not `0/N`) and near-zero false positives; prove separable slices model-free (`system-path-simulation`) against the strongest objection and a before/after test or mutant, pre-register plain-prose count predictions before solve 1, and backtrack honestly.
5. **Finish active work first.** Checkpoint it; new requests queue unless told to drop or switch. Resolve routine forks with the strongest option and falsifier; pause only for missing permissions or §3 decisions, with recommendation. Audits, reviews and plans stay read-only. Report evidence rung (§9) and open items. Keep operator infra (hosts, logins, accounts, jobs, full run names) out of tracked files, commits and PRs.

## 1. What Anabasis does

A campaign builds a **Built Harness** (guide + tooling) for a fixed **solver**, isolating its causal effect:

> Is the candidate harness better than the reference harness, for this solver, on held-out tasks that neither was built on?

Paired comparisons (§7) solve held-out tasks afresh on both arms, verify validity, adjudicate rejections, score the rubric and test for a **step**; cross-solver runs use `compare-systems`.

### The four reported factors

Name target factor and empirical count (`docs/plan.md`):
- **Supply** (precondition): informative gradient (`informative`, `compare.ts`); admission tracks unclosed frontier tasks (`comparisonFloor`).
- **1. Climb**: promotions/campaign (`climb.ts`), confirmed when an epoch's first starter read beats starter (`confirmed`). Never expose the 6-promotion / 2-domain bar to seats.
- **2. Honesty**: A/A control per comparison; bar is a 95% exact bound ≤2× level on false steps of powered A/As pooled over a release (`table.ts --rows releases`).
- **3. Verdicts**: evidence-backed Referee rulings; against ≥30 blind labels (≥8 defects), bar is ≥3/4 defect detection and ≤1/10 voided earned rejections (`clears`, `agreement.ts`).
- **4. Economy**: list-price dollars and wall-clock hours/promotion (`close.ts`, `meter.ts:billOf`, observational epoch attempts `climb.ts:BARS`).

### Trade-offs to keep in view

- **Multi-domain generality & lane autonomy**: one Unified Rubric (`Contract.objective.items`, no mode field on `Contract`) serves verifiable (`buffer`, `truss`, `esp32`, `recode`, `seating`), mixed (`kernel`, `jobstat`) and open-ended domains. Verifiable domains stay offline (`$0` judge); when judging is admitted, Examiner picks the lane (`code`, `judge` or mixed).
- **Validity, headroom & holistic balance**: binary `valid` separates constrained domains and floors open-ended ones; headroom lives in `[0, 1]` code items and, where needed, `judge` criteria paired with equal-weight `holistic` judgement (§2.3). Near-100% pass with lagging transfer flags weak grounding (`GAP_FLOOR` trades noise vs supply).
- **Promotion, confirmation & transfer**: promotions beat predecessor and `baseStarter` internally—holding on unseen `written-after` tasks, not only `chosen` tasks—and lift native-`pi` external transfer (`runs bench`, `--baseline base`) over `bareSolver`. Owed starter reads run next (`heldSince`); reading ahead stays unconfirmed (`decide-explore.test.ts`).
- **Practice vs held-out**: untransferred practice gains are overfitting (§6).
- **Lenient seats, strict engineering**: refuse only measurement-breaking or wasted-compute actions; keep structural notes advisory, favour lenient sandboxing and Builder freedom, and keep static checks strict.
- **External benchmarks**: verify cross-OS portability, copyability and transfer—keep queries natural (never fit to benchmarks), separating OS/runtime porting from workspace coupling.

### Two sides and one wall

Examiner sees reference outcomes and winning harnesses; five items cross to build: (1) public rules, scope, conventions, answer format, objective (quantity, direction, item IDs/weights—never `judge` criteria); (2) released practice specs; (3) practice outcome, kind, trajectory, paged extracts (`read_trace`) and coarse band vs author's best (no raw values); (4) aggregate tally/reading (no task names); (5) host limits, budget, task counts. Nothing else crosses: no held-out text/trajectory, check source, `judge` criteria, hidden values, refusing checks, Referee rationale or move advice (rule 3).

## 2. The stance: code owns the conditions, models own the content

Code owns protocol, walls, limits, verification, pairing, swaps, weights, statistics, cap and log; models own content and judgement (harness, solutions, tasks, lane when judged, rulings, diagnosis, hypothesis).

1. **Supply facts, frame positively, omit numeric targets.** Describe good work, not "do not X" bans or targets (Examiner never sees targets/pass rates); treat each prompt edit as an experiment naming its target failure and the read that would revert it; prune lines without effect.
2. **Design for frontier models; trust judgement inside clean walls.** Give seats clean primitives and freedom (including lane choice when judged), not count floors, brittle heuristics or handholding; forbid only naming a task, copying its text or embedding its answer.
3. **Code owns structure, walls and statistics; models own domain judgement.** Code validates schemas, enforces fail-closed contracts (`FIRST_PARTY_VENDORS`; unknown vendors refuse) and never lets a model set limits or identity. Draft audits reuse a seat and block only on mechanical probes. Under `--admit-judge`, a cross-family Referee casts swapped pairwise votes (`referee.pair`, `judgePair` always-swap mean + equal-weight rubric-free `holistic`) on blinded valid pairs via `$0` offline extracts, reading hidden values on criterion votes only; code owns pairing, swaps, weights and statistics (`compare.ts`).
4. **Permit full workspace when in doubt** (hiding only hidden values, credentials and other seats' private files: `SolveDirs`, `command.ts`).
5. **Keep designs as simple as honesty allows.** Prefer first-order mechanisms and native primitives over custom parsers or marginal machinery; every extra line carries cost.

### Reward hacking vs overfitting

Close gaming channels structurally in code, never with bans:
- **Practice memorisation** (task IDs, rare codes, verbatim prompts): overfitting blocked by held-out comparisons; `check_harness` (`files.ts`) and WRI `names.ts` flag leaks.
- **Oracle / hidden-value inversion**: closed by coarse bands (`bandOf`, `GAP_FLOOR`), keeping raw digits in logs.
- **Measurement softening & fishing** (dropped checks, `vacuous-pass` like `Number("") === 0`, hedgable metrics, noisy re-compares): prevented by mechanical probes (`referee.draft`, `doNothing`, hidden-swap), host-gated fresh comparisons (`decide`, `written-after`) and WRI `gaming.ts`.
- **Rubric & judge gaming** (bloat, cosmetic fluff, checklist farming): reduced by cross-family seats (self-preference), one criterion per vote, swapped pairwise mean (position) and equal-weight `holistic`; length is only prompted and capped (`fairCap`), unmeasured.

## 3. The seats

- **Examiner** (`src/examiner/`): drafts exam specs (picking the lane when judged) and tasks; host validates structure and rejects planted answers (`propose_tasks`); reads `src/examiner/record.ts` (item scores) without targets or harness names.
- **Builder** (`src/builder/`): edits `harness/`, reads practice traces and paged extracts (`read_trace`), picks moves and freezes candidates, seeing only §1's five items, `MEMORY.md` and kept harnesses.
- **Solver** (`src/solver/`): solves a task via `read`, `bash`, `edit`, `write`, `submit` and installed programs.
- **Verifier** (`src/kernel/verify.ts`): runs offline checks and `[0, 1]` code items in a fresh offline sandbox.
- **Referee** (`src/audit/auditor.ts`, `judge.ts`): rules on reproducible rejections (`earned`, `check-defect`, `unclear`) and, under `--admit-judge`, runs cross-family `referee.pair` (exam side only).

A content-addressed **harness** (`agent/tools-spec.json`, `.toolchain/`, `agent/BUILT_AGENTS.md`) has three tiers: **`bareSolver`** (`pi-durable` + 4 tools, no guide/programs; external baseline), **`baseStarter`** (`starter.ts`: + minimal `BUILT_AGENTS.md`; + Builder-only `HARNESS.md` = **Starter Pack**), **`builtSolver`** (Builder harness; promotions beat `baseStarter`). Never say "with or without a harness".

### What waits for the operator

Seven decisions need approval (`operator-and-harness.md`; unattended launch pre-authorises freeze, `--admit-authored`, cross-family `--admit-judge` and promotion unless `--hitl`): freezing/rejecting contract/checks or admitting authored/judged instruments (`accept.ts --freeze`, `--admit`, `--admit-judge`); blind labels; cap/payer; infeasible tasks; manual promotion (`promote.ts --harness <digest> --yes`, `--despite`); solver inputs/limits (`baseStarter`, env, limits); stopping a live run.

Recommend with evidence while continuing other work. Approval covers only what it names ("keep going" grants none; a cycle covers runs, pauses, stack patches). Host says "a person" solely for these seven.

## 4. The Harness Builder

One Builder (`harness-builder.ts`) drives the campaign (`examine`, `compare`, `campaign_status`, `wait`); one Examiner sleeps between `examine` calls and closes with it (`campaign-actions.ts`). Host owns stops, practice release and promotions; Builder never sees `decide` (`decide.ts`). Comparisons test frozen digests (step promotes that digest); unchanged harnesses re-compare only when `decide` asks; refused actions are not moves; embed standing facts in tool results (out-of-band messages never reach Builder).

## 5. The log

`.ana/d2/<name>/log.jsonl` (`src/kernel/log.ts`, append-only, fsynced) is the sole record; state/reports are pure folds over it. A **condition** (`condition.ts`) fixes solve parameters; solves compare only when differing solely in the tested variable.

1. **No second store** (persist as log events) and **no second reader** (call the owning fold).
2. **Never edit logs or hand-author events** (`runs copy|move|retire`; only `retire` deletes); **keep all `EVENT_KINDS` readable**.

Logs hold hidden exam values—keep out of prompts, PRs and transcripts; copied runs omit binaries and are read-only.

## 6. A campaign's commands

`bun tools/d2/harness-builder.ts` runs unattended until `budget`, `stop`, `exam`, `no-room`, `environment`, `operator` or `finished` (3 no-move sessions); operators steer via `tools/d2/word.ts` (hidden from seats). Config locks solver, limits, `--target`, `--solves`. Practice releases from reference solves only (≤ half held-out pool, keeping `comparisonFloor` via `practiceDue`). Moves pass `admission.ts`, session admission and stop rule (`--past-stop "<why>"` overrides); nothing appends before refusal except `build.checkpoint` frozen by `compare`. Defaults live in code: `SIZE` (`size.ts`), `PATIENCE` (`reports.ts`), `GAP_FLOOR`/`WEIGHTS` (`compare.ts`), `LIMITS` (`campaign.ts`), flags (`campaign-terms.ts`).

## 7. How a comparison is read

Comparisons pre-register terms, solve both arms afresh on sampled tasks (newest epoch first, 1 retained per 3 frontier tasks) and pair rollouts. **Outcomes** (`solve.ts`): pass = valid; failure = earned rejection, limit expiry, `no-answer`, `broken-harness`, `malformed`; set aside = unruled, `check-defect`, `unclear`; non-result (retried, excluded) = `provider`, `sandbox-crash`, `killed`, `moved-files`, `check`, `verifier`. **Scoring** (`pointsOf`, `WEIGHTS`): validity first, then unified objective (`[0, 1]` code items, plus swapped `judge` criteria and equal-weight `holistic` via `JUDGE_STEP` when `hasJudge`); cost never enters scores. Exact one-sided paired sign-flip test registers `step`, `no-step`, `not-scored`, `check-defects` or `no-change`. `decide` (`decide.ts`) picks moves; 6 eligible moves without gain trigger `stopRule`.

## 8. Rules

1. **Only held-out comparisons decide**—never practice outcomes, prose, reviews or unit tests.
2. **Only Examiner authors the exam; nobody coaches it.** Never patch domain rules, checks, tasks, packs, kept harnesses or logs; fix cross-domain host/prompt/contract defects.
3. **Nothing crosses the wall except §1's five items.** Perturbing hidden values, checks, `judge` criteria or held-out winners leaves Builder/solver messages byte-identical except budget (`builder.test.ts`, `builder-led.test.ts`, `wall-practice.test.ts`, `judge-rubric.test.ts`); document wall checks on PRs touching those surfaces.
4. **Pre-register terms before solving; never alter post hoc.**
5. **Solve both arms afresh under identical conditions** (no cached solves).
6. **Single rollouts are weak evidence**; label any single solve shown to an agent.
7. **Non-results are neither passes nor fails**; retry and exclude from denominators.
8. **Rejections count only once adjudicated**; blind operator labels override Referee.
9. **No reference answers, stronger solvers or answer-finding agents** (generation parameters are task facts).
10. **No unadmitted agent-authored measurement instrument.** Unpinned authored checks and `judge` items fault unless admitted (`--admit`, `--admit-authored`, `--admit-judge`).
11. **Host owns resource limits**; files requesting more time, turns or disk have no effect.
12. **One owner per decision, one reader per fact.** Remove any second owner.
13. **Add machinery only on empirical evidence**: `owner → live reader → decision → evidence → hostile test`. Collapse seams first; new diagnostics report only until replay flips decisions; delete superseded code (or list readers under "Not done"); additions >~50 prod lines justify why nothing simpler fits.
14. **Stop when nothing can be learned** (refuse invalid launches; skip dead providers).
15. **Credit/session limits are normal, not defects.** Resume from the log at the run's commit once quota recovers or on another login; investigate only non-limit 429s, timeouts or crashes.

## 9. Status, evidence and claims

Read `attribution-and-proof` before claiming gain. Exact rungs (not "built"/"done"): `planned` < `present in source` (commit + live reader) < `proved without a model` (bounded check/property, replay, rehearsal) < `exercised live` (live log event) < `shown in an outcome` (replicated on fresh solves), or `withdrawn`.

```text
log events > log fold > source & tests > printed line > PR text > agent's account
```

Own conclusions and subagent reports sit lowest until grounded higher. Compute counts via owning folds; state causal claims as falsifiable hypotheses. Tests prove paths, not model gain; one OS proves nothing about another's wall; a run speaks only for its commit (`runs source --has <text>`). Check symbol and callers before claiming absence.

| Claim | Required evidence |
| --- | --- |
| Step / no step | Reading with condition & sample size (unqualified step needs fresh confirmation; no-step never proves equivalence) |
| Mechanism / refusal | Live log event where trigger fired / refusal text (proves only trigger) |
| Harness attribution | Ablation against `programs-of:<digest>` |

Give every rate its denominator and binomial interval (0/n: ≤3/n), count looks behind a reading (repeats inflate false steps), and compare matched active hours, not wall-clock span. Separate **instrument health** (clean runs, 0 A/A steps, low crashes) from **product outcome** (`written-after` vs `chosen`, internal vs `baseStarter`, external vs `bareSolver`, same-domain delta vs prior version, weighting recent gaps highest). Triage inline via `.ana/wri/` + folds (`runs source|view`, `backtrack.ts`, `table.ts`, `trend.ts`, `starter-reads.ts`, `score.ts`).

## 10. Runs with a real model

Live runs spend budget and need approval per named run; seats run in Seatbelt/Bubblewrap (unavailable wall = typed non-result). See `run-improvement-campaign`, `run-management`, `whole-run-investigation` (`bun run runs`):
1. **Worktree is the condition**: clean worktree at a published commit (`runs fresh`), `src/` untouched; paid seats refuse main checkout or `ana-followed` (`treeFault`).
2. **Simulate & predict before spending** (Approach 4: `--dry-run`, `runs replay`, seeded `runs rehearse`, wall probes); pre-register falsifiable count predictions before solve 1, backtrack at promotions, resolve before forking.
3. **1–2 concurrent rounds/host** (`leastOccupied`); verify cross-family reviewer auth on target host for judged runs; **never open, print or copy `--env-file`**.
4. **Never stop a live run to patch it** (stack fixes for fresh runs); **read logs before prose**; **report every attempt**; **measured runs open fresh projects at one commit** (inherited promotions never count).

Track primary + verifiable control domains and external transfer (`docs/plan.md`), checking conditions before blaming a harness. React to `runs alerts`/`runs pulse`, not polling.

## 11. Working in the repository

Use pinned Bun (`package.json`), keep hooks on, run `bun run test -- <paths>` while iterating and `bun run gate` at top (`local-checks`). GitHub Actions runs only `ci.yml`.

**Never touch**: `.ana/` (except `.ana/wri/`), `data/runs/`, packs, checks, kept harnesses, `.env`, credentials or deps. `vendor/` needs verbatim upstream provenance and documented local edits.

### The stack and pull requests

Releases land a full stack: **small** (`0.x.y+1`) after automated proof; **big** (`0.x+1.0`) when exercised live at stack head and a factor shifts past inter-run spread. Compare runs by commit (`runs source`), not version.

Run `stack-pr` (`scripts/stack.ts`) before branching/pushing: extend owning PR or stack a draft (`bun run land -- <top> --sanitize`, `--from` needs approval); one worktree/PR, no `git stash`, every commit passes checks; never edit another session's PR/worktree/run (replaying unchanged on restack is allowed); push only your branch (`--force-with-lease`), verify remote, leave merging to operator.

Label PRs by category (`CATEGORIES`, `land.ts`) and highest importance: `I0` invalid/unsafe (runs pause), `I1` decision/measurement/wall/crash/stall/waste fix/removal, `I2` other prod/prompt/tooling, `I3` docs/prose/tests alone.

**Shell & reviews**: leave profiles, SSH and env files untouched; verify reviewer counts and `file:symbol` at source.

## 12. Code that passes the first time

Read `tools/oxlint/HABITS.md` first. Zero strict-lint findings, never disable rules (`bun run not-slop` for single-site false positives; fix systematic ones in rule source), import `node:` only via `src/meta`, files ≤800 nonblank lines, functions ≤115 lines, export only imported symbols.

**Comments** (`ana/no-comments`, `delete-comment`): prose comments mark what code should say. Delete tautologies/stale notes, make surprises unrepresentable, move decisions to `docs/adr/`, encode constraints (`do not remove`, `keep this wording`) as types/checks/tests/lint, keep only provable `SAFETY:` or external invariants.

### Tests

State outcomes over an input space, not examples (`HABITS.md` §12.12). Prefer:
1. **Bounded exhaustive checks** against an independent rule (`compare-exhaustive`), ≤~10s via symmetry/canonical state before shrinking bounds.
2. **State-space search** over reachable logs (`decide-explore`) or **seeded LCG generators** counting branches (`pairs-property`).
3. **Shared perturbation walls** (`wri-walls`, `wall-practice`) and **pure invariant/view-model tables** (`runs-invariants`, `view-model`).
4. **Named examples only** at process/file/provider boundaries, refusals/locks (nearest hostile case) or real regressions.

Pin each §6 default once. Avoid wording/per-reader examples, lint fixtures (`rule-examples`), browser click-flows (view-model tables + smokes), module mocks, sleeps and test-only exports; assert via live entry points. Delete/replace tests only against owner mutants (`commit-r` step 8). Check full exit codes (unmasked by pipes); isolated passes are leads, missing-userns wall failures are real.

**Readers/helpers** (search by behaviour first, delete dead guards/timers; helpers may import production, never reverse, `direction.ts`, and call owning folds):
- Campaign, `bun run` verb, local job, UI → `src/` fold or `tools/` command
- Single-campaign (`wri.ts`) → `tools/wri/` · Shared skills (≥2) / cross-run → `.claude/skills/main/` · Single skill → its `scripts/`

## 13. Writing

Plain English: state principles, current behaviour and rationale rather than chronological narratives (history lives in commits/PRs/logs). Give exact figures with measured axis, use §14 terms and backticks for identifiers/paths, state each fact once in its owner (rewrite prompts, never append).

## 14. Terms and map

**Held-out**: scored, hidden from Builder. **Practice**: released, unscored. **Valid**: passes checks in limits. **Reference**: starter until promoted. **Round**: Builder + comparison. Glossary: `terms-and-map.md`.

```text
src/meta runtime owners  src/kernel log, conditions, verifier, comparison, reports
src/wall OS wall  src/agent one model session  src/tools shared tools
src/harness Built Harness  src/solver one solve  src/builder, examiner, referee
src/campaign round, admission, decide, opening, words
tools/d2 campaign commands  tools/runs run registry  tools/wri run investigation
tools/runtime lint, test, gate, land, moments  packages/ui read-only log page  vendor copied
.claude/skills procedures & scripts  .claude/skills/main shared script library
```

# AGENTS.md

Repository invariants and map; read the owning skill before modifying or answering about a subsystem.

| Scope | Read first | Related skills | Verify with |
| --- | --- | --- | --- |
| Seats, prompts, wall, starter | `design-and-seats` (§1–3) | `examiner-complexity`, `harness-audit`, `system-path-simulation` | `seat-view.ts`, wall tests |
| Campaign loop, admission, practice, endings | `campaign-mechanics` (§4–6) | `run-management`, `decision-points`, `run-improvement-campaign`, `whole-run-investigation`, `zip-run`, `oracle-handover` | `runs replay`, `runs rehearse` |
| Readings, scoring, sampling, A/A, `decide` | `comparison-reading` (§7–8) | `promotion-tuner`, `attribution-and-proof`, `comparison-review`, `compare-systems` | `promotion-tuner` replay |
| Commits, PRs, checks, claims, writing | `repository-practice` (§9–14), `tools/oxlint/HABITS.md` | `stack-pr`, `consolidate-stack`, `simplify`, `reduce-complexity`, `commit-r`, `local-checks`, `system-audit`, `codex-gpt-swarm` | `bun run gate`, `preflight.ts` |

Run skill scripts via `bun .claude/skills/<skill>/scripts/<name>.ts`. Current metrics live in `docs/plan.md`; `docs/v1.md`, `docs/transfer.md` and `studies/` hold the v1 record; `tools/runtime/moments.ts` injects nudges on governed paths.

**How to approach a task.** Carry work as far as authority permits, through verification and delivery:
1. **Fix the owning design, not the symptom.** Refactor the owner when you own the boundary or are consolidating; weigh rebase blast radius on deep stacks, and patch locally when structural change awaits a §3 decision.
2. **Replay before changing any decision rule.** Replay admission, sampling, scoring, practice-release or stop-rule changes over `data/runs/` (`promotion-tuner`, `system-path-simulation`) and report every flipped decision.
3. **Subtract before adding.** Check existing owners (rule 12) and collapse seams before adding a flag, guard, branch, helper or prompt paragraph.
4. **Connect stored skill outputs, then verify at primary source.** Join `.ana/wri/` artifacts with live folds before spawning subagents or scanning raw logs (§9); assert nothing unverified and correct errors immediately.
5. **Stress-test your change.** Check the strongest objection, what refutes it, and which test or mutant fails before and passes after.

Resolve routine ambiguity by choosing the strongest option and stating what would overturn it; pause only for missing permissions or a §3 decision, with analysis and recommendation. Audits, reviews and plans stay read-only. Report the evidence rung (§9) and open items. Keep operator infrastructure (hosts, logins, accounts, scheduled jobs, full run names) out of tracked files, commits and PRs.

## 1. What Anabasis does

From a domain query, a campaign builds a **Built Harness** (guide + tooling) for a fixed **solver** model to isolate the harness's causal effect:

> Is the candidate harness better than the reference harness, for this solver, on held-out tasks that neither was built on?

A paired comparison answers this (§7): both harnesses solve held-out tasks afresh under pre-registered conditions; Verifier checks validity; Referee rules on reproducible rejections; a one-sided paired sign-flip test registers a **step** (promoting candidate) or no effect. Cross-solver runs use `compare-systems`.

### The four reported factors

Name the target factor and empirical count in every change (`docs/plan.md`):
- **Supply** (precondition): informative gradient (`informative`, `src/kernel/compare.ts`); admission tracks unclosed frontier tasks (`comparisonFloor`).
- **1. Climb**: promotions in one campaign (`src/campaign/climb.ts`), confirmed when the epoch's first starter comparison beats starter (`confirmed`). Never expose the 6-promotion / 2-domain milestone to any seat.
- **2. Honesty**: A/A control beside every comparison; bar is zero A/A steps across 10 comparisons after promotion 6 (`falseRate`, `barLines`).
- **3. Verdicts**: evidence-backed Referee rulings; against ≥30 blind operator labels, bar is ≥3/4 check-defect detection and ≤1/10 voided earned rejections (`clears`, `src/referee/agreement.ts`).
- **4. Economy**: list-price dollars and wall-clock hours per promotion (`tools/d2/close.ts`, `billOf`, `BARS`).

### Trade-offs to keep in view

Expanded in `design-and-seats` (`question-and-factors.md`, `stance.md`):
- **Objective signal vs variance**: hard-constraint domains separate on validity; open-ended domains saturate validity so the noisier objective governs. Report carrying measure and starter A/A noise floor; raising `GAP_FLOOR` shifts noise while starving supply.
- **Promotion vs confirmation**: the owed starter comparison runs on the next `compare` (`heldSince`); reading ahead leaves promotion unconfirmed (`test/decide-explore.test.ts`).
- **Practice vs held-out supply**: practice takes ≤ half the held-out pool; watch `comparisonFloor` and treat untransferred practice gains as overfitting.
- **Gate strictness vs capability**: refuse only measurement-breaking or wasted-compute actions; pass other observations as notes. Err toward lenient sandboxing and Builder freedom.
- **External benchmarks**: measure transfer, not promotion; keep queries naturally scoped.

### Two sides and one wall

Practice is training; held-out is test and never leaks to the build side. Examiner sees reference outcomes and winning harnesses; only five items cross to the build side: (1) contract public rules, scope, conventions, answer format and objective (quantity + direction); (2) public spec of released practice tasks; (3) practice solve outcome, kind, trajectory and coarse objective band relative to author's best (no raw values); (4) aggregate comparison tally and reading without task names; (5) host limits, remaining budget, and held-out/practice counts. Nothing else crosses: no held-out text/trajectory, check source, hidden values, refusing check list, Referee rationale or move-table recommendation (rule 3).

## 2. The stance: code owns the conditions, models own the content

Code governs protocol and conditions (move eligibility, refusals, limits, solve conditions, verification, statistics, wall, dollar cap, append-only log); models govern content (harness, solutions, tasks, rulings, diagnosis, next hypothesis).

1. **Supply facts, not directives** (prescribed actions make models ignore contradicting evidence) **and no numerical targets** (Examiner never receives a target count or pass rate).
2. **Keep the Builder unconstrained**, except no harness may name a task, copy its text or embed its answer.
3. **Code validates declared structure, never selects content**; a model reply never sets a score, limit or identity.
4. **When in doubt, permit the full workspace** (isolation hides only hidden values, credentials and other seats' private files: `SolveDirs`, `src/tools/command.ts`).
5. **Prefer the simplest design capturing most of the effect** without compromising measurement honesty.

### Reward hacking vs overfitting

Close gaming channels structurally in code rather than with "do not cheat" prompt bans (which often backfire). Separate practice overfitting from structural reward hacking:
- **Practice memorisation** (task IDs, rare dataset codes like `P-00123`, verbatim prompts): training-set overfitting, not a held-out exploit; held-out comparisons block it from winning, while `check_harness` (`src/harness/files.ts`) and WRI `names.ts` flag high-precision leaks cheaply.
- **Oracle / hidden-value inversion** (probing exact practice scores or `try_reference` gaps to back-solve hidden parameters or tune around decision boundaries): close by coarsening cross-wall feedback into bands (`bandOf`, `roomLine` `GAP_FLOOR`), keeping raw digits in the log.
- **Measurement softening & comparison fishing** (dropping checks across retries, `vacuous-pass` holes like `Number("") === 0`, hedgable single-metric objectives, or repeatedly comparing untried/noisy edits until variance clears `α`): prevent via upstream mechanical probes (`referee.draft`, `doNothing`, hidden-swap checks), host-gated fresh comparisons (`decide`, `written-after` Starter confirmation), and Lane 24 (`tools/wri/gaming.ts`).

## 3. The seats

- **Examiner** (model, `src/examiner/`): drafts exam specs and authors tasks; host gate validates structure and rejects planted answers without solving (`propose_tasks`); reads `src/examiner/record.ts` without targets or harness names.
- **Builder** (model, `src/builder/`): edits `harness/`, chooses moves and freezes candidates, seeing only §1's five items, its own notes and kept harnesses.
- **Solver** (model, `src/solver/`): solves one task via `read`, `bash`, `edit`, `write`, `submit` and installed programs.
- **Verifier** (code, `src/kernel/verify.ts`): runs every check in a fresh offline sandbox.
- **Referee** (model, `src/referee/referee.ts`): rules on each rejection reproducing on host replay as `earned`, `check-defect` or `unclear` (exam side only).
- **Host** (code): everything assigned to code under §2.

A **harness** (`agent/tools-spec.json`, `.toolchain/`, `agent/BUILT_AGENTS.md`) is content-addressed. The **Starter Built Harness** (`src/harness/starter.ts`, pi's four tools) is baseline (**Starter** / **bareSolver**); adding `HARNESS.md` forms the **Starter Pack**; a Builder-authored harness runs a **builtSolver**. Every solve runs inside a harness—never say "with or without a harness".

### What waits for the operator

Seven decisions require explicit operator authority (`design-and-seats`, `operator-and-harness.md`): freezing/rejecting the contract or check program or admitting an authored check (`tools/c/accept.ts --freeze`, `--admit`); blind labelling of sampled rejections; setting the dollar cap and paying account; declaring an unsolved task infeasible; manually promoting a harness (`tools/d2/promote.ts --harness <digest> --yes`, `--despite` to override `decide`); changing solver inputs/limits (starter harness, shell env, campaign limits); and stopping a live run.

Present evidence and a recommendation when asking, continuing independent work meanwhile. Authorisation covers only what it names ("keep going" grants none of the seven; opening a cycle covers its runs, pauses and stack patches). Host messages say "a person" solely for these seven.

## 4. The Harness Builder

One Builder conversation (`tools/d2/harness-builder.ts`) drives the campaign via `examine`, `compare`, `campaign_status` and `wait`. One Examiner sleeps between `examine` calls across promotions and closes with the Builder (`tools/d2/campaign-actions.ts`). Host code enforces stops, practice release and promotions; the Builder never sees `decide`'s recommendation (`src/campaign/decide.ts`). Comparisons test exact frozen digests (step promotes that digest); unchanged harnesses re-compare only when `decide` calls for it (repeated draws inflate false positives); refused actions are not moves; embed standing facts in every tool result (out-of-band messages never reach the Builder).

## 5. The log

A campaign's sole record is `.ana/d2/<name>/log.jsonl` (`src/kernel/log.ts`, append-only, fsynced). All state and reports are pure folds over it. A **condition** (`src/kernel/condition.ts`) fixes host-controlled solve parameters; two solves are comparable only when differing solely in the tested variable.

1. **No second store** (persist state as log events) and **no second reader** (call the owning fold).
2. **Never edit a log or hand-author events.** Use `bun run runs copy|move|retire`; only `retire` deletes.
3. **Preserve readability of all recorded `EVENT_KINDS`.**

Logs hold hidden exam values—keep them out of prompts, PRs and transcripts. Copied campaigns omit installed binaries and are read-only.

## 6. A campaign's commands

`bun tools/d2/harness-builder.ts` runs unattended until `budget`, `stop`, `exam`, `no-room`, `environment`, `operator` or `finished` (3 no-move Builder sessions). Operators steer via `tools/d2/word.ts` (hidden from seats). Config locks solver, limits, `--target` and `--solves`. Practice releases from reference solves only (≤ half the held-out pool, preserving `comparisonFloor` via `practiceDue`). Moves are gated by `src/campaign/admission.ts`, session admission and the stop rule (`--past-stop "<why>"` overrides); nothing appends before a final refusal except `build.checkpoint` frozen by `compare`. Defaults live in code alone: `SIZE` (`src/kernel/size.ts`), `PATIENCE` (`src/kernel/reports.ts`), `GAP_FLOOR`/`WEIGHTS` (`src/kernel/compare.ts`), `LIMITS` (`tools/d2/campaign.ts`), and significance/reserve/session flags (`tools/d2/campaign-terms.ts`).

## 7. How a comparison is read

Comparisons pre-register terms before solving, run both harnesses afresh on the same sampled tasks (newest epoch first, 1 retained per 3 frontier tasks), and pair every rollout across arms. **Outcomes** (`src/kernel/solve.ts`): pass = valid answer; failure = earned rejection, limit expiry, `no-answer`, `broken-harness`, `malformed`; set aside = unruled, `check-defect` or `unclear`; non-result (retried, excluded from pairing) = `provider`, `sandbox-crash`, `killed`, `moved-files`, `check`, `verifier`. **Scoring**: validity first, objective breaks ties (`pointsOf`, `WEIGHTS`); cost never enters scores. An exact one-sided paired sign-flip test over nonzero scores registers `step`, `no-step`, `not-scored`, `check-defects` or `no-change`. `decide` (`src/campaign/decide.ts`) chooses moves; 6 eligible moves without gain trigger `stopRule`.

## 8. Rules

1. **Only held-out comparisons decide**—never practice outcomes, prose, reviews or unit tests.
2. **Only the Examiner authors the exam; nobody coaches it.** Never patch domain rules, checks, tasks, packs, kept harnesses or logs; fix cross-domain host/prompt/contract defects instead.
3. **Nothing crosses the wall except §1's five items.** Perturbing hidden values, checks or held-out winners must leave Builder and solver messages byte-identical apart from budget (`test/builder.test.ts`, `test/builder-led.test.ts`, `test/wall-practice.test.ts`). Any PR touching those surfaces documents its wall check.
4. **Pre-register experimental terms before solving and never alter them post hoc.**
5. **Solve both arms afresh under identical conditions** (no cached solves).
6. **Single rollouts are weak evidence**; label any single solve shown to an agent as such.
7. **Non-results are neither passes nor fails**; retry and exclude from all denominators.
8. **Rejections count only once adjudicated**; blind operator labels override Referee rulings.
9. **No reference answers, stronger solvers or answer-finding agents** (generation parameters are task facts, not answers).
10. **No agent authors a measurement instrument.** Unpinned authored checks are faults unless admitted (`--admit` or `--admit-authored`).
11. **The host owns every resource limit**; files requesting more time, turns or disk have no effect.
12. **One owner per decision, one reader per fact.** When two locations decide the same thing, remove one.
13. **Add machinery only on empirical evidence; prefer simplification**: `owner → live reader → decision it changes → evidence → hostile test`. Collapse seams first; new diagnostics report only until replay flips decisions; superseding changes delete what they replace (or list remaining readers under "Not done"); additions >~50 production lines note why no existing surface could be simplified.
14. **Stop when nothing can be learned** (refuse invalid launches; do not re-run dead providers).
15. **Credit and session limits are normal operating conditions, not defects.** Resume from the log at the run's commit once quota recovers or on another login; investigate only non-limit 429s, timeouts or crashes.

## 9. Status, evidence and claims

Read `attribution-and-proof` before claiming improvement. Use exact evidence rungs instead of "built" or "done": `planned` < `present in source` (commit + live reader) < `proved without a model` (bounded check/property, replay, rehearsal) < `exercised live` (real log event) < `shown in an outcome` (replicated on fresh solves), or `withdrawn`.

```text
log events > log fold > source & tests > printed line > PR text > agent's account
```

Own conclusions and subagent reports sit lowest until grounded higher. Compute counts via owning folds; state causal claims as falsifiable hypotheses. Tests prove code paths, not model gain; one OS proves nothing about another OS's wall; a live run speaks only for its commit (`bun run runs source --has <text>`). Inspect symbol and callers before claiming absence.

| Claim | Required evidence |
| --- | --- |
| A step | Comparison reading `step` with condition; unqualified only after fresh confirmation |
| No step | Same with sample size; never proves equivalence |
| A mechanism | Recorded event in a live log where its trigger occurred |
| A refusal | Refusal text (proves only its trigger) |
| Attribution to part of a harness | Ablation comparison against `programs-of:<digest>` |

Give every rate its denominator. Triage releases, runs and cohorts inline by joining `.ana/wri/` artifacts (`synthesis.md`, `cross-domain.md`, `outcomes-*.md`, `outside-reads.md`, `plan.md`, `cycle.md`) with live folds (`runs source`, `runs view`, `promotion-tuner` `table.ts`/`trend.ts`, `starter-reads.ts`, `score.ts`): treat prose as an index, re-ground key counts in owning folds, and separate code fixes from confirmed factor shifts.

## 10. Runs with a real model

Live runs spend budget and need explicit approval per named run; seats run in Seatbelt or Bubblewrap (unavailable wall = typed non-result). See `run-improvement-campaign`, `run-management`, `whole-run-investigation` (`bun run runs`):
1. **Worktree is the condition**: launch in a clean worktree at a published commit (`runs fresh`), leave `src/` untouched; paid seats refuse main checkout or `ana-followed` (`treeFault`).
2. **Prove without a model first** (`--dry-run`, `runs replay`, `runs rehearse`); **pre-register one falsifiable prediction** settled by an empirical count before the first solve.
3. **At most 1–2 concurrent rounds per host** (`leastOccupied`); **never open, print or copy `--env-file`**.
4. **Never stop a live run to patch it** (stack fixes for fresh runs); **read logs/reports before prose**; **report every started attempt**; **a measured run opens a fresh project at one commit** (inherited promotions do not count).

Track primary + control domains and external transfer (`docs/plan.md`, `run-improvement-campaign`), checking conditions before blaming a harness on external benchmarks. React to `runs alerts`/`runs pulse` instead of polling.

## 11. Working in the repository

Use the pinned Bun (`package.json`), keep git hooks on, run `bun run test -- <paths>` while iterating and `bun run gate` at top (`local-checks`). GitHub Actions runs only `ci.yml`.

**Never touch**: `.ana/` (except `.ana/wri/`), `data/runs/`, packs, checks, kept harnesses, `.env`, credentials or installed deps. `vendor/` requires verbatim upstream provenance and documented local edits.

### The stack and pull requests

Releases land an entire PR stack: **small** (`0.x.y+1`) after automated proof; **big** (`0.x+1.0`) only when exercised live at stack head and a reported factor shifts past inter-run spread. Compare runs by commit (`bun run runs source`), not version.

Run `stack-pr` (`scripts/stack.ts`) before branching or pushing: extend the open PR owning a problem, or stack a new draft PR on top and link via `bun run land -- <new top> --sanitize` (`--from` needs operator approval); one worktree per PR, no manual `git stash`, every commit passes checks independently; never modify another session's PR, worktree or run (except replaying unchanged commits while restacking); push only your authorised branch (`--force-with-lease` on rewrites), verify remote state, and leave merging to the operator.

Label every PR with a category (`CATEGORIES`, `tools/runtime/land.ts`) and highest importance (`repository-practice`): `I0` invalid/unsafe results (live runs pause), `I1` decision/measurement/wall/crash/stall/waste fix or mechanism removal, `I2` other production/prompt/tooling change, `I3` docs/prose/comments/tests alone.

**Shell & reviews** (`repository-practice`): pass the command guard, edit via tools, leave profiles/SSH/env untouched; give subagents/reviewers bounded read-only tasks with source and verify every cited count and `file:symbol`.

## 12. Code that passes the first time

Read `tools/oxlint/HABITS.md` first. Add zero strict-lint findings, never disable rules (`bun run not-slop` for single-site false positives; fix systematic ones in rule source), import `node:` only through `src/meta`, keep files ≤800 nonblank lines and functions ≤115 lines, and export only symbols imported elsewhere.

### Tests

State outcomes over an input space, not one-off examples (`code-and-writing.md`, `HABITS.md` §12.12). Prefer, in order:
1. **Bounded exhaustive checks** against an independent count/rule (`compare-exhaustive`), ≤~10s via symmetry/canonical state before shrinking bounds.
2. **State-space search** over reachable logs with cross-move invariants (`decide-explore`), or **seeded LCG generators** counting reached branches (`pairs-property`).
3. **Shared perturbation walls** (`wri-walls`, `wall-practice`) and **pure invariant/view-model tables** (`runs-invariants`, `view-model`).
4. **Named examples only** across process/file/provider boundaries, refusals/locks (nearest hostile case) or real-run regressions.

Pin measured constants (`WEIGHTS`, `GAP_FLOOR`, `SIZE`, `PATIENCE`) once. Avoid wording/per-reader examples, per-rule lint fixtures (`rule-examples`), browser click-flows (use view-model tables + smokes), module mocks, fixed sleeps and test-only exports; assert via live entry points. Delete/replace tests only against mechanical mutants of the owner (`commit-r` step 8). Check full exit codes directly (unmasked by pipes); isolated passes are leads, and missing-userns wall failures are real failures.

**Where a reader or helper lives** (search by behaviour first, delete dead guards/timers; helpers may import production, never the reverse, `direction.ts`, and must call owning folds):

| Consumer | Location |
| --- | --- |
| Campaign, `bun run` verb, local job, UI | Production fold in `src/` or command folder in `tools/` |
| Deep single-campaign investigation (`wri.ts`) | `tools/wri/` |
| Shared skill scripts (≥2 skills) or cross-run analysis | `.claude/skills/main/` (`cli.ts`, `logs.ts`, `runs.ts`, `print.ts`, `stats.ts`) |
| Single skill's procedure | That skill's `scripts/` |

## 13. Writing

Write concisely, stating what each mechanism does and why: give exact figures with their measured axis (keeping tests, observations and estimates distinct), use §14 terms and backticks for identifiers/paths, state each fact once in prompts (rewrite rather than append), and keep defaults in code.

## 14. Terms and map

**Held-out**: scored in comparisons, hidden from Builder. **Practice**: released to Builder, never scored. **Valid answer**: passes checks within host limits. **Reference**: starter until promoted. **Round**: Builder session + comparison. Full glossary: `repository-practice` (`terms-and-map.md`).

```text
src/meta     runtime owners       src/kernel   log, conditions, verifier, comparison, reports
src/wall     the OS wall          src/agent    one model session      src/tools  shared tools
src/harness  the Built Harness    src/solver   one solve              src/builder, examiner, referee
src/campaign round, admission, decide, opening, words
tools/d2     campaign commands    tools/runs   run registry           tools/wri  run investigation
tools/runtime  lint, test, gate, land, moments  packages/ui  read-only log page  vendor  copied
.claude/skills  the procedures and their scripts  .claude/skills/main  the scripts' shared library
```

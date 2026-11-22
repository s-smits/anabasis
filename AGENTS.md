# AGENTS.md

Every coding agent loads this document for Anabasis's invariants and repository structure. Detailed mechanisms live in four numbered skills; read the owning skill before modifying a subsystem or answering questions about it.

| Scope | Read first | Related skills | Verify with |
| --- | --- | --- | --- |
| Seats, prompts, evaluation wall, starter | `design-and-seats` (§1–3) | `examiner-complexity`, `harness-audit`, `system-path-simulation` | `seat-view.ts` and its wall tests |
| Campaign loop, admission, practice, endings | `campaign-mechanics` (§4–6) | `run-management`, `decision-points`, `run-improvement-campaign`, `whole-run-investigation`, `zip-run`, `oracle-handover` | `bun run runs replay`, `runs rehearse` |
| Readings, scoring, sampling, A/A, `decide` | `comparison-reading` (§7–8) | `promotion-tuner`, `attribution-and-proof`, `comparison-review`, `compare-systems` | `promotion-tuner` archive replay |
| Commits, PRs, checks, claims, writing | `repository-practice` (§9–14), `tools/oxlint/HABITS.md` | `stack-pr`, `consolidate-stack`, `simplify`, `reduce-complexity`, `commit-r`, `local-checks`, `system-audit`, `codex-gpt-swarm` | `bun run gate`, `preflight.ts` |

Run skill scripts via `bun .claude/skills/<skill>/scripts/<name>.ts`. Current metrics live in `docs/plan.md`; `docs/v1.md`, `docs/transfer.md` and `studies/` preserve the frozen v1 record; `tools/runtime/moments.ts` injects area-specific nudges when tool calls enter governed paths or commands.

**How to approach a task.** Carry a request as far as your authority permits, through verification and delivery:
1. **Fix the owning design, not the symptom.** Rewrite or refactor the module that permitted the defect when you own the boundary or during consolidation; weigh rebase blast radius on deep stacks, and patch locally when structural change awaits a §3 operator decision.
2. **Replay before changing any decision rule.** Replay proposed changes to admission, sampling, scoring, practice release or stopping over `data/runs/` (`promotion-tuner`, `system-path-simulation`) and report every historical decision that flips.
3. **Subtract before adding.** Check existing owners (rule 12) and collapse unnecessary seams before adding a flag, guard, branch, helper or prompt paragraph.
4. **Verify every claim at the primary source.** Assert nothing about source, logs, remotes or the clock without reading it directly; correct or retract inaccuracies immediately.
5. **Stress-test your change.** Check the strongest objection, what refutes it, and which test or check fails before and passes after.

Resolve routine ambiguity by choosing the most defensible option and stating what would overturn it. Pause to ask only for missing permissions or a §3 decision, supplying analysis and a recommendation alongside the question. Start the longest independent task first. Audits, reviews and plans stay strictly read-only. Report the evidence rung achieved (§9) and what remains open. Store backlog items in `docs/backlog/<subject>.md` (intended changes followed by history in the operator's words).

**Operator infrastructure** (hosts, logins, accounts, scheduled jobs, concurrency caps) lives in the operator's `CLAUDE.md`, which takes precedence on those machines. Keep its contents, including full run names, out of tracked files, commit messages and PRs.

## 1. What Anabasis does

From a domain query, a campaign builds a **Built Harness** (a harness): the operating guide and domain tooling used by a fixed **solver** model across tasks in that domain. Fixing the solver isolates the harness's causal effect:

> Is the candidate harness better than the reference harness, for this solver, on held-out tasks that neither was built on?

A controlled paired comparison answers this (§7). Both harnesses solve the same held-out tasks afresh under pre-registered conditions; an isolated Verifier checks validity; the Referee adjudicates each reproducible rejection; and a one-sided paired sign-flip test over per-task scores registers a **step** (promoting the candidate to reference) or no statistically significant effect. Cross-solver comparisons run separately (`compare-systems`).

### The four reported factors

Name the target factor and its empirical count in every change (`docs/plan.md` tracks current values):
- **Supply** (precondition): informative evaluation gradient (`informative`, `src/kernel/compare.ts`); admission tracks frontier tasks the reference has not closed (`comparisonFloor`).
- **1. Climb**: promotions in one campaign (`src/campaign/climb.ts`), each confirmed when the epoch's first starter comparison beats the starter (`confirmed`). The observational milestone of 6 confirmed promotions in one campaign, replicated in a second domain, is never exposed to any seat.
- **2. Honesty**: A/A control (reference against itself) beside every comparison; bar is zero A/A steps across the 10 comparisons after 6 promotions (`falseRate`, `barLines`).
- **3. Verdicts**: evidence-backed Referee rulings; against ≥30 blind operator labels, bar is ≥3/4 check-defect detection and ≤1/10 voided earned rejections (`clears`, `src/referee/agreement.ts`).
- **4. Economy**: list-price dollars and wall-clock hours per promotion (`tools/d2/close.ts`, `billOf`, `BARS`).

### Trade-offs to keep in view

Additional trade-offs live in `design-and-seats`:
- **Objective signal vs variance**: once validity saturates, the noisier objective governs. Report which measure carried a step and inspect the starter's A/A noise floor; raising `GAP_FLOOR` shifts noise while starving supply.
- **Promotion vs confirmation**: the owed starter comparison runs on the Builder's next `compare` (`heldSince`); letting a Builder comparison read ahead leaves the promotion unconfirmed (`test/decide-explore.test.ts`).
- **Practice exposure vs held-out supply**: practice releases take at most half the held-out pool; watch the frontier near `comparisonFloor` and treat untransferred practice gains as overfitting.
- **Gate strictness vs capability**: refuse only actions that break measurement validity or guarantee wasted compute; pass other observations as factual notes.
- **External benchmarks vs test-set fitting**: external benchmarks measure out-of-distribution transfer rather than gating promotions; keep campaign queries naturally scoped.

### Two sides and one wall

Practice tasks are the training set; held-out tasks are the test set and never leak to the build side. The Examiner may see reference outcomes and each task's winning harness, whereas only five categories cross to the build side:
1. the contract's public rules, scope, conventions, answer format and declared objective (quantity and direction);
2. the public specification of each released practice task;
3. for a practice solve: its outcome and kind, solver trajectory, and under a declared objective, a coarse band relative to the task author's best recorded answer without revealing raw values;
4. for each comparison: aggregate tally and statistical reading without naming tasks;
5. host resource limits, remaining budget, and counts of held-out and practice tasks.

Nothing else crosses: no held-out task text or trajectory, check source, hidden values, refusing check list, Referee rationale or move-table recommendation (rule 3).

## 2. The stance: code owns the conditions, models own the content

Code governs protocol and experimental conditions (move eligibility, refusals, resource limits, solve conditions, verification, statistics, wall, dollar cap, append-only log). Models govern content (harness, solutions, tasks, rejection adjudication, failure diagnosis, next hypothesis).

1. **Supply facts, not directives.** Prescribed actions cause models to ignore contradicting evidence.
2. **Supply facts, not numerical targets.** The Examiner never receives a target count or pass rate.
3. **Keep the Builder unconstrained**, except no harness may name a task, copy its text or embed its answer.
4. **Code validates declared structure and never selects content.**
5. **A model reply never sets a score, limit or identity**; code defines the exact evidence required.
6. **When in doubt, permit the full workspace.** Isolation hides only hidden values, credentials and other seats' private files (`SolveDirs`, `src/tools/command.ts`).
7. **Prefer the simplest design capturing most of the effect** without compromising measurement honesty.

## 3. The seats

- **Examiner** (model, `src/examiner/`): drafts exam specs and authors tasks; host gate validates structure and rejects planted answers without solving at admission (`propose_tasks`). Reads a restricted log projection (`src/examiner/record.ts`) without targets or harness names.
- **Builder** (model, `src/builder/`): edits `harness/`, chooses moves and freezes candidates, seeing only §1's five items, its own notes and kept harnesses.
- **Solver** (model, `src/solver/`): solves one task via `read`, `bash`, `edit`, `write`, `submit` and installed harness programs.
- **Verifier** (code, `src/kernel/verify.ts`): runs every check inside a fresh offline sandbox.
- **Referee** (model, `src/referee/referee.ts`): adjudicates each rejection reproducing on host replay as `earned`, `check-defect` or `unclear` (exam side only).
- **Host** (code): everything assigned to code under §2.

A **harness** (`agent/tools-spec.json`, `.toolchain/`, `agent/BUILT_AGENTS.md`) is addressed by content digest. The **Starter Built Harness** (`src/harness/starter.ts`, pi's coding agent with four standard tools) is the initial reference and baseline (**Starter** / **bareSolver**); adding `HARNESS.md` forms the **Starter Pack**; a Builder-authored harness runs a **builtSolver**. Every solve runs inside a harness—never say "with or without a harness".

### What waits for the operator

Seven decisions require explicit operator authority:
- freezing/rejecting the contract or check program, and admitting an authored check (`tools/c/accept.ts --freeze`, `--admit`);
- blind labelling of sampled rejections;
- setting the dollar cap and choosing the paying account;
- declaring an unsolved task infeasible;
- manually promoting a harness (`tools/d2/promote.ts --harness <digest> --yes`; overriding `decide` requires `--despite`);
- changing what a solver receives or is instructed with (starter harness, shell environment, campaign limits);
- stopping a live run.

Present evidence and a recommendation when asking, and continue independent work meanwhile. Authorisation covers only what it explicitly names ("keep going" grants none of the seven; opening a cycle covers its runs, scheduled pauses and stack patches; launch grants live in `design-and-seats`). Host messages say "a person" solely for these seven decisions.

## 4. The Harness Builder

One Builder conversation (`tools/d2/harness-builder.ts`) drives the campaign via `examine`, `compare`, `campaign_status` and `wait`. One Examiner conversation sleeps between `examine` calls across promotions and closes when the Builder closes (`tools/d2/campaign-actions.ts`). Host code enforces stopping criteria, practice release and promotions; the Builder never sees `decide`'s recommendation (`src/campaign/decide.ts`).

- Every comparison tests the exact harness frozen for it, and a step promotes that exact digest.
- An unchanged harness is re-compared only when `decide` calls for it (repeated draws inflate false positives).
- Refused actions do not count as moves.

Embed standing facts in every tool result (out-of-band messages never reach the Builder).

## 5. The log

A campaign's sole record is `.ana/d2/<name>/log.jsonl` (`src/kernel/log.ts`, append-only, fsynced). All state and reports are pure folds over it. A **condition** (`src/kernel/condition.ts`) fixes every host-controlled solve parameter; two solves are comparable only when differing solely in the tested variable.

1. **No second store.** Persist needed state as log events.
2. **No second reader.** Call the owning fold directly.
3. **Never edit a log or hand-author events.** Use `bun run runs copy|move|retire`; only `retire` deletes.
4. **Preserve backwards readability of historical `EVENT_KINDS`.**

Logs contain hidden exam values—keep them out of prompts, PRs and pasted transcripts. Copied campaigns omit installed binaries and are strictly read-only.

## 6. A campaign's commands

`bun tools/d2/harness-builder.ts` runs unattended until one of seven terminal states: `budget`, `stop`, `exam`, `no-room`, `environment`, `operator` or `finished` (3 consecutive Builder sessions with no move). Operators steer live runs via `tools/d2/word.ts` (hidden from all seats). Configuration locks solver, limits, `--target` and `--solves`. Practice tasks release exclusively from reference solves (≤ half the held-out pool, preserving `comparisonFloor` via `practiceDue`).

Moves are gated by `src/campaign/admission.ts`, session admission and the stopping rule (overridden only by `--past-stop "<why>"`). Nothing appends to the log before a final refusal except `build.checkpoint` frozen by `compare`.

Authoritative defaults live in code alone: `SIZE` (`src/kernel/size.ts`), `PATIENCE` (`src/kernel/reports.ts`), `GAP_FLOOR` and `WEIGHTS` (`src/kernel/compare.ts`), `LIMITS` (`tools/d2/campaign.ts`), and significance/reserve/session flags (`tools/d2/campaign-terms.ts`).

## 7. How a comparison is read

Comparisons pre-register terms before solving, run both harnesses afresh on the same sampled tasks (newest epoch first, 1 retained per 3 frontier tasks), and pair every rollout across arms.

**Outcomes** (`src/kernel/solve.ts`): pass = valid answer; failure = earned rejection, limit expiry, `no-answer`, `broken-harness`, `malformed`; set aside = unruled, `check-defect` or `unclear` rejection; non-result (retried, excluded from pairing) = `provider`, `sandbox-crash`, `killed`, `moved-files`, `check`, `verifier`.

**Scoring and test**: validity first, objective breaks ties between valid answers (`pointsOf`, `WEIGHTS`); cost never enters scores. An exact one-sided paired sign-flip test over nonzero task scores registers `step`, `no-step`, `not-scored`, `check-defects` or `no-change`. `decide` (`src/campaign/decide.ts`) computes the next move; 6 eligible moves without a gain trigger `stopRule`.

## 8. Rules

1. **Only held-out comparisons decide**—never practice outcomes, prose, reviews or unit tests.
2. **Only the Examiner authors the exam; nobody coaches it.** Never author/patch domain rules, checks, tasks, packs, kept harnesses or logs; fix cross-domain host/prompt/contract defects instead.
3. **Nothing crosses the wall except §1's five items.** Perturbing hidden values, check code or held-out winners must leave Builder and solver messages byte-identical apart from remaining budget (`test/builder.test.ts`, `test/builder-led.test.ts`, `test/wall-practice.test.ts`). Any PR touching those surfaces documents how it verified the wall.
4. **Pre-register experimental terms before solving and never alter them post hoc** (no topping up or re-running under altered terms).
5. **Solve both arms afresh under identical conditions** (no cached/historical solves).
6. **Single rollouts are weak evidence**; label any single solve shown to an agent as such.
7. **Non-results are neither passes nor fails**; retry and exclude from all denominators.
8. **Rejections count only once adjudicated**; blind operator labels override Referee rulings.
9. **No reference answers, stronger solvers or answer-finding agents** (generation parameters are task facts, not answers).
10. **No agent authors a measurement instrument.** Authored checks not backed by the pinned tool are faults unless explicitly admitted (`--admit` or `--admit-authored`).
11. **The host owns every resource limit**; files requesting more time, turns or disk have no effect.
12. **One owner per decision, one reader per fact.** When two locations decide the same thing, remove one.
13. **Add machinery only on empirical evidence; prefer simplification**: `owner → live reader → decision it changes → evidence → hostile test`. Collapse seams before adding options or prompt text; new diagnostics report only until an archive replay shows decisions flipping; superseding changes delete what they replace (or list remaining readers under "Not done"); additions >~50 production lines note why no existing surface could be simplified instead.
14. **Stop when nothing can be learned** (refuse invalid launches before spending; do not re-run dead providers).
15. **Credit and session limits are normal operating conditions, not defects.** Resume from the log at the run's commit once quota recovers or on another login; investigate only non-limit 429s, timeouts or crashes.

## 9. Status, evidence and claims

Read `attribution-and-proof` before claiming improvement. Use the exact evidence rung instead of "built" or "done": `planned` < `present in source` (commit + live reader) < `proved without a model` (bounded check, property test, replay, rehearsal) < `exercised live` (event in a real log) < `shown in an outcome` (moved metric replicated on fresh solves), or `withdrawn`.

```text
log events > log fold > source & tests > printed line > PR text > agent's account
```

Your own conclusions, causal hypotheses and subagent reports sit at the lowest rung until grounded higher. Compute counts via owning folds; state causal claims as falsifiable hypotheses with refuting counts. Unit tests/rehearsals verify code paths, not model gain; one OS's tests prove nothing about another OS's wall; a live run speaks only for its exact commit (`bun run runs source --has <text>`). Inspect both symbol and callers before claiming absence.

| Claim | Required evidence |
| --- | --- |
| A step | Comparison reading `step` with condition; unqualified only after fresh confirmation |
| No step | Same with sample size; never proves equivalence |
| A mechanism | Recorded event in a live log where its trigger occurred |
| A refusal | Refusal text (proves only its trigger) |
| Attribution to part of a harness | Ablation comparison against `programs-of:<digest>` |

Separate distinct counts, give every rate its denominator, and evaluate longitudinal progress across groups of fresh runs against inter-run variance (`promotion-tuner`, `scripts/trend.ts`).

## 10. Runs with a real model

Live runs spend budget and require explicit authorisation for named runs. Seats run inside Seatbelt or Bubblewrap (unavailable wall = typed non-result). Procedures live in `run-improvement-campaign`, `run-management` and `whole-run-investigation`; `bun run runs` lists verbs.

1. **The worktree is the condition**: launch each run in its own clean worktree at a published commit (`runs fresh`) and leave `src/` untouched while active; paid seats refuse the main checkout or `ana-followed` (`treeFault`).
2. **Prove without a model first** (`--dry-run`, `runs replay`, `runs rehearse`).
3. **Pre-register one falsifiable prediction** settled by an empirical count before the first solve.
4. **At most 1–2 concurrent rounds per host** (`runs fresh` places via `leastOccupied`).
5. **Never open, print or copy `--env-file`.**
6. **Never stop a live run to patch it**; put fixes on the PR stack for the next fresh batch.
7. **Read log events and generated reports before agent prose.**
8. **Report every started attempt as spent compute.**
9. **A measured run opens a fresh project at one commit**; inherited promotions do not count.

Track primary + control domains and external transfer (`docs/plan.md`, `run-improvement-campaign`), tracing cross-domain regressions to their introducing change and checking conditions before blaming a harness on external benchmarks. Within an authorised cycle, pause triggered runs after their active comparison, investigate, stack fixes and fork fresh runs within cycle grants; react to `runs alerts`/`runs pulse` instead of polling.

## 11. Working in the repository

Use the Bun pinned in `package.json`, keep git hooks enabled, run `bun run test -- <paths>` while iterating and `bun run gate` at the top (`local-checks`). GitHub Actions runs only `ci.yml`.

**Never touch**: `.ana/` (except `.ana/wri/`), `data/runs/`, packs, check programs, kept harnesses, `.env`, credentials or installed deps. `vendor/` requires verbatim upstream provenance and documented local edits.

### The stack and pull requests

Releases land an entire PR stack: **small** (`0.x.y+1`) after automated proof; **big** (`0.x+1.0`) only when exercised live at stack head and a reported factor shifts beyond inter-run spread. Compare runs by commit (`bun run runs source`), not version.

Follow `stack-pr` and run `bun .claude/skills/stack-pr/scripts/stack.ts` before branching or pushing:
- Extend the open PR owning a problem, or stack a new draft PR on top and link it with `bun run land -- <new top> --sanitize` (`--from` requires operator authorisation).
- One worktree per PR, no manual `git stash`, every commit passes checks independently.
- Never modify another session's PR, worktree or run (except replaying its commits unchanged above yours while restacking).
- Push only your authorised branch (`--force-with-lease` on rewrites), verify remote state, and leave merging to the operator.

Label every PR with a category (`CATEGORIES`, `tools/runtime/land.ts`) and highest matching importance:
- `I0`: results already invalid/unsafe (bad reading/promotion, wall breach, lost answers, leaked credentials, cap exceeded, broken `main`); live runs should pause (~1 in 50).
- `I1`: fixes a defect in decisions, measurement or seat exposure; prevents corruption, crashes, stalls, lost sessions or wasted compute; or removes an entire mechanism.
- `I2`: other changes to production code, prompts or run/landing tooling, including simplifications.
- `I3`: reporting, wording, comments, docs, skill prose or tests alone.

**Shell commands**: write plain commands passing the command guard (`repository-practice`), use edit tools for files, run multi-line scripts from files, move unwanted files to Trash by explicit path instead of `rm -r`, and leave profiles/SSH/env files untouched.

**Reviews and subagents** (when permitted by operator config): assign one bounded read-only task with authority, paths, revision, known facts and exact question; supply source rather than conclusions; require counts with denominators and `file:symbol` citations; verify every finding at source as confirmed, plausible or refuted.

## 12. Code that passes the first time

Read `tools/oxlint/HABITS.md` before writing code. Add zero strict-lint findings, never disable rules (`bun run not-slop` for single-site false positives; fix systematic ones in rule source), import `node:` only through `src/meta`, keep files ≤800 nonblank lines and functions ≤115 lines, and export only symbols imported elsewhere.

**Tests**: match style to code—bounded exhaustive checks (`test/compare-exhaustive.test.ts`), state-space exploration (`test/decide-explore.test.ts`) or seeded property tests (`test/pairs-property.test.ts`) for pure kernel/decision logic; clear regression tests for real-run bugs, boundaries and hostile refusals. Pin measured constants (`WEIGHTS`, `GAP_FLOOR`, `SIZE`, `PATIENCE`) once. Check mechanical mutants before deleting/replacing tests (`commit-r` step 8). Keep bounded checks ≤~10s via symmetry, assert observable behaviour rather than prose, verify full-change exit codes directly (never masked by pipes), and treat missing-userns wall failures as real failures.

**Where a reader or helper lives** (search by behaviour first, delete dead guards/timers):

| Consumer | Location |
| --- | --- |
| Campaign, `bun run` verb, local job, UI | Production fold in `src/` or command folder in `tools/` |
| Deep single-campaign investigation via `wri.ts` | `tools/wri/` |
| Scripts of ≥2 skills or cross-campaign analysis | `.claude/skills/main/` (`cli.ts`, `logs.ts`, `runs.ts`, `print.ts`, `stats.ts`) |
| Single skill's procedure | That skill's `scripts/` |

Helpers may import production, never the reverse (`direction.ts`), and must call owning production folds.

## 13. Writing

Write clearly and concisely, stating what a mechanism does and why.
- Give exact figures with their measured axis, keeping tests, observations and estimates distinct.
- Use §14's canonical terms and inline backticks for identifiers and paths.
- State each fact once in prompts; tune by rewriting existing sentences instead of appending paragraphs, and fix recurring interface failures in the tool.
- Document current behaviour here and in skills; keep defaults in code and history in commits, PRs, backlog or head comments.

## 14. Terms and map

**Held-out task**: scored in comparisons, hidden from Builder. **Practice task**: released to Builder, never scored. **Valid answer**: passes all checks within host limits. **Reference harness**: starter until promoted. **Round**: Builder session + comparison. Full glossary: `repository-practice` (`terms-and-map.md`).

```text
src/meta     runtime owners       src/kernel   log, conditions, verifier, comparison, reports
src/wall     the OS wall          src/agent    one model session      src/tools  shared tools
src/harness  the Built Harness    src/solver   one solve              src/builder, examiner, referee
src/campaign round, admission, decide, opening, words
tools/d2     campaign commands    tools/runs   run registry           tools/wri  run investigation
tools/runtime  lint, test, gate, land, moments  packages/ui  read-only log page  vendor  copied
.claude/skills  the procedures and their scripts  .claude/skills/main  the scripts' shared library
```

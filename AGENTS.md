# AGENTS.md

Every coding agent loads this document for Anabasis's system invariants and repository structure. Detailed mechanisms live in four numbered skills aligned with the sections below; read the owning skill before modifying a subsystem or answering questions about its behaviour.

| Scope of task | Read first | Verify with |
| --- | --- | --- |
| Seats, prompts, the evaluation wall, the starter | `design-and-seats` (sections 1 to 3) | `seat-view.ts` and the wall tests it enumerates |
| Campaign loop, admission, practice release, termination | `campaign-mechanics` (sections 4 to 6) | `bun run runs replay`, `runs rehearse` |
| Readings, scoring, task sampling, A/A controls, `decide` | `comparison-reading` (sections 7 and 8) | `promotion-tuner` replay over the archive |
| Commits, pull requests, checks, claims, writing | `repository-practice` (sections 9 to 14), `tools/oxlint/HABITS.md` | `bun run gate`, `preflight.ts` |

Execute skill scripts via `bun .claude/skills/<skill>/scripts/<name>.ts`. Current metrics and milestones live in `docs/plan.md`; `docs/v1.md`, `docs/transfer.md` and `studies/` preserve the v1 empirical record; `tools/runtime/moments.ts` surfaces domain-specific invariants whenever a tool call enters a governed area.

**How to approach a task.** Carry a request's objective as far as your authority permits, through verification and delivery.

1. **Repair the owning design rather than the isolated symptom.** Refactor or rewrite the module whose structure permitted the defect when you cleanly own the boundary or during consolidation; weigh rebase blast radius when many open pull requests sit above you, and apply a local patch when the structural fix awaits an operator decision under section 3.
2. **Replay before altering any decision rule.** Before modifying logic that governs admission, task sampling, scoring, practice release or stopping, replay the proposed rule over `data/runs/` (`promotion-tuner`, `system-path-simulation`) and report every historical decision that flips. A single recent run is an anecdote; the archive is the empirical denominator.
3. **Subtract before adding.** Locate existing code that already covers the concern (rule 12) and test whether an unnecessary seam can be collapsed or removed before introducing a new flag, guard, branch, helper or prompt paragraph.
4. **Verify every claim at the primary source.** Assert nothing about the source tree, a campaign run, the remote repository or the clock unless you have just read it directly; any summary, including your own, is only a lead. Correct inaccurate descriptions in the change that uncovers them, and retract any inaccurate statement to whoever received it.
5. **Stress-test your own change.** Before finishing, check the strongest objection to the change, what evidence would refute it, and what test or check fails beforehand and passes afterwards.

Resolve routine ambiguity by adopting the most defensible interpretation and stating what evidence would overturn it. Pause to ask only for missing permissions or a section 3 decision, presenting your analysis and recommendation alongside the question, and answer every question asked. Launch the longest-running independent task first. A standalone audit, review or plan remains strictly read-only. Report the evidence rung achieved (section 9) and enumerate what remains open. Backlog items belong in a single file, `docs/backlog/<subject>.md`, stating the intended changes followed by their history in the operator's words.

**Operator infrastructure** (hosts, logins, accounts, scheduled jobs and concurrency caps) is documented in the operator's `CLAUDE.md`, which takes precedence on those machines. Keep its contents, including full run names, out of every tracked file, commit message and pull request.

## 1. What Anabasis does

Given a user query defining a technical domain, a campaign constructs a **Built Harness** (a harness): the operating guide and domain-specific tooling used by a fixed **solver** model across tasks in that domain. Holding the solver model constant isolates the causal effect of the harness itself. Every mechanism in the repository serves a single experimental question:

> Is the candidate harness better than the reference harness, for this solver, on held-out tasks that neither was built on?

A controlled paired comparison answers this question (section 7). Both harnesses solve the same held-out evaluation tasks afresh under experimental conditions logged in advance; an isolated verification program determines validity; the Referee adjudicates each reproducible rejection; and a one-sided paired sign-flip test over per-task scores registers either a **step** or no statistically significant effect. A step promotes the candidate harness to become the new reference. Whether a cheaper solver equipped with a Built Harness matches a more expensive bare solver is evaluated separately (`compare-systems`).

### The four reported factors

Every change names the factor it targets and the empirical count demonstrating its effect; current values are tracked in `docs/plan.md`.

- **Supply** (the precondition for learning): does the evaluation set provide an informative gradient? Only a task on which the two arms can diverge is informative (`informative`, `src/kernel/compare.ts`). Because informativeness is observable only after solving, admission tracks frontier tasks that the reference harness has not yet closed (`comparisonFloor`).
- **1. Climb**: promotions achieved within a single campaign (`src/campaign/climb.ts`), each confirmed when the epoch's first starter comparison places the reference harness above the starter (`confirmed`). The milestone of six confirmed promotions in one campaign, replicated in a second domain, is purely observational; no prompt or tool exposes a target count.
- **2. Honesty**: could an observed gain be statistical noise? An A/A control (evaluating the reference harness against itself) runs alongside every comparison to measure the empirical false-positive rate; the bar is zero A/A steps across the ten comparisons following the six promotions (`falseRate`, `barLines`).
- **3. Verdicts**: are verification labels trustworthy? Every Referee ruling carries supporting evidence; the bar, measured against at least 30 blind operator labels, is detecting at least three in four check defects while voiding at most one in ten earned rejections (`clears`, `src/referee/agreement.ts`).
- **4. Economy**: list-price spend in dollars and wall-clock hours per promotion (`tools/d2/close.ts`, `billOf`, `BARS`).

### Trade-offs to keep in view

The recurrent structural trade-offs when modifying the system are summarised below; additional trade-offs are documented in `design-and-seats`.

- **Objective signal against variance**: once validity saturates, the noisier objective metric governs the comparison. Always report which measure carried a step, and inspect the starter's own A/A noise floor alongside a reference that ties itself. Raising the gap floor merely shifts margin noise while starving task supply.
- **Promotion against confirmation**: the starter comparison owed after a promotion executes at the Builder's next `compare` (`heldSince`). Allowing a Builder comparison to read ahead of it leaves the promotion permanently unconfirmed (`test/decide-explore.test.ts`).
- **Practice exposure against held-out supply**: releasing practice tasks consumes at most half of the held-out pool. Monitor the frontier near the comparison floor, and treat practice gains that fail to transfer to held-out comparisons as overfitting.
- **Gate strictness against model capability**: refuse only actions that compromise measurement validity or guarantee wasted compute. Pass all other observations to the seat as factual notes, since overly aggressive refusals can stall a campaign before it produces a single comparison.
- **External benchmarks against test-set fitting**: an external benchmark measures out-of-distribution transfer rather than gating promotions, and the campaign query preserves the domain's natural scope rather than mirroring a benchmark's specific tasks or professions.

### Two sides and one wall

Practice tasks constitute the Builder's training set, and held-out tasks constitute its test set. Any leakage of held-out content or per-task outcomes permits test-set overfitting; accordingly, practice outcomes guide harness iteration and never measure improvement. The evaluation boundary (the wall) is deliberately asymmetric. The Examiner may inspect reference outcomes and each task's winning harness, whereas only five categories of information cross to the build side:

- the contract's public rules, scope, conventions, answer format and any declared objective (its measured quantity and optimisation direction);
- the public specification of each released (practice) task;
- for a practice solve: its outcome and kind, the solver's trajectory and, under a declared objective, the verifier's measure of a valid answer and of the task author's best recorded answer (which may depend on that task's hidden values);
- for each comparison: the aggregate tally and statistical reading, without naming any task;
- host resource limits, remaining compute budget and the counts of held-out and practice tasks.

Nothing else crosses the wall: no held-out task text or trajectory, no check source, no hidden values, no list of refusing checks, no Referee rationale and no move-table recommendation. The wall is a strict correctness invariant verified byte for byte (rule 3).

## 2. The stance: code owns the conditions, models own the content

Deterministic code governs the experimental protocol and evaluation conditions: which move may begin, every refusal and resource limit, solve conditions, validity checks, statistical comparisons, the evaluation boundary, the dollar cap and the append-only log. Models govern the content: the harness, task solutions, exam tasks, rejection adjudication, failure diagnosis on practice solves and the next engineering hypothesis. Code handles everything a model cannot observe, everything constraining the model itself and every variable that must remain invariant across both arms of a comparison.

1. **Supply models with facts instead of directives.** When prescribed a course of action, a model tends to follow the directive even when empirical evidence contradicts it.
2. **Supply authors with facts instead of numerical targets.** The Examiner never receives a target count or pass rate to hit.
3. **Keep the Builder unconstrained**, subject to a single invariant: no part of a harness may name a specific task, copy its text or embed its answer.
4. **Code validates declared structure and never selects content.**
5. **A model reply never sets a score, limit or identity.** Wherever a reply informs a decision, code defines the exact evidence it must carry.
6. **When in doubt, permit the full workspace.** Isolation boundaries protect only hidden values, credentials and each seat's private files (`SolveDirs`, `src/tools/command.ts`).
7. **Prefer the simplest design that captures most of the effect**, without compromising measurement honesty.

## 3. The seats

Each seat holds a single responsibility behind a closed information boundary:

- **Examiner** (model, `src/examiner/`): drafts the exam specification from the domain prompt and authors tasks. The host gate validates each task's structure and rejects planted answers without solving tasks at admission (`propose_tasks`). The Examiner reads a restricted log projection (`src/examiner/record.ts`) containing reference outcomes and each task's winning harness, without targets or harness names.
- **Builder** (model, `src/builder/`): edits `harness/`, chooses campaign moves and freezes candidate harnesses, observing only the items permitted in section 1, its own notes and previously kept harnesses.
- **Solver** (model, `src/solver/`): answers a single task using `read`, `bash`, `edit`, `write`, `submit` and the harness's installed programs.
- **Verifier** (code, `src/kernel/verify.ts`): executes every check inside a fresh, offline isolated sandbox.
- **Referee** (model, `src/referee/referee.ts`): adjudicates each rejection that reproduces on host replay (never passes, truncated solves or crashes) as `earned`, `check-defect` or `unclear`, seeing only the exam side.
- **Host** (code): everything assigned to code under section 2.

A **harness** is a directory (`agent/tools-spec.json`, `.toolchain/` and the operating guide `agent/BUILT_AGENTS.md`) uniquely addressed by its content digest. The **Starter Built Harness** (`src/harness/starter.ts`), pi's coding agent as released with its four standard tools, serves as the initial reference and fixed baseline. The **Starter** (or **bareSolver**) denotes the solver running under this baseline; the **Starter Pack** is the Starter Built Harness plus `HARNESS.md`, from which every campaign opens; a **builtSolver** denotes the solver running under a Builder-authored harness. Because every solve executes inside a harness, never describe experimental arms as "with or without a harness".

### What waits for the operator

Seven decisions require explicit operator authority:

- freezing or rejecting the contract and check program, and admitting an authored check (`tools/c/accept.ts --freeze`, `--admit`);
- blind labelling of sampled rejections;
- setting the dollar cap and selecting which account pays;
- declaring an unsolved task infeasible;
- manually promoting a harness (`tools/d2/promote.ts --harness <digest> --yes`; overriding the decision rule requires `--despite`);
- changing what a solver receives or is instructed with: the starter harness, the shell environment or campaign limits;
- stopping a live run.

When requesting a decision, present the supporting evidence and a clear recommendation, and proceed with any independent work meanwhile. Operator authorisation persists until withdrawn and covers only what it explicitly names: "keep going" authorises none of the seven decisions above, whereas authorisation opening a cycle covers its runs, scheduled pauses and stack patches (section 10). The implicit grants of a campaign launch are detailed in `design-and-seats`. Host messages refer to "a person" solely for one of these seven decisions.

## 4. The Harness Builder

A single Builder conversation orchestrates the campaign (`tools/d2/harness-builder.ts`) through `examine`, `compare`, `campaign_status` and `wait`. Alongside it, a single Examiner conversation remains dormant between requests; each `examine` wakes it, even across promotions, and it terminates when the Builder conversation closes (`tools/d2/campaign-actions.ts`). Host code enforces stopping criteria, releases practice tasks and promotes any harness registering a step. The Builder chooses its own moves and never sees the decision table's recommendation (`src/campaign/decide.ts`). Three invariants apply:

- every comparison evaluates the exact harness it froze, and a step promotes that exact digest;
- an unchanged harness is re-compared only when the move table explicitly calls for it, because repeated draws inflate the false-positive rate;
- any action refused before execution does not count as a move.

Standing facts are embedded in every tool result because out-of-band messages between tool turns never reach the Builder.

## 5. The log

A campaign's authoritative record is a single append-only, fsynced JSONL file, `.ana/d2/<name>/log.jsonl` (`src/kernel/log.ts`). Every derived state and report is a pure fold over this log. A **condition** (`src/kernel/condition.ts`) specifies every host-controlled parameter of a solve; two solves are comparable only when their conditions differ solely in the single variable under test.

1. **Maintain no second store.** Persist any fact needed later as a log event.
2. **Maintain no second reader for the same fact.** Locate the owning fold and call it directly.
3. **Never edit a log or hand-author an event.** Move, copy or remove campaigns exclusively via `bun run runs copy`, `move` or `retire`; only `retire` deletes a campaign.
4. **Preserve backwards readability of historical event kinds** (`EVENT_KINDS`).

Because the log stores hidden exam values, it must never enter prompts, pull requests or pasted transcripts. A campaign copied onto another host retains its log and kept harnesses without seat-installed binaries; copied campaigns are therefore strictly read-only and never executed.

## 6. A campaign's commands

`bun tools/d2/harness-builder.ts` opens a campaign from a prompt or a stored pack and runs unattended until it reaches one of seven terminal states: `budget`, `stop`, `exam`, `no-room`, `environment`, `operator` or `finished` (three consecutive Builder conversations without a campaign move). The operator steers a live campaign through `tools/d2/word.ts`, which no seat can read. The campaign configuration locks the solver, resource limits, `--target` and `--solves`; conflicting flags are refused. Practice tasks are released exclusively from reference solves, consuming at most half of the held-out pool while preserving the comparison floor of frontier tasks (`practiceDue`).

**Move refusals.** Moves are gated by comparison admission (`src/campaign/admission.ts`), session admission and the stopping rule, which only `--past-stop "<why>"` overrides. A command appends nothing to the log prior to a final refusal, with one exception: the harness checkpoint frozen by the Builder's `compare` to request evaluation (`build.checkpoint`).

**Defaults** reside in a single authoritative location each rather than being duplicated in documentation: comparison size (`SIZE`, `src/kernel/size.ts`), stopping patience (`PATIENCE`, `src/kernel/reports.ts`), gap floor and scoring weights (`GAP_FLOOR`, `WEIGHTS`, `src/kernel/compare.ts`), solve limits (`LIMITS`, `tools/d2/campaign.ts`), and significance level, reserve and Builder session parameters in the flag table of `tools/d2/campaign-terms.ts`.

## 7. How a comparison is read

A comparison logs its experimental terms before solving begins, evaluates both harnesses afresh on the same sampled tasks, and pairs every rollout on one arm with every rollout on the other. Task sampling draws from the newest epoch first, mixing one retained task per three frontier tasks to detect regressions.

**Outcomes** (`src/kernel/solve.ts`): a pass is a valid answer; an earned rejection, limit expiry, `no-answer`, `broken-harness` or `malformed` termination counts as a failure for that arm; an unruled, `check-defect` or `unclear` rejection sets the task aside; a `provider`, `sandbox-crash`, `killed`, `moved-files`, `check` or `verifier` termination is a non-result, which is retried and excluded from pairing.

**Scoring and statistical test.** Each per-task score weights validity first, applying the declared objective solely to break ties between two valid answers (`pointsOf`, `WEIGHTS`); compute cost never enters the score. An exact one-sided paired sign-flip test over nonzero task scores registers a step at the configured significance level. Possible readings are `step`, `no-step` (tested with no significant effect), `not-scored` (no testable tasks), `check-defects` and `no-change`. The next recommended move is computed by `decide` (`src/campaign/decide.ts`), and six eligible moves without a gain trigger the stopping rule (`stopRule`).

## 8. Rules

1. **Only the held-out comparison decides**: never a practice outcome, an agent's account, a code review or a unit test suite.
2. **Only the Examiner authors the exam, and no one coaches it.** Neither humans nor agents author or patch domain rules, checks or tasks, nor hand-edit packs, check programs, kept harnesses or logs to force a command to pass. Repair cross-domain defects in the host, prompts or contract machinery instead.
3. **Nothing crosses the evaluation wall except the items enumerated in section 1.** Perturbing a hidden value, a check implementation or which held-out task a candidate won must leave every Builder and solver message byte-identical apart from the remaining budget (`test/builder.test.ts`, `test/builder-led.test.ts`, `test/wall-practice.test.ts`). This invariant spans prompts, tool descriptions, tool results, home-directory files and practice-task selection; any pull request touching those surfaces must document how it verified the wall.
4. **Experimental terms are pre-registered before the first solve and never altered post hoc.** Do not top up a task set thinned by check disputes, and do not re-run a completed comparison under altered terms.
5. **Both arms are solved afresh under identical conditions.** No cached or historical solve may stand in for either arm.
6. **A single rollout is weak evidence.** A result counts only when backed by repeated solves, and any single solve surfaced to an agent must be labelled as such.
7. **A non-result is neither a pass nor a fail.** It is retried and excluded from all denominators.
8. **A rejection counts only once adjudicated, and a blind operator label overrides a Referee ruling.**
9. **No reference answers, no stronger solver and no answer-finding agent.** A check verifies a domain property; a parameter from which a task was generated is a fact of the task rather than an answer.
10. **No agent authors a measurement instrument.** Check facts come from the domain's pinned tool; any check relying on its author's own computation is treated as a fault until explicitly admitted by the operator (`--admit`, or `--admit-authored` at launch).
11. **The host owns every resource limit.** Any file requesting additional time, turns or disk space has no effect.
12. **One owner per decision and one reader per fact.** Whenever two locations decide the same question, identify both and remove one.
13. **Introduce machinery only on empirical evidence, preferring simplification over accretion**: `owner → live reader → decision it changes → evidence → hostile test`. Prefer deleting a seam or widening an existing owner over adding a branch, option or prompt paragraph. A new diagnostic reading reports only until an archive replay establishes which recorded decisions it would alter. Every superseding change deletes what it replaces or explicitly lists remaining readers under "Not done", and any substantial addition (more than ~50 production lines) notes why no existing surface could be simplified instead.
14. **Stop when nothing can be learned.** Refuse any launch unable to yield a valid reading before spending compute, and do not re-evaluate a dead provider merely because budget remains.
15. **Credit and session limits are expected operating conditions rather than defects.** Resume from the log at the run's own commit once quota recovers or under another login, and do not patch, triage or report such terminations as failures. Investigate only 429 responses, timeouts or crashes that do not name a limit.

## 9. Status, evidence and claims

Read `attribution-and-proof` before claiming any improvement. Replace vague status labels such as "built" or "done" with the exact rung of the evidence ladder, without allowing a lower rung to substitute for a higher one: planned; present in source (with commit and live reader); proved without a model (bounded check, property test, replay or rehearsal); exercised live (an event in a real run's log); shown in an outcome (a metric that moved, replicated on fresh solves); or withdrawn (with rationale). Current levels are tracked in `docs/plan.md`.

```text
events in a campaign's log  >  a fold over the log  >  source and tests  >  a command's printed line
                            >  a pull request's text  >  an agent's account
```

This evidentiary hierarchy governs both citations and assertions: your own conclusion, a proposed causal explanation and a subagent report all sit at the lowest rung ("an agent's account") until grounded in higher evidence. Compute every count through its owning fold, and frame causal explanations as falsifiable hypotheses paired with the count that would refute them. A unit test or rehearsal verifies code-path execution rather than model improvement, and a test suite on one operating system proves nothing about another operating system's isolation wall. A live run is evidence solely about the exact code it executed (`bun run runs source --has <text>`). Before asserting that a symbol or mechanism is absent, inspect both the symbol and its callers.

| Claim | Required evidence |
| --- | --- |
| A step | A comparison reading `step`, cited with its condition; unqualified only once confirmed by a subsequent fresh reading |
| No step | The same, accompanied by sample size; this never establishes equivalence |
| A mechanism | Its event recorded in a live run's log where its trigger occurred |
| A refusal | The refusal text, which proves only its own trigger condition |
| Attribution to part of a harness | An ablation comparison against `programs-of:<digest>` |

Keep distinct counts separate, report every rate with its denominator, and never treat a direct comparison between two isolated campaigns or settings as proof of gain. Longitudinal progress is assessed between groups of fresh runs, comparing the between-group difference against inter-run variance (`promotion-tuner`, `scripts/trend.ts`).

## 10. Runs with a real model

Live model runs spend operator budget and require explicit authorisation for the named runs. Every seat executes inside Seatbelt or Bubblewrap; an unavailable isolation wall yields a typed non-result rather than unconfined execution. Operational procedures live in skills, spanning `run-improvement-campaign`, `run-management` and `whole-run-investigation`; `bun run runs` enumerates available commands.

1. **The worktree is the experimental condition.** Launch each run from its own clean worktree at a published commit (`runs fresh`) and leave its `src/` untouched while active; paid seats refuse the main checkout or any tree containing `ana-followed` (`treeFault`).
2. **Verify the execution path without a model first** (`--dry-run`, `runs replay`, `runs rehearse`).
3. **Pre-register one falsifiable prediction before the first solve**, settled by an empirical count that can move in either direction.
4. **Run at most one or two rounds concurrently per host**, because host load confounds wall-clock deadlines; `runs fresh` without `--host` assigns placement by login utilisation and host load (`leastOccupied`).
5. **Never open, print or copy the file passed to `--env-file`.**
6. **Never stop a live run to patch it.** Place the fix on the pull request stack so it enters the next batch of fresh runs.
7. **Inspect log events and generated reports before reading any agent prose**, including your own earlier notes.
8. **Report every started attempt as spent compute.**
9. **A measured run opens a fresh project and climbs independently** from a prompt at a single commit; promotions inherited from a seed, fork, pack or different commit do not count.

**Cross-domain generalisation and external transfer.** Track improvements across both a primary domain and a control domain (active domains, baselines and external transfer benchmarks such as JobBench are maintained in `docs/plan.md` and `run-improvement-campaign`, "The outside aim"). An improvement holding across domains plausibly generalises; trace any cross-domain regression to its introducing change and repair it. When reading an external benchmark, check experimental conditions before attributing deficits to the harness, and treat differences within the Starter's rollout variance as noise.

**Autonomous cycle operations.** Within an authorised cycle, pause a live run reaching its trigger once its active comparison completes, investigate it, place the fix on the stack and fork fresh runs at the stack head within the cycle's grants, without blocking on unnecessary confirmation. All other stops, section 3 decisions and merges remain strictly with the operator. React to events (`runs alerts`, `runs pulse`) rather than polling on a clock.

## 11. Working in the repository

Use the Bun version pinned in `package.json` instead of Node, npm or npx, and keep git hooks enabled. Run owning tests via `bun run test -- <paths>` during iteration and `bun run gate` once at the top of the change; the check runner distributes execution across the fleet (`local-checks`), while GitHub Actions runs only `ci.yml`.

### What you never touch

Never modify `.ana/` (apart from `.ana/wri/`, where investigations and cycles store their own artefacts), `data/runs/`, packs, check programs, kept harnesses, `.env`, credentials or installed dependencies. Modifications to `vendor/` obey strict provenance: upstream code is copied verbatim, its source path and commit are cited, and every local edit is documented.

### The stack and pull requests

Pull requests are stacked, and every release lands an entire chain: a **small** release (`0.x.y+1`) for any chain passing automated proof, and a **big** release (`0.x+1.0`) only when a mechanism has been exercised live at the stack head and a reported factor has shifted relative to the previous big release's runs by more than the inter-run spread. Determine run comparability from each run's commit (`bun run runs source`) rather than from version numbers.

Follow `stack-pr` for the full branching, restacking, linking and landing procedure, and inspect the current stack (`bun .claude/skills/stack-pr/scripts/stack.ts`) before branching and before pushing. The core invariants are:

- extend the existing open pull request that owns a problem, or stack a new draft pull request on top and bind it into GitHub's native stack with `bun run land -- <new top> --sanitize` (using `--from <pull request>` requires operator authorisation);
- keep one worktree per pull request, avoid manual `git stash`, and ensure every commit passes checks independently;
- never modify another session's pull request, worktree or run without operator authorisation, apart from replaying its commits unchanged above yours when restacking;
- push only your authorised branch (`--force-with-lease` when rewriting history), verify the remote state before reporting completion, and leave merging to the operator.

Assign each pull request a category (`CATEGORIES`, `tools/runtime/land.ts`) and the highest matching importance label (breaking ties upward):

- `I0`: results are already invalid or unsafe (erroneous statistical reading or promotion, evaluation wall breached, answers lost, credentials exposed, spend exceeding cap or `main` failing its gate); live runs should pause until resolved. Roughly one pull request in 50.
- `I1`: fixes a defect in what a campaign decides, measures or exposes to a seat (admission, practice release, supply, task sampling, climb, comparison, Referee or wall); protects validity before corruption occurs; prevents a crash, stall, lost session, wasted compute or unrecovered failure; or removes an entire mechanism.
- `I2`: any other modification to production code, prompts or run and landing tooling, including code-removing simplifications.
- `I3`: reporting, wording, comments, documentation, skill prose or tests alone.

**Shell commands.** A command guard inspects every shell invocation before execution: write plain commands, follow the phrasing indicated by any refusal (`repository-practice`, "Commands a guard reads"), edit files through the editing tools and run multi-line scripts from files. Move unwanted files to the Trash by explicit path instead of calling `rm -r`; leave branches, shell profiles, SSH configuration and environment files untouched.

### Reviews and subagents

When delegating to a subagent (where permitted by operator configuration), assign one bounded task specifying authority, paths, revision, known facts, the exact question and read-only status. Supply reviewers with source code rather than pre-formed conclusions, hold findings to exact counts with denominators and `file:symbol` citations, and keep decisions reconciling competing invariants in the primary session. Treat every subagent report as an agent's account (section 9): verify each finding at the source and classify it as confirmed (with events), plausible (stating what settles it) or refuted.

## 12. Code that passes the first time

Read `tools/oxlint/HABITS.md` before writing code. Introduce no strict-lint findings and never disable a rule (record a single-site false positive via `bun run not-slop`; treat a systematic false positive as a rule defect). Production code imports `node:` modules exclusively through `src/meta`, keeps files within 800 nonblank lines and functions within 115 lines, and exports only symbols imported elsewhere.

### Tests

Match the test style to the code under test. For pure kernel and decision logic, prefer property-oriented checks that cover an input space over isolated examples: exhaustive enumeration up to a small bound (`test/compare-exhaustive.test.ts`), state-space search over reachable states (`test/decide-explore.test.ts`) or seeded generative tests tracking branch coverage (`test/pairs-property.test.ts`). Use clear, named regression tests for concrete failure modes from real runs, process/filesystem/provider boundaries and hostile refusal cases. Pin each measured protocol constant (`WEIGHTS`, `GAP_FLOOR`, `SIZE`, `PATIENCE`) once. Before deleting or replacing an existing test, check mechanical mutants of its owner (commit-r, step 8) and restore or justify any missed mutant. Keep bounded checks within roughly ten seconds on a single host by exploiting symmetry before shrinking bounds, and assert observable behaviour through live code paths rather than prose phrasing. A check counts only after running across the complete change with its exit code inspected directly (never masked by a pipe); a failure passing in isolation is a diagnostic lead, and a wall test failing from missing user namespaces is a real failure.

### Where a reader or helper lives

Search the codebase by behaviour rather than symbol name, and collapse duplicate surfaces into their single owner (rule 12). Delete any guard, timer or recurring check that never fires or costs more than the defect it prevents. Place remaining helpers according to the first matching row:

| Consumer | Location |
| --- | --- |
| A campaign, a `bun run` verb, a local job or the UI | Production: a fold in `src/` (one reader per fact, section 5), or the command's folder under `tools/` |
| An in-depth single-campaign log investigation reached through `wri.ts` | `tools/wri/` |
| Scripts of two or more skills, or cross-campaign analysis | `.claude/skills/main/`, a shared library with no standalone command (`cli.ts`, `logs.ts`, `runs.ts`, `print.ts`, `stats.ts`) |
| A single skill's procedure | That skill's `scripts/` directory |

Helper layers may import production code, never the reverse (`direction.ts`), and must read every fact through its owning production fold. Whenever production lacks a required fold, move that fold into production.

## 13. Writing

Write clearly and concisely, stating both what a mechanism does and why it exists.

- Report exact figures with their measured axis, keeping tests, observations and estimates distinct.
- Use section 14's canonical terms consistently, and format identifiers and paths in inline backticks.
- State each fact once in a prompt, tuning prompts by rewriting existing sentences instead of appending paragraphs; fix recurring interface failures in the underlying tool.
- Document current behaviour in skills and in this file, keeping defaults in code and historical rationale in commits, pull requests, the backlog or head comments.

## 14. Terms and map

A **held-out task** is scored in comparisons and never exposed to the Builder; a **practice task** is released to the Builder for development and never scored; a **valid answer** passes every check within host limits; the **reference harness** is the starter until a candidate step is promoted; a **round** comprises a Builder session followed by a comparison. The complete glossary lives in `repository-practice`, section 14 (`terms-and-map.md`).

```text
src/meta     runtime owners       src/kernel   log, conditions, verifier, comparison, reports
src/wall     the OS wall          src/agent    one model session      src/tools  shared tools
src/harness  the Built Harness    src/solver   one solve              src/builder, examiner, referee
src/campaign round, admission, decide, opening, words
tools/d2     campaign commands    tools/runs   run registry           tools/wri  run investigation
tools/runtime  lint, test, gate, land, moments  packages/ui  read-only log page  vendor  copied
.claude/skills  the procedures and their scripts  .claude/skills/main  the scripts' shared library
```

# AGENTS.md

Every coding agent loads this file for the system invariants and repository map. Detailed mechanisms live in four skills numbered to match these sections; read the owning skill before modifying a mechanism or answering questions about it.

| Task touches | Read first | Prove with |
| --- | --- | --- |
| seats, prompts, the wall, the starter | `design-and-seats` (1 to 3) | `seat-view.ts` and the wall tests it names |
| the campaign loop, admission, practice, endings | `campaign-mechanics` (4 to 6) | `bun run runs replay`, `runs rehearse` |
| readings, scores, the draw, A/A, `decide` | `comparison-reading` (7, 8) | `promotion-tuner` replay over the archive |
| commits, PRs, checks, claims, writing | `repository-practice` (9 to 14), `tools/oxlint/HABITS.md` | `bun run gate`, `preflight.ts` |

Skill scripts run via `bun .claude/skills/<skill>/scripts/<name>.ts`. Current status lives in `docs/plan.md`; `docs/v1.md`, `docs/transfer.md` and `studies/` hold the v1 record; `tools/runtime/moments.ts` surfaces an area's invariants whenever a tool call enters it.

**How to approach a task.** Carry a request's objective as far as your authority permits, through verification and delivery.

1. **Fix the underlying design rather than the isolated instance.** Repair or rewrite the owning module whose structure allowed the defect; apply a local patch only when the broader fix awaits an operator decision under section 3.
2. **Replay before changing a decision rule.** Before modifying any rule that governs decisions (admission, task sampling, scoring, practice release or stopping), replay the proposed change over `data/runs/` (`promotion-tuner`, `system-path-simulation`) and report which recorded decisions flip. A single recent run is an anecdote; the archive is the proper denominator.
3. **Subtract before adding.** Locate existing code that already handles the concern (rule 12) and attempt to delete or collapse an unnecessary seam before introducing a new flag, guard, branch, helper or prompt paragraph.
4. **Verify claims at the source.** State nothing about the source tree, a campaign run, the remote repository or the clock unless you have just read it directly; any summary, including your own, is only a lead. Correct inaccurate descriptions in the change that uncovers them, and correct any inaccurate statement to whoever received it.
5. **Review your own work adversarially.** State the strongest objection to the change, the empirical count that would refute it, and the test or mutant that fails before the change and passes afterwards.

Resolve routine ambiguity by adopting the most reasonable interpretation and stating what evidence would overturn it. Ask only for missing permissions or a section 3 decision, with the analysis and recommendation ready, and answer every question asked. Start the longest-running independent task first. An audit, review or plan requested on its own remains read-only. Report the evidence rung reached (section 9) and enumerate what remains. Backlog work belongs in a single file, `docs/backlog/<subject>.md`, containing the intended changes followed by their history in the operator's words.

**The operator's infrastructure** (hosts, logins, accounts, jobs and caps) is documented in the operator's `CLAUDE.md`, which takes precedence there. Its contents, including full run names, stay out of every tracked file, commit message and pull request.

## 1. What Anabasis does

A user query specifies a technical domain, and a campaign constructs a **Built Harness** (a harness) for it: the operating guide and domain-specific programs used by a fixed **solver** model on tasks in that domain. Holding the solver model constant isolates the causal effect of the harness. Every mechanism in the repository serves a single evaluation question:

> Is the candidate harness better than the reference harness, for this solver, on held-out tasks that neither was built on?

A controlled comparison answers this question (section 7): both harnesses solve the same held-out evaluation tasks afresh under conditions logged in advance, a hidden verification program decides validity, the Referee rules on each rejection, and a one-sided paired sign-flip test over per-task scores registers either a **step** or no effect. A step promotes the candidate harness to become the new reference. Whether a cheaper solver equipped with a Built Harness matches a more expensive bare solver is evaluated separately (`compare-systems`).

### The four reported factors

Each change states which factor it targets and the empirical count that demonstrates the effect; `docs/plan.md` tracks the current values.

- **Supply**, the precondition for learning: does the evaluation set provide gradient? Only an informative task can register a difference between candidate and reference (`informative`, `src/kernel/compare.ts`). Because informativeness is known only after solving, admission counts frontier tasks that the reference harness has not yet closed (`comparisonFloor`).
- **1. Climb**: promotions achieved within a single campaign (`src/campaign/climb.ts`), each confirmed when the epoch's first starter comparison places the reference harness above the starter (`confirmed`). The milestone of six confirmed promotions in one campaign, followed by a second domain, is purely observational; no prompt or tool exposes a target count.
- **2. Honesty**: could an observed gain be statistical noise? An A/A control (the reference harness evaluated against itself) runs alongside every comparison to measure the empirical false positive rate; the bar is zero A/A steps in the ten comparisons following the six promotions (`falseRate`, `barLines`).
- **3. Verdicts**: are the verification labels accurate? Every Referee ruling carries supporting evidence; the bar, measured on at least 30 blind operator labels, is catching at least three in four check defects while voiding at most one in ten earned rejections (`clears`, `src/referee/agreement.ts`).
- **4. Economy**: dollars and wall-clock hours per promotion at list price (`tools/d2/close.ts`, `billOf`, `BARS`).

### Trade-offs to keep in view

The most frequent failure modes when modifying the system are listed below; further trade-offs are documented in `design-and-seats`.

- **Objective signal against variance**: once validity saturates, the noisier objective metric governs the comparison. Always report which measure carried a step, and inspect the starter's own A/A noise floor alongside a reference that ties itself. Raising the gap floor merely shifts margin noise while starving task supply.
- **Promotion against confirmation**: the starter comparison owed after a promotion executes at the Builder's next `compare` (`heldSince`). Allowing a Builder comparison to read first leaves the promotion permanently unconfirmed (`test/decide-explore.test.ts`).
- **Practice exposure against held-out supply**: releasing practice tasks consumes at most half of the held-out pool, so monitor the frontier near the comparison floor and treat practice improvements that fail to transfer to held-out comparisons as overfitting.
- **Gate strictness against model capability**: refuse only actions that compromise measurement honesty or guarantee wasted compute; pass all other observations to the seat as factual notes, because an overzealous refusal can terminate a campaign without a single comparison.
- **External benchmarks against test-set fitting**: an external benchmark measures transfer rather than gating a promotion step, and the campaign query preserves the domain's natural scope rather than mirroring a benchmark's tasks or professions.

### Two sides and one wall

Practice tasks constitute the Builder's training set, and held-out tasks constitute its test set. Leaking held-out content or per-task outcomes would allow the Builder to overfit the test set; accordingly, practice results guide harness development and never measure improvement. The evaluation boundary (the wall) is asymmetric: the Examiner may read reference outcomes and each task's winning harness, whereas only the following information crosses to the build side:

- the contract's public rules, scope and conventions, the answer format and any declared objective (its quantity and optimisation direction);
- the public portion of each released (practice) task;
- for a practice solve: its outcome and kind, the solver's trajectory and, under an objective, a coarse band of how far a valid answer's measure stands from the task author's best answer on record (which may depend on that task's hidden values), and neither number;
- for each comparison: the aggregate tally and statistical reading, without naming any task;
- host resource limits, remaining compute budget and the counts of held-out and practice tasks.

Nothing else crosses the wall: no held-out task text or trajectory, no check source, no hidden values, no list of refusing checks, no Referee rationale and no move-table choice. The wall is a strict correctness property verified byte for byte (rule 3).

## 2. The stance: code owns the conditions, models own the content

Code controls the experimental protocol and evaluation conditions: which move may begin, every refusal and resource limit, solve conditions, validity checks, statistical comparisons, the evaluation boundary, the dollar cap and the append-only log. Models control the content: the harness, task solutions, exam tasks, whether a rejection was valid, why a practice solve failed and what to change next. Code handles anything a model cannot observe, anything governing the model itself and anything that must remain identical across both arms of a comparison.

1. **Supply models with facts rather than directives**; when instructed on a course of action, a model tends to follow the directive over the empirical evidence.
2. **Supply authors with facts instead of numerical targets**: the Examiner never receives a target count or pass rate to hit.
3. **Keep the Builder unconstrained**, subject to one invariant: no part of a harness may name a specific task, copy its text or embed its answer.
4. **Code validates declared structure and never selects content.**
5. **A model reply never sets a score, limit or identity**; wherever a reply informs a decision, code specifies the exact evidence it must carry.
6. **When in doubt, permit the full workspace.** Isolation walls protect only hidden values, credentials and each seat's own files (`SolveDirs`, `src/tools/command.ts`).
7. **Prefer the simplest path that captures most of the effect**, without compromising measurement honesty.

## 3. The seats

Each seat has a single responsibility and a closed information boundary:

- **Examiner** (model, `src/examiner/`): drafts the exam specification from the domain prompt and authors tasks. The host gate validates each task's structure and rejects any task containing a planted answer, without solving tasks at admission (`propose_tasks`). The Examiner reads a restricted view of the log (`src/examiner/record.ts`) showing reference outcomes and each task's winning harness, without targets or harness names.
- **Builder** (model, `src/builder/`): edits `harness/`, selects campaign moves and freezes candidate harnesses, reading only the information listed in section 1, its own notes and previously kept harnesses.
- **Solver** (model, `src/solver/`): answers a single task using `read`, `bash`, `edit`, `write`, `submit` and the harness's installed programs.
- **Verifier** (code, `src/kernel/verify.ts`): executes each check in a fresh isolated sandbox, completely offline.
- **Referee** (model, `src/referee/referee.ts`): rules on each rejection that reproduces on host replay (never on passes, truncated solves or crashes) as `earned`, `check-defect` or `unclear`, seeing only the exam side.
- **Host** (code): everything assigned to code under section 2.

A **harness** is a directory (`agent/tools-spec.json`, `.toolchain/` and the operating guide `agent/BUILT_AGENTS.md`) uniquely identified by its content digest. The **Starter Built Harness** (`src/harness/starter.ts`), pi's coding agent as released with its four standard tools, serves as the initial reference and fixed baseline. The **Starter** (or **bareSolver**) denotes the solver running under this baseline; the **Starter Pack** is the Starter Built Harness plus `HARNESS.md`, from which every campaign starts; a **builtSolver** denotes the solver running under a Builder-authored harness. Because every solve runs inside a harness, never describe conditions as "with or without a harness".

### What waits for the operator

Seven decisions require explicit operator authority:

- freezing or rejecting the contract and check program, and admitting an authored check (`tools/c/accept.ts --freeze`, `--admit`);
- blind labelling of drawn rejections;
- setting the dollar cap and selecting which account pays;
- declaring that an unsolved task is infeasible;
- manually promoting a harness (`tools/d2/promote.ts --harness <digest> --yes`; overriding the decision rule requires `--despite`);
- changing what a solver is given or instructed with: the starter harness, the shell environment or campaign limits;
- stopping a live run.

When requesting a decision, present the supporting evidence and a clear recommendation, and continue any independent work in the meantime. An operator authorisation remains active until withdrawn and covers only what it explicitly names: "keep going" authorises none of the seven decisions above, whereas the authorisation that opens a cycle covers its runs, scheduled stops and stack patches (section 10). What a campaign launch grants by itself is detailed in `design-and-seats`. Host messages refer to "a person" only for one of these seven decisions.

## 4. The Harness Builder

A single Builder conversation drives the campaign (`tools/d2/harness-builder.ts`) using `examine`, `compare`, `campaign_status` and `wait`. Alongside it, a single Examiner conversation stays dormant between requests; each `examine` wakes it, even across promotions, and it closes when the Builder conversation ends (`tools/d2/campaign-actions.ts`). Host code enforces stopping conditions, releases practice tasks and promotes any harness that registers a step. The Builder chooses its own moves and never sees the decision table's recommendation (`src/campaign/decide.ts`). Three invariants hold:

- every comparison evaluates the exact harness it froze, and a step promotes that exact digest;
- an unchanged harness is re-compared only when the move table explicitly calls for it, because a second draw introduces a second opportunity for a false positive;
- any action refused before execution does not count as a move.

Standing facts are included in every tool result because out-of-band messages between tool turns never reach the Builder.

## 5. The log

A campaign's complete record is a single append-only, synced JSONL file, `.ana/d2/<name>/log.jsonl` (`src/kernel/log.ts`), and every derived state or report is a pure fold over this log. A **condition** (`src/kernel/condition.ts`) specifies every parameter fixed by the host for a solve; two solves are comparable only when their conditions differ solely in the single variable under test.

1. **Maintain no second store.** Any fact required later is recorded as a log event.
2. **Maintain no second reader for the same fact.** Locate the owning fold and call it.
3. **Never edit a log or hand-write an event.** Move, copy or delete campaigns exclusively via `bun run runs copy`, `move` or `retire`; only `retire` deletes a campaign.
4. **Preserve readability of historical event kinds** (`EVENT_KINDS`).

Because the log contains hidden exam values, it must never enter prompts, pull requests or pasted transcripts. A campaign copied onto another host retains its log and kept harnesses, without the binaries installed by seats, so copied campaigns are read-only and never executed.

## 6. A campaign's commands

`bun tools/d2/harness-builder.ts` opens a campaign from a prompt and runs unattended until it reaches one of seven endings: `budget`, `stop`, `exam`, `no-room`, `environment`, `operator` or `finished` (three consecutive Builder conversations without a campaign move). The operator steers a live campaign through `tools/d2/word.ts`, which no seat can read. The campaign setting locks the solver, its resource limits, `--target` and `--solves`; conflicting flags are refused. Practice tasks are released solely from reference solves, consuming at most half of the held-out pool while preserving the comparison floor of frontier tasks (`practiceDue`).

**Move refusals**: moves are gated by comparison admission (`src/campaign/admission.ts`), session admission and the stop rule, which only `--past-stop "<why>"` overrides. A command writes nothing to the log prior to its final refusal, except for the harness checkpoint that the Builder's `compare` freezes in order to request evaluation (`build.checkpoint`).

**Defaults** are defined in a single authoritative location each rather than duplicated here: comparison size (`SIZE`, `src/kernel/size.ts`), stopping patience (`PATIENCE`, `src/kernel/reports.ts`), gap floor and scoring weights (`GAP_FLOOR`, `WEIGHTS`, `src/kernel/compare.ts`), solve limits (`LIMITS`, `tools/d2/campaign.ts`), and significance level, reserve and Builder session parameters in the flag table of `tools/d2/campaign-terms.ts`.

## 7. How a comparison is read

A comparison logs its experimental terms before solving begins, evaluates both harnesses afresh on the same tasks, and pairs every rollout on one side with every rollout on the other. Task sampling draws from the newest epoch first, mixing one retained task per three frontier tasks in order to detect regressions.

**Outcomes** (`src/kernel/solve.ts`): a pass is a valid answer; an earned rejection, limit expiry, `no-answer`, `broken-harness` or `malformed` ending counts as a failure for that arm; an unruled, `check-defect` or `unclear` rejection sets the task aside; a `provider`, `sandbox-crash`, `killed`, `moved-files`, `check` or `verifier` ending is a non-result, which is retried and excluded from pairing.

**Scoring and statistical test**: each task score weights validity first, applying the declared objective only to break ties between two valid answers (`pointsOf`, `WEIGHTS`); compute cost never affects the score. An exact one-sided paired sign-flip test over nonzero task scores registers a step at the configured significance level. Possible readings are `step`, `no-step` (tested with no significant effect), `not-scored` (no testable tasks), `check-defects` and `no-change`. The next recommended move is computed by `decide` (`src/campaign/decide.ts`), and six eligible moves without a gain trigger the stopping rule (`stopRule`).

## 8. Rules

1. **Only the held-out comparison decides**: never a practice result, an agent's account, a code review or a unit test suite.
2. **Only the Examiner authors the exam, and no one coaches it.** Neither humans nor agents write or repair domain rules, checks or tasks, nor hand-edit packs, check programs, kept harnesses or logs to make a command pass. Fix cross-domain defects in the host, prompts or contract machinery instead.
3. **Nothing crosses the evaluation wall except the items listed in section 1.** Changing a hidden value, a check implementation or which held-out task a candidate won must leave every Builder and solver message byte-identical apart from the remaining budget (`test/builder.test.ts`, `test/builder-led.test.ts`, `test/wall-practice.test.ts`). This invariant covers prompts, tool descriptions, tool results, home-directory files and practice-task selection; any pull request touching those surfaces must state how it verified the wall.
4. **Experimental terms are fixed before the first solve and never altered post hoc**: do not top up a task set thinned by check disputes, and do not re-run a completed comparison under different terms.
5. **Both arms are solved afresh under identical conditions**; no cached or historical solve may stand in for either arm.
6. **A single rollout is weak evidence**: a result counts only when supported by repeated solves, and any single solve shown to an agent must be labelled as such.
7. **A non-result is neither a pass nor a fail**; it is retried and excluded from all denominators.
8. **A rejection counts only after it is ruled, and a blind operator label overrides a Referee ruling.**
9. **No reference answers, no stronger solver and no answer-finding agent.** A check verifies a domain property; a parameter from which a task was generated is a fact of the task rather than an answer.
10. **No agent authors a measurement instrument.** Check facts come from the domain's own pinned tool; any check relying on its author's own computation is treated as a fault until the operator explicitly admits it (`--admit`, or `--admit-authored` at launch).
11. **The host owns every resource limit**; a file requesting additional time, turns or disk space has no effect.
12. **One owner per decision and one reader per fact**; whenever two places decide the same thing, identify both and remove one.
13. **Add machinery only on empirical evidence, and prefer rewriting over adding**: `owner → live reader → decision it changes → evidence → hostile test`. Prefer deleting a seam or widening an existing owner over introducing a new branch, option or prompt paragraph. A new diagnostic reading reports only until a replay over the archive demonstrates which recorded decisions it would change. Any superseding change deletes what it replaces or explicitly lists remaining readers under "Not done", and any pull request adding more than 50 production lines must explain why no existing surface could be simplified instead.
14. **Stop when nothing can be learned**: refuse any launch that cannot yield a valid reading before spending compute, and do not re-evaluate a dead provider simply because budget remains.
15. **Credit and session limits are expected operating conditions rather than defects**: resume from the log at the run's own commit once quota recovers or under another login, and do not patch, triage or report such endings as failures. Investigate only 429 responses, timeouts or crashes that do not name a limit.

## 9. Status, evidence and claims

Read `attribution-and-proof` before claiming any improvement. Avoid vague labels such as "built" or "done"; instead state the exact rung of the evidence ladder, without allowing one rung to substitute for the next: planned; present in source (with commit and live reader); proved without a model (bounded check, property test, replay or rehearsal); exercised live (an event in a real run's log); shown in an outcome (a reading that moved, replicated on fresh solves); or withdrawn (with the reason). Current levels are tracked in `docs/plan.md`.

```text
events in a campaign's log  >  a fold over the log  >  source and tests  >  a command's printed line
                            >  a pull request's text  >  an agent's account
```

This hierarchy governs both what you cite and what you assert: your own answer, a proposed causal explanation and a subagent report remain at the lowest rung ("an agent's account") until backed by higher evidence. Draw every count from its owning fold, and state causal explanations as falsifiable hypotheses accompanied by the count that would refute them. A unit test or rehearsal verifies that a code path executes, never that model behaviour improved, and a test suite on one operating system proves nothing about the other operating system's isolation wall. A live run is evidence only about the exact code it executed (`bun run runs source --has <text>`). Before claiming a symbol or mechanism is absent, inspect both the symbol and its callers.

| Claim | Requires |
| --- | --- |
| A step | A comparison reading `step`, cited with its condition; unqualified only once a subsequent fresh reading confirms it |
| No step | The same, together with sample size; this never establishes equivalence |
| A mechanism | Its event recorded in a live run's log where its trigger occurred |
| A refusal | The refusal text, which proves only its own trigger condition |
| Attribution to part of a harness | An ablation comparison against `programs-of:<digest>` |

Keep distinct counts separate, report every rate with its denominator, and never compare one campaign or setting directly against another as proof of gain. Longitudinal progress is evaluated between groups of fresh runs, comparing the between-group difference against the variance across runs (`promotion-tuner`, `scripts/trend.ts`).

## 10. Runs with a real model

A live model run spends the operator's budget and requires explicit operator authorisation for the named runs. Every seat runs inside Seatbelt or Bubblewrap; an unavailable isolation wall produces a typed non-result rather than an unconfined execution. Operational procedures live in skills, from `run-improvement-campaign` and `run-management` to `whole-run-investigation`; `bun run runs` lists the available commands.

1. **The worktree is the experimental condition.** Launch each run from its own clean worktree at a published commit (`runs fresh`) and leave its `src/` untouched while it is active; paid seats refuse a main worktree or one containing `ana-followed` (`treeFault`).
2. **Verify the path without a model first** (`--dry-run`, `runs replay`, `runs rehearse`).
3. **Record one falsifiable prediction before the first solve**, settled by a count that can go either way.
4. **Run at most one or two rounds concurrently per host**, because host load confounds wall-clock deadlines; `runs fresh` without `--host` assigns runs by login usage and load (`leastOccupied`).
5. **Never open, print or copy the file passed to `--env-file`.**
6. **Do not stop a live run to patch it**; place the fix on the PR stack so it reaches the next batch of fresh runs.
7. **Inspect log events and generated reports before reading any agent prose**, including your own earlier notes.
8. **Report every started attempt as spent compute.**
9. **A measured run opens a fresh project and climbs independently** from a prompt at a single commit; promotions derived from a seed, fork, pack or different commit do not count.

**Target and control domains.** Jobstat is the primary domain for v1.0 and always maintains a live run; buffer serves as the control domain, evaluated against its historical baseline from two to four weeks earlier. An improvement that holds across both domains plausibly generalises, and any regression in another domain is traced to its introducing change and repaired.

**External transfer evaluation.** At each pause from the second promotion onwards, a jobstat run's newest reference harness is evaluated on JobBench under its own judge, without prompting for confirmation, against the Starter, stock Claude Code and Harness²'s held-out arm. Interpret any deficit first as a possible difference in experimental conditions, and treat differences within the Starter's rollout variance as noise (`run-improvement-campaign`, "The outside aim").

**Autonomous cycle operations.** Within an authorised cycle, pause a live run that has reached its trigger after its next comparison completes, investigate it, place the fix on the stack and fork fresh runs at the stack head within the cycle's grants, without blocking behind unnecessary questions. All other stops, section 3 decisions and merges remain exclusively with the operator. React to events (`runs alerts`, `runs pulse`) rather than polling on a clock.

## 11. Working in the repository

Use the Bun version pinned in `package.json` rather than Node, npm or npx, and keep git hooks enabled. Run owning tests via `bun run test -- <paths>` during development and `bun run gate` once at the top of the change; the check runner distributes work across the fleet (`local-checks`), while GitHub Actions executes only `ci.yml`.

### What you never touch

Do not modify `.ana/` (except `.ana/wri/`, where investigations and cycles store their own artefacts), `data/runs/`, packs, check programs, kept harnesses, `.env`, credentials or installed dependencies. Changes to `vendor/` follow a strict provenance rule: upstream code is copied verbatim, with its source path and commit cited and every local modification listed.

### The stack and pull requests

Pull requests are stacked, and each release lands a complete chain: a **small** release (`0.x.y+1`) for any chain whose automated proof passes, and a **big** release (`0.x+1.0`) only when a mechanism has been exercised live at the stack head and a reported factor has moved relative to the previous big release's runs by more than the inter-run spread. Determine which runs are comparable from each run's commit (`bun run runs source`) rather than from version numbers.

Read `stack-pr` and inspect the current stack (`bun .claude/skills/stack-pr/scripts/stack.ts`) before branching and again before pushing, as concurrent sessions update it. Either extend the existing open PR that owns a problem (appending a commit to that PR, restacking everything above it and pushing with `--no-verify`, including other sessions' PRs) or stack a new PR on top: push its branch, open it with `gh pr create --draft --base <top's branch>` and run `bun run land -- <new top> --sanitize`, which links the full chain into GitHub's native stack (`gh stack link`) that `land --merge` merges. Setting a git base alone leaves a PR outside the native stack, and basing in the middle of a stack forks it. A `--sanitize` run verifies the whole chain from `main`, reusing cached passes; `--from <pull request>`, which verifies only commits from that PR upwards and leaves heads unmergeable, requires operator authorisation. You may rebase your own PR onto the stack top; another session's PR, worktree or run changes only on operator authorisation, apart from replaying its commits unchanged above yours. Maintain one worktree per PR, avoid manual `git stash`, and ensure every individual commit passes checks on its own. Each PR carries a category (`CATEGORIES`, `tools/runtime/land.ts`) and the highest importance label whose criteria it meets:

- `I0`: results are already invalid or unsafe (incorrect statistical reading or promotion, evaluation wall breached, answers lost, credentials exposed, spend exceeding cap, or `main` failing its gate); live runs should pause until fixed. Roughly one PR in 50.
- `I1`: fixes a defect in what a campaign decides, measures or exposes to a seat (admission, practice release, supply, task sampling, climb, comparison, Referee or wall); protects validity before results are corrupted; prevents a crash, stall, lost session, wasted compute or unrecovered failure; or deletes an entire mechanism.
- `I2`: any other change to production code, prompts or run and landing tooling, including simplifications that remove code.
- `I3`: reporting, wording, comments, documentation, skill prose or tests alone.

When a change sits between two levels, assign the higher label so that fixes are not hidden from review or delayed in landing order.

Push only your authorised branch, using `--force-with-lease` when rewriting history, and verify the published state on the remote (branch heads, counts and commits cited in the PR body) before reporting completion. Merging belongs exclusively to the operator; before `bun run land -- <top> --merge`, review the stack through three lenses (`stack-pr`, section 9), place confirmed findings on the stack and re-run `--sanitize`.

**Shell commands.** A command guard inspects every shell invocation before execution: write plain commands, follow the form indicated by any refusal (`repository-practice`, "Commands a guard reads"), edit files with the editing tools and run multi-line scripts from files. Move unwanted files to the Trash by explicit path instead of running `rm -r`; leave branches, shell profiles, SSH configuration and environment files untouched.

### Reviews and subagents

Assign each subagent a single bounded task specifying authority, paths, revision, known facts, the exact question and whether it is read-only. Supply reviewers with source code rather than pre-formed conclusions. Hold every reviewer to exact counts with denominators and `file:symbol` citations, and reject proposed machinery unless subtraction has been shown to fail. Changes under roughly a hundred production lines are usually faster to implement directly than to brief out, and any decision reconciling competing invariants stays with the primary agent. Treat every subagent report as an agent's account (section 9): verify each finding at the source and classify it as confirmed (with events), plausible (stating what would settle it) or refuted.

## 12. Code that passes the first time

Read `tools/oxlint/HABITS.md` before writing code. Introduce no strict-lint findings and never disable a rule: a false positive on a single site is recorded via `bun run not-slop`, whereas a systematic false positive is a defect in the rule itself. Production code imports `node:` modules exclusively through `src/meta`. Keep files within 800 nonblank lines and functions within 115 lines, and export only symbols imported by another file.

### Tests

Write tests that assert properties over a space of inputs rather than isolated examples, so unanticipated edge cases still fall inside the check. In order of preference: exhaustive enumeration up to a small bound checked against the owner's specification or an independent count (`test/compare-exhaustive.test.ts`); state-space search over reachable states asserting multi-move invariants (`test/decide-explore.test.ts`); seeded generative tests over raw events tracking branch coverage (`test/pairs-property.test.ts`); and named examples solely for process, filesystem or provider boundaries, or the nearest hostile refusal case. Pin each measured protocol constant (`WEIGHTS`, `GAP_FLOOR`, `SIZE`, `PATIENCE`) once. Delete or replace an existing test only after checking mechanical mutants of its owner (commit-r, step 8): any mutant killed by the old tests that the new suite misses must be restored as a case or explicitly justified as incidental. Keep bounded checks within roughly ten seconds on a single host by exploiting symmetry or canonical states before shrinking the bound. Test observable facts through live code paths rather than phrasing. A check counts only after running over the complete change with its exit code verified directly (never masked by a pipe); a failure that passes in isolation is a diagnostic lead, and a wall test failing due to missing user namespaces is a real failure.

### Where a reader or helper lives

Search the codebase by behaviour rather than symbol name, and fold duplicate surfaces into their single owner (rule 12). Remove any guard, timer or recurring check that never fires or costs more than the defect it prevents. Place remaining helpers according to the first matching row:

| Who reads it | Where it lives |
| --- | --- |
| a campaign, a `bun run` verb, a local job or the UI | production: a fold in `src/` (one reader per fact, section 5), or the command's folder under `tools/` |
| an in-depth single-campaign log investigation reached through `wri.ts` | `tools/wri/` |
| scripts of two or more skills, or cross-campaign analysis | `.claude/skills/main/`, a shared library with no standalone command (`cli.ts`, `logs.ts`, `runs.ts`, `print.ts`, `stats.ts`) |
| a single skill's procedure | that skill's `scripts/` directory |

Helper layers may import production code, never the reverse (`direction.ts`), and must read every fact through the owning production fold. Whenever production lacks a required fold, move that fold into production.

## 13. Writing

Write plain, understated British English for a careful colleague who has not read the prior conversation. Aim for the register of a concise machine-learning methods paper: connected grammatical sentences that explain both what a mechanism does and why it exists, using experimental and ML vocabulary where it clarifies (baseline, held-out set, noise floor, statistical power, effect size) rather than the clipped one-clause fragments of a controlled-language manual. Edit for concision: cut repetition, hedging and dated anecdotes until every sentence carries a fact or a reason, and treat a mechanism that resists brief explanation as a signal that the design is overbuilt.

- Lead with the answer, then state the subject and action with a plain active verb, preferring "X instead of Y" over negation.
- Report exact figures with the measured axis named, keeping tests, observations and estimates clearly separated.
- Use section 14's canonical terms consistently with one meaning each.
- Avoid hype words (such as "robust"), emoji, exclamation marks and em dashes; format identifiers and paths in inline backticks; use absolute dates only where a measurement record requires them.
- State each fact once in a prompt and tune prompts by rewriting a few sentences rather than appending paragraphs; when an interface failure recurs, fix the underlying tool instead.
- Document current behaviour in skills and in this file, keeping each intent in one place and each default in code; historical rationale belongs in commits, pull requests, the backlog or head comments.

## 14. Terms and map

A **held-out task** is scored in comparisons and never exposed to the Builder; a **practice task** is released to the Builder for development and never scored; a **valid answer** passes every check within host limits; the **reference harness** is the starter until a candidate step is promoted; a **round** consists of a Builder session followed by a comparison. The complete glossary lives in `repository-practice`, section 14 (`terms-and-map.md`).

```text
src/meta     runtime owners       src/kernel   log, conditions, verifier, comparison, reports
src/wall     the OS wall          src/agent    one model session      src/tools  shared tools
src/harness  the Built Harness    src/solver   one solve              src/builder, examiner, referee
src/campaign round, admission, decide, opening, words
tools/d2     campaign commands    tools/runs   run registry           tools/wri  run investigation
tools/runtime  lint, test, gate, land, moments  packages/ui  read-only log page  vendor  copied
.claude/skills  the procedures and their scripts  .claude/skills/main  the scripts' shared library
```

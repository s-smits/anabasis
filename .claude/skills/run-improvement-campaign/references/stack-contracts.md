# End-to-end stack contracts (pseudo-data and seam invariants)

Single-owner map of the high-level inputs, transforms, outputs, and load-bearing invariants across every seam of an Anabasis campaign and external evaluation. Local milestone checks verify one stage at a time; walking this map end to end catches silent cross-seam breaks (such as an unmeasured qualitative lane on a code-only launch, a workspace `cwd` mismatch causing relative-write refusals, a substring reader masking unused tools, or an omitted turn kind hiding unserved model calls). Event lists below name key events (non-exhaustive; full set in `src/kernel/log.ts`).

## Whole-stack sweep protocol

Walk stages **1 through 9** in order before planning iteration repairs (`run-improvement-campaign` WRI2P2 step 3), before launching a fresh proof run (step 5), and during whole-system audits (`system-audit`). For every stage:
1. Check that the stage's **input shape** matches the upstream stage's actual output (no missing flags, stale digests, family mismatches, or silent defaults).
2. Verify every bullet under **What must all hold** against primary sources (logs, folds, source, or tests, never summaries).
3. Stop at the **earliest broken seam** and repair its owning module rather than patching downstream symptoms.

```text
[1 Launch & Backend]    LaunchConfig + DomainPrompt   --> SeatLaunch + campaign.opened
          |
[2 Exam & Freeze]       DomainPrompt + Limits         --> FrozenContract + Checks + Controls
          |
[3 Task Supply]         FrozenContract + taskHistory  --> HeldTask[] (frontier + retained)
          |
[4 Wall & Builder]      BuilderView (AGENTS.md §1)    --> BuiltHarness (guide + .toolchain/)
          |
[5 Solve Runtime]       BuiltHarness + PublicTask     --> SolveEnv (sandbox) --> Submission
          |
[6 Verify, Audit, Judge] Submission + HiddenTask      --> Verdict + Adjudication + PairVote
          |
[7 Compare, Stop, End]  PairedVerdicts + A/A + Signal --> Reading + Promote/Revert + Ending
          |
[8 Export & External]   BuiltHarness (macOS -> Linux) --> ExportBundle --> ExternalEval
          |
[9 Continuity & Closure] log.jsonl + judged/          --> Folds + Economy + WRI + NextFork
```

---

## Stage 1. Launch, commit provenance, and backend seating

```ts
Input:  LaunchConfig {
          commit, cleanWorktree, pack, domain, prompt,
          seats: { builder, examiner, solver, reviewer: { model, effort, family } },
          flags: { admitAuthored, target, solves, capUsd },
          limits: Limits { wallSeconds, turns, modelTurns?, shellDefaultSeconds, shellMaxSeconds, concurrency }
        }
Owner:  tools/runs/fresh.ts, tools/campaign/{campaign,campaign-terms}.ts, src/agent/session.ts, src/agent/backends/{claude,models,codex-auth}.ts
Output: SeatLaunch { cwd, home: join(dirs.host, "model"), env, sandboxProfile, model }
Key events: campaign.opened (judged, attended, seats, solver, budget), campaign.setting, condition.recorded
```

**What must all hold:**
- The run opens in a clean, dedicated worktree at one published commit (`treeFault` rejects the main checkout and `ana-followed` trees); every planned fix is an ancestor of the launch commit.
- Every seat runs on the exact backend and model named at launch with zero silent fallback, and the target host holds live auth for every named family.
- Examiner always sees the Unified Rubric during `d-1` and chooses whether the domain needs `kind: "judge"` items or stays `$0` code-only. Unattended launches auto-admit judged items whenever `reviewer.family !== solver.family` (`judged = !attended && crossFamily` in `tools/campaign/campaign-terms.ts`); if Examiner drafts judged items on a same-family run, `d-1` stops cleanly (`ending: "exam"`) before solve 1 until resumed with a cross-family `--reviewer`.
- Workspace-bearing seats (Solver, Builder, and walled Examiner) launch with `cwd === dirs.home` while private runtime state (`HOME`, `CLAUDE_CONFIG_DIR`) stays outside `dirs.home`, preventing relative-path write refusals. (The Auditor/Referee has no workspace and runs in its private `home`.)

**Verify with:** `bun run runs source <run>`, `bun tools/runs/degradations.ts <run>`, `bun run runs active --here --codex`, `bun run test -- test/claude-backend.test.ts test/runs-placement.test.ts`.

---

## Stage 2. Exam drafting, adversarial draft audit, and freeze

```ts
Input:  { domainPrompt, limits, admitAuthored, triesBudget (default 6) }
Owner:  src/examiner/draft.ts, tools/eval/draft.ts, src/audit/draft-audit.ts, src/kernel/contract.ts, tools/eval/accept.ts
Output: FrozenContract {
          scope, conventions, answerFormat, rules: Rule[],
          objective?: { quantity, direction, scale?: "unit", items?: RubricItem[] }, // code or judge (1 line, 20-220 chars, <=4)
          checks: "evaluator.ts", controls: Control[>=3], toolchain?: HostTool[]
        }
Key events: draft.started, draft.turn, draft.call, draft.finished, exam.drafted, referee.draft, referee.draft.refused, checker.read, contract.frozen
```

**What must all hold:**
- Offline structural faults (`unformed`) do not consume live draft tries, and launch `--tries` (default `6`) leaves headroom beyond `MAX_DRAFT_AUDITS` (`2`) so pass-2 audit findings can be repaired and re-probed without deadlocking.
- `rules` stay scoped to computable or invariant requirements (no arbitrary hidden-convention traps rejecting equivalent valid answers); `objective.items` measures every substantive prompt requirement without saturating presence or word-count items near `1.0`.
- When `hasJudge(contract.objective)` is true, judge criteria sit strictly on the exam side and are paired with equal-weight rubric-free `holistic` judgement.
- Mechanical probes (`doNothing`, hidden-value swap, control execution) pass without throwing; every final `defects` audit finding carries a mechanical probe and is re-probed after repair before `contract.frozen`.
- Declared domain engines or compilers auto-stage cleanly into verifier checks; zero unadmitted authored checks or judge items survive freeze (`AGENTS.md` §8 rule 10).

**Verify with:** `bun tools/wri/wri.ts reader drafted --log <log>`, `reader draft-audit`, `reader grounding`, `bun run test -- test/draft.test.ts test/judge-rubric.test.ts`.

---

## Stage 3. Task supply, diversity, and post-promotion ambition

```ts
Input:  ExaminerInput {
          contract, checkAssertions (no check source),
          taskHistory (item scores, coarse outcomes; no targets, pass-rate floors, or harness names)
        }
Owner:  src/examiner/{prompt,difficulty,record,write,session}.ts, src/campaign/{scheduler,admission}.ts
Output: AdmittedTask { id, epoch, origin: "draft" | "session" | "carried", family, public/{task.json, files}, hidden }
Key events: exam.started, exam.turn, exam.call, task.proposed, task.feasible, task.gate, task.state, exam.finished
```

**What must all hold:**
- Admitted unclosed frontier tasks clear `comparisonFloor` without `EXAMINER ZERO YIELD` or premature `no-room` endings.
- Tasks span genuinely distinct constructions across the prompt (wording nearness `< 0.98`, no single-session `FAMILY CONCENTRATION`, no practice-shape cloning) and stay strictly disjoint from released practice (`PRACTISED TASK MEASURED === 0`).
- After each promotion, the Examiner raises difficulty so the new reference sees fresh validity or objective headroom instead of saturating at 100% pass on easy checks.
- Task verification uses pinned engines or independent generative truth rather than reasoning no stronger than the solver's own model.

**Verify with:** `bun run runs view <run>`, `bun .claude/skills/design-and-seats/scripts/examiner-view.ts <run>`, `wri.ts reader aim`, `reader nearness`, `reader ambition`, `bun .claude/skills/examiner-complexity/scripts/grades.ts`.

---

## Stage 4. Information wall, practice loop, and Built Harness construction

```ts
Input:  BuilderView { // Strictly AGENTS.md §1's five items + MEMORY.md + states/<parent>/
          publicContract (no judge criteria), releasedPracticeSpecs (<= half held-out pool),
          practiceOutcome + trajectory + read_trace + coarse bandOf (no raw digits),
          aggregateTally + reading (no task names), hostLimits + budget + taskCounts
        }
Owner:  src/builder/{prompt,session,tools,past,store,memory}.ts, src/harness/{open,starter,files,programs}.ts
Output: BuiltHarness {
          digest,
          "agent/BUILT_AGENTS.md": string,
          "agent/tools-spec.json": ToolSpec,
          ".toolchain/": { "bin/*": executable, "env.sh"?: regularFile, "lib/*"?: files }
        }
Key events: build.started, build.turn, build.call, build.compacted, build.checkpoint, harness.version, build.finished
```

**What must all hold:**
- Perturbing held-out task text, checks, `judge` criteria, hidden values, or held-out winners keeps Builder and Solver messages byte-identical (`AGENTS.md` §8 rule 3).
- `baseStarter` (`STARTER.guide`, `STARTER.spec`) stays untouched; Builder-only guidance lives strictly in `HARNESS_ACCOUNT` and `src/builder/prompt.ts`.
- `check_harness` names exact campaign-coupled files and tokens (`campaignRefFiles`, `keptHostRefNames`, `keptFormatKeyNames`, `keptRuleIdNames`) and verifies `.toolchain/env.sh` inside Builder's sandbox with a trailing status marker (catching early `exit 0`, non-zero exits, and timeouts).
- Freeze (`store.ts`) validates `.toolchain/env.sh` statically on `HOME_TOOL_TREE` (regular file, no Builder-home paths, parse-only `/bin/bash -n`, never sourced on the host).
- Builder practises its final checkpoint bytes before requesting comparison (`FINAL BYTES NEVER PRACTISED === 0`), keeps `BUILT_AGENTS.md` concise, truthful, and domain-general (avoiding campaign-ontology bloat), and ships general-purpose tools rather than scripts bound to `public/task.json` or `answer.json`.

**Verify with:** `bun .claude/skills/design-and-seats/scripts/seat-view.ts`, `builder-view.ts <run>`, `bun .claude/skills/harness-audit/scripts/harness-versions.ts <run> --diff <digest>`, `bun run test -- test/builder.test.ts test/builder-led.test.ts test/wall-practice.test.ts test/handover.test.ts`.

---

## Stage 5. Solver execution and sandboxed harness runtime

```ts
Input:  { harness: BuiltHarness, task: PublicTask, condition: Condition, dirs: SolveDirs }
Owner:  src/solver/{run,prompt}.ts, src/sandbox/{isolation,darwin-seatbelt,linux-bwrap}.ts, src/tools/command.ts, src/meta/bundle-layout.ts
Output: SolveResult {
          answer: "answer.json", deliverables: "deliverables/*",
          outcome: "submitted" | "no-answer" | "limit" | "non-result",
          responseModels, toolCalls[], network: NetworkReach
        }
Key events: solve.started, solve.turn, solve.call, solve.compacted, solve.finished
```

**What must all hold:**
- Both arms of every paired comparison execute under byte-identical `Condition` (`contract`, `task`, `model`, `effort`, `prices`, `runtime`, `compaction`, `verifierTools`, `sandbox`, `limits`, `host`, `side`), differing strictly in `harness` and `solverTools`, and share matching `solve.finished.network` (`COMPARISON_REACH`).
- Inside both macOS Seatbelt and Linux Bubblewrap, `PATH` exposes `.toolchain/bin` and pinned `ANA_PYTHON`, `BASH_ENV` points to `.toolchain/env.sh` (when a regular file), `cwd` sits in `dirs.home`, and protected roots (repository, operator home, hidden values, credentials) stay denied with zero `sandbox-crash`.
- Prompts match the actual files placed in the workspace (`public/task.json`, `answer.json`, `deliverables/`).
- Solvers actually invoke shipped `.toolchain/bin` programs (verified by parsed shell invocations, not substring matches) without wasting turns on tool or path friction.

**Verify with:** `wri.ts reader execution`, `reader calls`, `bun run test -- test/solve-sandbox.test.ts test/solver-prompt.test.ts`.

---

## Stage 6. Offline verification, rejection adjudication, and cross-family judging

```ts
Input:  { submission, hiddenTask, frozenChecks, contract, (when hasJudge) blindedValidPair }
Owner:  src/kernel/{verify,check-child,extract,solve}.ts, src/audit/{auditor,judge}.ts
Output: Verdict { kind: "pass", objective?, scores? } | { kind: "fail", blocking } | { kind: "faulty" | "non-result" }
        Adjudication { ruling: "earned" | "check-defect" | "unclear", probes[] }
        PairVote (if hasJudge) { swappedCriterionMeans, holisticMean (no hidden values) }
Key events: verdict, referee.turn, referee.call, referee.compacted, referee.finding, referee.refused, referee.pair
```

**What must all hold:**
- The Verifier runs completely offline via `isolatedArgv` (`src/kernel/verify.ts`, bypassing `src/tools/command.ts` and never setting `BASH_ENV`), never executes harness code, and returns finite `[0, 1]` item scores (no NaN or silent `Number("") === 0` vacuous passes).
- Reproducible rejections are adjudicated before entering failure denominators; `earned` rulings carry real `probe_check` evidence rather than restating the check or compacting into zero-probe `unclear`.
- When `hasJudge(contract.objective)` holds, cross-family `referee.pair` executes live (`> 0` events), runs both swapped orderings (`A/B` and `B/A`), scores one criterion per vote, and combines criterion votes with equal-weight rubric-free `holistic` judgement (which never sees hidden values).
- Rejection and pass accuracy are calibrated against blind human labels (`settle.ts`, `agreement.ts`) rather than trusting self-consistent checks alone.

**Verify with:** `wri.ts reader checks`, `reader rejections`, `reader scores`, `bun tools/campaign/settle.ts`, `bun run test -- test/review.test.ts test/judge-rubric.test.ts`.

---

## Stage 7. Paired comparison, confirmation, stop rule, and endings

```ts
Input:  { oldArm, newArm, sampledTasks (frontier + 1 retained per 3), pairedVerdicts, aaControl, signals }
Owner:  src/kernel/{compare,reports,size,solve}.ts, src/campaign/{comparison,scheduler,admission,climb,signal}.ts
Output: ComparisonReport {
          reading: "step" | "no-step" | "not-scored" | "check-defects" | "no-change",
          untied, detectable, pValue, aaReading, spareWins,
          originSplit: { chosenOn, writtenAfter }
        }
        Lifecycle { move, stopRule, ending?: "budget" | "stop" | "exam" | "no-room" | "environment" | "operator" | "finished" }
Key events: comparison.started, comparison.reported, harness.promoted, harness.reverted, campaign.move, campaign.word, campaign.ended
```

**What must all hold:**
- Both arms solve held-out tasks afresh (no cached solves); outcomes, exclusions, and `pointsOf` / `WEIGHTS` / `GAP_FLOOR` / `isSignificant` scoring follow `AGENTS.md` §7 (cost never enters scores).
- Every promotion faces an owed starter comparison (`scheduler.ts`) on unseen `written-after` tasks before counting as confirmed; a failing starter read reverts cleanly (`harness.reverted`), and unchanged digests are not re-compared to fish past alpha.
- Pooled A/A false steps remain inside the statistical bar (`95%` exact upper bound `<= 2 * alpha`), and winning margins clear within-task rollout noise (`A/A` self-difference) with adequate sample power (`detectable`).
- Operator pauses (`campaign.word`, `runs pause --after reported`) land cleanly after the owed starter read, `stopRule` (`admission.ts`) halts fruitless loops honestly, and every finished run records an explicit `campaign.ended` reason.

**Verify with:** `bun .claude/skills/comparison-reading/scripts/starter-reads.ts <run> --tasks`, `reading.ts`, `size.ts`, `bun .claude/skills/campaign-mechanics/scripts/ending.ts <log>`, `bun .claude/skills/promotion-tuner/scripts/replay.ts`, `trend.ts`, `bun run test -- test/compare-exhaustive.test.ts test/decide-explore.test.ts`.

---

## Stage 8. Cross-OS export, native runtime parity, and external transfer

```ts
Input:  { keptHarness (macOS arm64), externalBenchStore, baseline: "base" (bareSolver) | "starter" }
Owner:  src/harness/place.ts, studies/shared/{bundle,foreign-python,pi-solve}.ts, tools/runs/bench.ts, tools/wri/regressions.ts, tools/campaign/campaign.ts
Output: ExportBundle { BUILT_AGENTS.md, .toolchain/{bin, env.sh, targetOsVenv} }
        ExternalEval { builtScore, baselineScore, fairUncutDelta, cutCounts, baselineSpread, invokedTools, rubricMisses }
```

**What must all hold:**
- Cross-OS porting rebuilds Python interpreters and native wheels for the target platform via `uv` and fails closed (`PlatformRefusal`) on unportable binaries, escaping symlinks, or invalid/macOS-coupled `.toolchain/env.sh`; trajectories show `0` OS-port errors (`Exec format error`, `Mach-O`, hardcoded host shebangs, permission errors) and symmetric `ModuleNotFoundError` counts across arms.
- Native `pi-durable` evaluations (`runs bench`, `--baseline base|starter`) source `.toolchain/env.sh` via `/bin/bash` (`BASH_ENV`) and keep native `pi-durable` cohorts stratified separately from legacy Claude Code rows.
- External tool usage is measured by real shell-invocation parsing (`invokedCommands`, never substring matches) alongside campaign invocation rates, exposing dead or campaign-coupled `.toolchain/bin` scripts.
- External deficits separate guide drag from program lift using at least two external baseline rollouts alongside `programs-of:<digest>` ablations (both internally via `tools/campaign/campaign.ts` / `checkpoint.ts` and externally via read-only staging in `studies/shared/bundle.ts` / `runs bench --harness programs-of:<digest>`, writing nothing under campaign `states/`); external queries and scores never enter any campaign seat.

**Verify with:** `bun run wri check --log <run>`, `bun run wri regressions --log <run>`, `bun studies/harness2/score.ts table --out <store>`, `score.ts spread`, `bun run test -- test/studies-foreign-python.test.ts test/wri-domains-regressions.test.ts`.

---

## Stage 9. Continuity, economy, single-owner readers, and loop closure

```ts
Input:  { log.jsonl (append-only, fsynced), judged/, predictions-<run>.md, cycle.md }
Owner:  src/kernel/{log,trace,meter}.ts, tools/campaign/close.ts, tools/runs/degradations.ts, tools/wri/*, .claude/skills/run-improvement-campaign/scripts/wri2p2.ts
Output: { overview, derivedReaders, regressions.txt, degradations, continuity, epochSpend, outcomes-<run>.md, vetting.md, plan.md }
```

**What must all hold:**
- Keepers carry runs cleanly across quota waits, login hops, and host reboots (`campaign.waited`, rule-15 resumes at the same commit), and single-meter billing (`meter.ts`, `close.ts`) tracks dollars and active hours per promotion without unexplained `BILLING RESIDUAL`.
- Every turn kind (including `referee.turn` across per-round overrides and campaign reopens) and every unserved error turn (`stopReason === "error"`, `model === null`) is counted by `src/kernel/trace.ts` and reported by `tools/runs/degradations.ts`.
- Every reader wraps the single production fold (`direction.ts`), parses structured data or real shell syntax instead of fragile substring regex, and honours wall rules (`test/wri-walls.test.ts`).
- Every iteration backtracks pre-registered count predictions at promotion gates (1–5), escalates defects refuted across `>= 2` consecutive fresh runs to structural rewrites (`commit-r`) or ablations, proves each behavioural slice model-free (`system-path-simulation`) before spend, and reverts mechanisms whose keep-bars fail.

**Verify with:** `bun tools/wri/wri.ts reader diagnostics --log <log>`, `bun tools/runs/degradations.ts <run>`, `wri.ts reader continuity`, `reader epoch-spend`, `bun .claude/skills/repository-practice/scripts/direction.ts`, `bun .claude/skills/run-improvement-campaign/scripts/wri2p2.ts due`, `bun run gate`.

---

## Cross-seam failure triage

| Observed symptom | Earliest candidate seams and refuting checks |
| --- | --- |
| Campaign climbs internally, yet `builtSolver` trails `bareSolver` externally | Check **Stage 8** (OS-port errors, `CUT` counts, `>= 2` baseline rollouts), **Stage 4 / Stage 8** (`invokedCommands` external call rate, `BUILT_AGENTS.md` size, internal `programs-of:` ablation), and **Stage 2 / Stage 6** (`campaign.opened.judged`, `referee.pair` count against prompt scope) |
| Examiner ends `exam` with `0` comparisons after fixable draft-audit findings | Check **Stage 2** (`draft.call` `draft_exam` count vs `--tries`, `unformed` fault count, and whether tries remained after `referee.draft` pass 2) |
| Solvers hit path refusals on normal relative writes despite clean prompts | Check **Stage 1 / Stage 5** (`SeatLaunch.cwd` vs private `home` in `claude.ts` and sandbox write roots) |
| External trajectories report zero tool errors, yet `.toolchain/bin` shows inflated or `0/N` usage | Check **Stage 4 / Stage 5 / Stage 8 / Stage 9** (`.toolchain/env.sh` `BASH_ENV` wiring, `check_harness` campaign-path offenders, and `invokedCommands` shell parsing) |
| Reviewer/Auditor stalls or returns `unclear` with no entry in `degradations.ts` | Check **Stage 1 / Stage 6 / Stage 9** (`referee.turn` attribution across overrides/reopens and `unservedTurns`) |
| Promotions fail `written-after` starter confirmation or collapse into ties after epoch 1 | Check **Stage 3 / Stage 7** (`FAMILY CONCENTRATION`, validity saturation, and underpowered `detectable` sample size) |

# Transfer ledger: v1 to v2

This ledger tracks each part of v1's loop: what it did, and whether v2 has it. v1 is harness-builder-v4 at `7af7315`; read its files with `git show 7af7315:<path>`. Paths below sit under v1's `src/` unless they start with `tools/`, `vendor/`, `starters/` or `packages/`. `plan:<line>` cites the plan of record, "Anabasis one plan".

Each session walks v1's loop and builds the gap that most delays a live end-to-end round. It proves that gap with faux tests, then with a cheap live run, and lands it as a stacked PR. Then the session updates the row here.

Statuses:
- **ported**: copied or sed from v1, cited at the copy.
- **replaced**: a v2 mechanism does the job differently.
- **dropped**: cut on purpose, with the plan line that cuts it.
- **missing**: needed and not built.
- **unsure**: the plan doesn't settle it.
- **deferred**: behind a plan gate, and not built before it. M3 and M4 wait on gate G4, a climb step that also holds on the anchor (plan:160, :401, :406).

Two facts frame the rest:
- **v1 has no "rollback".** The word never occurs. A rollback is a promotion decision of "held", recorded as `recordProductDecision({adopt:false})`, which keeps the product selected before.
- **v1 has no head-to-head comparison.** v1 measures each candidate on its own Builder-written battery and promotes it by clauses: unmeasured, claim-refused, zero-verified, unbound task set or evaluator, stale identity, fingerprint drift.

A row marked **open #N** is built in pull request #N. #2 to #15 are on main since 8 October (`b26e531`), so a row that names one of them is on main; #17 and later are the open stack above it.

## 1. Outer loop

| v1 part | v1 location | does | v2 | v2 owner, or why |
|---|---|---|---|---|
| fullrun entry, runFullRun | package.json `fullrun`; run/full-run.ts:119 (main :407, temp sweep :143) | launches a run; sets its provider budget and closure | deferred | M4 (plan:160), D2 (plan:355). The pilot and D1 run on the sweep's scripts (plan:62, decision 5). |
| round loop, caps, terminal | full-run.ts:308, :358, :206, :214; run/full-run-round.ts:121, :285 | runs rounds; stops on the round cap, time, budget or a stall | deferred | M4 |
| launch, args, lock, registry | run/full-run-launch.ts:124, launch-arguments.ts:170, campaign-lock.ts:191, project-registry.ts:26, launch-project.ts:92 | picks the project and locks it | deferred | M4 |
| directKickoff | run/direct-input.ts:12 | builds the kickoff from the prompt and user context | deferred | M4 (the Builder's input) |
| next move | run/next-move.ts:69, :114 | chooses build, rebuild, measure or stop | deferred | M4 |
| difficulty select | run/difficulty-select.ts:107, difficulty-decision.ts:30 | sets each round's band | replaced | the bracket, `src/kernel/task.ts` screen (plan:151) |
| build step | run/full-run-build-step.ts:214, :44, :142, :185 | refuses, reuses or runs the session; settles it; composes authoring memory | deferred | M4; the round runs the session (`round()`, open #8) |
| battery sizing | run/battery-sizing.ts:112 | sizes the battery | replaced | screen on 3 solves, admit on 2 fails (decision 26); 3 scoring solves |
| buildHarness, epoch | run/harness-build.ts:161, :135, :273; author/campaign-epoch.ts:146; author/builder-memory.ts:230 | build entry; the Builder's model and effort; publishes the product; carries MEMORY.md forward | deferred | M4. The session itself is built (section 2). |
| settleCandidateEvaluation | run/candidate-verification.ts:291 | sequencing after the build | open #8 | `round()` in `src/builder/round.ts`: the session, symmetric screening, the scoring solves, the reading |
| experiment freeze | run/experiment-freeze.ts | refuses a changed task set or evaluator | replaced, open #26 | content addresses: `conditionId`, `taskVersion`. The operator writes `contract.frozen` for a campaign's contract hash and check program digest (`tools/c/accept.ts --freeze`), and `openCampaign` opens no campaign of that name under another (`departure()` in `src/kernel/acceptance.ts`). Nothing asks for a freeze before a round |
| battery measurement | run/harness-measure.ts:304; run/measure-battery.ts:63; run/run-driver.ts:165, :243 | runs every case of a battery | open #8 | the round's screening and scoring solves, `pooled()` in `src/meta/pool.ts` |
| claim, readiness | run/claim-write.ts:340; claim/readiness.ts:124; claim/claim.ts:64 | writes the candidate claim and its verdict | open #4, #8 | the sign test, the anchor reading and the seeded draw in `src/kernel/compare.ts`; the round writes `comparison.reported` |
| promote or hold (= rollback) | run/candidate-promotion.ts:295; run/controller-ledger.ts recordProductDecision | promotes the candidate or keeps the product before it | deferred | M4. The round reads a kept harness against its parent and decides nothing; promotion is the operator's (`round.ts`). |
| product versions | run/product-versions.ts:90, :137, :158 | publishes and selects the product directory | deferred | M4. A session keeps each harness it practised with or left at `<states>/<digest>`, logged as `harness.version` beside its parent. |
| ControllerLedger | run/controller-ledger.ts:98 | controller.sqlite | replaced | `src/kernel/log.ts` JSONL |
| iteration analysis, Judge reviews | run/analyse-step.ts:88; analyse/*.ts | findings after the battery | dropped | reviewers deferred, audit by hand (plan:72, :160) |
| admission pointer, rebuild advice | run/admission.ts:142, :174 | points at the admitted battery; advises the rebuild | replaced | task states in task.ts; the Builder's feedback is its practice solves and the reviewers' readings (decision 16) |
| campaign and provider budgets | run/campaign-budget.ts:55; run/provider-resource-budget.ts:194 | dollar gate, provider limits | dropped | the operator declined a campaign cap on 2026-10-08 (PR #16 closed); the meter reports billed dollars and nothing gates on them |
| close, deadline, observer | run/full-run-close.ts:35; run/full-run-deadline.ts:34; observe/run-observer.ts | closes the run; live observation | deferred | M4 |
| solve concurrency | run/session-pool.ts:32, :81 | limits concurrent solves | open #8, #9 | `pooled()`: the round's and the Examiner's solves at most `concurrency` at once (decision 18) |

## 2. Builder session

The Builder is `src/builder/session.ts`, `tools.ts` and `prompt.ts` (open #5, #13). `build()` runs one session from a parent harness state, which is a Built Harness. It copies the parent whole into the Builder's home as `harness/`. When the session ends, it freezes what `harness/` holds, a child Built Harness, into `<states>/<digest>`. `round()` (open #8) then screens and scores the child against the parent.

A second Builder on the local branch `claude/builder-session` did the same job and does not land. Its live run, a kept child of c01 and two solves under it, is the only live evidence of a Builder so far.

| v1 part | v1 location | does | v2 | v2 owner, or why |
|---|---|---|---|---|
| campaign entry | run/builder-campaign.ts:555 | runs a Builder campaign | deferred | M4; one round's driver is `tools/d2/round.ts` (open #10). Its session starts from the cycle's harness, or with `--parent <digest>` from one an earlier session kept |
| pre-session refusal | run/builder-campaign-preflight.ts | refuses before a paid session | deferred | M4. `session()` refuses an id already in the log and a practice task not released (open #5), and the round refuses task sets the log would refuse (open #8); nothing checks the model or a budget. |
| workspace seeding | author/domain-repo.ts:168, relocation :127 | seeds from the starter or the adopted product | replaced | `session()` copies the parent whole, links verbatim, and its tool tree as the session's own (open #13); nothing is relocated (section 6). The public resources every solve's home holds are in the Builder's home as `resources.json` |
| starter | starters/pi-built-harness/ | seed tree | unsure | v2 starts from a v1 harness state; the correctness-model half became the fixed contract (plan:68) |
| mount, runtime | run/builder-runtime.ts | the Builder's tools, isolation and backend | replaced | `build()`: a capped disk, the solver's command wall, pi's loop, the backends of `src/backends/models.ts` |
| read, grep, find, ls, bash, edit, write | builder/tools.ts:75 | workspace file tools | replaced | bash on the command wall, and `write_file`, which copies through a walled `cp`; no tool reads a path in the host's name |
| context, public_source | builder/user-context.ts:277; builder/public-source-tool.ts:12 | user context; public research | unsure | bash has network access; no user context reaches a session yet |
| verifier_workshop | builder/verifier-workshop*.ts | installs toolchains into `.oss` | missing | `.oss` (plan:261). The Builder installs into its harness's `.toolchain` with bash (open #13). |
| harness_inspect | builder/harness-inspect.ts:445 | static inspection | replaced | `check_harness`: opens a frozen copy as a solve would and lists its tools for a practice task |
| harness_reset | builder/harness-reset.ts:10 | reset to the seed | missing | no mid-session reset; whatever ended the session, what `harness/` holds is frozen |
| harness_trial | builder/harness-trial.ts:322 | practice solve | replaced | `practice`: real solves of released tasks under the test condition. It returns the ending, the task's record under this harness and the parent, and the Referee's and Diagnoser's readings, never a check (decision 16). `read_trace` pages a practice solve. |
| correctness_check, submit | gate/check-tool.ts:179; gate/submit-tool.ts:168 | previews or runs the submit gates | replaced | `finish`; the one gate is that the frozen harness opens and lists its tools as a solve would. It refuses a fact and no standard: v1's gate audit of 2026-09-25 kept 30 of 54 refusal codes at its bar of 98% sure that what is refused is wrong, and none of the rules that judged a candidate's quality from its text. A session whose last state does not open is measured by the last state it practised with, and the report says why (open #28); in v1 a round that ended refused measured nothing |
| submit gates over correctness-model | gate/validation-pipeline.ts and others | bundle, admission, conformance, census, F2 | replaced | fixed contract plus the task gates in task.ts (plan:68) Nothing in v2 accepts a checker as a whole before it is used; `src/kernel/acceptance.ts` reads one (open #24) and decides nothing. The task gates are measured, a solve, a repeat and controls, and `supply()` counts what each refused (`refusedAt`, open #28), which v1 never had for its gate. Gate 4 names every control that does not hold in one refusal, with the kinds of its faults, where it stopped at the first and told the Examiner one fault a try (open #29). Gate 2 is the one that would not meet v1's bar: one fail of the stronger solve ends a task as too hard, where v1's record of a solver's misses is 36 of 47 a check's (v1 #124) |
| session and turn loop | author/builder-session.ts:314; author/builder-turn-loop.ts:25; author/builder-start-prompt.ts | the session and its limits | ported | `session()` over pi's `runAgentLoop`; the prompt takes `INTENT_CLAUSE` from builder-start-prompt.ts and keeps the rule of `NO_GRADER_IN_REACH`, said by the public rules, since this Builder sees no check; the wall, turns and practice solves are the round's flags |
| Builder backend | run/builder-backend.ts; backends/claude-backend.ts:337 | Builder transport | replaced | the same `Models` as the solver; the Claude backend's cost as `reportedCost`. v1's Builder was a Claude Code session with Claude Code's tools; here it is sent its own prompt without Claude Code's before it, and keeps WebSearch |
| command guard | builder/command-guard.ts | refuses destructive commands | dropped | the wall holds and the session works on a copy (the simpler, more lenient choice) |
| candidate isolation | builder/candidate-isolation.ts:384 | walls the Builder off exam and check folders | replaced | the command wall closes the repository and other solves' scratch; practice is on released tasks only, by the task fold (test/builder.test.ts) |
| Epoch Reviewer | review/epoch-reviewer.ts:338 | reviews the Builder mid-epoch | dropped | reviewers deferred (plan:72, :160); the Referee and the Diagnoser read practice fails |

## 3. Task authoring

| v1 part | v1 location | does | v2 | v2 owner, or why |
|---|---|---|---|---|
| Builder writes battery and checker | starter correctness-model/ | the author writes its own exam | replaced | the Examiner writes task instances; contract and checker stay fixed (plan:68, :328) No role in v2 writes or repairs a checker: the operator owns it for now, and the plan's decisions 38 and 47 settle who does |
| Examiner session | none in v1 | writes task instances | open #9, #29 | `src/examiner/session.ts`: instances through gates 1 to 4, one word back (D1b, plan:316). The first live sessions proposed 25 tasks: 14 too hard at gate 2, 6 refused at gate 4, 5 feasible. `supply()` says how the stronger solves of the too-hard ended and what kinds of fault the refused controls held, and `tools/d1b/supply.ts --log` reads it from a log with no session (open #29) |
| difficulty guidance prompts | author/task-battery-difficulty.ts:57, :61 | difficulty to aim for | open #9 | the Examiner's prompt, `src/examiner/prompt.ts` |
| validateTasks | truth/tasks.ts:283 | task schema | replaced | packageGate (gate 1; decisions 23, 25) |
| controls, probes | truth/controls.ts:350; truth/run-controls.ts:439; truth/probes.ts:99 | runs controls against the checker | ported | controlsGate. Who writes controls for Examiner tasks is open. The whole pack's controls, twice, with each check's tally: `tools/c/accept.ts` (open #24) |
| reference solve (F2) | truth/reference-solve.ts:326 | proves a task solvable | replaced | gate 2, a stronger condition passes (plan:151) |
| climb battery admission | run/climb-battery-admission.ts:266 | admits by difficulty | replaced | screen and task states; a driver exists over stored solves only (`tools/m1/admit-sweep.ts`) |
| band placement, fingerprint, claimability | claim/*.ts | band, identity, discrimination | replaced | bracket, `taskVersion`, M2's sign test |
| representation census | run/representation-census.ts:208 | battery coverage | unsure | no plan line |
| per-task limits | harness `agent/config.yaml` | wall and turns per harness | replaced | host-owned `Limits` (decision 18); the per-task value is decision 15, open. v2 ignores a harness's config.yaml. |

## 4. Solver side

| v1 part | v1 location | does | v2 | v2 owner, or why |
|---|---|---|---|---|
| solver prompt, nudge | solve/built-starter.ts:47-153 | system prompt, first turn | replaced | `src/solve/prompt.ts`. The roster line, the nudge and the first turn are the sweep's. The general paragraph is v1's later duty and minutes (built-starter.ts:236-262 at 3f93d06b) with this host's wall: nothing is submitted for the solver. So a solve is not under the sweep's prompt |
| record and submit desk | built-starter.ts:539 and the draft and submission modules | writes, checks, submits the answer | ported | `src/solve/answer.ts` |
| published margin | solve/published-margin.ts | spare margin against limits | unsure | plan:38 names it as a cause; no line keeps or cuts it. The prompt no longer asks a solver to widen a margin it is not shown. A solver has no clock, and is now told so: on 2026-10-08 one said "time is nearly up" and submitted at 56 of 120 minutes (reversing-wind-02), and v1's solve of that task stopped at 43. |
| built bash | solve/built-bash.ts:268 | solver shell | ported | `src/solve/shell.ts`, `src/solve/command.ts` plus the disk cap. A cut command's full output goes to `<home>/.shell-output`, not the host's temp dir, through an optional dir in vendor `output-files.ts` |
| dcg rules | solve/dcg-rules.ts | refuses destructive commands | dropped | V7 (plan:140) |
| generated-tool worker, define-tool | solve/generated-tool-worker*.ts, define-tool.ts | harness tool process and helpers | replaced | `src/solve/harness.ts`, one process per call; `harness-shim.ts` |
| task access trace | solve/task-access-trace.ts | traces task-file access | unsure | the nearest is the moved-files non-result |
| pi-built runtime and child | backends/pi-built*.ts | solver loop in a child | replaced | `play()` in `src/solve/run.ts`, in this process; only commands are walled; 3 reruns. `judge` grades a submitted answer before a crash; only a kill and moved files come first |
| Claude bridge | vendor/pi-claude-bridge | pi model via Claude Code | ported | `src/backends/claude.ts`; Opus 5.5 and Sonnet 5.5 run at a million tokens beside the 5.0 models. Only a solver reads Claude Code's own prompt before its own, as the sweep's did (`ClaudeOptions.preset`) |
| compaction, usage | backends/pi-compaction.ts, pi-usage.ts | context, tokens | ported | Claude Code compacts in its CLI at the window the condition pins (`src/backends/claude.ts`). pi's own loop, for Codex and OpenRouter, runs `src/backends/pi-compaction.ts` before each model call, on pi coding-agent 1.0.4's compaction vendored in `vendor/pi-coding-agent/core/compaction` (pi-agent-core 1.0.4 no longer carries it); each compaction logs `solve.compacted`, `build.compacted` or `exam.compacted`, and its summary counts in the spend. Usage: `src/kernel/meter.ts`. Claude Code's own compactions log the same events from the CLI's `compact_boundary`, as v1's `onCompaction` read it; the summary text v1 read back from the CLI's transcript (`vendor/pi-claude-bridge/compact-summary.ts`) is not read |
| battery runtime isolation | run/built-agent-runtime.ts | sandbox per solve | ported | `src/verify/solve-sandbox.ts`, `solve-command-isolation.ts` |
| Codex, OpenRouter | backends/codex-backend.ts and others | other providers | ported | `src/backends/models.ts`; parked (plan:157) |

## 5. Verifier, sandbox, meter, records, reviewers, reports

| v1 part | v1 location | does | v2 | v2 owner, or why |
|---|---|---|---|---|
| verifier host, evaluator | verify/host.ts:120; truth/verification-runner.ts:510 | runs the evaluator | replaced | `openVerifier` plus check-child.ts; `tools/m0/regrade.ts` matches v1 on 114 of 114 verdicts. A check tool a signal ended, or whose program never started, is a non-result, not a refusal (v1 74b10d9) |
| verifier lifetime | verify/verifier-lifetime.ts | one verifier per campaign | replaced | a cell per check; a verifier non-result stops the run |
| tool inventory, self-grounding, host inputs | verify/*.ts | host tools; evaluator inputs | unsure | no v2 importer |
| OS sandbox | verify/*.ts | Seatbelt and bwrap walls | ported | `src/verify/*` plus `disk-cap.ts` |
| meter, records | pi-usage; claim and truth records | cost; case records | replaced | `meter.ts` (billed beside metered, decision 10); `log.ts` events. Claude Code reports its cost only in a query's `result`, and a submit closes the query before one comes, so a solve that submits logs `reportedCost: null` (the smoke round, 2026-10-08): billed against reported can be read only on a solve that ends otherwise. pi's Responses provider sets no `responseModel`, so a Codex solve's `responseModels` is empty |
| Judge | truth/judge*.ts and others | second grading | dropped | plan:72, plan:47 |
| diagnosis reader, review probe | review/*.ts | reads failed traces; reviewer loop | ported | `src/review/diagnoser.ts`, `probe.ts`, `reader.ts`; M3 waits on G4. The reader's and the Examiner's Claude homes are named `ana-claude-cli-`, which every solver's wall denies; the tool examples name no task domain. A reviewer and an Examiner are sent their own prompt alone and have no built-in tool |
| Referee | none in v1 | rules on disputes | open #8, #11 | `src/review/referee.ts`; the round's Referee advises on screening and scoring fails, and disputes a task only with `--referee-decides` |
| acceptance of a checker | gate/validation-pipeline.ts census and grounding, at submit | every check seen to say no, every control its label | open #24, #26 | `acceptance()` in `src/kernel/acceptance.ts`, run over a stored pack by `tools/c/accept.ts` with no model: controls twice, each check's passes and refusals over controls and stored verdicts, its instrument, its tools on the verifier's path. A fault is reported, never decided on. The reading is logged as `checker.read` under the checker's two hashes (open #26). A check that could not run on an answer is one named fault, and no control is asked for in its place (open #29) |
| reading of a pack's rejections | none in v1 before a pack was used; `notes/` censuses after | whether the answers a checker refused were wrong | open #24 | `tools/c/rejections.ts`: the sweep's rejected answers logged as this verifier grades them, a seeded sample labelled blind by a person, then the Referee on every one; `src/review/rejections.ts` counts, `agreement.ts` sets rulings against labels. Not run with a model |
| reading of a repaired checker | run/experiment-freeze.ts `evaluation-correction`: the agent, tasks and schema fixed, evaluation changed | what a changed evaluator does to results already counted | open #26 | `regraded()` in `src/kernel/acceptance.ts`, run by `tools/c/repaired.ts` over a campaign's log and a repaired pack with no solve: each logged answer under the repaired checks, the verdicts that moved and their tasks. It writes nothing; a repaired checker takes a campaign of its own |
| outcome and triage reports | tools/outcome, tools/runs, tools/run-triage | run reports | missing | fail kinds, flip and repeat rates, supply (plan:254-255, :297, :332). The round's report carries each harness's mean solve seconds over the scored set, beside the tally |
| export | run/bundle-export.ts | an adopted harness as a directory with its own `solve` and `check` | deferred | M4: an export follows adoption. It is also the input format a second domain would take (v1's documented output) |
| Harbor task format | `harbor/` in v1 at `3f93d06`, after 7af7315 | each exported task in Harbor's format | unsure | no plan line |
| outside baseline | v1's README at `3f93d06`: 25 held-out tasks against Prime-agent | a yardstick outside the loop | unsure | v2 claims only child beats parent, under the model pair's ceiling (plan:378); the pilot retests v1's yardstick on the sweep's scripts (plan:12) |
| replay, UI | tools/replay; packages/ui | replay; live UI | unsure | engine replay before the second domain (plan:165); no v2 UI |

## 6. Config, toolchain, models, resume

| v1 part | v1 location | does | v2 | v2 owner, or why |
|---|---|---|---|---|
| backend config, login | .harness/backends; backends/oauth | model per slot; OAuth | replaced | `src/backends/models.ts`, the condition record; `CLAUDE_CODE_OAUTH_TOKEN` |
| model preflight | run/model-preflight.ts:86 | checks the model answers before spending | missing | before the first live D1b solve (plan:264) |
| host identity | run/host-runtime-policy.ts, source-identity.ts | pins the host source | replaced | `condition.host`: the digest of `src/` and `vendor/` as they stand (open #3) |
| toolchain relocation | author/domain-repo.ts:127 | rewrites launchers after a copy | replaced | nothing is relocated (open #13). A harness runs where it is kept. Its `.toolchain` links to a copy of the session's tree kept beside the states, made again only when the tree has changed, so practice after practice reads one copy. A freeze refuses a link or a script that names the Builder's home, so a launcher finds its files from `$(dirname "$0")`, as the stored truss launchers do. |
| solver `.toolchain` | built-bash PATH | first on PATH, hashed | ported | `command.ts`; `harness.ts` hashes the tree. The wall keeps it read-only, where v1's solver could write it: the sweep's `pynite-python` points matplotlib at `.toolchain/mplcache`, which now warns on each run and falls back to a temp cache |
| toolchain install (`.oss`) | builder/verifier-workshop.ts | installs engines | missing | plan:261, :154; a Builder installs into its harness's `.toolchain` (open #13) |
| temp-root sweep, safeguards | meta/temp-scratch-clean.ts, safeguard.ts | stale temp roots; safeguard refusals | ported | both in `src/meta/`, no importer |
| resume | author/campaign-memory.ts:180; tools/runs/resume.ts | resumes a campaign | deferred | M4; the only primitive is the log's repair |
| detached run | tools/fullrun-launchd-publish.ts | runs unattended | replaced | `caffeinate -s` in the live drivers |
| gate, secrets | tools/gate.sh; tools/secrets; .githooks/pre-commit | CI gate; secret scan; the commit's checks | replaced, kept | `.github/workflows/ci.yml` (open #14): typecheck, lint, format and the suite, on a Mac and on Linux under Bubblewrap. `tools/secrets` is kept, and its test scans the tracked tree in CI. The pre-commit is `bun run commit:check`, run by hand: no hook is installed yet. |

## Missing, ranked

Ranked by how much each delays a live round once the open stack lands.

1. **Toolchain install (`.oss`)** (plan:261, :154). The fixed checker and the solvers need the pack's engines.
2. **The first live round.** Ran on 8 October (issue #1): `admit-sweep --log`, `prepare.ts` and `round.ts` with a Claude Builder, a practice solve, an anchor pair and a comparison, $18.81 billed. The Builder changed the solver's side. Left over: `tools/d1b/examine.ts` has not run against a model, and a practice solve still running when the session hits its wall is killed with its spend.
3. **Model preflight.**
4. **Run reports:** fail kinds, flip and repeat rates, supply.
5. **The checker's owner.** Nothing writes or repairs a check program. Phase C's commands read one (open #24), record the reading against its version, let the operator freeze it and show what a repair would move (open #26); the plan's decision 38 names who acts on what they find, and no command yet holds a round until a checker is frozen.
6. **The unsure rows** above, to decide.

Not ranked, as G4 has not passed: the **deferred** rows. They are adopt or hold (select a kept version as the product, or keep the one before), and the controller loop (M4): the fullrun entry, rounds, the next move, terminal stops, the lock, resume, and the Builder's MEMORY.md carried forward.

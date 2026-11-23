# Whole-run investigation lanes

Six deterministic rows settled by the primary reviewer and 23 investigative lanes parsed by `tools/wri/catalogue.ts` (verified against `TRIGGERS` in `tools/wri/folds.ts` by `test/wri-readers.test.ts`).

## Who holds which pen

The Examiner drafts the exam and authors tasks, the Adversarial Draft Auditor (Referee pre-freeze pass) probes mechanically clean drafts before freezing, the Builder develops the harness, the Solver answers tasks inside it, the Verifier decides validity inside a fresh offline sandbox, the Referee adjudicates reproducible rejections, and the Host owns protocol, wall, statistics, and pauses (`AGENTS.md` §1–8):

| Component | Purpose | Inputs & Wall | Outputs & Events | Key Edge Cases | Lanes |
| --- | --- | --- | --- | --- | --- |
| Examiner Drafter (`d-N`) | Drafts rules, scope, conventions, `answerFormat`, `evaluator.ts`, objective, ≥3 examples & controls, optional `.toolchain/` | Operator prompt, solve budget, drafting limits, `draftFaults`, `draftReading` | `draft.*`, `exam.drafted`, `checker.read`, `contract.frozen`, staged `exams/` | Recipe disclosure, scope narrowing, `from_file` faults, broken `.toolchain/` links | `2, 3, 14, 21` |
| Adversarial Draft Auditor (`referee.draft`) | Pre-freeze judge (≤2 passes, 24 turns, 16 probes) trying to break accept controls & deliverables | Prompt, contract, check source, hidden values, accept controls, `priorFindings` (exam side only) | `referee.draft`, `referee.draft.refused`, findings fed back to `d-N` | Ceremony policing, pass-2 cap leak (final defects unverified), drafting spend overhead, `skipped` | `1, 2, 4, 19, 20, 23` |
| Examiner Task Author (`x-N`) | Authors diverse feasible held-out tasks with room above reference in one resting conversation | Brief, contract, check assertions (not source), reference outcomes & winning harness; no targets or harness files | `exam.*`, `propose_tasks`, `try_answer`, `try_reference`, `task.proposed`, `task.gate` | Unique-family collapse, zero-yield sessions, `>=0.98` near-copies, reference targeting, wake drift | `13, 14, 15, 22, 23` |
| Builder (`b-N`) | Builds/refines Built Harness (`tools-spec.json`, `.toolchain/`, `BUILT_AGENTS.md`) and leads campaign moves | Wall (§1 five items only): contract, practice tasks, trajectories + coarse `bandOf` + `callsText` telemetry, tallies, budget | `build.*`, `build.checkpoint`, kept `states/<digest>/`, `MEMORY_FILE` | `HOST_ONLY` leaks, guide bloat, dead `.toolchain/bin`, untried freezes, `prac_fam` overfitting, compaction amnesia | `8, 9, 10, 11, 12, 14, 15, 22` |
| Solver (`s-N`) | Solves one task inside Built Harness under host turn & wall limits | Public task/files/resources, harness guide + `.toolchain/bin`, pinned `COMPARISON_REACH` network | `solve.*`, `answer.json`, `deliverables/`, `solve.finished` (with `network`) | Cross-arm `network` drift, high tool errors, asymmetric limits, `/tmp` sharing, model swap | `10, 14, 15, 17, 18, 22` |
| Verifier (code) | Evaluates submitted answer & deliverables inside fresh offline OS sandbox | Frozen `checks/`, `.toolchain/`, `host-tools.json` (`origin: "draft"`), hidden values, submitted files | `verdict` (`pass`/`fail`/`faulty`), check breakdown, objective, `toolCeilingMs` | Zero-applicable-check `faulty`, non-finite `timeoutMs`, offline `.toolchain/` denials, nondeterministic replay, Rule-10 bypass | `1, 3, 4, 18, 21` |
| Referee Adjudicator (`referee.finding`) | Adjudicates reproducible rejections on exam side with conclusive `probe_check` evidence | Contract, task, hidden values, refused answer/files, check source, replay verdict | `referee.finding` (`earned`/`check-defect`/`unclear`), `referee.refused` | Unprobed `earned` restatements, cap expiries, asymmetric set-asides flipping readings, uncalibrated without human labels | `4, 5, 14, 19, 23` |
| Host Controller (code) | Enforces append-only log, wall, epoch practice release, paired comparisons + A/A, `decide`, starter reads, pauses | Append-only `log.jsonl`, operator `campaign.word` (hidden from all seats), host load & locks | `campaign.*`, `comparison.*`, `harness.promoted`, `task.state`, `campaign.ended` | Pre-promo practice leaks, pause overshoot, fragile `spare === 0` steps, underpowered no-steps, billing residuals | `6, 7, 16, 18, 19, 22, 23` |

Six principles govern every lane:
- **Weigh verdicts by instrument**: pinned domain engines outweigh author-computed checks.
- **Verify condition identity**: paired solves must differ solely in the harness.
- **Separate outcomes**: valid answers, earned rejections, limit expiries without submission, and non-results.
- **Treat rulings as readings**: `earned` without a clearing probe merely restates the check; Referee accuracy and pass soundness remain unmeasured until blind human labels exist.
- **Evaluate comparisons on untied tasks**: ties carry zero weight; intra-harness flips measure variance; set-asides drop rejected-arm losses.
- **Separate observation from inference** in two distinct sentences.

## How the catalogue is read

Triggers from `bun tools/wri/wri.ts read` point where to inspect, never what to conclude; refuting a trigger from raw bytes completes the lane. Lanes 1, 2, 6, 7, 8, and 14 are `standing`; lane 5 runs `alone`; lane 8 runs `blind` before any other lane in its session; lane 7 runs `side-by-side` across campaigns. Name one owner from the table below and cite event kinds, solve ids, 8-char digests, check ids, and counts (never quote task text, answers, hidden values, check failure messages, or traces):

| owner | what it is |
| --- | --- |
| `pack/evaluator`, `pack/brief`, `pack/controls`, `pack/tasks` | exam files (drafted or stored) |
| `examiner/task` | Examiner-authored task instance |
| `harness/guide`, `harness/tools`, `harness/tool-tree`, `harness/config` | Built Harness component |
| `builder-prompt`, `examiner-prompt`, `reviewer-prompt` | seat instructions (`src/` file) |
| `host` | host code (`src/` or `tools/` file) |
| `environment` | host machine or model provider |
| `operator` | human-authority decision |

## Tools a lane runs

Run read-only as `bun <path> ...`:

| Question | Command |
| --- | --- |
| Event kinds/fields/lines | `tools/wri/log.ts kinds --log <log> [--kind <k,...>]` |
| Filter/group events | `tools/wri/log.ts events --log <log> (--kind <k,...> \| --lines <a[-b]>) [--fields a,b.c] [--where f<op>v]... [--count-by f[,g]] [--full]` |
| Filter/group solves | `tools/wri/log.ts solves --log <log> [--comparison <id>] [--role old\|new\|both\|try\|practice] [--where c<op>v]... [--count-by c[,c]]` |
| Seat turns & calls | `.claude/skills/oracle-handover/scripts/slice.ts <log> 'Solver:<id>'` (`'Builder:b-2{1-3}'`, `'Builder:b-1[compare,wait,practice]'`, `--count`, `--whole`) |
| Rejection checks/rulings/probes | `tools/wri/rejections.ts <log> --solve <id>` |
| Public task input/schema/rows | `tools/wri/tasks.ts <log> --task <id>`, `--shape`, `--rows` |
| Solves matching command/output | `tools/wri/calls.ts --log <log> --list (--command <re> \| --output <re>) [--harness <prefix>]` |
| Harness diff / blind chain | `.claude/skills/harness-audit/scripts/harness-versions.ts <log> --diff <d> [--against <d>] [--files \| --lines]`; `--chain [--lines]` |
| Winning-solve programs vs diff | `tools/wri/parts.ts --log <log> --comparison g-N [--no-diff] [--all]` |
| Starter read by task origin | `.claude/skills/comparison-reading/scripts/starter-reads.ts <log> --tasks` |
| Decision table vs actual moves | `tools/wri/table-timeline.ts <log>` |
| Ending state at line/time | `.claude/skills/campaign-mechanics/scripts/ending.ts <log> --at <line \| ISO>` |
| Sibling runs from same prompt | `tools/wri/drafted.ts <log> --siblings` |
| Archive summary table | `.claude/skills/promotion-tuner/scripts/table.ts --runs <dir>` |
| Re-grade answer (permitted lanes) | `tools/wri/wri.ts grade --log <log> (--task <id> --answer <f> \| --solve <id>) [--set <path>=<json>]...` |

Place scratch scripts in a temporary directory (`bun <tmp>/x.ts <log>` or `python3 -B <tmp>/x.py < <log>`), never inside a campaign folder.

## Labels

Maps PR and prediction labels (`checkLabels`, `tools/runtime/land.ts`) to lanes:

| point | lanes | label | changes |
| --- | --- | --- | --- |
| verdicts | 1, 2, 3, 14, 20, 21 | `exam` | drafting, draft audit, checks, verifier grounding, deliverables, verifier, controls, freeze/admission, seat prompts |
| verdicts | 4, 5 | `verdicts` | Referee, set-asides, hand labels, `settle.ts` |
| supply | 13 | `supply` | task authoring, `try_reference`/`try_answer`, admission, Examiner inputs |
| climb | 9 to 12 | `harness` | Builder session/tools/practice/bands, harness contract, export portability |
| honesty | 6 | `comparison` | terms, pairing, scored set, tally, statistical test, A/A, conditions |
| climb | 7, 8, 15, 16, 23 | `climb` | move table, campaign moves, starter reads, promotion, compaction/handover, pause boundaries, endings |
| honesty | 17 | `solve` | solve execution, backends, tool friction, limits, non-results, solver prompt |
| economy | 19 | `economy` | billing, metering, budget, timing readers |
| honesty | 18, 22 | `runs` | sandbox wall, cross-seat wall, network parity, isolation, launching/moving runs, logins, hosts, launch receipts |
| honesty | rows A to F | `log` | log schema, event kinds, conditions, folds, `view`, `replay`, UI |
| none | none | `investigation` | `tools/wri/`, this catalogue, WRI skill & scripts |
| none | none | `landing` | PR stack, `land`, git hooks, CI gate |
| none | none | `quality` | lint, simplify census, size policy, style |
| none | none | `docs` | `AGENTS.md`, `docs/`, prose |

## Deterministic rows A to F

Settle from `bun tools/wri/wri.ts read --log <log>` before opening lanes:
- **A. campaign & log**: `log.jsonl`, `exams/`, `states/`; verify clean fold, host hash vs checkout, billed USD & wall hours by role.
- **B. checker identity**: contract & check hashes from `contract.frozen` and `checker.read` (+ `despite` fault count).
- **C. conditions**: distinct condition values by arm/model + completed solves missing `responseModels` + served-model degradation line.
- **D. task sets**: versions by origin (`session`/`carried`/draft) and state; practised and scored sets must stay disjoint (`PRACTISED TASK MEASURED`, lane 18).
- **E. case partition**: per arm—passes, fails by kind (`rejected` with check ids), `flagged`, non-results, unfinished.
- **F. sessions & chain**: moves (incl. open move), endings, spend vs cap, Builder parent/child digests, practice activity, comparison readings (`g-N`), Examiner proposed/admitted counts.

## Lanes 1 to 23

### Exam and verification

**1. Pass soundness and check falsification.**

Label: `exam`.
Importance: 0.85.
Marks: `standing`.

Starts from `INSTRUMENT AUTHORED (lane 1)`, `PASSES UNREAD (lane 1)`, `PASSES LABELLED (lane 1)`, `REFUSALS BY CHECK (lane 1)`, `NO CHECKER READING (lane 1)`, `CHECKER READ WITH FAULTS (lane 1)`, `CONTROL COVERAGE (lane 1)`, `CHECKER NOT FROZEN (lane 1)`, `FROZEN DESPITE FAULTS (lane 1)`, `READ AT ANOTHER VERSION (lane 1)`, and `TASKS CARRIED (lane 1)`, and is standing.

What does a passing verdict actually prove, and do the checks enforce domain correctness or merely syntax? Align `checks.txt` (`checker.read` instrument, control coverage, and refusals) with `exams/<digest>/checks/brief.json` and the check program source. Sample passing solves across task families and harnesses (weighting 0-refusal checks) and actively perturb them with `wri.ts grade --solve <id> --set <path>=<json>` to expose unread fields, unenforced rules, or loose tolerances. Audit the objective arithmetic first when valid answers dominate: does it reward genuine domain quality or gaming tolerance boundaries? Flag every `author` check lacking a pinned domain engine (rule 10; grounding `F32`). When `PASSES LABELLED` fires, verify `passAgreement` (`src/referee/agreement.ts`) against the pass-soundness bar (at least 20 decided passes, at most 10% wrong); otherwise note that passes remain uncalibrated by a human. Ignore Examiner rehearsal (`try-`) solves when counting scored refusals. Decision: whether a pass proves domain correctness and whether the objective is trustworthy. Routes to `pack/evaluator`, `pack/brief`, `pack/controls`, and `operator`.

**2. Drafted exam against the prompt.**

Label: `exam`.
Importance: 0.75.
Marks: `standing`.

Starts from `EXAM DRAFTED (lane 2)` and `PASSES AT A SMALL WALL SHARE (lane 2)`, and is standing.

Does the drafted exam faithfully measure the operator's prompt without narrowing scope or disclosing the solution recipe? Compare the prompt in `campaign.opened` against the standing draft's rules, conventions, scope, answer format, objective (or `unmeasured` rationale), and checks (`drafted.txt`). Count failed draft attempts by fault kind (`draftFaults`, `draftReading`) and verify whether the accepted draft fixed or silently deleted the requirement (including `from_file` failures or dropped constraints). Check whether rules, conventions, or public inputs disclose the check arithmetic or a one-step recipe (`PASSES AT A SMALL WALL SHARE`, `sequences.txt` showing one deterministic program sequence across passes). Flag any author-computed check that an installed domain engine could decide instead. Decision: whether the campaign measures the requested domain at real difficulty. Routes to `examiner-prompt` (`src/examiner/draft.ts`), `pack/brief`, `pack/evaluator`, and `operator`.

**3. Deliverables and file-artifact verification.**

Label: `exam`.
Importance: 0.6.
Marks: none.

Starts from `DELIVERABLES CAPTURED (lane 3)` and `NO DELIVERABLES CAPTURED (lane 3)`.

When the domain asks for work products under `deliverables/` (`src/kernel/answer-files.ts`), did capture preserve them cleanly and did the checks actually verify their content? Inspect `deliverables.txt`, `states/deliverables/`, and the check program source (`exams/<digest>/checks/`). Verify whether solvers produced the requested artifacts, whether any solve hit the 64-file or 16 MiB capture cap, whether UTF-8 decoding or zip member extraction (`zipTexts` for workbooks/documents) lost content silently, and whether checks read `files`/`entries` semantically rather than checking only file existence or JSON fields. Check whether draft controls and `try_answer` supplied realistic `ControlFile`s (`task.feasible` currently retains no deliverable files) and whether Referee probes used `file:<path>` on file-based rejections. Decision: whether deliverable capture and file-content checks work end to end. Routes to `pack/evaluator`, `pack/controls`, `host` (`src/kernel/answer-files.ts`, `src/kernel/verify.ts`), and `operator`.

**4. Rejection rulings and Referee calibration.**

Label: `verdicts`.
Importance: 0.6.
Marks: none.

Starts from `REFUSED UNREAD (lane 4)`, `CHECK DEFECT RULED (lane 4)`, `RULED UNCLEAR (lane 4)`, `REPLAY MOVED THE VERDICT (lane 4)`, `SET ASIDE AND UNSETTLED (lane 4)`, `READING MOVES WITH THE SET-ASIDE (lane 4)`, `SET ASIDE BY SIDE (lane 4)`, `SETTLED BY HAND (lane 4)`, `REVIEW FAULTS (lane 4)`, `EARNED WITHOUT A PROBE (lane 4)`, `RULINGS REFUSED (lane 4)`, and `SCORED SET MOVED (lane 4)`.

Was each rejected answer genuinely invalid, are Referee rulings backed by evidence, and did set-asides bias any comparison tally? Group rejections by check id and ruling (`rejections.txt`, `restated.txt`), verifying that `earned` rulings cite a rule and field with a probe (`EARNED WITHOUT A PROBE` counts mere check restatements) and `check-defect` rulings cite a probe clearing the refusal. Flag non-deterministic checks (`REPLAY MOVED THE VERDICT`), asymmetric set-asides (`SET ASIDE BY SIDE`), readings flipping between `scored` and `counted` (`READING MOVES WITH THE SET-ASIDE`), tasks dropped after `comparison.started` (`SCORED SET MOVED`), and `referee.refused` retries (`RULINGS REFUSED`). Where human labels exist (`SETTLED BY HAND`), verify blind packet origin and compare Referee rulings against the `AGENTS.md` §1 agreement bar (`src/referee/agreement.ts`); otherwise qualify rulings as one uncalibrated automated reader. Where public rules cannot decide a check, keep the standing ruling and refer it to lane 5. Decision: whether rejections and set-asides can be trusted. Routes to `pack/evaluator`, `pack/brief`, `reviewer-prompt`, `host`, and `operator`.

**5. Constructive valid-alternative challenge.**

Label: `verdicts`.
Importance: 0.3.
Marks: `alone`.

Starts from `FAILS ON ONE CHECK (lane 5)` and `DEFECT RULED BESIDE PASSES (lane 5)`, and only when lane 4 left a check undecided. It runs alone.

Does a disputed check reject constructively valid solutions? Read only the public exam via `bun tools/wri/public-exam.ts <log>` (public rules, scope, answer format, released practice tasks, and practice passes). Before opening the check program, Referee probes, or any lane report, construct valid alternative answers satisfying every published rule while differing in a permitted way (alternative valid design, allowed rounding, or equivalent unit) and record their SHA-256 digests. Only after freezing those digests, evaluate them with `wri.ts grade --log <log> --answers <dir>` and report the 2x2 table of constructively valid versus verifier-accepted answers, naming every refusing check. Exclude and count any candidate whose validity cannot be proven from public rules alone, and never derive candidates from recorded held-out answers. Decision: whether the check must be repaired, supplying the corpus as accept controls. Routes to `pack/evaluator` and `pack/controls`.

### Comparison and climb

**6. Comparison power, signal and noise.**

Label: `comparison`.
Importance: 0.9.
Marks: `standing`.

Starts from `NOTHING SCORED (lane 6)`, `CUT BY ITS CAP (lane 6)`, `SET SHORT (lane 6)`, `TIED TASKS (lane 6)`, `TIES BETWEEN VALID ANSWERS (lane 6)`, `NO VALID ANSWER (lane 6)`, `AWAITING A LABEL (lane 6)`, `SAFEGUARD-9 PROMOTION BEYOND VALIDITY (lane 6)`, `STEP CARRIERS (lane 6)`, `FLIPS (lane 6)`, `REFERENCE AGAINST ITSELF (lane 6)`, and `MARGINS INSIDE THE NOISE (lane 6)`, and is standing.

What could each comparison detect at its sample size, which measure carried it, do winning margins clear rollout noise, and does a step generalise across tasks? Inspect `readings.txt`, `scores.txt`, `pairs.txt`, `zone.txt`, `diagnostics.txt`, and `nearness.txt`:
1. **Power and ties**: for every comparison, report untied tasks, wins/losses, p-value, `detectable`, `falseRate`, frontier vs retained split, tie classes (`pairs.txt`), and unsolved tasks awaiting human labels (`AWAITING A LABEL`). Treat `not-scored` and `CUT BY ITS CAP` as no test, and underpowered `no-step` as no evidence of equivalence.
2. **Measure split**: separate validity wins from objective-only wins (`SAFEGUARD-9`, `replay.txt`, `scores.txt`). Report whether validity saturated across tasks.
3. **Variance and noise floor**: read per-arm `FLIPS` and the A/A control (`REFERENCE AGAINST ITSELF`, split by `validity` vs `objective` measure slices in `src/campaign/climb.ts`). For objective-only steps (`MARGINS INSIDE THE NOISE`), compare each win's margin against the wider of both sides' own self-differences on that task; distinguish deterministic repeated answers (`scores.txt` repeat line), consistency gains against a noisy reference, and raw noise. Where A/A tied completely, cite `Starter against itself` and state the substitution. Estimate required solves per side with `comparison-reading/scripts/size.ts --scores <s,s,...>` and its cost; never propose raising `GAP_FLOOR` or altering terms post hoc (rule 4).
4. **Generalisation**: for each step (`STEP CARRIERS`), find the smallest subset of top wins whose removal breaks significance (`scores.txt` leave-one-out), identify shared traits (family, writing session, scale, reach, `nearness.txt`), and cross-check carrying wins against reference A/A splits.

Decision: whether each reading is trustworthy, general or noise-driven, and whether sample size or validity headroom must change. Routes to `operator`, `host` (`src/kernel/compare.ts`), `examiner/task`, and `examiner-prompt`.

**7. Climb, confirmation and batch generalisation.**

Label: `climb`.
Importance: 0.9.
Marks: `standing`, `side-by-side`.

Starts from `PROMOTED (lane 7)`, `STARTER BARE (lane 7)`, `AFTER THE PROMOTION (lane 7)`, `VALID BY HARNESS (lane 7)`, `PROMOTION UNCONFIRMED (lane 7)`, and `CHAIN AGAINST THE STARTER (lane 7)`, and is standing. Where several campaigns are under review, it receives `wri.ts climb` side by side.

Did each promotion confirm on unseen tasks that did not select it, how many independent writing batches back it, and did the chain genuinely beat the Starter? Inspect `starter-reads.txt`, `transfer.txt`, `climb.txt`, `epoch-spend.txt`, and `starter-reads.ts --tasks`:
1. **Promotion rule and confirmation**: verify each `PROMOTED` authority (move table vs manual `promote.ts` with `despite`), whether the starter read was the epoch's first tallied comparison (`heldSince`), and why any `PROMOTION UNCONFIRMED` occurred (open epoch, stalled post-promotion supply, displaced read, or Starter match). Flag `STARTER BARE` when the baseline failed most tasks.
2. **Selection bias vs post-promotion transfer**: split every starter read by task origin (`chosen`, `before`, `after`) and by validity vs objective (`starter-reads.txt`). Report the exact selection-only false confirmation count and denominator (`stepCount`, `selection.ts`) holding pre-promotion margins fixed, alongside standalone `after` readings and fleet totals (`starter-reads.ts --all`).
3. **Batch independence (`k`)**: count distinct Examiner writing sessions authoring post-promotion tasks (flagging sessions spanning the promotion) and assess between-batch dispersion; `k = 1` is one batch draw regardless of task count, and a batch sign test clears 0.02 only at `k >= 6`.
4. **Chain vs Starter**: when `CHAIN AGAINST THE STARTER` fires or post-promotion wins lag, separate selection-on-noise (compare against `Starter against itself` and `Repetition`), Examiner targeting (stable Starter paired with falling reference by writer session), and genuine harness regression (cross-referenced with lanes 8 and 9). Propose a neutral blind evaluation (`compare-systems`) with sample size for operator approval where needed; never propose raising `GAP_FLOOR` or lowering the significance level.
5. **Multi-campaign climb**: when reviewing several campaigns, align by move index from `wri.ts climb` (cost to promotion, tallies vs A/A, validity room, confirmation, spend per epoch) while noting confounders from lane 18.

Decision: whether the climb counts toward milestones and whether to continue, pause, or commission a neutral evaluation. Routes to `host` (`src/campaign/climb.ts`, `src/campaign/decide.ts`), `examiner-prompt`, `harness/guide` or `harness/tools`, and `operator`.

**8. Blind reach and soundness grading.**

Label: `climb`.
Importance: 1.
Marks: `standing`, `blind`.

Starts from every kept harness version and scored task, and is standing. It grades blind, so any session holding it completes it before opening any other lane or outcome file.

Did the harnesses build genuine domain capability on hard tasks, or merely clear easy tasks or objective noise? Complete all blind grades before inspecting any outcome file, recording each grade as it settles:
1. Read `chain.txt` (`harness-versions.ts <log> --blind`) and inspect diffs (`--chain --lines`, or `--diff <d> --lines` without outcomes) to assign soundness grades. List missing local states (`versions.txt`) under `## Not read`.
2. Read `tasks.txt` (`tools/wri/tasks.ts`, `--shape`, `--task <id>`, `--rows`) beside `exams/` checks and assign reach grades.
3. Only after locking all blind grades, unseal `versions.txt`, `readings.txt`, rows D–E, and remaining derived files to check whether winning tasks align with where harness diffs act and whether weight grew with flat soundness.

Both scales run from 0 to 7 and are reviewer assessments never exposed to any seat.

**Reach** measures how difficult a held-out task is for a strong current model working in the domain, judged from its public text, rules, and checks:

- 0: one lookup, or a direct transform of the input;
- 1: a routine method applied once;
- 2: a few standard steps, one constraint at a time;
- 3: several steps with one subtlety of the field that a careful generalist catches;
- 4: constraints that interact, or the field's own engine used with care;
- 5: specialist work: a method a generalist would not choose, or a tolerance that punishes approximation;
- 6: work a specialist gets wrong on a first pass;
- 7: the field's edge, where no published method fits whole.

Define domain-specific criteria for each rung first so a second grader would agree. Once unsealed, compare each grade against the reference's valid rate and regrade once any task graded 5+ that the Starter consistently answers validly. Report version reach as the highest grade solved validly on most attempts (or objective gain by grade when validity saturated).

**Soundness** measures whether a version's changes are appropriate for the domain, judged strictly from its diff against its parent:

- 0: it breaks or misleads: the guide claims what no tool does, or a tool fails its own call;
- 1: it is fitted: it names practice content or narrows to the practice set's shapes (lane 9);
- 2: churn: rewording or reordering no solve could follow;
- 3: plausible but narrow: it helps a few task shapes;
- 4: sound for one part of the domain, stated generally;
- 5: sound across the domain's kinds of task, and the solves call what it added;
- 6: a method a specialist would teach, with its own checks;
- 7: what an expert would adopt unchanged.

Place grading tables under `## Grades` between the verdict line and `## Findings` (version chain table, then comparison reach distribution of won vs lost tasks), and append tab-separated rows under `## Grade rows` (`task<TAB>campaign<TAB>id<TAB>grade`, `version<TAB>campaign<TAB>digest<TAB>grade`) for `wri.ts trajectory --grades`. Never sum reach and soundness. Decision: whether the climb reflects genuine capability and whether a promoted reference merits external evaluation. Routes to `operator`, `harness/guide`, `harness/tools`, `examiner-prompt`, and `builder-prompt`.

### Harness, practice and external transfer

**9. Harness delta, guide truth and memorisation.**

Label: `harness`.
Importance: 0.85.
Marks: none.

Starts from `HARNESS CHANGED (lane 9)`, `BROKEN AT END (lane 9)`, `MEASURED AN EARLIER STATE (lane 9)`, `TOOLS EDITED (lane 9)`, `NEVER CHECKED (lane 9)`, `TOOLS CALLED (lane 9)`, and `TOOL CALLS ERRED (lane 9)`.

What exact bytes changed between parent and child harnesses, does `BUILT_AGENTS.md` truthfully describe shipped `.toolchain/` tools and solver behaviour, and does any file violate the content restriction? Diff kept states component by component (`harness-versions.ts --diff <d>`) rather than trusting `edit` calls or Builder notes, noting any unmeasured edits after a broken end (`BROKEN AT END`, `MEASURED AN EARLIER STATE`). Audit every harness file against the Builder's sole content rule (no task id, task text, or hardcoded answer) using `names.txt` as a lead. Reconcile three sources: (1) guide claims (methods, flags, checks, defaults, workflows), (2) shipped `.toolchain/` implementation (complete, partial, or stubbed), and (3) observed solver calls (`calls.txt`, noting intentional vs broken non-zero exits and unused tools). Also check `src/solver/prompt.ts` against the logged condition. Decision: what a step should be attributed to and whether inaccurate instructions or content violations occurred. Routes to `harness/guide`, `harness/tools`, `harness/tool-tree`, `builder-prompt`, and `host` (`src/builder/session.ts`, `src/builder/tools.ts`).

**10. Win attribution and answer provenance.**

Label: `harness`.
Importance: 0.7.
Marks: none.

Starts from `WINS (lane 10)`, `WIN AT A SMALL WALL SHARE (lane 10)`, and `ANSWER FROM A PROGRAM (lane 10)`.

Which harness component produced each winning task, and where did every deciding answer value originate? Read winning traces BEFORE inspecting the harness diff. Focus on promoted steps and unbilled untied wins (`readings.txt`, `parts.ts --comparison g-N`, mapping tasks via `frontier.of` and `retained.of`). Classify each win's first trajectory divergence: (1) newly added or modified tool, (2) guide instruction absent from reference, (3) different solver approach independent of harness diff, or (4) identical approach with different outcomes (solver variance). Trace deciding leaf values chronologically using `tools/wri/provenance.ts --log <log> --wins g-N` (and `slice.ts` for `nowhere` entries) to distinguish tool computation from public input, solver reasoning, guide statements, or hardcoded constants emitted regardless of input. Strictly causal attribution requires a `programs-of:<digest>` ablation (`AGENTS.md` §9); this lane targets that ablation. Decision: provisional credit per component and detection of shortcuts or hardcoded constants. Routes to `operator`, `harness/tools`, `harness/guide`, and `host`.

**11. Practice feedback, band discipline and family transfer.**

Label: `harness`.
Importance: 0.75.
Marks: none.

Starts from `NO PRACTICE (lane 11)`, `FINAL BYTES NEVER PRACTISED (lane 11)`, `PRACTICE FAILS (lane 11)`, `PRACTICE CONCENTRATION (lane 11)`, and `PRE-PROMOTION PRACTICE RELEASED (lane 11)`.

Did the Builder use practice solves as honest empirical feedback, did coarse objective bands prevent hidden-parameter inference, did epoch-scoped practice releases work cleanly, and did gains transfer to unpractised task families? From `practice.txt`, `transfer.txt`, and `build.call`:
1. **Empirical discipline**: count practice solves per comparison, unpractised comparisons (`NO PRACTICE`, `FINAL BYTES NEVER PRACTISED`), `read_trace` and `check_harness`/`preview_harness` usage, earned fails repaired under edited bytes vs same-bytes flips, and edits made without practice evidence or chasing check defects.
2. **Band and channel discipline**: verify `build.call` practice results under an objective report only coarse bands relative to the author's best (`bandOf`, `src/builder/tools.ts`) without leaking raw numeric measures. Inspect `PRACTICE CONCENTRATION` (4+ practice solves on one task) for calibration or parameter-inversion attempts.
3. **Epoch-scoped release & family transfer**: inspect `PRE-PROMOTION PRACTICE RELEASED` (whether `beforePromotion` and `newTasksLimit` in `src/kernel/reports.ts` / `src/campaign/decide.ts` kept prior-epoch tasks out of practice and bounded small batches). Cross-tabulate post-promotion starter-read outcomes (`starter-reads.ts --tasks`, `practice.txt`) on practised task families versus unpractised families to distinguish genuine domain transfer from family overfitting.

Decision: whether practice feedback and release scoping steer genuine transfer or overfitting. Routes to `builder-prompt`, `host` (`src/builder/tools.ts`, `src/kernel/reports.ts`, `src/campaign/decide.ts`), `harness/guide`, and `operator`.

**12. Harness portability and external-transfer readiness.**

Label: `harness`.
Importance: 0.7.
Marks: none.

Starts from `BUILT HARNESS FOR EXPORT (lane 12)`.

Would the promoted harness transfer cleanly outside this campaign's drafted exam and runtime (such as `runs bench` external evaluation)? Inspect `portability.txt`, `diagnostics.txt`, and each promoted or top candidate harness under `states/<digest>/` (`BUILT_AGENTS.md`, `agent/tools-spec.json`, `.toolchain/`):
1. **Exam-format vs domain coupling**: distinguish domain-general methodology and tools (`src/builder/prompt.ts`, `HARNESS.md`) from code or guide prose coupled to this exam's exact JSON keys, manifest template, file paths, or check-specific wording.
2. **Runtime and packaging portability**: check `.toolchain/` scripts for hardcoded absolute paths, host-specific binaries, unpinned Python/package assumptions (`ANA_PYTHON`, `uv`), broken relative imports, or missing executables when exported via `runs bench` / `score.ts tree` to another OS or runtime.
3. **Guide signal-to-noise**: check whether `BUILT_AGENTS.md` grew bloated or overly prescriptive in ways that distract a solver on unfamiliar tasks.
4. **Outside record alignment**: if an external evaluation exists for this campaign in its cycle's `outside-reads.md` or `data/bench/` (read-only), note whether internal wins align with external scores without proposing any benchmark-fitted prompt or exam change (`AGENTS.md` §1, rule 2).

Decision: whether the harness is portable and domain-general enough to merit external evaluation and transfer. Routes to `builder-prompt` (`src/builder/prompt.ts`, `src/harness/starter.ts`), `harness/guide`, `harness/tools`, `host` (`tools/runs/bench.ts`), and `operator`.

### Supply, seats and campaign control

**13. Examiner supply, authoring and targeting.**

Label: `supply`.
Importance: 0.8.
Marks: none.

Starts from `OUTCOMES BY SESSION (lane 13)`, `SUPPLY THIN (lane 13)`, `GATE REFUSED (lane 13)`, `EXAMINER ZERO YIELD (lane 13)`, and `FAMILY CONCENTRATION (lane 13)`.

How effectively did the Examiner convert turns and tool calls into diverse held-out tasks with genuine validity headroom, and did reference feedback skew post-promotion tasks? Inspect `exams.txt`, `ambition.txt`, `aim.txt`, `draw.txt`, `nearness.txt`, and `exam.call`:
1. **Authoring workflow & stalls**: audit `try_reference` spend and responses (`roomLine` in `src/examiner/write.ts`), `try_answer` failures, `from_file` and shell errors (`src/examiner/shell.ts`), and `task.gate` refusals (`GATE REFUSED`, `SUPPLY THIN`). For every `EXAMINER ZERO YIELD` session, pinpoint why zero tasks were held (e.g. reference saturation, misread room signal, shell failures, or budget/turn cap).
2. **Diversity and family concentration**: check `FAMILY CONCENTRATION` and `nearness.txt` for template collapse or one family dominating the held-out pool (which enables cross-task parameter priors).
3. **Reference targeting vs difficulty growth**: chronologically compare Examiner inputs (`src/examiner/record.ts`) against per-session validity and objective outcomes (`OUTCOMES BY SESSION`, `aim.txt`, `starter-reads.ts` per-writer lines). Stable Starter validity paired with falling reference validity indicates adversarial reference targeting rather than genuine difficulty growth. Never propose numeric pass-rate targets or quotas (`AGENTS.md` §2).

Decision: what limits informative task supply and whether Examiner prompts, tools, or inputs need revision. Routes to `examiner-prompt` (`src/examiner/prompt.ts`, `src/examiner/write.ts`), `examiner/task`, `host` (`src/kernel/task.ts`, `src/examiner/shell.ts`, `src/examiner/record.ts`), and `operator`.

**14. Seat prompts and tool surfaces.**

Label: `exam`.
Importance: 0.7.
Marks: `standing`.

Starts from each seat's opening at the campaign's commit, and is standing.

Did any seat's prompt or tool result prescribe a strategy, supply a numeric target, present a stale, false, or duplicated fact (`AGENTS.md` §2), or leak across a seat boundary? At the launch receipt's commit, audit Examiner prompts (`src/examiner/draft.ts`, `src/examiner/prompt.ts`, `examiner-view.txt`, `wakes.txt`), Builder prompts and tool results (`src/builder/prompt.ts`, `builder-view.txt`, `build.call`), Solver prompts (`src/solver/prompt.ts`), and Referee prompts (`src/referee/referee.ts`). `wakes.txt` diffs reconstructed Examiner openings/wakes against logged text to separate code drift from misserved facts; `slice.ts '<Seat>:<id>[<tool>]' --count '<phrase>'` counts served phrases. Prompt sentences may be quoted directly. List every prescriptive sentence or inaccurate fact that visibly altered a move, citing the confirming event. Verify `build.call` never exposed Referee rulings, check ids, refusal reasons, or raw hidden measures, and audit Examiner inputs against `AGENTS.md` §3. Remedies delete prescriptive text or fix wrong folds—never add targets. Decision: whether seat prompts or tool-result folds need revision. Routes to `examiner-prompt`, `builder-prompt`, `reviewer-prompt`, and `host` (`src/builder/past.ts`, `src/builder/tools.ts`, `src/examiner/session.ts`).

**15. Seat continuity, compaction and handover.**

Label: `climb`.
Importance: 0.6.
Marks: none.

Starts from `BUILDER COMPACTED (lane 15)`, `EXAMINER COMPACTED (lane 15)`, `SOLVER COMPACTED (lane 15)`, `SESSION ENDED (lane 15)`, and `INTERRUPTED HANDOVER (lane 15)`.

Across long-lived Builder conversations, resting Examiner conversations, compactions, and crash/kill handovers, did seats preserve essential state without repeating work or dropping context? Inspect `continuity.txt`, `diagnostics.txt`, `launches.txt`, `build.call`, `exam.call`, and `solve.call`:
1. **Compaction recovery**: for every `build.compacted`, `exam.compacted`, `draft.compacted`, and `solve.compacted` event, inspect `tokensBefore`, duration, `error`, and whether the seat followed the `read_opening` cue (`REREAD`, `src/agent/session.ts`, `src/examiner/session.ts`). Verify whether post-compaction turns repeated earlier edits, practice calls, or task proposals (`docs/plan.md` `F20`).
2. **Resting Examiner wakes**: check multi-ask Examiner conversations for `guardAsk` trailing-tool-call faults, context drift across promotions, or lost awareness of newly promoted references.
3. **Interrupted handover**: for every `SESSION ENDED` (non-`finished`) and `INTERRUPTED HANDOVER`, verify that `startTold` (`src/builder/past.ts`), `keepPractised`, and `MEMORY_FILE` (`src/builder/memory.ts`) surfaced the exact surviving harness tree and notes cleanly to the successor session, and note remaining practice budget and turns at cutoff.

Decision: whether long-horizon continuity, compaction cues, or interrupted handover lose state or waste turns. Routes to `host` (`src/agent/session.ts`, `src/examiner/session.ts`, `src/builder/past.ts`, `src/builder/memory.ts`), `builder-prompt`, `examiner-prompt`, and `environment`.

**16. Campaign control and decision-table adherence.**

Label: `climb`.
Importance: 0.7.
Marks: none.

Starts from `CHAIN (lane 16)`, `NO TASK HELD OUT (lane 16)`, `ENDED AND WENT ON (lane 16)`, `OPERATOR WORDS (lane 16)`, `FIRST COMPARISON HELD OFF (lane 16)`, and `UNDERPOWERED NO-STEPS (lane 16)`.

Which single pipeline link blocks the next promotion, and did campaign moves, serialization, pauses, and endings faithfully execute the decision table? Traverse the latest epoch's chain (`CHAIN`, row F) and stop at the first failing link: (1) frontier tasks >= `comparisonFloor`, (2) Builder harness edit & practice, (3) comparison power & untied count, (4) move-table execution (including owed starter read via `heldSince`), (5) termination (`stopRule`, `roomless`, `budget`, `idleOf`). Replay transitions with `tools/wri/table-timeline.ts <log>`:
- Audit `FIRST COMPARISON HELD OFF` (time between `admissible` and first `compare`, distinguishing deterring `wait` messages from productive Builder work).
- Audit `UNDERPOWERED NO-STEPS` (whether small `<= 10`-task comparisons at `comparisonFloor` burned `stopRule` patience prematurely).
- Audit `campaign.move` (`decide` vs `led`), `compare` serialization across concurrent actions (`tools/d2/campaign-actions.ts`), repeated draws of an unchanged harness (`readAgainst`), `ENDED AND WENT ON` (valid after `operator`/`finished`/`environment`/crash; defect after `budget`/`stop`/`no-room` without an operator word), and `OPERATOR WORDS` (`pendingWords`, pause commands, confirming no seat saw any word).
- Attach every prior-state change sitting on the blocking link with its trigger count and mechanism event count.

Decision: what blocks the next promotion and whether control-loop logic or admission floors need repair. Routes to `host` (`src/campaign/decide.ts`, `src/campaign/admission.ts`, `tools/d2/harness-builder.ts`, `tools/d2/campaign-actions.ts`), `builder-prompt`, `examiner-prompt`, and `operator`.

### Solver execution, isolation and economy

**17. Solver execution, tool friction and resource limits.**

Label: `solve`.
Importance: 0.65.
Marks: none.

Starts from `MISSES AT A LIMIT (lane 17)`, `WALL SHARE (lane 17)`, `NON-RESULTS (lane 17)`, `MISSES WITHOUT A VERDICT (lane 17)`, `SOLVE NEVER FINISHED (lane 17)`, `TOOL MISSING (lane 17)`, and `HIGH TOOL ERROR RATE (lane 17)`.

How did solvers actually execute inside the harness, do resource limits differentiate harnesses, and what caused failing solves, tool errors, or non-results? Inspect `execution.txt`, `calls.txt`, and sample failing/non-winning solve traces (`slice.ts 'Solver:<id>'`):
1. **Limit binding**: classify per comparison whether `LIMITS` (`WALL SHARE`, `MISSES AT A LIMIT`, turn/wall distributions) bind on both arms, the reference alone, or neither, and check shell calls hitting default timeouts vs requesting longer ones.
2. **Tool friction & failure modes**: diagnose `HIGH TOOL ERROR RATE`, `MISSES WITHOUT A VERDICT` (`no-answer`, `broken-harness`, `malformed`), `TOOL MISSING`, Python/`uv` environment friction, broken CLI flags, or high inside-call wait shares (`execution.txt`) on non-winning solves.
3. **Non-result honesty**: verify `NON-RESULTS` classifications (`provider`, `sandbox-crash`, `killed`, `moved-files`, `check`, `verifier`) are accurate and retries distributed symmetrically across arms; separate `SOLVE NEVER FINISHED` cut solves from live ones.

Decision: whether solver-side friction, harness tool ergonomics, or resource limits cap capability or distort outcomes. Routes to `harness/tools`, `harness/guide`, `host` (`src/solver/run.ts`, `src/solver/prompt.ts`, `src/kernel/solve.ts`, `src/tools/command.ts`), `environment`, and `operator`.

**18. Evaluation wall, sandbox isolation and run provenance.**

Label: `runs`.
Importance: 0.75.
Marks: none.

Starts from `PRACTISED TASK MEASURED (lane 18)`, `SCORED AFTER RELEASE (lane 18)`, `SHARED TEMPORARY FOLDER (lane 18)`, `VERIFIER TOOLS MOVED (lane 18)`, `HOST CODE MOVED (lane 18)`, `STARTS OUT OF TURN (lane 18)`, `SERVED ANOTHER MODEL (lane 18)`, `HOST LOADED (lane 18)`, `LOAD MOVED (lane 18)`, `LAUNCHES (lane 18)`, `NO LAUNCH RECEIPT (lane 18)`, `LOG OUT OF ORDER (lane 18)`, `EXAMINER NEVER FINISHED (lane 18)`, and `SESSION CRASHED (lane 18)`.

Did every evaluation boundary, OS sandbox invariant, and experimental-provenance condition hold across the entire run? Audit four layers (`source.txt`, `launches.txt`, `conditions.txt`, `degradations.txt`, `execution.txt`, `calls.txt`):
1. **Evaluation boundary**: treat `PRACTISED TASK MEASURED` and `SCORED AFTER RELEASE` as immediate `I0` boundary breaches. Inspect `SHARED TEMPORARY FOLDER` (`calls.ts --list --command '/tmp/'`) for cross-arm or cross-campaign file/program reuse outside private `ana-built-bash` roots, and check sandbox wall integrity (`src/wall/`, `seat-root.ts`, `networkReach`).
2. **Condition & slot symmetry**: verify single `HOST CODE MOVED` / `VERIFIER TOOLS MOVED`, mirrored slot ordering (`STARTS OUT OF TURN`), `SERVED ANOTHER MODEL` symmetry across arms, and host load stability (`HOST LOADED`, `LOAD MOVED`) alongside wall-clock deadlines.
3. **Launch provenance**: verify fresh start from a clean tree at one commit (`LAUNCHES`, `NO LAUNCH RECEIPT`, Python/Bun pin consistency, concurrent runs vs login caps without naming logins, missing fetched `states/` in `versions.txt`); continuing after quota/session limits is expected (rule 15), whereas changing commits disqualifies a fresh measured run.
4. **Log & process integrity**: diagnose `LOG OUT OF ORDER` (concurrent writers), `SESSION CRASHED`, and cut `EXAMINER NEVER FINISHED` sessions. For multi-campaign reviews, catalogue every difference beyond the manipulated variable as a confounder.

Decision: whether the run's measurements are uncontaminated and eligible for milestone claims. Routes to `host` (`src/wall/`, `tools/runs/`, `src/kernel/log.ts`, `tools/d2/harness-builder.ts`), `environment`, and `operator`.

**19. Economy: time, spend and billing integrity.**

Label: `economy`.
Importance: 0.5.
Marks: none.

Starts from `LONG SILENCES (lane 19)`, `SPEND LED BY A ROLE (lane 19)`, and `BILLING RESIDUAL (lane 19)`.

Where did compute hours and billed dollars go, is the billing record complete, and what does a confirmed promotion cost? Verify billing completeness first (`BILLING RESIDUAL`, row F `costLine`, `continuity.txt` for Claude CLI `usages: []` unpriced compactions vs pi-priced ones). Align wall hours and active hours (outside recorded waits) against billed dollars by role (row A, `spendOf`) and by epoch (`epoch-spend.txt`, splitting promotion-spanning sessions). Verify each `LONG SILENCES` interval from surrounding events (`log.ts events --kind ...`) to separate provider/load waits from stuck commands or between-move gaps. Project next-round spend and read the closing economy bar (`tools/d2/close.ts`, `worthOf`). Decision: billing trustworthiness, next-round spend projection, and whether each role earns its compute share. Routes to `operator`, `host` (`src/kernel/meter.ts`, `src/kernel/trace.ts`), and `environment`.

### Component contracts, grounding and runtime wall

**20. Adversarial draft audit and pre-freeze gate.**

Label: `exam`.
Importance: 0.75.
Marks: none.

Starts from `DRAFT AUDITED (lane 20)`, `DRAFT AUDIT DEFECTS (lane 20)`, `DRAFT AUDIT REFUSED (lane 20)`, and `DRAFT AUDIT SKIPPED (lane 20)`.

Did the pre-freeze Adversarial Draft Auditor (`reviewDraft`, `src/referee/draft-audit.ts`) earn its added agentic complexity, latency, and spend, or did it police formatting ceremony, leak pass-2 defects past `MAX_DRAFT_AUDITS`, or over-tighten checks? Inspect `draft-audit.txt` beside `drafted.txt`, `checks.txt`, and `rejections.txt`:
1. **Execution, refusals and overhead**: separate `referee.draft` turns, probes, and billed USD from post-solve Referee rulings; audit `DRAFT AUDIT REFUSED` retries and `DRAFT AUDIT SKIPPED` timeouts/errors.
2. **Substance vs ceremony policing**: classify reported findings (`vacuous-pass`, `check-defect`, `objective-defect`) into domain-substantive holes versus deliverable/formatting ceremony, and cross-check whether audited exams reduced downstream `check-defect` or vacuous-pass rates compared to unaudited runs.
3. **Final-pass cap leak**: whenever the last `referee.draft` pass before `exam.drafted` returned `defects` (`unverified final pass`, since `MAX_DRAFT_AUDITS = 2` lets the next mechanically clean draft freeze unconditionally), verify against the frozen `exams/` check program (via `wri.ts grade`) whether each final-pass finding was actually fixed or leaked unverified.
4. **Keep-or-remove bar (`AGENTS.md` §2.7, Rule 13)**: state explicitly whether measured downstream benefit justifies keeping the adversarial draft auditor, simplifying it, or removing it.

Decision: whether `reviewDraft` improves exam validity enough to keep or should be simplified/removed. Routes to `reviewer-prompt` (`src/referee/draft-audit.ts`), `host` (`tools/d1b/draft.ts`), `pack/evaluator`, and `operator`.

**21. Verifier grounding, engines and tool provenance.**

Label: `exam`.
Importance: 0.7.
Marks: none.

Starts from `VERIFIER TOOL PROVENANCE (lane 21)` and `VERIFIER FAULTS (lane 21)`.

Do the verifier's declared engines, staged Examiner `.toolchain/` trees, and `.toolchain/host-tools.json` execute reliably offline while honoring Rule 10 provenance? Inspect `grounding.txt`, `checks.txt`, and staged `exams/<digest>/bundle/.toolchain/` alongside `checks/brief.json`:
1. **Rule-10 provenance**: confirm `host-tools.json` retains `origin: "draft"` for drafted exams (never elevating drafted checks to `pinned` without explicit operator `--admit`), and check whether declared `requiredToolIds`/`objectiveTools` map to real staged `.toolchain/bin/` binaries or host-delegated tools.
2. **Offline execution faults**: diagnose every `VERIFIER FAULTS` hit (`faulty` verdicts from zero-applicable checks or non-finite `timeoutMs`, `check`/`verifier` non-results, `toolCeilingMs` timeouts, or offline Seatbelt/Bubblewrap `EPERM`/`ENOENT` errors on staged venvs).
3. **Engine utilization**: verify declared domain engines actually ran inside verifier cells rather than sitting unused behind author-computed JS arithmetic.

Decision: whether verifier tool staging, provenance, and offline execution are sound. Routes to `host` (`src/kernel/verify.ts`, `tools/d2/exam.ts`), `pack/evaluator`, `examiner-prompt`, and `operator`.

**22. Cross-seat information wall and network condition parity.**

Label: `runs`.
Importance: 0.8.
Marks: `standing`.

Starts from `NETWORK PARITY MISMATCH (lane 22)` and `WALL BOUNDARY SIGNAL (lane 22)`, and is standing.

Did every runtime seat boundary hold in the logged tool traffic and solve conditions (beyond static prompt checks)? Inspect `wall-audit.txt`, `conditions.txt`, `builder-view.txt`, `examiner-view.txt`, and `wakes.txt`:
1. **Build-side wall (`AGENTS.md` §1, Rule 3)**: verify `0` check IDs, Referee rulings/prose, raw hidden objective values, held-out unreleased task IDs, move-table recommendations, or operator `campaign.word` strings crossed into `build.call` results.
2. **Exam-side wall**: verify `0` non-starter harness digests, harness files, numeric task/pass-rate targets, or operator words crossed into `exam.started` openings or wakes.
3. **Solver network parity (`COMPARISON_REACH`)**: verify `solve.finished.network` is present uniformly and matches across both arms of every scored comparison (`NETWORK PARITY MISMATCH`).
4. **Draft-audit containment**: verify `referee.draft` probes and findings never crossed to the build side or test solves.

Decision: whether runtime wall integrity and cross-arm network parity hold uncontaminated. Routes to `host` (`src/builder/tools.ts`, `src/examiner/record.ts`, `src/campaign/comparison.ts`, `src/tools/command.ts`), `environment`, and `operator`.

**23. Agentic component yield, handoffs and pause boundaries.**

Label: `climb`.
Importance: 0.7.
Marks: `standing`.

Starts from `SEAT BOUNDARY ANOMALY (lane 23)` and `ROLE YIELD SKEW (lane 23)`, and is standing.

Across all agentic roles (`draft`, `referee.draft`, `examiner`, `builder`, `solver`, `referee.adjudicate`) plus Verifier and Host, where did seat boundaries break, pause contracts overshoot, or auxiliary agentic spend fail to earn its keep? Inspect `seats.txt` alongside `epoch-spend.txt`, `continuity.txt`, and `table-timeline.ts`:
1. **End-to-end component ledger**: reconcile runs, turns, tool calls, error rates, cap/abnormal endings, and spend share per role, separating `referee.draft` spend from `referee.adjudicate` spend.
2. **Pause boundary adherence**: verify every `campaign.word` pause (`--after reported` etc.) held cleanly with `0` overshoot comparisons started after the boundary was reached (`pausePointReached`, `src/campaign/word.ts`).
3. **Auxiliary-role ROI (`ROLE YIELD SKEW`)**: when non-solver roles exceed 40% of billed spend or any auxiliary seat exhibits repeated anomalies/cap hits, identify the bottleneck handoff and whether simplifying or removing an agentic layer improves yield.

Decision: which agentic component or inter-seat handoff limits campaign yield or violates lifecycle boundaries. Routes to `host` (`src/campaign/word.ts`, `tools/d2/harness-builder.ts`, `tools/d2/campaign-actions.ts`), `builder-prompt`, `examiner-prompt`, `reviewer-prompt`, and `operator`.

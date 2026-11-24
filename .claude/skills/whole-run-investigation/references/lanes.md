# Whole-run investigation lanes

Six deterministic rows settled by the primary reviewer and 20 investigative lanes parsed by `tools/wri/catalogue.ts` (verified against `TRIGGERS` in `tools/wri/folds.ts` by `test/wri-readers.test.ts`).

## Who holds which pen

The Examiner drafts the exam and authors tasks, the Adversarial Draft Auditor probes mechanically clean drafts before freeze, the Builder develops the harness, the Solver answers tasks inside it, the Verifier decides validity in a fresh offline sandbox, the Referee adjudicates reproducible rejections, and the Host owns protocol, wall, statistics and pauses (`AGENTS.md` §1–8):

| Component | Purpose | Inputs & Wall | Outputs & Events | Key Edge Cases | Lanes |
| --- | --- | --- | --- | --- | --- |
| Examiner Drafter (`d-N`) | Drafts rules, scope, conventions, `answerFormat`, `evaluator.ts`, objective, ≥3 controls, optional `.toolchain/` | Operator prompt, solve budget, drafting limits, `draftFaults`, `draftReading` | `draft.*`, `exam.drafted`, `checker.read`, `contract.frozen`, staged `exams/` | Recipe disclosure, scope narrowing, `from_file` faults, broken `.toolchain/` links | `3, 4, 11, 16` |
| Adversarial Draft Auditor (`referee.draft`) | Pre-freeze judge (≤2 passes, 24 turns, 16 probes) trying to break accept controls and deliverables | Prompt, contract, check source, hidden values, accept controls, `priorFindings` (exam side only) | `referee.draft`, `referee.draft.refused`, findings fed back to `d-N` | Ceremony policing, pass-2 cap leak, drafting spend overhead, `skipped` | `3, 4, 11, 14, 18` |
| Examiner Task Author (`x-N`) | Authors diverse feasible held-out tasks with room above reference in one resting conversation | Brief, contract, check assertions (not source), reference outcomes and winning harness; no targets or harness files | `exam.*`, `propose_tasks`, `try_answer`, `try_reference`, `task.proposed`, `task.gate` | Unique-family collapse, zero-yield sessions, `>=0.98` near-copies, reference targeting, wake drift | `3, 7, 13, 14, 16` |
| Builder (`b-N`) | Builds Built Harness (`tools-spec.json`, `.toolchain/`, `BUILT_AGENTS.md`) and leads campaign moves | Wall (§1 five items only): contract, practice tasks, trajectories + coarse `bandOf` + `callsText`, tallies, budget | `build.*`, `build.checkpoint`, kept `states/<digest>/`, `MEMORY_FILE` | `HOST_ONLY` leaks, guide bloat, dead `.toolchain/bin`, untried freezes, `prac_fam` overfitting, compaction amnesia | `1, 3, 8, 10, 12, 13, 15, 16` |
| Solver (`s-N`) | Solves one task inside Built Harness under host turn and wall limits | Public task/files/resources, harness guide + `.toolchain/bin`, pinned `COMPARISON_REACH` network | `solve.*`, `answer.json`, `deliverables/`, `solve.finished` (with `network`) | Cross-arm `network` drift, tool errors, asymmetric limits, `/tmp` sharing, model swap | `3, 9, 15, 16, 19` |
| Verifier (code) | Evaluates submitted answer and deliverables inside fresh offline OS sandbox | Frozen `checks/`, `.toolchain/`, `host-tools.json` (`origin: "draft"`), hidden values, submitted files | `verdict` (`pass`/`fail`/`faulty`), check breakdown, objective, `toolCeilingMs` | Zero-applicable-check `faulty`, non-finite `timeoutMs`, offline `.toolchain/` denials, Rule-10 bypass | `4, 9, 17` |
| Referee Adjudicator (`referee.finding`) | Adjudicates reproducible rejections on exam side with conclusive `probe_check` evidence | Contract, task, hidden values, refused answer/files, check source, replay verdict | `referee.finding` (`earned`/`check-defect`/`unclear`), `referee.refused` | Unprobed `earned` restatements, cap expiries, asymmetric set-asides, uncalibrated without human labels | `3, 14, 16, 17, 20` |
| Host Controller (code) | Enforces append-only log, wall, epoch practice release, paired comparisons + A/A, `decide`, starter reads, pauses | Append-only `log.jsonl`, operator `campaign.word` (hidden from all seats), host load and locks | `campaign.*`, `comparison.*`, `harness.promoted`, `task.state`, `campaign.ended` | Pre-promo practice leaks, pause overshoot, fragile `spare === 0` steps, underpowered no-steps, billing residuals | `2, 5, 6, 9, 13, 14` |

Six rules govern every lane:
- **Weigh verdicts by instrument**: pinned domain engines outweigh author-computed checks.
- **Verify condition identity**: paired solves must differ in the harness alone.
- **Separate outcomes**: valid answers, earned rejections, limit expiries without submission, and non-results.
- **Treat rulings as readings**: `earned` without a clearing probe merely restates the check; Referee accuracy and pass soundness stay unmeasured until blind human labels exist.
- **Judge comparisons on untied tasks**: ties carry zero weight; intra-harness flips measure variance; set-asides drop rejected-arm losses.
- **Separate observation from cause** in two distinct sentences.

## How the catalogue is read

Triggers from `bun tools/wri/wri.ts read` point where to look, never what to conclude; refuting a trigger from raw bytes completes the lane. Lanes 1, 2, 3, 4, 5, 6, 9, 11, 14, and 16 are `standing`; lane 20 runs `alone`; lane 1 runs `blind` before any other lane in its session; lanes 2 and 6 run `side-by-side` across campaigns. Name one owner from the table below and cite event kinds, solve ids, 8-char digests, check ids, and counts (never quote task text, answers, hidden values, check failure messages, or traces):

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
| Same-domain version backtracking | `tools/wri/wri.ts backtrack (--log <log>[,<log>] \| --domain <domain>)` |
| Re-grade answer (permitted lanes) | `tools/wri/wri.ts grade --log <log> (--task <id> --answer <f> \| --solve <id>) [--set <path>=<json>]...` |

Place scratch scripts in a temporary directory (`bun <tmp>/x.ts <log>` or `python3 -B <tmp>/x.py < <log>`), never inside a campaign folder.

## Labels

Maps PR and prediction labels (`checkLabels`, `tools/runtime/land.ts`) to lanes:

| point | lanes | label | changes |
| --- | --- | --- | --- |
| verdicts | 4, 11, 16, 18 | `exam` | drafting, draft audit, checks, verifier grounding, deliverables, verifier, controls, freeze/admission, seat prompts |
| verdicts | 17, 20 | `verdicts` | Referee, set-asides, hand labels, `settle.ts` |
| supply | 7 | `supply` | task authoring, `try_reference`/`try_answer`, admission, Examiner inputs |
| climb | 8, 10, 12, 15 | `harness` | Builder session/tools/practice/bands, harness contract, export portability |
| honesty | 3, 5 | `comparison` | terms, pairing, scored set, tally, statistical test, A/A, conditions, cross-component reward hacking |
| climb | 1, 2, 6, 13, 14 | `climb` | move table, campaign moves, starter reads, promotion, compaction/handover, pause boundaries, endings, economy, cross-release progress |
| honesty | 19 | `solve` | solve execution, backends, tool friction, limits, non-results, solver prompt |
| honesty | 9 | `runs` | sandbox wall, cross-seat wall, network parity, isolation, launching/moving runs, logins, hosts, launch receipts |
| honesty | rows A to F | `log` | log schema, event kinds, conditions, folds, `view`, `replay`, UI |
| none | none | `investigation` | `tools/wri/`, this catalogue, WRI skill & scripts |
| none | none | `landing` | PR stack, `land`, git hooks, CI gate |
| none | none | `quality` | lint, simplify census, size policy, style |
| none | none | `docs` | `AGENTS.md`, `docs/`, prose |

## Deterministic rows A to F

Settle from `bun tools/wri/wri.ts read --log <log>` before opening lanes:
- **A. campaign & log**: `log.jsonl`, `exams/`, `states/`; verify clean fold, host hash vs checkout, billed USD and wall hours by role.
- **B. checker identity**: contract and check hashes from `contract.frozen` and `checker.read` (+ `despite` fault count).
- **C. conditions**: distinct condition values by arm/model + completed solves missing `responseModels` + served-model degradation line.
- **D. task sets**: versions by origin (`session`/`carried`/draft) and state; practised and scored sets must stay disjoint (`PRACTISED TASK MEASURED`, lane 9).
- **E. case partition**: per arm—passes, fails by kind (`rejected` with check ids), `flagged`, non-results, unfinished.
- **F. sessions & chain**: moves (incl. open move), endings, spend vs cap, Builder parent/child digests, practice activity, comparison readings (`g-N`), Examiner proposed/admitted counts.

## Lanes 1 to 20

### Tier 1: Core pillars (0.90–1.00)

**1. Blind reach and soundness grading.**

Label: `climb`.
Importance: 1.
Marks: `standing`, `blind`.

Starts from every kept harness version and scored task, and is standing. It grades blind, so any session holding it completes it before opening any other lane or outcome file.

Did the harnesses build genuine domain capability on hard tasks, or merely clear easy tasks and objective noise? Lock every blind grade before opening any outcome file: read `chain.txt` (`harness-versions.ts <log> --blind`) and diffs (`--chain --lines`, or `--diff <d> --lines` without outcomes) for soundness, listing missing local states (`versions.txt`) under `## Not read`; read `tasks.txt` (`tools/wri/tasks.ts`, `--shape`, `--task <id>`, `--rows`) beside `exams/` checks for reach. Only after locking all blind grades, unseal `versions.txt`, `readings.txt`, and rows D–E to check whether winning tasks match where diffs act and whether weight grew while soundness stood flat.

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
- 1: it is fitted: it names practice content or narrows to the practice set's shapes (lane 8);
- 2: churn: rewording or reordering no solve could follow;
- 3: plausible but narrow: it helps a few task shapes;
- 4: sound for one part of the domain, stated generally;
- 5: sound across the domain's kinds of task, and the solves call what it added;
- 6: a method a specialist would teach, with its own checks;
- 7: what an expert would adopt unchanged.

Place grading tables under `## Grades` between the verdict line and `## Findings` (version chain table, then comparison reach distribution of won vs lost tasks), and append tab-separated rows under `## Grade rows` (`task<TAB>campaign<TAB>id<TAB>grade`, `version<TAB>campaign<TAB>digest<TAB>grade`) for `wri.ts trajectory --grades`. Never sum reach and soundness. Decide whether the climb reflects genuine capability and merits external evaluation, routing to `operator`, `harness/guide`, `harness/tools`, `examiner-prompt`, or `builder-prompt`.

**2. Longitudinal version backtracking and cross-release progress.**

Label: `climb`.
Importance: 1.
Marks: `standing`, `side-by-side`.

Starts from `history.txt` and older fresh runs of the same domain (`domainOf`) in the archive, and is standing.

Did this version actually beat older versions of the same domain (`runs fresh <pack>` / `--domain`), stay flat, or regress—and did the previous release's binding constraint move? Start from `history.txt` (`bun tools/wri/wri.ts backtrack --log <log>[,<log>]`), which groups same-domain, same-setting runs by git-ancestor release tag and decays attention monotonically with version gap (`weight = promptFactor / (1 + gap)`):

- **Direct and near releases (`gap < 2`, primary attention — same-release siblings and the immediately preceding minor release):** compare all reported factors on matched active hours (`Supply` validity room, `Climb` promos/100 active h and promos/comparison, `Confirmation` confirmed rate and `written-after` win share, `Honesty` A/A steps, `Economy` repriced `$/promo` and active h/promo, and `outside-reads.md` transfer scores). Open the stored `.ana/wri/*/synthesis.md` files listed in `history.txt` for `direct` and `near` runs and state plainly whether their binding constraint improved, stayed unchanged, or worsened.
- **Code-delta and regression audit (`git log <prev-release>..<run-commit>`):** separate changes inside the release tag from post-release stacked PRs. Call out which changes moved a factor, which added complexity with zero live effect, and which regressed behaviour relative to the prior release—recommending revert or simplification (`AGENTS.md` rule 13) before adding new machinery. Flag prompt-revision changes (`prior-prompt` runs where `pack` differs inside the domain) as confounders rather than ignoring them.
- **Mid-gap releases (`2 <= gap < 3`, light trend check):** read cohort rollup rows and stored constraints only to check multi-release direction and chronic recurrence; do not spend deep budget on individual runs two releases back.
- **Distant and other-setting runs (`gap >= 3` or `other-setting`, background only):** keep collapsed as one count and never pool different settings into causal deltas (`AGENTS.md` §9).

Always separate code/hygiene gains (`exercised live`) from confirmed outcome shifts (`shown in an outcome`), and state plainly when sample size or inter-run spread leaves the version delta unproven. Decide whether this version beats the prior release on this domain and what should be reverted or rewritten next, routing to `operator`, `host`, `builder-prompt`, `examiner-prompt`, `reviewer-prompt`, or `pack/brief`.

**3. Component reward hacking and specification gaming.**

Label: `comparison`.
Importance: 0.95.
Marks: `standing`.

Starts from `DRAFT RULE DROP (lane 3)`, `PRACTICE HILL-CLIMBING (lane 3)`, and `SPECIFICATION GAMING LEAD (lane 3)`, and is standing.

Did any agentic seat satisfy its local gate or proxy score in a way that defeats the scientific measurement—including in-rules specification gaming that never breaches the OS wall, or shaping outputs to game a downstream seat? Treat `gaming.txt` strictly as coarse starting tripwires, never a ceiling, and spend most of this lane reading primary code and traces across seat boundaries:
- **Drafter & check source (`slice.ts 'Draft:d-N'`, `referee.draft`, frozen `exams/<digest>/checks/`):** compare earlier `draft_exam` attempts against the frozen `evaluator.ts` for dropped constraints, probe-only patches, catch fallbacks, ceremony-only auditing, unread point estimates, or unverified pass-2 edits.
- **Examiner authoring (`slice.ts 'Examiner:x-N'`, `tasks.ts`, `aim.txt`):** check whether `try_answer` uses hidden generator parameters unavailable from public inputs, whether distinct `task.family` names mask cloned DGPs, or whether post-promotion `try_reference` survivorship filtering skews tasks against the reference while Starter stays flat.
- **Builder & harness bytes (`slice.ts 'Builder:b-N'`, `states/<digest>/`):** separate real domain tooling from practice-band inversion (`6+` practice solves on one task), compare-fishing, narrow interval/proxy hedging, or paraphrased `HOST_ONLY` smuggling above `## Validity and score`.
- **Solver & Referee traces (`slice.ts 'Solver:<id>'`, `provenance.ts`, `slice.ts 'Referee:...'`):** separate efficient domain methods from objective hedging, boilerplate deliverables, tolerance exploitation, `/tmp` shortcuts, unprobed `earned` rubber-stamping, or asymmetric set-asides.

Follow cross-seat chains wherever they lead (for example, Examiner generator quirk → Builder practice probing → Solver shortcut → `chosen` vs `written-after` reversal) while obeying the no-quote wall. Classify every probed vector cleanly (`attribution-and-proof`) into observed exploitation, not observed in the traces read, checker/exam gap, or legitimate domain method—never abbreviate a scoped check as "no reward hacking". Route to `pack/evaluator`, `pack/brief`, `harness/guide`, `harness/tools`, `examiner-prompt`, `builder-prompt`, `reviewer-prompt`, `host`, or `operator`.

**4. Pass soundness, deliverables and verifier grounding.**

Label: `exam`.
Importance: 0.9.
Marks: `standing`.

Starts from `INSTRUMENT AUTHORED (lane 4)`, `PASSES UNREAD (lane 4)`, `PASSES LABELLED (lane 4)`, `REFUSALS BY CHECK (lane 4)`, `NO CHECKER READING (lane 4)`, `CHECKER READ WITH FAULTS (lane 4)`, `CONTROL COVERAGE (lane 4)`, `CHECKER NOT FROZEN (lane 4)`, `FROZEN DESPITE FAULTS (lane 4)`, `READ AT ANOTHER VERSION (lane 4)`, `TASKS CARRIED (lane 4)`, `DELIVERABLES CAPTURED (lane 4)`, `NO DELIVERABLES CAPTURED (lane 4)`, `VERIFIER TOOL PROVENANCE (lane 4)`, and `VERIFIER FAULTS (lane 4)`, and is standing.

Does a passing verdict prove genuine domain work, or merely well-formed files and self-consistent arithmetic? Read `checks.txt`, `deliverables.txt`, `grounding.txt`, `exams/<digest>/checks/brief.json`, and the frozen check program source. Sample passing solves across families and harnesses—especially on 0-refusal checks—and actively break them with `wri.ts grade --solve <id> --set <path>=<json>` to expose unread fields, unenforced rules, loose tolerances, or existence-only deliverable checks (`states/deliverables/`, 64-file/16 MiB caps, `zipTexts`). Audit the objective arithmetic first whenever validity saturates: does it reward real domain quality, or width squeezing and tolerance hedging? Check verifier provenance (`exams/<digest>/bundle/.toolchain/host-tools.json` must stay `origin: "draft"` unless `--admit` ran), offline execution (`VERIFIER FAULTS`, `toolCeilingMs`, Seatbelt/Bubblewrap errors), and whether declared engines actually ran instead of author-computed JS (rule 10). When `PASSES LABELLED` fires, check `passAgreement` (`src/referee/agreement.ts`) against the ≥20 decided / ≤10% wrong bar; otherwise state that passes remain uncalibrated. Exclude Examiner `try-` solves from scored refusal counts. Decide whether a pass and its objective can be trusted, routing to `pack/evaluator`, `pack/brief`, `pack/controls`, `host` (`src/kernel/verify.ts`, `src/kernel/answer-files.ts`, `tools/d2/exam.ts`), or `operator`.

**5. Comparison power, signal and noise.**

Label: `comparison`.
Importance: 0.9.
Marks: `standing`.

Starts from `NOTHING SCORED (lane 5)`, `CUT BY ITS CAP (lane 5)`, `SET SHORT (lane 5)`, `TIED TASKS (lane 5)`, `TIES BETWEEN VALID ANSWERS (lane 5)`, `NO VALID ANSWER (lane 5)`, `AWAITING A LABEL (lane 5)`, `SAFEGUARD-9 PROMOTION BEYOND VALIDITY (lane 5)`, `STEP CARRIERS (lane 5)`, `FLIPS (lane 5)`, `REFERENCE AGAINST ITSELF (lane 5)`, and `MARGINS INSIDE THE NOISE (lane 5)`, and is standing.

What could each comparison actually detect, which measure carried it, and do winning margins clear rollout noise? From `readings.txt`, `scores.txt`, `pairs.txt`, `zone.txt`, `diagnostics.txt`, and `nearness.txt`, report untied tasks, wins/losses, p-value, `detectable`, `falseRate`, frontier vs retained split, tie classes, and unsolved tasks awaiting labels. Separate validity wins from objective-only wins (`SAFEGUARD-9`, `replay.txt`); when validity saturates, say so plainly. Read per-arm `FLIPS` and the A/A control split by validity versus objective (`src/campaign/climb.ts`); on objective-only steps, compare each win against the wider of both sides' own self-differences (`MARGINS INSIDE THE NOISE`), using `Starter against itself` where A/A tied completely. Find the smallest subset of wins whose removal breaks each step (`STEP CARRIERS`), check whether they share a family, writing session, or near-copy template (`nearness.txt`), and estimate required solves per side with `comparison-reading/scripts/size.ts --scores <s,s,...>` without proposing a higher `GAP_FLOOR` or post-hoc term edits (rule 4). Decide whether each reading is signal or noise, routing to `operator`, `host` (`src/kernel/compare.ts`), `examiner/task`, or `examiner-prompt`.

**6. Climb, confirmation and batch generalisation.**

Label: `climb`.
Importance: 0.9.
Marks: `standing`, `side-by-side`.

Starts from `PROMOTED (lane 6)`, `STARTER BARE (lane 6)`, `AFTER THE PROMOTION (lane 6)`, `VALID BY HARNESS (lane 6)`, `PROMOTION UNCONFIRMED (lane 6)`, and `CHAIN AGAINST THE STARTER (lane 6)`, and is standing. Where several campaigns are under review, it receives `wri.ts climb` side by side.

Did each promotion hold on unseen tasks that did not choose it, and how many independent Examiner batches support it? Read `starter-reads.txt`, `transfer.txt`, `climb.txt`, `epoch-spend.txt`, and `starter-reads.ts --tasks`. Verify each promotion's authority (`decide` vs manual `promote.ts --despite`), whether the owed starter read ran first (`heldSince`), and why any promotion went unconfirmed. Split every starter read by task origin (`chosen`, `before`, `after`) and by validity versus objective, reporting the selection-only false confirmation count (`stepCount`, `selection.ts`) beside standalone `after` tallies and fleet totals (`starter-reads.ts --all`). Count distinct post-promotion writing sessions (`k`), flagging sessions that straddle the promotion (`k = 1` is one batch draw; a batch sign test clears 0.02 only at `k >= 6`). When `CHAIN AGAINST THE STARTER` fires or `after` lags, separate selection-on-noise, Examiner targeting (stable Starter beside falling reference by writer), and genuine harness regression (cross-checked with lanes 1 and 8). When several campaigns are open together, align them by move index from `wri.ts climb` while noting lane 9 confounders. Decide whether the climb counts toward milestones or needs a neutral `compare-systems` read, routing to `host` (`src/campaign/climb.ts`, `src/campaign/decide.ts`), `examiner-prompt`, `harness/guide`, `harness/tools`, or `operator`.

### Tier 2: Major structural owners (0.65–0.75)

**7. Examiner supply, authoring and targeting.**

Label: `supply`.
Importance: 0.75.
Marks: none.

Starts from `OUTCOMES BY SESSION (lane 7)`, `SUPPLY THIN (lane 7)`, `GATE REFUSED (lane 7)`, `EXAMINER ZERO YIELD (lane 7)`, and `FAMILY CONCENTRATION (lane 7)`.

Did the Examiner produce diverse held-out tasks with real headroom, or stall and skew post-promotion tasks? Read `exams.txt`, `ambition.txt`, `aim.txt`, `draw.txt`, `nearness.txt`, and `exam.call`. Audit `try_reference` spend and survivorship drops (`roomLine`, `src/examiner/write.ts`), `try_answer` failures, `from_file`/shell errors (`src/examiner/shell.ts`), `task.gate` refusals, and every `EXAMINER ZERO YIELD` session. Check `FAMILY CONCENTRATION` and `nearness.txt` for unique-family collapse (defeating the family cap) or cloned templates (`>=0.98` wording nearness). Track per-session Starter versus reference outcomes (`OUTCOMES BY SESSION`, `starter-reads.ts` per writer): a stable Starter paired with a falling reference points to adversarial targeting rather than genuine difficulty growth. Never propose numeric quotas or pass-rate targets (`AGENTS.md` §2). Route to `examiner-prompt` (`src/examiner/prompt.ts`, `src/examiner/write.ts`), `examiner/task`, `host` (`src/kernel/task.ts`, `src/examiner/shell.ts`, `src/examiner/record.ts`), or `operator`.

**8. Harness delta, guide truth and memorisation.**

Label: `harness`.
Importance: 0.7.
Marks: none.

Starts from `HARNESS CHANGED (lane 8)`, `BROKEN AT END (lane 8)`, `MEASURED AN EARLIER STATE (lane 8)`, `TOOLS EDITED (lane 8)`, `NEVER CHECKED (lane 8)`, `TOOLS CALLED (lane 8)`, and `TOOL CALLS ERRED (lane 8)`.

What exact bytes changed between parent and child harnesses, does `BUILT_AGENTS.md` tell the truth about shipped `.toolchain/` tools, and did anything violate the content rule? Diff kept states component by component (`harness-versions.ts --diff <d>`) rather than trusting Builder notes, flagging unmeasured edits after a broken end. Audit every harness file against the Builder's content rule (no task id, task text, or hardcoded answer) using `names.txt` as a lead. Reconcile guide claims, `.toolchain/` code, and observed solver calls (`calls.txt`, separating intentional non-zero exits from broken or dead bins), and verify `src/solver/prompt.ts` against the logged condition. Decide what changed in substance and whether dead tools or content violations slipped in, routing to `harness/guide`, `harness/tools`, `harness/tool-tree`, `builder-prompt`, or `host` (`src/builder/session.ts`, `src/builder/tools.ts`).

**9. Evaluation wall, sandbox isolation, network parity and provenance.**

Label: `runs`.
Importance: 0.65.
Marks: `standing`.

Starts from `PRACTISED TASK MEASURED (lane 9)`, `SCORED AFTER RELEASE (lane 9)`, `SHARED TEMPORARY FOLDER (lane 9)`, `VERIFIER TOOLS MOVED (lane 9)`, `HOST CODE MOVED (lane 9)`, `STARTS OUT OF TURN (lane 9)`, `SERVED ANOTHER MODEL (lane 9)`, `HOST LOADED (lane 9)`, `LOAD MOVED (lane 9)`, `LAUNCHES (lane 9)`, `NO LAUNCH RECEIPT (lane 9)`, `LOG OUT OF ORDER (lane 9)`, `EXAMINER NEVER FINISHED (lane 9)`, `SESSION CRASHED (lane 9)`, `NETWORK PARITY MISMATCH (lane 9)`, and `WALL BOUNDARY SIGNAL (lane 9)`, and is standing.

Did every evaluation wall, OS sandbox invariant, network condition, and launch-provenance rule hold across the entire run? Read `wall-audit.txt`, `source.txt`, `launches.txt`, `conditions.txt`, `degradations.txt`, `builder-view.txt`, `examiner-view.txt`, `wakes.txt`, and `calls.txt`. Treat `PRACTISED TASK MEASURED`, `SCORED AFTER RELEASE`, or any build-side/exam-side wall leak (check ids, Referee prose, raw hidden values, unreleased task ids, move-table advice, `campaign.word`, non-starter digests, numeric targets, or `referee.draft` leaks) as immediate `I0` breaches. Check `SHARED TEMPORARY FOLDER` (`calls.ts --list --command '/tmp/'`), `solve.finished.network` parity across arms (`COMPARISON_REACH`), single host/verifier-tool digests, mirrored slot order, served-model symmetry, host load stability, clean single-commit launch provenance (rule 15 quota resumes are normal; commit changes disqualify fresh climbs), and log/process integrity (`LOG OUT OF ORDER`, crashes). For multi-campaign reviews, list every confounder beyond the intended change. Route to `host` (`src/wall/`, `src/builder/tools.ts`, `src/examiner/record.ts`, `src/campaign/comparison.ts`, `src/tools/command.ts`, `tools/runs/`, `src/kernel/log.ts`), `environment`, or `operator`.

**10. Harness portability and external-transfer readiness.**

Label: `harness`.
Importance: 0.65.
Marks: none.

Starts from `BUILT HARNESS FOR EXPORT (lane 10)`.

Will the promoted harness work cleanly outside this campaign's exam and host (for example in `runs bench`)? Read `portability.txt`, `diagnostics.txt`, and kept harnesses under `states/<digest>/`. Separate general domain tools and methodology from guide prose or scripts coupled to this exam's JSON keys, manifest paths, check wording, or turn-count coaching—paying special attention to exam coupling sitting above `## Validity and score` (`HOST_ONLY`). Check `.toolchain/` scripts for hardcoded host paths, unbundled Python packages (`ANA_PYTHON`, `uv`), broken relative imports, or dead bins, and judge whether `BUILT_AGENTS.md` grew bloated enough to distract a solver on unfamiliar tasks. Where `outside-reads.md` or `data/bench/` holds an external read for this run, compare internal wins against external scores without proposing benchmark-fitted prompts (`AGENTS.md` §1, rule 2). Route to `builder-prompt` (`src/builder/prompt.ts`, `src/harness/starter.ts`), `harness/guide`, `harness/tools`, `host` (`tools/runs/bench.ts`), or `operator`.

### Tier 3: Focused diagnostics (0.35–0.50)

**11. Drafted exam against the prompt.**

Label: `exam`.
Importance: 0.5.
Marks: `standing`.

Starts from `EXAM DRAFTED (lane 11)` and `PASSES AT A SMALL WALL SHARE (lane 11)`, and is standing.

Did the drafted exam faithfully measure the operator's prompt, or narrow scope and hand solvers a recipe? Compare `campaign.opened`'s prompt against the standing draft's rules, conventions, scope, answer format, objective (or `unmeasured` rationale), and checks (`drafted.txt`). Count failed drafts by fault kind (`draftFaults`, `draftReading`) and verify whether the accepted draft fixed each requirement or quietly dropped it. Check whether public inputs or conventions leak the check arithmetic or a one-step recipe (`PASSES AT A SMALL WALL SHARE`, `sequences.txt`), and note any author-computed check that a staged domain engine could decide instead. Decide whether the exam measures the requested domain at real difficulty, routing to `examiner-prompt` (`src/examiner/draft.ts`), `pack/brief`, `pack/evaluator`, or `operator`.

**12. Practice feedback, band discipline and family transfer.**

Label: `harness`.
Importance: 0.45.
Marks: none.

Starts from `NO PRACTICE (lane 12)`, `FINAL BYTES NEVER PRACTISED (lane 12)`, `PRACTICE FAILS (lane 12)`, `PRACTICE CONCENTRATION (lane 12)`, and `PRE-PROMOTION PRACTICE RELEASED (lane 12)`.

Did the Builder use practice solves honestly, did coarse bands hide raw hidden numbers, and did gains transfer outside practised task families? Read `practice.txt`, `transfer.txt`, and `build.call`. Count practice solves per comparison, untried freezes (`NO PRACTICE`, `FINAL BYTES NEVER PRACTISED`), `read_trace` / `check_harness` calls, and earned failures actually fixed on edited bytes. Confirm `build.call` practice results under an objective expose only coarse bands (`bandOf`, `src/builder/tools.ts`) without raw values, and inspect `PRACTICE CONCENTRATION` (4+ solves on one task) for parameter-inversion probing. Check `PRE-PROMOTION PRACTICE RELEASED` (`beforePromotion`, `newTasksLimit`) and split starter-read outcomes (`starter-reads.ts --tasks`) into practised versus unpractised families to separate transfer from overfitting. Route to `builder-prompt`, `host` (`src/builder/tools.ts`, `src/kernel/reports.ts`, `src/campaign/decide.ts`), `harness/guide`, or `operator`.

**13. Campaign control, decision-table adherence and continuity.**

Label: `climb`.
Importance: 0.4.
Marks: none.

Starts from `CHAIN (lane 13)`, `NO TASK HELD OUT (lane 13)`, `ENDED AND WENT ON (lane 13)`, `OPERATOR WORDS (lane 13)`, `FIRST COMPARISON HELD OFF (lane 13)`, `UNDERPOWERED NO-STEPS (lane 13)`, `BUILDER COMPACTED (lane 13)`, `EXAMINER COMPACTED (lane 13)`, `SOLVER COMPACTED (lane 13)`, `SESSION ENDED (lane 13)`, and `INTERRUPTED HANDOVER (lane 13)`.

Which pipeline link blocked the next promotion, did moves follow the decision table, and did long-lived seats survive compaction and restarts cleanly? Walk the latest epoch's chain (`CHAIN`, `table-timeline.ts`) and stop at the first failing link: frontier supply, Builder edits/practice, comparison power (`UNDERPOWERED NO-STEPS`, `FIRST COMPARISON HELD OFF`), move-table execution (`compare` serialization, `readAgainst`, `uncomparedTasks`, `OPERATOR WORDS`), or termination (`ENDED AND WENT ON`). Attach every prior-state change sitting on that blocking link with its trigger and event counts. Inspect `continuity.txt` and `launches.txt` for compaction recovery (`read_opening` cues, repeated edits or proposals after compaction), multi-ask Examiner wake drift (`guardAsk`), and interrupted Builder handovers (`formatSessionStart`, `MEMORY_FILE`). Route to `host` (`src/campaign/decide.ts`, `src/campaign/admission.ts`, `src/agent/session.ts`, `src/examiner/session.ts`, `src/builder/past.ts`, `tools/d2/harness-builder.ts`, `tools/d2/campaign-actions.ts`), `builder-prompt`, `examiner-prompt`, `environment`, or `operator`.

**14. Agentic yield, pause boundaries and economy.**

Label: `climb`.
Importance: 0.35.
Marks: `standing`.

Starts from `SEAT BOUNDARY ANOMALY (lane 14)`, `ROLE YIELD SKEW (lane 14)`, `LONG SILENCES (lane 14)`, `SPEND LED BY A ROLE (lane 14)`, and `BILLING RESIDUAL (lane 14)`, and is standing.

Where did compute hours and dollars go, did pause contracts hold, and does every agentic role earn its spend? Read `seats.txt`, `epoch-spend.txt`, `continuity.txt`, `table-timeline.ts`, and row F's `costLine`. Verify billing completeness (`BILLING RESIDUAL`, unpriced Claude compactions vs closed ledger) and separate active hours from recorded provider/load waits (`LONG SILENCES`). Check every `campaign.word` pause for zero overshoot comparisons (`pausePointReached`, `src/campaign/word.ts`). When non-solver spend exceeds 40% (`ROLE YIELD SKEW`) or an auxiliary seat stalls or hits caps repeatedly, name the wasteful handoff and whether removing or simplifying that layer raises yield. Project next-round spend and read the closing economy bar (`worthOf`). Route to `host` (`src/campaign/word.ts`, `src/kernel/meter.ts`, `src/kernel/trace.ts`, `tools/d2/harness-builder.ts`, `tools/d2/campaign-actions.ts`), `builder-prompt`, `examiner-prompt`, `reviewer-prompt`, `environment`, or `operator`.

**15. Win attribution and answer provenance.**

Label: `harness`.
Importance: 0.35.
Marks: none.

Starts from `WINS (lane 15)`, `WIN AT A SMALL WALL SHARE (lane 15)`, and `ANSWER FROM A PROGRAM (lane 15)`.

Which harness part produced each winning task, and where did every deciding answer value come from? Read winning traces before opening the harness diff, focusing on promoted steps and untied wins (`readings.txt`, `parts.ts --comparison g-N`). Classify each win's first divergence into a new/edited tool, a guide instruction absent from the reference, a different solver method independent of the diff, or solver variance on the same method. Trace deciding leaf values chronologically with `tools/wri/provenance.ts --log <log> --wins g-N` (and `slice.ts` for `nowhere` entries) to spot hardcoded constants or shortcuts. Causal credit still requires a `programs-of:<digest>` ablation (`AGENTS.md` §9); use this lane to target it. Route to `operator`, `harness/tools`, `harness/guide`, or `host`.

### Tier 4: Lightweight and conditional (0.10–0.25)

**16. Seat prompts and tool surfaces.**

Label: `exam`.
Importance: 0.25.
Marks: `standing`.

Starts from each seat's opening at the campaign's commit, and is standing.

Did any seat prompt or tool result prescribe a strategy, give a numeric target, print a stale or wrong fact (`AGENTS.md` §2), or leak across a boundary? At the launch receipt's commit, check Examiner prompts (`src/examiner/draft.ts`, `src/examiner/prompt.ts`, `examiner-view.txt`, `wakes.txt`), Builder prompts and `build.call` results (`src/builder/prompt.ts`, `builder-view.txt`), Solver prompts (`src/solver/prompt.ts`), and Referee prompts (`src/referee/referee.ts`). Prompt sentences may be quoted directly. Name only prescriptive lines or wrong folds that visibly changed a move, citing the confirming event; fix them by deleting directives or repairing folds, never by adding targets. Route to `examiner-prompt`, `builder-prompt`, `reviewer-prompt`, or `host` (`src/builder/past.ts`, `src/builder/tools.ts`, `src/examiner/session.ts`).

**17. Rejection rulings and Referee calibration.**

Label: `verdicts`.
Importance: 0.2.
Marks: none.

Starts from `REFUSED UNREAD (lane 17)`, `CHECK DEFECT RULED (lane 17)`, `RULED UNCLEAR (lane 17)`, `REPLAY MOVED THE VERDICT (lane 17)`, `SET ASIDE AND UNSETTLED (lane 17)`, `READING MOVES WITH THE SET-ASIDE (lane 17)`, `SET ASIDE BY SIDE (lane 17)`, `SETTLED BY HAND (lane 17)`, `REVIEW FAULTS (lane 17)`, `EARNED WITHOUT A PROBE (lane 17)`, `RULINGS REFUSED (lane 17)`, and `SCORED SET MOVED (lane 17)`.

Were rejected answers genuinely invalid, and did set-asides bias any tally? Group rejections by check id and ruling (`rejections.txt`, `restated.txt`), checking that `earned` rulings carry a clearing-probe test rather than restating the check (`EARNED WITHOUT A PROBE`) and `check-defect` rulings carry a probe that clears the refusal. Flag non-deterministic replays, asymmetric set-asides, readings that flip between `scored` and `counted`, tasks dropped after `comparison.started`, and `referee.refused` retries. Compare human labels (`SETTLED BY HAND`) against the `AGENTS.md` §1 agreement bar (`src/referee/agreement.ts`); without them, qualify rulings as one uncalibrated reader. Refer any check that public rules leave undecided to lane 20. Decide whether rejections and set-asides hold, routing to `pack/evaluator`, `pack/brief`, `reviewer-prompt`, `host`, or `operator`.

**18. Adversarial draft audit and pre-freeze gate.**

Label: `exam`.
Importance: 0.2.
Marks: none.

Starts from `DRAFT AUDITED (lane 18)`, `DRAFT AUDIT DEFECTS (lane 18)`, `DRAFT AUDIT REFUSED (lane 18)`, and `DRAFT AUDIT SKIPPED (lane 18)`.

Did the pre-freeze Adversarial Draft Auditor (`reviewDraft`, `src/referee/draft-audit.ts`) earn its latency and spend, or mostly police CSV ceremony and leak pass-2 fixes unverified? Read `draft-audit.txt` beside `drafted.txt`, `checks.txt`, and `rejections.txt`. Separate `referee.draft` turns, probes, and USD from post-solve Referee rulings; classify findings into real domain/objective holes versus formatting ceremony; verify with `wri.ts grade` whether any final-pass `defects` finding leaked unverified past `MAX_DRAFT_AUDITS`; and apply the keep-or-remove bar (`AGENTS.md` §2.7, rule 13) plainly—recommend simplifying or removing the auditor if it moved zero live verdicts. Route to `reviewer-prompt` (`src/referee/draft-audit.ts`), `host` (`tools/d1b/draft.ts`), `pack/evaluator`, or `operator`.

**19. Solver execution, tool friction and resource limits.**

Label: `solve`.
Importance: 0.15.
Marks: none.

Starts from `MISSES AT A LIMIT (lane 19)`, `WALL SHARE (lane 19)`, `NON-RESULTS (lane 19)`, `MISSES WITHOUT A VERDICT (lane 19)`, `SOLVE NEVER FINISHED (lane 19)`, `TOOL MISSING (lane 19)`, and `HIGH TOOL ERROR RATE (lane 19)`.

Did resource limits actually differentiate harnesses, or did solver friction and misclassified non-results distort outcomes? Read `execution.txt`, `calls.txt`, and sample failing traces (`slice.ts 'Solver:<id>'`). State whether turn and wall limits bound on both arms, the reference alone, or neither; diagnose high tool errors, `no-answer`/`broken-harness`/`malformed` endings, missing tools, Python/`uv` friction, and shell timeouts; and verify `NON-RESULTS` (`provider`, `sandbox-crash`, `killed`, `moved-files`, `check`, `verifier`) were retried symmetrically across arms. Route to `harness/tools`, `harness/guide`, `host` (`src/solver/run.ts`, `src/solver/prompt.ts`, `src/kernel/solve.ts`, `src/tools/command.ts`), `environment`, or `operator`.

**20. Constructive valid-alternative challenge.**

Label: `verdicts`.
Importance: 0.1.
Marks: `alone`.

Starts from `FAILS ON ONE CHECK (lane 20)` and `DEFECT RULED BESIDE PASSES (lane 20)`, and only when lane 17 left a check undecided. It runs alone.

Does a disputed check reject constructively valid answers? Read only the public exam via `bun tools/wri/public-exam.ts <log>`. Before opening the check program, Referee probes, or any lane report, construct valid alternative answers satisfying every published rule while differing in a permitted way (valid alternative design, allowed rounding, or equivalent unit) and record their SHA-256 digests. Only after freezing those digests, run `wri.ts grade --log <log> --answers <dir>` and report the 2×2 table of constructively valid versus verifier-accepted answers, naming every refusing check. Drop and count any candidate whose validity cannot be proven from public rules alone, and never derive candidates from recorded held-out answers. Decide whether the check must be repaired and hand over the corpus as accept controls, routing to `pack/evaluator` or `pack/controls`.

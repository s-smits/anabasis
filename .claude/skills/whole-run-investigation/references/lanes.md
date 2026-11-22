# Whole-run investigation lanes

Six deterministic rows settled by the primary reviewer and 23 investigative lanes parsed by `tools/wri/catalogue.ts` (verified against `TRIGGERS` in `tools/wri/folds.ts` by `test/wri-readers.test.ts`).

## Who holds which pen

Examiner authors the exam, Builder edits the harness, Verifier checks validity, Referee rules on rejections (`AGENTS.md` §1–8). Six principles:
- **Weigh verdicts by instrument**: pinned domain engines outweigh author-computed checks.
- **Verify condition identity**: paired solves must differ solely in the harness.
- **Separate outcomes**: passes, rejections, limit expiries without submission, non-results.
- **Treat rulings as readings**: `earned` without a clearing probe merely restates the check; Referee accuracy is unknown until blind human labels exist.
- **Read comparisons on untied tasks**: ties carry zero weight; intra-harness flips measure variance; set-asides drop rejected-arm losses.
- **Separate observation from inference** in distinct sentences.

## How the catalogue is read

Triggers from `bun tools/wri/wri.ts read` point where to inspect, not what to conclude. Lanes 1, 4, 8, 12, 14, 19 are `standing`; lane 6 runs `alone`; lane 14 runs `blind` first; lanes 18–19 run `side-by-side`. Name one owner below and cite event kinds, solve ids, 8-char digests, check ids and counts (never quote tasks, answers, hidden values or traces):

| owner | what it is |
| --- | --- |
| `pack/evaluator`, `pack/brief`, `pack/controls`, `pack/tasks` | exam files (stored or drafted) |
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

Put scratch scripts in temp dir (`bun <tmp>/x.ts <log>` or `python3 -B <tmp>/x.py < <log>`), never inside a campaign folder.

## Labels

Maps PR/prediction labels (`checkLabels`, `tools/runtime/land.ts`) to lanes:

| point | lanes | label | changes |
| --- | --- | --- | --- |
| verdicts | 1, 2, 7 | `exam` | drafting, checks, verifier, controls, freeze/admission, public task text |
| verdicts | 4 to 6 | `verdicts` | Referee, set-asides, hand labels, `settle.ts` |
| supply | 20, 21 | `supply` | task authoring/admission, practice release, room, Examiner inputs |
| climb | 15, 16 | `harness` | Builder session/prompt/tools/practice, harness contract, Builder wall |
| honesty | 3, 8 to 11 | `comparison` | terms, pairing, scored set, tally, statistical test, A/A, conditions |
| climb | 12 to 14, 17 to 19 | `climb` | move table, campaign moves, starter comparisons, promotion, stop rule, endings, words |
| honesty | 22 | `solve` | solve execution, backends, sandbox wall, endings, non-results, slots, load |
| economy | 23 | `economy` | billing, metering, budget, timing readers |
| honesty | 22 | `runs` | launching/moving runs, logins, hosts, launch receipts |
| honesty | rows A to F | `log` | log schema, event kinds, conditions, folds, `view`, `replay`, UI |
| none | none | `investigation` | `tools/wri/`, this catalogue, WRI skill & scripts |
| none | none | `landing` | PR stack, `land`, git hooks, CI gate |
| none | none | `quality` | lint, simplify census, size policy, style |
| none | none | `docs` | `AGENTS.md`, `docs/`, prose |

## Deterministic rows A to F

Settle from `bun tools/wri/wri.ts read --log <log>` before opening lanes:
- **A. campaign & log**: `log.jsonl`, `checks/`, `states/`; verify clean fold, host hash vs checkout, billed USD & wall hours by role.
- **B. checker identity**: contract & check hashes from `contract.frozen` and `checker.read` (+ `despite` fault count).
- **C. conditions**: distinct condition values by arm/model + completed solves missing `responseModels`.
- **D. task sets**: versions by origin (`pack`/`session`/`carried`) and state; practised and scored sets must stay disjoint (`PRACTISED TASK MEASURED`, lane 15).
- **E. case partition**: per arm—passes, fails by kind (`rejected` with check ids), `flagged`, non-results, unfinished.
- **F. sessions & chain**: moves (incl. open move), endings, spend vs cap, Builder parent/child digests, practice activity, comparison readings (`g-N`), Examiner proposed/admitted counts.

## Lanes 1 to 23

### Validity: the instrument, its review, and its draft

**1. Verdict chain: what a pass observes.**

Label: `exam`.
Importance: 0.7.
Marks: `standing`.

Starts from `INSTRUMENT AUTHORED (lane 1)`, `REFUSALS BY CHECK (lane 1)`,
`VERIFIER TOOLS MOVED (lane 1)`, the checker's own `NO CHECKER READING (lane 1)`,
`CHECKER READ WITH FAULTS (lane 1)`, `CONTROL COVERAGE (lane 1)`, `CHECKER NOT FROZEN (lane 1)`,
`FROZEN DESPITE FAULTS (lane 1)`, `READ AT ANOTHER VERSION (lane 1)` and `TASKS CARRIED (lane 1)`,
and from `PASSES UNREAD (lane 1)`, which is standing: no reviewer reads a pass.

What does a pass actually prove? Align `checker.read` rows (instrument, control coverage, `REFUSALS BY CHECK`) with `checks/brief.json`. Sample passing solves across families/harnesses (weighting 0-refusal checks) and perturb them via `wri.ts grade --solve <id> --set <path>=<json>` to find unread fields, unenforced rules or loose tolerances. `author` instruments prove only agreement with author code; external tools count only if making the decisive check. Note which tool tree/version scored each result (`checks.txt` lists Examiner `try-` solves). Decision: real validity vs syntactic compliance. Routes: `pack/evaluator`, `pack/brief`, `pack/controls`, `operator`.

**2. The drafted exam against its prompt.**

Label: `exam`.
Importance: 0.7.
Marks: none.

Starts from `EXAM DRAFTED (lane 2)`.

Does the drafted exam match the operator's prompt beyond structural checks (`draftFaults`, `draftReading`)? Compare `campaign.opened`'s prompt against rules, format, objective and scope. From `drafted.txt`, count earlier draft faults by kind and check whether faults were fixed or deleted; flag author checks a domain engine could run (rule 10). Decision: domain fidelity. Routes: `examiner-prompt` (`src/examiner/draft.ts`), `pack/brief`, `pack/evaluator`, `operator`.

**3. Whether validity separates.**

Label: `comparison`.
Importance: 0.75.
Marks: none.

Starts from `TIES BETWEEN VALID ANSWERS (lane 3)` and
`SAFEGUARD-9 PROMOTION BEYOND VALIDITY (lane 3)`.

Which metric carried each reading: validity, objective or legacy billing (`pointsOf`, `src/kernel/compare.ts`)? From `replay.txt` and `scores.txt`, report tally & p-value as scored, unbilled (`readsStep`), and validity-only. Separate validity wins from objective-tie wins (auditing objective arithmetic under `exams/<hash>/checks/`). Decision: step qualification & objective soundness. Routes: `operator`, `host` (`src/kernel/compare.ts`).

**4. What each seat was told.**

Label: `verdicts`.
Importance: 0.7.
Marks: `standing`.

Starts from each seat's opening at the campaign's commit, and is standing.

Did any prompt or tool result prescribe strategy, give a numeric target, leak exam data (rule 3) or state false/duplicated facts (`AGENTS.md` §2)? Inspect Examiner (`draft.ts`, `prompt.ts`, `examiner-view`, `wakes.txt`), Builder (`prompt.ts`, `builder-view`, `build.call`) and Referee (`referee.ts`) at launch commit. Confirm no Referee ruling, check id or refusal reason crossed in `build.call` (`builder/tools.ts`, `examiner/session.ts`); pair every offending sentence with its effect event. Decision: prompt/tool revision. Routes: `examiner-prompt`, `builder-prompt`, `reviewer-prompt`, `host` (`src/builder/past.ts`).

**5. False rejection among fails.**

Label: `verdicts`.
Importance: 0.5.
Marks: none.

Starts from `REFUSED UNREAD (lane 5)`, `CHECK DEFECT RULED (lane 5)`, `RULED UNCLEAR (lane 5)` and
`REPLAY MOVED THE VERDICT (lane 5)`. It also starts from `SET ASIDE AND UNSETTLED (lane 5)`,
`READING MOVES WITH THE SET-ASIDE (lane 5)`, `SET ASIDE BY SIDE (lane 5)`, `SETTLED BY HAND (lane
5)`, `REVIEW FAULTS (lane 5)`, `EARNED WITHOUT A PROBE (lane 5)`, `RULINGS REFUSED (lane 5)` and
`SCORED SET MOVED (lane 5)`.

Were rejections truly invalid, and how did set-asides shift tallies? Group by ruling (`rejections.txt`) and check refusing rules for tight tolerances, unit bugs or ambiguity. `earned` needs rule + field + answer probe (`EARNED WITHOUT A PROBE` restates the check); `check-defect` needs check + clearing probe. Compare against human labels (`settled.labels`, `settle.ts`), check set-aside bias (`src/campaign/round.ts`) and replay flips. Send undecided checks to lane 6. Decision: solver misses vs check defects & Referee trust. Routes: `pack/evaluator`, `pack/brief`, `reviewer-prompt`, `host`, `operator`.

**6. Valid-alternative rejection challenge.**

Label: `verdicts`.
Importance: 0.3.
Marks: `alone`.

Starts from `FAILS ON ONE CHECK (lane 6)` and `DEFECT RULED BESIDE PASSES (lane 6)`, and only when
lane 5 left a check undecided. It runs alone.

Prove constructively whether a check rejects valid solutions. Read only `bun tools/wri/public-exam.ts <log>`. Before reading check code, probes or reports, build valid alternatives varying permitted design/rounding/units and freeze their digests (never derive from held-out answers). Grade via `wri.ts grade --answers <dir>` and report the 2×2 valid-vs-accepted table per check. Decision: repair check? Routes: `pack/evaluator`.

**7. Public disclosure and one recipe.**

Label: `exam`.
Importance: 0.35.
Marks: none.

Starts from `PASSES AT A SMALL WALL SHARE (lane 7)`.

Do public specs/resources leak a mechanical recipe? Using `sequences.txt` and `solve.call` (tool names/order only, no quoted args), check whether one deterministic sequence recurs across passes and trace its source. Decision: task differentiation. Routes: `pack/brief`, `examiner/task`, `harness/guide`.

### The comparison

**8. What the test could show at its size.**

Label: `comparison`.
Importance: 0.75.
Marks: `standing`.

Starts from `NOTHING SCORED (lane 8)`, `CUT BY ITS CAP (lane 8)` and `SET SHORT (lane 8)`, and is
standing. It also starts from `TIED TASKS (lane 8)`, `NO VALID ANSWER (lane 8)` and `AWAITING A
LABEL (lane 8)`.

What effect size was detectable (`flipP`, `readsStep`, `compare.ts`), and why did tasks tie or drop? From `readings.txt` and `pairs.txt`, report per comparison: untied count, wins/losses, p-value, `detectable`, `falseRate` (frontier vs retained), tie kinds (`both-invalid`, `exact-repeat`, `within-room`, `both-valid`, `cancelling`), and impact of dropped tasks. For `NO VALID ANSWER` / `AWAITING A LABEL` (`prepare.ts --keep|--infeasible`), separate hard tasks from bad checks. Decision: sample size (`SIZE`), task difficulty or feasibility labels. Routes: `operator`, `examiner/task`, `pack/evaluator`, `host`.

**9. What a step rests on.**

Label: `comparison`.
Importance: 0.7.
Marks: none.

Starts from `STEP CARRIERS (lane 9)`.

Does a step generalise or rest on a narrow subset? From `readings.txt`, `tasks.txt`, `scores.txt` (leave-one-out p), `pairs.txt` (by session/family) and `nearness.txt`: find the smallest win subset whose removal pushes `p > alpha`; note shared attributes (family, session, scale, reach); cross-check A/A flips (lane 10); contrast carrying wins vs ties. Decision: general, narrow or variance-driven. Routes: `operator`, `examiner/task`.

**10. Flips and solver variance.**

Label: `comparison`.
Importance: 0.55.
Marks: none.

Starts from `FLIPS (lane 10)` and `REFERENCE AGAINST ITSELF (lane 10)`.

How much tally is solver variance? From `pairs.txt` and `answers.txt`, inspect intra-harness flips and time-mirrored A/A (`compared`, `readsStepEitherWay`). Count step wins where reference halves disagreed and compare flip rates across arms. Decision: rollouts/arm needed. Routes: `operator`, `environment`.

**11. What an objective-only step won by.**

Label: `comparison`.
Importance: 0.65.
Marks: none.

Starts from `MARGINS INSIDE THE NOISE (lane 11)`.

For validity-tied steps (`pointsOf`), did winning objective margins beat intra-harness rollout spread? `MARGINS INSIDE THE NOISE` flags >50% winning tasks inside max arm self-spread (`pairs.txt`, `answers.txt`; deterministic repeats count outside noise, noisy-reference captures inside). Compare vs A/A (or `Starter against itself` if reference tied), check shared features (lane 9), and size rollouts via `size.ts --scores <s,...>`. Never propose raising `GAP_FLOOR`. Decision: genuine gain vs noise. Routes: `host` (`src/kernel/compare.ts`), `examiner-prompt`, `operator`.

### The climb

**12. What a confirmation is made of.**

Label: `climb`.
Importance: 0.8.
Marks: `standing`.

Starts from every promotion that has a starter read, and is standing.

Would `confirmed` (`starterReads`, `src/campaign/climb.ts`) hold without winner's-curse promoting tasks? From `starter-reads.ts` and `starter-reads.txt`, report: (1) tallies/margins by origin (`differenceOf`), flagging `after` slices not reading a step alone; (2) exact selection-only false confirmation rate (`stepCount`, `comparison-reading/scripts/selection.ts`); (3) fleet confirmed vs selection expectation (`starter-reads.ts --all`); (4) validity vs objective carrier. Never propose lowering alpha or raising `GAP_FLOOR`. Decision: out-of-sample transfer vs selection bias. Routes: `host` (`src/campaign/climb.ts`), `operator`.

**13. Which link holds the next promotion.**

Label: `climb`.
Importance: 0.6.
Marks: none.

Starts from `CHAIN (lane 13)` and `NO TASK HELD OUT (lane 13)`. It also starts from `NO PRACTICE
(lane 13)`, `FINAL BYTES NEVER PRACTISED (lane 13)`, `SESSION ENDED (lane 13)`, `PRACTICE FAILS
(lane 13)`, `ENDED AND WENT ON (lane 13)` and `OPERATOR WORDS (lane 13)`.

Walk the latest epoch (`CHAIN`, row F) and stop at the first failing link: (1) frontier supply (`comparisonFloor`, `admission.ts`); (2) Builder edits & practice (`practice.txt`, `build.call`, unpractised checkpoints, budget at `SESSION ENDED`); (3) comparison power (lane 8, `readings.txt`); (4) move-table adherence (`table-timeline.ts`, latency, displaced starter reads, unchanged re-draws); (5) termination (`stopRule`, `idleOf`, `roomless`, `word.ts`, `launches.txt`, `ending.ts --at`). Decision: owner unblocking next promotion. Routes: `examiner-prompt`, `builder-prompt`, `host` (`decide.ts`, `builder/tools.ts`, `builder/session.ts`, `harness-builder.ts`, `campaign-actions.ts`), `operator`.

### The harness

**14. Harness quality, version by version.**

Label: `climb`.
Importance: 1.
Marks: `standing`, `blind`.

Starts from every harness version the campaign kept, and is standing. It grades blind, so a session
that holds it reads it first.

Lock blind grades before opening any outcome file (`versions.txt`, `readings.txt`, `rows.txt`, `practice.txt`, `calls.txt`, `names.txt`):
1. Read `chain.txt` (`harness-versions.ts <log> --blind`) and version diffs (`--chain --lines`, `--diff <d> --lines`) → assign **Soundness** (0–7; list missing local versions under `## Not read`).
2. Read `tasks.txt` (`tools/wri/tasks.ts --shape|--task|--rows`) and `exams/` checks → assign **Reach** (0–7).
3. Unseal outcomes after locking grades to check win alignment and weight growth vs bloat.

**Reach** (task difficulty for a strong domain model):

- 0: one lookup, or a direct transform of the input;
- 1: a routine method applied once;
- 2: a few standard steps, one constraint at a time;
- 3: several steps with one subtlety of the field that a careful generalist catches;
- 4: constraints that interact, or the field's own engine used with care;
- 5: specialist work: a method a generalist would not choose, or a tolerance that punishes approximation;
- 6: work a specialist gets wrong on a first pass;
- 7: the field's edge, where no published method fits whole.

**Soundness** (appropriateness of diff against parent):

- 0: breaks or misleads (guide claims what no tool does, or tool fails its own call);
- 1: fitted (names practice content or narrows to practice shapes, lane 15);
- 2: churn (rewording/reordering no solve could follow);
- 3: plausible but narrow (helps a few task shapes);
- 4: sound for one part of the domain, stated generally;
- 5: sound across domain task kinds, and solves call what it added;
- 6: specialist-teachable method with its own checks;
- 7: expert-adoptable unchanged.

Put tables under `## Grades` (per-version chain table, then per-comparison reach of wins/losses) and TSV under `## Grade rows` (`task\tcampaign\tid\tgrade` or `version\tcampaign\tdigest\tgrade`) for `wri.ts trajectory`. Never sum reach and soundness. Decision: genuine capability vs comparison gaming. Routes: `operator`, `harness/guide`, `harness/tools`, `examiner-prompt` (`src/examiner/prompt.ts`), `builder-prompt` (`src/builder/prompt.ts`).

**15. Harness delta against its note.**

Label: `harness`.
Importance: 0.8.
Marks: none.

Starts from `HARNESS CHANGED (lane 15)`, `BROKEN AT END (lane 15)`, `MEASURED AN EARLIER STATE (lane
15)`, `TOOLS EDITED (lane 15)` and `PRACTISED TASK MEASURED (lane 15)`. It also starts from `NEVER
CHECKED (lane 15)`, `TOOLS CALLED (lane 15)` and `TOOL CALLS ERRED (lane 15)`.

Diff `states/` (`harness-versions.ts --diff <d>`, no code quotes), noting unmeasured edits on `BROKEN AT END` fallback. Check content restriction (no task id, copied text or hardcoded answer; `names.txt`). Reconcile `BUILT_AGENTS.md`, `.toolchain/` and solver calls (`calls.txt`), and check `src/solver/prompt.ts` vs logged condition. Decision: step attribution & guide/wall accuracy. Routes: `harness/guide`, `harness/tools`, `builder-prompt`, `host` (`src/builder/session.ts`, `src/builder/tools.ts`).

**16. What made each win.**

Label: `harness`.
Importance: 0.6.
Marks: none.

Starts from `WINS (lane 16)`. It also starts from `WIN AT A SMALL WALL SHARE (lane 16)`, where lane
7 or 15 suspects a shortcut (won tasks passed in few calls at a small share of the deadline), and
from `ANSWER FROM A PROGRAM (lane 16)`: solves whose one shell call was followed by `submit`, with
the reference side printed as the control.

Which harness component drove each win (for `programs-of:<digest>` ablation, `AGENTS.md` §9), and where did deciding values originate? Using `parts.ts --comparison g-N` and `provenance.ts --log <log> --wins g-N` (`slice.ts` on `nowhere`), classify wins before reading lane 15: (1) new/edited tool, (2) new guide rule, (3) solver difference, (4) variance (lane 10); tabulate value provenance (tool computation, solver derivation, guide, hardcoded). Decision: provisional credit & shortcut check. Routes: `operator`, `harness/tools`, `harness/guide`, `host`.

### What the climb rests on

**17. The starter.**

Label: `climb`.
Importance: 0.65.
Marks: none.

Starts from `VALID BY HARNESS (lane 17)` and `PROMOTION UNCONFIRMED (lane 17)`. It also starts from
`CHAIN AGAINST THE STARTER (lane 17)`.

Does Starter (`src/harness/starter.ts`) leave validity headroom, why is any promotion unconfirmed (`comparedOf`), and does the chain beat Starter on unselected tasks? Check `starter-reads.ts` by origin (`after` vs earlier), measure and session alongside `Starter against itself` and `Repetition` (`barLines`). On `after` losses, separate (1) winner's curse (lane 11), (2) Examiner reference-targeting (lane 20), and (3) regression (lanes 14–15). Never propose raising `GAP_FLOOR`. Decision: chain validity vs neutral eval (`compare-systems`). Routes: `host` (`starter.ts`, `campaign-actions.ts`, `decide.ts`, `climb.ts`), `examiner-prompt`, `harness/guide`, `harness/tools`, `operator`.

**18. The promotion and the climb after it.**

Label: `climb`.
Importance: 0.75.
Marks: `side-by-side`.

Starts from `PROMOTED (lane 18)`, `STARTER BARE (lane 18)`, `AFTER THE PROMOTION (lane 18)` and
`SHARED TEMPORARY FOLDER (lane 18)`. Where several campaigns are under review, it is given their
climbs side by side, in the columns `wri.ts climb` prints.

Audit 5 points: (1) promotion validity (measure, starter order, `after` tally); (2) baseline competence (`STARTER BARE` + lanes 15–16); (3) `/tmp` or `/var/tmp` cross-arm leakage (`calls.ts --list --command '/tmp/'`); (4) epoch trajectory (`starter-reads.ts`); (5) per-epoch spend (`epoch-spend.txt`, lane 23). Compare `wri.ts climb` side-by-side after listing lane-22 confounders. Decision: report as climb & continue? Routes: `operator`, `host` (`src/campaign/decide.ts`), `examiner-prompt`, `environment`.

**19. How many independent batches a read rests on.**

Label: `climb`.
Importance: 0.75.
Marks: `standing`, `side-by-side`.

Starts from every starter read, and is standing. Where several campaigns are under review it is
given their climbs side by side.

How many independent Examiner sessions (`k`) back each starter read's `after` tasks (`0.5^k <= 0.02` needs `k >= 6`)? From `starter-reads.txt`, report: `k`, per-writer tallies and spanning sessions; min batch-level p; `after` slice winners (and side-by-side across siblings); between-session dispersion above binomial noise (lanes 9, 17, 20); cost/size for a neutral `compare-systems` eval. Never propose raising `GAP_FLOOR`. Decision: batch qualification & neutral eval need. Routes: `host` (`src/campaign/climb.ts`), `examiner-prompt`, `operator`.

### Supply: the tasks

**20. Pressure on the Examiner.**

Label: `supply`.
Importance: 0.65.
Marks: none.

Starts from `OUTCOMES BY SESSION (lane 20)`.

Does Examiner feedback (`src/examiner/record.ts`) differentiate harnesses without unfairly targeting the reference? From `OUTCOMES BY SESSION`, `aim.txt`, `starter-reads.ts` per-writer rows and lane-10 variance, compare reference vs Starter valid rates and objective ratios across sessions (falling reference + flat Starter = reference targeting; both falling = harder tasks). Never propose numeric pass-rate targets. Decision: Examiner input adjustment. Routes: `examiner-prompt`, `operator`.

**21. Supply and task admission.**

Label: `supply`.
Importance: 0.65.
Marks: none.

Starts from `SUPPLY THIN (lane 21)`, `GATE REFUSED (lane 21)` and `SCORED AFTER RELEASE (lane 21)`.

Where is supply lost between proposal and scored set, and was each `task.gate` refusal (`packageGate`, `exams.txt`, `draw.txt`) justified? Compare frontier vs `comparisonFloor` (`SIZE`, `sweepOf(level)`) without weakening admission gates; flag `SCORED AFTER RELEASE` immediately. Decision: need another Examiner session? Routes: `examiner-prompt` (`src/examiner/prompt.ts`), `host` (`src/kernel/task.ts`).

### Solve execution and economy

**22. Does the budget bind, and how each solve ended.**

Label: `solve`.
Importance: 0.45.
Marks: none.

Starts from `MISSES AT A LIMIT (lane 22)`, `WALL SHARE (lane 22)`, `HOST LOADED (lane 22)`, `LOAD
MOVED (lane 22)`, `STARTS OUT OF TURN (lane 22)`, `NON-RESULTS (lane 22)`, `SOLVE NEVER FINISHED
(lane 22)`, `EXAMINER NEVER FINISHED (lane 22)`, `MISSES WITHOUT A VERDICT (lane 22)`, `SESSION
CRASHED (lane 22)`, `TOOL MISSING (lane 22)` and `SERVED ANOTHER MODEL (lane 22)`. It also starts
from `LAUNCHES (lane 22)`, `NO LAUNCH RECEIPT (lane 22)`, `HOST CODE MOVED (lane 22)` and `LOG OUT
OF ORDER (lane 22)`.

Do limits (`LIMITS`, `campaign.ts`) bind symmetrically, and is provenance clean (`AGENTS.md` §10, item 9)? From `budget.txt`, inspect endings, turn/wall usage, host load, queue waits, non-results, crashes, missing tools and model fallbacks (`degradations.txt`). From `source.txt` and `launches.txt`, verify clean single-commit provenance, login concurrency (`runs active`) and confounders. Decision: do limits and provenance support milestone claims? Routes: `operator`, `environment`, `host` (`solver/run.ts`, `kernel/solve.ts`, `tools/runs/`, `harness-builder.ts`, `kernel/log.ts`).

**23. Time, spend and silence.**

Label: `economy`.
Importance: 0.35.
Marks: none.

Starts from `LONG SILENCES (lane 23)`, `SPEND LED BY A ROLE (lane 23)`,
`FIRST COMPARISON HELD OFF (lane 23)` and `BUILDER COMPACTED (lane 23)`.

Where did hours and dollars go, is billing complete, and what caused silences? Compare backend totals vs host meter (row F, `costLine`, `meter.ts`; `compactions.txt` for `CLAUDE_COMPACTED` vs pi compaction) and check post-compaction Builder turns. From `epoch-spend.txt`, `table-timeline.txt` and `log.ts events`, diagnose `LONG SILENCES` and `FIRST COMPARISON HELD OFF` (≥75m admissible wait, separating `wait` calls from work), and report economy (`close.ts`, `worthOf` in `climb.ts`). Decision: billing accuracy, idle causes & next-round spend. Routes: `operator`, `host`, `environment`.

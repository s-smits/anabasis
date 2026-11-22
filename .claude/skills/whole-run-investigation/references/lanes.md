# Whole-run investigation lanes

This catalogue defines six deterministic rows settled directly by the primary reviewer and twenty-three investigative lanes, each posing a focused question for an independent session. `tools/wri/catalogue.ts` parses this file, and `test/wri-readers.test.ts` verifies its alignment with `TRIGGERS` (`tools/wri/folds.ts`): every trigger emitted by the log reader must appear in the `Starts from` paragraph of the lane it opens.

## Who holds which pen

The Examiner authors the exam, drafted from the operator's prompt; the Builder develops the harness, the host's verifier decides validity, and the Referee rules on each rejection. `AGENTS.md` sections 1 to 8 specify the seats, their visibility boundaries, the evaluation wall, and the promotion rule; apply them to the conditions recorded in the log. No seat modifies the check program during a campaign, and a pass establishes only what its check actually verifies. Every row and lane applies six analytical principles:

- **Weigh each verdict by its instrument.** A check executing the domain's own reference engine carries stronger evidential weight than one relying on its author's custom computation. Identify the instrument before relying on a verdict.
- **Verify byte-level identity.** Every solve runs under a fixed condition: contract, harness digest, task version (encoding the check program's hash), verifier tool tree, sandbox, and host code. Two solves whose conditions differ in anything other than the harness do not form a valid pair.
- **Keep outcome categories separate.** A valid answer, a rejected answer, a solve that exhausted its resource limit without submitting, and a non-result are four distinct outcomes. Only a rejection provides evidence about a check, and non-results are retried and excluded from paired comparisons.
- **Treat rulings as readings.** Referee agreement with human judgement remains unmeasured until blind human labels exist, and an `earned` ruling unsupported by an answer probe merely restates the check.
- **Evaluate comparisons on untied tasks.** Tied tasks carry zero statistical weight, intra-harness flips reflect solver variance, and a task set aside due to one side's rejections removes a loss for that side.
- **Separate observation from inference.** State the recorded observation and the proposed causal mechanism in two distinct sentences so a reader can accept the first while questioning the second. Treat every prior diagnosis as a hypothesis rather than a premise.

## How the catalogue is read

A trigger is the capitalised phrase preceding the first colon of a line printed by `bun tools/wri/wri.ts read`, followed by its lane number. A trigger indicates that a lane has evidence to inspect rather than dictating a conclusion; a lane that refutes its trigger has completed its task. Lanes 1, 4, 8, 12, 14, and 19 are standing: they open on every campaign regardless of whether a trigger fired. Lane 6 is isolated: it runs alone, opens only on its trigger, and freezes its constructed answers before inspecting anything that could bias it. Lane 14 grades blind, so any session assigned lane 14 executes it before all other lanes.

No lane alters a verdict, a task state, or a comparison reading. Each finding names exactly one owner, cites its supporting evidence, and specifies the observation that would reverse it:

| owner | what it is |
| --- | --- |
| `pack/evaluator`, `pack/brief`, `pack/controls`, `pack/tasks` | the exam, stored or drafted, by file |
| `examiner/task` | a task instance as written by an Examiner session |
| `harness/guide`, `harness/tools`, `harness/tool-tree`, `harness/config` | the Built Harness, by component |
| `builder-prompt`, `examiner-prompt`, `reviewer-prompt` | instructions given to a seat, naming the owning file under `src/` |
| `host` | host code, naming the owning file |
| `environment` | the host machine or model provider |
| `operator` | a decision reserved for human authority |

Cite evidence using event kinds, solve ids, the first eight characters of a digest, check ids, and counts. Never quote task text, submitted answers, hidden values, or trace excerpts.

Each lane entry includes `Label:`, `Importance:`, and `Marks:` metadata lines, which are stripped from session prompts. `Importance:` (from 0 to 1, where only relative ratios matter) weights each lane when `wri.ts lanes` packs area labels into sessions. `Marks:` (`standing`, `alone`, `blind`, and `side-by-side`, or `none`) governs how the host schedules the lane; the lane's prose communicates the same behaviour to the session. Immediately after these metadata lines comes a paragraph beginning with `Starts from`.

## Tools a lane runs

Each tool runs from the repository checkout as `bun <path> ...`, operates read-only, and accepts a log path. The shared prompt file distributed to open lanes includes this table alongside the derived file manifest; isolated and blind lanes receive only the tools named in their own lane text.

| question | command |
| --- | --- |
| Which event kinds appear in a log, with which fields and on which lines? | `tools/wri/log.ts kinds --log <log> [--kind <kind>[,<kind>...]]` |
| Which events of specified kinds, or across a line range, appear in log order, filtered or aggregated by field? | `tools/wri/log.ts events --log <log> (--kind <kind>[,<kind>...] \| --lines <from>[-<to>]) [--fields a,b.c] [--where f=v\|f!=v\|f~prefix\|f>n\|f>=n\|f<n\|f<=n]... [--count-by f[,g]] [--full]` (rows where a bounded field is absent or non-numeric are excluded and counted in the header) |
| What is the summary of every solve (comparison, side, harness, task family, ending, turns, seconds, deadline share, load, and bill), filtered or grouped by column? | `tools/wri/log.ts solves --log <log> [--comparison <id>] [--role old\|new\|both\|try\|practice] [--where column<op>value]... [--count-by column[,column]]` |
| What did a specific seat say and call, turn by turn? | `.claude/skills/oracle-handover/scripts/slice.ts <log> 'Solver:<id>'` (also supports `'Builder:b-2{1-3}'`, `'Builder:b-1[compare,wait,practice]'` for specific tool turns, `'Examiner:...'`, or an event kind; `--count '<phrase>'` counts occurrences in served results, and `--whole` lifts truncation) |
| For one rejected solve, what were its refusing checks, Referee ruling, probes, and any human label? | `tools/wri/rejections.ts <log> --solve <id>` |
| What is a task's full public input, the structural schema of all tasks without values, or the blind grading rows? | `tools/wri/tasks.ts <log> --task <id>`, `--shape`, `--rows` |
| Which solves executed a program, accessed a path, or emitted a pattern (one row per call, omitting raw text)? | `tools/wri/calls.ts --log <log> --list (--command <re> \| --output <re>) [--harness <prefix>]` |
| What changed between a kept harness and its parent or another digest, by file or by line? | `.claude/skills/harness-audit/scripts/harness-versions.ts <log> --diff <digest> [--against <digest>] [--files \| --lines]`; `--chain [--lines]` shows every version without outcomes |
| Which programs did each winning solve execute on either side, and what had the candidate harness changed? | `tools/wri/parts.ts --log <log> --comparison g-N [--no-diff] [--all]` |
| How does one starter comparison break down task by task, with each task's writer and origin? | `.claude/skills/comparison-reading/scripts/starter-reads.ts <log> --tasks` |
| What move did the decision table recommend at each state transition compared with the move actually taken? | `tools/wri/table-timeline.ts <log>` (replays `decide` at every transition; may take up to a minute on a long log) |
| What was the campaign's ending state at a given log line or timestamp? | `.claude/skills/campaign-mechanics/scripts/ending.ts <log> --at <line \| ISO time>` |
| Which archived campaigns were drafted from the same prompt? | `tools/wri/drafted.ts <log> --siblings` |
| What is the release summary table across an archive of runs without loading an env file? | `.claude/skills/promotion-tuner/scripts/table.ts --runs <dir>` |
| Does the host's verifier accept a constructed answer, or a recorded answer with one field modified? | `tools/wri/wri.ts grade --log <log> (--task <taskId> --answer <file> \| --solve <id>) [--set <path>=<json>]...` (paths such as `cohort.x` or `$.cohort.x`), permitted only where a lane explicitly names it |

Prefer `log.ts`, `slice.ts`, and `calls.ts` over ad-hoc `jq` queries against a log: their output matches the host's own folds, and a report's observation line can cite the exact reproducible command.

Any custom helper script written by a lane must live in its temporary directory rather than inside a campaign folder. The lane guard permits `jq` over a log, Bun scripts taking the log path (`bun <tmp>/x.ts <log>`), and Python scripts reading the log from standard input (`python3 -B <tmp>/x.py < <log>`). It blocks Python invoked with a log path or without `-B`, and any script placed inside a campaign directory.

## Labels

Every pull request carries an importance label and at least one area label covering the subsystems its files touch (`checkLabels`, `tools/runtime/land.ts`). Each lane carries the area label of the pull requests that modify what it inspects. Each run's `predictions-<run>.md` inherits its pull request's area labels and maps them to lanes (`run-improvement-campaign`, step 1).

| point | lanes | label | a pull request carries it when it changes |
| --- | --- | --- | --- |
| verdicts | 1, 2, 7 | `exam` | drafting, the check program, the verifier, controls, freeze or admission, public task text |
| verdicts | 4 to 6 | `verdicts` | the Referee, set-asides, hand labels, and `settle.ts` |
| supply | 20, 21 | `supply` | task writing and admission, practice release, room, and Examiner inputs |
| climb | 15, 16 | `harness` | the Builder's session, prompt, tools, or practice, the harness contract, and the evaluation boundary to the Builder |
| honesty | 3, 8 to 11 | `comparison` | comparison terms, pairing, scored set, tally, statistical test, A/A control, and conditions |
| climb | 12 to 14, 17 to 19 | `climb` | the move table, campaign moves, starter comparisons, promotion, stop rule, endings, and operator words |
| honesty | 22 | `solve` | solve execution, backends, sandbox wall, endings, non-results, slots, and host load |
| economy | 23 | `economy` | billing, metering, budget, and timing readers |
| honesty | 22 | `runs` | launching and moving runs, logins, hosts, and launch receipts |
| honesty | rows A to F | `log` | the log schema, event kinds, conditions, shared folds, `view`, `replay`, and the status page |
| none | none | `investigation` | `tools/wri/`, this catalogue, its skill, and lane scripts |
| none | none | `landing` | the PR stack, `bun run land`, git hooks, and the CI gate |
| none | none | `quality` | linting, the simplify census, size policy, and code style |
| none | none | `docs` | `AGENTS.md`, `docs/`, and other prose of record |

Labels without an associated lane are verified by their unit tests or dedicated readers. A change falling outside existing labels takes the label of the nearest subsystem; repeated pull requests on one unlabelled topic indicate that this table needs a new row.

## Deterministic rows A to F

The primary reviewer settles these six rows directly from the log before launching any lane and never delegates them, as every downstream finding binds to them. `wri.ts read` prints all six.

**A. campaign and log.** A campaign resides in `.ana/d2/<name>`, containing `log.jsonl`, staged `checks/` (or `exams/<digest>/checks/` for a drafted exam), and `states/`. Verify that the log folds cleanly (`read` throws on an inconsistent task history). Compare the last recorded condition's host hash against the active checkout: if they differ, every statement about source code refers to a different tree, and the report must state this upfront. Row A also reports billed dollars and wall hours by role, providing the baseline for lane 23.

**B. checker identity.** A checker is uniquely identified by two hashes (the contract hash and the check program hash), read from `contract.frozen` and every `checker.read` event. A campaign lacking a `contract.frozen` event has no frozen checker, and any reading taken at different hashes evaluates a different checker. A `despite` field on a freeze records the operator's justification for freezing over faults: cite its count rather than quoting its text.

**C. conditions.** Count the distinct values of every condition field broken down by arm and model; a clean comparison has a single contract, sandbox, verifier tool tree, and host hash. Count completed solves that omit `responseModels`, for which only the provider attests the served model.

**D. task sets.** Partition task versions by origin (`pack`, `session`, `carried`) and by state (`held out`, `released`, `disputed`, `refused`). A round's sets must be disjoint: any task version that was both practised and scored fires `PRACTISED TASK MEASURED` (lane 15) and must be flagged immediately. A task receiving no valid answer across two comparisons in which none of its solves hit a resource limit leaves the scored set until a human labels it (lane 8).

**E. case partition.** For each arm, tabulate passes, fails by kind, and non-results by kind from `solve.finished`, alongside solves started but never finished and solves still open at the end of the log. Only `rejected` fails carry refusing check ids. Count `flagged` outcomes separately, and recount any figure quoted by a downstream report.

**F. sessions and the harness chain.** Summarise the campaign's moves, endings, and spend against budget. For each Builder session, record its parent digest, resulting digest, ending, whether it modified the harness or opened cleanly, its practice activity, and the reading of every comparison on its harness (indexed by session, `g-N`). For each Examiner session, record its ending, proposed tasks, and admitted tasks. Because moves are logged when they start, list every move still open at the end of the log on its own line and judge closure strictly by its ending event.

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

What does a passing verdict actually establish? Because the Referee inspects only rejections, an under-specified or overly permissive check goes undetected. Align each check's row from the latest `checker.read` (instrument, control coverage, and refusal counts from `REFUSALS BY CHECK`) with its specification in `checks/brief.json`. Sample passing solves across task families and harnesses, weighted towards checks with zero refusals, and determine from the published rules what a passing answer could still get wrong (such as an unread output field, an unenforced rule, or an overly loose tolerance). An `author` instrument proves only agreement with the task author's own computation; a named external tool counts as a domain engine only if it performs the decisive verification. When no solve passed, the check rows constitute the full lane. For `VERIFIER TOOLS MOVED` or any checker trigger, specify under which tool tree or checker version each result was counted. Use `wri.ts grade` to test a constructed answer, and `grade --solve <id> --set <path>=<json>` to regrade a recorded solve with a single field perturbed. Tasks prefixed `try-`, or solves requested by an Examiner session, are rehearsals rather than scored tasks (`checks.txt` reports them under `examiner`). Do not read pass rates here. The decision: whether a pass indicates a genuinely correct answer or merely a syntactically valid one. Routes to `pack/evaluator`, `pack/brief`, `pack/controls`, and `operator` (when frozen `despite` faults).

**2. The drafted exam against its prompt.**

Label: `exam`.
Importance: 0.7.
Marks: none.

Starts from `EXAM DRAFTED (lane 2)`.

Does the drafted exam faithfully reflect the operator's prompt? The host's automated checks (`draftFaults` in `src/examiner/draft.ts`; `draftReading` in `tools/d2/exam.ts`) verify structural compliance only; they cannot judge whether a rule belongs to the domain, agrees with authoritative sources, leaves an answer field unchecked, or whether the objective aligns with the prompt's stated priorities. Read the prompt recorded in `campaign.opened` alongside the standing draft's rules, answer format, objective, and scope. Count how many earlier drafts failed validation by fault kind and determine whether the accepted draft fixed or simply deleted the offending rule (`drafted.txt` lists each drafting session's ending and each submitted draft with host faults parsed from `draft_exam` results, followed by the standing draft's counts and author-decided checks). If `draft.finished` reports that no measurement ran during drafting, lane 21's first admission is the first empirical check. Flag any author-decided check that a domain engine could decide instead (rule 10). The decision: whether the campaign actually measures the requested domain. Routes to `examiner-prompt` (`src/examiner/draft.ts`), `pack/brief` or `pack/evaluator`, and `operator` when the prompt itself is ambiguous.

**3. Whether validity separates.**

Label: `comparison`.
Importance: 0.75.
Marks: none.

Starts from `TIES BETWEEN VALID ANSWERS (lane 3)` and
`SAFEGUARD-9 PROMOTION BEYOND VALIDITY (lane 3)`.

Which metric actually drove each comparison reading: validity, the continuous objective, or billing (`pointsOf`, `src/kernel/compare.ts`)? Report each comparison's tally and p-value as scored, without billing (`readsStep`, `unbilled`), and on validity alone. `TIES BETWEEN VALID ANSWERS` indicates that validity has saturated on most tasks, leaving only the objective (above `GAP_FLOOR`) and billing to break ties; `SAFEGUARD-9` flags a promotion that fails to clear on validity alone, so count the tasks won under each measure (`replay.txt`, while `scores.txt` reports validity-only and objective-only tallies beside the A/A splits). The check program lives at `<campaign folder>/exams/<exam hash>/checks/`. Distinguish whether a step rests on tasks the reference harness could not solve validly or on marginal objective improvements over mutually valid answers. Because a drafted exam's objective is implemented by its author, audit its arithmetic first. The decision: how a promotion should be qualified in reporting, and whether the objective genuinely reflects answer quality. Routes to `operator`, and to `host` (`src/kernel/compare.ts`) if recomputed tallies disagree with the logged report.

**4. What each seat was told.**

Label: `verdicts`.
Importance: 0.7.
Marks: `standing`.

Starts from each seat's opening at the campaign's commit, and is standing.

Did any seat's prompt prescribe a strategy, supply a numeric target or count, or present a false, missing, or duplicated fact (`AGENTS.md` section 2)? A prompt defect affects every session of that seat. At the launch receipt's commit, inspect the Examiner's prompts (`src/examiner/draft.ts`, `src/examiner/prompt.ts`, `examiner-view <name>`), the Builder's prompts (`src/builder/prompt.ts`, `builder-view <name>`, and its `build.call` tool results), and the Referee's prompt (`src/referee/referee.ts`). `wakes.txt` reconstructs each Examiner session's wake message (or opening task lines) under the current tree and diffs it against the logged text, separating code changes since the run from misserved facts; `slice.ts '<Seat>:<session>[<tool>]' --count '<phrase>'` counts phrase occurrences in tool results served to a seat. List every prescriptive sentence and every factual claim that influenced a subsequent move, citing the event that confirms or refutes it. Prescription appears as moves that follow an instruction regardless of evidence; a false fact appears as a move that the true fact would have altered. Prompt sentences may be quoted directly. Remedies consist of supplying a missing fact or deleting prescriptive text, never introducing a target. The decision: whether a seat's prompt or tool result requires revision. Routes to `examiner-prompt`, `builder-prompt`, or `reviewer-prompt` (naming the file), and `host` when a tool result reads the wrong fold (`src/builder/past.ts`). Any revision to Builder-facing text must remain byte-identical when hidden values change (rule 3).

Verify from `build.call` that the Builder never observed a Referee ruling, check id, or refusal reason, and audit the Examiner's inputs against `AGENTS.md` section 3 (`src/builder/tools.ts`, `src/examiner/session.ts`).

**5. False rejection among fails.**

Label: `verdicts`.
Importance: 0.5.
Marks: none.

Starts from `REFUSED UNREAD (lane 5)`, `CHECK DEFECT RULED (lane 5)`, `RULED UNCLEAR (lane 5)` and
`REPLAY MOVED THE VERDICT (lane 5)`. It also starts from `SET ASIDE AND UNSETTLED (lane 5)`,
`READING MOVES WITH THE SET-ASIDE (lane 5)`, `SET ASIDE BY SIDE (lane 5)`, `SETTLED BY HAND (lane
5)`, `REVIEW FAULTS (lane 5)`, `EARNED WITHOUT A PROBE (lane 5)`, `RULINGS REFUSED (lane 5)` and
`SCORED SET MOVED (lane 5)`.

Was each rejected answer genuinely invalid, or was a valid answer wrongly refused? A false rejection creates a spurious win for the opposing arm and a spurious loss for the rejected arm. Group rejections by Referee ruling and evaluate whether each refusing check's published rule could reject a valid answer (for instance, a tolerance tighter than published rounding, an alternate unit convention, or an ambiguous phrasing). Audit the rulings against this criterion: an `earned` ruling must cite a specific rule and answer field, whereas a `check-defect` ruling must name the refusing check and cite a probe that cleared the refusal. Where human labels exist (recorded in `comparison.reported`'s `settled.labels`, printed beside the standing rulings in `rejections.txt`), compare the Referee's rulings against them and check whether the agreement bar of `AGENTS.md` section 1 is met; otherwise qualify the rulings as a single automated reader's output. `REPLAY MOVED THE VERDICT` indicates a non-deterministic check. Where public rules cannot decide validity, retain the existing ruling and refer the check to lane 6. Report counts per check id. The decision: whether failures reflect solver limitations or evaluation noise. Routes to `pack/evaluator`, `pack/brief`, and `operator` (when human labels are still pending).

Also track the downstream effect of every rejection. Any rejection not ruled `earned` sets its task aside for both arms, so asymmetric set-asides bias the tally in favour of the side whose rejections were set aside (`SET ASIDE BY SIDE`). `READING MOVES WITH THE SET-ASIDE` indicates that `counted` and `scored` disagree on whether a step occurred, meaning the reading hinges on unlabelled disputes. `SCORED SET MOVED` indicates that tasks fixed in `comparison.started` dropped out of the tally; only `aside` can introduce directional bias (`src/campaign/round.ts`). For `SETTLED BY HAND` (`tools/d2/settle.ts`, `packetOf`), confirm that human labels came from blind packets and that any confirmed check defect was routed to the checker's owner. Count `earned` rulings lacking an answer probe as mere restatements of the check (`src/referee/agreement.ts`), and inspect each `referee.refused` alongside the ruling eventually recorded. A check repeatedly ruled defective across sessions requires repair. The decision: whether Referee rulings can be trusted without human review of each case. Routes to `operator`, `reviewer-prompt`, and `host`.

**6. Valid-alternative rejection challenge.**

Label: `verdicts`.
Importance: 0.3.
Marks: `alone`.

Starts from `FAILS ON ONE CHECK (lane 6)` and `DEFECT RULED BESIDE PASSES (lane 6)`, and only when
lane 5 left a check undecided. It runs alone.

Does a check reject valid solutions, demonstrated constructively? Begin by reading only the public exam via `bun tools/wri/public-exam.ts <log>`, which outputs strictly what crosses the evaluation boundary: public rules, scope, answer format, released practice tasks, and practice passes. Before inspecting the check program, Referee probes, or any lane report, construct alternative answers that satisfy every published rule while differing from an accepted answer in a permitted way (an alternative valid design, allowed rounding, or equivalent unit), and record their digests. Only after freezing those digests, evaluate them with `wri.ts grade` (`--answers <dir>` grades a directory of candidates) and report the two-by-two table of constructively valid versus verifier-accepted answers, naming every refusing check. Exclude and count any constructed candidate whose validity cannot be proven solely from public rules, and never derive a candidate from a recorded held-out answer. The decision: whether the check requires repair. Routes to `pack/evaluator`, supplying the constructed corpus to the checker's owner as accept controls.

**7. Public disclosure and one recipe.**

Label: `exam`.
Importance: 0.35.
Marks: none.

Starts from `PASSES AT A SMALL WALL SHARE (lane 7)`.

Do the task statement, public resources, or tools disclose a mechanical recipe so that solving reduces to following fixed steps? Passes completed in a small fraction of the time limit serve as the initial signal. From `solve.call` (inspecting tool names and call order without quoting arguments), a single deterministic call sequence recurring across every pass in a family indicates a recipe (`sequences.txt` tabulates these sequences by family and harness using the programs invoked inside shell calls, since built harnesses funnel most actions through `bash`). Trace where the recipe originates: the published rules, reference resources, harness guide, or tool descriptions. In particular, a rule that spells out the exact acceptance arithmetic allows a solver to replicate every check locally. The decision: whether these tasks can meaningfully differentiate harnesses. Routes to `pack/brief`, `examiner/task`, and `harness/guide` (only when the Builder introduced the recipe).

### The comparison

**8. What the test could show at its size.**

Label: `comparison`.
Importance: 0.75.
Marks: `standing`.

Starts from `NOTHING SCORED (lane 8)`, `CUT BY ITS CAP (lane 8)` and `SET SHORT (lane 8)`, and is
standing. It also starts from `TIED TASKS (lane 8)`, `NO VALID ANSWER (lane 8)` and `AWAITING A
LABEL (lane 8)`.

What effect size could each comparison detect given its sample size (`flipP`, `readsStep`, `src/kernel/compare.ts`; at significance level 0.02, a step requires at least 6-0, 8-1, 10-2, or 12-3)? For every comparison, report untied tasks, wins and losses, p-value, `detectable`, and `falseRate`, separating frontier and retained tasks, followed by a one-line interpretation: a `not-scored` comparison or one `CUT BY ITS CAP` tested nothing; an underpowered `no-step` provides no evidence of equivalence (state how many additional wins would have cleared the threshold); and a `step` rests strictly on its untied tasks. `readings.txt` reports each comparison's p-value, the reference's p-value, wins to spare or short of a step, wins needed to offset losses on equal margins, and the comparison cap relative to expected cost at the pre-comparison billing rate. Assess whether dropped tasks (`SET SHORT`) could have altered the reading. Every comparison carries false-step risk at the significance level, and comparison terms are never topped up after the fact (rule 4). The decision: whether the operator should increase comparison sample sizes. Routes to `operator`, and `host` only for an arithmetic bug.

Also determine what fraction of tasks tied and why. The untied fraction governs statistical power for all subsequent comparisons; under the null with two solves per arm, roughly 38% of tasks tie at a 50% validity rate and 69% tie at a 90% validity rate (`SIZE`, `src/kernel/size.ts`). `pairs.txt` classifies each tie (`both-invalid`, `exact-repeat`, `within-room`, `both-valid`, or `cancelling`) without exposing hidden objective values. Summarise what tied tasks demand without prescribing specific instances. A task with zero valid answers may be genuinely hard, defectively checked, or infeasible, and no stronger solver may be used to decide which; `AWAITING A LABEL` lists tasks waiting for `tools/d2/prepare.ts --keep` or `--infeasible`. Inspect their solve endings (a check refusing every attempt suggests a check defect) and never label from counts alone. The decision: what task characteristics the Examiner should be prompted for, how large the next comparison should be, and how to label pending tasks. Routes to `examiner/task`, `pack/evaluator`, and `operator`.

**9. What a step rests on.**

Label: `comparison`.
Importance: 0.7.
Marks: none.

Starts from `STEP CARRIERS (lane 9)`.

Does a promoted step generalise across the held-out evaluation set, or does it rest on a narrow subset sharing a confounding feature? `STEP CARRIERS` reports each step's untied tasks and how many top wins it could lose while still clearing the significance threshold. Using `readings.txt`, `tasks.txt`, `scores.txt` (leave-one-out p-values and margin of safety), and `pairs.txt` (tallies grouped by writing session and task family, alongside `nearness.txt` for textually similar tasks):

1. identify the smallest subset of wins whose removal pushes the step above its significance level;
2. identify what those carrying tasks share: a unit or scale, a task family, a single writing session, a convention, or a reach grade;
3. compare each carrying win against the reference's own A/A split (`REFERENCE AGAINST ITSELF`, lane 10), since a win on a task where the reference disagrees with itself is as likely to be variance as genuine improvement;
4. juxtapose the carrying wins against the tied tasks, because gains restricted to one narrow task shape amidst broad ties indicate weak generalisation.

The decision: whether to report a step as general, narrow, or variance-driven. Routes to `operator`, and `examiner/task` when carrying wins cluster in a repetitive task shape.

**10. Flips and solver variance.**

Label: `comparison`.
Importance: 0.55.
Marks: none.

Starts from `FLIPS (lane 10)` and `REFERENCE AGAINST ITSELF (lane 10)`.

How much of the observed tally is attributable to solver rollout variance? A flip occurs when a single harness produces both a valid and an invalid answer on the same task under identical conditions. `REFERENCE AGAINST ITSELF` reports the A/A control: `compared` splits the reference harness's solves into two time-mirrored halves, and `readsStepEitherWay` tests both directions at the significance level. Its untied rate defines the empirical noise floor a genuine effect must exceed, and its per-task differences measure the margins produced purely by chance: a candidate win no larger than the A/A difference on the same task lies inside the noise floor (lane 11). An A/A step is reported diagnostically without halting the campaign. `pairs.txt` places each task's margin beside its stored and rebuilt A/A difference along with per-arm flips and repeats, while `answers.txt` lists tasks where a side's passes produced identical answers. For each step, count wins occurring on tasks where the reference's own halves disagreed, and compare flip rates across arms (fewer flips on the candidate arm may indicate improved consistency). The decision: how many rollouts per arm each task requires. Routes to `operator`, and `environment` when flips cluster during high-load intervals.

**11. What an objective-only step won by.**

Label: `comparison`.
Importance: 0.65.
Marks: none.

Starts from `MARGINS INSIDE THE NOISE (lane 11)`.

For any step whose untied tasks all tied on validity, did the winning margins exceed the intra-harness rollout spread of both sides? Such steps are decided exclusively by continuous objective margins between mutually valid answers (`pointsOf`, `src/kernel/compare.ts`). `MARGINS INSIDE THE NOISE` flags every step in which more than half of the winning tasks have margins no larger than the wider of the two sides' own self-differences on the same task under identical settings (the reference's self-difference is that report's A/A `noise`), preventing a single outlier task from setting a global ceiling. A win on a task where both sides repeated their respective answers identically is a deterministic instance-level difference counted outside the noise; its generalisability is then assessed by lane 9. A win exceeding both sides' self-differences where only the reference repeated is likewise counted outside the noise, so steps not flagged here whose arms exhibit repeats should still be checked in `pairs.txt` by lane 9. Conversely, a win where the candidate repeated itself and lost no pairing remains inside the noise, because reliably reproducing the better of the reference's two answers captures half of the reference's spread; the trigger line counts these cases, which represent improved consistency against a noisy reference and require cross-task replication or a fresh starter comparison to confirm.

For each objective-only step, compare the winning margins against the A/A distribution (`pairs.txt` provides per-task margins beside stored and rebuilt A/A values, A/A quantiles, first-solve-only and second-solve-only readings, counts of wins inside, equal to, and outside their task's A/A, and tallies by writing session and family; `answers.txt` lists repeated measures). Where the reference A/A tied completely, substitute the starter's own split (`Starter against itself`) or another report's A/A for the same reference and state the substitution explicitly. Inspect what the carrying tasks share (lane 9): a single family, a single writing session, or a high-variance quantity. Estimate the sample-size remedy in solves per side using `.claude/skills/comparison-reading/scripts/size.ts --scores <s,s,...>` (passing each task's `diff` from `pairs.txt` in its native unit; the script reads no log) together with its projected cost at the campaign's per-solve billing rate. Never propose raising `GAP_FLOOR`: doing so suppresses genuine small margins alongside reference noise and has been ruled out by the operator. The decision: whether objective-only steps should be reported as genuine effects, and whether to enlarge comparisons or author tasks where validity separates harnesses. Routes to `host` (`src/kernel/compare.ts`, comparison sizing), `examiner-prompt` (tasks where validity discriminates), and `operator`.

### The climb

**12. What a confirmation is made of.**

Label: `climb`.
Importance: 0.8.
Marks: `standing`.

Starts from every promotion that has a starter read, and is standing.

Would the starter comparison still have confirmed this promotion if the harness's changes failed to transfer to new tasks? A starter comparison (`starterReads`, `src/campaign/climb.ts`) aggregates three task origins, and `confirmed` (`againstStarter`) runs a single `readsStep` over the combined tally: tasks from the promoting comparison (on which the harness was selected, introducing winner's curse) are pooled with tasks authored afterwards. Analyse four aspects separately:

1. **Composition.** For each starter read, report the reference's win-loss-tie tally by task origin (`starter-reads.ts`) and each origin's summed margin and share of the total (`starter-reads.txt`, computed via `differenceOf`). `starter-reads.ts` also reports the standalone reading on tasks authored after the promotion (`after`); list every read where `confirmed` holds despite `after` failing to read `a step`.
2. **Selection-only false confirmation rate.** Holding the margins of the two pre-promotion origins fixed as observed, assign random fair signs to the recorded margins of tasks authored after the promotion and count the fraction of sign assignments that still read `confirmed` at the significance level. This measures how often confirmation occurs purely by selection bias on the promoting tasks. `starter-reads.txt` computes this exact count over all sign draws of the untied post-promotion tasks (`stepCount`, `comparison-reading`'s `selection.ts`), and notes when pre-promotion tasks alone suffice to confirm even if all post-promotion tasks tie. Report both the draw count and denominator rather than a bare percentage.
3. **Fleet summary.** Across all starter reads under review, compare total confirmed reads, reads confirmed on post-promotion tasks alone (`starter-reads.ts --all`), and the expected number of confirmations under the selection-only null. When observed confirmations sit close to the selection-only expectation, the `confirmed` flag does not reliably distinguish transferable gains from selection noise.
4. **Carrying measure.** For each confirmed read, state whether validity or the objective carried it (`starter-reads.ts` splits each origin by validity differences; see lane 11), since objective-only confirmations rely purely on margins.

Never propose lowering the significance level or raising `GAP_FLOOR`. State how many reads underpin each count, noting that a small read is a single sample. The decision: whether `confirmed` reflects transferable improvement or selection artefacts, and what the climb milestone in `AGENTS.md` section 1 should count. Routes to `host` (`src/campaign/climb.ts`) and `operator` (milestone definition).

**13. Which link holds the next promotion.**

Label: `climb`.
Importance: 0.6.
Marks: none.

Starts from `CHAIN (lane 13)` and `NO TASK HELD OUT (lane 13)`. It also starts from `NO PRACTICE
(lane 13)`, `FINAL BYTES NEVER PRACTISED (lane 13)`, `SESSION ENDED (lane 13)`, `PRACTICE FAILS
(lane 13)`, `ENDED AND WENT ON (lane 13)` and `OPERATOR WORDS (lane 13)`.

Which single link in the campaign pipeline currently blocks the next promotion, quantified by its count? Traverse the latest epoch's chain (`CHAIN`, row F) and stop at the first failing link:

1. **Tasks.** Did the epoch hold out at least `comparisonFloor` informative tasks (`src/campaign/admission.ts`)? `NO TASK HELD OUT` breaks this link at the root.
2. **Build.** Did a Builder session modify the harness (lane 15) and validate it on practice tasks (below)?
3. **Comparison.** Did each comparison register enough untied tasks, and how many additional wins were needed to clear (lane 8)?
4. **Move table.** Did the move recommended by the decision table execute (below)? A displaced starter comparison leaves a promotion permanently unconfirmed (lane 17).
5. **Stop.** Did the campaign terminate via `stopRule`, budget exhaustion, or lack of room, and does the logged termination count match the log events?

`tools/wri/table-timeline.ts <log>` replays the decision table at every state transition alongside the moves actually executed, reporting how long each recommended move waited, how much of that elapsed inside Builder `wait` calls, and what admission refused. Its `admissible` row marks when a first comparison first became eligible and the elapsed hours until one started (including Builder waits), which `ambition` juxtaposes against total time to first comparison to separate Examiner latency from Builder latency. Each `compare` row records held-out and released counts at launch, so Builder calls between `admissible` and `compare` show what the Builder prioritised instead of comparing. Any row lacking `=` ran under different code and represents a counterfactual replay. `readings.txt` reports each comparison's cap, reserve, test price, and whether it was truncated. Name the blocking link, its observed count versus requirement, its owner, and every change since the parent run sitting on that link (from the prior state), together with its trigger count and mechanism event count: a change whose event never fired on the blocking link remains unmeasured. Count promotions strictly within this campaign. The decision: what action runs next. Routes to `examiner-prompt`, `builder-prompt`, `operator` (sizing or stop policy), and `host` (`src/campaign/decide.ts`).

Evaluate whether the Builder used practice solves effectively as empirical feedback, as practice is its sole outcome signal. From `build.call`, tabulate every practice solve (harness digest, task, ending, subsequent edit, and whether the edited harness was retested), counting practice solves per comparison, comparisons launched on unpractised harnesses, earned failures followed by edits and subsequent passes, flips without edits, and edits made without prior practice evidence (`practice.txt` provides one row per practice solve with its harness role, allowing starter practice to be counted without parsing raw call text). Adapting a harness around a failure ruled a check defect represents overfitting to an evaluation bug. For `SESSION ENDED`, note how much practice budget and how many turns remained. The decision: whether a `no-step` reflects an ineffective change or an untested one. Routes to `builder-prompt` (misleading feedback, without prescribing strategy) and `host` (`src/builder/tools.ts`, `src/builder/session.ts`).

Finally, audit move-table adherence and ending integrity. Each `campaign.move` records either the decision table's code (`decide`) or `led` when the Builder chose differently (`asked` in older logs). Diff any repeated comparison of a non-latest harness against the same reference (lane 15): if only prose or an unread default changed, it constitutes a second statistical draw on the same pair, permitted only when explicitly requested by the table (`readAgainst`). `ENDED AND WENT ON` is valid after `operator`, `finished`, `environment`, or a crash, but represents a defect after `budget`, `stop`, or `no-room` without an intervening operator word. Recount ending criteria (`idleOf` in `tools/d2/campaign-terms.ts`; `roomless` in `src/campaign/decide.ts`). `OPERATOR WORDS` tallies `campaign.word` events and responses (`pendingWords`, `src/campaign/word.ts`), noting beside any pause the command that issued it (`runs pause --after next`, `runs continue on login N --after reported`) where logged; verify that no seat observed an operator word. `launches.txt` maps each launch to its log segment (last event, endings, unclosed steps, killed sessions and solves, and gap to the next launch) without attributing who stopped the run; `ending.ts --at` inspects the ending state at any line or timestamp. The decision: whether campaign moves and endings faithfully reflect the decision table. Routes to `host` (`src/campaign/decide.ts`, `tools/d2/harness-builder.ts`, `tools/d2/campaign-actions.ts`), `builder-prompt`, and `operator`.

### The harness

**14. Harness quality, version by version.**

Label: `climb`.
Importance: 1.
Marks: `standing`, `blind`.

Starts from every harness version the campaign kept, and is standing. It grades blind, so a session
that holds it reads it first.

Did the harnesses genuinely improve domain capability, or merely learn to clear comparisons? A statistical step says nothing about task difficulty or whether a domain specialist would adopt the change. Complete all blind grades before inspecting any outcome file, recording each grade as it settles:

1. Read `chain.txt` from the derived folder to see every kept version, its parent, its components, and what changed, with all outcomes withheld (`bun .claude/skills/harness-audit/scripts/harness-versions.ts <log> --blind`).
2. Inspect the diffs (`--chain --lines`, or `--diff <digest> --lines` for a single version against its parent, without outcomes; see [harness-audit](../../harness-audit/SKILL.md)) and assign soundness grades. List any version absent from the local copy (`versions.txt`) under `## Not read` as ungraded; refreshing copies belongs to the primary.
3. Read `tasks.txt` (public inputs of scored tasks with outcomes withheld via `tools/wri/tasks.ts`; `--shape` prints structures without values, `--task <id>` prints one full input, and `--rows` prints the grade rows to fill) together with the checks under `exams/`, and assign reach grades.
4. Only after locking those grades, inspect `versions.txt`, `readings.txt`, rows D and E in `rows.txt`, and any remaining derived files (`practice.txt`, `calls.txt`, and `names.txt` all expose outcome information).

Both scales run from 0 to 7. Grades are reviewer assessments never exposed to any seat.

**Reach** measures how difficult a held-out task is for a strong current model working in the domain, judged from its public text, rules, and checks:

- 0: one lookup, or a direct transform of the input;
- 1: a routine method applied once;
- 2: a few standard steps, one constraint at a time;
- 3: several steps with one subtlety of the field that a careful generalist catches;
- 4: constraints that interact, or the field's own engine used with care;
- 5: specialist work: a method a generalist would not choose, or a tolerance that punishes approximation;
- 6: work a specialist gets wrong on a first pass;
- 7: the field's edge, where no published method fits whole.

Begin by defining the domain-specific criteria corresponding to each rung so a second independent grader would agree. Afterwards, compare each grade against the reference's valid rate, regrading once any high-graded task that the starter consistently solves. A harness version's reach is the highest grade at which most of its solves are valid; where the reference solves every task validly, report instead how much objective wins improved the objective by grade.

**Soundness** measures whether a version's changes are appropriate for the domain, judged strictly from its diff against its parent:

- 0: it breaks or misleads: the guide claims what no tool does, or a tool fails its own call;
- 1: it is fitted: it names practice content or narrows to the practice set's shapes (lane 15);
- 2: churn: rewording or reordering no solve could follow;
- 3: plausible but narrow: it helps a few task shapes;
- 4: sound for one part of the domain, stated generally;
- 5: sound across the domain's kinds of task, and the solves call what it added;
- 6: a method a specialist would teach, with its own checks;
- 7: what an expert would adopt unchanged.

Once outcomes are unsealed, check whether winning tasks align with where the harness change actually acts. Growing harness weight (`chain.txt`) with flat soundness indicates bloat rather than progress.

Place the grading tables under `## Grades`, between the verdict line and `## Findings`: first one row per version in chain order (digest prefix, parent, tallies with and without billing, weight, soundness with a one-sentence rationale, and reach), followed by one row per comparison giving the reach distribution of won and lost tasks. Under `## Grade rows`, append one tab-separated line per grade (`task<TAB>campaign<TAB>id<TAB>grade` or `version<TAB>campaign<TAB>digest<TAB>grade`) for `wri.ts trajectory --log <logs> --grades <report>`. Never sum reach and soundness into a composite score. Cross-campaign blind grading is orchestrated via `wri.ts packets --log <logs> --out <dir> --graders 2`: launch its `launch.json`, run `wri.ts packets --out <dir> --join`, execute any reconciliation regrades once, and join again. The decision: whether a climb represents genuine domain capability or promotions on easy tasks or objective noise. Routes to `operator`, `harness/guide` or `harness/tools` (for grades 0 or 1), `examiner-prompt` (`src/examiner/prompt.ts`) when all scored tasks grade 2 or below, and `builder-prompt` (`src/builder/prompt.ts`) when soundness declines across successive promotions.

**15. Harness delta against its note.**

Label: `harness`.
Importance: 0.8.
Marks: none.

Starts from `HARNESS CHANGED (lane 15)`, `BROKEN AT END (lane 15)`, `MEASURED AN EARLIER STATE (lane
15)`, `TOOLS EDITED (lane 15)` and `PRACTISED TASK MEASURED (lane 15)`. It also starts from `NEVER
CHECKED (lane 15)`, `TOOLS CALLED (lane 15)` and `TOOL CALLS ERRED (lane 15)`.

What actually changed between parent and child harnesses, and do the measured bytes match the Builder's description? Diff the kept snapshots under `states/` component by component (`.claude/skills/harness-audit/scripts/harness-versions.ts <log> --diff <digest>` from [harness-audit](../../harness-audit/SKILL.md); the initial parent is the Starter) and summarise each change by kind and size without quoting source lines. Compare the diff against the note in `harness.version` or the preceding turns of a led conversation's `build.checkpoint`. When the final state failed to open, the round evaluated the last practised state; identify the unmeasured subsequent edits. Rely strictly on the diff rather than `edit` calls, because shell commands can modify files without emitting `edit` events, and remember that resource limits come from the host condition (`agent/config.yaml` is ignored). Audit every harness file against the Builder's sole content restriction: no task id, task text, or hardcoded answer, which would overfit to those specific instances (`names.txt` flags occurrences of task ids, prefixes, families, rare identifiers, or spans of six or more words copied from public task inputs, noting match length and task count; treat each hit as a lead to inspect, since short tokens and standard domain phrases recur naturally). General search and filtering against public rules are permitted, and the solver decides what to submit. The decision: what a step should be attributed to, and whether the harness assisted the solver or memorised answers. Routes to the modified `harness/` component, `builder-prompt` if the content limit was violated, and `host` (`src/builder/session.ts`, `src/builder/tools.ts`) if the evaluated state differs from the logged one.

Also verify whether the harness guide's claims accurately describe the shipped tools and observed solver behaviour, because an inaccurate guide silently degrades every solve. Reconcile three sources:

1. **Guide claims**: every method, verification check, default, limit, or workflow order promised by `BUILT_AGENTS.md`.
2. **Shipped programs**: whether `.toolchain/` implements each claim completely, partially (for example, running a cross-check only on a subset of cases), or not at all.
3. **Observed solves**: which tools solvers actually invoked, in what sequence, and which documented tools went unused (`TOOLS CALLED`, `TOOL CALLS ERRED`; inspect outputs because a non-zero exit code may be intentional). `calls.txt` traces invocations through wrappers (`bash -lc`, interpreters, paths, and pipelines) and reports unattributed call segments; imported helper libraries are credited to the calling script.

Check the solver's system prompt (`src/solver/prompt.ts`) against the logged condition as well. Do not judge domain methodology here; lane 14 uses this lane's factual discrepancies when grading soundness. The decision: whether failed solves were misled by inaccurate instructions. Routes to `harness/guide` and `harness/tools` (for the Builder to repair), and `host` if a system prompt sentence contradicts the runtime condition.

**16. What made each win.**

Label: `harness`.
Importance: 0.6.
Marks: none.

Starts from `WINS (lane 16)`. It also starts from `WIN AT A SMALL WALL SHARE (lane 16)`, where lane
7 or 15 suspects a shortcut (won tasks passed in few calls at a small share of the deadline), and
from `ANSWER FROM A PROGRAM (lane 16)`: solves whose one shell call was followed by `submit`, with
the reference side printed as the control.

Which harness component, if any, produced each winning task? Strictly speaking, only an ablation comparison against `programs-of:<digest>` attributes a step causally to code versus guide (`AGENTS.md` section 9); this lane identifies where to aim that ablation. Focus first on promoted steps and their tasks untied without billing (`readings.txt`, `STEP CARRIERS`). For each winning task, inspect both arms' solve traces and classify where their trajectories first diverge:

1. the candidate invoked a newly added or modified tool;
2. the candidate followed a guide instruction absent from the reference;
3. the solver chose a different approach independent of any harness change;
4. both arms used the same approach with different outcomes, indicating solver variance (lane 10).

`parts.ts --comparison g-N` lists the programs invoked by each winning solve on both arms alongside what the candidate harness changed; map tasks to scores via `frontier.of` and `retained.of` in the report rather than by positional index. Read the traces before inspecting the harness diff, and tabulate win counts across the four categories. A component driving the majority of wins is the primary target for a `programs-of` ablation. The decision: which harness component receives provisional credit for a promotion. Routes to `operator`, and `harness/tools` or `harness/guide` for unused components.

Trace the provenance of each deciding answer value. For every task won by the candidate (listed by `WINS`, including objective wins where both arms passed), read the candidate's `solve.turn` and `solve.call` events in chronological order to identify where the deciding value first appears: computed by a tool from public input, derived by the solver's own reasoning, stated in the guide, or absent from the trace. `bun tools/wri/provenance.ts --log <log> --wins g-N` locates the earliest verbatim appearance and numeric precision of each leaf in a winning answer by position (never quoting values), alongside the reference arm as a control; it inspects kept harness states automatically, and `nowhere` simply means no match at the tested precisions, which a full trace read (`slice.ts`) resolves. Flag any hardcoded constant a tool emits regardless of input. Tabulate counts by provenance source, citing up to three solve ids and turn indices per row, before inspecting lane 15's diff. The decision: whether a win reflects genuine problem solving or hardcoded knowledge. Routes to `harness/tools`, `harness/guide`, or `host`.

### What the climb rests on

**17. The starter.**

Label: `climb`.
Importance: 0.65.
Marks: none.

Starts from `VALID BY HARNESS (lane 17)` and `PROMOTION UNCONFIRMED (lane 17)`. It also starts from
`CHAIN AGAINST THE STARTER (lane 17)`.

What baseline does the Starter provide, do the tasks leave headroom above it, and does every promoted harness still beat it? The Starter (`src/harness/starter.ts`) is pi's standard coding agent with four tools and a two-line guide following `EXAMPLE`. Using `VALID BY HARNESS`, compare the Starter's valid rate against the preceding release on the same pack and setting; a baseline near 100% leaves no validity headroom. Check whether built guides preserve or outgrow the Starter's template. A promotion is confirmed by its epoch's first starter comparison that tallies at least one task (`confirmed`, `src/campaign/climb.ts`). For each `PROMOTION UNCONFIRMED`, establish whether the epoch is still open, another move displaced the starter comparison (`comparedOf`), or the Starter matched the reference. Next, inspect each starter read's breakdown (`bun .claude/skills/comparison-reading/scripts/starter-reads.ts <log>`): split by task origin (tasks that selected the harness, earlier unselected tasks, and tasks authored after the promotion), further separated by validity-decided versus objective-decided pairs and by writing session. Pay particular attention to the standalone reading on post-promotion tasks (`after`: `a step`, `a step for the starter`, `no step`, or `too few`), because post-promotion tasks are the only origin free from selection bias; a confirmation resting solely on earlier origins merely re-tests the promoting comparison.

Check the Starter's internal variance on the `Starter against itself` line (`barLines`, `src/campaign/climb.ts`), which splits Starter solves into mirrored halves just as the A/A splits the reference; a reference lead within this noise floor is uninformative. The adjacent `Repetition` line identifies comparisons where each arm produced identical validity and objective values across all rollouts of every task: in such cases no split exposes variance, and an all-tie A/A is not a measured zero noise floor. Because post-promotion tasks are written by an Examiner that observes reference outcomes (lane 20), losses there may reflect Examiner targeting rather than genuine regression; when such losses recur across reads, perform the chain analysis below. The decision: whether the Starter's guide remains appropriate, whether tasks need replacement, and whether a promotion counts towards the milestone. Routes to `host` (`src/harness/starter.ts`; `tools/d2/campaign-actions.ts`, `comparedOf`), `operator`, and `harness/guide` or `harness/tools` where a promoted harness loses to the Starter.

Does a chain of successive promotions, each beating its immediate parent, actually beat the Starter on tasks that selected none of them? `CHAIN AGAINST THE STARTER` fires when, aggregated across two or more starter reads, the reference lost more post-promotion tasks than it won; it prints each read's chronological tally on post-promotion tasks, sums on the other two origins, and how many reads clear as steps without the selecting tasks. Separate three competing explanations, citing the count that distinguishes each:

1. **Selection on margin noise.** Because a promotion is chosen on tasks it won, its margins on those tasks exhibit winner's curse and regress to the mean on fresh tasks. Compare each promoting step's margins against its A/A (lane 11) and each starter read against `Starter against itself` (`barLines`); when both sit inside the noise floor, reversals on fresh tasks match chance expectations.
2. **Examiner targeting.** Because the Examiner reads reference outcomes (`src/examiner/record.ts`) and authors tasks where the reference has not closed the frontier, post-promotion tasks may systematically challenge the reference without challenging the Starter (lane 20). Compare the Starter's valid rate and objective on post-promotion versus pre-promotion tasks and by writing session (`starter-reads.ts` per-writer lines, and `--tasks` for per-task origin, writer, solve endings, and ratios to the author's best): a stable Starter paired with a declining reference points to targeting, whereas both declining indicates genuinely harder tasks. Note which `comparison.reported` events preceded each writing session's `exam.started`.
3. **Genuine harness regression.** What remains after accounting for the first two factors: losses exceeding both sides' noise floors on tasks where the Starter's performance did not improve, cross-referenced with lane 14's soundness grades and lane 15's diffs to locate where the chain degraded.

Document any condition drift across reads (row C: setting, solver, host code, or load), as a confounder can mimic any of the three causes. State task counts per origin, since small sums carry high variance. A neutral held-out evaluation set authored blind to both harnesses (such as another campaign's held-out tasks run via [compare-systems](../../compare-systems/SKILL.md)) cleanly separates the first two explanations from the third; because it incurs model spend, propose it with a sample size for operator approval. Never propose raising `GAP_FLOOR`: it masks small margins symmetrically and resolves nothing about causal attribution. The decision: whether the promotion chain counts as a genuine climb and whether to request a neutral evaluation. Routes to `host` (`src/campaign/decide.ts`, `src/campaign/climb.ts`), `examiner-prompt`, and `operator`.

**18. The promotion and the climb after it.**

Label: `climb`.
Importance: 0.75.
Marks: `side-by-side`.

Starts from `PROMOTED (lane 18)`, `STARTER BARE (lane 18)`, `AFTER THE PROMOTION (lane 18)` and
`SHARED TEMPORARY FOLDER (lane 18)`. Where several campaigns are under review, it is given their
climbs side by side, in the columns `wri.ts climb` prints.

Did each promotion measure what the campaign is designed to measure, and did the campaign climb afterwards? Complete this lane before claiming a campaign improved a harness, keeping five parts separate:

1. **Promotion rule.** `PROMOTED` reports the promoted harness, its parent, the promoting authority (the move table or `tools/d2/promote.ts` with any `despite` flag), and its comparisons with tally, p-value, significance level, and A/A control; the A/A provides variance evidence rather than a second promotion threshold. Separate candidate wins decided by validity from those decided solely by objective margins, and verify whether the starter comparison was the first comparison of its epoch to tally a task (a Builder comparison finishing first leaves the promotion permanently unconfirmed). Note whether lane 17 marks it confirmed and how post-promotion tasks read alone (`after`, `starter-reads.ts`); when all wins are objective margins, consult lane 11 before claiming an effect.
2. **Baseline competence.** `STARTER BARE` indicates that the reference failed to answer most tasks, meaning the step demonstrates that having a working tool beats having none rather than quantifying domain sophistication. Cross-reference lane 15's diff and lane 16's win attribution.
3. **Cross-arm contamination.** `SHARED TEMPORARY FOLDER` counts solves referencing paths under `/tmp` or `/var/tmp`, serving as a lead rather than proof of leakage. Wherever such a command succeeded, determine which arm benefited (`calls.ts --list --command '/tmp/'` prints one row per matching call without raw text).
4. **Post-promotion trajectory.** From `AFTER THE PROMOTION`, track the reference's valid rate and objective gap epoch by epoch: new tasks the reference already solves produce ties (lane 8), whereas unsolvable tasks create false headroom (lane 8). Inspect starter comparisons epoch by epoch as well, comparing each control's tally on newly authored tasks against earlier ones (`starter-reads.ts` by origin). Recurring wins on selecting tasks paired with losses on new tasks indicate a chain that may not hold against the Starter (lane 17).
5. **Spend by role.** Using `epoch-spend.txt` (lane 23), report billed dollars per epoch broken down by role and comparison cost, splitting any session that spanned a promotion across both epochs.

When reviewing multiple campaigns jointly (with confounders catalogued in lane 22), open with `wri.ts climb`'s side-by-side table and any cross-campaign temporary path collisions (`crossings`). Compare cost to first promotion, tallies alongside A/A controls, tie rates, winning harness changes, practice exposure, and subsequent progress, aligning campaigns by move index rather than wall-clock hour. A code-tree difference is a plausible causal explanation only when other conditions match, and a single campaign per tree is a sample of one. The decision: whether to report a promotion as an improvement and whether to continue the campaign. Routes to `operator`, `host` (`src/campaign/decide.ts`), `examiner-prompt` (when new tasks fail to create headroom), and `environment`.

**19. How many independent batches a read rests on.**

Label: `climb`.
Importance: 0.75.
Marks: `standing`, `side-by-side`.

Starts from every starter read, and is standing. Where several campaigns are under review it is
given their climbs side by side.

Is the true unit of statistical evidence an individual task or a batch of tasks? Post-promotion tasks are authored by one or a few Examiner sessions, and tasks from the same session share their writer's prompt state, families, and difficulty profile, introducing intra-batch correlation. Analyse five components:

1. **Batch structure.** For each starter read, count how many distinct Examiner writing sessions authored the post-promotion tasks and report the reference's win-loss tally on each session. `starter-reads.txt` gives one line per writer across the full read and slices post-promotion tasks by writing session (showing each session's majority direction and standalone test without testing across slices); flag separately any session that wrote tasks both before and after the promotion. A read backed by a single writing session represents a single batch draw.
2. **Batch-level power and inflation.** A sign test across `k` independent sessions reaches significance level 0.02 only for `k >= 6` (`0.5^k`). With `k = 1`, under the null hypothesis where neither harness is better and a session shifts its tasks' scores by as much as per-task noise, an eleven-task slice falsely reads a step for the reference roughly a quarter of the time and for the Starter equally often, compared with roughly 2% for each in the absence of a session effect (confirmed by a 5,000-draw Monte Carlo simulation over `flipP`). Report each read's `k` and the minimum p-value achievable at the batch level.
3. **Campaign slice tally.** Across each campaign, count how many post-promotion slices favoured the reference, the Starter, or neither (one count per promotion). Place sibling campaigns side by side and list confounders differing between them (lane 22: pack, host, commit, seats, budget, terms) before attributing differences to the domain.
4. **Between-batch dispersion.** Assess whether slice win rates vary more across writing sessions than binomial sampling noise at the pooled rate would predict. Excess dispersion indicates that pooled task-level tallies overstate statistical precision; inspect what clustered writing sessions shared (lane 17 for targeting, lane 20 for instance evolution, lane 9 for shared task shapes).
5. **What would settle it.** Estimate how many independently authored batches a campaign-level inference requires and the cost of a neutral batch authored blind to both harnesses ([compare-systems](../../compare-systems/SKILL.md)); because it is paid, propose it with its sample size for operator approval.

Never propose raising `GAP_FLOOR`, which merely shifts noise to the next margin. The decision: whether to report batch counts alongside task tallies for each campaign's climb and whether to commission a neutral comparison. Routes to `host` (`src/campaign/climb.ts`, reporting), `examiner-prompt` (writing batches on the open frontier), and `operator`.

### Supply: the tasks

**20. Pressure on the Examiner.**

Label: `supply`.
Importance: 0.65.
Marks: none.

Starts from `OUTCOMES BY SESSION (lane 20)`.

Does the feedback loop steer the Examiner towards tasks that genuinely differentiate harnesses across sessions? Inspect the exact inputs (`AGENTS.md` section 3, `src/examiner/record.ts`) supplied to each Examiner session. `OUTCOMES BY SESSION` reports how often the reference solved each session's tasks alongside the comparison reports available before it opened; `aim.txt` records each session's starting and ending reference digest, its `try_reference` calls, and each harness's objective relative to the author's best. Review these chronologically alongside changes in proposed task structure (`task.proposed`, quoting no text) and lane 10's A/A variance, since high-variance tasks split randomly and add no signal. Because the Examiner observes reference outcomes and targets the open frontier, post-promotion tasks can become adversarial to the reference without troubling the Starter, skewing starter reads against the reference (lane 17). Compare the Starter's outcomes against the reference's for each writing session (`starter-reads.ts` per-writer lines and each starter comparison's `valid` count): stable Starter validity paired with falling reference validity indicates reference targeting, whereas both falling indicates genuinely harder tasks. Never propose giving the Examiner a numeric pass-rate target or quota. The decision: whether Examiner inputs require revision. Routes to `examiner-prompt` and `operator`.

**21. Supply and task admission.**

Label: `supply`.
Importance: 0.65.
Marks: none.

Starts from `SUPPLY THIN (lane 21)`, `GATE REFUSED (lane 21)` and `SCORED AFTER RELEASE (lane 21)`.

Where is task supply lost between proposal and the scored set, and was every admission refusal justified? For each `task.gate` refusal (`packageGate`; `try_task` in older logs), verify whether it identified a genuine defect that the Examiner could fix. Account for tasks lost after admission, and compare remaining frontier supply against the comparison requirements (`SIZE`; `refusals` requires `sweepOf(level)`). Never propose relaxing admission gates merely to increase yield. `SCORED AFTER RELEASE` counts released practice tasks subsequently included in a scored comparison (including retained tasks), which violates the evaluation boundary. The decision: whether to budget another Examiner session before comparing. Routes to `examiner-prompt` (`src/examiner/prompt.ts`) and `host` (`src/kernel/task.ts`).

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

Does the solve resource budget (`LIMITS`, `tools/d2/campaign.ts`) differentiate the harnesses? An effective harness solves tasks within limits that the reference exhausts; limits that neither arm approaches leave only validity and the objective in play. By comparison and arm, inspect `MISSES AT A LIMIT`, `WALL SHARE` (wall-clock deadline and turn share), and effort on mutually solved tasks, classifying whether the budget binds on both arms, on the reference alone, or on neither (`budget.txt` tabulates per-arm endings, turn and time usage against limits, limit-terminated solves, shell calls meeting or exceeding the default timeout including those that explicitly requested a longer timeout and succeeded, queued hours, and load per core). Because deadlines measure wall-clock elapsed time, read host load (`HOST LOADED`, `LOAD MOVED`) and scheduling waits (`STARTS OUT OF TURN`, `campaign.waited`) alongside timeouts. Because non-results are retried while fails count, verify that each non-result classification is honest and that retries distributed evenly across arms (`NON-RESULTS`). Distinguish killed solves from still-running ones (`bun run runs pulse`), and check whether crashes, missing tools, or model fallbacks fell disproportionately on one arm. The decision: whether resource limits can measure efficiency gains and whether outcome counts are trustworthy. Routes to `operator` (limit configuration), `environment`, and `host` (`src/solver/run.ts`, `src/kernel/solve.ts`) when an ending category obscures its root cause.

Also verify experimental provenance: did the run start fresh from a prompt, at a single commit, from a clean worktree, continuing only after an authorised pause or login rotation (`AGENTS.md` section 10, item 9)? Each launch writes `launch-run-<n>.json` (`tools/runs/receipt.ts`). `LAUNCHES` counts launches, commits, dirty trees, logins (never named), Bun versions, and recorded solver Python environments (versions and packages); `NO LAUNCH RECEIPT` means the executed commit is unverified. `source.txt` records the initial launch flags followed by per-launch login changes and flag diffs, while `launches.txt` maps each launch to its log range. Continuing a run at a different commit disqualifies it as a fresh measured run; continuing after a credit or session limit is expected under rule 15. Inspect copies from separate hosts (`data/runs/<host>/<name>`) independently and never pool their counts. Check concurrent runs per login against caps (`bun run runs active`) without naming logins, and compare host load against core count. `HOST CODE MOVED` lists commits intervening between two host hashes and any comparisons straddling the change; `LOG OUT OF ORDER` usually indicates concurrent controllers writing to one log. For a fetched copy, count harness states flagged as absent in `versions.txt`. For multi-arm experiments, catalogue every difference beyond the manipulated variable (pack, host, commit, seats, budget, comparison terms) as a confounder. The decision: whether the run's promotions count towards milestones and whether a launch path permitted an invalid start. Routes to `operator`, `environment`, and `host` (`tools/runs/`, `tools/d2/harness-builder.ts`, `src/kernel/log.ts`).

**23. Time, spend and silence.**

Label: `economy`.
Importance: 0.35.
Marks: none.

Starts from `LONG SILENCES (lane 23)`, `SPEND LED BY A ROLE (lane 23)`,
`FIRST COMPARISON HELD OFF (lane 23)` and `BUILDER COMPACTED (lane 23)`.

Where did compute hours and spend go, is the billing record complete, and what caused each extended idle gap? First verify billing completeness: a discrepancy exceeding a few percent between backend-reported totals and the host's meter (row F, `costLine`, `src/kernel/meter.ts`) indicates mispriced or unpriced calls. Compaction events price summary calls from their `usages` array (`Compaction.billed`, `src/kernel/trace.ts`): the pi backend populates `usages`, whereas the Claude CLI backend writes `usages: []` (`CLAUDE_COMPACTED`, `src/agent/session.ts`), causing compaction events to report 0 locally while their cost appears only in the backend session total (`compactions.txt` lists each compaction and its usages). For `BUILDER COMPACTED`, inspect `tokensBefore`, duration, `error`, and whether subsequent turns repeated an earlier move. Spend breakdowns come from `spendOf`, and row A aligns wall hours with dollars by role. `LONG SILENCES` lists the five longest idle intervals by terminating event and bounding log lines; verify each interval from surrounding events (`log.ts events --kind <kind>,<kind>`). `FIRST COMPARISON HELD OFF` fires when a first comparison remained admissible for at least 75 minutes before starting, reporting how much of that elapsed inside Builder `wait` calls: inspect `table-timeline.txt` between `admissible` and the first `compare` to see the table's recommended move and each `wait` response, distinguishing a host message that deterred an idle Builder from productive Builder work. Project the cost of the next round, and read the economy factor from the closing report (`tools/d2/close.ts`; `worthOf`, `src/campaign/climb.ts`). The decision: projected spend for the next round, billing trustworthiness, and whether each role justifies its compute budget. Routes to `operator`, `host`, and `environment`.

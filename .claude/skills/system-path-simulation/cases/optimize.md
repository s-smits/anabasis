# Optimise by simulation

Some design changes can only be evaluated through a metric produced by a live model seat, such as
the number of task drafts an Examiner holds after a promotion, which unit tests cannot predict.
This procedure tunes such changes across iterative rounds, each consisting of a
[before-after](before-after.md) pair of [live seats](live-seat.md) launched from recorded seeds,
until the primary count shifts reliably or the position proves structurally unable to move. The
goal is to distinguish among rival hypotheses rather than confirm a preferred one: a protocol
capable only of confirming its hypothesis yields no information. Scoring parameters are tuned from
the historical archive instead ([promotion-tuner](../../promotion-tuner/SKILL.md)).

A tuning round may modify a sentence of the Examiner prompt (`src/examiner/prompt.ts`), a fact
exposed in a tool result (`admitDraft`, `src/examiner/write.ts`; `src/examiner/record.ts`), or the
Examiner home directory (`src/examiner/shell.ts`), each committed so that any newly exposed
Examiner input is documented in `AGENTS.md`, section 3. Session terms (`tools/d1b/examine.ts`,
`--tasks 12 --proposals 36 --minutes 240 --turns 200`) belong to the operator's conditions, so
tuning them as a CLI flag at one commit produces a recommendation rather than a direct merge. The
solver model, solver budget, and exam content are never experimental variables here.

## 1. Name one primary count, a graded loss, and guards

Every tuning series fixes a single primary count, its desired direction, and its decision threshold
before round one; switching to a different primary count starts a new series. Alongside a sparse
primary count, define a **graded loss** (a denser surrogate observed on every attempt that should
move in tandem with the primary count) and **guards** (metrics that must not regress). Size each
arm from the surveyed baseline rate so that the pre-registered outcomes differ by at least two
events.

`pairs` reports held drafts, validity headroom, `gap >= 1%`, median turns of the reference's valid
answers, and dollars per admission. Under the current admission schema (`TASK_ADMISSION`,
`src/examiner/write.ts`), task admissions record only passed or refused, so for current seats `held`
counts drafts that passed the package check while validity headroom and `gap >= 1%` read 0 (those
two columns are populated only for historical logs). Median turns summarise the reference's valid
answers to the session's `try_reference` probes (`gateAnswers`).

| seat | primary count | graded loss | guards |
| --- | --- | --- | --- |
| Examiner after a promotion | drafts held | drafts refused; median turns of the reference's valid `try_reference` answers | dollars per admission |
| Examiner at an opening | drafts held before the first comparison | drafts refused | dollars per admission |

Actual task headroom becomes observable only once a comparison solves the held tasks (see
`examiner-complexity`'s `ambition.ts`). Because no script currently aggregates Referee agreement
with blind labels or Builder practice and edit counts across seats, and `prompt` renders only
Examiner sessions, running a Referee or Builder tuning series first requires writing and testing
the corresponding reader.

## 2. Find a position where the count can move

Survey recorded campaigns before seeding by inspecting stretches at candidate positions
(`live-seat.ts read --log <absolute log path> --from <event>`) and selecting positions where the
primary count was poor. A **positive deviant** (another session at the same position and reference
that did move the count) demonstrates that the position is open. Repeated seat failures never prove
a position closed; only structural exhaustion does (for example, every check is already computed by
the reference's programs with no declared objective, or the previous comparison left no headroom on
any task and no subsequent seat has held a draft). Select two positions from distinct campaigns:
one development position for tuning and one held-out confirmation position.

Before evaluating any candidate edit at a new position, run two identical control seats from it
once and record their spread on both the primary count and the graded loss. This A/A spread
establishes the position's noise floor; a noise floor borrowed from another position or model is
invalid.

## 3. Diagnose before editing

Inspect individual tool calls side by side, comparing a positive deviant against a failing seat,
and ask three diagnostic questions. First, does the seat evaluate itself with its own method? A
task generator judged by solver regret learns nothing if it computes answers the same way the
solver does; the effective lever is a factual signal separating the two methods rather than an
imperative instruction. Second, which sentence in the composed prompt (step 4) is contradicted by
the log, or prescribes a course of action instead of supplying facts (`AGENTS.md`, section 2)?
Third, which error occurs across every arm? Uniformly repeated errors indicate a misstated fact in
a prompt or tool response whose correction introduces no confounder;
`live-seat.ts calls <log or campaign folder>...` tabulates each Examiner tool call with failure
counts by tool and error line. Keep each candidate edit to a few lines, as a broad rewrite
introduces multiple confounded variables at once.

## 4. Compose the prompts before paying

```sh
bun <after-tree>/.claude/skills/system-path-simulation/scripts/live-seat.ts prompt \
  --tree <before-tree> --name sim-<what>-before -- tools/d1b/examine.ts --session x-<n> <its flags> > before.txt
bun <after-tree>/.claude/skills/system-path-simulation/scripts/live-seat.ts prompt \
  --tree <after-tree> --name sim-<what>-after -- tools/d1b/examine.ts --session x-<n> <its flags> > after.txt
diff <(sed 's/sim-<what>-before/X/g' before.txt) <(sed 's/sim-<what>-after/X/g' after.txt)
```

Each tree renders its prompt using its own source modules; supply the exact production flags,
including the model. Every line in the resulting diff is part of the round's experimental variable,
so launch nothing until the diff contains only the intended edit.

## 5. Run the arms

A **series** fixes its experimental protocol before round one: positions, models and efforts,
per-pair dollar cap and wall-clock limit, the fixed admission count `N` at which pairs are read,
and host class. Each round launches a fresh control and candidate pair at every position, where the
control is the codebase accepted by the previous round.

- **Size the round to decide, or label it a screen.** A paired sign test requires at least five
  pairs of one model at six or more admissions per seat. Any smaller round must be labelled a
  `screen` in the ledger and cannot justify keeping a change in a pull request.
- **Cut two seeds at one event**: run `bun run runs seed --from <campaign> --name sim-<what>-<arm>
  --before <session>` in each arm's worktree directly on the seating host. If a seed must be
  transferred across hosts, use `rsync -aL` and verify line count, symlinks, and `seed.json`.
- **Match all nuisance variables**: use the source run's models, efforts, and reviewer, launch both
  arms simultaneously on the same host (`SKILL.md`, section 3), and never pass `--loaded`.
- **Apply identical caps and clocks**: launch each arm with `start --cap <dollars> --minutes <n>`,
  sizing the cap from historical spend (`SKILL.md`, section 3), as one background command followed
  by `due --hook` or `watch`.

## 6. Read the round

Evaluate results strictly in order: execution integrity and delivery checks, then per-pair counts,
then the noise floor, and finally the sign test.

**Execution integrity.** `pairs` rejects any pair whose seats differ in model or effort, or whose
seeds differ in source campaign or cut event; verify each arm's recorded commit in `compare`
against the ledger's `variable` field.

**Delivery checks.** Step 4 verifies prompt changes. A fact returned by a tool reaches the seat
only when that tool actually fires, so count occurrences after the seed cut:
`tail -n +<events + 1> <log> | grep -c '<text>'`, taking `events` from `seed.json`. Treat these as
delivery checks (`SKILL.md`, rule 1). An arm whose variable never fired is `unreached`
(`run-improvement-campaign`, "The pass"), reducing the pair to two draws of the control.

**Per-pair counts at the fixed horizon.**

```sh
bun .claude/skills/system-path-simulation/scripts/live-seat.ts pairs <control>,<arm> <control>,<arm> ... --gates N
```

Evaluate every pair at the pre-registered admission count `N` (`compare <prefix>... --gates N`
displays all columns); exclude any pair with fewer than 6 admissions as **thin** from the sign
test. Stop both arms once both reach `N`. If a seat continues past `N`, record its end-of-session
reading in the ledger alongside the fixed-horizon reading regardless of direction. Once the round
is decided, run `live-seat.ts stop` across every prefix named in the round's scripts, started or
not. When a metric requires qualitative judgement (task families, failure modes, or notes), have an
evaluator grade the outputs blind before unmasking arm identities.

**Noise floor and sign test.** Differences within the position's control spread (step 2) are
indistinguishable from session variance; update the spread as additional control draws accumulate.
When the control already holds nearly all drafts, the position has ceiling effects and can detect
only regressions; when it holds none, it can detect only gains. `pairs` tallies, per Examiner
model, how many pairs favour the arm, favour the control, or tie; pool only within a single series,
model, and effort level. Ties count against a gain, five out of five is the minimum required for a
one-sided sign test at alpha = 0.05, and hold counts are never summed across pairs with unequal
admission counts.

## 7. The ledger

Maintain a single ledger file in the investigation directory (`.ana/wri/<date>-<what>/`), adding a
pre-registered section before each round launches with the intent and two or three rival outcomes
(`SKILL.md`, rule 1):

```text
## Round <n>, <date> <time>
series:    <name>; in the first round its outline (step 5) and the primary count and threshold
variable:  <after sha> on <before sha>; the diff of step 4
why:       the diagnosis, with the count that showed it
arms:      each seed, its tree, source and cut; the control; start times
size:      pairs per model, or "screen"
intent:    what the change is meant to do
outcomes:  O1 <arm> holds 2 more than the control: confirm on the second position;
           O2 within the spread: revert, or keep on the simpler bar; O3 fewer, or a guard moves:
           revert and diagnose
delivery:  what must reach the seat, never counted as an outcome
guards:    dollars per admission within 30% of the control
result:    (after) step 6 in order, the outcome matched, the bar taken
next:      (after) the edit, the next seed, or the end of the loop
```

Name the candidate arm explicitly in every outcome and evaluate strictly as written; an observation
matching none of the pre-registered outcomes triggers a fresh diagnosis rather than a post-hoc
outcome entry.

## 8. Decide

A candidate enters a pull request only from a decision-sized round and only by meeting one of two
acceptance bars, recorded in both the ledger and the pull request:

- **A gain**: the variable reached the seat, the arm outperformed the control on the primary count
  or graded loss by more than the noise floor across each model's pairs, no guard regressed, and
  the effect replicated on the held-out confirmation position. A single round is only a lead
  (`AGENTS.md`, rule 6).
- **Parity with lower complexity**: no pair underperformed the control by more than the noise
  floor, the cost guard held, and the change removes more prompt text, tools, or code than it adds
  (measured with `reduce-complexity`). An additive change cannot qualify under this bar.

Revert any candidate that meets neither bar. An `unreached` result returns to step 3; a
structurally closed position (step 2) requires switching seeds rather than editing the prompt; a
null effect despite a positive deviant calls for re-diagnosing the deviant's calls; a positive
shift with intact guards proceeds to the confirmation seed; a regressed guard must be resolved
before continuing. Stop after three consecutive rounds that move neither the primary count nor the
graded loss on open positions: the seat does not control the metric, and the next place to
investigate is admission or the exam itself.

## Claims and limits

State in the pull request that "the count moved on two seeds from two campaigns", never that the
change increases the metric in general; generalisation requires fresh end-to-end campaigns at that
commit (`AGENTS.md`, section 10, item 9). Because a position's baseline depends on its source
campaign's exam, and variance across exams exceeds typical single-round effect sizes, comparisons
are valid only within the same position.

## The result

Report the ledger's `result` line, any seats still running, any retained seeds, and what was not
run. Trash each round's seeds once its result is recorded in the ledger, and trash all arm
worktrees at the end of the series while keeping the ledger file.

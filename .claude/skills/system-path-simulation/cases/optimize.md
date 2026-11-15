# Optimise by simulation

Some changes are judged by one count a live seat produces, such as drafts an Examiner holds after a
promotion, which no test can predict. This case tunes such a change in rounds, each a
[before-after](before-after.md) pair of [live seats](live-seat.md) from seeds, until the count moves
or the position shows it cannot. Its aim is to learn which of several outcomes happens, not to show
that the hoped-for one does: a protocol that can only confirm its hypothesis teaches nothing. Scoring
is tuned from the record instead ([promotion-tuner](../../promotion-tuner/SKILL.md)).

A round can change a sentence of the Examiner's prompt (`src/examiner/prompt.ts`), a fact in a tool
result (`admitDraft`, `src/examiner/write.ts`; `src/examiner/record.ts`) or its home
(`src/examiner/shell.ts`), each as a commit whose pull request adds what the Examiner newly reads to
`AGENTS.md` section 3's list. A session's terms (`tools/d1b/examine.ts`, `--tasks 12 --proposals 36
--minutes 240 --turns 200`) are the operator's conditions, so a round over them, as a flag at one
commit, ends in a recommendation. The solver, its budget and the exam are no term.

## 1. Name one count, a graded loss and the guards

A series has one primary count with its better direction and threshold, fixed before its first
round; a round that names another count starts a new series. Beside a sparse count name a **graded
loss**, a dense surrogate read on every attempt that must move with it, and the **guards**, counts
the change must leave alone. Size each arm from the surveyed base rate, so that the outcomes the
ledger names differ by at least two events.

`pairs` prints held drafts, room on validity, `gap >= 1%`, the median turns of the reference's valid
answers and dollars per admission. A task admission has recorded only passed or refused since
1 November 2026 (`TASK_ADMISSION`, `src/examiner/write.ts`), so for a current seat `held` counts
drafts that passed the package check and room on validity and `gap >= 1%` read 0; only older logs
give those two. The median turns read the reference's valid answers to the session's
`try_reference` probes (`gateAnswers`).

| seat | count | graded loss | guards |
| --- | --- | --- | --- |
| Examiner after a promotion | drafts held | drafts refused; median turns of the reference's valid `try_reference` answers | dollars per admission |
| Examiner at an opening | drafts held before the first comparison | drafts refused | dollars per admission |

The room a held task leaves shows only once a comparison solves it (examiner-complexity's
`ambition.ts`). No script counts a Referee's agreement with hand labels or a Builder's practice and
edits over seats, and `prompt` composes only an Examiner session, so a Referee or Builder series
first needs that reader, written and tested.

## 2. Find a position where the count can move

Survey before seeding: read each recorded stretch at the position (`live-seat.ts read --log <absolute
log path> --from <event>`) and keep positions where the count was poor. A **positive deviant**,
another session at the same position and reference that did move the count, proves a position open.
A seat's failures never prove it closed; only structure does: every check is one the reference's
programs already compute and there is no objective, or the last comparison left room on no task and
no recorded seat has held a draft there since. Pick two positions from different campaigns, one to
tune on and one to confirm on.

Before any arm is read at a new position, seat two controls from it once and record their spread on
the count and the graded loss. That spread is the position's noise floor; one borrowed from another
position or model is none.

## 3. Diagnose before editing

Read the attempts call by call, the deviant's beside the failing seat's, and ask three questions.
Does the seat score itself with its own method? A generator scored by a solver's regret learns
nothing when it computes answers the solver's way, and the lever is a fact that separates the
methods, never an instruction. Which sentence of the composed prompt (step 4) does the record
contradict, or which prescribes a course instead of stating a fact (`AGENTS.md`, section 2)? Which
failure does every arm repeat? That is a fact a prompt or tool states wrongly, and its fix confounds
nothing; `live-seat.ts calls <log or campaign folder>...` counts each Examiner call once, with
failures by tool and error line. Keep each candidate to a few lines: an overhaul is several
variables at once.

## 4. Compose the prompts before paying

```sh
bun <after-tree>/.claude/skills/system-path-simulation/scripts/live-seat.ts prompt \
  --tree <before-tree> --name sim-<what>-before -- tools/d1b/examine.ts --session x-<n> <its flags> > before.txt
bun <after-tree>/.claude/skills/system-path-simulation/scripts/live-seat.ts prompt \
  --tree <after-tree> --name sim-<what>-after -- tools/d1b/examine.ts --session x-<n> <its flags> > after.txt
diff <(sed 's/sim-<what>-before/X/g' before.txt) <(sed 's/sim-<what>-after/X/g' after.txt)
```

Each tree composes with its own modules; pass the seat's real flags, model included. Every diff line
is the round's variable, so seat nothing while it holds a line you did not intend.

## 5. Run the arms

A **series** fixes its outline before its first round: positions, models and efforts, each pair's
cap and minutes, the admission count pairs are read at, and the host class. Each round seats every
position as a fresh control and arm pair, the control being the code the last round decided for.

- **Size the round to decide, or call it a screen.** The sign over pairs needs five pairs of one
  model at six or more admissions; a round with fewer is labelled a screen in the ledger, and its
  result supports keeping no change in a pull request.
- **Two seeds, one cut**: `bun run runs seed --from <campaign> --name sim-<what>-<arm> --before
  <session>` in each arm's tree, on the seating host. A seed that must be copied goes with `rsync
  -aL`, checked for its line count, links and `seed.json`.
- **The same seats**: the source's models, efforts and reviewer, both arms at once (SKILL.md,
  section 3), never with `--loaded`.
- **One cap and clock an arm**: `start --cap <dollars> --minutes <n>`, the cap sized from the
  position's record (SKILL.md, section 3), each `start` one background command followed by `due
  --hook` or `watch`.

## 6. Read the round

Read in order: who ran and what reached the seat, then each pair, then the floor, then the sign.

**Who ran.** `pairs` refuses a pair whose seats differ in model or effort, or whose seeds differ in
campaign or cut; check each arm's commit in `compare` against the ledger's `variable`.

**What reached the seat.** Step 4 proves the prompt. A tool-result fact reaches the seat only when
the tool produces it, so count it from each seed's cut: `tail -n +<events + 1> <log> | grep -c
'<text>'`, with `events` from `seed.json`. These are delivery checks (SKILL.md, rule 1). An arm that
never received its variable is `unreached` (run-improvement-campaign, "The pass"), two draws of the
control.

**Each pair at the fixed count.**

```sh
bun .claude/skills/system-path-simulation/scripts/live-seat.ts pairs <control>,<arm> <control>,<arm> ... --gates N
```

Read each pair at the admission count N the outline fixed (`compare <prefix>... --gates N` gives full
columns); a pair under 6 admissions is **thin** and left out of the sign. Stop both arms once both
reach the count; a seat that ran on is read again at its end, and that reading goes in the ledger
beside the first, whichever way it points. When the round is decided, run `live-seat.ts stop` over
every prefix its scripts name, seated or not. Where a count needs judgement (families, kinds, notes),
a reader who does not know which seat is which arm grades each output before the arms are unmasked.

**The floor and the sign.** A difference inside the position's control spread (step 2) is session
variance; widen the spread as reseated controls add draws. Where the control holds nearly everything
a round can only show harm, and where it holds nothing only gain. `pairs` counts, per Examiner model,
the pairs where the arm did more, fewer or the same; pool only one series, model and effort. A tie
counts against a gain, five of five is the least a sign test reads at 0.05, and holds are never
summed over pairs of unequal admission counts.

## 7. The ledger

One file in the investigation's folder (`.ana/wri/<date>-<what>/`), with a section a round written
before its arms start, holding the intent and two or three outcomes that could each happen (SKILL.md,
rule 1):

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

Name the arm in every outcome and resolve it only as written; a result that matches none is the
next diagnosis, never an outcome written after the fact.

## 8. Decide

An arm enters its pull request on one of two bars, named in the ledger and the pull request, and
only from a round sized to decide:

- **A gain**: the variable reached the seat, the arm beat the control on the count or the graded loss
  by more than the spread in each model's pairs, no guard moved, and the move held on the confirming
  position. One round alone is a lead (`AGENTS.md`, rule 6).
- **As good, and simpler**: no pair fell short of the control by more than the spread, the cost guard
  held, and the change removes more prompt, tools or code than it adds (reduce-complexity measures
  it). A change that adds cannot pass this bar.

An arm that meets neither is reverted. An `unreached` arm sends you back to step 3; a structurally
closed position (step 2) means changing the seed, never the prompt; no move despite a deviant means
diagnosing again on the deviant's calls; a moved count or graded loss with guards intact means
running the confirming seed; a moved guard means fixing its cause first.
Stop after three rounds that moved neither count nor graded loss on positions that could move: the
seat does not own the count, and the admission or the exam is the next place to look.

## Claims and limits

The pull request says "the count moved on two seeds from two campaigns", never that the change
raises it; that needs fresh campaigns at its commit (`AGENTS.md`, section 10, item 9). A position's
count rests on its source's exam, whose spread across campaigns exceeds any round's effect, so rounds
compare only within a position.

## The result

Report the ledger's `result` line, then seats still running, seeds kept and what was not run. Trash
each round's seeds once its result is in the ledger and every arm's worktree at the end; keep the
ledger.

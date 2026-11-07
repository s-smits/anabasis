# Optimise by simulation

Some changes are judged by one count a live seat produces, such as drafts an Examiner holds after a
promotion or rulings a Referee gets wrong, which no test can predict. This case tunes such a change
in rounds, each a [before-after](before-after.md) pair of [live seats](live-seat.md) from seeds,
until the count moves or the position shows it cannot.

Treat it as training with a tiny batch. The seeds are the training set, the composed prompt is the
parameter, the count is the loss, and a seed from another campaign is the validation set. Each arm is
one draw, and two draws of one commit give the noise floor a round must clear. Weights stay fixed, so
an idea from reward-based training transfers only through what the seat reads. Scoring is tuned from
the record instead ([promotion-tuner](../../promotion-tuner/SKILL.md)).

For the Examiner a round can change a sentence of the prompt (`src/examiner/prompt.ts`), a fact in a
tool result (`admitDraft`, `src/examiner/write.ts`; `src/examiner/record.ts`) or the home
(`src/examiner/shell.ts`), each as a commit whose pull request also adds what the Examiner newly reads
to `AGENTS.md` section 3's list. It can change the session's terms (`tools/d1b/examine.ts`, `--tasks
12 --proposals 36 --minutes 240 --turns 200`) as a flag at one commit, but those are the operator's
conditions, so the result is a recommendation. The solver, its budget and the exam are no term
(`AGENTS.md`, section 6; rule 2).

## 1. Name the count, a graded loss and the guards

Choose one count that `live-seat.ts read` prints, and its better direction. A rare count (at one
hold in ten, six admissions yield 0.6) is too sparse to tune on, so name beside it a **graded loss**,
a dense surrogate read on every attempt, which must move with the count (longer reference solves
while holds fall are no room). Name the **guards**, counts the change must leave alone. All three go
in the ledger (step 7) first.

| seat | count | graded loss | guards |
| --- | --- | --- | --- |
| Examiner after a promotion | drafts held, by where their room came from | drafts refused; the author's gain over the reference's best (`gap >= 1%`, `median gap`); share reading `some` | dollars per admission |
| Examiner at an opening | drafts held before the first comparison | drafts refused on their package | dollars per admission |
| Referee | rulings agreeing with a hand label | evidence refusals per ruling | rulings refused for evidence |
| Builder | practice solves before its first edit; edits reaching a comparison | practice solves failing one check twice | dollars per session |

Size each arm from the surveyed base rate, so the predicted difference is at least two events.

## 2. Find a position where the count can move

Survey before seeding: read each recorded stretch at the position (`live-seat.ts read --log <name>
--from <event>`), classify every attempt, and keep positions where the count was poor. Look first for
a **positive deviant**, another session at the same position and reference that did move the count;
it proves the position open. A seat's failures never prove a position closed; only structure does:
every check is one the reference's programs already compute and there is no objective, or the last
comparison left room on no task and no recorded seat has held a draft there since. Seed right before
the seat (SKILL.md, rule 2), and pick two positions from different campaigns, one to tune on and one
to confirm on.

## 3. Diagnose before editing

Read the attempts call by call, the deviant's beside the failing seat's. Three questions find most
defects:

- **Does the seat score itself with its own method?** A generator scored by a solver's regret learns
  nothing when it computes answers with the solver's method: the regret is zero by construction. The
  lever is a fact that separates the methods, never an instruction.
- **Which sentence does the record contradict?** Read the composed prompt (step 4) as claims. One the
  admissions contradict is a defect, and so is one that prescribes a course instead of stating a fact
  (`AGENTS.md`, section 2).
- **Which failure does every arm repeat?** It is a fact the prompt or tool states wrongly, and its fix
  confounds nothing. `live-seat.ts calls <log or campaign folder>...` counts each Examiner call once,
  failures by tool and error line, and `finish` calls the session went past.

Read-only research sessions ([codex-gpt-swarm](../../codex-gpt-swarm/SKILL.md)) give leads to check
against code and log. Keep each candidate to a few lines: an overhaul is several variables at once.

## 4. Compose the prompts before paying

```sh
bun <after-tree>/.claude/skills/system-path-simulation/scripts/live-seat.ts prompt \
  --tree <before-tree> --name sim-<what>-before -- tools/d1b/examine.ts --session x-<n> <its flags> > before.txt
bun <after-tree>/.claude/skills/system-path-simulation/scripts/live-seat.ts prompt \
  --tree <after-tree> --name sim-<what>-after -- tools/d1b/examine.ts --session x-<n> <its flags> > after.txt
diff <(sed 's/sim-<what>-before/X/g' before.txt) <(sed 's/sim-<what>-after/X/g' after.txt)
```

Each tree composes with its own modules, so the script need not exist at the before commit; pass the
seat's real flags, model included. Every diff line is the round's variable, so seat nothing while it
holds a line you did not intend, and repeat this free step after every edit.

## 5. Run the arms

A **series** fixes an evaluation protocol before its first round: positions, models and efforts,
each pair's cap and minutes, the admission count pairs are read at, and the host class. Each round
seats every position as a fresh control and arm pair; changing the outline starts a new series.

- **Two seeds, one cut**: `bun run runs seed --from <campaign> --name sim-<what>-<arm> --before
  <session>` in each arm's tree, on the seating host (it fetches across `ANA_HOSTS`). If a seed must
  be copied, `rsync -aL` one into an existing `.ana/d2`, check it (line count, no links,
  `seed.json`), then `cp -a` it under the other name, deleting nothing first.
- **The same seats**: the source's models, efforts and reviewer, each arm on a login with room (`bun
  run runs usage`).
- **The next control is the code the round decided for**, on fresh seeds. Several candidates can
  share one control, read at equal admissions with their start times in the ledger.
- **Both arms at once, on the host with the most free cores** (`bun run runs hosts --health`). Never
  pass `--loaded`, and seat now instead of waiting for load to fall.
- **One cap and clock an arm**: `start --cap <dollars> --minutes <n>`, at about $0.25 to $0.50 per
  admitted draft, each `start` one background command followed by `due --hook` or `watch`.

## 6. Read the round

Read in order: whether the round measured what the ledger says, then each pair, then the pairs
against the noise floor, and only then the sign. A count read before the first two is no reading.

**Who ran.** `pairs` refuses a pair whose seats differ in model or effort, or whose seeds differ in
campaign or cut. Check each arm's commit in `compare` against the ledger's `variable`.

**What reached the seat.** Step 4 proves the prompt. A tool-result fact reaches the seat only when
the tool produces it, so count it from each seed's cut: `tail -n +<events + 1> <log> | grep -c
'<text>'`, with `events` from `seed.json`. An arm that never received its variable is `unreached`
(run-improvement-campaign, section 7): two draws of the control, useful only for the noise floor.

**Each pair at equal admissions.**

```sh
bun .claude/skills/system-path-simulation/scripts/live-seat.ts pairs <control>,<arm> <control>,<arm> ... [--gates N]
```

`pairs` reads each pair at the shorter arm's admission count, or at N: holds, admissions with room on
validity (`some`, `none, proved`) or with `gap >= 1%`, median turns of the reference's valid
room-solve answers, and dollars per admission; `compare <prefix>... --gates N` gives full columns.
Room on validity and room on the objective are different findings. A pair under 6 admissions is
**thin** and left out of the sign. Stop both arms once both reach the count; when the round is
decided, run `live-seat.ts stop` over every prefix its scripts name, seated or not.

**Against two draws of one commit**, the round's A/A, which a series gains whenever a round reseats
earlier code at the same position. At about 13 admissions such draws have differed by up to two
holds and 18% in dollars per admission, so a 30% cost guard sits just outside the noise. Keep the
spread in the ledger and update it; a difference inside it is indistinguishable from session
variance. Where the control holds nearly everything a round can only show harm, and where it holds
nothing only gain, so seat the "no harm" bar (step 8) at the first and a gain at the second.

**The sign over pairs.** `pairs` counts, per Examiner model, the pairs where the arm did more, fewer
or the same. Pool only one series and one model and effort. A tie counts against the prediction, five
of five is the least a sign test reads at 0.05, and holds are never summed over pairs of unequal
admission counts.

## 7. The ledger

One file for the optimisation in the investigation's folder (`.ana/wri/<date>-<what>/`), with one
section a round written before its arms start:

```text
## Round <n>, <date> <time>
series:     <name>; its outline once, in the first round: positions, models and efforts, cap,
            minutes, admission count, host class
variable:   <after sha> on <before sha>; the diff of step 4, one line a change
why:        the diagnosis or report it comes from, with the count that showed it
arms:       sim-<what>-<arm> in <tree>, from <campaign> cut before <session>; the control; start times
predict:    P1 <arm> holds at least 1 by its sixth admission; P2 ...
guards:     dollars per admission within 30% of the control
result:     (after) who ran, what reached the seat, pairs at the count beside the spread, the pairs the
            decision rests on, thin pairs, each prediction held or missed, the bar taken (step 8)
next:       (after) the edit, the next seed, or the end of the loop
```

Name the arm in every prediction and resolve it only as written; a prediction about the arm that the
control happens to meet has missed.

## 8. Decide

An arm enters its pull request on one of two bars, named in the ledger and the pull request:

- **A gain**: the variable reached the seat, the arm beat the control on the count or the graded loss
  by more than the spread in each model's pairs, no guard moved, and the move held on the confirming
  position. One round alone is a lead (`AGENTS.md`, rule 6).
- **As good, and simpler**: no pair fell short of the control by more than the spread, the cost guard
  held, and the change removes more prompt, tools or code than it adds (reduce-complexity measures
  it). A change that adds cannot pass this bar.

An arm that meets neither is reverted. Otherwise an `unreached` arm sends you back to step 3; a
structurally closed position (step 2) means changing the seed, never the prompt; no move despite a
deviant means diagnosing again on the deviant's calls; a moved graded loss alone, or a moved count
with guards intact, means running the confirming seed; a moved guard means fixing its cause first.
Stop after three rounds that moved neither count nor graded loss on positions that could move: the
seat does not own the count, and the admission or the exam is the next place to look.

## Claims and limits

The pull request says "the count moved on two seeds from two campaigns", never that the change
raises it; that needs fresh campaigns at its commit (`AGENTS.md`, section 10, item 9). A seed reads
only the first session after its cut, and a position's count rests on its source's exam, whose
spread across campaigns exceeds any round's effect, so rounds compare only within a position.

## The result

Report the ledger's `result` line in order: series, round and commits; who ran and what reached each
arm; each pair at the count with thin pairs named; the spread and which differences exceed it; each
prediction, the guards and the bar; and seats still running, seeds kept and what was not run.

Trash each round's seeds once its result is in the ledger and every arm's worktree at the end
([before-after](before-after.md)). Keep the ledger.

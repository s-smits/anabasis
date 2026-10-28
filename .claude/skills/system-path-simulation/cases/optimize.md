# Optimise by simulation

Some changes are judged by one count a live seat produces: how many drafts an Examiner holds after
a promotion, how often a Referee rules a defect it should not, how many practice solves a Builder
spends before its first edit. No test and no rehearsal can say whether a prompt or a term moves
that count, and a real campaign takes hours to reach the position once. This case tunes the change
in rounds of live seats from seeds, each round a [before-after](before-after.md) pair of
[live seats](live-seat.md), until the count moves or the position shows it cannot.

Read it as training. The seeds are the training set, the composed prompt is the parameter, and the
count is the loss. A change tuned on one seed has been fitted to that seed, as a harness is fitted
to its practice tasks, so it holds only once a seed from another campaign shows the same move. Two
more things follow from the analogy. A round is a very small batch: one draw an arm, read at a few
gates, so most single rounds are noise. And the seat is prompted, never trained, so only what it is
shown can change it: a mechanism that works through a reward in the literature carries over only
where it can be restated as a fact in the seat's prompt, opening, tool results or home.

How a comparison scores the solves it bought is no seat's, and is tuned without seating anything,
from the record, by [promotion-tuner](../../promotion-tuner/SKILL.md). This case borrows its order
of reading: identity and delivery first, then the counts beside an A/A, then a bar named.

## What a round can tune, and whose it is

A round changes one thing the seat is given and reads whether the count moves. For the Examiner:

| Term | Where it lives | How a round changes it |
| --- | --- | --- |
| A sentence of the system prompt or the opening | `src/examiner/prompt.ts` | a commit, in the arm's tree |
| A fact a tool result carries, such as the gate's reply | `measured`, `src/examiner/write.ts`; the folds of `src/examiner/record.ts` | a commit |
| What the session's home holds | `src/examiner/shell.ts` | a commit |
| The session's terms: tasks asked for, proposals, minutes, turns | `tools/d1b/examine.ts` (`--tasks 12 --proposals 36 --minutes 240 --turns 200`) | the flag, both arms at one commit |
| The gate's solves of a draft | `TRIED`, `src/examiner/record.ts` | a commit |
| The solver and its budget | the campaign's setting (`AGENTS.md`, section 6) | none: a seed holds its source's, and another setting is another campaign |

The first three are the host's code and land through a pull request like any change. Whatever they
add to what the Examiner reads, the same pull request writes into `AGENTS.md` section 3's list. The
session's terms and the gate's solves are the operator's conditions (`AGENTS.md`, section 6, "What
the log records of a campaign's conditions"), so a round that moves one is evidence brought to the
operator with a recommendation, never a change made on its own, as the promotion tuner treats the
weights and the level. The exam is no term: it is drafted once, and no seat repairs it (rule 2).

## 1. Name the count, a graded loss beside it, and the guards

Pick one count that `live-seat.ts read` prints, or one a reader over the stretch gives, and say
which way is better. Where that count is a rare event (a held draft, a ruling that disagrees), name
beside it a **graded** measure of how close each attempt came, read on every attempt: at a hold
rate of one in ten, six gates give an arm 0.6 holds on average, and no difference of one hold
means anything, while a distance to the threshold moves on every gate. Name the guards too: counts
the change must leave where they were. Write all three in the ledger (step 7) before anything runs.

| seat | count | graded loss | guards |
| --- | --- | --- | --- |
| Examiner after a promotion | drafts held, by where their room came from (`some`, `none, proved`, an objective) | the author's gain over the reference's best answer at each gate (`reference.gap`; `compare`'s `gap >= 1%` and `median gap`), and the share of gates that read `some` | dollars per gated draft, gate solves per draft |
| Examiner at an opening | drafts held before the first comparison | drafts refused on their package | dollars per gated draft |
| Referee | rulings that agree with a recorded hand label | evidence refusals per ruling | rulings refused for their evidence |
| Builder | practice solves before its first edit, edits that reach a comparison | practice solves that fail on the same check twice | dollars per session |

A measure the change moves is no graded loss unless it moves with the count. In round 8 of
27 October one sentence of the opening moved the Opus Examiner's drafts to tasks the reference took
longer on, its median gate turns from 2 to 6, while its holds fell from 14 to 10 at 14 gates: every
one of the 28 gates was valid in every reference solve, and longer for the reference was not room.

Size each arm from the base rate the survey (step 2) reads: enough gates that the prediction's
difference is two events or more, or a graded loss whose spread on the control is known.

## 2. Find a position where the count can move

Survey before seeding. For each campaign that stood in the position, read the stretch the seat
wrote there (`live-seat.ts read --log <name> --from <event>`), classify every attempt by its
outcome (for the Examiner, each gate by its word and the sign and size of its gap), and keep the
positions where the recorded count was poor. Without `--from`, `read --log` on a seed's log starts
at the seed's cut (`seed.json`'s `events`): the events before it are the source campaign's, and a
one-off read of a seed that counted its gates from the top mixed the source's history into the
seat's.

A position is closed only on proof that nothing can open it, and a seat's failures there are no
such proof. Look for a **positive deviant** first: another session, another model or a later
session under the same reference that moved the count in the same position. One that did proves
the position open and makes the seat the bottleneck. On the buffer domain an Opus Examiner held 0
of 7 drafts in one session after a promotion and 19 of 20 two sessions later under the same
reference, so the first session's refusals said nothing of the exam. Treat a position as closed
only where its structure closes it:

- every rule's check is one the reference harness's programs already compute, and the contract
  declares no objective. The reference answers every draft, and only a task outside the contract
  could leave room (finding F01 of the prompt rewrite, 27 October: on an esp32 seed cut after its
  promotion both arms held 0, and each refusal read `every`);
- the reference's last comparison left room on no task, and no seat in any recorded campaign has
  held a draft there since.

Seed late, right before the seat (SKILL.md, rule 2), and pick two such positions from different
campaigns before the first round: one to tune on and one to confirm on. A position with a recorded
positive deviant is the best one to tune on, since the count is known to be reachable there.

## 3. Diagnose before editing

Read the attempts call by call, the deviant's and the failing seat's side by side, before writing
any edit. Three questions find most defects:

- **Does the seat measure itself against its own method?** A generator scored by a protagonist's
  regret learns nothing when it computes its answers with the protagonist's method: the regret is
  zero by construction. On record, the GPT Examiner of one buffer campaign after its promotion built
  its planted answers with the reference harness's own optimiser from its home, and its gaps read
  zero or negative on 21 of 24 gates; the deviant found its answers apart from that program. The
  lever is a fact that separates the two methods, never an instruction to use another one.
- **Which sentence of the prompt does the record contradict?** Read the composed prompt (step 4) as
  a list of claims. A claim the recorded gates contradict is a defect, and so is a sentence that
  tells a course rather than a fact (`AGENTS.md`, section 2, consequences 1 and 2). Each is an
  edit of its own.
- **Which failure does every arm repeat?** A call that fails the same way in every arm (a wrong
  path, a refused argument) is a fact the prompt or the tool states wrongly. Its fix is economy, it
  confounds nothing, and it can ride with any round.

  `live-seat.ts calls <log or campaign folder>...` is that census over any number of logs: every
  Examiner call once, however many seeds copied it, and a seed's only from its cut, the failed ones by tool and by the line that
  names the error, and the `finish` calls the session went on after. On 28 October, over the 213
  campaign logs that the scratch census of 27 October read, it counted 42,146 calls, as that census had; among
  them 31 failed `read_example` and 23 failed `finish` calls, 217 of 418 finishes the session went
  on after, and 65 `cat reference-harness/agent/BUILT_AGENTS.md` that found no file. Run it on the arms' seeds
  after a round too: a kind that grows in one arm is the change's side effect.

Where the questions outrun one session, launch read-only research sessions
([codex-gpt-swarm](../../codex-gpt-swarm/SKILL.md), which search the web by default): one on the
recorded attempts, and one a body of literature. Their reports are leads. Check each claim you act
on against the code and the log (`AGENTS.md`, section 11), rank the candidates by expected effect
over cost, and keep each to a few lines of prompt or tool result. An overhaul drawn from a report
is several variables in one round, which no round can read.

## 4. Compose the prompts before paying

`live-seat.ts prompt` prints what the Examiner command would seat, composed by a tree's own code
from a seed, and seats nothing:

```sh
bun <after-tree>/.claude/skills/system-path-simulation/scripts/live-seat.ts prompt \
  --tree <before-tree> --name sim-<what>-before -- tools/d1b/examine.ts --session x-<n> <its flags> > before.txt
bun <after-tree>/.claude/skills/system-path-simulation/scripts/live-seat.ts prompt \
  --tree <after-tree> --name sim-<what>-after -- tools/d1b/examine.ts --session x-<n> <its flags> > after.txt
diff <(sed 's/sim-<what>-before/X/g' before.txt) <(sed 's/sim-<what>-after/X/g' after.txt)
```

Each tree composes with its own modules, so the script need not exist at the before commit. The
flags are the seat's own, the model and effort included, since `examine.ts` refuses a model no
backend serves. It composes the gate as `try_task` and leaves out the engines in the shell, so
those lines are equal in both arms. Every line the diff shows is the round's variable: account for
each one, as before-after's step 2 asks, and run no seat while the diff holds a line you did not
mean. This step costs nothing, so repeat it after every edit.

## 5. Run the arms

**A series fixes one outline before its first round**: the positions (each a source campaign and
its cut), the Examiner and Referee models with their efforts, each pair's cap and minutes, the gate
count every pair is read at, and the host class. Every round seats each position of the outline as
a fresh control and arm pair, and only the variable moves. A round that changes the outline starts
a new series, and its readings are not set beside the earlier rounds. Rounds 8 and 9 of 27 and
28 October seated different positions and models, so only two of round 9's three pairs could be
set beside round 8. A position that cannot reach the gate count within its cap leaves the outline
between series, never within one.

- **Two seeds, two names, one cut.** `sim-<what>-<arm>` in each arm's tree, both cut at the same
  session with `bun run runs seed --from <campaign> --name <name> --before <session>`. One name for
  two arms collides on the seat's root (before-after, "Make the two arms").
- **The same seat in both.** The source campaign's Examiner model and effort, its reviewer, and
  each arm on a login with room (`bun run runs usage`). A seat counts against its login like a run.
- **The next control is the code the round decided for, on fresh seeds.** A round whose arm lost
  seats the next round's control at the old control's commit, and one whose arm won at the arm's,
  each position seeded afresh: round 9's control `c9` ran round 7's code. Several candidate edits
  can run at once, each its own arm against one shared control; arms started at different times
  under different load are read at equal gates (step 6), never at equal minutes, and the ledger says
  when each started.
- **A seed on another host is seeded there.** `bun run runs seed --from <campaign> --name <name>`
  on that host fetches the source across `ANA_HOSTS` and cuts it in place. A seed copied by hand
  keeps its links as links: on 27 October two seats on another host crashed on a missing file
  after `rsync -a`, and `rsync -aL` worked. `start` refuses a seed whose `checks/`, `exams/` or
  `states/` hold a link that points at nothing, and names the first. Where a pair's seeds must be
  copied, copy one: the two are the same cut in two trees. Create the target tree's `.ana/d2`
  first, copy the seed once with `rsync -aL`, check it there (its log's line count against the
  source's, no links left, `seed.json` present), then copy it on the target under the other arm's
  name with `cp -a`. Delete nothing before that check: on 28 October a copy loop trashed each local
  seed after its `rsync`, a `rsync` into a tree with no `.ana/d2` failed, and both arm seeds went,
  over a link that took 20 minutes for one 523 MB seed.
- **A host with room, both arms at once.** Each arm's gate runs the reference's solves, three to a
  draft, and they wait on the host's load as a campaign's do (`campaign.waited`). Read
  `bun run runs hosts --health`, pick the host whose five-minute load leaves the most cores free,
  and start a pair's two arms together there, so both share whatever load follows; never pass
  `--loaded`. Seat now rather than wait for a load threshold: a seating script that waited for the
  one-minute load to fall seated a pair on a brief dip, after which the load rose again, and one that
  waited for a quiet host never seated, since the round's own seats kept it loaded.
- **One cap and one clock for each arm**: `start --cap <dollars> --minutes <n>`, sized from the
  source's gated drafts at about $0.25 to $0.50 each (live-seat, "Size it in drafts").

Run each `start` as one background command. `due --hook` or one Monitor on `watch` per arm reads the
gates as they land; nothing else needs to poll.

## 6. Read the round

Read a round in the order the promotion tuner reads a replay: first whether the round measured
what its ledger says, then each pair, then the pairs against the difference between two draws of one
commit, and only then the sign over pairs. A count read before the first two is no reading.

**Who ran.** `pairs` refuses a pair whose seats differ in the Examiner, the Referee or their
efforts, or whose seeds were cut from different campaigns or at different events, since then the
tree is not the one variable. `compare` names each arm's commit: check it against the ledger's
`variable` line. For a seat on another provider, read the model and effort its own records name.

**What reached the seat.** The composed diff (step 4) proves the prompt. A fact carried in a tool
result reaches the seat only where the tool runs on a draft that produces it, so count the results
that carry the new text in each arm, from its seed's cut: `tail -n +<events + 1> <log> | grep -c
'<text>'`, with `events` from the seed's `seed.json`, prints a count and no line of the log. The arm
should count some and the control none. In round 11 of 28 October the arm's log held the gate's
method facts in 6 events by its third gate, and the control's in none. An arm that never received
its variable reads `unreached` (run-improvement-campaign, section 7): the round then holds two
draws of the control's code, worth keeping for the spread below, and says nothing of the change.
Run `calls` on both seeds as well: a kind of failed call that grows in one arm is a side effect of
the change.

**Each pair at equal gates.**

```sh
bun .claude/skills/system-path-simulation/scripts/live-seat.ts pairs <control>,<arm> <control>,<arm> ... [--gates N]
```

`pairs` reads each pair at the shorter arm's count of gates, or at N where both reached it, one row
a pair, each as control / arm: the drafts held, the gates that left the reference room on validity
(`some` and `none, proved`), the gates where the author's answer beat the reference's best by the
room floor (`gap >= 1%`), the median turns of the reference's valid gate answers, and dollars per
gate. `compare <prefix>... --gates N` gives each arm's whole column where a row is not enough:
billed, gates by word, gate solves, dollars per held draft and the median gap.

Read the holds by where their room came from, as the promotion tuner reads which measure won each
task. A hold on validity and a hold on the objective are different findings, and a measure that
moves without either is no room (step 1, round 8).

The pair is the unit. Read every pair at the outline's gate count, and stop both arms of a pair
together once both have reached it, rather than waiting for their cap. A pair that cannot reach it
within its cap is **thin**: reported, and counted as untested (`pairs` marks a pair under 6 gates
`thin` and leaves it out of the sign). A round is decided when every pair has reached the count or
ended thin, or when the pairs that reached it fix the sign whatever the rest read; the ledger names
the pairs a decision rests on. Then close the round with `live-seat.ts stop <prefix>...` over every
prefix the round's seating scripts name, seated or not: it ends each running group, lets each
`start` print its reading, and closes the prefixes not yet seated. On 28 October a script still
waiting for load seated a fresh pair of round 8 twenty minutes after the round was decided.

**Against two draws of one commit.** This is the round's A/A. An Examiner session varies from draw
to draw as a solver's solves do (rule 6), so an arm's difference means something only beside the
difference between two seats of one commit at one position. A series holds such a pair wherever a
round seats code that an earlier round seated at the same position. At the Opus buffer position,
round 7's code held 14 of 14 gates in round 8 and 12 of 13 in round 9, at $0.57 and $0.63 a gate;
round 9's arm and round 10's control, one commit, held 12 of 13 and 12 of 12, at $0.45 and $0.53.
So at about 13 gates two draws of one commit differed by up to two holds, and by 11% and 18% in
dollars a gate; the cost guard of 30% sits just outside that. A difference inside the series'
spread is no difference. Keep the spread in the ledger, and widen it with each repeat.

**The position's ceiling and floor.** Where the control holds nearly every gate, a round can read
harm and no gain; where it holds none, gain and no harm. Round 10's control held 12 of 12 at the
Opus buffer position, so its prediction of more holds could not be met there; the job position of
round 11 had held 0 of 30 drafts in its source. Seat a "no harm" bar (step 8) where the control
holds most gates, and a gain where it holds few, and read the graded loss at both.

**The sign over pairs.** A single round reads one draw an arm. Under its rows `pairs` counts, for
each Examiner model apart, the pairs in which the arm did more, fewer or the same on each measure,
with the ties apart, and sums dollars per gate on each side. Pool only pairs of one series (step 5)
and of one Examiner model and effort: the models hold and refuse at different rates, so a GPT pair
and an Opus pair in one sign measure the models as much as the change. A tie counts against a
prediction of "more in at least 4 of 5", and five of five is the least a sign test reads at 0.05.
Report the count of pairs with each result, never a sum of holds over pairs that gated at different
paces.

## 7. Keep a ledger of rounds

One file for the whole optimisation, in the investigation's folder (`.ana/wri/<date>-<what>/`),
with one section a round written before its arms start:

```text
## Round <n>, <date> <time>
series:     <name>; its outline once, in the series' first round: positions, models and efforts,
            cap, minutes, gate count, host class
variable:   <after sha> on <before sha>; the diff of step 4 in one line a change
why:        the diagnosis or report it comes from, with the count that showed it
arms:       sim-<what>-<arm> in <tree>, from <campaign> cut before <session>; the control arm and
            when each started
predict:    P1 <arm> holds at least 1 by its 6th gate; P2 <arm>'s gap >= 1% count exceeds <arm>'s ...
guards:     dollars per gated draft within 30% of the control arm
result:     (after) who ran and what reached the seat; pairs at the gate count beside the series'
            spread; the pairs the decision rests on, the thin ones; each prediction held or missed,
            with the count; the bar taken (step 8)
next:       (after) the edit, the next seed, or the end of the loop
```

Name the arm in every prediction, and resolve each only as written. A prediction written about the
after arm that the before arm happens to meet has missed; recording it as held on the other arm is
a description written after the result.

## 8. Decide

An arm goes into its pull request on one of two bars, and the ledger and the pull request name which:

- **A gain.** The variable reached the seat; in each model's pairs the arm held more than the
  control, or moved the graded loss, by more than the series' spread; no guard moved; and the move
  held again on a confirming position from another campaign (step 2). One round that meets the rest
  is a lead (`AGENTS.md`, rule 6).
- **As good, and simpler.** The operator's bar of 28 October, on which round 10's deletion was
  taken: in no pair did the arm hold fewer than the control by more than the spread, the cost guard
  held, and the change removes more of the Examiner's prompt, tools or code than it adds, as
  reduce-complexity measures it. A change that adds text or machinery cannot pass on this bar.

An arm that meets neither is reverted, as round 8's sentence was. The next round follows from what
this one read:

| the round read | next |
| --- | --- |
| The arm never received its variable | Find where the path stops (step 3) before another round; keep the two draws for the spread |
| Neither arm moved, the gates read `every`, and the position has a structural closure (step 2) | Change the seed, never the prompt |
| Neither arm moved, and a positive deviant held in the same position | The change did not reach the seat's choices. Diagnose again (step 3) on the deviant's calls, edit, run a new round |
| Neither arm moved, the graded loss moved | A lead too weak to read on holds. Run the confirming seed, or more gates, before another edit |
| The arm moved the count, and a guard moved too | Fix the guard's cause before another round |
| The arm moved the count beyond the spread, guards held | A lead from one draw. Run the confirming seed from another campaign |
| The move held on the confirming seed | Stop. The change goes on its pull request with the ledger |

Stop the loop after three rounds that moved neither the count nor the graded loss on positions that
could move, and say so: the seat is not the owner of the count, and the next place to look is the
gate or the exam.

## What a round may claim, and its limits

A round is two draws, one an arm. The pull request states the rounds, each seed's source and cut,
the count and the graded loss at equal gates for each arm beside the series' spread, which
predictions held, and the bar taken, in its "Validation and limits". It says "the count moved on two
seeds from two campaigns", never that the change raises the count: that claim needs the real
campaigns that run the change from their opening (`AGENTS.md`, section 10, item 9), read after the
release.

What no round reaches:

- A seed reads the first session after its cut. What the change does in later sessions, across a
  promotion or over a campaign's supply, only a fresh campaign at the change's commit reads.
- A position's count rests on the exam its source drafted. On one pack and solver, campaigns on
  record held from a fifth to two thirds of their gated drafts, a wider range than any round has
  moved, so a round compares only within one position, and a change tuned on one is fitted to it
  until a second confirms it.
- The gate's reference solves are fresh draws in each arm, so a gate's word varies with them; the
  graded loss carries that noise too.

## The result

Report, in order:

1. The series and round, the two commits, each pair's position (campaign and cut), its seats, and
   the minute each pair was read.
2. Who ran, and the counts of what reached each arm.
3. Each pair at the gate count: holds by where their room came from, the graded loss, the median
   turns and dollars per gate; the thin pairs by name.
4. The series' spread between two draws of one commit, and which differences exceed it.
5. Each prediction held or missed with its count, the guard, and the bar the decision took, or
   none.
6. The seats still running, the seeds kept and why, and what was not run.

## Clean up

Trash each round's seeds once its result is in the ledger, and every arm's worktree at the end
(before-after, "Clean up"). Keep the ledger.

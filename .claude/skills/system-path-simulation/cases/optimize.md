# Optimise by simulation

Some changes are judged by one count a live seat produces: how many drafts an Examiner holds after
a promotion, how often a Referee rules a defect it should not, how many practice solves a Builder
spends before its first edit. No test and no rehearsal can say whether a prompt or a term moves
that count, and a real campaign takes hours to reach the position once. This case tunes the change
in rounds of live seats from seeds, each round a [before-after](before-after.md) pair of
[live seats](live-seat.md), until the count moves or the position shows it cannot.

Read it as training. The seeds are the training set, the composed prompt is the parameter, and the
count is the loss. A change tuned on one seed has been fitted to that seed, as a harness is fitted
to its practice tasks, so it holds only once a seed from another campaign shows the same move. The
position decides more than the prompt does: an exam the reference has closed gives no prompt
anything to find.

## 1. Name the count, and the counts that must not move

Pick one count that `live-seat.ts read` prints, or one a reader over the stretch gives, and say
which way is better. Name beside it the guards: counts the change must leave where they were, such
as the dollars a gated draft costs, the gate's solves, a ruling's evidence refusals. Write both in
the round's ledger (step 6) before anything runs.

| seat | count | guards |
| --- | --- | --- |
| Examiner after a promotion | drafts held, by where their room came from (`some`, `none, proved`, an objective) | dollars per gated draft, gate solves per draft |
| Examiner at an opening | drafts held before the first comparison | drafts refused on their package |
| Referee | rulings that agree with a recorded hand label | rulings refused for their evidence |
| Builder | practice solves before its first edit, edits that reach a comparison | dollars per session |

## 2. Find a position where the count can move

Survey before seeding. For each campaign that stood in the position, read the stretch the seat
wrote there (`live-seat.ts read --log <name> --from <event>`) and keep the positions where the
recorded count was poor *and* the exam left room. Leave out a position the exam itself closes:

- every rule's check is one the reference harness's programs already compute, and the contract
  declares no objective. The reference answers every draft, and only a task outside the contract
  could leave room (finding F01 of the prompt rewrite, 27 October: on an esp32 seed cut after its
  promotion both arms held 0, and each refusal read `every`);
- the reference's last comparison left room on no task and no draft since has held.

A position with a declared objective, or one whose gates still read `some`, is one the count can
move in. Seed it late, right before the seat (SKILL.md, rule 2), and pick two such positions from
different campaigns before the first round: one to tune on and one to confirm on.

## 3. Compose the prompts before paying

`live-seat.ts prompt` prints what the Examiner command would seat, composed by a tree's own code
from a seed, and seats nothing:

```sh
bun <after-tree>/.claude/skills/system-path-simulation/scripts/live-seat.ts prompt \
  --tree <before-tree> --name sim-<what>-before -- tools/d1b/examine.ts --session x-<n> <its flags> > before.txt
bun <after-tree>/.claude/skills/system-path-simulation/scripts/live-seat.ts prompt \
  --tree <after-tree> --name sim-<what>-after -- tools/d1b/examine.ts --session x-<n> <its flags> > after.txt
diff before.txt after.txt
```

Each tree composes with its own modules, so the script need not exist at the before commit. The
flags are the seat's own, the model and effort included, since `examine.ts` refuses a model no
backend serves. It composes the gate as `try_task` and leaves out the engines in the shell, so
those lines are equal in both arms. Every line the diff shows is the round's variable: account for
each one, as before-after's step 2 asks, and run no seat while the diff holds a line you did not
mean. This step costs nothing, so repeat it after every edit.

## 4. Run the arms together

- **Two seeds, two names, one cut.** `sim-<what>-r<n>-before` in the before tree and
  `sim-<what>-r<n>-after` in the after tree, both from the same source event. One name for two
  arms collides on the seat's root (before-after, "Make the two arms").
- **The same seat in both.** The source campaign's Examiner model and effort, its reviewer, and
  each arm on a login with room (`bun run runs usage`). A seat counts against its login like a run.
- **A host with room.** Each arm's gate runs the reference's solves, three to a draft, and they wait
  on the host's load as a campaign's do (`campaign.waited`). Two arms on a host already carrying
  live campaigns slow both arms and those campaigns. Read `bun run runs hosts --health` and seat
  where the load leaves the most cores free; never pass `--loaded`.
- **One cap and one clock for both**: `start --cap <dollars> --minutes <n>`, sized from the
  source's gated drafts at about $0.25 to $0.50 each (live-seat, "Size it in drafts").

Run each `start` as one background command. `due --hook` or one Monitor on `watch` per arm reads the
gates as they land; nothing else needs to poll.

## 5. Read at equal gates, and stop when the round is answered

Two arms gate at different paces, so read them at the same count of gates, never at the same
minute:

```sh
bun .claude/skills/system-path-simulation/scripts/live-seat.ts compare <scratch>/r<n>-before <scratch>/r<n>-after --gates 6
```

`compare` prints each arm's counts in a column: billed, proposed, gated by word, held, dollars per
held draft, gate solves and the median turns of the reference's valid gate answers, each cut after
the arm's first N gates. A round is answered when both arms have gated the count the ledger named,
or when one arm's ending is certain: an arm that has held what the prediction asked for. Then end
the arms with `live-seat.ts stop --seat <prefix>`, which ends the group and lets `start` print its
reading, instead of paying for gates that cannot change the round's answer.

## 6. Keep a ledger of rounds

One file for the whole optimisation, in the investigation's folder (`.ana/wri/<date>-<what>/`),
with one section a round written before its arms start:

```text
## Round <n>, <date>
seed:       sim-<what>-r<n>-{before,after}, from <campaign> event <cut>; why the count can move there
commits:    before <sha>, after <sha>; the diff of step 3 in one line
predict:    P1 before arm holds at most 1 by its 6th gate; P2 after arm holds at least 2 ...
guards:     dollars per gated draft within 20% of the before arm
result:     (after) compare at 6 gates; each prediction held or missed, with the count
next:       (after) the edit, the next seed, or the end of the loop
```

## 7. Decide the next round

| the round read | next |
| --- | --- |
| Neither arm moved, and the before arm's gates read `every` | The position is closed (step 2). Change the seed, never the prompt |
| Neither arm moved, and gates read `some` or held on the objective | The change did not reach the seat. Compose again (step 3), read the after arm's calls and its last messages, edit, run a new round |
| The after arm moved the count, and a guard moved too | Fix the guard's cause before another round |
| The after arm moved the count, guards held | A lead from one draw (rule 6 of `AGENTS.md`). Run the confirming seed from another campaign |
| The move held on the confirming seed | Stop. The change goes on its pull request with the ledger |

Stop the loop after three rounds that moved nothing on positions that could move, and say so: the
seat is not the owner of the count, and the next place to look is the gate or the exam.

## What it may claim

A round is two draws, one an arm. The pull request states the rounds, each seed's source and cut,
the count at equal gates for each arm, and which predictions held, in its "Validation and limits".
It says "the count moved on two seeds from two campaigns", never that the change raises the count:
that claim needs the real campaigns that run the change from their opening (`AGENTS.md`, section
10, item 9), read after the release.

## Clean up

Trash each round's seeds once its result is in the ledger, and both worktrees at the end
(before-after, "Clean up"). Keep the ledger.

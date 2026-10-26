# Transitivity: do buffer's later promotions carry over?

**Question.** Buffer campaign `buffer-fresh-opus-v065-a` promoted seven harnesses in a row, each on
one comparison against the one before it. Each of those comparisons scored tasks the Examiner had
written against the reference of the day. Do the later promotions add ability that shows on tasks
no harness of the chain was selected on, or are they patches that win only where the tasks were
chosen to beat the current reference? The ML researcher's review of 25 October raised it
(`perspectives-2000.md` of the v0.7.1 cycle): in v070 the starter, compared with the reference
after three promotions on that reference's frontier, won 21 tasks to 5 without the bill, so a
frontier chosen against one harness can favour any other.

This is a protocol, written before the first solve. Its level is kept in `docs/plan.md` (row X2).
It promotes nothing and moves no campaign: every comparison here runs on a seed, a copy of the
campaign's log cut where the question starts (`bun run runs seed`), and names its reference by
digest, which promotes nothing (`AGENTS.md`, section 7).

## The chain

| Promotion | Harness | Comparison | Its tasks were written against | Without the bill (frontier and retained, `read.ts`) |
| --- | --- | --- | --- | --- |
| 1 | `bf461326` | g-1 | the starter `08079533` | 21-0-3 |
| 2 | `8efc0df7` | g-2 | `bf461326` | 15-0-8 |
| 3 | `aecc1c92` | g-3 | `8efc0df7` | 0-10-18 (promoted by the bill alone) |
| 4 | `bfeb41cd` | g-4 | `aecc1c92` | 20-0-7 |
| 5 | `cc04a08b` | g-5 | `bfeb41cd` | 10-1-7 |
| 6 | `35e67d1e` | g-6 | `cc04a08b` | 10-1-16 |
| 7 | `6a42fac4` | g-7 | `35e67d1e` | 16-0-8 |

The setting every solve of v065-a ran under, and every solve here runs under, is the campaign's
`campaign.setting`: solver `claude/claude-opus-5-5` at effort `medium`, 30 minutes and 20 model
turns a solve, 24 scored tasks, the default window. The seeds carry that record, and a checkpoint
reads it (`tools/d2/setting.ts`). The objective is the recipe's cost, lower is better.

## Why the probe first proposed cannot answer it

The proposal was `6a42fac4` against `bf461326` on the 24 tasks held out under the starter
(epoch 1), without the bill, with p at or under 0.02 predicted if the climb compounds. Those tasks
are selected against neither harness, which is right, but they hold no room above `bf461326`:

- In g-1 `bf461326` closed 23 of the 24: valid in every solve, with no answer on record (the
  starter's, the author's or its own) better by the room floor (`informative` for the new side,
  1; `poolOf` over the log cut after the promotion, 23 exhausted and 1 on the frontier, `f561cf91`).
- Sixteen later readings of epoch-1 tasks, as retained tasks in g-2, g-3 and g-4, all tie without
  the bill.
- The same holds of every older set. Across g-2 to g-7 the 38 retained readings are 0-0-38
  without the bill, and 17-17-4 with it. Each new harness closes its predecessor's frontier: the
  new side was informative on 1 of 24 tasks in g-1, 0 of 23 in g-2 and 0 of 27 in g-4.

So the proposed comparison is expected to read about 0-0-24, a `no-step` the ceiling explains
whatever the climb did, and "p above 0.02 falsifies compounding" would be a wrong inference. The
supply condition of `AGENTS.md` section 1 (four informative tasks) fails on it for the reference
`bf461326`. It is kept here as arm A, read as what it can show: whether the final harness kept what
the first promotion gained.

## The design

Three arms, each one checkpoint on a seed of v065-a's log, each read without the bill.

| Arm | Seed, cut | Old side (reference) | New side | Scored tasks | What it can show |
| --- | --- | --- | --- | --- | --- |
| A | `sim-tp-epoch1`, the first 6440 events (`--events 6440`), up to g-1's report | `bf461326` | `6a42fac4` | the 24 epoch-1 tasks below | retention, or a regression, on tasks selected against the starter |
| B | `sim-tp-bfeb`, before Examiner session x-6 (`--before x-6`, 15867 events), just after `bfeb41cd` was promoted | `bf461326` | `6a42fac4` | the tasks a fresh Examiner session `tx-1` holds out against `bfeb41cd`, with a retained quarter | whether the final harness beats the first promotion on fresh tasks selected against a third harness of the chain |
| C, conditional | `sim-tp-bfeb-c`, a seed of `sim-tp-bfeb` taken after `tx-1` ends and before B starts | `bfeb41cd` | `bf461326` | the same set as B, by construction | whether an ancestor beats `bfeb41cd` on its own frontier as much: the selection effect |

**Why B answers the question.** The fresh tasks are held out where `bfeb41cd`'s gate solves leave
room. Neither harness compared in B was the reference that selected them, no Builder saw them, and
no promotion was read on them. If a promotion's frontier wins come from the frontier being chosen
against the reference, any other harness gains there as much, and B ties. If the promotions after
`bf461326` added ability that carries to fresh tasks, `6a42fac4` beats `bf461326`. A task the
selection made hard for `bfeb41cd` because of something it inherited from `bf461326` and a later
harness fixed counts for compounding; one hard because `bfeb41cd` broke something `bf461326` had
counts against it. The middle of the chain is chosen so that three promotions stand on each side
(`8efc0df7`, `aecc1c92` and `bfeb41cd` after `bf461326`; `cc04a08b`, `35e67d1e` and `6a42fac4` after
`bfeb41cd`).

**What remains asymmetric, on purpose.** `6a42fac4`'s Builders practised on tasks released in
epochs 2 to 7, among them tasks of `bfeb41cd`'s epoch, and `bf461326`'s did not. That is the
accumulated training whose transfer B measures: no task B scores was seen by either.

**Why seeds, and no code to pin the set.** A checkpoint draws its scored set from its log, the
newest epoch first by the contract's hash (`scoredSet`, `src/campaign/round.ts`), and the named set
(`--tasks`) was removed on 20 October. A seed cut where the question starts holds exactly the
tasks wanted, so the production draw takes them:

- Arm A: replayed on 25 October at `87f0b07e`, `scoredSet` over the first 6440 events returns all
  24 held tasks, g-1's 24 (21 on the frontier against the starter and 3 retained, the three the
  starter closed: `75c7112a`, `224f82f5`, `fc466134`). The same seed holds them for any order of
  runs, since no comparison here involves its promoted reference.
- Arm B: before `tx-1` the seed holds 59 retained tasks of epochs 1 to 4 and none on the frontier.
  `tx-1`'s tasks are epoch 5, all on the frontier, drawn whole up to 24, with one retained task for
  each three drawn by the hash. The primary reading is the frontier alone, so the retained quarter,
  which includes tasks of epoch 2 selected against `bf461326`, cannot carry it.
- Arm C runs on a copy of B's seed made before B, so its log at its start is B's log at B's start
  and the draw is the same. `read.ts` prints the digest of each comparison's fixed tasks (`set`)
  and its tasks by epoch: f-1's and c-1's digests must agree, and r-1's must be g-1's,
  `590b0a84` of 24 tasks.

**The reading.** `studies/transitivity/read.ts` reads each comparison from its log by production
owners alone: the pairs (`pairsReported`), each task's points by measure (`pointsOf`), their
rounding (`wholePoints`), the one-sided paired sign-flip test (`flipP`), and the epochs
(`tasksByEpoch`). Without the bill a task's score is its validity and objective points, the
tree's weights of 0.6 and 0.3, as the promotion tuner's `--weights 60,30,0` reads it. The tuner is
not used because it tests the frontier and the retained set together and leaves seeds out. The
reading is made by `read.ts` at this study's commit, whatever commit the solves ran at. It checks
itself by scoring each set again with the bill against the differences the report stored: over
v065-a's seven comparisons all 14 sets matched. That check holds only where the solves ran at the
same weights.

## Task set of arm A

The 24 tasks v065-a held out before its first promotion (event 6441), while the starter was the
reference: written against no harness of the chain after it. All 24 were scored in g-1, the
comparison that promoted `bf461326`, and no later Examiner session wrote or chose them. None was
released for practice (the six released before the cut are not among them). Two came with the
drafted exam (d-1), 14 from Examiner session x-1 and 8 from x-2.

| Task version | Written by | Id |
| --- | --- | --- |
| `0066709de2972f4bec37bcec6e351a4b0d5ed057569361838fa5a1183c51841a` | x-1 | `x-1-010` |
| `00abd5a87c90853edf640568152edc966054452f54af40be0c30704d0fb0f76a` | x-1 | `x-1-021` |
| `089149ab5ab8c9726fa50498743645a84076e3aba896eb881064da1e543fe675` | x-1 | `x-1-008` |
| `224f82f58ed3c180029bf925903a248033b8f19667b498334a42048d13f94ac3` | x-2 | `x-2-006` |
| `2338d01e26ac359a4ad23a8d79809662baee0ea6773bd21e723899e3bf44e29f` | x-1 | `x-1-013` |
| `2c72b6549ef92c18b97d85caf1383917eb0bfc8ff5df71136b04890d72714070` | x-1 | `x-1-016` |
| `42b401ee9f68dc25e7a4fc8db7491ab4486e0dca417a296bf4d57733af1c1ad4` | x-1 | `x-1-023` |
| `4b2a4cfdb8d160589b8419cdc091f3cb90918c99f404ee7f3c84db6ecb30fc2f` | x-1 | `x-1-006` |
| `5de99ed6a80d0a2b504d11dca624bd5a1eff0173fe98a12dec44ea06542bdfa2` | x-1 | `x-1-007` |
| `5ed52168f3f08c1d417453e496939104fb997be688c295bf71f5b55468c7926c` | x-1 | `x-1-019` |
| `64d7e7d54d227040f3827aa297b5370b9093025955bc329bcc1edab5fb3d6f44` | x-1 | `x-1-004` |
| `68d22bb4b04854994153d6af2d8fd519471b7e8a6d698d31ac7334d09437a5ca` | x-1 | `x-1-012` |
| `75c7112afa95b6b53ef728e175894bcf89fb77da2bb0e7b17871323bb13addf0` | the drafted exam | `ex-004` |
| `80401247b8d7ca12fff22d51616a08609d1703ed465f412205c07247a92feb7f` | x-2 | `x-2-005` |
| `8752307d7dae6067f79022fdb7bfdc37f52646b0117b6a7e2407cffe02c7aab6` | x-2 | `x-2-003` |
| `91c2681fc7fff346ecf639fbc9167cf0ca3f1d5129badce4f60cf9c37960fba8` | x-2 | `x-2-001` |
| `9383b568f5641fc3634ba684a692bc788bdf6798fec8fd39607e1319e1ddc7d3` | x-2 | `x-2-008` |
| `95c1b93c6321816e815c3bf90753ce46ab828ddeb1d714e7b04e306dd714edce` | x-2 | `x-2-002` |
| `ab7d839cd3cd265a3fd7a29ea235cb757b8cdcb6049f338ed3d119b3bfeab856` | x-1 | `x-1-011` |
| `bb92cf56989b1700a04a6de5839d58218c18a14193fe2e4ce2fdc4c0f3689d3c` | x-1 | `x-1-002` |
| `f2dfe99505702e30780868b1e3549ded74f20a1f5bf93f4278a8cd634ac6c087` | x-2 | `x-2-004` |
| `f561cf9187d11eaec5b54a9c9fc89b8e203f12e87ed53231e6b61889ab8923e3` | x-2 | `x-2-009` |
| `fc4661343415296e2f5974854e55f37bdd61c8a2251ab7ca9e7516ecc39987e0` | the drafted exam | `ex-002` |
| `fcbff38c756a334a9f2162f2b5e387a564e179e218338cce0e9eaaf2e12385bf` | x-1 | `x-1-003` |

Six of them were read again as retained tasks, 16 readings in g-2, g-3 and g-4, all tied without
the bill (`68d22bb4`, `42b401ee`, `80401247`, `75c7112a`, `9383b568` and `00abd5a8` in g-2, the
first five again in g-3 and g-4).

The task set of arm B does not exist yet. It is fixed by rule: every task `tx-1` holds out, all of
epoch 5, drawn as above. Their versions are distinct from every task of v065-a, since a task's id
(`tx-1-NNN`) is part of its version.

## Predictions

Frozen with this file, before the first solve, each settled by the counts `read.ts` prints. For
P-B and P-C, a reading with fewer than six untied tasks, the least a step at 0.02 can be read on
(`sweepOf`), settles nothing and is reported as no room. A comparison that reads `not-scored`
settles nothing.

- **P-A** (comparison r-1, "together without the bill"): `6a42fac4` wins at most 2 of the 24
  tasks and loses at most 2, so at least 20 tie. Falsified towards a regression where it loses at
  least 3, and towards room where it wins at least 3; a p at or under 0.02 is the proposal's own
  prediction holding.
- **P-B** (comparison f-1, "frontier without the bill"): `6a42fac4` beats `bf461326` with p at or
  under 0.02. Falsified where p is above 0.02 on six untied tasks or more.
- **P-C** (comparison c-1, run only where P-B is falsified, "frontier without the bill"):
  `bf461326` beats `bfeb41cd` with p at or under 0.02. Falsified where p is above 0.02 on six
  untied tasks or more.

Each comparison also carries its A/A, the reference against itself on mirrored halves of its
solves. A reading whose A/A reads a step either way is reported with that beside it.

## What each outcome means

| A | B | C | Reading |
| --- | --- | --- | --- |
| any | P-B holds | not run | The final harness beats the first promotion on fresh tasks selected against a third harness of the chain. The later promotions carried ability that transfers. One reading is one draw: "compounds" without qualification waits for a second reading on fresh solves (`AGENTS.md`, section 9) |
| any | P-B falsified | P-C holds | An ancestor beats `bfeb41cd` on its frontier too, and the final harness does no better than it there. The frontier wins after `bfeb41cd` are explained by selection against the reference: patches |
| any | P-B falsified | P-C falsified | Neither beats `bfeb41cd`'s fresh frontier more than chance allows, and the final harness does no better than the first promotion. No compounding shows on these tasks; the selection effect does not show either |
| any | no room | not run | The fresh tasks gave too few untied tasks. Nothing is learned of compounding; the spend is reported |
| P-A holds | | | The final harness kept what the first promotion gained on epoch 1. It says nothing of compounding: no harness had room there |
| towards a regression | | | Later promotions lost ability the first had, without the bill: patches that cost earlier ability, whatever B reads |
| towards room | | | Epoch 1 had room above `bf461326` and the final harness found some; at p at or under 0.02 the proposal's prediction holds |

Correction of 26 October, leaving the registered rows as they were: a falsified P-B is a test that
did not clear its level, which shows neither that the final harness does no better nor why. Read
the two rows on it as "the final harness was not shown to beat `bfeb41cd` on this frontier"; that
selection against the reference explains the frontier wins is one account the design cannot
separate from others. The row on a falsified P-C rests on one comparison, of the ancestor with
`bfeb41cd`, and says nothing of the final harness against `bfeb41cd`. Arm C was never run, so no
recorded outcome changes.

No reading here is a step of a campaign, and none is compared with v065-a's own readings, which
ran at another commit. A claim made from them names this protocol, the seed and the commit.

## Cost

From v065-a's recorded bills (`solve.finished.billed`, means over each harness's comparison
solves): the starter $0.278, `bf461326` $0.075 on epoch-1 tasks (g-1) and $0.114 on its own
frontier (g-2, at most $0.345), `bfeb41cd` $0.049 (g-5), `6a42fac4` $0.052 (g-7, at most $0.324).
Comparisons ran about 2% more solves than four a side for repeats of non-results.

| Step | Arithmetic | Expected | Its cap |
| --- | --- | --- | --- |
| A, r-1 | 24 tasks x 4 solves x ($0.075 + $0.052) = $12.2, with repeats | $12.4 | `--cap 20` |
| B, `tx-1` | x-6 billed $11.00 (3.7 h), of it $4.05 its gate solves under `bfeb41cd`; with an empty home, as x-1 started, its own turns were $10.14 | $15 | 25, by `live-seat.ts --cap` |
| B, f-1 | 24 frontier x 4 x ($0.114 + $0.052) = $15.9, plus 8 retained x 4 x ($0.075 + $0.052) = $4.1; at $0.20 a solve of `bf461326` on the fresh tasks, $28.3 | $20 | `--cap 32` |
| C, c-1 | 24 x 4 x ($0.114 + $0.049) = $15.6, plus 8 x 4 x ($0.075 + $0.040) = $3.7 | $19.3 | `--cap 28` |

Expected: $47 for A and B, $67 with C. C starts only where what A and B billed leaves its cap
inside the operator's $80. Every checkpoint takes `--reserve 1`, above the dearest solve on record:
the default reserve of $10 a solve would hold four solves in flight at $40 and stop a small cap
before its first solve. The time, from the same record: A under an hour, `tx-1` up to four hours,
f-1 and c-1 about two hours each, longer while the host's load holds solves back
(`campaign.waited`).

## Running it

Every command runs from a worktree of its own (`<tree>`) at one published commit, the same for
every arm, with Bun 1.4.4 and `bun install --frozen-lockfile`. The seeds are written under
`<tree>/.ana/d2/`. A seat runs through the live-seat script of `system-path-simulation`, which
runs the production command niced in a process group of its own on one login and ends it at its
dollars or its minutes. One live seat a login at a time: A and `tx-1` may run together on two
logins; f-1 waits for `tx-1` and the copy, and c-1 for f-1.

```sh
BF=bf4613267f1467cf0a7bcfeff1962abe72defe6a852e24b175b7940123b58d96
FINAL=6a42fac4d8a6d6f78e3c67e4d3123d21a1c244f82871574f8fc9f3f6537c6a20
BFEB=bfeb41cdc2bd92ca50e909f8017db4c692847500b2c2ba43e546045cae5d4744
SEAT=.claude/skills/system-path-simulation/scripts/live-seat.ts
REVIEW="--reviewer claude/claude-opus-5-5 --reviewer-effort medium"

# 1. The seeds, without a model. Expect 6440 and 15867 of the source's events.
bun run runs seed --from <v065-a folder> --name sim-tp-epoch1 --events 6440
bun run runs seed --from <v065-a folder> --name sim-tp-bfeb --before x-6

# 2. The path, without a model: a scripted checkpoint on a throwaway seed, and its reading.
#    Expect "set 590b0a84 of 24 tasks", all e1, and "as the report stored it: frontier yes, retained yes".
bun run runs seed --from <v065-a folder> --name sim-tp-rh --events 6440
bun run runs rehearse --name sim-tp-rh --id r-0 --reference $BF --new $FINAL
bun studies/transitivity/read.ts --log <tree>/.ana/d2/sim-tp-rh/log.jsonl --id r-0

# 3. Arm A.
bun --env-file=<env file> $SEAT start --tree <tree> --name sim-tp-epoch1 --out <out>/r-1 \
  --cap 22 --minutes 240 --login <N> -- tools/d2/checkpoint.ts --id r-1 \
  --reference $BF --new $FINAL --cap 20 --reserve 1 $REVIEW \
  --predict "P-A: without the bill at least 20 of 24 epoch-1 tasks tie and 6a42fac4 loses at most 2"

# 4. Arm B's tasks: one Examiner session against bfeb41cd, as v065-a's x-6 was run.
bun --env-file=<env file> $SEAT start --tree <tree> --name sim-tp-bfeb --out <out>/tx-1 \
  --cap 25 --minutes 260 --login <M> -- tools/d1b/examine.ts --session tx-1 \
  --examiner claude/claude-opus-5-5 --examiner-effort high $REVIEW \
  --tasks 24 --proposals 36 --minutes 240 --turns 200 --reference-home on --results on

# 5. Stop here if tx-1 held fewer than six tasks: f-1 would be refused (held-short).
#    Otherwise copy the seed for arm C before f-1 writes anything.
bun run runs seed --from <tree>/.ana/d2/sim-tp-bfeb --name sim-tp-bfeb-c

# 6. Arm B.
bun --env-file=<env file> $SEAT start --tree <tree> --name sim-tp-bfeb --out <out>/f-1 \
  --cap 35 --minutes 300 --login <N> -- tools/d2/checkpoint.ts --id f-1 \
  --reference $BF --new $FINAL --cap 32 --reserve 1 $REVIEW \
  --predict "P-B: without the bill 6a42fac4 beats bf461326 on the frontier at p <= 0.02"

# 7. Arm C, only where P-B is falsified and its cap fits the $80.
bun --env-file=<env file> $SEAT start --tree <tree> --name sim-tp-bfeb-c --out <out>/c-1 \
  --cap 30 --minutes 300 --login <N> -- tools/d2/checkpoint.ts --id c-1 \
  --reference $BFEB --new $BF --cap 28 --reserve 1 $REVIEW \
  --predict "P-C: without the bill bf461326 beats bfeb41cd on the frontier at p <= 0.02"

# 8. The readings, from a checkout that holds this folder.
bun studies/transitivity/read.ts --log <tree>/.ana/d2/sim-tp-epoch1/log.jsonl --id r-1
bun studies/transitivity/read.ts --log <tree>/.ana/d2/sim-tp-bfeb/log.jsonl --id f-1
bun studies/transitivity/read.ts --log <tree>/.ana/d2/sim-tp-bfeb-c/log.jsonl --id c-1
bun $SEAT read --seat <out>/tx-1
```

`live-seat.ts` appends `--name` itself. Its `--cap` sits a little above the checkpoint's own, so
the checkpoint's cap binds first and a comparison is not cut by the outer bound.

**Keep the record.** `bun run runs retire` deletes a seed once its log has been idle for a day, and
the seeds hold the only record of these solves. Within the day, zip them outside the repository
(`bun run runs zip sim-tp-epoch1 sim-tp-bfeb sim-tp-bfeb-c --medium --out <outside the repository>`),
and commit what `read.ts` and `live-seat.ts read` printed, which holds counts, digests and ids and
no task content, under `studies/runs/transitivity/` with the commit and host it was read at. The
logs hold hidden values and stay on the exam side.

## Hazards

- **Another commit and another day.** v065-a ran at `d46b4763`; the arms run at one later commit,
  and the solver model is served as it is on the day. Both sides of each comparison are solved
  afresh under one condition, so each reading stands on its own; none is set against v065-a's.
- **A fresh Examiner home.** A seed carries no `examiner-home`, so `tx-1` starts with an empty home
  and a copy of `bfeb41cd`, where x-6 started with x-5's home. Its tasks may differ in kind from
  x-6's; they are still held only where `bfeb41cd` leaves room, which is the selection B needs.
- **Conditioning on promotion.** The chain is the one that promoted, seven of seven first readings.
  A harness that won its own comparison by luck in its solves is solved afresh here, but a fit to
  its own frontier's tasks would pass to its descendants. B's tasks were written after the cut and
  meet no such fit.
- **The bill.** Every prediction is read without it. The tree's own reading, with the bill or
  without it where the step rule has dropped it by then, is printed beside and decides nothing.
- **Identical tasks under another id** are possible in principle and are not checked, since that
  would need the tasks' content.
- **Load.** The host runs live campaigns beside the probe. A solve waits for the load and records
  the wait; the wall counts the clock, and a loaded host shifts every solve's time on both sides.

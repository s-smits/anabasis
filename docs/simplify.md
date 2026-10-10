# The simplification plan

11 October 2026. Read at PR #185 (`49900e5`); the branch that carries this file sits on #186
(`4d13d22`), which was opened while it was written and which the reading does not cover. The
review that follows the header was written at `e25370d` by the session that implements it.

The operator's question: the climb chosen by about PR #180 stays, so which hooks and edges beside
it are no longer needed, and how does the tree get back to that mechanism with less around it?
This file is the answer in two parts. Part I is the reading: what improved, where the stack
stalls, what proliferates, and the defects found on the way. Part II is the plan: the operator's
decisions, then every cut as pull requests in order, each with its files, its tests, what it
needs and what would show it wrong.

It is a proposal and holds no status. `docs/plan.md` keeps the level of each part, and nothing
here moves one. Every cut is the operator's to accept.

**How to read a claim here.** Each carries one of four marks where it matters:

- *read*: I read it in the source, or ran a script over the tree at `49900e5`, in this session;
- *record*: it is what `docs/plan.md`, `docs/handover-2026-10-10.md`, `docs/transfer.md` or
  `AGENTS.md` says;
- *bodies*: it comes from a classification of the 179 pull-request bodies #2 to #183, which I
  did not recheck line by line;
- *estimate*: my reading of what a cut would take. Nobody has made the cut.

**What was not done.** No gate ran: the session reached no package registry, so `tsc`, lint, the
format check and the suite did not run on anything here. No campaign log was read. No source
file was changed: one removal was tried, the `withheld` programs of the command wall, and the
session's own permissions refused an edit to the wall's rules. The change beside this file is
text in `AGENTS.md`.

---

# Review, 11 October (UTC), at PR #186 (`e25370d`)

Read by the session that wrote #178 to #186, against the source at the stack's top and against
what two read-only reviewers found there earlier the same night. The plan was read at `49900e5`;
the top moved under it by three commits (#183's second, #184's third, #186's second), and some of
what it found was mended there. Each item below says what stands, what is corrected, and what
of the plan is taken, deferred or declined, with the reason. The order of Part II is kept.

**Taken as written:** F3, F4, F9, F6 (the comment), W1, A1 to A4, B1, B2, C1, D1, E1, E3, R1,
T1, T3, T4, and the edges of section 11 but `campaign-root.ts`. Each is one pull request on the
top, in the order of section 10, with the guard of section 9.

**Already done, otherwise than proposed:**

- *F1.* Mended at #183's second commit (`9217594`): `stopRule` counts a reading under the
  campaign's trigger as a move that showed a gain (`triggered`, `triggerOf`), which resets the
  count as a `step` does, so a 2-0 as the last move of the patience does not end the campaign
  before its repeat. The count does not start again at `harness.promoted`: a promotion follows a
  reading that already counted. The rule now lives in `src/kernel/compare.ts` beside the sign
  test, which the kernel reads without `src/builder`, as the plan asks.
- *F2.* Half mended there: `readTwice` requires the earlier of the two to have cleared the
  trigger, and the repeat to have untied a task and not lost. The other half, that both scored
  the same task versions, is **declined**: `pairOf` already holds the two to one pair of harnesses
  under one setting, and under the null every untied task of either comparison is a fresh solve
  whichever versions it drew, so the summed test holds whatever was written between. Holding the
  repeat to identical versions would refuse a repeat whenever a task was released, refused or
  held out between the two, which the climb does on purpose. What the plan's 3.4% describes is
  the rule that runs, since the enumeration (`chanceOfPromotion`) was held to the same two
  conditions.
- *F7* stands and is taken with D1.
- *F8* stands: under the two-stage rule `reading()` returns `no-step` for a 2-0 and never asks
  the starter, so the guard runs only for a comparison that clears 0.10 alone. Taken with B2.

**Corrected readings:**

- *F4* overstates the drain. `awaitingLabel` counts no comparison that cut a solve of the task at
  a limit (`AT_A_LIMIT`), so a room task the reference harness runs out of turns or time on stays
  scored. What drains is a task the reference *answers wrongly* twice, with no valid answer on
  record: that is the plan's "possibly infeasible" case by design, and it is where the Examiner's
  own `try_answer` pass is the fact that settles it. The package stands at that size. Rule 9 is
  noted: the fact kept is that an answer exists, not the answer, and nothing solves.
- *F5 and F6* are confirmed in the source: `isolationArgv` has one caller, the probe
  (`solve-sandbox.ts:310`), and `stageCommandIsolation` mounts no sized tmpfs, so a solve, a
  Builder session and an Examiner session are uncapped on Linux. A cap there needs a mount on
  the host, which the `ana` user that runs R1 cannot make, so F6 stays a statement and the
  budget and the wall are what bound R1.
- *F10* is confirmed as a reading of the patterns; whether it opens a stored pack on the Mac is
  not: the operator's home is closed whole there, and every stored pack lies under it. W5 is
  right all the same, and the Mac's.
- *Section 5(b)* names `exhausted`, `awaitingLabel`, `unansweredTwice`, `referenceFailed` and
  `outcomesOf` as compensation for weak seats. Three of them are what the draw, the release and
  the Examiner read of a task's record, and C1 is the right answer: one fold, five predicates.
- *Section 9, rule 8* ("no package adds a flag, a threshold, an event kind or a sentence to a
  prompt") is kept for the cuts. F3 changes sentences of the Examiner's record and F4 adds a
  field to an event the log already writes; both are named under "Not done" of their pull
  requests as the rule asks.

**Deferred, with the reason:**

- *B3 (no `--predict`)*: declined. `AGENTS.md` section 10 holds a prediction to the log before
  the first solve, written so that a recorded count settles it; a ledger a session keeps is not
  the record. Fifty lines buy that. It is reconsidered when D2 lands and the ledger is the only
  place a launch is described.
- *D2 (the launcher starts nothing)* and *D3 (the round is no command)*: deferred until the
  session on the Mac says it starts nothing through `runs launch` any more. The buffer campaigns
  of 10 October were launched through it, and a cut that spans fifteen files collides with a
  session patching one (section 12). D3 is taken last if at all, as the plan says.
- *W2 to W7*: the Mac's, as the plan says: each needs the suite on both systems and the Seatbelt
  half cannot run here. W1 is taken here, since it removes names with no maker and no reader.
- *E2 (a Builder's home carried whole)*: deferred. It is a design change to what a Builder reads
  across sessions, which `docs/plan.md` row F27 holds open, and the byte limits of `memory.ts`
  are what keep a carried folder from growing a session; one limit for the whole is the same
  mechanism with one number. Taken once a campaign has run two sessions on one home.
- *R2 (the pulse)* and *T5 (the lint rules)*: the operator's, as the plan says. *R3*: waits for
  buffer under the objective, as D11 says. *T2*: as files are touched.

**What the review adds:**

- The guard of section 9 runs at the top before any cut, so each package is read against the
  same baseline: `test/decide.test.ts test/admission.test.ts test/reports.test.ts
  test/compare.test.ts test/round.test.ts test/harness-builder.test.ts` 180 pass, and the whole
  suite at `e25370d` 870 pass, 32 skip, the container's 3 (a stop's process-group reaping, the
  resolver bind, the policy-rename case, which fail at every head here).
- Nothing here changes R1's launch: its tree stands at the top the cuts are made on, and moves
  with it once the phase it is in has its guard green, never while it runs.

---

# Part I. The reading

## 1. What improved

- **The measurement.** v1 ran 83 runs and completed no improvement cycle (*record*). v2's
  comparison reads the same direction when it is repeated: buffer's first step read 5-0-2 and
  then 7-0-0 on the old starter and 4-0-3 twice on the new one, and the starter against itself
  read no step (*record*). The comparison's kernel is small and stood still while everything
  around it moved: `src/kernel` went from 2,645 lines at #56 to 3,207 at #183, `src/builder`
  from 2,064 to 5,651 (*read*).
- **A first step is cheap.** Buffer's first round billed $31.43, and a small campaign from a
  prompt 2 to 5 dollars in all (*record*).
- **The infrastructure faults converged.** What a command leaves running (#56, #58, #59, #61) and
  a provider that fails in transit (#30, #41, #43, #53) were each mended and stayed mended
  (*bodies*).
- **Three seats got simpler and then stood still.** The solver became pi's coding agent with
  facts on its tool results (#70, #72, #74). The Referee's text has not moved since #55 and the
  Diagnoser's since #78 (the byte counts *read* from the stack's instrument).
- **The record is honest.** The plan's ladder of levels, the counts kept apart, and a handover
  that says what a step measured in narrower words than "a step".

## 2. Where it stalls

- **No second promotion with a model.** One promotion in 3 of 10 campaigns from a prompt (t-4,
  t-9, t-10), and none followed by a second (*record*). Over the 22 comparisons on record the
  tally is 76 wins, 3 losses and 110 ties, and comparisons against a promoted harness tie about
  three in four (*record*).
- **What the first promotions measured is narrow.** t-10's step was read at 3 told turns and says
  the harness answers in 2 turns where the starter takes 3, on tasks both answer at the full
  limit; the starter spent a turn on a failing install in 26 of 34 solves that ran out of turns.
  Buffer's first steps were read under a wall of five and of eight minutes, and at the full
  limit the same pack tied 9 of 9 (*record*).
- **The loop-side work circles one obstacle.** From about #98 the pull requests on the loop
  answer the same two faults from different sides: a campaign ends before its tasks are
  measured (16 pull requests), and tasks tie or leave no room (11). Planned design steps on the
  loop fall from 9 to 6 to 2 a day while those forced by a run rise from 1 to 9 to 17
  (*bodies*).
- **Rules were reversed after results.** 28 of the 179 pull requests replace or redo an earlier
  one (*bodies*). The thresholds moved one way: the smallest promotion went from 4-0 read twice,
  to 3-0 read twice (#175), to 2-0 read twice (#183); the stop went from 3 moves to a patience
  of 6 with two exemptions (#98, #145, #146) (*record*, *read*).
- **The climb is proved for the controller alone.** `test/climb.test.ts` gives a task a number
  and a harness a number, passes a solve where the first is at most the second, adds two to the
  harness at every Builder session, and has the Examiner read the reference harness's strength
  from its kept state and write tasks one to four above it (*read*). Its own head comment says
  so: it proves "the controller's part of the climb and nothing of a model". A real Examiner is
  told one outcome a task, and no real Builder session is known to gain.

## 3. Why a second step does not follow yet

Three things a model has to do that no code here makes happen (*read*, and my judgement):

1. **The Examiner has to find the band**: tasks the reference harness fails and a better one
   answers within the budget. Nothing checks that a new task is harder. What it hears of its last
   tasks is inverted for the ones that matter (section 6, F3).
2. **The Builder has to turn two or three released fails into a gain that carries** to tasks it
   has not seen.
3. **Enough untied tasks have to survive the bookkeeping**: a release for practice takes them
   out of the scored set, and a task nobody answers in two comparisons waits for a person (F4).

My judgement for one real campaign at this head, in a domain that scales: a first promotion
about even, a second 10 to 15 in 100, a third a few in 100. What would change that is one
logged control in which the reference is valid on fewer than three solves in four of at least
three new tasks, one practice fail turned after a promotion, and one real second promotion.

**The cuts below do not make the system climb.** They take away what stands between a reader and
the mechanism, three defects that drain the tasks a second epoch is read on (F1, F3, F4), and
the cost every later change pays for the size of the tree.

## 4. Tools of the harness's own

The operator wants the Builder to write tools for the solver, as v1's did, for the tokens they
save. On that the stack went back and then to neutral (*record*, *read*):

- From #73 a prompt told the Builder to leave `agent/tools.ts` empty while the solver had the
  shell, and no harness of ten campaigns declared a tool (plan row B8).
- #138 lifted the sentence and has `practice` report tokens. Tokens still enter no decision:
  `decide.ts`, `move.ts`, `ground.ts`, `admission.ts`, `compare.ts`, `reports.ts` and
  `comparison.ts` name none, and a comparison's report holds mean billed dollars a solve
  (*read*).
- A tool call is a fresh process each time (`src/solve/harness.ts`), where v1 kept a worker.

No cut below changes this. The objective (#184) is where a measure other than validity now
enters a pair; tokens a valid answer could enter the same way, and that is a design step and no
simplification.

## 5. The pattern

**Nothing is retired.** A failed run is answered by adding a row, a threshold, a sentence and a
reader, and the mechanism the addition replaces stays where it was.

- Of the 122 pull requests measured on the stack from #57 to #185, 3 left `src` smaller (#88,
  #90, #127), 77 left it larger and 42 did not touch it (*read*).
- `src` went from 15,152 lines at #56 to 20,111 at #183, blank lines counted (*read*).
- The stack's own instrument (`stack-complexity.py`, PR #173) reads, from main to #183: source
  +48.8%, import edges +71.6%, exported symbols +52.4%, optional fields +78.1%, prompt bytes
  +88.8%, and decisions per 100 lines flat at 17.6 (*read*: I ran it). The code is not denser.
  There is more of it.

It shows in four forms.

**(a) Generations stand side by side.**

| What | The generations at #185 |
| --- | --- |
| Starting a move | commands by hand (`tools/d2/round.ts`, `checkpoint.ts`, `session.ts`), the launcher that wraps them (`tools/runs/launch.ts`, 626 lines), the campaign command that names and makes each move (`tools/d2/harness-builder.ts`, 784) |
| What comes next | `nextMoves` (`src/builder/handover.ts`), `admission`, the launcher's preflights, `decide` |
| Making room | the budget ladder (#99), harder tasks before it (#167), the objective (#184) |
| A solve's limits | prompts (`--solve-turns`), seconds, the model's turns, CPU seconds |
| The wall | v1's run-data name patterns and peer-checkout scan, and v2's list of worktrees (#141) |
| Opening a campaign | a stored v1 pack by four flags, and a prompt |

**(b) A weak seat is compensated in the controller.** The Examiner cannot yet write tasks that
tell two harnesses apart, and a Builder was given nothing it fails. Neither was mended at the
seat. The table and the folds grew around them: `exhausted`, `awaitingLabel`, `unansweredTwice`,
`referenceFailed`, `outcomesOf`, `unshown`, `toTarget`, `toPractise`, `noRoom`, `tooHard`,
`harder`, `owed`, `afforded`, `noiseRead`, `vouches`. 22 pull requests changed the table between
#99 and #183. Two left it with fewer branches: #101, which moved the opening into a file of its
own, and #167 (*read*).

**(c) The incident is written into the code.** `src` names a date of September or October 183
times, in 49 of its 92 files, and 31% of its nonblank lines are comment. `AGENTS.md` is 98 kB, a
quarter of it the lint rules, and every coding session reads it whole. `docs/plan.md` is 232 kB.
The commands declare 99 distinct flags (*read*).

**(d) Proof machinery from v1 for a threat v2 does not have.** v1's Builder wrote the checks, so
v1 confined its verifier by default-deny with attested reads and hashed every policy. v2's
checks are the exam side's. The attestation, the policy identities and a five-step probe came
over all the same (section 6, F5, and phase 4).

## 6. Defects found on the way

Each is *read* in the source at `49900e5`. The plan mends each in the package named.

| # | Defect | Where | Mended in |
| --- | --- | --- | --- |
| F1 | The stop rule does not know the two-stage step. It reads a report's own `reading === "step"`, which since #183 only a comparison clearing 0.10 alone has, so a promotion read as two readings summed counts as a move without a gain. The stop is also asked before the repeat, so a reading that cleared the trigger as the last move of the patience ends the campaign before its repeat | `stopRule`, `src/kernel/reports.ts`; the order of rows in `decide` | F1 |
| F2 | The promotion sums a pair's last two comparisons whatever stood between them. `readTwice` takes `reports.slice(-2)` and does not ask that the first cleared the trigger or that the two scored the same tasks | `readTwice`, `src/builder/move.ts`; `onStep` | F2 |
| F3 | The Examiner hears a room task as a worthless one. After a control, a task the reference fails and the starter fails reads "no valid answer yet", and its prompt says such a task "measures nothing". One the reference answers and the starter fails reads "one harness won" | `outcomesOf`, `src/kernel/reports.ts`; `SAID`, `src/examiner/record.ts`; `src/examiner/prompt.ts` | F3 |
| F4 | A room task leaves the scored set. `scoredSet` leaves out every task of `awaitingLabel`: no valid answer on record after two comparisons that cut no solve of it. A task written to be failed by the reference is failed in the control and, where the Builder does not get there, in the next comparison, and then waits for a person | `scoredSet`, `src/builder/round.ts`; `awaitingLabel` | F4 |
| F5 | The wall's probe proves another launch than the one in use. It goes through `isolationArgv`, the launch of v1's sandboxed model process; in v2 the loop runs in the host process and every command goes through `stageCommandIsolation`. `isolationArgv` has one caller, the probe's own. The ancestor-rename result is probed, by two more launches, and `walledBase` does not read it | `walledBase`, `src/solve/command.ts`; `src/verify/solve-sandbox.ts` | W2 |
| F6 | On Linux nothing caps a solve's disk. The sized tmpfs is in `isolationArgv` alone. The head comment of `src/verify/disk-cap.ts` and the header of `test/disk-cap.test.ts` say a solve is capped there | `mountDiskCap`; `stageCommandIsolation` | F6 |
| F7 | `nextMoves` names a promotion by a comparison's own `step`, beside `decide`, which promotes by `readTwice`. `runs view` prints both | `src/builder/handover.ts`; `tools/runs/view.ts` | D1 |
| F8 | The starter guard is held to one comparison clearing its level alone: `reading()` returns `no-step` before it asks. A promotion read in two stages is never held to the starter | `compared`, `src/builder/comparison.ts` | B2 |
| F9 | "Half at most" of the tasks the reference failed are released, and the other half stay in the pool the draw then takes from | `releaseOrder`, `tools/d2/prepare.ts` | F9 |
| F10 | What closes a stored pack's hidden values is v1's name patterns on Darwin, and on Linux a scan for sibling folders that carry `domains`, `campaigns` or `correctness-model` beside a denied root. `walledBase` names neither `--root` nor `--bundle`. I did not check a real pack against the scan | `runDataDenyPaths`, `RUN_DATA_DENY_PATTERNS`, `src/verify/wall-policy.ts` | W5 |

---

# Part II. The plan

## 7. What stays

The climb as it stands at #180 to #185. No package below changes any of it, and each controller
package proves that by the guard of section 9.

- One question, one comparison in code on held-out tasks, fresh solves a side.
- The Examiner writes the tasks, and harder tasks come before anything else changes (#167).
- Epochs (#168): a promotion, tasks the new reference fails, a control of the starter against
  the reference on them (#140), practice released by outcome (#136, #140), a Builder session
  with `practice` under the parent and under the reference (#160, #181), a comparison.
- The scored set drawn newest epoch first with a quarter kept for the epochs before (#171,
  #180), and tasks the reference answered twice left out but for a third (#146).
- The sign test read in two stages, the trigger buying the repeat (#183), pinned in the
  campaign's opening (#178).
- The objective between two valid answers (#184).
- The campaign's patience, its dollar total, the operator's word (`tools/d2/word.ts`).
- The wall between the exam side and the build side with its closed list, the Referee before a
  rejection counts, hand labels over rulings, and one append-only log a campaign.
- The four parts of a harness, tools of its own among them.

## 8. Decisions for the operator

Each is one question with my recommendation. A package that needs one names it.

| # | Question | Recommendation | Unlocks |
| --- | --- | --- | --- |
| D1 | The stack forked at #162. #163, #164 and #172 to #174 stand on a side line. Land them on the main line, or close them? | Land #173 (the instrument) and #174. Decide #172 with D8: it narrows the Builder's one limit in its prompt | the measures of section 10 |
| D2 | One fixed budget a campaign: retire the ladder, the readings at shorter budgets, CPU seconds and the prompt count as a flag? | Yes | A1 to A4 |
| D3 | The noise arm: off in the table, kept as the operator's flag on a checkpoint? | Yes | B1 |
| D4 | The starter guard: remove the readings `below-starter` and `starter-unread`, and say the starter's tally in the report only? | Yes. It no longer runs where a promotion is read in two stages (F8) | B2 |
| D5 | The Examiner hears each task's outcome against the reference harness, in place of "one harness won"? | Yes. It is still one outcome a task, and no zone, share or count | F3 |
| D6 | A task for which the host saw `try_answer` pass is feasible on record, and never waits for a person? | Yes. The answer is not kept, only that one passed | F4 |
| D7 | The campaign command is the one way to start a move. The launcher's `launch` and the round as a command go? | Yes | D1 to D3 |
| D8 | The wall in the shape of `AGENTS.md` section 2, consequence 6, and a session that may edit `src/verify`? | Yes | W1 to W6 |
| D9 | Campaigns under the operator's home, outside every worktree? | Yes, after W1 to W5 | W7 |
| D10 | The Diagnoser: remove, or keep until the blind labels of #182 are read? | Remove. 20 of 20 on record named the solver | E1 |
| D11 | Stored packs: keep the four-flag path after buffer has been read under the objective? | Decide then | R3 |
| D12 | `AGENTS.md` section 12 beside the linter; and whether the repository's own 56 lint rules stay | Move the section now; the rules after one measured week | T1, T5 |
| D13 | This branch (`claude/allow-whole-retire-superseded`): open it as a pull request on the top? | Yes, after one session with the gate has run it | everything |

## 9. How each package is done

These hold for every pull request below. The first four are the stack's own rules, and the last
four are what this plan adds.

1. One subject a pull request, on the top of the stack, each commit passing alone
   (`.claude/skills/stack-pr/SKILL.md`).
2. A reader that changes is replayed over the recorded logs (`bun run runs replay`), and the body
   says which recorded moves and readings change.
3. A wall that changes runs the suite on macOS and on Linux, and the body says where.
4. An event kind stays readable. A cut removes the writer and the fold, never a kind from
   `EVENT_KINDS`.
5. **The cut and its tests go together.** A test that proved the removed path is deleted in the
   same commit. A test that proved the kept mechanism through the removed path is moved to the
   kept one first, in a commit of its own that passes before the cut.
6. **The guard for a controller package** (A, B, C, D, F1, F2), run before and after:
   - `bun run test -- test/decide.test.ts test/admission.test.ts test/reports.test.ts
     test/compare.test.ts test/round.test.ts test/harness-builder.test.ts`;
   - `ANA_CLIMB=1 bun run test -- test/climb.test.ts`, which is to promote three times in 24
     moves at a target of 8, as plan row B14 records it;
   - `bun run runs rehearse --campaign` over the seed of t-10 (plan row B15: 14 moves, 160
     solves, "went as scripted").
7. **The body gives the net lines** of `src` and `tools`, and the instrument's row for the pull
   request once D1 lands it.
8. **No package adds a flag, a threshold, an event kind or a sentence to a prompt.** One that
   seems to need one says so under "Not done" and stops there.

## 10. The order, and what each phase is to leave

Lines are nonblank, of `src` and `tools` without `tools/oxlint` and without tests: 30,446 at
`49900e5` (`src` 19,352, the tools 11,094) (*read*). Every figure in the last column is an
*estimate*.

| Phase | Packages | Needs | Leaves |
| --- | --- | --- | --- |
| 0 | G1, G2 | D1, D13 | a baseline, and one line of stack |
| 1 | F1, F2, F3, F4, F6, F9 | D5, D6 | the defects mended; about +40 |
| 2 | A1 to A4, B1 to B3 | D2, D3, D4 | about −950; the table at about 16 rows from about 20, and 8 moves from 9 |
| 3 | C1, D1 to D3 | D7 | about −850 |
| 4 | W1 to W6, then W7 | D8, D9 | about −2,200, nearly all of it of the 3,958 in `src/verify` |
| 5 | E1 to E3, R1 to R3 | D10, D11 | about −1,250, and about −1,000 more with R3 |
| 6 | T1 to T5 | D12 | `AGENTS.md` under 60 kB |

Phases 1 to 5 without R3 come to about 5,200 lines, a sixth of the 30,446.

Phases 2 and 3 touch no wall and need one host. Phase 4 needs both systems. A phase is finished
when its guard passes and a campaign from a prompt has run to a typed ending at its head.

**A campaign that runs is not moved.** Every package changes what a solve runs under or what a
reader says, so it opens a new condition. Campaigns on record finish on the tree they started in
(`AGENTS.md` section 10, rule 1).

---

## Phase 0. Ground

### G1. One line of stack

- **Why.** Two lines stand since #162. The side line holds the one instrument that measures a
  cut (#173) and a rule the main line lacks (#172).
- **What.** By D1: the side line's owner rebases #173 and #174 onto the top, or closes them.
  #172 goes with D8.
- **Done when.** `bun .claude/skills/stack-pr/scripts/stack.ts` prints one chain.

### G2. The baseline

- **What.** No file. The first pull request of phase 1 carries in its body the instrument's
  table at the top and the counts below, so that every later body is read against them.
- **The baseline at `49900e5`** (*read*): `src` 19,352 nonblank lines, 13,376 without comments;
  `src/verify` 3,958; `src/builder` 5,467; the tools without the lint tooling 11,094;
  `tools/oxlint` 13,815; tests 24,696 in 102 files; 99 flags; 45 event kinds.

---

## Phase 1. Defects

Each is a small pull request that stands whatever is cut later.

### F1. The stop rule reads a promotion, and a reading that bought its repeat is not yet a move

- **Why.** Section 6, F1.
- **What changes.**
  - `stopRule` (`src/kernel/reports.ts`): the count of moves since the last gain starts again at
    a `harness.promoted` event, as it does at a report that read `step`. A pair whose last
    comparison cleared the campaign's trigger, and has no later comparison of the same two, is
    left out of the moves: it is one draw whose repeat is owed. The trigger is read from the
    opening (`campaign.opened`), where #178 pinned it.
  - `signP` is in `src/kernel/compare.ts` already, so the kernel imports nothing of
    `src/builder`.
- **Tests.** `test/reports.test.ts`: a 2-0 and a 2-0 with a promotion after them leave
  `sinceStep` at 0; a 2-0 as the sixth move leaves `stop` false until its repeat reports.
  `test/decide.test.ts`: the same log names the repeat and no ending.
- **On the recorded logs.** Replay. No campaign on record was promoted in two stages, so no
  recorded move should change; the body says so with the count.
- **Lines.** About +15.

### F2. A step and its repeat are the same two harnesses on the same tasks

- **Why.** Section 6, F2. The chance of a false promotion the plan gives (3.4% an attempt) is of
  one reading and its repeat. A window that slides over any two comparisons of a pair, with
  tasks written between them, is another test.
- **What changes.** `readTwice` (`src/builder/move.ts`) reads two reports where the earlier one
  cleared the trigger and the later one scored the same task versions (`versions` of both
  reports). `onStep` passes the trigger.
- **Tests.** `test/decide.test.ts`: 3-1, tasks written, 4-0 names a repeat of the 4-0 and no
  promotion; 2-0 and 2-0 on one set promote.
- **Needs.** Nothing: it restores the rule as `AGENTS.md` section 7 states it.
- **Lines.** About +10.

### F3. The Examiner hears what the reference harness did

- **Why.** Section 6, F3. Needs D5.
- **What changes.**
  - `outcomesOf` (`src/kernel/reports.ts`): the outcome of a task is read on the reference
    harness's side of the last comparison that scored it: answered in every solve, in some, in
    none. `exhausted`, `disputed` and "not yet compared" stay.
  - `SAID` (`src/examiner/record.ts`): three sentences for the three, in place of "one harness
    won", "a tie between valid answers" and "no valid answer yet".
  - `ROOM` (`src/examiner/prompt.ts`): its last sentence already points at "the outcomes above",
    and stays as it is. The system prompt's sentence that a task with no valid answer "measures
    nothing" stays too: F4 is what keeps a feasible task from reading as one.
- **The wall.** The outcome is of the reference harness alone. It names no other harness, no
  count of solves beyond "every, some, none", and no check. The test of rule 3 for the Examiner
  (`test/examiner.test.ts`) gains the hostile case: two campaigns that differ in which harness
  won a task give the same lines.
- **Tests.** `test/reports.test.ts` (the outcome cases), `test/examiner.test.ts`.
- **Lines.** About 0.

### F4. A task the host saw answered is feasible, and stays scored

- **Why.** Section 6, F4. Needs D6.
- **What changes.**
  - `tryTool` (`src/examiner/session.ts`): where the verdict is a pass, the desk keeps the
    instance's content hash (`contentOf`). Nothing of the answer is kept.
  - `propose_tasks`: a proposal whose content the desk holds as passed is logged with
    `feasible: true` on its `task.proposed` event.
  - `awaitingLabel` (`src/kernel/reports.ts`): a task proposed as feasible counts as one with a
    valid answer on record, which that fold already treats as settled "for good".
- **What it does not do.** It asks no answer of the Examiner. A task proposed with none tried
  goes to a person as today. Rule 9 stands: no answer is stored, and no solve is made.
- **Tests.** `test/examiner.test.ts`: a pass and then a proposal of the same content logs the
  fact, and a changed instance does not. `test/reports.test.ts`: such a task never awaits a
  label. `test/round.test.ts`: it stays in `scoredSet` after two comparisons without an answer.
- **Lines.** About +15.

### F6. Say what is capped on Linux

- **What changes.** The head comment of `src/verify/disk-cap.ts` and the header of
  `test/disk-cap.test.ts`: a solve, a Builder session and an Examiner session are uncapped on
  Linux, and why. `AGENTS.md` says so since this branch. No behaviour changes.
- **Needs.** A session that may edit `src/verify` (D8), though this is a comment.

### F9. Half of the failed tasks stay scored

- **What changes.** `releaseOrder` (`tools/d2/prepare.ts`): `rest` leaves out every task of
  `failed`, so the draw cannot release the half that was kept.
- **Tests.** One case beside the release's own.
- **Lines.** About +2.

---

## Phase 2. The controller

### Package A. One fixed budget a campaign (D2)

`AGENTS.md` section 1: "One fixed compute budget for both harnesses. No band and no levels." The
source holds a ladder all the same. Since #167 it is the fallback behind the tasks, the plan's
levers of 10 October, 22:15 name no budget, and its account of t-10 is that with the budget
first the campaign "climbed in turns". The objective (#184) is the second way to room now.

What stays through all four: `--solve-model-turns` as the one number told to the solver and
held, `--solve-minutes` as the wall of a solve, a time limit a command, and the operator's word
to open another campaign under another budget.

What would show the package wrong: a recorded campaign in which an Examiner asked for room held
out nothing for its whole patience, and a rung of the ladder then read a step on tasks the
reference harness failed at the full limit. On record a rung read its steps on tasks both
harnesses answered at the full limit (t-10, `docs/handover-2026-10-10.md`).

#### A1. The table without the ladder

- **What goes.**
  - `src/builder/decide.ts`: the rung in `harder` (it becomes `written`), `tried`, the two
    full-limit branches of `onStep` (it becomes: the pair read twice, promote), the longer-rung
    half of `tooHard` (it becomes: tasks written since are compared on, else other tasks), the
    setting index in `afterPromotion`, and the last three paragraphs of the head comment.
  - `src/builder/move.ts`: `budgetBy`, `toBudget`, `budgetSaid`, `vouches`, `held`, `HALF`,
    `versionsOf` unless F2 keeps it, the move `budget` of `Decided` and its line in
    `decidedLine`.
  - `src/builder/ground.ts`: `Under`, `settingsOf`, `under`, `rest`, `settings`, `turns`; `here`
    is `all`. `Plan.limit` and `Plan.ladder`.
  - `src/builder/opening.ts`: `ladder` and `limit` as terms of the table. The limit stays as the
    setting's.
  - `tools/d2/harness-builder.ts`: `--ladder`, `ladderOf`, the arm of `make` for a budget move,
    the import of `rebudget`, and the `--budget turns=` flags `comparisonOf` adds.
  - `tools/d2/setting.ts`: `rebudget`.
- **Tests.** `test/decide.test.ts` names the ladder 18 times and the full limit 22 times in 42
  cases; `test/harness-builder.test.ts` 5; `test/admission.test.ts` 2; `test/handover.test.ts`
  1; `test/setting.test.ts` 5 for `rebudget`. The cases of the ladder go. The cases that prove a
  promotion through a full-limit reading are rewritten to the plain promotion first.
- **Docs.** `AGENTS.md` section 6 (the paragraph on `--ladder`, the flag line of t-9) and
  section 7 ("The budget", and most of "What follows a reading"); the skills
  `system-path-simulation` and `run-improvement-campaign`.
- **On the recorded logs.** Replay. A campaign that walked the ladder (t-4, t-9, t-10) reads
  another next move after its last comparison, and the body lists them.
- **Lines.** About −280 (*estimate*).
- **Done** at PR #193 (11 October), as written, with two differences: `here` is the comparisons since the setting's last record (no reading across two settings, kept until A4), and `Opening.limit` stays, since the controller names `--solve-model-turns` from it for a campaign from a prompt.

#### A2. A comparison read at one budget

- **Depends on.** A1: `budgetBy` and `tooHard` are the readers of a report's rows by budget.
- **What goes.**
  - `src/kernel/compare.ts`: `Budget`, `UNITS`, `over`, `within`.
  - `src/builder/comparison.ts`: the rows a report holds for each shorter budget (`budgets`),
    `asBudget`, the key in `REPORT_KEYS` and in `Fixed`.
  - `src/builder/round.ts`: `Terms.budgets` and their refusals in `refuseTerms`.
  - `src/kernel/reports.ts`: the `turns` parameter of `validAt` and of `roomOf`.
  - `tools/d2/round.ts`: `--budget`, `budgetsNamed`, the lines of `validLines` by budget.
    `tools/d2/checkpoint.ts`: the same flag. `tools/d2/harness-builder.ts`: the budgets in
    `termsOf`. `tools/d2/close.ts`: its two lines.
  - `tools/wri/folds.ts`, `tools/wri/read.ts`: the lanes that read a report by budget.
- **What is not touched.** `tools/d2/word.ts --budget <dollars>` is the campaign's total and has
  nothing to do with this.
- **Tests.** `test/compare.test.ts` (15 mentions), `test/round.test.ts`, `test/wri-read.test.ts`,
  `test/campaign.test.ts` (5).
- **Docs.** `AGENTS.md` section 7; the skills `launch-run` and `whole-run-investigation`
  (`references/lanes.md`, 8 mentions).
- **Lines.** About −200 (*estimate*).

#### A3. A solve's use in two figures

- **What goes.**
  - `src/solve/command.ts`: the `times` record, `childSeconds`, `CommandWall.cpu`, and the last
    paragraph of the head comment. `src/solve/run.ts`, `src/builder/session.ts`,
    `src/examiner/session.ts`, `tools/m0/live-solve.ts`: the `cpu` they pass.
  - `src/kernel/compare.ts`: `cpu`, `unmeasured` and `prompts` of `Used`, `MEASURED`, `spread`
    and `Spread`. The report's `spread`.
  - `tools/wri/folds.ts`, `tools/wri/read.ts`: the CPU lanes (`unmeasured`, `cut`).
  - `--solve-turns` as a flag (`tools/d2/setting.ts`, 11 mentions; `harness-builder.ts`,
    `launch.ts`, `round.ts`, `campaign.ts`, `opening.ts`). The cap on nudges stays as the
    constant of `LIMITS` it defaults to.
- **Why.** The plan lists a budget in CPU seconds as withdrawn, and the meter reads zero under
  Bubblewrap. `setting.ts` says of `--solve-turns` that it "bound no solve". `spread` was what
  decided the budget's unit, which is decided.
- **Tests.** `test/command.test.ts` (5), `test/compare.test.ts` (3), `test/wri-read.test.ts` (3),
  `test/coding-tools.test.ts` (3), `test/solve-run.test.ts` (2), `test/setting.test.ts` (8),
  `test/runs-launch.test.ts` (3), `test/campaign.test.ts` (3).
- **The condition.** `limits` keeps its field for the prompt count, so a condition's form does
  not move. A `solve.finished` written before this holds `cpu`, and nothing reads it afterwards.
- **Lines.** About −170 (*estimate*).

#### A4. A setting is recorded once and does not change

- **Depends on.** A1.
- **What goes.** `--new-setting` (`tools/d2/setting.ts`, 13 mentions of it and of `restarts`;
  `launch.ts`, `round.ts`, `checkpoint.ts`); `restarted` of `Wanted` and its use in `sized`
  (`src/builder/admission.ts`); the outcome `earlier-setting` (`reports.ts`, `record.ts`); the
  setting filters of `stopRule` (`from`), of `exhausted` and of `outcomesOf`.
- **What stays.** `campaign.setting`, written once; the refusal of a flag that names another
  setting; `firstRecord`, which holds a first record to what the log's solves ran under.
- **Tests.** `test/setting.test.ts` (15), `test/decide.test.ts` (3), `test/admission.test.ts`
  (2), `test/reports.test.ts` (3), `test/campaign.test.ts` (2), `test/runs-launch.test.ts` (2).
- **Lines.** About −100 (*estimate*).

### Package B. A comparison without its extras

#### B1. The noise arm is the operator's flag (D3)

- **Why.** The reference against itself costs half as many solves again beside the first
  comparison under a setting. The table reads only whether one was made (`noiseRead`), never
  what it read. The plan's measure M2 is a count of such controls, which a checkpoint by hand
  gives.
- **What goes.** `noiseRead` and every `"noise"` argument of `compare` in
  `src/builder/decide.ts`; the `noise` field of the move and its words in `decidedLine`; the
  three-sides arithmetic of `afforded` (two sides always); `--noise` in `comparisonOf` and
  `termsOf` of the campaign command.
- **What stays.** `--noise` on `tools/d2/checkpoint.ts`, `halves` in `src/kernel/compare.ts`, the
  report's `noise`.
- **Tests.** `test/decide.test.ts` (23 mentions), `test/harness-builder.test.ts` (5).
- **Lines.** About −60 (*estimate*).

#### B2. The starter's tally is a line of the report (D4)

- **What goes.** The readings `below-starter` and `starter-unread` as values a comparison
  writes (`Reading`, `reading()` in `src/builder/comparison.ts`); the third arm of a comparison
  and its completion (`src/builder/round.ts`); the row of `afterComparison` for
  `starter-unread`; the pair rule of `stopRule` for a harness set against the starter
  (`referenced`).
- **What stays.** The two words stay readable in a recorded report. The starter is still the
  control after a promotion (`onReference`), which is where the plan reads whether the starter
  loses more pairs each epoch (its measure M1).
- **Tests.** `test/round.test.ts`, `test/reports.test.ts` (3), `test/handover.test.ts` (2),
  `test/decide.test.ts` (2), `test/wri-read.test.ts` (5).
- **Lines.** About −90 (*estimate*).

#### B3. No prediction flag

- **Why.** `--predict` "decides nothing" (`src/builder/round.ts`), and the campaign command takes
  none. `AGENTS.md` section 10 already has a campaign's prediction written in the launching
  session's ledger.
- **What goes.** `--predict`, `predictionNamed`, `predictionLines` (`tools/d2/round.ts`);
  `Terms.prediction`, `predicted` (`src/builder/comparison.ts`, `round.ts`); the flag in
  `checkpoint.ts`, `session.ts`, `launch.ts`, `termsOf`.
- **Tests.** `test/round.test.ts` (12 mentions), `test/runs-launch.test.ts` (3).
- **Docs.** The skills name a prediction about 29 times, 12 of them in
  `run-improvement-campaign`, which is rewritten to the ledger.
- **Lines.** About −50 (*estimate*).

`programs-of:` stays: `AGENTS.md` section 9 names it as the evidence for one claim, and it is
nine lines.

---

## Phase 3. One record of a task, one way to start a move

### C1. One fold of a task's record

- **Why.** `src/kernel/reports.ts` reads what happened to a task five times for five readers:
  `exhausted` (the draw), `awaitingLabel` (the draw and a person), `unansweredTwice` and
  `referenceFailed` (the release), `outcomesOf` (the Examiner). `supplyOf`
  (`src/builder/admission.ts`) reads it a sixth time as a share (`untied`, `since`, `closed`),
  whose arithmetic was mended in #63, #67, #133 and #168 (*bodies*).
- **What changes.** One fold, `taskRecords(events)`: for each held-out task its epoch, its
  state, whether a valid answer stands on record (F4's fact among them), and for each comparison
  that scored it the valid solves and the solves of each side, with whether a limit cut one. The
  five folds become one-line predicates over it, with their names and results as they are.
  `supplyOf` counts the tasks the reference did not close, and `sized` loses its share.
- **In two commits.** The first keeps every result: `test/reports.test.ts` (38 mentions of the
  five) and `test/admission.test.ts` pass unchanged. The second removes the share.
- **On the recorded logs.** Replay: no move changes after the first commit, by construction.
- **Lines.** About −120 (*estimate*).

### Package D. The campaign command is the one way to start a move (D7)

The campaign command calls `acceptCommand`, `prepareCommand`, `draftCommand`, `examineCommand`,
`sessionCommand`, `checkpointCommand`, `promoteCommand` and `closeCommand` in its own process
(*read*). It does not call `roundCommand`, and of the launcher it uses the receipt alone
(`launchesOf`, `writeReceipt`). One refusal is therefore asked in three places: the launcher's
preflight, the command, and a row of the table.

#### D1. The view prints the table's move, once

- **What goes.** `nextMoves`, `Asked`, `Move` and `UNCOMPARED` (`src/builder/handover.ts`, about
  90 lines), and their lines in `tools/runs/view.ts`.
- **Mends.** F7.
- **Tests.** `test/handover.test.ts` (4 mentions).
- **Lines.** About −110 (*estimate*).

#### D2. The launcher starts nothing

- **What goes.** In `tools/runs/launch.ts`: `launch`, `preflight`, `sessionPreflight`,
  `examPreflight`, `refused`, `passedOn`, `settingFlagged`, `askedFlagged`, `flagsRefused`,
  `commandOf`, `start`, `endedEarly`, `reportedAs`, `sessionTaken`. The verb in
  `tools/runs/cli.ts`. `--loaded`, `--env-file` and `--no-comparison` as the launcher's.
- **What stays.** `stop`, `family`, `leftOpen` and the receipt (`receiptOf`, `writeReceipt`,
  `launchesOf`), in a file named for them. The campaign command already waits for the host's
  load and keeps a receipt a run.
- **What replaces a launch.** One paragraph of the skill: the campaign command, niced, in a
  process group of its own, with its output to two files and the key in Bun's `--env-file`.
- **Tests.** `test/runs-launch.test.ts` (376 lines, 20 cases): the cases of `stop` and of the
  receipt stay.
- **Docs.** `AGENTS.md` section 6 (the block of `bun run runs`, the two paragraphs on the
  launcher and on admission); the skill `launch-run` is rewritten as "start and stop a
  campaign"; `run-improvement-campaign` (5 mentions).
- **Lines.** About −420 (*estimate*).

#### D3. The round is no command

- **What goes.** `roundCommand` (`tools/d2/round.ts`), `round` and `RoundRequest`
  (`src/builder/round.ts`), the round mode of `tools/runs/rehearse.ts`, and the round's manual
  at the head of `tools/d2/round.ts`.
- **What stays.** The file's helpers, which the session and the checkpoint share
  (`sessionNamed`, `wantedNamed`, `capNamed`, `scoredNamed`). `runs rehearse --campaign`, and a
  rehearsal of one checkpoint or one session.
- **The cost.** `test/round.test.ts` is 1,543 lines in 51 cases, and most prove the comparison
  through a round. By rule 5 of section 9 they move to `checkpoint` first. This is the package
  with the least gain for its test work: take it last, or leave it.
- **Lines.** About −200 (*estimate*).

---

## Phase 4. The wall (D8)

This session could not edit `src/verify`: its permissions refuse a change to the wall's rules.
The phase is for a session on the operator's host, and every package runs the suite on macOS
and on Linux.

### What a seat's commands run under today

*Read* in `src/solve/command.ts` and `src/verify/solve-command-isolation.ts`.

- Three writable directories a command (`work`, the session `home`, a private `tmp`), a fresh
  `run-*` made and removed around every command, a profile file staged for each, and a policy
  rebuilt and hashed for each.
- Two layers of policy identity (`policyHash` of the session and of the command). Their one
  reader in v2 is the key of two per-process memos (`PROBED`, `REACH`). The condition records
  the profile's name, the platform and the disk bytes, and no policy hash (`recordedUnder`,
  `tools/d2/campaign.ts`).
- Programs `withheld` inside the tool tree: a field no caller sets and no test names.
- Seven name patterns for folders under the temporary directory. Three have a maker in v2: the
  verifier's cells (`ana-cell-`), the reviewers' and the Examiner's backend state
  (`ana-claude-cli-`), and the seats' own parent (`ana-built-bash`). Four are spelled in
  `wall-policy.ts` alone.
- v1's run-data patterns (`/correctness-model`, `/domains/<slug>/…`, `/campaigns/`, `/.env`,
  `hidden-tasks.json`) and its scan for peer checkouts. **These are what closes a stored pack
  today** (F10), so they go only once W5 closes a pack by name.
- The worktrees, read once a campaign (`worktreesOf`).

### The form to reach

By `AGENTS.md` section 2, consequence 6. A wall keeps three things, and each gets one rule.

| Kept | Rule |
| --- | --- |
| The exam side's hidden values | closed by name: the repository and its worktrees (or the campaigns' home, W7), a stored pack's root and bundle, and one host root that holds the verifier's cells and the reviewers' backend state |
| The operator's credentials | the home closed whole, with the runtimes and toolchains under it opened again read-only |
| One seat's files from another's | the parent of the seats' roots closed, and the seat's own root opened again |

A seat writes its one root, whole. `HOME`, `TMPDIR` and the staging folder are subfolders of it.
Reads are open otherwise. The network is open for a seat and closed for a check.

### W1. Names with no maker and no reader

- **What goes.** `withheld` (the field of `CommandDirectories`, of `CommandIsolationPolicy` and
  of both identities, `withheldKey`, its Seatbelt rule and its Bubblewrap binds);
  `PROTECTED_HOME_NAMES`; the four temporary names with no maker (`ana-pi-built-`,
  `ana-reference-solve-cwd-`, `ana-generated-tools-`, `ana-verifier-cache` with
  `VERIFIER_CACHE_STORE`).
- **Behaviour.** None changes: an empty list, an unread constant, and patterns that match no
  path v2 makes.
- **Tests.** None names `withheld`.
- **Lines.** About −50.

### W2. The probe goes through the launch in use

- **Mends.** F5.
- **What changes.** `walledBase` (`src/solve/command.ts`) probes as `networkReach` does, by
  commands through `runWalled`, once a policy a process: a read of a canary in the repository
  is refused, a read of the first other worktree's `package.json` is refused, and a write and a
  read under the seat's root succeed.
- **What goes.** `isolationArgv`, `runUnderPolicy`, `probeHostSolveReadDeny`, `judgeSteps`,
  `linuxMoveGuardCheck`, `observedRefusal`, `HostSolveIsolationEvidence`, the two fixture names
  and `liftDeniesCovering` (313 lines of `src/verify/solve-sandbox.ts` from `isolationArgv`
  down, *read*); `probeMoveGuardCheck`, `runIsolationProbe` and `MoveGuardCheck` (75 lines of
  `src/verify/seatbelt-path-guard.ts`, *read*); `bwrapIsolationArgs` and `bwrapWholeRootArgs`
  where nothing else calls them; the `cap` of `SolveIsolationPolicy`, which only that launch
  mounted.
- **The discrimination step.** The probe today lifts the denial and reads again, to show the
  refusal was the rule's and not a broken mechanism. The read under the root does the same for
  the launch: a mechanism that refuses everything fails it.
- **Tests.** `test/solve-sandbox.test.ts` (301 lines, 15 cases) is rewritten around the new
  probe, and `test/command.test.ts` gains the three reads. #185's Linux case already goes
  through the command wall.
- **Lines.** About −370.

### W3. One policy a seat, built once

- **What changes.** `commandIsolationPolicy` takes the seat's root and builds one policy for the
  session or the solve. `runWalled` stages a caller's files in a fresh folder under
  `root/staging`, starts the command there or in the home, and removes that folder afterwards.
  `TMPDIR` is `root/tmp`.
- **What goes.** `commandDirs`, `RunDirs` as two paths, the `ENOSPC` fallback that exists
  because a fresh `run-*` could not be made on a full volume, the profile file a command and its
  removal, the policy and hash a command, the three scratch roots in the identity,
  `CommandIsolationIdentity`, `BUILT_COMMAND_ISOLATION_FIXTURE` and
  `LINUX_COMMAND_ISOLATION_DESCRIPTOR`.
- **What a command loses.** A `TMPDIR` that is empty at its start. A seat's temporary files now
  last the seat. That is the grant made whole: one seat, one root.
- **Collision.** None between seats: each has its own root. Inside a seat one command runs at a
  time, and `endHolders` is called after each.
- **Tests.** `test/command.test.ts` (321 lines), `test/coding-tools.test.ts`,
  `test/harness-tools.test.ts`, `test/disk-cap.test.ts`.
- **Lines.** About −200 (*estimate*).

### W4. The host's own scratch under one closed root

- **Why.** The verifier's cells hold a check program and a task's hidden value, and the
  reviewers' and the Examiner's backend state holds what they read. Both are made under the
  shared temporary directory (`src/kernel/verify.ts:378`, `src/review/reader.ts:61`,
  `src/examiner/session.ts:389`, `src/examiner/draft.ts:463`), and closed there by a name
  pattern on Darwin and by the overmount of the temporary directory on Linux.
- **What changes.** They are made under one host root beside the seats' parent, which every
  seat's policy closes by path. The remaining temporary name patterns
  (`VERIFIER_TEMP_SIBLING_DENY_PATTERNS`, `COMMAND_TEMP_SIBLING_DENY_PATTERNS`) go.
- **What stays.** Darwin's grant of the user temporary directory to toolchains that ignore
  `TMPDIR` (`userTempRules`). That is the platform's, and the collision it leaves between seats
  is stated in `src/verify/disk-cap.ts`.
- **Lines.** About −40 (*estimate*).

### W5. A stored pack is closed by name

- **Mends.** F10.
- **What changes.** `Walled` carries the pack's root and bundle where a campaign opened over
  one, and `solveIsolationPolicy` closes them as it closes the repository. The harness's tool
  tree is opened again by path, as it is today.
- **What goes.** `RUN_DATA_DENY_PATTERNS`, `runDataDenyRules`, `RUN_DATA_NAMES`,
  `runDataDenyPaths`, `HIDDEN_TASKS_DENY_PATTERN`.
- **Tests.** A wall test on each system: a file under a pack's `correctness-model` is refused to
  a solve's command, with the pack in a folder that carries none of the three names beside it.
- **Lines.** About −70 (*estimate*).

### W6. A check runs under the same wall, with the network closed

- **Why.** Nine files hold the verifier's default-deny wall and its attestation, 1,700 lines
  (*read*): `exact-read-attestation.ts` 355, `read-root-attestation.ts` 319,
  `darwin-seatbelt.ts` 400, `os-isolation.ts` 175, `darwin-runtime-closure.ts` 155,
  `linux-bwrap-verifier.ts` 150, `isolation-description.ts` 88, `engine-cell-env.ts` 39,
  `verifier-port.ts` 19. v1 needed them because its Builder wrote the checks. An answer here is
  data, and a check is the exam side's code.
- **What stays.** Everything that makes a check's inputs a contract and is no wall of the
  system's: one fresh process a check, the projection of the answer and the task to the declared
  paths, one check's own hidden value, the copy of the check program in the cell, the tool tree
  as the only place a check's tools are found, the time limit and the reaping.
- **What changes.** `runCheck` (`src/kernel/verify.ts`) launches the check's process through
  the command wall with the cell as its root and the network closed. `plan.verify()` before and
  after, and the non-result "the wall changed while the check ran", go.
- **What goes.** The attestation files whole, the verifier's plans on both systems, and the
  parts of `os-isolation.ts` and `darwin-seatbelt.ts` that serve them. The part that finds the
  mechanism for both walls stays (`osIsolationSupport`, `darwinSeatbeltSupport`,
  `linuxBwrapSupport`). About 1,400 lines go (*estimate*).
- **The test.** `bun tools/m0/regrade.ts` over the stored verdicts, which matched 100 of 100 on
  truss (`docs/transfer.md`), is to match again. Then `test/verify.test.ts` and
  `test/acceptance.test.ts`.
- **What I could not establish.** What a check program's tools read outside the tool tree. The
  regrade is what says.
- **Tests that go.** `test/exact-read-attestation.test.ts` (149 lines),
  `test/read-root-attestation.test.ts` (140), `test/linux-bwrap-verifier.test.ts` (278), and most
  of `test/darwin-seatbelt.test.ts` (500).

### W7. Campaigns outside the tree (D9)

- **What changes.** A campaign's folder is under the operator's home, which the wall closes
  whole, and not under `.ana/` of a worktree (`campaignLog`, `tools/d2/campaign.ts`), with
  `.accounts` and `.env` beside it.
- **What goes.** `worktreesOf`, `otherTrees` through `Walled`, `solveIsolationPolicy` and the
  probe, and the class of faults of plan rows B10, B12 and B17.
- **What it changes of the rules.** "The worktree is the condition" keeps its first half: a run
  executes the source of the tree it started in, and the condition records that source by
  digest. "Never move a campaign's folder to another worktree" has nothing left to forbid.
- **Lines.** About −60 (*estimate*).

What would show the phase wrong, at any package: a wall test on either system in which a
solve's command reads a canary in the repository, in a stored pack, in the host root, in the
operator's home or in another seat's root.

---

## Phase 5. Seats and readers

### E1. No Diagnoser (D10)

- **Why.** 12 of 12 diagnoses of 9 October and 8 of 8 of 10 October named the solver
  (*record*). The Builder is handed the trace and the ending either way. It is a model call a
  failed practice solve.
- **What goes.** `src/review/diagnoser.ts` (350 lines, *read*) with its 6.9 kB prompt; the
  diagnosis in `src/review/agreement.ts`; `diagnosisText` and its place in a practice result
  (`src/builder/tools.ts`); the diagnoses of `src/builder/past.ts` and
  `src/builder/handover.ts`; the seat's wiring in `src/builder/session.ts` and
  `tools/d2/campaign.ts`; `--diagnoses` and the blind packet of #182 in `tools/d2/settle.ts` (28
  mentions); the lines of `tools/d2/close.ts` (11).
- **What stays.** `diagnosis.recorded` and `diagnosis.labelled` stay readable. The Referee and
  the reviewers' shared reader stay.
- **The wall.** A practice result loses one paragraph. The test of rule 3 for the Builder
  (`test/builder.test.ts`, "what crosses to the Builder") passes with fewer bytes on both sides.
- **Tests.** `test/review.test.ts` (39 mentions in 24 cases), `test/builder.test.ts` (11),
  `test/handover.test.ts` (8), `test/harness-builder.test.ts` (14).
- **Docs.** `AGENTS.md` sections 1, 3 and 14; the skill `whole-run-investigation` (about 23
  mentions).
- **If the operator keeps it.** Its measure is then the labels of #182, and this package waits
  for ten of them.
- **Lines.** About −500 (*estimate*).

### E2. A Builder's home is carried whole

- **Why.** `src/builder/memory.ts` (384 lines, from v1) carries two named files and a `scratch/`
  folder between sessions, each under a byte limit, with a starter text and a notice for a file
  over its limit. Consequence 6: carry the folder.
- **What changes.** When a session ends, its home less `harness/` is kept in the campaign's
  folder, under one byte limit for the whole, and the next session's home is seeded from it. The
  opening message names the folder.
- **What goes.** The two starters, the two limits a file, the cut that keeps both ends, the one
  copy of a repeated section, the notice, `carryMemoryForward`.
- **The wall.** The host still follows no link out of the home, as `memory.ts` says today.
- **Tests.** `test/builder-memory.test.ts` (463 lines, 26 cases) shrinks to the carry and the
  limit.
- **Lines.** About −250 (*estimate*).

### E3. The Builder's prompt says each fact once

- **Why.** The Builder's text grew at nearly every checkpoint, mostly a sentence a failed run:
  its system prompt from 3,498 to 5,250 characters, and `HARNESS.md` to 9,569 (a trace of the
  stack I did not recheck; the instrument reads `src/builder/prompt.ts` at 5,135 bytes on main
  and 9,751 at #183). Three pull requests answered one failure, a harness no practice solve had
  run, with words (#77, #93, #156) (*bodies*).
- **What changes.** The sentences that restate what a tool result already ends with go from the
  system prompt: the time and turns used, the practice solves left, that no practice solve has
  run the harness. `HARNESS.md`'s guide outline gains a tool beside its "Programs" heading, so
  that the worked example does not steer to programs alone.
- **Tests.** `test/builder.test.ts`, `test/starter.test.ts`.
- **Lines.** Text only.

### R1. No reader across campaigns

- **What goes.** `tools/runs/compare.ts` (364 lines, *read*), its verb,
  `test/runs-compare.test.ts` (353 lines), the skill `model-condition-comparison`.
- **Why.** `AGENTS.md` section 9: "Results are never compared across campaigns, and never across
  two settings." Two harnesses are set side by side by a checkpoint.

### R2. The pulse keeps what the campaign command reads

- **What goes.** The watching loop of `tools/runs/pulse.ts` (390 lines) for rounds and live
  solves. A campaign's state is what `runs view` prints. On 10 October the pulse read two
  running campaigns as closed (#150).
- **What stays.** `standing`, which the campaign command reads.
- **Needs.** The operator's taste: this is the runs session's own tool. Optional.
- **Lines.** About −150 (*estimate*).

### R3. One way to open a campaign (D11)

- **What would go.** `--root`, `--sweep`, `--cycle` and `--bundle` on 12 commands; `tools/m0`
  (726 lines); `tools/c/carry.ts`; the pack half of `tools/d2/prepare.ts` and of
  `tools/d2/campaign.ts`; W5's rule with it.
- **Why it waits.** Buffer, recode and truss open that way, and buffer under the objective is
  one of the plan's next readings.
- **Lines.** About −1,000 (*estimate*).

---

## Phase 6. Text and tooling (D12)

### T1. The lint habits beside the linter

- **What changes.** `AGENTS.md` section 12 (24.7 kB, a quarter of the file) moves to
  `tools/oxlint/HABITS.md`. The contract keeps ten lines: the gate, strict mode, never turn a
  rule off, and where the habits are. A session that writes no code does not read them.

### T2. A head comment says what the code does, and one defect

- **What changes.** `AGENTS.md` section 13: a head comment states what the module does and the
  defect its present form answers. The dated record of each campaign stays where it already is,
  in the pull request's body, and `git log` keeps it.
- **How.** No sweep. A pull request that touches a file trims that file's head comment to the
  rule. Packages A to W touch most of the files that carry the 183 dates.

### T3. The plan keeps its present

- **What changes.** "Where v2 stands" in `docs/plan.md` is a history written at #91 and again at
  #168. It moves to a file of its own beside `docs/v1.md`. The plan keeps the process, the fix
  plan with its level column, the climb plan and the decisions.

### T4. Sections 6 and 7 of `AGENTS.md`, written once more

- **After** A, B and D. "A campaign's commands" loses the launcher and the round. "How a
  comparison is read" loses the budget, the noise arm in the table and two readings. Both are
  written again whole, since each was patched a sentence a pull request.

### T5. The repository's own lint rules

- **The size.** `tools/oxlint` is 13,815 lines in 92 files, more than `src/builder`,
  `src/kernel` and `src/solve` together, with wrappers of 667 lines for the suite and 294 for
  the linter. It is v1's.
- **The question.** Whether 56 rules beside Oxlint's pay for themselves. I did not measure what
  they cost a change.
- **How to measure.** For one week, each pull request's body says how many strict findings its
  first lint run raised and how many edits answered them. Then the operator decides.

---

## 11. Small edges

Each has no reader or no effect (*read*). They go with the package named, or alone.

| Edge | Where | What I checked | Goes with |
| --- | --- | --- | --- |
| `withheld` programs | `solve-command-isolation.ts` | no caller outside the file, no test | W1 |
| `PROTECTED_HOME_NAMES` | `wall-policy.ts` | no reader; the home is closed whole | W1 |
| Four temporary names with no maker | `VERIFIER_TEMP_SIBLING_DENY_PATTERNS` | spelled in `wall-policy.ts` alone | W1 |
| `src/meta/completed-json.ts` | 60 lines | no importer | alone |
| `src/meta/campaign-root.ts` | v1's `campaigns/` root | imported by one lint rule and two tests | T5 |
| The trinomial test as a comment | `src/kernel/compare.ts` | the plan's own row C3 | alone |
| `--solve-turns` | `tools/d2/setting.ts` | "bound no solve", its head comment | A3 |
| `anchor.drawn`, `anchor.scored`, `exam.word` | `EVENT_KINDS` | no writer; kept readable by section 5 of `AGENTS.md` | stay |

## 12. Risks

- **Two sessions write the stack.** A cut that spans fifteen files collides with a session
  patching one of them. Take a package only when its owner files are quiet, and read the stack
  again before each push.
- **A cut that looks dead and is not.** F10 is the example: v1's run-data patterns read as
  residue and are what closes a stored pack. Rule 5 of section 9 and the wall tests are the
  answer, and no package deletes a rule before the one that replaces it has its test.
- **The tests are the cost.** The tests are 24,696 lines, more than `src`. A, B and D rewrite
  cases in `test/decide.test.ts` (1,068 lines) and `test/round.test.ts` (1,543).
- **The estimates.** Every line count marked so is a reading and no measurement. The first
  package of each phase says what the estimate was and what the diff is.
- **The simulation.** It runs at one solve a side and one session before a comparison, so it
  never reads a 2-0, a repeat or a loss. It guards the order of moves and nothing of the test.
  F1 and F2 rest on their own cases.

## 13. What I could not establish

- What any cut does to a suite I could not run.
- Whether the runs session still starts moves through the launcher. D assumes the campaign
  command.
- What closes a stored pack on Linux today (F10), and what a check's tools read (W6).
- The cost of the repository's own lint rules to a change (T5).
- Anything of a campaign's log. Every count of a run here is the record's.

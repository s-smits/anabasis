---
name: whole-run-investigation
description: "Investigate one Anabasis v2 campaign from its log and turn what it shows into findings with one owner each. Answers whether a comparison's reading (step, no-step, not-scored) may be believed, whether a fail was the solver's or the exam's, whether the harness could know the exam, whether the tasks bracket the solver, whether the campaign is climbing, and where the hours and dollars went. Reads evidence; starts no solve, session or round, and changes no verdict."
---

# Whole-Run Investigation

A whole-run investigation (WRI) reads one campaign: its log, the check program staged beside it and
the harness states it kept, against the question the operator asked. It ends in one adjudicated
synthesis that says whether each reading may be believed, what limited it, and which owner each next
change belongs to. It reads and proposes. It starts no solve, no session and no round, it appends to
no log, and the host's verifier stays the one owner of every verdict.

It is v1's skill rebuilt for v2. v1's catalogue had nine rows and thirty-eight lanes and was written
from one fact: the Builder wrote its own exam. v2 took that pen apart, so the catalogue here has six
rows and thirty lanes from v1: eleven of v1's kept with tuning, nine overhauled, ten new, and thirteen
removed with the machinery they read. [from-v1.md](references/from-v1.md) accounts for every one.
Lane 31 was added after the first live promotion (10 October) and reads a promotion and the climb
after it, beside peer campaigns where they are named.

Six narrower questions need no lanes. Start there when one of them is the whole question. Every
`wri.ts` verb takes a `<log>` as its path or as the campaign's whole name, as `bun run runs` does.

| question | command |
| --- | --- |
| Is a run alive, and what did it last do? | `bun run runs pulse` |
| Is there enough supply for a comparison, and what can it show? | `bun run runs view <name>`: its set-up line and the table's move |
| Does the checker stand on its controls and the stored answers? | `bun tools/c/accept.ts --name <campaign>` |
| What does a repaired checker move, and does the repair stand? | `bun tools/c/repaired.ts --log <log> --bundle <repaired pack>` |
| A report names tasks set aside on rejections: what does it read once they are labelled? | `bun tools/d2/settle.ts <the campaign's flags> --session <id>`, then label the rejections it draws |
| Which sessions ran, from which parent, with which reading? | `bun tools/wri/wri.ts read --log <log>`, row F and the `CHAIN` line |
| Did a promotion climb, beside the campaigns that ran the same pack, and did one campaign's `/tmp` reach another's solves? | `bun tools/wri/wri.ts climb --log <log> --with <log>,<log>`: one row a campaign, then each solve that named what another campaign's session left |

## The procedure

Six steps, one command each. Every step writes into one investigation directory, `<dir>`, under the
ignored `.ana/wri/<date>-<campaign>/`. Do not start a step until the check named for the one before
holds.

1. **Start.** `wri.ts start --log <log> --out <dir>` folds the log into the six rows and the
   triggers, writes them to `<dir>/overview.md`, and writes `<dir>/shared-instructions.md` with the
   campaign's row filled in and two sections left blank. When the campaign promoted a harness and
   other campaigns ran the same pack, name their logs with `--with <log>,<log>`: lane 31 is given
   each as `read` prints it, read again when the lanes are built, and compares with them.
   A campaign another machine holds is read from a copy: `bun --env-file=.env.runs run runs fetch
   <name>` takes its folder whole to `.ana/fetched/<host>/<name>/` and prints the log to give
   `--log`. Lanes read the copy with this checkout's tree, so check out the commit the receipt
   names where the host line says the code differs.
   *Check:* read the last line it prints. When the last condition ran under another host hash than
   this checkout's, every statement about source is about another tree: check out the tree that ran,
   or say so in the orientation. Then settle rows A to F yourself, from the log.
2. **Edit the shared instructions.** Write the two blank sections: the orientation, which is the
   operator's question, and the moved variable with its prior state.
   *Check:* no `##` section is blank, and the hard rules are still there.
3. **Build the lanes.** `wri.ts lanes --out <dir>` writes one prompt per lane under `<dir>/lanes/`
   and `<dir>/launch.json`, one session for each lane it built. With no `--lanes` it opens every
   lane a trigger started and the four standing lanes. It builds no isolated lane: it names the
   ones whose trigger fired, and each waits on another lane's report. A prompt built before is
   kept, never rebuilt under a report written against it, and is in no later `launch.json`.
   *Check:* exit 0, and count the sessions: that is the spend.
4. **Launch.** `launch.json` is a [codex-luna-swarm](../codex-luna-swarm/SKILL.md) manifest:
   `luna-sessions.ts --manifest <dir>/launch.json --output-dir <new dir> ...` on the model the
   operator chose. A Claude session is handed its row's `task`, one line, and nothing else; start
   them all in one message.
   *Check:* read the model each transcript recorded before using its report.
5. **Collect.** `wri.ts collect --out <dir>` holds every expected report to its shape and writes
   `<dir>/reports.md`. Read lane 4's report, then decide lane 5; read lanes 11, 15 and 18, then
   decide lane 19. Build either with `wri.ts lanes --out <dir> --lanes 5`, launch the one lane it
   says it built, alone, and collect again.
   *Check:* `collect` exits 0. It exits 1 while a report is missing or invalid.
6. **Synthesise.** `wri.ts synthesis --out <dir>` renders `<dir>/synthesis-prompt.md`; one session
   writes `<dir>/synthesis.md`, and the primary adjudicates it ("Adjudicating" below).
   *Check:* every consequential claim is marked as checked against the log or as resting on one
   report.

### Commands

Each runs as `bun tools/wri/wri.ts <verb>` from the checkout. The usage block at the head of
`tools/wri/wri.ts` is the source.

| step | command | writes |
| --- | --- | --- |
| — | `read --log <log>` | nothing: the rows, the triggers and the host line, printed |
| 1 | `start --log <log> --out <dir>` | `overview.md`, `shared-instructions.md`, `investigation.json` |
| 3 | `lanes --out <dir> [--lanes 1-4,7]` | `lanes/NN-prompt.md`, `launch.json` |
| 5 | `collect --out <dir>` | `reports.md` |
| 6 | `synthesis --out <dir>` | `synthesis-prompt.md` |
| lanes 1, 5 | `grade --log <log> [--bundle <pack>] --task <taskId> --answer <file>` | nothing: one verdict line. `--bundle` names a stored pack; a campaign that drafted its exam names none |

One investigation reads one campaign. Two campaigns of one pack, one under a checker and one under
its repair, are read apart, and lane 6 of the later one joins them.

## Sizing

One session reads one lane. A campaign with one round opens about fifteen; a campaign with no report
opens the instrument and task lanes its triggers started and nothing else. When the budget is
smaller than the build, read the groups in this order, because each rests on the one before:

1. **The instrument (1 to 6).** A comparison counts verdicts. Until the refusals read sound, a win
   may be the check refusing the parent's right answer. Lane 4 first.
2. **The comparison (20 to 25).** Whether the pairs are pairs, how the scored set was chosen and
   what the test could show at its size. Lanes 21 and 22 first.
3. **The harness (13 to 19).** What changed and whether it could know the exam. Lane 18 first.
4. **The tasks (7 to 12), the solve (26 to 28), the review loop (29 to 30).**
5. **The climb (31).** Once a promotion is on record, open it before a person is told the campaign
   improved a harness: it reads what the promotion rested on and what followed, and it rests on
   lanes 13, 19, 22 and 25 where they ran.

`--lanes` takes whatever is asked for. A lane named without its trigger opens and is told so by its
own overview, except an isolated lane, which is refused without its trigger.

## Hard rules

### In every lane prompt

[The preset](references/shared-instructions.template.md) carries these in their own section, so an
edited copy keeps them unless the primary deletes them on purpose.

- **Quote nothing the walls keep apart.** No task's text, answer or hidden value, no check's failure
  text, no prompt, no passage of a trace, no reviewer's prose. A lane session reads all of them in
  the log; its report is read by people and sessions that may not. Event kinds, solve ids, digests,
  check ids, counts, paths and line numbers only.
- **Never write under the campaign's folder, and never append to a log.**
- **Start no solve, session, round or check run.** `wri.ts grade` is the one exception, where a lane
  names it.
- **Write the report early, and append.**
- **Stay independent.** No lane opens another's prompt or report.
- **Read source in the checkout the campaign's row names**, and say when it is not the tree that ran.

### For the primary

- **Settle rows A to F yourself.** They are the identities every finding binds to, and no session
  repeats them.
- **Isolated lanes run alone.** Lanes 5 and 19 freeze a result before they read anything that could
  lead it, so neither is given the orientation, the moved variable or another lane's trigger.
- **No report reaches a Builder, an Examiner or a Referee.** Lane 19 reads traces of
  scored tasks, and several lanes read hidden values: a finding handed to a session that writes the
  harness or the tasks is the leak lane 18 looks for.
- **A `pack/` finding is a decision, never a patch.** No session of v2 writes or repairs a check.
  The finding goes to the checker's owner, and a repair is another campaign (`accept.ts --freeze`,
  `repaired.ts`, `carry.ts`).
- **Verify every session's model from its transcript** before using its report.

## Editing the shared instructions

`<dir>/shared-instructions.md` is the text every open lane carries, whole, and the synthesis carries
it too. HTML comments are dropped when prompts are built, a `##` section left blank refuses `lanes`,
and deleting a heading drops its section on purpose.

| section | written by | for |
| --- | --- | --- |
| Orientation | the primary | the operator's question and where its evidence is, never the answer expected |
| The moved variable and prior state | the primary | what changed since the campaign before, the earlier findings this one checks and what would falsify each; "none" when nothing moved |
| Campaign under review | `start` | the campaign, its log, its size, the checkout and the host line |
| Hard rules | the preset | the rules above |

A lane told what to find finds it. An earlier diagnosis goes under the prior state as a hypothesis,
never under the orientation as a premise.

## Adjudicating

[The synthesis template](references/synthesis.template.md) owns what the note owes: the four links
for each reading, the binding constraint, one findings table, conflicts, a build plan, operator
decisions and predictions. The primary then treats the note as research.

- **Start from the operator's decision.** Usually one of: believe this step, run another round,
  repair the checker, run the Examiner again. Order the synthesis by that.
- **Read the instrument before the tally.** A rejection counts only once it is ruled a true fail.
  In a simulated campaign a too-strict check gave 6 wins to 0 and a `step`; the same campaign
  under the repaired check gave 1 win and `no-step`. A comparison now sets a task aside on a
  rejection ruled a check defect or unclear, or ruled by nobody, and its report holds the tally
  were those rejections to stand (`counted`). Only a person's labels settle it
  (`tools/d2/settle.ts`), and the settled report says what was labelled, disputed and restored.
  An investigation proposes that reading; it never makes it.
- **Read `not-scored` and an empty `no-step` as no test.** A comparison that tallied no task says
  nothing of its harness. Row D's count of held-out tasks, and lane 8's of those waiting for a
  label, say whether the next one can do better.
- **Keep the observation apart from the cause.** "Forty of fifty-five refusals name one check" is an
  observation; "the check is too strict" and "the solver cannot do it" are two causes, and lane 5 is
  what separates them.
- **Recount.** Every "N of M" the synthesis leans on is recounted from the log's events.
- **Say whose reading a count is.** A ruling is the Referee's. Its agreement with a person is
  unmeasured until hand labels exist.
- **Confirm against the stack's head.** Before a `patch` row becomes work, check that the defect
  still stands at the top of the open stack, and put the fix in a new PR on that top.

## What the first real pair measured

The catalogue was tuned on two simulated campaigns. The first real ones it read are the two packs
opened at `ae66f1d` on 10 October and stopped forty minutes in, one with 12 practice solves and one
with none; 15 lane reports, 14 of them carrying a finding. They answer the three things that were
provisional and add two the catalogue did not know to ask.

- **The thresholds all sit outside the range a real campaign produced.** Over 12 solves at an
  8-minute wall the longest took 273 s, 57% of its wall, and the shortest 49 s, 10.3%, so the
  wall-bound cut at 95% and the quick cut at 5% each fired on nothing — the fastest real pass is
  twice the quick cut, because a solve that loads a harness and runs an engine costs about fifty
  seconds here. The silence of twenty minutes against a Builder session's 62 turns: its longest gap
  was 4.6 minutes; since 10 October `LONG SILENCES` reads a gap against five of the campaign's own
  median solve, with a floor of ten minutes, and names what ran through it. All three were
  therefore untested, and the quick cut reads better against a campaign's own median solve than
  against its wall. Whether a round has too few informative pairs
  is no threshold: the trigger asks the report's own test whether any result with a loss could have
  cleared its level.
- **No conditional trigger over-fired; one could not fire where it mattered most.**
  `SPEND LED BY A ROLE` fired on neither cut session, because `spendOf` read ending records alone and
  a stop leaves none — with the turns counted (open #150) it fires and names the Builder. Every
  trigger that did fire opened a lane that returned a finding, the ones carrying opening counts
  included. What fired with half its method missing was a standing lane, not a trigger: lane 1 opened
  on the campaign with no pass, where the sample of passes cannot be taken. Its other half, the
  check rows beside the brief, is readable without a pass, and the lane's own text should say so.
- **The standing lanes hold.** 15, 18 and 22 each returned a finding on both campaigns, and lane 1
  on the one with solves found what the whole investigation turned on: the harness being measured
  judged the answers its own solver submitted.
- **A held-out task set opens no lane.** Both campaigns held 3 of their pack's 6 tasks for a
  comparison and released 3, and no trigger of link (b) — the task set, lanes 7 to 12 and 21 — fired
  on either, so every task-set count in both syntheses is the primary's own recount. A campaign
  stopped before its first comparison is where the draw and the held set are most worth reading.
- **A lane's reading can be refused as content.** Lane 1 reads the pack's own brief beside the check
  rows, and on one pack that reading was refused; the arithmetic half — rows, instrument tokens,
  passed and refused counts — reads without the brief. That lane wrote `could not read`, which
  `collect` accepts, and no retry recovered it.

## Where the detail lives

| file | owns |
| --- | --- |
| [references/lanes.md](references/lanes.md) | the stance, the owner table, rows A to F and lanes 1 to 31 |
| [references/from-v1.md](references/from-v1.md) | what became of v1's nine rows and thirty-eight lanes, and what that says about v2's direction |
| [references/shared-instructions.template.md](references/shared-instructions.template.md) | the preset every open lane carries |
| [references/synthesis.template.md](references/synthesis.template.md) | the synthesis session's prompt |
| `tools/wri/read.ts` | the fold of a log into rows and triggers |
| `tools/wri/catalogue.ts`, `tools/wri/investigation.ts`, `tools/wri/wri.ts` | the catalogue's parser, the prompts and the report check, and the verbs |

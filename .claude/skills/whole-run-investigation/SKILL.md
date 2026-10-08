---
name: whole-run-investigation
description: "Investigate one Anabasis v2 campaign from its log and turn what it shows into findings with one owner each. Answers whether a round's reading (step, no-step, not-tested) may be believed, whether a fail was the solver's or the exam's, whether the harness could know the exam, whether the tasks bracket the solver, whether the campaign is climbing, and where the hours and dollars went. Reads evidence; starts no solve, session or round, and changes no verdict."
---

# Whole-Run Investigation

A whole-run investigation (WRI) reads one campaign: its log, the check program staged beside it and
the harness states it kept, against the question the operator asked. It ends in one adjudicated
synthesis that says whether each reading may be believed, what limited it, and which owner each next
change belongs to. It reads and proposes. It starts no solve, no session and no round, it appends to
no log, and the host's verifier stays the one owner of every verdict.

It is v1's skill rebuilt for v2. v1's catalogue had nine rows and thirty-eight lanes and was written
from one fact: the Builder wrote its own exam. v2 took that pen apart, so the catalogue here has six
rows and thirty lanes: eleven of v1's kept with tuning, nine overhauled, ten new, and thirteen
removed with the machinery they read. [from-v1.md](references/from-v1.md) accounts for every one.

Five narrower questions need no lanes. Start there when one of them is the whole question.

| question | command |
| --- | --- |
| Is a run alive, and what did it last do? | `bun run runs pulse` |
| Is there enough supply for a round? | `bun tools/d1b/supply.ts --log <log>` |
| Does the checker stand on its controls and the stored answers? | `bun tools/c/accept.ts --name <campaign>` |
| What does a repaired checker move, and does the repair stand? | `bun tools/c/repaired.ts --log <log> --bundle <repaired pack>` |
| Which sessions ran, from which parent, with which reading? | `bun tools/wri/wri.ts read --log <log>`, row F and the `CHAIN` line |

## The procedure

Six steps, one command each. Every step writes into one investigation directory, `<dir>`, under the
ignored `.ana/wri/<date>-<campaign>/`. Do not start a step until the check named for the one before
holds.

1. **Start.** `wri.ts start --log <log> --out <dir>` folds the log into the six rows and the
   triggers, writes them to `<dir>/overview.md`, and writes `<dir>/shared-instructions.md` with the
   campaign's row filled in and two sections left blank.
   *Check:* read the last line it prints. When the last condition ran under another host hash than
   this checkout's, every statement about source is about another tree: check out the tree that ran,
   or say so in the orientation. Then settle rows A to F yourself, from the log.
2. **Edit the shared instructions.** Write the two blank sections: the orientation, which is the
   operator's question, and the moved variable with its prior state.
   *Check:* no `##` section is blank, and the hard rules are still there.
3. **Build the lanes.** `wri.ts lanes --out <dir>` writes one prompt per lane under `<dir>/lanes/`
   and one entry per session in `<dir>/launch.md`. With no `--lanes` it opens every lane a trigger
   started and the four standing lanes. It builds no isolated lane: it names the ones whose trigger
   fired, and each waits on another lane's report.
   *Check:* exit 0, and count the entries: that is the spend.
4. **Launch.** Start one session per `launch.md` entry, all in one message, on the model the
   operator chose, handing each its one line and nothing else.
   *Check:* read the model each transcript recorded before using its report.
5. **Collect.** `wri.ts collect --out <dir>` holds every expected report to its shape and writes
   `<dir>/reports.md`. Read lane 4's report, then decide lane 5; read lanes 11, 15 and 18, then
   decide lane 19. Build either with `wri.ts lanes --out <dir> --lanes 5`, launch it alone, and
   collect again.
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
| 3 | `lanes --out <dir> [--lanes 1-4,7]` | `lanes/NN-prompt.md`, `launch.md` |
| 5 | `collect --out <dir>` | `reports.md` |
| 6 | `synthesis --out <dir>` | `synthesis-prompt.md` |
| lanes 1, 5 | `grade --log <log> --bundle <pack> --task <taskId> --answer <file>` | nothing: one verdict line; Mac only |

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
- **No report reaches a Builder, an Examiner, a Referee or a Diagnoser.** Lane 19 reads traces of
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
- **Read the instrument before the tally.** A reading whose refusals were ruled a check defect and
  still counted is not a reading yet. In a simulated campaign a too-strict check gave 6 wins to 0
  and a `step`; the same campaign under the repaired check gave 1 win and `no-step`. A report with
  flagged tasks holds both readings, `reading` and `unflagged.reading`: where they differ, the
  flagged fails are read by hand before either is believed.
- **Read `not-scored` and an empty `no-step` as no test.** A round that scored no task says
  nothing of its harness. Row D's count of tasks held outside the anchor says whether the next
  round can do better.
- **Keep the observation apart from the cause.** "Forty of fifty-five refusals name one check" is an
  observation; "the check is too strict" and "the solver cannot do it" are two causes, and lane 5 is
  what separates them.
- **Recount.** Every "N of M" the synthesis leans on is recounted from the log's events.
- **Say whose reading a count is.** A ruling is the Referee's. Its agreement with a person is
  unmeasured until hand labels exist.
- **Confirm against the stack's head.** Before a `patch` row becomes work, check that the defect
  still stands at the top of the open stack, and put the fix in a new PR on that top.

## What is not yet known

This catalogue has read two simulated campaigns and no real one. v1's was tuned over many runs.
Three things are therefore provisional, and the first real investigation should report on each:

- **The thresholds.** A miss is wall-bound at 95% of its wall, a pass is quick under 5%, a silence
  is twenty minutes. The first two are v1's; the third is an estimate. Whether a round has too few
  informative pairs is no threshold: the trigger asks the report's own test whether any result with
  a loss could have cleared its level.
- **Which triggers over-fire.** Some fire whenever their events exist, by design, because they
  carry a lane's opening counts: `PASSES UNREAD`, `TOOLS CALLED`, `ADMITTED BY`, `CHAIN`,
  `WALL SHARE`. If the conditional ones fire on every campaign too, they start lanes with nothing
  to read.
- **The standing lanes.** 1, 15, 18 and 22 open on every report. That choice follows v1's finding
  that the open questions of a compared harness are the pass nobody read, the tool that judges, the
  leak and the test's size.

## Where the detail lives

| file | owns |
| --- | --- |
| [references/lanes.md](references/lanes.md) | the stance, the owner table, rows A to F and lanes 1 to 30 |
| [references/from-v1.md](references/from-v1.md) | what became of v1's nine rows and thirty-eight lanes, and what that says about v2's direction |
| [references/shared-instructions.template.md](references/shared-instructions.template.md) | the preset every open lane carries |
| [references/synthesis.template.md](references/synthesis.template.md) | the synthesis session's prompt |
| `tools/wri/read.ts` | the fold of a log into rows and triggers |
| `tools/wri/catalogue.ts`, `tools/wri/investigation.ts`, `tools/wri/wri.ts` | the catalogue's parser, the prompts and the report check, and the verbs |

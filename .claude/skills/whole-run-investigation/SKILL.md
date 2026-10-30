---
name: whole-run-investigation
description: "Investigate one campaign or several together from their logs, producing findings with named owners. Use for a run audit, a stalled climb, unexpected failures or doubts about a reading (step, no-step, not-scored). Examine correctness, evaluation validity, exam leakage, task difficulty, promotions, time and cost. This is read-only: start no solve, session or round and change no verdict."
---

# Whole-Run Investigation

A whole-run investigation (WRI) reads one campaign, or several as equals: each one's log, the check
program staged beside it and the harness states it kept, against the question the operator asked. It ends in one vetted
synthesis that says whether each reading may be believed, what limited it, and which owner each next
change belongs to. It reads and proposes. It starts no solve, no session and no round, it appends to
no log, and the host's verifier stays the one owner of every verdict.

The catalogue has six deterministic rows and thirty-four lanes. [from-v1.md](references/from-v1.md)
maps the earlier catalogue to this one. Lane 27 reads a promotion and the climb after it, with
every campaign under review side by side. Lane 34, standing, grades each harness version from 0 to
7 on how hard the tasks it holds are (reach) and whether its change is right for the domain
(soundness), so a climb's speed is read beside what it bought. `AGENTS.md` sections 1 to 8 own the
campaign's rules.

These narrower questions need no lanes. Start there when one is the whole question. A `wri.ts`
command's `--log` accepts a path or a campaign's whole name, as `bun run runs` does, and `start` and
`climb` take several, separated by commas.
`accept.ts` and `settle.ts` below write to the campaign and belong to their own authorised
procedures; they are not commands to run inside a read-only investigation.

| question | command |
| --- | --- |
| Is a run alive, and what did it last do? | `bun run runs pulse` |
| Is there enough supply for a comparison, and what can it show? | `bun run runs view <name>`: its set-up line and the table's move |
| Does the checker stand on fresh controls? | `bun tools/c/accept.ts <the campaign's flags>`; stored answers are reported separately |
| What does a repaired checker move, and does the repair stand? | `bun tools/c/repaired.ts --log <log> --bundle <repaired pack>` |
| A report names tasks set aside on rejections: what does it read once they are labelled? | `bun tools/d2/settle.ts <the campaign's flags> --session <id>`, then label the rejections it draws |
| Which sessions ran, from which parent, with which reading? | `bun tools/wri/wri.ts read --log <log>`, row F and the `CHAIN` line |
| Did a promotion climb, beside the campaigns that ran the same pack, and did one campaign's `/tmp` reach another's solves? | `bun tools/wri/wri.ts climb --log <log>,<log>,<log>`: one row a campaign, then each solve that named what another campaign's session left |
| How do this run's hours and dollars a promotion stand against every run of its release, pack and setting? | `.claude/skills/promotion-tuner/scripts/table.ts --rows groups` (or `--name <part> --rows promotions`): across campaigns, without `climb`'s solves |

## The procedure

Six steps. Keep the investigation's files in one directory, `<dir>`, under the ignored
`.ana/wri/<date>-<campaign>/` of the central host (`ANA_CENTRAL`), beside the cycle's files. Do not
start a step until the check named for the one before holds.

1. **Start.** `wri.ts start --log <log>[,<log>...] --out <dir>` folds each log into the six rows and
   the triggers, writes them to `<dir>/overview.md`, and writes `<dir>/shared-instructions.md` with
   each campaign's row filled in and two sections left blank. Where one question spans several
   campaigns (other domains, other hosts, other commits of one pack), name them all: they are read
   as equals. Every lane reads every campaign, opens where a trigger fired on any of them, and
   triages each finding against the others on its `Seen in:` line; lane 27 is also given their
   climbs side by side. The logs are read again when the lanes are built.
   `start` also derives each log quietly ("The readers, derived") and names its folder.
   With `bun --env-file=.env.runs tools/wri/wri.ts ... --log <name>`, a campaign on another machine
   is fetched automatically into `data/runs/<host>/<name>/`. Explicit log paths select an offline
   snapshot. `runs fetch <name>` remains available to refresh a copy explicitly. Lanes read the
   copy with this checkout's tree, so check out the commit the receipt
   names where the host line says the code differs. `lanes` rereads the paths stored by `start`;
   it does not refresh a live remote campaign behind the investigation's back. Start another
   investigation to take a new snapshot.
   *Check:* read the `host-code digest` line. Use the matching campaign tree it names, where one
   exists; otherwise say beside each source claim that it concerns another tree. The digest is
   not a commit: the launch receipt supplies the commit separately. Settle rows A to F from the log.
2. **Edit the shared instructions.** Write the two blank sections: the orientation, which is the
   operator's question, and the moved variable with its prior state.
   *Check:* no `##` section is blank, and the hard rules are still there.
3. **Build the lanes.** `wri.ts lanes --out <dir>` writes one prompt per lane under `<dir>/lanes/`
   and `<dir>/launch.json`, one session for each lane it built. With no `--lanes` it opens every
   lane a trigger started and the four standing lanes. By default it builds no isolated lane:
   it names the ones whose trigger fired for the primary to assess. A prompt built before is
   kept and excluded from any newly written `launch.json`.
   *Check:* exit 0, and count the sessions that this call built. If it built none, launch nothing:
   an earlier `launch.json` remains on disk. The count is the number of sessions to authorise,
   not a dollar estimate.
4. **Launch.** `launch.json` is a [codex-gpt-swarm](../codex-gpt-swarm/SKILL.md) manifest:
   `gpt-sessions.ts --manifest <dir>/launch.json --output-dir <new dir> ...` on the model the
   operator chose. A Claude session is handed its row's `task`, one line, and nothing else; start
   them all in one message.
   *Check:* read the model each transcript recorded before using its report.
5. **Collect.** `wri.ts collect --out <dir>` holds every expected report to its shape and writes
   `<dir>/reports.md`. Read lane 4's report, then decide lane 5; read lanes 13, 15 and 18, then
   decide lane 19, applying the `WINS` limitation below. Build lane 5 with
   `wri.ts lanes --out <dir> --lanes 5`, or lane 19 with `--lanes 19`, then launch the one lane it
   says it built, alone, and collect again.
   *Check:* `collect` exits 0. It exits 1 while a report is missing or invalid, or no report is
   expected. Review the evidence too: a valid shape does not establish a sound finding.
6. **Synthesise.** `wri.ts synthesis --out <dir>` renders `<dir>/synthesis-prompt.md`; one session
   writes `<dir>/synthesis.md`, and the primary vets it ("Vetting" below).
   *Check:* every consequential claim is marked as checked against the log or as resting on one
   report.

### Commands

Each runs as `bun tools/wri/wri.ts <verb>` from the checkout. The usage block at the head of
`tools/wri/wri.ts` is the source.

| step | command | writes |
| --- | --- | --- |
| read | `read --log <log>` | nothing: the rows, the triggers and the host line, printed |
| compare climbs | `climb --log <log>,<log>[,<log>...]` | nothing: the campaign table and shared temporary paths, printed |
| 1 | `start --log <log>[,<log>...] --out <dir>` | `overview.md`, `shared-instructions.md`, `investigation.json` |
| 3 | `lanes --out <dir> [--lanes 1-4,7]` | `lanes/NN-prompt.md`, `launch.json` |
| 5 | `collect --out <dir>` | `reports.md` |
| 6 | `synthesis --out <dir>` | `synthesis-prompt.md` |
| lanes 1, 5 | `grade --log <log> [--bundle <pack>] --task <taskId> --answer <file>` | nothing: one verdict line. `--bundle` names a stored pack; a campaign that drafted its exam names none |
| any | `derive (--log <log>[,<log>...] \| --all) [--verbose] [--force]` | `data/derived/<campaign>/`: one file a reader, and `manifest.json` |

### The readers, derived

Eight deterministic readers take one log and print what it holds (`READERS`,
`tools/wri/derive.ts`): the rows and triggers, the kept versions, the readings, the next draw, the
ending, the conditions, and what a Builder and an Examiner opening would be told. `derive` runs
them all over a log into the main worktree's `data/derived/<campaign>/`, one `<reader>.txt` each,
and replaces the folder whole where the log or the commit reading it moved since; a folder whose
log stands is kept. So the files always describe one moment of the log, the latest a pass saw.

There are two ways to use it:

- **Quiet**, the default. It prints one line: how many campaigns it derived, how many it kept and
  which readers failed. `start` runs it for its logs and names the folders in the instructions, and
  a job on the central host runs `derive --all` after each gather, so every run on every host has
  its folder while it runs and after. Read the files rather than running the readers again.
- **Verbose**, `--verbose`, for a session that wants to see everything at once: it prints every
  reader's file, under a heading naming the campaign and the reader, then the same line. It runs
  nothing a quiet pass would not; with an unmoved log it prints the folder as it stands.

`--force` derives again although nothing moved, after a reader's code changed without a commit.
The folders hold hidden values as the log does, so they stay on the exam side and out of every
prompt a seat reads.

One investigation reads one question, over one campaign or several. Two campaigns of one pack, one
under a checker and one under its repair, are read apart, and lane 3 of the later one joins them.

## Sizing

One session reads one lane, on every campaign under review: more campaigns make each session
longer, and add none. `selected` opens all four standing lanes even before a comparison
reports, alongside any triggered open lanes. Count the manifest rather than assuming a size.
When the budget is
smaller than the build, read the groups in this order, because each rests on the one before:

1. **The verdicts (1 to 8).** A comparison counts verdicts. Until the refusals read sound, a win
   may be the check refusing the parent's right answer. Lane 4 first.
2. **The comparison (21 to 25).** Whether the pairs are pairs, how the scored set was chosen and
   what the test could show at its size. Lanes 22 and 23 first.
3. **The harness (15 to 20).** What changed and whether it could know the exam. Lane 18 first.
4. **The supply (9 to 14), the solve (29 and 30), the economy (31), the runs (32) and the log (33).**
5. **The climb (26 to 28, and 34).** Once a promotion is on record, open it before a person is told the campaign
   improved a harness: it reads what the promotion rested on and what followed, and it rests on
   lanes 15, 19, 23 and 26 where they ran. Lane 34 grades every version and runs from the start.

In a release cycle the investigation shares the improvement window of twelve hours with the vetting
and the stack's patches (run-improvement-campaign, "The improvement window"): launch every lane at
once, and synthesise from the reports in hand rather than wait past the window for a lane that
failed.

`--lanes` takes whatever is asked for. A lane named without its trigger opens and is told so by its
own overview. An isolated lane is refused without its trigger. The tool permits named isolated
lanes in one selection, so the primary must build and launch each alone.

### Report checks

`reportOf` accepts `finding`, `no finding` and `could not read`. It checks the lane heading,
equal counts of lines beginning `Observation:`, `Cause:`, `Owner:`, `Reverses if:` and `Decision:`,
a written finding for a `finding` verdict, no finding fields for a `no finding` verdict, and an
owner from the catalogue. It does not check the cited evidence or enforce exactly one owner.

- `reporting` gives a `no finding` verdict its own `## Checked` section, which says what the lane
  checked and found sound, with `## Findings` left empty. The collector does not read that section,
  so read it before accepting the verdict: an empty one leaves the lane unsubstantiated.
- `WINS` lists lane 19's solve ids and starts nothing by itself (`selected`). Lane 19 runs alone:
  it opens only where it is named and `WIN AT A SMALL WALL SHARE` or `ANSWER FROM A PROGRAM` fired.

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
- **Open the report early and append findings as they hold**; write a verdict only once its evidence
  is read.
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
- **A `pack/` finding is a decision, never a patch.** No seat repairs a campaign's check program.
  The finding goes to the checker's owner, and a repair is another campaign (`accept.ts --freeze`,
  `repaired.ts`, `carry.ts`).
- **Verify every session's model from its transcript** before using its report.

## Editing the shared instructions

`<dir>/shared-instructions.md` is the text every open lane carries, whole, and the synthesis carries
it too. Isolated lanes receive only its campaign and hard-rule sections, the deterministic rows,
their own triggers, the catalogue's stance and owner table, their lane and the reporting rules.
HTML comments are dropped when prompts are built, a `##` section left blank refuses `lanes`,
and deleting a heading drops its section on purpose.

| section | written by | for |
| --- | --- | --- |
| Orientation | the primary | the operator's question and where its evidence is, never the answer expected |
| The moved variable and prior state | the primary | what changed since the campaign before, the earlier findings this one checks and what would falsify each; "none" when nothing moved |
| Campaigns under review | `start` | each campaign, its log, its size, the checkout and its host line |
| Hard rules | the preset | the rules above |

A lane told what to find finds it. An earlier diagnosis goes under the prior state as a hypothesis,
never under the orientation as a premise. Where the campaigns belong to a release cycle, the prior
state lists every row of the cycle's `Predictions.md` as a hypothesis: its pull request, its
area labels ("Labels" in [the catalogue](references/lanes.md)), lanes, claim and falsifier,
without the ledger's resolution. Step 3 opens every lane a row names with
`--lanes`, triggered or not, since a row whose lanes never opened has no report to backtrack from.
Lanes 5 and 19 stay isolated: no row names them, and they are given no row.

## Vetting

[The synthesis template](references/synthesis.template.md) owns what the note owes: the four links
for each reading, the binding constraint, one findings table, conflicts, a build plan, operator
decisions and predictions. The primary then treats the note as research, in two acts kept apart:

- **Triage** sorts each finding by kind and owner (host defect, pack, operator decision,
  prediction, already changed at the head) and checks nothing.
- **Vetting** checks a finding against the logs, the source at the head and, where it names them,
  the kept harnesses and the check program, then rules it **confirmed** (recounted or read here),
  **plausible** (resting on one lane's report) or **refuted**.

Vet every finding, and above all every one that would change code or a decision. Write the result
as `<dir>/vetting.md`, one row a finding with its verdict and what was checked, and never report a
finding that was only triaged as vetted. On 22 October eight of thirteen findings were first
reported as adjudicated after triage alone.

**Backtrack the predictions before the synthesis's own findings.** Where the campaigns belong to a
release cycle, `vetting.md` opens with one row for each row of the cycle's `Predictions.md`, and
of its `cycle.md`:

- **Resolve it from the logs.** Mark it held, falsified or unreached, with the count recounted here
  from the events the row names. The reports of the lanes the row names are read first, as leads.
  A resolution already in the ledger, a lane's report or the synthesis is a lead to recount, never
  the evidence.
- **Name the evidence.** Say whether an event shows the pull request's mechanism ran in these runs
  (`AGENTS.md`, section 9). A held row whose mechanism never ran held by chance, and is
  unreached for its pull request.
- **Treat a falsified row as a finding.** Triage it to one owner (the pull request's code, the
  prediction's reasoning, or the run's condition), then vet it like every other finding. A
  confirmed one becomes a row of the cycle's plan.
- **Carry an unreached row forward.** Say why its trigger never came. Its pull request is still
  unmeasured, and the row goes into the next cycle's `Predictions.md`.

A finding of the synthesis that bears on a prediction names that row. The step's check: `vetting.md`
holds as many prediction rows as the two ledgers do. Beside the rows, count them by label: held,
falsified and unreached for each area label, which shows where the cycle's changes were measured
and where they still wait.

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
  nothing of its harness. Row D's count of held-out tasks, and lane 10's of those waiting for a
  label, say whether the next one can do better.
- **Keep the observation apart from the cause.** "Forty of fifty-five refusals name one check" is an
  observation; "the check is too strict" and "the solver cannot do it" are two causes, and lane 5 is
  what separates them.
- **Recount.** Every "N of M" the synthesis leans on is recounted from the log's events.
- **Say whose reading a count is.** A ruling is the Referee's. Its agreement with a person is
  unmeasured until hand labels exist.
- **Confirm against current source.** Before a `patch` row becomes work, check that the defect
  still stands. Follow `AGENTS.md` section 11 and `stack-pr` for its branch and PR.

## Where the detail lives

| file | owns |
| --- | --- |
| [references/lanes.md](references/lanes.md) | the stance, the owner table, rows A to F and lanes 1 to 34 |
| [references/from-v1.md](references/from-v1.md) | what became of v1's nine rows and thirty-eight lanes, and what that says about v2's direction |
| [references/shared-instructions.template.md](references/shared-instructions.template.md) | the preset every open lane carries |
| [references/synthesis.template.md](references/synthesis.template.md) | the synthesis session's prompt |
| `tools/wri/read.ts` | the fold of a log into rows and triggers |
| `tools/wri/catalogue.ts`, `tools/wri/investigation.ts`, `tools/wri/wri.ts` | the catalogue's parser, the prompts and the report check, and the verbs |

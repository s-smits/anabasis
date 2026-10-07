---
name: whole-run-investigation
description: "Investigate a live, stalled or completed Anabasis run and turn findings into an evidence-bound fix proposal. Also answers whether a campaign is climbing: how the climb is going, whether the batteries are getting harder, why a difficulty decision keeps repeating, how to climb faster, why the controller chose its action. Also the narrow read: reviewing one campaign run or recorded case through its outcomes, whether a live run is still producing useful evidence. Reads evidence; does not launch the next experiment or stop a run."
---

# Whole-Run Investigation

A whole-run investigation (WRI) reads one or more recorded runs, their openings, epochs, batteries,
claims, reviews and the source each was launched from, against the question the operator asked. It
ends in one adjudicated synthesis that says what each run showed, what limited it and which owner
each next change belongs to. It reads and proposes. It launches no run, stops none and changes no
score: `run-improvement-campaign` chooses the next experiment, `launch-run` starts or stops a run,
and the host verifier stays the one owner of every pass.

Four narrower questions need no lanes, so start there when they are the whole question. One run or
one case, its denominators, a non-result's owner or whether a live run still earns its spend, is
[the outcome reference](references/outcome-review.md). Whether a campaign is climbing is
[the climb reference](references/climb.md). Whether a refusal or a check earns its place is
[the gate audit](references/gate-audit.md). Whether a new wave of runs beat the one it replaced is
[wave-audit](../wave-audit/SKILL.md).

## The procedure

Seven steps, one command each. Every step writes into one investigation directory, `<dir>`, which
goes under `notes/wri-YYYYMMDD/` in the main checkout (ignored, never published). Do not start the
next step until the check named for this one holds.

1. **Start.** `wri.ts start <run> [<run> ...] --out <dir>` reads every named run the way `read`
   always has: it resolves each run's own measured checkout, runs the deterministic readers into
   `<dir>/<run-short>/` and prints one bounded brief per run (size, tier, triggers, the lanes they
   start). It also writes one editable `<dir>/shared-instructions.md` from the preset, with the run
   table filled in and the authored sections left as marked blanks.
   *Check:* each brief printed with no `== SNAPSHOT INCOMPLETE` you have not accounted for, and the
   exit status is 0. Read the briefs, not the lane captures.
2. **Edit the shared instructions.** Fill the blanks in `<dir>/shared-instructions.md`: the
   orientation, which is the operator's question, and the moved variable with its prior state. Edit
   any other section the investigation needs ("Editing the shared instructions" below).
   *Check:* no blank authored section remains, and the hard-rules section is still there.
3. **Build the lanes.** `wri.ts lanes --out <dir>` builds every run's lane prompts, composes them
   into groups for the readings you ask for and writes `<dir>/launch.md`, one row per agent: the
   prompt path, the report path, the exact one-line Agent prompt and the transcript model check.
   *Check:* exit status 0. It refuses a blank authored section and any group that lost the shared
   instructions, so a non-zero exit is the defect, not noise. Count the rows: that is the spend.
4. **Launch.** Start one subagent per `launch.md` row, all in one message, on the model the operator
   chose, handing each the row's one-line prompt and nothing else.
   *Check:* run each row's model check against the agent's transcript before trusting its report.
5. **Collect.** `wri.ts collect --out <dir>` validates every expected report as ok, missing or
   invalid, writes `<dir>/reports.md` and says which readings are complete.
   *Check:* every reading you will synthesise is complete. A cross-run reading reads the per-run
   reports, so build and launch it (step 3 with `--readings cross-run`) only after the per-run
   reading collects complete.
6. **Synthesise.** `wri.ts synthesis --out <dir>` renders `<dir>/synthesis-prompt.md` from the
   reports index; one agent writes `<dir>/synthesis.md`. The primary then adjudicates it against
   source ([the synthesis reference](references/synthesis.md) says what it must contain).
   *Check:* every consequential claim re-checked against the bytes or marked as resting on one report.
7. **Finish.** `wri.ts finish --out <dir>/<run-short>` scaffolds and validates the per-run archive
   when one is wanted, and the note goes beside it.
   *Check:* the archive validator exits 0; read its exit status directly, never through a pipe.

### Commands

Each script runs as `bun .claude/skills/whole-run-investigation/scripts/<script>` from the review
checkout, and the reader verbs as `bun run runs`. This table is the one place their usage is
written; the references point here.

| step | command | writes |
| --- | --- | --- |
| 1 | `wri.ts start <run> [<run> ...] --out <dir> [--preset <name>]` | `<dir>/<run-short>/` per run; `<dir>/shared-instructions.md` |
| 3 | `wri.ts lanes --out <dir> [--lanes <list> \| --tier] [--agents N \| --components K] [--readings per-run,cross-run,multi-run]` | lane and group prompts; `<dir>/launch.md` |
| 5 | `wri.ts collect --out <dir>` | `<dir>/reports.md` |
| 6 | `wri.ts synthesis --out <dir>` | `<dir>/synthesis-prompt.md` |
| 7 | `wri.ts finish --out <dir>/<run-short>` | `<dir>/<run-short>/archive/` |
| — | `wri.ts scope <target>`; `wri.ts read <target> --out <review> [--lanes …]`; `wri.ts brief --out <review>` | a run's size; the deterministic read alone; the brief again |
| — | `bun run runs delta \| climb \| yield \| timeline \| walls \| handoff \| gates \| target <target> [--json] [--out <abs>]` | one reader's view |
| — | `wri.ts census [--json]`; `validate-archive.ts --archive <abs dir>` | the cross-run gate census; an archive check |

A target is a campaign folder, its `controller/<runId>` folder or any selector `bun run runs show`
takes. Resolve "the latest truss run" with `bun run runs list --closed 30`, newest first; a selector
naming several runs is refused. `--preset` names another template file in place of the shipped
`references/shared-instructions.template.md`. `--lanes` names lanes; `--tier` takes what each brief
chose, the triggered lanes plus the tier's standing lanes
([the session index](references/session-index.md#tiers) owns the tiers). `--agents N` fixes the
number of agents; `--components K` caps each agent at K lanes times runs. Pass every option as its
own word on the command line: an option list held in a zsh variable reached the builder as one
argument and it built nothing, silently.

## Three readings, and how to size them

The three readings answer different questions, and they proved most useful together on 2026-10-07.

- **Per-run** (depth). Each agent reads a few lanes in one run, straight from that run's records.
  This is the reading for a single run, and the base for the cross-run reading.
- **Cross-run** (reconciliation). Each agent takes one lane group's per-run reports across the
  runs, checks the other runs' bytes itself, and sorts each finding as holding in every run
  (`every`), checked and absent (`absent`), or undecidable from the other records (`unsaid`). It
  counts how far a controller-owned mechanism recurs over the recorded corpus, reconciles with any
  earlier owner table, and ends each finding in a typed outcome (`patch`, `decision`, `prediction`
  or `drop`). Use it whenever two or more runs were read per-run.
- **Multi-run** (width). Each agent reads one lane group across all named runs straight from the
  records, without opening the per-run or cross-run reports. It trades depth for an independent
  angle, and agreement with the other readings counts only because it was reached alone. Use it when
  the operator asks which mechanisms recur, or when a finding's generality decides the fix.

An agent's load is lanes times runs. Three lanes over three runs (nine) is the most one agent has
carried well; two over two and two over four are as valid, and a group of eight lanes or more on one
run thins every report. Lanes that read the same bytes are grouped by theme
(`references/lane-groups.json`), lanes 7, 23, 29 and 30 always run alone in their own agent, and
`lanes` composes them that way without being told. The details, including what each report must
contain, are in [running the lanes](references/running-lanes.md).

## Hard rules

### In every lane prompt

The preset carries these in their own section, so an edited copy keeps them unless the primary
deletes them on purpose. Each was learned from a failure.

- **Never quote campaign text.** No task, request, prompt, brief, review, finding, advice, Builder
  or trace text, and no domain text, from any campaign record, in the report or in terminal output.
  Report counts, ids, digests, paths and line numbers, and describe mechanisms in your own words. A
  safety classifier stopped replies twice for quoting records of a biology domain.
- **No git command inside a campaign workspace.** Even `git status` writes a lock file there.
- **Never run a tool whose working directory is inside `campaigns/`.** A chemistry solver run there
  left a log in a campaign root. Run it from the session's own scratch.
- **Write the report early, and append** as each finding settles, so a stopped agent leaves work.
- **Stay independent.** Do not open another reading's reports. The cross-run reading reads the
  per-run reports by design, and nothing else.
- **Read source at the run's own commit**, in the checkout the run table names, never in the main
  checkout.

### For the primary

- **Verify every agent's model from its transcript** before using its report. Omitting `model`
  inherits the primary's; the alias `opus` once resolved to a model the operator had rejected.
- **Keep at most two investigations active at once**, counting runs under review rather than
  lanes. With several, finish reading one and launch its lanes before turning to the next.
- **Isolated lanes run alone.** Lane 23 alone receives the private trace packet, and lanes 7 and 30
  freeze their result before reading any verifier internals or another report, so none of the three
  is given the shared instructions or another lane's output. Lane 29 also runs alone, because it owns
  a scratch directory.
- **Settle rows A to I yourself.** The nine deterministic rows of
  [the catalogue](references/review-angles.md) are the identities every finding binds to, and no
  subagent repeats them.
- **Publish nothing protected.** No verifier output, counterexample, reference artifact or
  per-task failure location reaches a note, a Builder, a Judge or an authoring prompt.

## Editing the shared instructions

`<dir>/shared-instructions.md` is the text every lane prompt opens with, copied from the preset
`references/shared-instructions.template.md` with the runs filled in. Edit the copy when the change
belongs to this investigation, which is nearly always. Edit the preset only when every future
investigation should read the change, and then in its own commit with the skill. Its sections:

| section | written by | for |
| --- | --- | --- |
| identity and authority | `start` | who the lane is, read-only, which checkouts and runs |
| runs under review | `start` | per run: id, campaign, review dir, source commit and checkout, terminal, batteries |
| run overview | `start` | per run: recorded facts and the triggers the deterministic read raised |
| orientation | the primary | the operator's question, as facts a lane can check, never the answer you expect |
| moved variable and prior state | the primary | what changed between this run and its baseline, and what earlier readings found, as hypotheses |
| hard rules | the preset | the rules above; delete one only deliberately |
| reporting rules | the preset | report path and shape, owners, piles and outcomes |

Write the orientation as a question and its checkable facts. A lane told what to find finds it, so
an earlier diagnosis goes under the prior state as a hypothesis, never under orientation as a premise.
[Running the lanes](references/running-lanes.md#editing-the-shared-instructions) has the detail.

## The stance

**Who held which pen.** A battery is the Builder's own exam. The Builder wrote the tasks and their
limits, the checks that decide each pass, the controls that calibrate the checks, the reference that
proves each task feasible, and the solver's tools, guide and walls. The host verifier owns the
verdict in the sense that nothing else may set it, but the property it tests is whatever the
Builder's check reads. So a pass can mean an easy task, a check that observes too little, or both,
and a perfect battery cannot tell them apart. Weigh each verdict by how much of it the Builder did
not write, name the tool bytes that decided it, keep verified, unaccepted and non-result cases
apart, and read a Judge agreement as a second reading of the Builder's own rules. Lanes 31 to 38
exist for exactly this. The authoring Epoch Review runs during the round, before the battery (each
submit waits on `AuthoringReviews.join`), and a battery review runs after it: read both.

**Distrust the reader.** Every figure reaches the synthesis through a reader, and readers have
reported things other than what their names say. Name the reader behind each number and check it
against one join it did not make. Resolve the campaign from `opening.json`, never the reverse,
because neighbouring numeric suffixes can hold runs of the same request; resolve every path to its
real location, because `ana-run-*` trees reach `campaigns` through a symlink; recount any `n` that
folded unaccepted cases (`pass: false`) into the verified ones. A trigger that did not fire says the
arithmetic found nothing, not that the property is absent. A lane report is research until its
consequential claim has been checked against the exact source and the consumer that ran. An
earlier note's conclusion enters as a hypothesis for a lane, never as its premise.

## What went wrong last time

Only what changes the next decision is kept here; the rest is fixed in the tools.

- **Reports quoting records were stopped.** Two replies were cut off by a safety classifier for
  quoting a biology domain's records. The rule is now in the preset; keep it there.
- **An isolated lane in the same build stripped the shared instructions from every group**, and an
  option list passed through a shell variable built nothing. `lanes` now refuses the first; pass
  options as separate words to avoid the second.
- **A lane's counts were taken as fact.** One lane quoted a review-incompleteness ratio the rows did
  not hold. Recount every "N of M" the synthesis leans on from the recorded rows.
- **A verified fail was read as a wrong answer** before anyone asked whether the failing rule's
  published sentence admits the reading the evaluator refused. Lane 38 reads that; when lane 7 did
  not run, say so as a limit.
- **A snapshot view crashed and posture was called unobservable**, while the same classifier's text
  view in `<run-short>/posture.txt` had completed. Open the text capture first.
- **Fixes were proposed against the run's source rather than the stack head.** Triage confirmed
  defects against the current stack (`git diff --quiet <stack head> <run source> -- <owner files>`)
  and append each fix to the open PR that owns its area.

## Where the detail lives

| reference | owns |
| --- | --- |
| [running-lanes.md](references/running-lanes.md) | readings, grouping, the shared-instructions sections, report shape, collection, transports, mirrored runs |
| [synthesis.md](references/synthesis.md) | what the synthesis must produce, adjudication, the archive and the note, improvement-plan questions, external review |
| [deterministic-lanes.md](references/deterministic-lanes.md) | the thirteen readers, how a read resolves its checkout, every trigger and the lane it starts |
| [session-index.md](references/session-index.md) | one sentence per row and lane, and the tiers |
| [review-angles.md](references/review-angles.md) | the catalogue: rows A to I and lanes 1 to 38 |
| [CHECKLIST.md](CHECKLIST.md) | the synthesis questions, indexed once per review |
| [lane-maintenance.md](references/lane-maintenance.md) | whether a lane earns its place, and what was retired |
| [outcome-review.md](references/outcome-review.md), [climb.md](references/climb.md), [gate-audit.md](references/gate-audit.md) | the three narrow reads |

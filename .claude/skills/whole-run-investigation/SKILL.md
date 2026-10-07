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
goes under `notes/wri-YYYYMMDD/` in the main checkout (ignored, never published); each run's review
is `<dir>/<runId>/`, named by the full run id. Do not start the next step until the check named for
this one holds.

1. **Start.** `wri.ts start <run> [<run> ...] --out <dir>` reads every named run the way `read`
   does: it resolves each run's own measured checkout, runs the deterministic readers into
   `<dir>/<runId>/` and prints one bounded brief per run (size, tier, triggers, the lanes they
   start). It then writes `<dir>/shared-instructions.md` from the preset, with the run table filled
   in and the two authored sections left as marked blanks, and `<dir>/wri-investigation.json`.
   *Check:* exit 0. A run whose snapshot came out incomplete is still read and tabled, and `start`
   names it and exits 1, because its lanes cannot be built. `start` refuses a directory that already
   holds shared instructions. Read the briefs, not the lane captures.
2. **Edit the shared instructions.** Fill the two blanks in `<dir>/shared-instructions.md`: the
   orientation, which is the operator's question, and the moved variable with its prior state. Edit
   any other line every lane should read ("Editing the shared instructions" below).
   *Check:* no `##` section is blank, and the hard-rules section is still there.
3. **Build the lanes.** `wri.ts lanes --out <dir>` builds each run's lane prompts, composes them
   into groups for the readings asked for and writes `<dir>/launch.md`, one entry per agent: its
   prompt, the report path(s) it writes, its exact one-line prompt and its model check.
   *Check:* exit 0. It refuses a blank section, and it refuses with "no launch.md written" when any
   group lost the shared instructions or an isolated lane gained them, so a non-zero exit is the
   defect, not noise. Read the dropped-lane notes it prints. Count the entries: that is the spend.
4. **Launch.** Start one subagent per `launch.md` entry, all in one message, on the model the
   operator chose, handing each its one-line prompt and nothing else.
   *Check:* when each finishes, run its model check and read the model its transcript recorded.
5. **Collect.** `wri.ts collect --out <dir>` validates every expected report as ok, missing or
   invalid, writes `<dir>/reports.md` and prints each reading's count.
   *Check:* every reading reads complete; `collect` exits 1 until then. A cross-run reading takes
   the per-run reports as leads, so once per-run is complete `collect` prints the command that
   builds it (step 3 with `--readings cross-run`); launch and collect that before synthesising.
6. **Synthesise.** `wri.ts synthesis --out <dir>` renders `<dir>/synthesis-prompt.md` from
   [the synthesis template](references/synthesis.template.md), the shared instructions and a fresh
   report index, and prints its one-line prompt and model check; one agent writes
   `<dir>/synthesis.md`. The primary then adjudicates it
   ([the synthesis reference](references/synthesis.md)).
   *Check:* `synthesis` renders even over incomplete readings and names them, so read what it
   printed; every consequential claim is re-checked against the bytes or marked as resting on one
   report.
7. **Finish.** `wri.ts finish --out <dir> --run <runId>` (no `--run` for a one-run investigation)
   validates that run's `lanes/` reports and scaffolds `<dir>/<runId>/archive/` when an archive is
   wanted. The archive holds `lanes/` only; the isolated lanes and the cross-run and multi-run
   readings reach the record through the synthesis.
   *Check:* the archive validator exits 0; read its exit status directly, never through a pipe.

### Commands

Each script runs as `bun .claude/skills/whole-run-investigation/scripts/<script>` from the review
checkout, and the reader verbs as `bun run runs`. This table is the one place their usage is
written; the references point here. The usage block at the head of `scripts/wri.ts` is the source.

| step | command | writes |
| --- | --- | --- |
| 1 | `wri.ts start <run> [<run> ...] --out <dir> [--preset <name \| file>] [--all \| --lanes <readers>] [--repo <abs>] [--reference <abs>]` | `<dir>/<runId>/` per run; `<dir>/shared-instructions.md`; `<dir>/wri-investigation.json` |
| 3 | `wri.ts lanes --out <dir> [--lanes 1-4,7 \| --tier] [--agents N \| --components K] [--readings per-run,cross-run,multi-run] [--prior <abs file>] [--remote-host <host>]` | `<runId>/lanes/`, `<runId>/lanes-isolated/`, `cross-run/`, `multi-run/`; `<dir>/launch.md` |
| 5 | `wri.ts collect --out <dir>` | `<dir>/reports.md` |
| 6 | `wri.ts synthesis --out <dir> [--template <abs file>]` | `<dir>/synthesis-prompt.md` |
| 7 | `wri.ts finish --out <dir> [--run <runId>]` | `<dir>/<runId>/archive/` |
| Luna | `wri.ts launch --out <dir> [--run <runId>] [--auto <count> \| --sessions <spec>] [--effort max] [--max-active N] [--live]` | one run's lanes as Codex sessions, in place of steps 3 to 5 |
| — | `wri.ts readers`; `wri.ts scope <target>`; `wri.ts read <target> --out <review> [--lanes …]`; `wri.ts brief --out <review>` | the deterministic catalogue; a run's size; the deterministic read alone; its brief again |
| — | `bun run runs delta \| climb \| yield \| timeline \| walls \| handoff \| gates \| target <target> [--json] [--out <abs>]` | one reader's view |
| — | `wri.ts census [--json]`; `validate-archive.ts --archive <abs dir>` | the cross-run gate census; an archive check |

A target is a campaign folder, its `controller/<runId>` folder or any selector `bun run runs show`
takes. Resolve "the latest truss run" with `bun run runs list --closed 30`, newest first; a selector
naming several runs is refused. On `start`, `--lanes` names deterministic readers; on `lanes` it
names semantic lanes. With neither `--lanes` nor `--tier`, `lanes` builds every lane, the isolated
ones only where their trigger fired; `--tier` takes what each brief chose, the triggered lanes plus
the tier's standing lanes ([the session index](references/session-index.md#tiers) owns the tiers).
`--readings` defaults to per-run for one run and per-run plus multi-run for several. `--prior` hands
the cross-run reading an earlier owner table to reconcile with. `--preset` names
`references/<name>.template.md` or a template file in place of
[the shipped preset](references/shared-instructions.template.md). Pass every option as its own word
on the command line: an option list held in a zsh variable reached the builder as one argument and
it built nothing, silently.

## Three readings, and how to size them

The three readings answer different questions, and they proved most useful together on 2026-10-07.

- **Per-run** (depth). Each agent reads a group of lanes in one run, straight from that run's
  records, and writes one report per lane. This is the reading for a single run, and the base for
  the cross-run reading.
- **Cross-run** (reconciliation). Each agent reads one lane group in every run, with that group's
  per-run reports handed over as leads to re-check. It sorts each finding as holding in every run
  (`every`), checked and absent (`absent`), or undecidable from the other records (`unsaid`), counts
  how far a controller-owned mechanism recurs over the recorded corpus, reconciles with the `--prior`
  owner table when one is given, and ends each finding in a typed outcome (`patch`, `decision`,
  `prediction` or `drop`). Use it whenever two or more runs were read per-run.
- **Multi-run** (width). The same sort and outcomes, but read straight from the records without
  opening the per-run or cross-run reports. It trades depth for an independent angle, and agreement
  with the other readings counts only because it was reached alone. It is in the default for
  several runs because a mechanism that recurs across domains is the strongest evidence an
  investigation produces.

An agent's load is lanes times runs. `--agents N` (default 10) fixes how many agents each reading
gets, counting the lanes that run alone; `--components K` caps the load instead, K lanes in a
per-run group and K divided by the run count in a group across runs. Three lanes over three runs
(nine) is the most one agent has carried well; two over two and two over four are as valid, and a
group of eight lanes or more on one run thins every report. Lanes that read the same bytes are
grouped by theme (`references/lane-groups.json`), and lanes 7, 23, 29 and 30 always run alone, per
run, in their own agent. [Running the lanes](references/running-lanes.md) has the detail, including
what each report must contain.

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

`<dir>/shared-instructions.md` is the text every open lane prompt carries, whole, in every reading,
and the synthesis prompt carries it too. `start` copies it from
[the preset](references/shared-instructions.template.md) and fills the run table. Edit the copy when
the change belongs to this investigation, which is nearly always. Edit the preset only when every
future investigation should read the change, and commit it with the skill. HTML comments are
dropped when prompts are built, a `##` section left blank refuses `lanes`, and deleting a heading
drops its section on purpose. The preset's sections:

| section | written by | for |
| --- | --- | --- |
| Orientation | the primary | the operator's question and where its evidence is, never the answer you expect; at most about twenty lines |
| The moved variable and prior state | the primary | what changed between these runs and the ones before, the earlier findings or fixes this investigation checks, and what would falsify them; "none" when nothing moved |
| Runs under review | `start` | one row per run: tier, campaign, review, source commit, the checkout to read it in, terminal, batteries, cases |
| Hard rules | the preset | the rules above, plus that the orientation orients and does not conclude; delete one only deliberately |

Three things reach a lane beside these and are not edited here: each run's own `## Run overview`
(recorded facts and triggers, from `<dir>/<runId>/run-overview.md`), the lane body from the
catalogue, and the reporting rules and report-only authority the builder appends. A lane told what
to find finds it, so an earlier diagnosis goes under the prior state as a hypothesis, never under
orientation as a premise.
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
  view in `<dir>/<runId>/posture.txt` had completed. Open the text capture first.
- **Fixes were proposed against the run's source rather than the stack head.** Triage confirmed
  defects against the current stack (`git diff --quiet <stack head> <run source> -- <owner files>`)
  and append each fix to the open PR that owns its area.

## Where the detail lives

| reference | owns |
| --- | --- |
| [running-lanes.md](references/running-lanes.md) | readings, grouping, the shared-instructions sections, report shape, collection, transports, mirrored runs |
| [synthesis.md](references/synthesis.md) | what the synthesis must produce, adjudication, the archive and the note, improvement-plan questions, external review |
| [shared-instructions.template.md](references/shared-instructions.template.md), [synthesis.template.md](references/synthesis.template.md) | the preset every open lane prompt carries, and the synthesis agent's prompt |
| [deterministic-lanes.md](references/deterministic-lanes.md) | the thirteen readers, how a read resolves its checkout, every trigger and the lane it starts |
| [session-index.md](references/session-index.md) | one sentence per row and lane, and the tiers |
| [review-angles.md](references/review-angles.md) | the catalogue: rows A to I and lanes 1 to 38 |
| [CHECKLIST.md](CHECKLIST.md) | the synthesis questions, indexed once per review |

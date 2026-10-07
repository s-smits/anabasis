# Running the lanes

Load this when building, launching or collecting lanes. [SKILL.md](../SKILL.md#commands) holds the
procedure and the one table of command usage; this file holds what sits behind each step. Nothing
here changes what a lane is asked: the lane bodies are [the catalogue](review-angles.md).

## Where everything lands

`scripts/investigation.ts` owns the layout of the investigation directory, and its header is the
source for this table.

| path | written by | holds |
| --- | --- | --- |
| `<dir>/wri-investigation.json` | `start` | the runs in the order named, and the preset used |
| `<dir>/shared-instructions.md` | `start`, then the primary | the text every open lane prompt carries |
| `<dir>/<runId>/` | `start` | the run's review: captures, brief, snapshot, `run-overview.md` |
| `<dir>/<runId>/lanes/` | `lanes` | the open lanes' `prompts/lane_NN.md`, `groups/` composed from them, `tasks.json`, and `native-output/lane_NN.md`, one report per lane |
| `<dir>/<runId>/lanes-isolated/` | `lanes` | the same for the fired isolated lanes, built on their own and blind to the rest |
| `<dir>/cross-run/`, `<dir>/multi-run/` | `lanes` | `groups.json`, one prompt per group, and `native-output/<group>.md`, one report per group |
| `<dir>/launch.md` | `lanes` | one entry per agent of the readings asked for |
| `<dir>/reports.md` | `collect`, `synthesis` | every expected report, ok, missing or invalid |
| `<dir>/synthesis-prompt.md`, `<dir>/synthesis.md` | `synthesis`, then its agent | the synthesis prompt and the note it writes |

`lanes` rebuilds prompts, groups and `launch.md` each time it runs and never removes a report under
`native-output/`, so building again after a launch keeps the work already done.

## What a lane prompt is

A per-run lane prompt opens with the run's identity, then the shared instructions, the controller
facts, the run's own `## Run overview`, the assignment with each lane's `startsFrom:` line and its
body copied verbatim from the catalogue, and the reporting rules. A group prompt holds several lane
bodies under one copy of that prefix, and its authority is report-only: a native lane's default
authority lets it commit repairs in its own worktree, which the composed prompt withholds so the
primary adjudicates first. When the operator does grant repairs, a lane commits one fix per proven
finding in a worktree of its own and never pushes. Never write a prompt that says "read these
files" by hand: `launch.md` already holds the exact one-line prompt that points an agent at its
composed file.

Which lanes a run gets is the `lanes` command's choice. With neither `--lanes` nor `--tier` it builds
every lane; `--tier` takes what the brief chose, each trigger's lanes
([the deterministic lanes reference](deterministic-lanes.md#from-trigger-to-lane)) plus the tier's
standing lanes ([the session index](session-index.md#tiers)); `--lanes 1-4,7` names them. An isolated
lane (7, 23, 30) is built only where its trigger fired, and `lanes` prints a note naming each one it
dropped and why. A run with no snapshot, a probe-tier run that scored nothing, gets no per-run lanes;
the readings across runs name it with the captures it can answer from. The tier is a default, not a
gate: a run the operator calls important earns the lanes its questions need.

## The three readings

**Per-run.** Each agent holds a group of lanes in one run and writes one report per lane, at
`<lanes dir>/native-output/lane_NN.md`. Each report has its `## lane_NN` heading and, under it,
`### Started from`, `### Evidence read`, `### Findings` and `### Not established`, once each, in that
order and non-empty. A lane that finds nothing says so and still fills `Not established`. Every
finding carries `owner:` on a line of its own, naming one of the nine bundle files, `environment`,
`controller-source` or `judge` (`FINDING_OWNERS` in `scripts/manifest-reporting.ts`), and states the
observation and its inferred cause as two sentences.

**Cross-run** and **multi-run.** Each agent takes one lane group and reads it in every named run,
then writes one report for the group, headed `# Multi-run: <group>`, with one `## lane_NN` section
per lane in the same four sections. Under `### Findings` each finding carries three lines of its own:
`owner:`, `pile:` and `outcome:`. The pile is `every` (the same mechanism at the same owner in every
run the question applies to), `absent` (read in the other runs' records and not there, with the
reason: domain shape, censored by a stop, never reached) or `unsaid` (the other records cannot say).
A finding seen in one run is examined now in the others, never left unsorted. For an `every` finding
owned by controller source, the agent counts the distinct campaigns and domains in the recorded
corpus where the mechanism shows, naming the reader used and one join it did not make, and gives
the cheapest bounded count when a full one would take more than about fifteen minutes. The outcome
is `patch` (owner `file:line` at the run's commit, the mechanism in one sentence, the test that would
fail without it, the corpus count), `decision` (one owner, the missing evidence, the decision it
changes), `prediction` (moved variable, claim, direction, falsifier) or `drop` (why). Only a fix
whose shape recurs across campaigns is a `patch`; a domain-specific one is named as such.

The two differ in what they may open. The cross-run reading hands each lane's per-run reports over
as leads, to be re-checked against the records before anything is carried, so `lanes` refuses to
build it until every run with a snapshot has per-run reports; it builds no per-run prompts itself.
With `--prior <abs file>` it also reconciles with an earlier owner table after its own sort, as
`confirmed`, `amended`, `not supported` or `not touched`, under `## Prior reconciliation`. The
multi-run reading opens no other reading's reports or synthesis and takes no prior: a recurrence it
finds alone corroborates the others, and one only it finds is a lead they missed. The four links of
the operator's question are the synthesis's to answer, not a reading's. Runs measured at different
commits are read each at its own; the run table names every commit and checkout.

Builder product content (`correctness-model/`, `agent/`, `reference/`) is counted in every reading
and never patched: its owner is the Builder, and a recurring one points at the controller surface
that let it through.

## Grouping and sizing

`references/lane-groups.json` is a tree of themes whose leaves are lanes and whose joins are lanes
that read the same bytes, such as 5 and 33 (limits and the reference) or 35 and 38 (verified fails).
Lanes 7, 23, 29 and 30 sit in `alone`: each gets its own agent, counts toward the agent total, and
stays per run, because its evidence boundary or scratch belongs to one run. `--agents N` (default
10) cuts the rest by splitting the largest group in two until N agents are reached, and refuses when
the lanes that run alone already use them all. `--components K` instead splits until every group
fits: K lanes in a per-run group, and K divided by the run count, rounded down, in a group across
runs, so K is the most lanes times runs one agent holds. A theme stays together while it fits, and
lane 31 stays out of lane 1's group, because lane 1's report is one of lane 31's triggers.

Size by lanes times runs. Three lanes over three runs is the most one agent has carried well, and two
over two or two over four are as valid. Fewer, larger groups trade independence and report depth for
fewer launches; each lane still gets its own section.

## Editing the shared instructions

The preset is [shared-instructions.template.md](shared-instructions.template.md), a Markdown file
whose HTML comments guide the author and are dropped when prompts are built. `start` copies it to
`<dir>/shared-instructions.md` and fills `{runTable}`; `--preset <name>` starts from
`references/<name>.template.md` or from a template file you name. `lanes` refuses while any `##`
section is blank, and deleting a heading drops its section on purpose.

Edit the copy for anything this investigation needs: a section reworded, a line every lane should
read added, a rule tightened. Edit the preset only for a change every later investigation should
carry, and commit it with the skill so the next reader sees why. The hard-rules section stays in both
unless someone removes it on purpose, and a removal is worth a line in the note saying which rule
went and why. Each run's recorded facts reach its lanes separately, as its `## Run overview` from
`<dir>/<runId>/run-overview.md`, so they are not copied into the shared instructions.

The two authored sections carry the investigation's direction, and they are where a lane is most
easily led:

- **Orientation** is the operator's question and where its evidence is. It orients and never
  concludes; a lane may contradict any line with evidence, and that is a finding. On 2026-10-07 the
  question was four links per run: did the build harness run on the shipped bytes, was all feedback
  produced and gathered, was the review feedback used, was everything handed over.
- **The moved variable and prior state** says what changed between these runs and the ones before
  (source, model, effort, domain), the earlier findings or fixes this investigation checks, each as a
  hypothesis with where it was written, and what would falsify them. It says "none" when nothing
  moved.

Isolated lanes never receive the shared instructions. Their prompts come from the blind template
alone, and `lanes` refuses a build in which one gained them or another group lost them.

## Launching

Launch every entry of `launch.md` in one message, one subagent each, with no coordinator and no
further delegation, giving each exactly its one-line prompt. Launch on the model the operator chose:
omitting `model` inherits the primary's, and the alias `opus` once resolved to a model the operator
had rejected. Each entry's model check greps the subagent transcripts under `~/.claude*/projects/`
for that exact one-line prompt and prints the model the transcript recorded; run it when the agent
finishes and before reading its report. The Agent tool cannot enforce a reasoning effort, so a
report says what ran, not what was asked.

A hardware lane (29 or 30) builds adapters and compiler output in one scratch directory of its own,
`<lanes dir>/hw-scratch/<session>/`, named in its prompt, and freezes its verdict file there; every
other lane, and every campaign tree, stays read-only.

**Luna.** To run one run's lanes as Codex sessions instead, run `start`, edit the shared
instructions, then `wri.ts launch` in place of `lanes`, `collect` and the native launch.
[codex-luna-swarm](../../codex-luna-swarm/SKILL.md) owns the transport and the current model.
`--sessions` names lanes from the catalogue and `--auto <count>` groups every lane into that many
sessions without crossing an isolated seat; with neither, the count is the one the run's tier named.
Reports land under `<dir>/<runId>/lanes/luna-output/`, and `finish` validates them against the
launcher's summary. Eighteen Luna lanes on each of two runs took the host from load 8 to 16 beside
six paid runs on 2026-09-30, so pass `--max-active` when runs are live; 53 at once met no provider
rate limit.

## Collecting

`collect` validates every report the composed readings expect and writes `reports.md`, one table per
reading with each agent's status and report paths, and the issues of each invalid one. It exits 1
until every reading is complete, and once per-run is complete it prints the command that builds the
cross-run reading. `synthesis` collects again before it renders. Four refusals recur, and each is
cheaper to catch while its author still has context, so run `collect` once the first reports land.

- **A stray `owner:`.** The validator takes the first word after any `owner:` on any line as the
  finding's owner, so a sentence such as "the projection owner: add a typed gap" parses as owner
  `add`. Reword the sentence, never the owner line, and say in the note which report was edited.
- **Sections out of order, missing or repeated.** Each lane needs its four sections once, in order.
- **A pile or outcome missing** from a cross-run or multi-run finding.
- **A report written elsewhere.** The agent's reply is a summary; the file at the entry's report
  path is the report.

Before paying for another reading, check what is already there: prompts, reports and transcripts. A
resumed session finishes the accepted work rather than rerunning it. A recovered report is not a
verified transport identity, and a session id or a clean exit does not supply a report that is
missing; name missing work and replace only the coverage that still affects the decision.

## Mirrored runs

A run mirrored from another machine lacks `.oss/` and `workspace/.toolchain`, so every version's
`.toolchain` link dangles by construction. A lane's "toolchain unreadable" is then a mirror fact
until a read-only `ls` or `sha256sum` on the origin says otherwise. So the orientation names the
host, and `lanes --remote-host <host>` puts into every prompt's authority that the tree may be read
there with read-only ssh commands and never written, not even by a redirect. A lane that writes
anything on the origin has still written, so list the origin's `/private/tmp` after the lanes finish
and move any stray file to the Trash there.

# Running the lanes

Load this when building, launching or collecting lanes. [SKILL.md](../SKILL.md#commands) holds the
procedure and the one table of command usage; this file holds what sits behind each step. Nothing
here changes what a lane is asked: the lane bodies are [the catalogue](review-angles.md).

## What a lane prompt is

A lane prompt is three parts in order: the shared instructions, the lane body copied verbatim from
the catalogue (its `Starts from` paragraph is the trigger), and a closing authority line. A group
prompt holds several lane bodies under one copy of the shared instructions. `lanes` writes both, and
the primary never writes a prompt that says "read these files", because the agent then spends its
first turns assembling what the builder assembles in a second.

Which lanes a run earns comes from its brief. The deterministic read raises triggers, each trigger
starts the lanes [the deterministic lanes reference](deterministic-lanes.md#from-trigger-to-lane)
maps it to, and the run's tier adds its standing lanes, which open on every run of that size because
they ask what a self-authored exam always leaves open ([the session index](session-index.md#tiers)).
The tier is a default, not a gate: a run the operator calls important earns the lanes its questions
need, and the count is where to start, not a quota. A probe-tier run, one that has scored nothing,
is read and given no lane prompts; it is named in the run table with the captures it can answer from.

A lane is report-only until the primary has adjudicated its findings. When the operator grants a
native lane repair authority, it may commit one fix per proven finding in a worktree of its own,
never a push, and the primary folds those commits as it folds any report.

## The three readings

**Per-run.** Each agent holds a group of lanes in one run. Its report has one `## lane_NN` section
per assigned lane, each with `### Started from`, `### Evidence read`, `### Findings` and
`### Not established`, once each, in that order and non-empty. A lane that finds nothing says so and
still fills `Not established`. Every finding carries `owner:` on a line of its own, naming one of
the nine bundle files, `environment`, `controller-source` or `judge` (`FINDING_OWNERS` in
`scripts/manifest-reporting.ts`), and states the observation and its inferred cause as two
sentences.

**Cross-run.** Each agent takes one lane group and reads that group's per-run reports in every run.
It then sorts each finding into one pile, after checking the other runs' bytes itself: `every` (the
same mechanism at the same owner in every run the question applies to), `absent` (read in the other
runs' records and not there, with the reason: domain shape, censored by a stop, never reached) or
`unsaid` (the other records cannot say). A finding one run's lane made and another's did not examine
is examined now, never left unsorted. For an `every` finding owned by controller source, it counts
the distinct campaigns and domains in the recorded corpus where the mechanism shows, naming the
reader used and one join it did not make, and gives the cheapest bounded count when a full one would
take more than about fifteen minutes. It reconciles with any earlier owner table the prior state
names (`confirmed`, `amended`, `not supported`, `not touched`). Every finding ends in one outcome:
`patch` (owner `file:line` at the run's commit, the mechanism in one sentence, the test that would
fail without it, the corpus count), `decision` (one owner, the missing evidence, the decision it
changes), `prediction` (moved variable, claim, direction, falsifier) or `drop` (why). Only a fix
whose shape recurs across campaigns is a `patch`; a domain-specific one is named as such.

**Multi-run.** Each agent reads one lane group in every named run straight from the records, with
the same piles and outcomes, and never opens the per-run or cross-run reports. That independence is
what it is for: a recurrence it finds alone corroborates the other readings, and one only it finds
is a lead the others missed. Runs measured at different commits are read each at its own; the run
table names every commit and checkout.

Builder product content (`correctness-model/`, `agent/`, `reference/`) is counted in every reading
and never patched: its owner is the Builder, and a recurring one points at the controller surface
that let it through.

## Grouping and sizing

`references/lane-groups.json` is a tree of themes whose leaves are lanes and whose joins are lanes
that read the same bytes, such as 5 and 33 (limits and the reference) or 35 and 38 (verified fails).
`--agents N` cuts it into exactly N agents by splitting the largest group in two until N is met;
`--components K` splits until no agent holds more than K lanes times runs, so a theme stays together
while it fits. Lanes 7, 23, 29 and 30 sit in `alone` and count toward N. Lane 31 stays out of lane
1's group, because lane 1's report is one of lane 31's triggers.

Size by lanes times runs. Three lanes over three runs is the most one agent has carried well, and two
over two or two over four are as valid. Fewer, larger groups trade independence and report depth for
fewer launches; each lane still gets its own section. A lane with no prompt, because nothing
triggered it and no tier opened it, is pruned before grouping.

## Editing the shared instructions

The preset, `references/shared-instructions.template.md`, is a Markdown file with named
placeholders. `start` copies it to `<dir>/shared-instructions.md`, fills the run table and the run
overviews from recorded bytes, and leaves the authored sections as marked blanks; `lanes` refuses to
build while one is blank. `--preset <name>` starts from another template file instead.

Edit the copy for anything this investigation needs: a section reworded, reordered or added, a run
overview line dropped because it misleads, a reporting rule tightened. Edit the preset only for a
change every later investigation should carry, and commit it with the skill so the next reader sees
why. The hard-rules section stays in both unless someone removes it on purpose, and a removal is
worth a line in the note saying which rule went and why.

The two authored sections carry the investigation's direction, and they are where a lane is most
easily led:

- **Orientation** is the operator's question, put as facts a lane can check and the links it must
  answer per run (on 2026-10-07: did the build harness run on the shipped bytes, was all feedback
  produced and gathered, was the review feedback used, was everything handed over). It is never the
  conclusion you expect; a lane may contradict any line with evidence, and that is a finding.
- **Moved variable and prior state** says what changed between these runs and their baseline, and
  what earlier readings concluded, each as a hypothesis with where it was written. The same text for
  every run renders once for the set; anything that differs stays under its own run.

Isolated lanes never receive the shared instructions. The builder writes their prompts from the
blind template alone, and refuses a launch in which one gained them or another group lost them.

## Launching

Launch every row of `launch.md` in one message, one subagent each, with no coordinator and no
further delegation. Give each the row's one-line prompt. Launch on the model the operator chose:
omitting `model` inherits the primary's, and the alias `opus` once resolved to a model the operator
had rejected, so run each row's model check against the agent's transcript before reading its
report. The Agent tool cannot enforce a reasoning effort, so a report says what ran, not what was
asked.

To run lanes as Luna sessions instead, [codex-luna-swarm](../../codex-luna-swarm/SKILL.md) owns the
transport, the current model and the collection; hand it the same prompt files. Eighteen Luna lanes
on each of two runs took the host from load 8 to 16 beside six paid runs on 2026-09-30, so queue
behind a cap when runs are live; 53 at once met no provider rate limit.

A hardware lane (29 or 30) builds adapters and compiler output in one scratch directory of its own,
`<review>/lanes/hw-scratch/<session>/`, named in its prompt, and freezes its verdict file there;
every other lane, and every campaign tree, stays read-only.

## Collecting

`collect` reads every report the launch expects and calls each ok, missing or invalid, with the
exact section named. Four refusals recur, and each is cheaper to catch while its author still has
context, so dry-run `collect` once the first reports land.

- **A stray `owner:`.** The validator takes the first word after any `owner:` on any line as the
  finding's owner, so a sentence such as "the projection owner: add a typed gap" parses as owner
  `add`. Reword the sentence, never the owner line, and say in the note which report was edited.
- **Sections out of order, missing or repeated.** Each lane needs its four sections once, in order.
- **A pile or outcome missing** from a cross-run or multi-run finding.
- **A report written elsewhere.** The agent's reply is a summary; the file at the row's report path
  is the report.

Before paying for another reading, check what is already there: existing prompts, reports and
transcripts. A resumed session finishes the accepted work rather than rerunning it. A recovered
report is not a verified transport identity, and a session id or a clean exit does not supply a
report that is missing; name missing work and replace only the coverage that still affects the
decision.

## Mirrored runs

A run mirrored from another machine lacks `.oss/` and `workspace/.toolchain`, so every version's
`.toolchain` link dangles by construction. A lane's "toolchain unreadable" is then a mirror fact
until a read-only `ls` or `sha256sum` on the origin says otherwise, so the orientation names the
host and the prompt allows read-only commands there. A lane that writes anything on the origin,
even a stray redirect inside an ssh command, has written: forbid redirects in the prompt, list the
origin's `/private/tmp` after the lanes finish, and move any stray file to the Trash there.

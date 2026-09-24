## Round hand-off angles

These are angles 37–40 of the same catalogue as [review-angles.md](review-angles.md) and
[review-angles-boundaries.md](review-angles-boundaries.md); the manifest reads all three in order.
Each asks what one round handed the next and whether the next round used it. Start from the
deterministic `handoff` lane (`scripts/handoffs.mjs`, captured as `<review>/handoff.txt`): its four
sections are these four angles' tables, so a lane spends on the question and not on the join. A
field an older source never recorded is unobservable, never zero. Never change recorded evidence.

**37. Round hand-off census.** Which of the channels one round hands the next were present, served,
read back and acted on? Decides: which served channel paid for its prompt space and which only
occupied it. Views: the full Builder kickoff in `observability/<runId>.jsonl` (`prompt-ingested`,
role `builder`), each epoch's `builder-path-record.jsonl` and `builder-execution*.json` custom calls,
`analysis/<battery>-{rebuild-advice,diagnoses,epoch-review}.json`, and the workspace's `MEMORY.md`,
`EXPERIMENT.json` and `starter-pack/difficulty-ladder.md`. The channels are round facts, the climb
readout and battery contract, the ladder frontier rows, the rebuild advice packet, the Epoch
Reviewer's public projection, diagnosis issues, `EXPERIMENT.json`, memory notes, the `context` tool,
and solver traces and rehearsals. Read-back means a tool call that opened or queried the channel;
prompt text in context is served, not read. Hint: the round facts, the advice packet, the diagnosis
and the review projection have no re-query channel, so an unread one is structural rather than a
Builder choice, and a file opened through `bash` records only its working directory. For every
channel served and never read, name the cheapest alternative — drop it, move it to an existing
inspect mode, or state it where the decision is taken — and the observation that would show it
mattered. Trigger: two or more authoring rounds. 9 owns whether the right owner received a packet,
34 owns whether a served message was sufficient, and 24 owns memory curation and retention; this
lane owns the per-channel present/served/read/acted matrix across rounds.

**38. Difficulty calibration loop.** Does the Builder's battery prediction get better from round to
round, and does it consult rehearsal and trace evidence before committing? Decides: whether the
rehearsal instrument and the recorded target calibrate authoring or only decorate it. Views: the
`harness_trial` custom calls and their `truthVerdict`, each accepted submit's `experimentProposal`,
`difficulty-decisions/*.json` rows (`target`, `passed`, `verified`, `zone`) joined by battery in
claim `createdAt` order, and the path record before the round's first proposal write, preview or
submit. Report per round the rehearsal count and verdicts, the prediction error (verified passes
minus the declared `verifiedPasses`) and whether its magnitude shrinks across rounds, whether
history, rehearsal or trace evidence was opened before authoring, and how many placed batteries
landed on the aim. `EXPERIMENT.json` declares one battery-wide target, so per-task predictions are
unobservable on every current source, not absent. Hint: a met target on an unchanged public task
set predicts a repeat, not a harder battery. Trigger: a second battery with a declared target, or a
rehearsal before any battery. 10 owns whether prediction, interval and next move agree, 17 owns
the prediction's lineage into the successor, and 21 owns what the task change means; this lane
owns whether the prediction error closes and what evidence preceded each commitment.

**39. Harness-versus-evaluation triage hand-off.** When a family fails, did the diagnosis, the Epoch
Reviewer and the advice packet agree on which side owned it, and did the successor repair that side?
Decides: whether triage reached the round that could act on it, on the side it named. Views: the
advice packet's issues (`lastSeenRunId`, status, `diagnosis`, `dispute`), the diagnosis reading's
layer and intervention where it records them, or its `interventionClass` (`diagnosis-reading/v1`),
the battery's `-epoch-review.json` status, findings, `probes` and `disputes`, the successor's
decision-row `operation`, and the authoring reviews timed by their UUIDv7 names. Per failing family
report the diagnosis layer and intervention, whether the reviewer ran, disputed the issue or showed
through `probe_check` a changed value that moved no check, whether the packet withheld the agent
advice for a disputed issue, and whether the successor's attributed operation repaired the named
side. Then time it: how many previews and submits had a mid-round review before them, and the
latency from the first failing battery to the first evaluation-side review. Hint: a probe that moved
no check is a lead to a loose check, not proof of one; a task probe repairs neither side. Trigger:
any advice issue with a count, or a completed epoch review beside a failure. 3 owns what the failed
traces show, 26 owns whether reviewer findings entered admission, and 35 owns whether the same
defect was closed; this lane owns the agreement and the timing across those three hand-offs.

**40. Same-task repair measurement.** When an advice issue changes state, did the batteries on
either side measure the same tasks? Decides: whether an issue's `tentatively-fixed`,
`confirmed-fixed` or `retired` rests on a comparison of task identity or of family names alone.
Views: each battery's `cases/*/public-task.json` under every campaign trace root, digested over
`publicTask.publicInput`, the consecutive `-rebuild-advice.json` packets, and `deriveRebuildAdvice`
in `src/author/rebuild-advice.ts`, whose `advanceIssues` keys every issue with `adviceIssueId`. Join
per family before and after each repair and classify it `identical-tasks`, `partially-shared` or
`name-only` (or absent on one side), counting inputs that reappear under another family name. Report
every issue-state transition and flag those resting on `name-only` or absent-family joins. Say
whether the producer keys on task identity or family name: recompute each recorded issue id from
`(kind, family, detail)`, which is what the source hashes. Hint: renaming every family retires every
issue without a fixed task being measured again. Trigger: two consecutive batteries with an advice
packet between them. 35 owns whether the defect behind the issue was repaired, and 21 owns what the
task-set change means for difficulty; this lane owns whether the measurement could have shown it.

# Deterministic lanes

Thirteen readers, one question each, no provider call. `review-angles.md` holds the semantic lanes a
paid sweep spends on; this file holds what a local read already answers, so a live run can be
assessed without one, and it names the trigger string each reader prints beside the semantic lane
that string starts. Every reader is a lane of `scripts/wri.ts`, selected by name:

```text
bun .claude/skills/whole-run-investigation/scripts/wri.ts <lane> <campaign>/<runId> [flags]
```

The lanes are `snapshot`, `challenge`, `delta`, `climb` and `overview`, which collect, `climb` so
the run overview carries its trigger; `climb`, `yield`, `posture`, `timeline`, `walls`, `handoff`,
`gates` and `target`, which read the campaign; and `archive`, which writes the record. `brief.ts` runs the eight campaign lanes as `CAMPAIGN_LANES` and renders
their trigger lines into the sweep brief, reading an in-process lane's triggers from the report it
records at `<review>/<lane>.json`, so a trigger below is the same bytes whether it was read from a
lane's own output or from the brief. Each campaign lane is also a verb of `bun run runs`, which
starts `wri.ts <lane>` with its options untouched (`RUN_VERBS`, `.claude/skills/main/verbs.ts`).

## How a read finds its readers

A run's records are read by the source that wrote them. So `start` and `read` first resolve the
checkout at the opening's `source.commit`: `--repo` when it is clean there with its own dependencies
installed, else a registered worktree at that commit (the review worktree `ana-wri-<sha8>` first,
the run's own worktree last, another run's never), else `ana-wri-<sha8>` created beside the main
checkout and prepared from its own lock. Every lane then runs as that checkout's own script, and the
brief's `readers` line names it with every checkout passed over. A run no checkout can read is
refused as `source-unresolved` with exit 2 before any lane. Current source explains an older run
only through an ancestry and changed-path check, and the review procedure's own revision is kept
apart from the measured one.

Every lane's output is captured to `<review>/<lane>.txt` and the read is recorded in
`<review>/wri-review.json`. What the command prints is one bounded brief: the run's size and
terminal, each lane quoted whole or pointed at, the triggers and scan findings, and the semantic
lanes those triggers start. Read the brief, and open a lane file only once the brief has made that
lane the question; `wri.ts brief --out <review>` renders it again. A later read into the same
review adds its lanes and replaces only the captures it read again. The probe tier withholds only
the lanes that open the measured checkout or an archive, because a battery that scored nothing gives
them nothing to read.

The snapshot lane is `trace-review.ts`, also `bun run review:collect`. It makes no model calls and
reports a missing view inside `snapshot-status.json` rather than failing, and a new deterministic
question belongs there as another view rather than in a further collection script. Require
`complete: true` before treating the snapshot as complete. A read whose snapshot left a required
view unproduced still runs every other lane, names each such view under `== SNAPSHOT INCOMPLETE` at
the head of the brief, prints `digest: skipped: snapshot view <view> <status>` where those leads
would be, and only then exits 1.

## The digest

`snapshot` runs `digest.ts` over the run and prints numbered blocks. Each block is one question,
and the blocks that start a semantic lane print a capitalised trigger before the first colon of a
line. The trigger carries its lane in parentheses where one lane owns it; a trigger without a
suffix is settled by the primary reviewer under the row it belongs to, or mapped by the brief to
more than one lane.

Block 1, declared check by evidence, joins every declared check to its evidence kind and the tool
that decided it, and prints `in-process` where no installed tool did, which starts lane 1. Its
`UNTRIPPED IN SHIPPING` counts reject controls whose declared check never fired on a shipping
case; it carries no suffix because the brief maps it to lanes 5 and 6. Block 1b, solver process,
reads the solve traces for the tools the solver called, and `CHECK TOOL IN SOLVER TRACE (lane 23)`
says a verifier-side tool appeared in a solve, as a declared tool or named in a call's recorded text,
which lane 22 reads as a lead and lane 23 settles alone. `CHECK CODE IN SOLVER REACH (lane 34)` is
the static half: a check program the claim resolved in the Builder's tool tree, which the solver's
shell searches, or agent code byte-identical to correctness-model code. Block 1c, check informativeness, sets the reach of the controls against what shipping
tripped: `REACH-ONLY CHECKS (lane 6)` names checks the controls reach and no shipping case ever
failed, and `PERFECT BATTERY OVER AIM (lane 5)` names a full pass measured in a round that opened on a
battery the band had placed above its aim, the decision and the battery joining on the round's id.

Block 2, the submit and refusal ledger, reads each `builder-execution*.json` for its submits,
refusals and strikes, which lane 3 reads for a refusal after a clear preview and lane 25 for the
strikes. Block 2b, the Judge census, reads `analysis/<runId>-judges.json`: `CENSUS WITH
DISAGREEMENT (lane 16)` says a Judge verdict contradicted the verifier on an offered subject.

Block 3, condition symmetry, reads `case-record.jsonl` for the condition each case ran under;
block 3b, family-wise coverage, gives each family its own Wilson interval and prints `AGGREGATE
HIDES FAMILY` where the battery rate conceals a family at zero, `FAMILY UNMOVED` where a family's
tasks did not change between rounds, and `UNOBSERVED FAMILIES` where a declared family measured
nothing; block 3c, the repeated-condition census, prints `REPEATED CONDITION (lane 20)` where a
public condition recurs on a fixed product.

Block 4, workshop and spend, reads the tool installs and the ledger. Block 4b, band placement,
reads `difficulty-decisions/<runId>-<digest>.json` (`difficulty-decision/v10`) for the
`placement.zone` and prints no trigger of its own: an over-aim zone is read by lanes 5 and 12, and a
run of placements on one side of the aim by the `climb` lane's `flat`. Block 4c, role spend and censoring, reads `providerResourceBudget.byRole`
and the retry rows: `REVIEW TURNS EXCEED SOLVER TURNS (lane 24)`, `DECISION ON CENSORED BATTERY
(lane 24)` where a decision was taken on a battery the environment cut short, and `EXPLICIT
ALLOWANCE WAIT (lane 24)` where a `turnRetries[]` reason names an allowance reset clock. Block 4d,
the admission and epoch-review ledger, reads `analysis/<runId>-epoch-review.json` and
`-admission.json`: `FINDINGS WITHOUT OWNER (lane 14)` and `ADVISORY FINDING RECURS
UNROUTED (lane 14)`. Block 4e, Builder memory, reads `MEMORY.md` against `MEMORY_CAP_BYTES` and
prints `MEMORY OVER READ CAP (lane 26)`.

Block 5, integrity probes, and block 5b, served-model attestation, belong to rows H and I:
`SERVED MODEL MISMATCH` and `UNATTESTED ROWS` carry no lane suffix because the primary settles
them. Block 6, the rehearsal ledger, joins every `harness_trial` row to the accepted submit by
`candidateId`: `SUBMITTED BYTES NEVER REHEARSED (lane 11)` where no rehearsal ran on the accepted
bytes, and `REHEARSAL NOT-RUN (lane 9)` where a verdict is `not-run`. Block 6b, toolchain retention, reads each
`versions/<id>/.toolchain` without following it: `VERSION TOOLCHAIN IS A SYMLINK (lane 2)`,
`VERSION TOOLCHAIN DANGLING (lane 2)`, and `WRAPPER-ONLY TOOL DIGEST (lane 2)` where a
`verifierTools[]` entry of `kind: "script"` hashes a wrapper and nothing behind it.

## The other collect lanes

`challenge` runs `trace-challenge.ts`, which writes `trace-telemetry.json`
(`whole-run-trace-telemetry/v1`), `trace-challenge-packet.json` and
`trace-challenge-status.json` under the snapshot. The telemetry is public to every lane, and lanes
8 and 22 read its sequence counts; the packet is private to lane 23 and is read after the
telemetry, never before.

`delta` runs `source-delta.ts` between the run's `source.commit` and the review tree, and prints
`MODEL-VISIBLE SURFACE CHANGED (lane 21)` where a prompt-bearing file moved, and `UNREACHED
CHANGED SAFEGUARDS (lane 21)` where a `safeguardTriggered("id")` call changed and
`SAFEGUARDS_LOG.txt` under `campaigns/<slug>/safeguards/<runId>/` holds no line for it. A delta
touching `src/solve` starts lane 3 and one touching `src/review/epoch-review-public.ts` starts
lane 13.

`overview` runs `run-overview.ts`, which groups every trigger the collect lanes printed by the
lane suffix it carries, so the brief can say which lanes have something to read.

## The campaign lanes

`climb` runs `climb-velocity.ts` (`climb-velocity/v2`) over consecutive versions and labels every
edge `restated`, `adjusted`, `narrowed`, `widened`, `eased`, `escalated` or `replaced`; `adjusted`
deliberately states no direction, and `replaced` means fewer than half the task ids carried over;
with none carried, the numbers row compares the two batteries path by path and names that basis. Each edge also counts the tasks `carried` unchanged, which after a
full pass re-measure a known pass. The lane closes on the line the claimed batteries draw, whose
rows [the climb reference](climb.md#the-line) lists. Every label and line starts lanes 10 and 20, and
`CLIMB FLAT (lane 10)`, where `flat` meets the stall rule, starts lanes 10 and 36.

`yield` runs `review-yield.ts` and gives each review component a status per finding —
`consumed`, `unobservable`, `advisory-only` or `not-consumed`. The `epoch-reviewer` component is
read first by lanes 12 and 14, and the `harness-trial` component by lane 11.

`posture` classifies `builder-prose.jsonl` through `classifier/prose-classify.ts`; a run under
the row floor is `thin`, and a capture the reader refuses leaves the posture `unreadable`, both of
which lane 26 reads as a statement about the writer or the reader rather than the Builder.

`timeline` reads `observability/<runId>.jsonl` and prints the `STALLS` longest gaps; a gap over
thirty minutes starts lane 24, and `--classify` labels each stretch `adrift` or `unreadable`
through `classifier/run-narrative.ts`, where `adrift` starts lane 25.

`timeline` shows phases and gaps. It does not show how much of a round the Builder spent waiting on
its tools, and that share decides whether a long round is the model's or the host's. Read it from
`builder-execution.json`. Each `customCalls` row, including bash, read, write and edit, carries
`startedAtMs` and `durationMs` counted from the execution's start. Take the union of those intervals
against `durationMs`: calls sent together overlap, so a plain sum counts one wait twice. On
2026-09-30 six live Opus firmware rounds waited on tools for 79–91% of their wall this way (fork-a
275 of 304 min, -36 336 of 423). One `correctness_check` ran 137 min, and a `harness_inspect`
readiness call ran 31–35 min, on a host at load 57–200 with 12 cores. The record keeps no bash
command (`target: {}`). What a slow call ran is only in the Builder CLI transcript, under
`ana-claude-cli-*/projects/<workspace slug>/*.jsonl` inside the run's `ana-quick-run-*` temp root,
and `pi-session.ts` removes that directory when the session closes. So read it while the run is live:
pair each `tool_use` with its `tool_result` and take the longest of the calls in one message.

`walls` runs `walls.ts`, whose `boundOf` labels every case `unrecorded`, `submitted-at-wall`,
`time-bound`, `unstarted`, `submitted` or `no-submit`, and prints each bound's share against
`WALL_BOUND_SHARE`; a battery whose solves sit at a bound starts lane 22, and one whose solves
all sit at a tiny share of it starts lane 8.

`handoff` runs `handoffs.ts` and prints four tables, each labelled with the lane it starts: the
census per channel (present, served, read, acted) for lane 17, the calibration table for lane 10,
the triage table for lane 15 and the same-task table for lane 18.

`gates` runs `gate-rent.ts` over every Builder session's `correctness_check` and `submit` receipts
and joins each refusal code to its component in `gate-ledger.ts`, which carries the gate audit's
priors — `pRight` and `pStall` — for every component, deleted ones included, and names each
component's retired codes, because a run recorded before the audit still names them. The codes one
component emits on one receipt are one firing, and a qualifier such as `tool-timeout` counts only
where it rides beside no code of the component it details. Consecutive refusals carrying one
component are one episode, and each ends `repaired` (the component went away and the bundle moved),
`repaired-tool-condition` (the bundle stayed and the installed-tool condition moved),
`cleared-without-edit` (the whole submission condition stayed), `bundle-unchanged-condition-unknown` (the bundle stayed and the receipts recorded no tool
condition), `answered-identity-unrecorded` or `unanswered`. Only a receipt that cleared, or that
refused having run the stage each of the episode's codes came from, can answer it: a check that
stopped at conformance never ran the reference solve, and a code its receipt did not stage is not
filed under the receipt's aggregate stage, so only a clear answers it. It prints `GATE STALL`, `GATE CLEARED WITHOUT
EDIT`, `BELOW-BAR GATE FIRED` (a kept, narrowed or rewritten component whose `pRight` is under
`REFUSAL_BAR`), `UNLEDGERED REFUSAL CODE`, `REVIEW HOLD CHAIN` and `CEILING ENDED RUN`, each for
lane 27. For lane 28 it reads every `evaluation-correction` from the recorded batteries themselves,
pairs each with the latest earlier battery of the baseline it recorded (agent, correctness model
and task set), or says the baseline is unresolved, names the bundle files that moved between the
two, and prints `EVALUATION CORRECTION REPLAY CANDIDATE` with the `replay --under` command where
the scoring closure (`scoringClosureHash`) or a task's hidden expectations moved, or the closure
cannot be read. A replay
candidate stays one after the replay is run, because nothing records that it was.

`target` runs `hardware-target.ts`. It reads the recorded request from the
`prompt-ingested` user-directive row of `observability/<runId>.jsonl` and the current epoch's
`correctness-model/brief.json` `domain`, matches both against `HARDWARE_TARGETS`, the one list of
board and microcontroller families (ESP32, RP2040, Raspberry Pi, STM32, AVR, nRF, SAMD, Teensy,
MSP430, PIC), and prints `HARDWARE TARGET NAMED (lanes 29, 30)` when either names one. The same row
names every run in a sibling campaign whose opening carries this run's `requestDigest` on another
`source.commit`, with the nearest earlier and later one, which is what lane 29's matched-window
comparison starts from. `--reference <abs dir>` pins an external reference tree by Git revision, or
by `portableToolTreeDigest` when it is not a Git tree, and records an absent one as a gap. The same
detection gates lane 30 in `manifest-inputs.ts`, so a request naming no target never launches it.

## The archive

`archive` writes the sweep's record under `wri-archive/v2` from the lanes above and the semantic
reports, and `validate-archive.ts` and `validate-reports.ts` refuse a record whose digest
verdicts or lane titles are not the catalogue's. The digest verdict set is the block list above,
so `band-placement`, `rehearsal-ledger` and `toolchain-retention` are verdicts and a saturation
ledger is not.

## The digest verdicts

The digest settles ten verdicts beside rows A to I, in the order `DIGEST_VERDICTS`
(`scripts/catalogue-shape.ts`) lists them: discrimination-inertness, submit-stall-shape,
evidence-integrity, solver-process, check-informativeness, family-wise-coverage,
role-spend-and-censoring, band-placement, rehearsal-ledger and toolchain-retention. Each is
arithmetic over recorded rows and supplies a lead, never a semantic conclusion. No shipping
rejection does not make a check useless, a constant tool sequence does not prove an answer
shortcut, and a perfect battery proves that no limit was measured, not why.

## What each reader can and cannot say

`delta` prints paths and counts, never source text, so it says a surface moved and not that the
move reached anything. A `climb` label is structural and not a forecast: `escalated` says the checks
reached a higher tier, `widened` says the battery holds more and not that it asks more, `adjusted`
states no direction, and `replaced` says the edge could not be read. `walls` reads the walls the
Builder wrote in `agent/config.yaml`, the one file nothing inspects again after the gate, and its
usual decision-changing reading is the negative one: no case reached a wall, so room explains
nothing. `timeline`'s `unreadable` and `adrift` are separate claims, the first about the classifier
and the second about the model. `yield` counts opportunities, outputs, consumption and change per
review component, each with its own denominator, and is never a lane's yield. `handoff` reads a
served marker as a sentence the current source renders, so an absent marker reads `not found`,
never `not served`. A `posture` label is a lead for explaining an observed refusal, stall or case
kind, never a score, and `integrity-failure` means the execution and sidecar joins disagreed.

## From trigger to lane

`LANE_FOR_TRIGGER` in `scripts/brief.ts` maps each trigger to the lanes it starts, the suffixed lane
first, so the brief is itself the map from what the read found to the lane worth paying for. Name
each semantic lane against a row of the brief: the trigger, the question it settles and the decision
it could change.

| deterministic trigger | lane |
| --- | --- |
| an artifact root or declared input that no check reads; a relation no check enforces | 1 |
| 6b `VERSION TOOLCHAIN IS A SYMLINK`, `VERSION TOOLCHAIN DANGLING` or `WRAPPER-ONLY TOOL DIGEST` | 2 |
| block 1 `UNTRIPPED IN SHIPPING`; 1c `PERFECT BATTERY OVER AIM`; a 4b placement over the aim | 5 |
| block 1 `UNTRIPPED IN SHIPPING`; 1c `REACH-ONLY CHECKS` | 6 |
| verified cases, with lane 5 or 6 reading slack | 7, isolated |
| 6 `REHEARSAL NOT-RUN` | 9 |
| `climb` `CLIMB FLAT`; the `handoff` calibration table; a `climb` edge label beside a placement | 10 |
| 6 `SUBMITTED BYTES NEVER REHEARSED`; the `yield` `harness-trial` row | 11 |
| the `yield` `epoch-reviewer` row; a review the census marks incomplete | 12 |
| 4d `FINDINGS WITHOUT OWNER` or `ADVISORY FINDING RECURS UNROUTED`; the `yield` `epoch-reviewer` row | 14 |
| the `handoff` triage table | 15 |
| 2b `CENSUS WITH DISAGREEMENT` | 16 |
| the `handoff` census table | 17 |
| the `handoff` same-task table | 18 |
| 3c `REPEATED CONDITION`; a `climb` edge label | 20 |
| source-delta `UNREACHED CHANGED SAFEGUARDS` or `MODEL-VISIBLE SURFACE CHANGED` | 21 |
| a `walls` case `time-bound` or `turn-bound`, or a pass at a wall; passes at a tiny share of the solve wall | 22 |
| 1b `CHECK TOOL IN SOLVER TRACE` or `CHECK CODE IN SOLVER REACH`; verified cases with lane 1, 4, 8, 22 or 34 suspecting a shortcut | 23, isolated |
| a `timeline` gap over thirty minutes; 4c `REVIEW TURNS EXCEED SOLVER TURNS`, `EXPLICIT ALLOWANCE WAIT` or `DECISION ON CENSORED BATTERY` | 24 |
| any unaccepted case; any non-result; a terminal other than `completed`; submit strikes | 25 |
| a `posture` stretch `adrift` or `unreadable`; 4e `MEMORY OVER READ CAP` | 26 |
| `gates` `GATE STALL`, `GATE CLEARED WITHOUT EDIT`, `BELOW-BAR GATE FIRED`, `UNLEDGERED REFUSAL CODE`, `REVIEW HOLD CHAIN` or `CEILING ENDED RUN`; a defect a battery found that a gate owns | 27 |
| `gates` `EVALUATION CORRECTION REPLAY CANDIDATE`; an issue left `unmeasured` across a correction | 28 |
| `target` `HARDWARE TARGET NAMED`; lane 30 also needs verified cases above zero | 29, 30 isolated |
| standing at every tier; lane 1 or 29 reporting an obligation of the request no check observes | 31 |
| 2b `CENSUS WITH DISAGREEMENT`, beside lane 16; standing at `deep` | 32 |
| standing at `standard` and `deep`; row F's F2 completion | 33 |
| standing at every tier; 1b `CHECK CODE IN SOLVER REACH`; read beside lane 23 when 1b `CHECK TOOL IN SOLVER TRACE` fires | 34 |
| 6b `VERSION TOOLCHAIN DANGLING`; 1c `PERFECT BATTERY OVER AIM` | 35 |
| `climb` `CLIMB FLAT`, beside lane 10 | 36 |
| standing at `standard` and `deep` | 37 |
| 3b `FAMILY UNMOVED all-fail`; any verified fail, opened by hand when no row fired | 38 |

A missing trigger does not settle the semantic question: it says the arithmetic found nothing,
which is different from the property being absent. Block 3b's `AGGREGATE HIDES FAMILY`, `FAMILY
UNMOVED all-pass` and `UNOBSERVED FAMILIES` and block 5b's `SERVED MODEL MISMATCH` and `UNATTESTED
ROWS` stay with the primary, because a family split and an identity claim are bindings rather than
questions for a lane; a family that passes every case round after round is read beside lanes 5 and
35 through the placement. Lanes 3, 4, 8, 13 and 19 have no digest trigger: they open on what the
primary reads in rows C, D and H and in the earlier notes, which is why the tiers' default sets
carry some of them ([the session index](session-index.md#tiers)).

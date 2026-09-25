# Deterministic lanes

Eleven readers, one question each, no provider call. `review-angles.md` holds the semantic lanes a
paid sweep spends on; this file holds what a local read already answers, so a live run can be
assessed without one, and it names the trigger string each reader prints beside the semantic lane
that string starts. Every reader is a lane of `scripts/wri.mjs`, selected by name:

```text
bun .claude/skills/whole-run-investigation/scripts/wri.mjs <lane> <campaign>/<runId> [flags]
```

The lanes are `snapshot`, `challenge`, `delta` and `overview`, which collect; `climb`, `yield`,
`posture`, `timeline`, `walls` and `handoff`, which read the campaign; and `archive`, which
writes the record. `brief.mjs` runs the six campaign lanes as `CAMPAIGN_LANES` and renders their
trigger lines into the sweep brief, so a trigger below is the same bytes whether it was read from
a lane's own output or from the brief.

## The digest

`snapshot` runs `digest.mjs` over the run and prints numbered blocks. Each block is one question,
and the blocks that start a semantic lane print a capitalised trigger before the first colon of a
line. The trigger carries its lane in parentheses where one lane owns it; a trigger without a
suffix is settled by the primary reviewer under the row it belongs to, or mapped by the brief to
more than one lane.

Block 1, declared check by evidence, joins every declared check to its evidence kind and the tool
that decided it, and prints `in-process` where no installed tool did, which starts lane 1. Its
`UNTRIPPED IN SHIPPING` counts reject controls whose declared check never fired on a shipping
case; it carries no suffix because the brief maps it to lanes 5 and 6. Block 1b, solver process,
reads the solve traces for the tools the solver called, and `CHECK TOOL IN SOLVER TRACE (lane 23)`
says a verifier-side tool appeared in a solve, which lane 22 reads as a lead and lane 23 settles
alone. Block 1c, check informativeness, sets the reach of the controls against what shipping
tripped: `REACH-ONLY CHECKS (lane 6)` names checks the controls reach and no shipping case ever
failed, and `PERFECT BATTERY OVER AIM (lane 5)` says every scored case passed on a battery the
band placed over its aim.

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
reads `difficulty-decisions/<runId>-<digest>.json` (`difficulty-decision/v6`) for the
`placement.zone`, the target result and the off-aim allowance: `TARGET MISSED (lane 10)` where
the declared `target` reads `missed`, and `OFF-AIM STREAK (lane 10)` where the allowance's rounds
have reached `POLICY.climb.offAimStreakRounds`; an over-aim zone with no trigger of its own is
read by lanes 5 and 12. Block 4c, role spend and censoring, reads `providerResourceBudget.byRole`
and the retry rows: `REVIEW TURNS EXCEED SOLVER TURNS (lane 24)`, `DECISION ON CENSORED BATTERY
(lane 24)` where a decision was taken on a battery the environment cut short, and `EXPLICIT
ALLOWANCE WAIT (lane 24)` where a `turnRetries[]` reason names an allowance reset clock. Block 4d,
the admission and epoch-review ledger, reads `analysis/<runId>-epoch-review.json` and
`-admission.json`: `FINDINGS WITHOUT PROPOSED OWNER (lane 14)` and `ADVISORY FINDING RECURS
UNROUTED (lane 14)`. Block 4e, Builder memory, reads `MEMORY.md` against `MEMORY_CAP_BYTES` and
prints `MEMORY OVER READ CAP (lane 26)`.

Block 5, integrity probes, and block 5b, served-model attestation, belong to rows H and I:
`SERVED MODEL MISMATCH` and `UNATTESTED ROWS` carry no lane suffix because the primary settles
them. Block 6, the rehearsal ledger, joins every `harness_trial` row to the accepted submit by
`candidateId`: `SUBMITTED BYTES NEVER REHEARSED (lane 11)` and `REHEARSAL CONTRADICTS TARGET
(lane 11)` where a rehearsed pass sits against the plan's own prediction, and `REHEARSAL NOT-RUN
(lane 9)` where a verdict is `not-run`. Block 6b, toolchain retention, reads each
`versions/<id>/.toolchain` without following it: `VERSION TOOLCHAIN IS A SYMLINK (lane 2)`,
`VERSION TOOLCHAIN DANGLING (lane 2)`, and `WRAPPER-ONLY TOOL DIGEST (lane 2)` where a
`verifierTools[]` entry of `kind: "script"` hashes a wrapper and nothing behind it.

## The other collect lanes

`challenge` runs `trace-challenge.ts`, which writes `trace-telemetry.json`
(`whole-run-trace-telemetry/v1`), `trace-challenge-packet.json` and
`trace-challenge-status.json` under the snapshot. The telemetry is public to every lane, and lanes
8 and 22 read its sequence counts; the packet is private to lane 23 and is read after the
telemetry, never before.

`delta` runs `source-delta.mjs` between the run's `source.commit` and the review tree, and prints
`MODEL-VISIBLE SURFACE CHANGED (lane 21)` where a prompt-bearing file moved, and `UNREACHED
CHANGED SAFEGUARDS (lane 21)` where a `safeguardTriggered("id")` call changed and
`SAFEGUARDS_LOG.txt` under `campaigns/<slug>/safeguards/<runId>/` holds no line for it. A delta
touching `src/solve` starts lane 3 and one touching `src/review/epoch-review-public.ts` starts
lane 13.

`overview` runs `run-overview.mjs`, which groups every trigger the collect lanes printed by the
lane suffix it carries, so the brief can say which lanes have something to read.

## The campaign lanes

`climb` runs `climb-velocity.mjs` over consecutive versions and labels every edge `restated`,
`adjusted`, `narrowed`, `widened`, `eased` or `escalated`; `adjusted` states no direction itself,
but its drift row counts each moved number as tightened or loosened where both batteries declare one
comparison direction for it, and as unknown everywhere else. Every label starts lanes 10 and 20.

`yield` runs `review-yield.mjs` and gives each review component a status per finding —
`consumed`, `unobservable`, `advisory-only` or `not-consumed`. The `epoch-reviewer` component is
read first by lanes 12 and 14, and the `harness-trial` component by lane 11.

`posture` classifies `builder-prose.jsonl` through `classifier/prose-classify.mjs`; a run under
the row floor is `thin`, and a capture the reader refuses leaves the posture `unreadable`, both of
which lane 26 reads as a statement about the writer or the reader rather than the Builder.

`timeline` reads `observability/<runId>.jsonl` and prints the `STALLS` longest gaps; a gap over
thirty minutes starts lane 24, and `--classify` labels each stretch `adrift` or `unreadable`
through `classifier/run-narrative.mjs`, where `adrift` starts lane 25.

`walls` runs `walls.mjs`, whose `boundOf` labels every case `unrecorded`, `time-bound`,
`turn-bound`, `unstarted`, `submitted` or `no-submit`, and prints each bound's share against
`BOUND_SHARE`; a battery whose solves sit at a bound starts lane 22, and one whose solves all sit
at a tiny share of it starts lane 8.

`handoff` runs `handoffs.mjs` and prints four tables, each labelled with the lane it starts: the
census per channel (present, served, read, acted) for lane 17, the calibration table for lane 10,
the triage table for lane 15 and the same-task table for lane 18.

## The archive

`archive` writes the sweep's record under `wri-archive/v2` from the lanes above and the semantic
reports, and `validate-archive.mjs` and `validate-reports.mjs` refuse a record whose digest
verdicts or lane titles are not the catalogue's. The digest verdict set is the block list above,
so `band-placement`, `rehearsal-ledger` and `toolchain-retention` are verdicts and a saturation
ledger is not.

## Tiers

`brief.mjs` decides the tier from the run's shape and bounds the semantic lanes it may launch, by
trigger first and by the default set only where no trigger picks: probe, which is a run not scored
or under two hours, launches four lanes, by default 5, 8, 12 and 25; standard launches eight, the
probe set plus 1, 9, 14 and 24; deep, which is twelve hours, three epochs or three batteries,
launches fourteen, the standard set plus 2, 6, 10, 11, 13 and 22. Twenty-six is the ceiling. Lanes
7 and 23 sit outside every tier and are launched alone, only when their own trigger fired.

---
name: whole-run-investigation
description: "Investigate a live, stalled or completed Anabasis run and turn findings into an evidence-bound fix proposal. Also answers whether a campaign is climbing: how the climb is going, whether the batteries are getting harder, why a difficulty decision keeps repeating, how to climb faster, why the controller chose its action. Also the narrow read: reviewing one campaign run or recorded case through its outcomes, whether a live run is still producing useful evidence. Reads evidence; does not launch the next experiment or stop a run."
---

# Whole-Run Investigation

Explain what the run produced, where useful work stopped, and which change the evidence supports.

A whole-run investigation reads one recorded run — its opening, its epochs, its batteries, its
claims, its reviews and the source it was launched from — against the request the run was launched
to answer, and ends in one adjudicated note that says what the run demonstrated, what limited it,
and which owner the next change belongs to. It reads evidence and proposes. It launches nothing,
stops nothing and changes no score: `run-improvement-campaign` chooses the next experiment,
`launch-run` starts or stops a run, and the host verifier stays the one owner of every pass.

Two narrower reads need no lane at all. A question about one run or one case — its denominators,
a non-result's owner, whether a live run is still worth its spend — is answered from the recorded
rows by [the outcome reference](references/outcome-review.md). A climb question starts at
[the climb reference](references/climb.md), which reads the recorded difficulty decision and the
task bytes and says whether a battery got harder or only different.

## The deterministic read comes first, and it chooses the rest

Eleven local readers cost nothing but compute, and between them they already name the run's size,
its three denominators, what moved between batteries, which of its own walls bound it, what each
slot was doing while the clock ran and what the digest flagged. A paid lane opened before that read
spends on a question the read would have answered for free, or would at least have sharpened into
a trigger; and a paid lane opened without a trigger is a lane spent on inventory. So the read runs
first, always, and its triggers are what choose the semantic lanes.

```text
bun --no-env-file .claude/skills/whole-run-investigation/scripts/wri.mjs lanes
bun --no-env-file .claude/skills/whole-run-investigation/scripts/wri.mjs scope <runId | campaign dir>
bun --no-env-file .claude/skills/whole-run-investigation/scripts/wri.mjs read <runId | campaign dir> \
  --out <absolute review dir> [--all | --lanes 5,yield] [--run <runId>] [--repo <abs>]
```

A target is a campaign folder, its `controller/<runId>` folder or a bare run id, which `wri.mjs`
looks up in the main checkout's campaign tree. `scope` sizes the run from its own recorded bytes,
and `read` with no `--lanes` reads what that size earns. Every lane's output is captured to
`<review>/<lane>.txt`, the read is recorded in `<review>/wri-review.json`, and the command prints
one bounded brief instead of the captures: the run's size and terminal, each lane quoted whole or
pointed at, then the digest triggers and scan findings the snapshot lane raised. **Read the brief,
not the lane files** — the whole read is the size of a paid lane's context — and open a lane file
only once the brief has made that lane the question. `wri.mjs brief --out <review>` re-renders it.

| tier | the run | lanes read | semantic lanes to start from |
| --- | --- | --- | --- |
| `probe` | under two hours, or no case has scored yet | the six that read campaign bytes alone: `climb`, `yield`, `posture`, `timeline`, `walls`, `handoff` | 4 |
| `standard` | a scored battery, under twelve hours and under three epochs | all eleven | 8 |
| `deep` | twelve hours or more, three epochs or more, or three batteries | all eleven | 14 |

Twenty-six is the ceiling, because there are twenty-six lanes. The triggers choose the lanes, and
the isolated two open only on a trigger; where no trigger picks, the brief falls back to a default
set — `probe` opens lanes 5, 8, 12 and 25, `standard` adds 1, 9, 14 and 24, and `deep` adds 2, 6,
10, 11, 13 and 22. The tier is a default and not a gate: `--lanes` and `--all` still select
whatever is asked for, a run the operator calls important earns the lanes its questions need rather
than the ones its clock earns, and the count is where to start rather than a quota to fill. A
`deep` run whose brief is quiet earns fewer; a `standard` run holding one unexplained mechanism may
earn more. `probe` withholds only the lanes that open the measured checkout or an archive, because
a battery that scored nothing gives them nothing to read.

Keep at most two whole-run investigations active at once across runs and conditions, counting
reviewed runs rather than the lanes within a review. With several runs to review, finish one before
starting the next: read it, launch its lanes, then turn to the second. Two half-read runs share one
reader's attention and neither brief gets used.

## What the primary settles itself: rows A to I

Nine deterministic rows are the primary's own bindings and never a subagent's. Their bodies are the
first section of [the catalogue](references/review-angles.md), and their titles are the
`DETERMINISTIC_ROW_TITLES` of `scripts/catalogue-shape.mjs`, so the manifest and the archive
validator read the same nine names this file does:

| row | binds |
| --- | --- |
| A campaign identity | run id, full `source.commit`, request digest and the three model slots from `opening.json` |
| B claim and promotion state | the claim, its readiness, the `product-promotion/v1` record and `selectInitialProduct` for a first adoption |
| C workspace and Git | committed trees, ancestry, `workspaceChange`, starter and public-task transitions |
| D static conformance | the snapshot and its conformance receipts |
| E fingerprint and gate census | byte hashes, the `control-receipt/v2` rows and the immutable snapshot `submit` and `correctness_check` share |
| F F2 solvability | the solvability receipt and `verifier.json`'s `checkReceipts` |
| G case partition | verified, unaccepted and typed non-result counts through the closed case classifier |
| H runtime identity and isolation | recorded identities, policy evidence, trace hashes, every tool run's `source` (`workspace-toolchain` or `host`) and digest, and `verifierEnvironmentHash` |
| I served-model attestation | attested, unattested and no-completed-turn identity rows against the Built pin |

Read `controller/<runId>/opening.json` first. Record the full `source.commit` and its first nine
hex characters, the request, the model slots and the dirty disclosure, and inspect that exact
source: a missing Git object is `source-unresolved`, and current source explains an older run only
through an ancestry and changed-path check. Keep the review procedure's own revision separate.

The digest settles ten verdicts beside those rows, in the order `DIGEST_VERDICTS` lists them:
discrimination-inertness, submit-stall-shape, evidence-integrity, solver-process,
check-informativeness, family-wise-coverage, role-spend-and-censoring, band-placement,
rehearsal-ledger and toolchain-retention. Each verdict is arithmetic over recorded rows and
supplies a lead, never a semantic conclusion: no shipping rejection does not make a check useless,
a constant tool sequence does not prove an answer shortcut, and a perfect battery proves that no
limit was measured, not why.

## From trigger to lane

Every digest block that finds something prints one capitalised trigger row — the text before the
first colon — and the lane it argues for in parentheses, so the brief is itself the map from what
the read found to the lane worth paying for. The table below is that map in one place. Name each
semantic lane against a row of the brief: the trigger, the question it settles and the decision it
could change.

| deterministic trigger | lane |
| --- | --- |
| block 1 `UNTRIPPED IN SHIPPING`; 1c `PERFECT BATTERY OVER AIM`; a 4b placement over the aim | 5 |
| block 1 `UNTRIPPED IN SHIPPING`; 1c `REACH-ONLY CHECKS` | 6 |
| 6b `VERSION TOOLCHAIN IS A SYMLINK`, `VERSION TOOLCHAIN DANGLING` or `WRAPPER-ONLY TOOL DIGEST` | 2 |
| an artifact root or declared input that no check reads; a relation no check enforces | 1 |
| 6 `REHEARSAL NOT-RUN` | 9 |
| 4b `TARGET MISSED` or `OFF-AIM STREAK`; the `handoff` calibration table; a `climb` edge label beside a placement | 10 |
| 6 `SUBMITTED BYTES NEVER REHEARSED` or `REHEARSAL CONTRADICTS TARGET`; the `yield` `harness-trial` row | 11 |
| the `yield` `epoch-reviewer` row; a review the census marks incomplete | 12 |
| 4d `FINDINGS WITHOUT PROPOSED OWNER` or `ADVISORY FINDING RECURS UNROUTED`; the `yield` `epoch-reviewer` row | 14 |
| the `handoff` triage table | 15 |
| 2b `CENSUS WITH DISAGREEMENT` | 16 |
| the `handoff` census table | 17 |
| the `handoff` same-task table | 18 |
| 3c `REPEATED CONDITION`; a `climb` edge label | 20 |
| source-delta `UNREACHED CHANGED SAFEGUARDS` or `MODEL-VISIBLE SURFACE CHANGED` | 21 |
| a `walls` case `time-bound` or `turn-bound`, or a pass at a wall; one-turn solves at a tiny share of the solve wall | 22 |
| 1b `CHECK TOOL IN SOLVER TRACE`; verified cases with lane 4, 8 or 22 suspecting a shortcut; the private `trace-challenge` packet | 23 |
| a `timeline` stall or gap over thirty minutes; 4c `REVIEW TURNS EXCEED SOLVER TURNS`, `EXPLICIT ALLOWANCE WAIT` or `DECISION ON CENSORED BATTERY` | 24 |
| any unaccepted case; any non-result; a terminal other than `completed`; submit strikes | 25 |
| a `posture` stretch `adrift` or `unreadable`; 4e `MEMORY OVER READ CAP` | 26 |
| verified cases, with lane 5 or 6 reading slack | 7 |

A missing trigger does not settle the semantic question: it says the arithmetic found nothing,
which is different from the property being absent. Block 3b's `AGGREGATE HIDES FAMILY`, `FAMILY
UNMOVED` and `UNOBSERVED FAMILIES` and block 5b's `SERVED MODEL MISMATCH` and `UNATTESTED ROWS`
stay with the primary, because a family split and an identity claim are bindings rather than
questions for a lane. Lanes 3, 4, 8, 13 and 19 have no digest trigger of their own: they open on
what the primary reads in rows C, D and H and in the earlier notes, which is why the default sets
above carry some of them.

## The twenty-six lanes

The catalogue is exactly twenty-six semantic lanes, in one file after the rows, each a contiguous
`**N. Title.**` heading that `scripts/catalogue-shape.mjs` counts as `ANGLE_COUNT`. Each asks one
sharp question, and they fall into six groups. One independent `gpt-5.6-luna` session at `max`
per lane is the shape of a lane; [Codex Luna Swarm](../codex-luna-swarm/SKILL.md) owns transport
and collection, and there is no coordinator and no further delegation. Honour an explicit
supported model, effort and grouping override through the matching transport.
When the operator asks for Luna, run one session per lane and never group lanes. A Luna or Codex
lane is read-only. A native lane, a Claude subagent run from `prompts/`, may also repair a finding
it proved, one commit per finding in a worktree of its own and never a push; the primary folds
those commits in the way it folds any lane's.

Product validity:

1. **Request-to-verdict chain.** What the verdict observes — compile, host double, target execution
   or hardware — and the unenforced relations that invert on the real target.
2. **Executable verifier dependency closure.** Which bytes and runtime facts decided: wrapper-only
   `kind: "script"` digests, a symlinked or dangling `versions/<id>/.toolchain`.
3. **Authoring-to-host contract compatibility.** Can a legitimate authored check execute through the
   real host contract?
4. **Operating guide and roster truth.** The guide, tool descriptions and payloads against the
   declared roster and the walls; an undeclared tool named; a payload that hands over a decision.

Difficulty:

5. **Limit slack against the reference.** Limits anchored to the Builder's accept or reference,
   shipping margin to every boundary, perfect batteries over the aim.
6. **Check discrimination and binding.** Reject reach against shipping reach, ids or labels a check
   cannot bind to geometry, reach-only checks.
7. **Valid-alternative rejection challenge.** Isolated: a public-only corpus frozen before verifier
   internals, run through the recorded verifier, reported as the 2×2.
8. **Public disclosure and one-recipe.** Do the brief or the tools publish a sufficient construction
   algorithm; are the solves transcription.

Calibration:

9. **Rehearsal instrument reach.** The rehearsal verifier deadline against the declared check walls;
   not-run verdicts; which families it can grade at all.
10. **Difficulty calibration loop.** Prediction against `FRAME` counts against measured, round over
    round; target comparator against the aim; the off-aim streak.
11. **Submit decision against rehearsal evidence.** An unrehearsed submitted candidate; a rehearsal
    pass contradicting an `at-most` target; what the Builder did with each verdict.

Review loop:

12. **Epoch Reviewer standing duties.** Did each standing duty in the reviewer prompt fire, the
    publication ceiling among them; reviews mislabelled incomplete.
13. **Public-safe feedback sufficiency.** What the model-visible projection kept: the fixed
    `publicAct` wording against the concrete defect.
14. **Finding routing and recurrence.** Finding → admission → owner; advisory findings recurring
    unrouted; the recurrence key.
15. **Harness-versus-evaluation triage hand-off.** What the diagnosis, the Epoch Reviewer and the
    advice packet said per failing family, and which side the successor moved.
16. **Judge disagreement adjudication.** A Judge fail on a verifier pass: Judge error or verifier
    defect; advice noise from a miscount.

Hand-offs and attribution:

17. **Round hand-off census.** Per channel: present, served, read back, acted on.
18. **Same-task repair measurement.** Consecutive batteries joined per family on public-input
    digests: did the same task move.
19. **Semantic repair closure.** Did the successor fix the same defect, or a neighbour of it.
20. **Task movement and attribution.** Accepted bytes against the `EXPERIMENT.json` scope; numbers
    moved without new reasoning; a repeated public condition.
21. **Source-delta reach.** Did changed source reach any executed branch; a model-visible surface
    changed.

Solver, time and failure:

22. **Solver process and walls.** Time-bound, turn-bound, submitted at the wall, one-turn solves,
    telemetry.
23. **Trace challenge.** Isolated: the private trace-challenge packet; derivation against reading the
    answer.
24. **Time, spend and provider waits.** Long gaps classified — explicit allowance wait, generic 429
    or timeout, Builder rehearsal, review clock; review turns against Built turns; shared-account
    contention.
25. **Failure mechanism and non-result honesty.** The earliest broken link per consequential
    failure; whether the typed kind is honest, such as a fail reclassified as a `verifier`
    non-result.
26. **Builder memory and posture.** Memory carry-forward and read-back, the read cap, whether the
    prose capture is readable.

Lanes 7 and 23 are isolated, and `ISOLATED_ANGLES` in `catalogue-shape.mjs` is what enforces it:
lane 23 alone receives the private packet `scripts/trace-challenge.ts` writes, and lane 7 freezes
its public-only corpus before it reads verifier internals or any other lane's report.
`MIN_AUTO_SESSIONS` is therefore three — the two isolated seats plus one — and the manifest
refuses a grouping that crosses either boundary. Sessions are contiguous runs of the catalogue,
so when both isolated lanes have fired, `--auto` needs five sessions: lanes 1 to 6, lane 7,
lanes 8 to 22, lane 23 and lanes 24 to 26. An isolated lane whose trigger did not fire is dropped
from an auto grouping with a line on stderr, and refused outright when named under `--sessions`. Shared orientation and context stay free of case
verdicts, verifier-derived selection hints and other lanes' conclusions, because a lane told what
to find finds it. Every other lane may be grouped under an explicit override; grouping is never
the default.

## The sequence

`read`, then `launch --sessions` with the lanes the brief argued for, is the ordinary path.
`collect` then `launch` is the same path with a stop between them, for when the lanes need
direction; `review` is the "all" path, for a run the operator asked to sweep whole.

```text
bun --no-env-file .claude/skills/whole-run-investigation/scripts/wri.mjs collect <target> --out <review>
bun --no-env-file .claude/skills/whole-run-investigation/scripts/wri.mjs launch \
  --out <review> --sessions 5,11,25 --effort max --title <t> [--notes <f>] [--context <f>]
bun --no-env-file .claude/skills/whole-run-investigation/scripts/wri.mjs finish --out <review>
bun --no-env-file .claude/skills/whole-run-investigation/scripts/wri.mjs review <target> \
  --out <review> --repo <measured-source checkout> [launch options]
```

`collect` runs the four lanes the paid lanes consume — `snapshot`, `challenge`, `delta` and
`overview` — and writes `<review>/overview.json` from recorded bytes (terminal, denominators,
budget, versions, task set, grouped digest triggers, scan findings) and
`<review>/shared-instructions.json`, the one file the primary edits: a `template` of lines carrying
`{placeholder}` tokens and a `values` map filled from the overview. Every lane reads the rendered
template as `## Run overview`. Edit any value, add a value and its token, reorder or drop template
lines, and fill the two authored values `orientation` and `movedVariable` before `launch`; a token
without a value refuses the launch, and a line whose value is empty is dropped. The snapshot lane
is `trace-review.mjs`, also reachable as `bun run review:collect`; it makes no model calls, reports
a missing view inside `snapshot-status.json` rather than failing, and a new deterministic question
belongs there as another view rather than in a further collection script. Require `complete: true`
in that status before treating the snapshot as complete.

`launch` opens exactly the named lanes and nothing else. `--sessions 5,11,25` names lanes; `--lanes N`
asks `build-manifest.mjs --auto N` to group every lane into N sessions without crossing an isolated
seat; `--effort`, `--title`, `--notes` and `--context` pass through. The manifest writes the shared
instructions, the WRI `tasks.json` and the transport `luna-tasks.json`, and each leaf receives its
exact lane body inline — never the whole catalogue, never a scope expansion, never authority to
change controller output. Watch `<review>/lanes/luna-output/summary.json`; each lane's report
lands beside it as `<name>.md` as it finishes.

`finish` runs `validate-reports.mjs` over `tasks.json` and that summary, requiring one terminal
result per task and matching prompt, report and heading identities. Under each owed `## lane_NN`
heading the report carries `### Started from`, `### Evidence read`, `### Findings` and
`### Not established`, each once, in that order and non-empty, and every finding names an
`owner:` from the nine `FeedbackOwner` values plus `controller-source` and `judge`
(`FINDING_OWNERS` in `manifest-reporting.mjs`, which the leaf prompt spells out). A report that
breaks that shape is refused with the exact section named; a failed or absent report is
missing work, and one retry is permitted within the authorised cap. It then scaffolds
`<review>/archive/` from recorded bytes: `luna_syntheses.md` and `digest.md` from the reports and
the snapshot, `review.json` from those plus `verdicts.json`, and a `main_synthesis.md` skeleton
written once. The first `finish` writes the `verdicts.json` template with every state
`inconclusive`; record the states and reasons there, write `main_synthesis.md`, and run `finish`
again until the archive validator passes. Safeguard rows count firings from the run's
`SAFEGUARDS_LOG.txt` and the launcher stderr the verdicts name; with neither file the count is
unavailable, never zero, and a count proves a firing rather than that its owner received it.

## The lanes that read one thing each

Six lanes run in-process and are subcommands of their own, printing the view, its JSON under
`--json`, and recording the JSON at `--out`:

```text
bun --no-env-file .claude/skills/whole-run-investigation/scripts/wri.mjs \
  delta | climb | yield | timeline | walls | handoff  <target> [--run <runId>] [--json] [--out <abs file>]
```

**`delta`** diffs the measured source against the run's predecessor (`--previous <commit | abs
campaign dir>`, `--repo <abs>`) and prints paths and counts only, never source text. Its two
triggers are `UNREACHED CHANGED SAFEGUARDS`, a change present in the tree with no matching firing
in the run's logs, and `MODEL-VISIBLE SURFACE CHANGED`; both send the reach question to lane 21,
and the second sends the attribution question on to lane 20.

**`climb`** reads the task bytes under `versions/`, so an edge is readable the moment its later
candidate is adopted and before a single case of it has been paid for. Per battery it reports the
check-tier histogram and a structural row; per edge it says `restated`, `adjusted`, `narrowed`,
`widened`, `eased` or `escalated`, and only `escalated` changes what a solver has to reason about.
An edge label is read first by lane 20 for what moved, and by lane 10 beside the placement it
produced. [The climb reference](references/climb.md) owns what to do when that reading and the recorded
difficulty decision disagree, which they do whenever a battery scores well on tasks that did not
move. `classifier/query-complexity.mjs` is the same reader over an exported query pack.

**`walls`** reads `agent/config.yaml`, the one file the Builder writes that nothing inspects again
after the gate, and classes each case `time-bound`, `turn-bound`, `unstarted`, `submitted` or
`no-submit` against the declared walls, with the median and maximum share of the solve wall spent
and the tool calls per case. A turn is one outer prompt carrying an unbounded tool loop, so the
lane states tool calls rather than a turn share. Lane 22 reads it first. The reading that changes a decision is usually the
negative one — no wall moved and the median case spent a small fraction of its minutes, so nothing
about the outcomes is explained by room — and when a case does reach a wall without passing, the
verdict rests on a truncated solve.

**`timeline`** says where the wall-clock went: elapsed time by phase, the longest gaps between
consecutive rows and the row each sat behind, prompts by contract and role, hook activations,
steering by authority. With `--classify` it adds what each slot was doing while it went there,
through the same pinned embedding `posture` uses, and reports every stretch of five or more
consecutive units of one kind resolved to the run's phase at that moment. `unreadable` means the
classifier's margin stayed under the floor and its labels say nothing about the model; `adrift`
means it read no progress five times running. The two are separate claims and never merged. A
stall goes to lane 24.

**`yield`** asks, per advisory review component, whether its output reached something the
controller recorded: opportunities, outputs, consumed and changed, as separate counts with their
denominators. `epoch-reviewer` is read first by lanes 12 and 14, and `harness-trial` first by lane
11 — for the latter the opportunities are the round's tasks, the outputs its rehearsals, and a
consumed output is a submit whose candidate was rehearsed.

**`handoff`** holds four tables of what one round hands the next: the per-channel census of
present, served, read back and acted on (lane 17); the calibration table of rehearsals and declared
target against verified passes (lane 10); the triage table of what the diagnosis, the Epoch
Reviewer and the advice packet said per failing family and which side the successor moved (lane
15); and the same-task table joining consecutive batteries per family on public-input digests
(lane 18). A
served marker is a sentence the current source renders, so an absent marker reads `not found`,
never `not served`.

**`posture`** is `classifier/prose-classify.mjs`, the pinned local embedding labelling every
captured Builder and solver prose row with the nearest of thirteen anchored postures under
`run-prose-posture/v5`. It verifies the execution and sidecar joins before labelling anything and
returns `integrity-failure` rather than a posture when they disagree. Sessions the controller
closed as a typed non-result contribute no posture, because their prose is the provider's. A label
is a lead for explaining an already-observed refusal, stall or case kind, never a score; lane 26
reads it first.

**`archive`** runs the archive validator over the archive `finish` wrote for this run, when one
exists under `notes/runs/`.

## Adjudicate and report

Treat lane reports as research. Check every consequential claim against the exact source and the
actual consumer, reconcile totals with the verified readers, and resolve a disagreement by what
each method can observe — neither confidence nor abstention wins. When a premise fails, revisit
the findings built on it and your own earlier claims, and name what survives. Collapse repeated
symptoms under their earliest demonstrated owner. Close a weak link a bounded command can decide;
keep an unresolved rival and its next discriminator where the instrument cannot see the property.

Four kinds of sentence may be written, and each needs its own evidence. **Safety**: the system
refused a bad or unprovable result. **Mechanism**: the intended branch executed and wrote its
evidence. **Capability**: verified artifacts passed the verifier under the named condition, and the
sentence names the recorded tool source and digest, because a Builder-authored checker is not
independent. **Limit**: one fixed harness reached a pre-registered semantic level and the deepest
stable result was observed. Prompt assertions prove text, types prove shape and gates prove the
conditions they test; none of them proves better model behaviour, and neither does a started run,
PR prose or a reference artifact. Separate source presence, deterministic proof, live exercise and
outcome proof, and report verified, unaccepted and non-result counts apart, with the capability
rate over verified cases alone.

Lead with the useful result, the material gap, the exact source and the separate denominators.
Index the work once through [CHECKLIST.md](CHECKLIST.md); a targeted review records the admitted
rows and its material omissions, and an exhaustive one records every catalogue row. Name missing
reports and unexecuted checks. For a live run, capture the T0 identities and counts before the
lanes and T1 separately before synthesis; retain findings on unchanged bytes, mark changed-artifact
findings stale, and never mix later evidence into T0 denominators.

Each retained proposal names its evidence, owner and consumer, the smallest coherent change, the
expected effect, the falsifier and the comparison that could decide it. Return no repair when the
evidence supports a probe or a hold. End the recommendations with `What to do next` as Patch,
Consolidate and Overhaul, where a section may report no justified change. Use
[an independent review packet](references/external-review.md) only when another method can settle
a consequential dispute, and [the plan questions](references/improvement-plan-questions.md) when
the operator asks what to change next. A review alone authorises no PR or launch, and no source
edit beyond the native lanes' own commits.

## The archive and the note

A whole-run investigation ends in one adjudicated note under `notes/investigation-YYYYMMDD-<topic>.md`
— local and ignored, so never published — beside the four-file archive `finish` scaffolded, copied
to `notes/runs/<runName>/` when it is durable. Its working review directory, the `--out` of `read`
and `launch`, goes under `notes/wri-YYYYMMDD/<run>/`. The archive's four files:

- `main_synthesis.md`: adjudicated findings, limits, accounting and recommendations.
- `luna_syntheses.md`: the accepted reports in manifest order, with only whitespace normalisation
  and necessary protected-detail removal.
- `digest.md`: the verified, sanitised deterministic digest.
- `review.json`: `wri-archive/v2` identities, collection and coverage receipts, accounting and
  pointers into those four files. The validator refuses any other schema.

A targeted standalone answer needs no archive unless requested. The note is where the reader who
was not there starts: what the run showed, why that is not what they would have expected, and
what it does now instead, with each consequential claim marked as re-checked against the bytes or
resting on one lane's report.

Before proposing a remedy, read the earlier notes for the same mechanism: this checkout's `notes/`,
and for runs before the 2026-09-22 split, `/Users/air/Developer/harness-builder-v4/notes/`, which
also holds `current-state.md`, `handover/` and `run-failures/`. A mechanism that recurs
across runs has usually been found before, and its remedy is often already in the measured source
as a standing duty of some component — a reviewer prompt line, a gate, a sensor. When that is so,
the first question is not what new remedy to propose but whether the standing duty fired: read the
recorded reviews or the sensor's log for the run and say whether the duty was invoked, whether it
found the mechanism, and where its finding went. Lane 12 asks exactly that of the Epoch Reviewer's
duties and lane 14 of where the finding went. A second remedy for a mechanism whose first one
never ran adds a wall that pays no rent. Only when the duty demonstrably ran and the mechanism
survived it is a different owner the finding.

Check for protected verifier detail, raw prose, counterexamples and reference artifacts before
anything is written. Retain safe findings and evidence paths; never feed protected material to a
Builder, Judge, diagnosis or authoring prompt. Preserve frozen predictions and campaign-owned
adjudications: WRI can propose a refutation or an experiment, but creates no campaign event,
promotion or closure.

```text
bun --no-env-file .claude/skills/whole-run-investigation/scripts/validate-archive.mjs \
  --archive <absolute archive dir>
```

Read its exit status directly; a pipe must not turn refusal into success. The validator proves
shape and bindings, not the truth of the prose.

## Retired

The catalogue once held forty numbered angles, intelligence and reference-comparison sessions, two
diagnostic lanes and blinded pairs; it also read mechanisms the source
no longer has — the repair engineer, the progress guard, the judge-prompt maintainer, the Judge
control census and its bait, the paired promotion contest, the `DIFFICULTY.json` session, memory
curation, the `climb`, `hold-limit` and `ease` verbs and the saturation ledger. None of it is read
now, and none of it is a lane. The twelve former angles that kept a direct successor are renumbered
and their evidence rewritten against the current source; a finding an older note gives under any
other retired number is still a finding, and its mechanism is what to carry forward, under
whichever of the twenty-six lanes owns the question today.

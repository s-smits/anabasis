---
name: whole-run-investigation
description: "Investigate a live, stalled or completed Anabasis run and turn findings into an evidence-bound fix proposal. Also answers whether a campaign is climbing: how the climb is going, whether the batteries are getting harder, why a difficulty decision keeps repeating, how to climb faster, why the controller chose its action. Also the narrow read: reviewing one campaign run or recorded case through its outcomes, whether a live run is still producing useful evidence. Reads evidence; does not launch the next experiment or stop a run."
---

# Whole-Run Investigation

A whole-run investigation reads one recorded run — its opening, its epochs, its batteries, its
claims, its reviews and the source it was launched from — against the request the run was launched
to answer. It ends in one adjudicated note that says what the run demonstrated, what limited it,
and which owner the next change belongs to. It reads evidence and proposes. It launches nothing,
stops nothing and changes no score: `run-improvement-campaign` chooses the next experiment,
`launch-run` starts or stops a run, and the host verifier stays the one owner of every pass.

Four narrower reads need no lane at all. A question about one run or one case — its denominators,
a non-result's owner, whether a live run is still worth its spend — is answered from the recorded
rows by [the outcome reference](references/outcome-review.md). A climb question starts at
[the climb reference](references/climb.md), which reads the recorded difficulty decision and the
task bytes, says whether a battery got harder or only different, and finds the one link that holds
a flat line. A question about whether a
refusal or a declared check earns its place starts at [the gate audit](references/gate-audit.md),
whose `wri.ts census` prices every component and check across all recorded runs at once. And a
question about whether a new wave of runs is better than the one it replaced starts at
[wave-audit](../wave-audit/SKILL.md), which pairs each run with its baseline on one moved variable.

## Who held which pen

Every earlier version of this skill read a battery as though it were an independent exam, and it
is not one. The Builder wrote the tasks and their published limits, the checks that decide each
pass, the accept and reject controls that calibrate those checks, the reference solve that proves
each task feasible, the solver's tools, its operating guide and its walls. The host verifier owns
the verdict in the sense that nothing else may set it, but the property the verdict tests is
whatever the Builder's check reads. So a pass can mean an easy task, a check that observes too
little, or both, and a perfect battery cannot tell those three apart by itself.

That stance is the first section of [the catalogue](references/review-angles.md), which owns its
five readings, and every row and lane there is written from it. In short: weigh each verdict by its
independence from the Builder; name the tool bytes that executed, and treat a verdict whose bytes
can no longer be resolved as resting on an unestablished instrument; keep verified, unaccepted and
non-result cases apart; read Judge agreement as a second reading of the Builder's own rules rather
than as an independent test, because a fault both miss is invisible to both; and state every
finding's observation and its inferred cause as two sentences. Lanes 31 to 38 exist because these
are the places a self-authored exam is weakest, and the tiers open some of them on every run.

Earlier investigations reached diagnoses that read like settled facts, and they are not. Whether
the checks or the tasks carried more of what a pass measured, whether a handful of bundle files
held the flaw, whether the reference witness bounds the difficulty a Builder can publish, and what
a solver beating the reference says about the Builder's ceiling are all questions, and each run
answers them from its own bytes: lanes 5, 35 and 38 read the first, lane 31 the second, lane 33 the
last two. Carry an earlier note's conclusion into a lane as the hypothesis it is, never as its
premise.

One fact about the review loop is easy to get backwards, so it is stated here. The authoring Epoch
Review runs during the round, before the battery: each submit waits on `AuthoringReviews.join` in
`src/run/authoring-review.ts`, so a blocking finding about the tasks or the brief was in front of
the Builder before anything was measured. A battery review runs again afterwards. Read both.

## Distrust the reader before the run

A figure reaches the synthesis through a reader, and several of the readers an investigation
leans on have reported something other than what their name says. So before a number enters a
finding, name the reader that produced it and check it against one join the reader did not make.

The recurring failures are few and concrete. A campaign slug carries a numeric suffix, and two
neighbouring suffixes can hold runs of the same request, so a run id matched against the wrong
suffix reads another run's batteries; resolve the campaign from `opening.json`, never the reverse.
The `ana-run-*` evidence trees expose `campaigns` as a symlink into the main tree, so a sweep over
both counts one campaign twice unless every path is resolved to its real location first. An
exporter or a history reader that counts scored rows counts unaccepted cases too, since an
unaccepted case carries `pass: false`; the climb history's `n` is such a count, and a persisted
claim's `n` may be. A reader built against one schema can read a neighbouring schema's field of the
same name, which is why rows G and H recount through the owning classifier rather than quoting an
export. And a marker a reader searches for is a sentence the current source renders, so an absent
marker reads `not found`, never `not served`.

The same distrust applies to the readers in this skill, and to its catalogue. A trigger that did
not fire says the arithmetic found nothing, which is different from the property being absent. A
lane report is research until its consequential claim has been checked against the exact source
and the actual consumer. And where the review tree's reader and the measured tree's reader
disagree, the measured tree's is the one that ran; a newer reader's replay is a separate result.

## The deterministic read comes first, and it chooses the rest

Thirteen local readers cost nothing but compute, and between them they already name the run's
size, its three denominators, what moved between batteries, which of its own walls bound it, what
each slot was doing while the clock ran, which gate components refused and what that cost, which
hardware target the request names, and what the digest flagged. A paid lane opened before that
read spends on a question the read would have answered for free, or would at least have sharpened
into a trigger. So the read runs first, always, and its triggers choose most of the semantic lanes.
[The deterministic lanes reference](references/deterministic-lanes.md) owns what each reader prints
and which lane each trigger starts.

```text
bun --no-env-file .claude/skills/whole-run-investigation/scripts/wri.ts lanes
bun --no-env-file .claude/skills/whole-run-investigation/scripts/wri.ts scope <runId | campaign dir>
bun --no-env-file .claude/skills/whole-run-investigation/scripts/wri.ts read <runId | campaign dir> \
  --out <absolute review dir> [--all | --lanes 5,yield] [--run <runId>] [--repo <abs>]
```

A target is a campaign folder, its `controller/<runId>` folder or any selector `bun run runs show`
takes (a run id, a project, or the head or hex tail of an id), which `wri.ts` looks up in the main
checkout's campaign tree and refuses when it names more than one run. A run's records are read by
the source that wrote them, so `read` first resolves the checkout at the opening's `source.commit`:
`--repo` when it is clean there with its own dependencies installed, else such a registered
worktree (the review worktree `ana-wri-<sha8>` first, the run's own worktree last, another run's
never), else `ana-wri-<sha8>` created beside the main checkout and prepared from its own lock. Every
lane that reads the run's records then runs as that checkout's own script, and the brief's
`readers` line names it with every checkout passed over. A run no checkout can read is refused as
`source-unresolved` with exit 2 before any lane. `scope` sizes the run from its own recorded bytes,
and `read` with no `--lanes` reads what that size earns. Every lane's output is captured to
`<review>/<lane>.txt`, the read is recorded in `<review>/wri-review.json`, and the command prints
one bounded brief instead of the captures: the run's size and terminal, each lane quoted whole or
pointed at, then the triggers and scan findings the deterministic lanes raised, then the semantic
lanes those triggers start. **Read the brief, not the lane files**, and open a lane file only once
the brief has made that lane the question. `wri.ts brief --out <review>` re-renders it. A later
`read` of the same run into the same `--out` adds its lanes to the recorded review, and a lane
read again replaces only its own capture, so a narrower second read never drops the first.

| tier | the run | deterministic lanes read | semantic lanes to start from |
| --- | --- | --- | --- |
| `probe` | under two hours, or no case has scored yet | the eight that read campaign bytes alone: `climb`, `yield`, `posture`, `timeline`, `walls`, `handoff`, `gates`, `target` | 6: default 5, 8, 12, 25; standing 31, 34 |
| `standard` | a scored battery, under twelve hours and under three epochs | all thirteen | 12: the probe set plus 1, 9, 14, 24; standing 31, 33, 34, 37 |
| `deep` | twelve hours or more, three epochs or more, or three batteries | all thirteen | 19: the standard set plus 2, 6, 10, 11, 13, 22; standing 31, 32, 33, 34, 37 |

The standing lanes (`STANDING_LANES` in `scripts/brief.ts`) open on every run of their tier,
triggered or not, because the question each asks — does the brief ask what the request asks, does
a solver tool mirror the checks, what did the reference witness prove, how was the battery sized,
what did a Judge pass decide — is one a self-authored exam always raises and no digest block
detects. The default set is the fallback for a run where no trigger picks; where triggers pick, they
choose, and the standing lanes join them. Thirty-eight is the ceiling, because there are
thirty-eight lanes, and the isolated three open only on their own trigger.

The tier is a default and not a gate. `--lanes` and `--all` still select whatever is asked for, a
run the operator calls important earns the lanes its questions need rather than the ones its clock
earns, and the count is where to start rather than a quota to fill. `probe` withholds only the
deterministic lanes that open the measured checkout or an archive, because a battery that scored
nothing gives them nothing to read.

Keep at most two whole-run investigations active at once across runs and conditions, counting
reviewed runs rather than the lanes within a review. With several runs to review, finish one before
starting the next: read it, launch its lanes, then turn to the second. Two half-read runs share one
reader's attention and neither brief gets used.

## What the primary settles itself: rows A to I

Nine deterministic rows are the primary's own bindings and never a subagent's. Their bodies open
[the catalogue](references/review-angles.md), and their titles are the `DETERMINISTIC_ROW_TITLES`
of `scripts/catalogue-shape.ts`, so the manifest and the archive validator read the same nine names
this file does:

| row | binds |
| --- | --- |
| A campaign identity | run id, full `source.commit`, request digest and the three model slots from `opening.json`, with the campaign resolved from the run and every path resolved to its real location |
| B claim and promotion state | the claim, its readiness, the `product-promotion/v1` record and `selectInitialProduct` for a first adoption |
| C workspace and Git | committed trees, ancestry, `workspaceChange`, starter and public-task transitions |
| D static conformance | the snapshot and its conformance receipts |
| E fingerprint and gate census | byte hashes, the `control-receipt/v2` rows and the immutable snapshot `submit` and `correctness_check` share; the controls are the Builder's, so a clean census calibrates the checks around the Builder's own answers |
| F F2 solvability | the solvability receipt and `verifier.json`'s `checkReceipts`; F2 proves the submission path, and a reference that replays stored answers passes it exactly as a search does |
| G case partition | verified, unaccepted and typed non-result counts through the closed case classifier, recounting any exported figure that folded unaccepted cases into the verified ones |
| H runtime identity and isolation | recorded identities, policy evidence, trace hashes, every tool run's `source` (`workspace-toolchain` or `host`) and digest, `verifierEnvironmentHash`, and every deciding tool whose digest no longer resolves |
| I served-model attestation | attested, unattested and no-completed-turn identity rows against the Built pin |

Read `controller/<runId>/opening.json` first. Record the full `source.commit` and its first nine
hex characters, the request, the model slots and the dirty disclosure, and inspect that exact
source: a missing Git object is `source-unresolved`, and current source explains an older run only
through an ancestry and changed-path check. Keep the review procedure's own revision separate.

The digest settles ten verdicts beside those rows, in the order `DIGEST_VERDICTS` lists them:
discrimination-inertness, submit-stall-shape, evidence-integrity, solver-process,
check-informativeness, family-wise-coverage, role-spend-and-censoring, band-placement,
rehearsal-ledger and toolchain-retention. Each verdict is arithmetic over recorded rows and
supplies a lead, never a semantic conclusion. No shipping rejection does not make a check useless,
a constant tool sequence does not prove an answer shortcut, and a perfect battery proves that no
limit was measured, not why.

## From trigger to lane

Every digest block that finds something prints one capitalised trigger row — the text before the
first colon — and, where one lane owns it, that lane in parentheses. `LANE_FOR_TRIGGER` in
`scripts/brief.ts` maps each trigger to the lanes it starts, the suffixed lane first, so the brief
is itself the map from what the read found to the lane worth paying for. Name each semantic lane
against a row of the brief: the trigger, the question it settles and the decision it could change.

| deterministic trigger | lane |
| --- | --- |
| an artifact root or declared input that no check reads; a relation no check enforces | 1 |
| 6b `VERSION TOOLCHAIN IS A SYMLINK`, `VERSION TOOLCHAIN DANGLING` or `WRAPPER-ONLY TOOL DIGEST` | 2 |
| block 1 `UNTRIPPED IN SHIPPING`; 1c `PERFECT BATTERY OVER AIM`; a 4b placement over the aim | 5 |
| block 1 `UNTRIPPED IN SHIPPING`; 1c `REACH-ONLY CHECKS` | 6 |
| verified cases, with lane 5 or 6 reading slack | 7, isolated |
| 6 `REHEARSAL NOT-RUN` | 9 |
| 4b `OFF-AIM STREAK`; the `handoff` calibration table; a `climb` edge label beside a placement | 10 |
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
| 4b `OFF-AIM STREAK`, beside lane 10 | 36 |
| standing at `standard` and `deep` | 37 |
| 3b `FAMILY UNMOVED all-fail`; any verified fail, opened by hand when no row fired | 38 |

A missing trigger does not settle the semantic question: it says the arithmetic found nothing,
which is different from the property being absent. Block 3b's `AGGREGATE HIDES FAMILY`, `FAMILY
UNMOVED all-pass` and `UNOBSERVED FAMILIES` and block 5b's `SERVED MODEL MISMATCH` and
`UNATTESTED ROWS` stay with the primary, because a family split and an identity claim are bindings
rather than questions for a lane; a family that passes every case round after round is read beside
lanes 5 and 35 through the placement, not through a lane of its own. Lanes 3, 4, 8, 13 and 19 have
no digest trigger: they open on what the primary reads in rows C, D and H and in the earlier notes,
which is why the default sets carry some of them.

## The thirty-eight lanes

The catalogue is exactly thirty-eight semantic lanes, in one file after the rows, each a
contiguous `**N. Title.**` heading that `scripts/catalogue-shape.ts` counts as `ANGLE_COUNT`, and
each asks one sharp question. They fall into nine groups:

- **Product validity (1–4):** request-to-verdict chain; executable verifier dependency closure;
  authoring-to-host contract compatibility; operating guide and roster truth.
- **Difficulty (5–8):** limit slack against the reference; check discrimination and binding;
  valid-alternative rejection challenge, isolated; public disclosure and one-recipe.
- **Calibration (9–11):** rehearsal instrument reach; difficulty calibration loop; submit decision
  against rehearsal evidence.
- **Review loop (12–16):** Epoch Reviewer standing duties, authoring and battery reviews alike;
  public-safe feedback sufficiency; finding routing and recurrence; harness-versus-evaluation
  triage hand-off; Judge disagreement adjudication.
- **Hand-offs and attribution (17–21):** round hand-off census; same-task repair measurement;
  semantic repair closure; task movement and attribution; source-delta reach.
- **Solver, time and failure (22–26):** solver process and walls; trace challenge, isolated; time,
  spend and provider waits; failure mechanism and non-result honesty; Builder memory and posture.
- **The gate (27–28):** gate rent and confidence; evaluation-correction regrade.
- **Hardware ground truth (29–30):** hardware target coverage against public ground truth;
  ground-truth verdict comparison, isolated.
- **Authorship and instrument independence (31–38):** brief against the request; Judge pass
  decidability; reference provenance and witness strength; check mirroring in solver tools;
  independent recomputation of passes; difficulty pressure on the Builder; battery size and probe
  graduation; false rejection among verified fails.

One independent Luna session per lane, at the effort the operator names, is the shape of a lane;
[Codex Luna Swarm](../codex-luna-swarm/SKILL.md) owns the transport, the current model and the
collection, and there is no coordinator and no further delegation. Honour an explicit supported
model, effort and grouping override through the matching transport. When the operator asks for
Luna, run one session per lane and never group lanes. A Luna or Codex lane is read-only, except
that a session holding lane 29 or 30 runs inside, and may write, one scratch directory of its own,
`<review>/lanes/hw-scratch/<session>/`, which its prompt names: it builds adapters and compiler
output there and freezes its verdict file there. A native lane, a Claude subagent handed
`<review>/lanes/prompts/<name>.md` verbatim, may also repair a finding it proved, one commit per
finding in a worktree of its own and never a push; the primary folds those commits in the way it
folds any lane's. No launcher collects what a subagent returns, so the primary saves each native
report as `<review>/lanes/native-output/<name>.md`, where `finish` reads it.

Lanes 7, 23 and 30 are isolated, and `ISOLATED_ANGLES` in `catalogue-shape.ts` is what enforces
it: lane 23 alone receives the private packet `scripts/trace-challenge.ts` writes, lane 7 freezes
its public-only corpus before it reads verifier internals or any other lane's report, and lane 30
freezes its ground-truth verdicts before it reads verifier source or the recorded verdicts.
`MIN_AUTO_SESSIONS` is therefore four, the three isolated seats plus one, and the manifest refuses
a grouping that crosses any of those boundaries. Sessions are contiguous runs of the catalogue, so
when all three isolated lanes have fired, `--auto` needs seven sessions: lanes 1 to 6, lane 7,
lanes 8 to 22, lane 23, lanes 24 to 29, lane 30, and lanes 31 to 38. An isolated lane whose
trigger did not fire is dropped from an auto grouping with a line on stderr, and refused outright
when named under `--sessions`. Shared orientation and context stay free of case verdicts,
verifier-derived selection hints and other lanes' conclusions, because a lane told what to find
finds it. Every other lane may be grouped under an explicit override; grouping is never the
default.

## The sequence

`read`, then `launch --sessions` with the lanes the brief argued for, is the ordinary path.
`collect` then `launch` is the same path with a stop between them, for when the lanes need
direction; `review` is the "all" path, for a run the operator asked to sweep whole.

```text
bun --no-env-file .claude/skills/whole-run-investigation/scripts/wri.ts collect <target> --out <review>
bun --no-env-file .claude/skills/whole-run-investigation/scripts/wri.ts launch \
  --out <review> --sessions 5,11,25,31,34 --effort max --title <t> [--notes <f>] [--context <f>]
bun --no-env-file .claude/skills/whole-run-investigation/scripts/wri.ts finish --out <review>
bun --no-env-file .claude/skills/whole-run-investigation/scripts/wri.ts review <target> \
  --out <review> --repo <measured-source checkout> [launch options]
```

`collect` runs the four lanes the paid lanes consume — `snapshot`, `challenge`, `delta` and
`overview` — and writes `<review>/overview.json` from recorded bytes (terminal, denominators,
budget, versions, task set, grouped digest triggers, scan findings) and
`<review>/shared-instructions.json`, the one file the primary edits: a `template` of lines carrying
`{placeholder}` tokens and a `values` map filled from the overview. Every lane reads the rendered
template as `## Run overview`. Edit any value, add a value and its token, reorder or drop template
lines, and fill the two authored values `orientation` and `movedVariable` before `launch`; a token
without a value refuses the launch, and a line whose value is empty is dropped. Write the
orientation as facts a lane can check, never as the conclusion you expect it to reach. The
snapshot lane is `trace-review.ts`, also reachable as `bun run review:collect`; it makes no model
calls, reports a missing view inside `snapshot-status.json` rather than failing, and a new
deterministic question belongs there as another view rather than in a further collection script.
Require `complete: true` in that status before treating the snapshot as complete. A `read`,
`collect` or `review` whose snapshot left a required view unproduced still runs every other lane,
names each such view under `== SNAPSHOT INCOMPLETE` at the head of the brief, prints
`digest: skipped: snapshot view <view> <status>` where those leads would be, and only then exits
1, so `review` launches nothing over a partial snapshot.

`launch` opens exactly the named lanes and nothing else. `--sessions 5,11,25` names lanes;
`--lanes N` asks `build-manifest.ts --auto N` to group every lane into N sessions without crossing
an isolated seat; `--effort`, `--title`, `--notes` and `--context` pass through. Every session
starts at once unless `--max-active N` queues the rest behind N; eighteen lanes on each of two runs
took the host from load 8 to 16 beside six paid runs on 2026-09-30. Up to 30 concurrent Luna lanes
are allowed, and 53 at once met no rate limit. A hardware lane (29 or 30) runs in its own scratch
under `--out`, which may sit outside every Git work tree: the launcher lets Codex start there for a
session that owns everything it can write. The manifest
writes the shared instructions, the WRI `tasks.json` and the transport `luna-tasks.json`, and each
leaf receives its exact lane body inline — never the whole catalogue, never a scope expansion,
never authority to change controller output. Its reporting rules tell every lane to keep the three
kinds of case apart, to recount a figure that folded unaccepted cases into verified ones, to state
observation and cause separately, and to name the tool digest behind any verdict it relies on.
Watch `<review>/lanes/luna-output/summary.json`; each lane's report lands beside it as `<name>.md`
as it finishes.

`finish` runs `validate-reports.ts` over `tasks.json`, joining each task by name to its Luna
session in that summary or to its saved native report, so one review may run some lanes on each
and leave none unreported. A Luna session needs a terminal result and matching launch, prompt and
report identities; a native report needs its `prompts/<name>.md` to be still the prompt the
manifest composed; a lane reported by both, or by neither, is refused. Under each owed
`## lane_NN` heading the report carries `### Started from`, `### Evidence read`, `### Findings`
and `### Not established`, each once, in that order and non-empty, and every finding names an
`owner:` from `FINDING_OWNERS` in `manifest-reporting.ts`: one of the nine bundle files, such as
`correctness-model/evaluator.ts`, or `environment`, plus `controller-source` and `judge`. A report
that breaks that shape is refused with the exact section named; a failed or absent report is
missing work. The launcher has already given each session one further attempt; one rerun of the
sessions still missing is permitted within the authorised cap, with
`bun .agents/skills/codex-luna-swarm/scripts/luna-sessions.ts --retry <review>/lanes/luna-output`,
and `finish` then reads the summary it writes.

`finish` then scaffolds `<review>/archive/` from recorded bytes: `luna_syntheses.md` and
`digest.md` from the reports and the snapshot, `review.json` from those plus `verdicts.json`, and
a `main_synthesis.md` skeleton written once. The first `finish` writes the `verdicts.json` template
with every state `inconclusive`; record the states and reasons there, write `main_synthesis.md`,
and run `finish` again until the archive validator passes. Safeguard rows count firings from the
run's `SAFEGUARDS_LOG.txt` and the launcher stderr the verdicts name; with neither file the count
is unavailable, never zero, and a count proves a firing rather than that its owner received it.

## The lanes that read one thing each

Eight lanes run in-process and are subcommands of their own, printing the view, its JSON under
`--json`, and recording the JSON at `--out`; `posture` and `archive` run inside `read`. Each is
also a verb of `bun run runs`, which starts `wri.ts <lane>` with the options untouched
(`RUN_VERBS`, `.claude/skills/main/verbs.ts`), so that is the spelling to use.

```text
bun run runs delta | climb | yield | timeline | walls | handoff | gates | target  <target> \
  [--run <runId>] [--json] [--out <abs file>]
```

[The deterministic lanes reference](references/deterministic-lanes.md) owns what each prints. What
matters here is what each can and cannot say. `delta` prints paths and counts between the measured
source and its predecessor, never source text, so it says a surface moved and not that the move
reached anything. `climb` labels every edge between adopted versions from the task bytes alone. A
label is structural and not a forecast: `escalated` says the checks reached a higher tier, a new
input, rule or limit reads `widened`, which says the battery holds more and not that it asks more,
`adjusted` moves numbers at unchanged counts and states no direction, and `replaced` says the
edge could not be read. `walls` classes each case against the walls the Builder
wrote in `agent/config.yaml`, which is the one file nothing inspects again after the gate, and its
usual decision-changing reading is the negative one: no case reached a wall, so room explains
nothing. `timeline` says where the clock went, and its `unreadable` and `adrift` labels are
separate claims, the first about the classifier and the second about the model. `yield` counts
opportunities, outputs, consumption and change per review component, each with its own
denominator. `handoff` holds four tables of what one round hands the next, and reads a served
marker as a sentence the current source renders. `gates` joins every refusal to its component's
gate-audit prior and names each evaluation correction worth a `replay --under`. `target` matches
the recorded request and brief against the hardware families and gates lanes 29 and 30.

`posture` is `classifier/prose-classify.ts`, the pinned local embedding labelling every captured
Builder and solver prose row; it verifies the execution and sidecar joins first, and returns
`integrity-failure` rather than a posture when they disagree. A label is a lead for explaining an
already-observed refusal, stall or case kind, never a score. `archive` runs the archive validator
over the archive `finish` wrote for this run, when one exists under `notes/runs/`.

## Adjudicate and report

Treat lane reports as research. Check every consequential claim against the exact source and the
actual consumer, reconcile totals with the verified readers, and resolve a disagreement by what
each method can observe — neither confidence nor abstention wins. When a premise fails, revisit the
findings built on it and your own earlier claims, and name what survives. Collapse repeated
symptoms under their earliest demonstrated owner. Close a weak link a bounded command can decide;
keep an unresolved rival and its next discriminator where the instrument cannot see the property.
[The synthesis nudges](references/main-synthesis-nudges.md) hold the judgement this takes.

Four kinds of sentence may be written, and each needs its own evidence. **Safety**: the system
refused a bad or unprovable result. **Mechanism**: the intended branch executed and wrote its
evidence. **Capability**: verified artifacts passed the verifier under the named condition, and the
sentence names the recorded tool source and digest and who authored the check, because a
Builder-authored checker is not independent; where lane 35 recomputed a sample of passes from
public facts, the sentence says how many held. **Limit**: one fixed harness reached a
pre-registered semantic level and the deepest stable result was observed. Prompt assertions prove
text, types prove shape and gates prove the conditions they test; none of them proves better model
behaviour, and neither does a started run, PR prose or a reference artifact. Separate source
presence, deterministic proof, live exercise and outcome proof, and report verified, unaccepted and
non-result counts apart, with the capability rate over verified cases alone.

Every finding in the note states what was recorded and what is inferred from it as separate
sentences, so a reader can keep the observation and reject the cause. A finding that relies on a
pass or a fail names the tool digest that produced it, or says the bytes are gone and the
instrument is therefore unestablished.

Lead with the useful result, the material gap, the exact source and the separate denominators.
Index the work once through [CHECKLIST.md](CHECKLIST.md); a targeted review records the admitted
rows and its material omissions, and an exhaustive one records every catalogue row. Name missing
reports and unexecuted checks. For a live run, capture the T0 identities and counts before the
lanes and T1 separately before synthesis; retain findings on unchanged bytes, mark
changed-artifact findings stale, and never mix later evidence into T0 denominators.

Each retained proposal names its evidence, owner and consumer, the smallest coherent change, the
expected effect, the falsifier and the comparison that could decide it. Return no repair when the
evidence supports a probe or a hold. End the recommendations with `What to do next` as Patch,
Consolidate and Overhaul, where a section may report no justified change. Use
[an independent review packet](references/external-review.md) only when another method can settle
a consequential dispute, and [the plan questions](references/improvement-plan-questions.md) when
the operator asks what to change next. A review alone authorises no PR or launch, and no source
edit beyond the native lanes' own commits.

## The archive and the note

A whole-run investigation ends in one adjudicated note under
`notes/investigation-YYYYMMDD-<topic>.md` — local and ignored, so never published — beside the
four-file archive `finish` scaffolded, copied to `notes/runs/<runName>/` when it is durable. Its
working review directory, the `--out` of `read` and `launch`, goes under
`notes/wri-YYYYMMDD/<run>/`. The archive's four files:

- `main_synthesis.md`: adjudicated findings, limits, accounting and recommendations.
- `luna_syntheses.md`: the accepted reports in manifest order, with only whitespace normalisation
  and necessary protected-detail removal.
- `digest.md`: the verified, sanitised deterministic digest.
- `review.json`: `wri-archive/v2` identities, collection and coverage receipts, accounting and
  pointers into those four files. The validator refuses any other schema.

A targeted standalone answer needs no archive unless requested. The note is where the reader who
was not there starts: what the run showed, why that is not what they would have expected, and what
it does now instead, with each consequential claim marked as re-checked against the bytes or
resting on one lane's report.

Before proposing a remedy, read the earlier notes for the same mechanism: this checkout's `notes/`,
and for runs before the 2026-09-22 split, `/Users/air/Developer/harness-builder-v4/notes/`, which
also holds `current-state.md`, `handover/` and `run-failures/`. A mechanism that recurs across runs
has usually been found before, and its remedy is often already in the measured source as a
standing duty of some component — a reviewer prompt line, a gate, a sensor. When that is so, the
first question is whether the standing duty fired: read the recorded reviews or the sensor's log
for the run and say whether the duty was invoked, whether it found the mechanism, and where its
finding went. Lane 12 asks exactly that of the Epoch Reviewer's duties and lane 14 of where the
finding went. A second remedy for a mechanism whose first one never ran adds a wall that pays no
rent. Only when the duty demonstrably ran and the mechanism survived it is a different owner the
finding. An earlier note's diagnosis enters this run as a hypothesis for a lane, not as a finding
this run inherits.

Check for protected verifier detail, raw prose, counterexamples and reference artifacts before
anything is written. Retain safe findings and evidence paths; never feed protected material to a
Builder, Judge, diagnosis or authoring prompt. Preserve frozen predictions and campaign-owned
adjudications: WRI can propose a refutation or an experiment, but creates no campaign event,
promotion or closure.

```text
bun --no-env-file .claude/skills/whole-run-investigation/scripts/validate-archive.ts \
  --archive <absolute archive dir>
```

Read its exit status directly; a pipe must not turn refusal into success. The validator proves
shape and bindings, not the truth of the prose.

## Retired

The catalogue once held forty numbered angles, intelligence and reference-comparison sessions, two
diagnostic lanes and blinded pairs; it also read mechanisms the source no longer has — the repair
engineer, the progress guard, the judge-prompt maintainer, the Judge control census and its bait,
the paired promotion contest, the `DIFFICULTY.json` session, memory curation, the `climb`,
`hold-limit` and `ease` verbs and the saturation ledger. None of it is read now, and none of it is
a lane. The twelve former angles that kept a direct successor are renumbered and their evidence
rewritten against the current source; a finding an older note gives under any other retired number
is still a finding, and its mechanism is what to carry forward, under whichever of the thirty-eight
lanes owns the question today. The `--consumer-hardware` flag that once asked for a hardware
comparison by hand is retired too: the `target` lane's `HARDWARE TARGET NAMED` trigger fires from
the recorded request and brief, and starts lanes 29 and 30.
Whether a current lane should join them is [lane maintenance](references/lane-maintenance.md).

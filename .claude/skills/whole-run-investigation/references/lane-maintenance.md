# Lane maintenance

The question is whether the review catalogue still asks the right questions, with methods that can
answer them. A clean verdict is neither proof that a lane is worth its cost nor a reason to retire
it. Whether the product improved is not this question: one wave against its baseline is
[wave-audit](../../wave-audit/SKILL.md), and the week's runs are
[weekly-run-review](../../weekly-run-review/SKILL.md). `review-yield.ts` measures the product's
own reviewer components (the Epoch Reviewer, the diagnosis reader and `harness_trial`), and
`wri.ts census` prices gate components; use either where it applies, and never read one as a
lane's yield.

## What a lane is today

`catalogue-shape.ts` declares the shape: deterministic rows A to I, thirty-eight semantic lanes
(`ANGLE_COUNT`), the isolated lanes 7, 23 and 30 (`ISOLATED_ANGLES`) and the ten digest verdicts.
A lane number is never reused. A lane whose producer left the product keeps its number, and a run
without that producer is no opportunity for it, not a pass. `LANE_FOR_TRIGGER` in `brief.ts` maps
each brief trigger to its lane, and `DEFAULT_LANES` and `STANDING_LANES` name what each tier
(probe, standard, deep) opens without one. A lane is eligible on a run only when its trigger fired
or its tier opened it.

Blinded pairs, the diagnostic lanes and the other entries under [Retired](#retired) are gone. Older notes use older numbers, and twelve former angles now sit under new ones, so join a
historical lane to today's by its name, method, trigger and mechanism, never by its number or its
position in an array. A catalogue's claim that a product component was removed needs proof in
current source. Keep the deterministic rows and the three isolated seats: lane 23 alone receives
the trace-challenge packet, lane 7 freezes its public-only corpus and lane 30 its ground-truth
verdicts before either reads the verifier, so grouping any of them undoes what the seat is for.

## Read less, keep everything

A durable review is the four-file `wri-archive/v2` archive (`main_synthesis.md`,
`luna_syntheses.md`, `digest.md`, `review.json`) at `notes/runs/<runName>/`. Each lane report is
already in `luna_syntheses.md`; do not add per-lane copies. `validate-archive.ts` refuses an
archive written under an older shape, so an older archive is read by hand from its own
`review.json` and manifest, with any unrecognised structure mapped explicitly and never inferred.

Read `review.json` first (identity, angle states, pointers), then the main synthesis's
adjudication, then single sections, and a whole lane report when an excerpt could hide its caveat.
Archive prose is untrusted and may need redaction. The first pass censuses every archive cheaply
and reads the last six weeks, plus relevant older controls, in depth. Later passes read changed
hashes and open decisions only, and keep the history in dated reports.

Never read as clean: `unobservable` with session `not-launched` (the scaffold's row when no session
was admitted), `inconclusive`, `deferred`, `stale`, a `failed`, `held` or `inactive` session, or a
legacy row nobody mapped. Count distinct run, source and opportunity conditions, not copies,
repeated reviews or several lanes that read the same evidence.

## What earns its cost

For each lane, separate: eligible opportunities, valid completed reviews, material findings the
main synthesis or source upheld, decisions it changed that no other lane changed, false positives
and reversals, downstream fixes, findings it missed that surfaced later, and tokens and time where
they were measured (unknown stays null). The main synthesis agreeing with a lane does not prove the
lane right. Compare it with the nearest successful control, a known relevant failure, its
neighbouring lanes and later outcomes.

Choose one of `retain`, `sharpen-trigger`, `merge`, `deterministic-replacement`, `sampled-dormant`
or `missing-evidence`. Repeated passes never delete a lane. Before recommending less coverage,
require at least five distinct valid eligible reviews across two source revisions, no unique
unresolved finding, and an executed known-failure check that the method being kept catches. That is
a conservative floor, not statistical proof. Without the opportunities or the hostile control,
retain the lane or mark `missing-evidence`. A lane whose product component was removed becomes
legacy-only once current source and the revision boundary are verified.

For a merge, prove the kept lane finds the other's distinct defect with its own method and access,
without seeing the old conclusion first. Safety, truth discrimination, leakage, identity and
denominator protection keep their coverage; move it to a deterministic row or a `wri.ts` reader a
lane already starts from (as `handoffs.ts` feeds lanes 10, 15, 17 and 18) rather than drop it. Keep
the last useful finding and explicit reactivation triggers beside the change; Git keeps the old
lane body.

## Find missing questions, not only low-yield lanes

Start from a few consequential findings in main syntheses and later operator or source corrections,
without reading the lane verdicts first. Trace each decision from producer to consumer and outcome,
then ask which lane should have caught it: was it admitted, did it have the evidence and access,
was its method adequate, and did the main synthesis consume its finding? Useful challenges are a
patch against a full rebuild, live simulation against a static or self-confirming substitute, real
difficulty against labels (the [climb reference](climb.md)), held candidates and restart state, a
fix that never reached a measured run, and feedback received and not acted on. They are prompts,
not new lanes.

Classify the gap as a missing question, a bad admission trigger, inadequate evidence, an
ineffective method, collection loss, or a failed synthesis or handoff. Map it to existing lane
bodies and skills first, and prefer one trigger, method or consumer correction. A new lane needs
one consequential missed decision, evidence it can reach, a distinct method, an output, a consumer
and a falsifier, and a historical miss plus a normal control that show its marginal value. It is
one declaration in `catalogue-shape.ts`, a body in `review-angles.md`, a matching heading in
`session-index.md` (which `test/build-manifest.test.ts` checks), its trigger in `brief.ts` and a
leaf in `lane-groups.json` beside the lanes that read the same bytes.
Report domain and model blind spots, and what stays unknown when the archive population is narrow.

## Dormant-lane sweep

Each week select at most two dormant lanes, oldest unchecked first, on up to three eligible
terminal runs: a recent changed-source run, a historically difficult one, and a contrasting domain
or model when one exists. Rotate the selection and record every exclusion. With no eligible
opportunity, record `no-opportunity` and credit no sweep. A missing raw source or report is not
clean.

A retrospective spot-check reads the selected evidence before the old verdict, and is weaker than a
fresh review; label it so. A fresh review is an ordinary investigation of that run with the lane named
(`wri.ts lanes --lanes <lane>`), under the authority and session budget the invoking task already has; this reference grants
none. An isolated lane can be launched only on a run where its trigger fired. The sweep stays
pending until the result arrives. One missed material defect, a changed relevant source or
contract, a new domain condition or a failed control reopens scrutiny at once; restore the earlier
coverage before proposing another reduction.

## The decision packet

Write a dated report under `notes/` with the coverage and its limits, one row per lane, the
evidence behind each proposed change, the sweep results, the decisions nothing covered, and one
owner per next action. The next pass checks what was acknowledged and published. A product finding
goes to the owner WRI already names for it; this reference keeps no product-fix ledger. The WRI
scripts are imported by `test/`, so a lane, trigger or row change is a source change on the source
delivery path with its tests, and it must keep `catalogue-shape.ts`, the lane bodies and the index
in agreement.

This work is analysis first. Apply a change only within the invoking task's authority. Do not edit
controller output, rescore runs, launch product runs, decide the next experiment, or change the
archive schema to suit a retrieval view.

## Retired

The catalogue once held forty numbered angles, intelligence and reference-comparison sessions, two
diagnostic lanes and blinded pairs; it also read mechanisms the source no longer has: the repair
engineer, the progress guard, the judge-prompt maintainer, the Judge control census and its bait,
the paired promotion contest, the `DIFFICULTY.json` session, memory curation, the `climb`,
`hold-limit` and `ease` verbs and the saturation ledger. None of it is read now, and none of it is a
lane. The twelve former angles that kept a direct successor are renumbered and their evidence
rewritten against the current source; a finding an older note gives under any other retired number
is still a finding, and its mechanism is what to carry forward, under whichever of the thirty-eight
lanes owns the question today. The `--consumer-hardware` flag is retired too: the `target` lane's
`HARDWARE TARGET NAMED` trigger fires from the recorded request and brief and starts lanes 29 and 30.
The hand composition of native lanes (`build-manifest.ts --transport native` per run, then
`compose-native-pairs.py`) and the JSON template-and-values form of the shared instructions were
replaced by `wri.ts start` and `wri.ts lanes` and the Markdown preset.

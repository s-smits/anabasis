# ESP32 reference and weekly trajectory

Read this reference when at least one finalist's admitted initial prompt contains the token `ESP32`
(case-insensitive). If the prompt text is unavailable, a controller-bound project/domain identifier
containing `esp32` may activate the comparison, labelled `domain-inferred`. A campaign name alone is
not proof of the prompt text.

## Pinned ESP32 run reference

The operator-pinned run reference is:

- campaign: `esp32-w41-opus`;
- run: `run-w41b`;
- source commit: `5842fe387250bada5d71a06305aa416d338d371e`;
- opening digest: `321c925458f43ed09d2f3ee885ce952937d3a283d24513a3f85dec318c3c147d`;
- terminal digest: `a992554ee268e2c03b439501b4405edf334301d62f97da71116612826924dce4`.

Its deterministic baseline is 321.862 minutes, 225 total cases, 175 verified, 0 unaccepted and 50
typed non-results. The seven completed batteries were all 25/25: zero lay in the frozen difficulty
band and all seven were saturated. It completed the initial product vertical plus four promoted
climbs. These facts identify the reference; refresh them from the exact-source WRI collector before
every comparison.

Resolve the run across linked worktrees by campaign, run, full source and both evidence digests. Run
that source tree's `whole-run-investigation/scripts/trace-review.mjs` into the current scratch
directory and require all nine views plus the digest. The published
`notes/runs/esp32-w41-opus/review.json` currently binds older run `run-w41`; never substitute it for
`run-w41b`. Until the full `run-w41b` packet is published, deterministic comparison remains possible
but mechanism and external-reference conclusions are `reference-synthesis-missing`.

This `trace-review.mjs` call is the same deterministic collector used by the shortlist preflight. It
does not author or replace a semantic WRI analysis and remains allowed when missing syntheses block
Luna admission.

Changing this pin requires explicit operator direction. A later weekly winner does not silently
replace the reference.

## Compare both references before synthesis

The Sol xhigh primary performs both comparisons independently before reconciling the WRI prose:

1. **Run reference:** compare every ESP32 finalist with `run-w41b` on closed vertical depth,
   deterministic denominators, useful difficulty, attribution, claimability/provenance,
   operational yield and source recency. Do not compare raw pass rates across different task sets,
   model conditions, verifier rules or provenance conditions.
2. **Consumer-hardware reference:** repeat the safe contract-coverage comparison against the clean
   `~/Developer/schematik-rebuild` tree. Record its exact revision and dirty state. Compare public
   task families, tool capabilities and artifact-schema responsibilities. Then reconcile with the
   finalist's WRI `Reference contract coverage` session. A disagreement is a question, not a vote.

Do not execute a reference verdict comparison unless a reviewed adapter maps the accepted artifact
to the reference entry point. With no adapter, state both shapes and `unobservable`; never infer a
verdict from a source diff. Keep reference artefacts and protected per-case detail out of the note.

Publish an `esp32-reference-gap` block which states what the current run closes relative to each
reference, what remains missing, the evidence level, a rival explanation and the result which
would falsify the claimed improvement. Distinguish product breadth from the narrower firmware
battery, and distinguish a current-source live result from a historical mechanism result.

```text
<!-- esp32-reference-gap:start -->
## ESP32 reference gap
<comparison and ordered remaining gaps>
<!-- esp32-reference-gap:end -->
```

## Week-over-week system trajectory

Read the immediately preceding completed weekly note from published main. Carry each open mechanism
under a stable `<owner>:<mechanism>` identifier. A renamed sentence does not close a gap. Close one
only when the current note cites the deciding source or recorded evidence and the falsifier no longer
holds.

Track these dimensions separately:

- full vertical completion;
- useful difficulty rather than saturation;
- attributable movement;
- claimability and engine/model provenance;
- operational yield, including unaccepted and non-results;
- ESP32 reference-contract coverage when triggered; and
- live proof on the current source lineage.

For every dimension assign `improved`, `regressed`, `unchanged`, `incomparable` or `unobservable`.
`Improved` needs a comparable identity or an attributable transition. A larger denominator alone is
more evidence, not better capability. A fix present in source but absent from the measured revision is
planned/current-source progress, not live improvement. Never collapse the dimensions into one score.

Publish the human-readable table and a valid JSON object in this block so the next week can read it:

````text
<!-- weekly-system-trajectory:start -->
## Week-over-week system trajectory
| dimension | previous | current | state | evidence and remaining gap |
...
```json
{"schema":"weekly-system-trajectory/v1","week":"<ISO week>","previousWeek":null,"dimensions":[],"openGaps":[]}
```
<!-- weekly-system-trajectory:end -->
````

Each `dimensions` row carries `id`, `state`, `previous`, `current` and `evidence`. Each `openGaps` row
carries `id`, `owner`, `status`, `firstSeenWeek`, `lastSeenWeek`, `evidence`, `falsifier` and
`nextDecidingCondition`. If the prior block is absent or malformed, set `previousWeek` to null,
classify every dimension `unobservable`, and establish the present week as the first baseline.

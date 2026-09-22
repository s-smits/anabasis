# Week-over-week system trajectory

Read the immediately preceding completed weekly note from published main. Carry each open mechanism
under a stable `<owner>:<mechanism>` identifier. A renamed sentence does not close a gap. Close one
only when the current note cites the deciding source or recorded evidence and the falsifier no longer
holds.

Track these dimensions separately:

- full vertical completion;
- useful difficulty rather than saturation;
- attributable movement;
- claimability and engine/model provenance;
- operational yield, including unaccepted and non-results; and
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

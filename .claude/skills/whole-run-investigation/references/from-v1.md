# Catalogue lineage (v1 and 23-lane v2 to 19-lane current)

Consult these mappings when an archived investigation cites a row or lane number from an earlier catalogue. The v1 catalogue is preserved at `git show 3f93d06:.claude/skills/whole-run-investigation/references/review-angles.md`, and the 23-lane v2 catalogue at `git show eccbc9ffe:.claude/skills/whole-run-investigation/references/lanes.md`.

## From 23-lane v2 to 19-lane current

Eleven redundant or dead v2 lanes were removed or merged, and six lanes were added for current-system mechanisms (deliverables capture, practice bands & family transfer, harness portability & external transfer, seat compaction & handover, solver execution & tool friction, and evaluation wall / sandbox / provenance).

| v2 lane | fate | current lane |
| --- | --- | --- |
| 1. Verdict chain: what a pass observes | rewritten (+ pass labels) | 1 |
| 2. The drafted exam against its prompt | rewritten (now standing, + v2 lane 7) | 2 |
| 3. Whether validity separates | removed (merged into 1 & 6) | 1, 6 |
| 4. What each seat was told | rewritten | 14 |
| 5. False rejection among fails | rewritten | 4 |
| 6. Valid-alternative rejection challenge | kept (isolated) | 5 |
| 7. Public disclosure and one recipe | removed (merged into 2) | 2 |
| 8. What the test could show at its size | unified (absorbs 3, 9, 10, 11) | 6 |
| 9. What a step rests on | removed (merged into 6) | 6 |
| 10. Flips and solver variance | removed (merged into 6) | 6 |
| 11. What an objective-only step won by | removed (merged into 6) | 6 |
| 12. What a confirmation is made of | removed (merged into 7) | 7 |
| 13. Which link holds the next promotion | rewritten (practice split to 11, endings/compaction to 15) | 16 |
| 14. Harness quality, version by version | rewritten (blind) | 8 |
| 15. Harness delta against its note | rewritten (boundary breach moved to 18) | 9 |
| 16. What made each win | rewritten | 10 |
| 17. The starter | removed (merged into 7) | 7 |
| 18. The promotion and the climb after it | unified (absorbs 12, 17, 19; `/tmp` moved to 18) | 7 |
| 19. How many independent batches a read rests on | removed (merged into 7) | 7 |
| 20. Pressure on the Examiner | rewritten (+ v2 lane 21, `try_reference`, family concentration) | 13 |
| 21. Supply and task admission | removed (merged into 13 & 18) | 13, 18 |
| 22. Does the budget bind, and how each solve ended | dissolved into solver execution (17) & wall/provenance (18) | 17, 18 |
| 23. Time, spend and silence | rewritten (compaction to 15, held-off to 16, + billing residual) | 19 |
| — | added: Deliverables and file-artifact verification | 3 |
| — | added: Practice feedback, band discipline and family transfer | 11 |
| — | added: Harness portability and external-transfer readiness | 12 |
| — | added: Seat continuity, compaction and handover | 15 |
| — | added: Solver execution, tool friction and resource limits | 17 |
| — | added: Evaluation wall, sandbox isolation and run provenance | 18 |

## From v1 rows to current rows

| v1 row | current home |
| --- | --- |
| A. Campaign identity | A |
| B. Claim and promotion state | F (`harness.promoted`) |
| C. Workspace and Git | lane 9 by harness digest; lane 18 by launch receipt |
| D. Static conformance | lane 9 |
| E. Fingerprint and task-admission census | B |
| F. F2 solvability | D; lanes 6 and 13 |
| G. Case partition | E |
| H. Runtime identity and isolation | C; lane 18 |
| I. Served-model attestation | C; lane 18 |

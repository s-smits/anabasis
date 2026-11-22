# From v1's catalogue to v2's

Consult this mapping when a v1 archive cites a row or lane absent from the current catalogue. The v1 catalogue is preserved at `git show 3f93d06:.claude/skills/whole-run-investigation/references/review-angles.md`. The v2 lane numbers below reflect the current catalogue, which added 10 lanes for paired comparisons and exams written independently of the Builder.

## Rows

| v1 row | v2 home |
| --- | --- |
| A. Campaign identity | A |
| B. Claim and promotion state | F; promotions are recorded as `harness.promoted` events |
| C. Workspace and Git | lane 15 by harness digest; the launch receipt records the commit |
| D. Static conformance | lane 15 |
| E. Fingerprint and task-admission census | B |
| F. F2 solvability | D; lanes 8 and 21 |
| G. Case partition | E |
| H. Runtime identity and isolation | C |
| I. Served-model attestation | C, including missing `responseModels` |

## Lanes

| v1 lane | fate | v2 lane |
| --- | --- | --- |
| 1. Request-to-verdict chain | overhauled | 1 |
| 2. Executable verifier dependency closure | kept | 4 |
| 3. Authoring-to-host contract compatibility | removed: `draftReading` validates draft structure | none |
| 4. Operating guide and roster truth | kept | 15 |
| 5. Limit slack against the reference | overhauled | 8 |
| 6. Check discrimination and binding | overhauled | 1 |
| 7. Valid-alternative rejection challenge | kept | 6 |
| 8. Public disclosure and one-recipe | kept | 7 |
| 9. Rehearsal instrument reach | removed: practice uses the campaign's verifier | none |
| 10. Difficulty calibration loop | removed: the setting remains fixed | none |
| 11. Submit decision against rehearsal evidence | overhauled | 13 |
| 12. Epoch Reviewer standing duties | removed: the Referee rules rejections | none |
| 13. Public-safe feedback sufficiency | merged | 5 |
| 14. Finding routing and recurrence | overhauled | 5 |
| 15. Harness-versus-evaluation triage hand-off | kept | 5 |
| 16. Judge disagreement adjudication | removed: no model Judge | none |
| 17. Round hand-off census | removed | none |
| 18. Same-task repair measurement | merged | 13 |
| 19. Semantic repair closure | overhauled | 1 |
| 20. Task movement and attribution | overhauled | 15 |
| 21. Source-delta reach | merged | 9 |
| 22. Solver process and walls | kept | 22 |
| 23. Trace challenge | kept | 16 |
| 24. Time, spend and provider waits | kept | 23 |
| 25. Failure mechanism and non-result honesty | kept | 22 |
| 26. Builder memory and posture | removed: `memory.ts` persists notes | none |
| 27. Task-admission cost and confidence | overhauled | 3 |
| 28. Evaluation-correction regrade | merged | 1 |
| 29. Hardware target coverage against public ground truth | removed | none |
| 30. Ground-truth verdict comparison | removed | none |
| 31. Brief against the request | removed, later reintroduced as the drafted-exam lane | none |
| 32. Judge pass decidability | removed: a human labels passes in `settle.ts` | none |
| 33. Reference provenance and author's answer strength | overhauled | 8 |
| 34. Check mirroring in solver tools | kept | 15 |
| 35. Independent recomputation of passes | merged | 1 |
| 36. Difficulty pressure on the Builder | removed: the Examiner authors tasks | none |
| 37. Scored-set size and probe graduation | removed | none |
| 38. False rejection among verified fails | kept | 5 |

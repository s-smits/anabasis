# Evidence behind the stacking procedure

Bounded review on 5 September 2026: existing `notes/run-failures/`, three recent parent Claude
transcripts, the August reorder transcript, and the archived reader/timeout composition. This is
a set of observed failure mechanisms, not a frequency census or a measured speedup experiment.
Transcript lines below refer to JSONL records in the operator's Claude Code project directory.

| Evidence | Observed problem or successful mechanism | Workflow consequence |
| --- | --- | --- |
| `881d563b-0294-4ae1-addf-22785a4d440d.jsonl`, records 234, 265, 361 and 497; 24 August, 00:24–00:45 UTC | Six-ref reorder left #332 marked merged against its former base; #334, already closed, could not reopen. The session also recovered three earlier dropped commits into #341 and found another parent fix missing from its child. | Check metadata transitions as well as Git edges; inventory unique changes and verify every descendant after repair. Do not describe both closures as newly caused by the atomic push. |
| `0b5906dc-ef5d-4294-9aba-793b0c9b1f11.jsonl`, record 5946; 31 August, 19:51 UTC | Session audit reported four of seven edges each missing one recent parent correction (#399→400, #404→405, #405→406, #407→411). | A published base name does not carry later parent commits into a child. Freeze heads and start at the first changed edge. These counts are the recorded audit's scope, not a fresh audit of today's refs. |
| Same transcript, records 10739–10798; 1 September, 14:08–14:11 UTC | Tool output records TS2322 at `controller-evidence.ts:389`. Repairs attributed to #436/#437 were committed on the unrelated wall branch; another push then found the next issue. | Predict the owning diff, prove the failing boundary, route the fix to that owner and propagate once. An upper-head pass does not prove each lower PR. |
| Same transcript, record 57902; 3 September, 17:50 UTC | Session reports nine branches (#505–513) published through one pre-push gate. | Multi-ref publication already existed; no new skip flag is needed. This report alone supplies no exact test-count claim. |
| `9aa4c768-e8a6-4789-9359-30762ee546f0.jsonl`, record 10774; 4 September, 09:38 UTC | Session says the restack is complete except for #521's running push gate. | Keep composition and publication statuses separate. A running gate proves neither delivery nor a passing checkpoint. |
| `notes/handover/2026-09-05-reader-and-stack.md` and archived files below | Two loaded pushes hit the same verifier fixture. Owner #520 was corrected; #521–533 and new #534 were composed and fifteen heads published through one gate. The recorded combined gate has 3,166 passed, 12 skipped, 0 failed. | One owner correction plus one descendant propagation can replace repeated individual pushes; loaded-only failures belong to their test/runner owner. |
| `notes/run-failures/2026-08-14-to-08-19.md`, environment-fault section | Existing analysis records symlinked dependency resolution causing wasted Builder iterations in w29/run52. | Prepare the actual test tree and classify environment failures before blaming a PR. This review reuses the mined evidence rather than remining those runs. |

The reader/timeout archive is in the operator's investigation folder,
`2026-09-05-built-climb/reader-and-stack/`:

- `ana-live-battery-readers-push.log` and `ana-live-battery-readers-push-retry.log`: failed gates;
  the retry records the same task-time non-result fixture failure.
- `restack-timeout.ts` and `timeout-restack.json`: old/new PR heads, ancestry checks and exact
  child-tree comparisons preserving the seven-line owner correction.
- `push-timeout-restack.ts`: asserts clean checkout and exact top, supplies explicit ref leases
  and SHA refspecs to one atomic push.
- `timeout-restack-push.log`: passing gate and fifteen published ref updates.

At main `05fa5fb92`, `.githooks/pre-push` reads its ref input before executing one checkout gate;
it does not gate each ref separately or assert that all source refs are ancestors of the checkout.
That latter check remains a required skill step, not an implemented hook safeguard. No hook or CI
behaviour was changed for this skill upgrade. Five-change checkpoints and suspect-guided bisection
are the new operating procedure; their future time saving has not yet been measured.

# Findings left open at v0.10.3

Status: planned. Each row was found by the landing review of 10 November 2026 (three lenses over
the stack of #721 to #748) or by the second-reader pass that followed it, and was left as it is so
that the release could land. Each says what would settle it.

## Intended changes

### The landing and the run CLI

1. **Two processes can take a dead landing's lock** (confirmed by reading, `holdAlone`,
   `tools/runtime/landing.ts`). Two takers that both find the holder dead each remove its lock and
   write their own. Give `hold` (`tools/runs/holder.ts`) a note and let `held` accept the holder's
   own prefix, so the takeover is one rename. Hostile tests: two takers on one dead holder leave one
   holder, and a live pid with another start time reads as dead.
2. **A cut investigation snapshot cannot be started again** (confirmed, `frozen`,
   `tools/wri/wri.ts`). A `start --snapshot` that is killed leaves a partial copy, and the next
   start refuses the folder. Remove the target before `snapshotCampaign` copies into it; the test
   needs `liveOf` to take its known runs as an argument.
3. **An alerts look crashes on a peer that answers from an older tree** (seen live on 10 November,
   `written`, `tools/runs/alerts.ts`). While the caller's commit was on no remote branch, the peers
   answered at its published ancestor with rows that held no state, and the look threw instead of
   reporting. Name the host as answering from an older tree and read the hosts that did answer.
4. **`fetch --whole` copies live runs whole** while the daily retire leaves them out (confirmed).
   Decide which of the two is meant, since a whole copy of a live run is stale within the hour.
5. **The prompts say network reach was read "when this process started"** (confirmed, the solver's,
   Builder's and Examiner's prompts). #722 probes again after ten minutes, so the sentence is
   imprecise. It changes what a seat is told, so it waits for the operator's word.

### Where a hand reading and its owner disagree

The second-reader pass replaced eleven hand readings whose output did not move on 251 recorded
logs. These five differ from their owner on some log, so replacing them changes behaviour.

6. **A writer check against `lifeOf`.** `tools/runs/alerts.ts`, `pulse.ts` (two sites),
   `snapshots.ts` and the page's `logs.ts` ask `writers(...).length > 0`. `stillRunning` would also
   keep a kept run with no writer on status and alerts. Decide whether a kept run between two
   starts is running for these readers; #724 decided it for `lifeOf`.
7. **An unruled rejection in compare-systems.** `systems.ts` treats any `referee.finding` as
   ruled, where a round puts a finding with a null ruling to the Referee again (`unruledOf`,
   `src/campaign/round.ts`). A rejection whose Referee call was cut stays unruled for good.
8. **A pending budget word on a dry run.** `tools/d2/harness-builder.ts` skips applying it, so the
   printed next move is decided on the old total; `campaign-actions.ts` has no such guard.
9. **The starter's digest on a log from before 9 October.** `climb.ts`, `tools/wri/packets.ts` and
   `trajectory.ts` take the first `comparison.started`; the page falls back to the first report's
   `starter`, as `compared` documents. Give the fallback one owner.
10. **Solves a side for a set-aside task.** The move detail passes the handover's count and the
    grid the start's alone, so on such an old log the grid shows 0 of 0.

### Readings with no owner yet

Each is spelled by hand at three or more sites, and no scan reports it.

11. **The promotion count** (`kind === "harness.promoted"` filtered and counted): nine sites, and
    four more rebuild the promotions' indexes.
12. **The campaign's ending as its last event**: six sites.
13. **The Referee's last finding of a solve as whole data**: four sites; `rulingsOf` returns the
    ruling alone.
14. **The solve-to-comparison map**: three sites beside `ownersOf` (`src/kernel/trace.ts`).
15. **Event-kind constants declared again**: `REPORTED` is exported twice and copied privately
    three times.
16. **Browser views that cannot import their owner.** `BROKE`, `RULING_KINDS` and `isRejection`
    under `packages/ui/src` repeat kernel sets because the owners pull `node:fs` into the bundle.
    A leaf module of the sets alone, imported by both, would remove the copies.

A scan for rows 11 to 15 starts as a report in `tree-findings.ts` and gates only at zero sites
(`tools/oxlint/HABITS.md`, 12.9).

## History

- 9 November 2026, the operator, on the stack before its release: a subagent "to tackle more of
  these inefficient surfaces", and "read simplify skill as well to get inspiration". That pass is
  the eleven sites replaced and rows 6 to 16.
- 10 November 2026, the operator, on the release: "ignore normal protocls for this as i have a
  feeling the system has significantly improved here". Rows 1 to 5 were therefore left for after
  the release instead of holding it.

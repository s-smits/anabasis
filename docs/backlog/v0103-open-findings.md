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

### Found after the release

Two readers went over what v0.10.3 landed on 10 November 2026, one over `src/` and one over
`tools/d2` and `tools/runs`. `--after next|<word>` was mended in the change that added these rows;
the rest wait. "Read" means the row was checked against the source again before it was written
here; "reported" means only its reader has seen it.

17. **Kept runs hold each other's slot at the cap** (read, `liveHere`, `tools/runs/live.ts`;
    `startRefusal`, `tools/runs/logins.ts`). A kept run between two starts counts as live, and a
    keeper leaves out only its own run. Where a login keeps more ended runs than its cap, as after
    a cap is lowered under them, each keeper finds the login full and none starts again. Let a
    waiting run count only against the runs that sort after it, so the first of them start.
    Hostile test: three kept runs with no writer on a login capped at two start two.
18. **A solve's network line can change inside one comparison** (read, `networkReach`,
    `src/tools/command.ts`, read by `src/solver/run.ts`). An unreached reading is probed again
    after ten minutes, so the two sides' solves of one task can be told different things, and the
    log records neither. With row 5 it changes what a solver is told, which is the operator's:
    either a comparison's reach is fixed at its start, or `solve.started` records it.
19. **A kept run's ending is not alerted** (read, `stateOf`, `tools/runs/state.ts`): with no writer
    and a live keeper the state is `kept`, so `alerts` prints no `ended environment` line.
20. **A resumed move starts in a tree nobody checked** (reported, `tools/runs/move.ts`): a
    destination tree at the same commit is reused, and a change no commit names is refused only
    after the source is paused and set aside. Ask `standing` of the tree before the pause.
21. **A preparation lock no longer lapses while its process lives** (reported, `STALE`,
    `tools/runs/code.ts`): a remote shell that outlives its killed ssh client holds the commit's
    preparation on that host. Settled by whether such a shell survives on each host.
22. **A lock's holder is named by text the locale and time zone change** (reported,
    `tools/runs/holder.ts`): `ps -o lstart=` and the host's name, so two processes under different
    settings each read the other's lock as free. Settled by the settings of the scheduled jobs.
23. **A stop can miss a writer its keeper starts meanwhile** (reported, `tools/runs/stop.ts`): the
    process table is read once, before the keeper ends.
24. **A killed move's stage is used again** (reported, `tools/runs/move.ts`), with what the earlier
    transfer left in it.
25. **A rejection's standing has a second reader** (reported, `rejections`,
    `src/campaign/comparison.ts`, beside `standsOf`), with the same answer on every log today.
26. **The Examiner's faulted checks now read a ladder report's labels** (reported, `faultedOf`,
    `src/examiner/record.ts`). Settled by whether any ladder report on record holds a label.
27. **Why the reference's later solve of a task scores below its earlier one.** Over the 234
    controls at two solves a side the later solve lost 446 tasks and won 363 (jobstat 189 and 126,
    esp32 31 and 16, buffer 181 and 168). The control no longer reads it as a difference, and its
    cause is unread: load when the solve started, the task's place in the queue, or the provider.
    `tools/wri/time.ts` holds the slots and the load to read it from.

## History

- 9 November 2026, the operator, on the stack before its release: a subagent "to tackle more of
  these inefficient surfaces", and "read simplify skill as well to get inspiration". That pass is
  the eleven sites replaced and rows 6 to 16.
- 10 November 2026, the operator, on the release: "ignore normal protocls for this as i have a
  feeling the system has significantly improved here". Rows 1 to 5 were therefore left for after
  the release instead of holding it.
- 10 November 2026, the operator, after the release: "review current PR stack and overhaul /
  supersede where needed", and "triage with most recent runs to improve further". Rows 17 to 27.

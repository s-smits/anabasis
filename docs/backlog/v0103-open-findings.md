# Findings left open at v0.10.3

Status: rows 1, 2, 3, 17 and 19 are proved without a model, each by a hostile test that failed
before its repair; the rest are planned. Each row was found by the landing review of 10 November
2026 (three lenses over the stack of #721 to #748) or by the second-reader pass that followed it,
and was left as it is so that the release could land. Each says what would settle it.

## Intended changes

### The landing and the run CLI

1. **Two processes can take a dead landing's lock**: mended. `holdAlone`
   (`tools/runtime/landing.ts`) holds its clone through `hold` (`tools/runs/holder.ts`), so of
   eight takers on one dead holder one holds and seven wait, and a live pid with another start
   reads as gone and is sent nothing. Left: the clause that waits for a live landing holding the
   older record (a pid alone, or a pid and a note) goes once no open branch writes it, and the
   landing's lock now shares row 22.
2. **A cut investigation snapshot cannot be started again**: mended. `snapshotCampaign`
   (`tools/runs/seed.ts`) removes what its target holds before it copies, and refuses a target
   that holds the campaign or lies inside it. Left: two starts of one investigation folder at
   once, where the second removes the copy the first still reads; a start refuses the folder only
   once its shared instructions are written.
3. **An alerts look crashes on a peer that answers from an older tree**: mended. `answerOf`
   (`tools/runs/alerts.ts`) reads a row only where it holds every part the fold reads, and a host
   whose answer this tree cannot read is a host down for the look, said once. Left: a host that
   goes from silent to unreadable without answering between is not named a second time.
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

17. **Kept runs hold each other's slot at the cap**: mended. A kept run between two starts is
    marked `unwritten` (`liveHere`, `tools/runs/live.ts`) and counts only against the runs
    `countedAgainst` gives it, so of three kept runs on a login capped at two the first two by
    name start; a fresh start still counts every kept run. Left: a keeper that moves its run to
    another login counts every kept run there, with no order (`roomFor`, `tools/runs/keep.ts`).
18. **A solve's network line can change inside one comparison** (read, `networkReach`,
    `src/tools/command.ts`, read by `src/solver/run.ts`). An unreached reading is probed again
    after ten minutes, so the two sides' solves of one task can be told different things, and the
    log records neither. With row 5 it changes what a solver is told, which is the operator's:
    either a comparison's reach is fixed at its start, or `solve.started` records it.
19. **A kept run's ending is not alerted**: mended. The `kept` state names the environment's
    ending where the log ends on one (`stateOf`, `tools/runs/state.ts`), and `alerts` says it once.
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
- 10 November 2026, the operator, on the rows left for their word: "Regarding waiting on me, reach
  time philosophy and fill those in yourself. Stein philosophy." Decided from it, each with what
  would overturn it: row 17 is mended inside `startRefusal`; row 18 records the reach each solve
  was told in `solve.started` and fixes nothing else until one task's two sides record different
  reach; row 5 loses its clause with the next change to a seat's prompt and not before, since a
  prompt change alone ends comparing runs across it. Rows 5 and 18 still take the operator's word
  where they change what a seat is told.
- 10 November 2026, the operator, after the release: "set up full protocol" for ten hours, to
  "ensure everything works well in this system". Rows 1, 2, 3, 17 and 19 were mended in that
  window, the rows that change the run tools alone.

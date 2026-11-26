# ADR 0005: Append-only campaign log, decision table, and pause boundaries

## Status

Accepted

## Context

Every campaign persists all state in a single append-only `log.jsonl` file (`AGENTS.md` §5). Multiple processes can read or append concurrently, crashes can leave half-written lines or open sessions, and the host must choose the next campaign move deterministically from the log alone.

## Decisions

1. **Exclusive descriptor locking, hardlink-safe truncation, and raw-byte filtering (`src/kernel/log.ts`, `src/meta/filesystem.ts`)**
   - `append` synchronises concurrent writers with libc `flock` (`lockExclusiveSync`), which releases automatically on descriptor close or crash.
   - `truncatePartial` reads backward through the locked descriptor to find the last newline, leaves already-whole files untouched (safe on read-only or hardlinked copies), and detaches shared hardlinks (`detachHardlink`) before truncating in place.
   - `eachEvent` and `read` skip excluded event kinds directly from fixed byte chunks using the fixed `"at"` prefix offset (`AT_END = 31`, `","kind":"`) without decoding or JSON-parsing skipped trace events.
   - `EVENT_KINDS` retains retired event kinds so historical campaign logs remain readable.

2. **Ordered campaign decision table (`src/campaign/scheduler.ts`, `ROWS`, `decide`)**
   Rows evaluate in fixed priority order:
   1. `stop`: operator stop word or promotion cap ends the campaign unconditionally.
   2. `exam`: unsettled exam runs before bounds because reading an exam bills nothing; drafting checks bounds first because drafting bills.
   3. `bound`: spent budget, consecutive provider crashes (`CRASHES_IN_A_ROW = 3`), improvement patience (`PATIENCE = 6`), or cap-short comparison. Under a spent budget, an already-read step promotes first because promotion bills nothing.
   4. `tasks`: pack intake, initial practice release, operator `tasks` word (after any waiting promotion so the Examiner writes for the new reference), or initial supply shortfall (`comparisonFloor` plus owed practice, avoiding pre-first-comparison over-examining).
   5. `unfinished`: resume an in-progress comparison before starting new work.
   6. `step` / `revert`: promote the newest harness that read a step against the current reference, or revert an unconfirmed reference.
   7. `no-room` / `unread` / `build`: request tasks when the reference has no room; compare newly written tasks (at least `sweepOf(level)` held out since the last reading) before paying for another Builder session; otherwise run Builder.

3. **Practice release bounds (`src/campaign/scheduler.ts`, `practiceDue`, `tasksToAskFor`)**
   Each new reference is owed its own practice on top of its frontier. `practiceDue` caps releases at half of newly written tasks (preventing small Examiner sessions from losing their entire frontier), requires leaving `comparisonFloor` frontier tasks held once practice or a promotion exists, and subtracts released tasks that were already outside the practice frontier so they do not re-grant allowance.

4. **Interrupted session recovery and attribution (`src/kernel/trace.ts`, `openSeats`, `cutSessions`, `cutCounts`, `ownersOf`, `ownedBy`)**
   - Unfinished sessions and solves are billed from their metered turn and compaction events rather than zero so crashes cannot bypass caps.
   - `cutCounts` reconstructs in-flight draft attempts (detecting solves started after the last completed `draft_exam` call) and admitted Examiner tasks (`task.gate`) so a killed session that held tasks is not misclassified as `cutShort` with zero output.
   - In Builder-led campaigns, comparisons and Examiner sessions execute inside the Builder's time window; `ownersOf` attributes each solve to its explicit `asked` owner (or enclosing Builder for practice) so an open Builder is never billed for comparison or Examiner spend.

5. **Armed pause boundaries with fail-safe expiration (`src/campaign/signal.ts`, `pausePointReached`, `pauseReachedAt`, `paused`)**
   Bounded pauses (`--after reported`) wait out unpromoted steps and unread post-promotion starter comparisons, latching onto the start of the contiguous reached suffix. Once reached, a pause holds new solves and moves for `PAUSE_STOP_WINDOW_MS` (180 s) so a dead `runs pause` process cannot deadlock a campaign indefinitely.

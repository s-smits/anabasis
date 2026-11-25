# What follows a reading: the move table and supply patience

Read this reference to understand or modify how the next campaign move and supply patience are
determined (`AGENTS.md` section 7).

## What follows a reading

`decide` (`src/campaign/scheduler.ts`) evaluates its nine ordered `ROWS` and returns the first rule
that matches, together with a rule code printed on the last line of `runs view`:

1. `stop`: an operator stop word is pending.
2. `exam`: the exam is not yet valid. The host either drafts an exam or validates the checker when
   no checker reading exists or when the operator has admitted a new check; any unaddressed fault
   that is neither frozen nor admitted ends the campaign.
3. `bound`: a stopping bound has been reached, namely budget exhaustion, the crash rule
   (`crashedRun`), the stop rule, a defect stop, a dollar-cap cut, or a remaining budget below the
   estimated cost of the next comparison (`cap-short`).
4. `tasks`: pack tasks must be admitted, owed practice tasks must be released, or new tasks must be
   authored because the pool is empty, because the operator requested more tasks (after any pending
   step is promoted), or because the pool before the first comparison is below the admission floor
   plus owed practice.
5. `unfinished`: an already started comparison resumes to completion.
6. `step`: a comparison reading produced a step naming a harness to promote; when several wait, the
   newest is promoted (`unpromoted` explains why others are skipped).
7. `no-room`: the reference harness's last comparison left no improvement headroom, so the Examiner
   must author tasks that challenge it. Following a promotion (which leaves room by construction),
   this row schedules an Examiner session for the new reference until one completes cleanly: a
   session ended by a provider crash or stop signal remains owed regardless of whether it admitted
   any tasks.
8. `unread`: tasks admitted since the last reading are evaluated (`heldSince`), whereas a candidate
   harness that has never been compared waits for the Builder's own `compare` call. After a
   promotion, until a comparison tallies at least one task in the new epoch, this row triggers a
   **starter comparison**, prioritising newly admitted tasks before older ones so confirmation tests
   beyond tasks calibrated solely to the new reference. A waiting harness is re-evaluated only if
   its prior reading tested zero tasks or found no room; a harness that had room and read `no-step`
   must be modified by the Builder rather than receiving a second draw.
9. `build`: otherwise the Builder runs. If comparison admission would fail for lack of tasks
   (`refusals`, `src/campaign/admission.ts`) or the previous comparison tallied nothing, the reason
   indicates that tasks are needed, and supply patience eventually terminates the campaign with
   `exam`.

## Supply patience

`roomless` counts consecutive failed supply attempts: comparisons against the reference that leave
no room, and completed Examiner sessions that admit zero tasks. The comparison that initially
revealed the shortage is excluded. Reaching the threshold terminates the campaign with `no-room`
when seeking headroom, or `exam` when seeking tasks. Any comparison that finds room, any promotion,
or any Examiner session whose newly admitted tasks have not yet been compared resets the counter.

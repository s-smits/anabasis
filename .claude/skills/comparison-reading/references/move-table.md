# What follows a reading: the move table and supply patience

Read this to explain or change the next move or supply patience (`AGENTS.md` section 7).

## What follows a reading

`decide` (`src/campaign/decide.ts`) returns the first of its nine `ROWS` that applies, with a rule
code, printed on the view's last line:

1. `stop`: the operator left a stop.
2. `exam`: the exam does not stand. It is drafted, or read where nobody read its checker or the
   operator admitted a new check; a fault nobody froze or admitted ends the campaign.
3. `bound`: the budget, the crash rule (`crashedRun`), the stop rule, a defect stop or a cap cut.
4. `tasks`: a pack's tasks are taken in, practice released, or tasks written where there are none,
   where the operator asked (after a waiting step is promoted), or before the first comparison up to
   the admission floor plus owed practice.
5. `unfinished`: a begun comparison continues.
6. `step`: a step names the harness to promote, the newest where several wait (`unpromoted` says why
   another is not).
7. `no-room`: the reference's last comparison left it nothing to gain, so the Examiner writes tasks
   it fails. After a promotion, which reads room by construction, this row names one Examiner
   session for the new reference.
8. `unread`: tasks held since the last reading are compared (`heldSince`); a harness no comparison
   has read waits for the Builder's own `compare`. After a promotion, until a comparison tallies a
   task in the epoch, this is a **starter comparison**, drawing those tasks first and then older
   ones, so the confirmation reads beyond tasks written above the new reference's grade. A waiting
   harness is read again only where its last reading tested nothing or left no room; one that had
   room and read no step is the Builder's to change, never a second draw.
9. `build`: otherwise the Builder builds. Where admission would refuse for want of tasks
   (`refusals`, `src/campaign/admission.ts`) or the last comparison tallied none, the reason says to
   ask for tasks, and supply patience then ends the campaign `exam`.

## Supply patience

`roomless` counts consecutive failed supply attempts: comparisons against the reference that leave
no room, and finished Examiner sessions that hold no task. The comparison that first showed the need
is excluded. At the threshold the campaign ends `no-room` when seeking room and `exam` when seeking
tasks. A comparison with room, a promotion, or a session whose tasks are not yet compared resets it.

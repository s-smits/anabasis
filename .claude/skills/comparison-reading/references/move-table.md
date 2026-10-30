# What follows a reading: the move table and supply patience

Read this before you change or explain which move a campaign makes next, why the view's last line
names the move it does, or when supply patience ends a campaign. It holds the end of `AGENTS.md`
section 7, "How a comparison is read": what follows a reading (the ten rows of `decide`) and supply
patience.

## What follows a reading

What follows a reading is move 7's decision (`decide`, `src/campaign/decide.ts`), printed as the
view's last line. Its ten rows are asked in order (`ROWS`); the first that names a move chooses it,
and the decision carries its code:

1. `stop`: a stop the operator left ends the campaign.
2. `exam`: the exam does not stand: it is drafted where the campaign opened from a prompt, read where
   nobody has read its checker, and the campaign ends where a fault stands that nobody froze or
   admitted.
3. `bound`: a bound is spent: the budget, the provider (`crashedRun`, section 6), the stop rule, or a
   comparison stopped on check defects or cut by its cap.
4. `tasks`: the tasks are not set up: a pack's are taken in, practice released, and tasks written
   where there are none, where the operator asked, or before the first comparison up to the
   admission floor plus the practice still to be drawn.
5. `unfinished`: a comparison that began and has not reported continues.
6. `step`: a step against the reference names the harness to promote, the newest where several wait
   (`unpromoted` says why another is not).
7. `no-room`: the reference's last comparison left it nothing to gain, whichever side it took: no task
   informative for it, or none either harness answered. The Examiner writes tasks it fails; there is
   no shorter budget to fall back to. After a promotion, whose comparison reads room by construction,
   the row names one Examiner session for the new reference, which the host starts beside the
   conversation.
8. `short`: comparison admission would refuse for lack of tasks (`refusals`,
   `src/campaign/admission.ts`), or the pair's last comparison tallied none, so tasks come first: a
   changed harness can only tie again on tasks the reference closed.
9. `unread`: something no comparison has read is compared: a harness whose sessions have run, and
   tasks held out since the last reading (`programs-of:` remains a harness name for an audit by
   hand). Where no session has left a harness other than the reference, a **starter comparison**
   reads those tasks before a Builder session is paid for.
10. `build`: otherwise the Builder builds. The row first releases owed practice (code `practice`),
    and sends for tasks where the last session changed nothing and saw no failed practice solve
    (code `unshown`).

## Supply patience

**Supply patience** (`roomless`) counts the readings in a row, to the end of the log, that left
nothing to gain: a comparison against the reference with no room, or a whole Examiner session that
held out no task. At the campaign's supply patience it ends `no-room` where room was asked for and
`exam` where tasks were. The comparison that raised the need is not counted; a comparison with room,
a promotion, or a session whose tasks no comparison has read yet resets the count.

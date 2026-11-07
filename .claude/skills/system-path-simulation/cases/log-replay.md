# Log replay

```sh
bun run runs replay [<name> ...]
```

Recorded campaigns are the real input for a change to an event's shape, a fold or a reader. `replay`
reads every campaign log `runs()` finds in the repository's worktrees, seeds included (names are
substring filters), and `replayed` checks events and kinds, task states and sets, session-written
tasks, conditions, the stop rule and the investigation's `overview`. It writes nothing, and a refusal
is printed in the reader's words with exit 1. A log appended to at that moment can read torn; run it
again.

Run it before a commit that changes `EVENT_KINDS` or a field or order a fold reads, after a rebase
onto a moved stack, and before seeding from an old campaign (`seedCampaign` checks only `read` and
`taskSets`).

When a reader's output changes, run the old tree and the new over the same logs with `bun run runs
view <name>`, `bun tools/wri/wri.ts read --log <log>` and `bun run runs pulse <name>`, and report how
many logs were read and how many lines moved. A replay reads what was written; what a command would
do from the last event is a [rehearsal](rehearsal.md).

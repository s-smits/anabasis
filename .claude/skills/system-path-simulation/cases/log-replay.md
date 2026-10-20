# Log replay

Recorded campaigns in the repository's worktrees give real input when an event's shape, a fold
or a reader changes.

```sh
bun run runs replay [<name> ...]
```

It reads campaign logs found by `runs()`, including seeds, in the repository's worktrees. Names
are substring filters. `replayed` checks the events and their kinds, task states and sets,
session-written tasks, conditions, the stop rule and the whole-run investigation's `overview`.
It writes nothing. A refusal is named in the reader's own words and makes the command exit 1.

A log being appended to at that instant can read torn. Run it again.

## When to run it

- Before a commit that changes `EVENT_KINDS`, a field a fold reads, or the order a fold enforces.
- After a rebase onto a stack that moved: another session's commit can change what a log must hold.
- Before seeding from an old campaign. `seedCampaign` checks its copy with `read` and `taskSets`;
  `replayed` exercises the wider set of folds above.

## A changed reader, read against the past

When a reader's words change, run the old tree and the new over the same logs and compare what they
print. The other readers take a name each and write nothing:

```sh
bun run runs view <name>
bun tools/wri/wri.ts read --log <log>
bun run runs pulse --once <name>
```

A line that moved on a real log is the change's effect, counted. Say how many logs were read and how
many lines moved. A count taken any other way is an estimate, and should be called one.

## What a replay cannot say

It reads what was written. It does not run a command, so it cannot say what a round would do from a
log's last line. That is a rehearsal ([rehearsal](rehearsal.md)).

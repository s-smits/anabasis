# Log replay

Every campaign a real run wrote is still on disk, in some worktree's `.ana/d2/`. When an event's
shape, a fold or a reader changes, the recorded logs are the cheapest real input there is.

```sh
bun run runs replay [<name> ...]
```

It reads each campaign log in the repository's worktrees with the kernel's own readers: the events
and their kinds, the task states and a round's sets, what the sessions wrote, the conditions and the
three-session rule. It writes nothing. A log this tree refuses is named in the reader's own words,
and the command exits 1. On 2026-10-08 all 24 logs on the host read.

A log being appended to at that instant can read torn. Run it again.

## When to run it

- Before a commit that changes `EVENT_KINDS`, a field a fold reads, or the order a fold enforces.
- After a rebase onto a stack that moved: another session's commit can change what a log must hold.
- Before seeding from an old campaign. `bun run runs seed` reads its copy the same way and refuses
  it the same way, which is the same check for one log.

## A changed reader, read against the past

When a reader's words change, run the old tree and the new over the same logs and compare what they
print. The other readers take a name each and write nothing:

```sh
bun run runs compare <name>
bun tools/wri/wri.ts read --log <log>
bun run runs pulse --once <name>
```

A line that moved on a real log is the change's effect, counted. Say how many logs were read and how
many lines moved. A count taken any other way is an estimate, and should be called one.

## What a replay cannot say

It reads what was written. It does not run a command, so it cannot say what a round would do from a
log's last line. That is a rehearsal ([rehearsal](rehearsal.md)).

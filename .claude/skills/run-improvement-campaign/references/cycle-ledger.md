# Cycle ledger template

`cycle.md` records evidence against the steps of [the release cycle](../SKILL.md#the-release-cycle),
which owns their order and authority; this file grants none. It lives beside each run's ledgers
([the cycle's files](../SKILL.md#the-cycles-files)).

**The word and scope**: the operator's exact word with a link to its record; the named runs, commits,
hosts, threshold and each `--keep` exception; the authority for stops, patches, landing and release;
each open decision.

**Evidence**, one line each:

- progress: step, state, time with UTC offset read from the clock as the line is written (`date -u`,
  never the time a step is expected), evidence path or exit code;
- stops: runs closed against runs named, exceptions and unread runs apart;
- investigation: each folder (with `iteration.json`), synthesis, `vetting.md`, `cross-domain.md`,
  `deviations.md`;
- plan: each `plan.md` with its `Pull request: #N`, checks and exit codes;
- predictions: the cycle view, `wri2p2.ts ledger <cycle folder>`, which is derived and never copied
  here;
- release: the word, tree-equality proof, land result, merge commit and tag;
- next cycle: its ledger, authority, runs and commits.

**Timers**: each armed timer (name, id, schedule with UTC offset, the day it was created, purpose,
authority), laid out as [timers.md](timers.md); one row for each firing that changed something (time
from the clock, what moved, rows resolved, timer change), and none for a firing that found nothing;
which session holds a step that two could take; and a dated append-only line for work between
firings. A log written in local time is converted as it is quoted, and the row says so.

**The loop's own measures**, at each handover: `timers.ts` over the session's transcripts (firings,
changed and quiet, by timer); for each iteration closed in the cycle, the hours from its trigger's
event to its fork's `campaign.opened`; the predictions written on a fix against those that held in
the next fresh run; and the `measures` lines of `wri2p2.ts due`, the files no live run measures.

# Cycle ledger template

`cycle.md` records evidence against the steps of [the release cycle](../SKILL.md#the-release-cycle),
which owns their order and authority; this file grants none. It lives beside each run's ledgers
([the cycle's files](../SKILL.md#the-cycles-files)).

**The word and scope**: the operator's exact word with a link to its record; the named runs, commits,
hosts, threshold and each `--keep` exception; the authority for stops, patches, landing and release;
each open decision.

**Evidence**, one line each:

- progress: step, state, time with UTC offset, evidence path or exit code;
- stops: runs closed against runs named, exceptions and unread runs apart;
- investigation: each folder (with `iteration.json`), synthesis, `vetting.md`, `cross-domain.md`,
  `deviations.md`;
- plan: each `plan.md` with its `Pull request: #N`, checks and exit codes;
- predictions: the cycle view, `wri2p2.ts ledger <cycle folder>`, which is derived and never copied
  here;
- release: the word, tree-equality proof, land result, merge commit and tag;
- next cycle: its ledger, authority, runs and commits.

**Timers**: each armed timer (name, id, schedule with UTC offset, purpose, authority); each firing
(time, finding, rows resolved, usefulness, next step, timer change); and a dated append-only line for
work between firings.

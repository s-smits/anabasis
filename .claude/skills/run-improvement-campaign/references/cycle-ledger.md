# The cycle ledger, and the loop that keeps it going

One local file, `.ana/wri/<date>-cycle-<tag>/cycle.md` beside the handover, is what every timer reads
first. It was built on 24 October 2026 around v0.7.0 and ran two campaigns, a double sweep, ten
patches and a relaunch from it. Copy its shape for the next cycle rather than starting from nothing;
the skill's "The release cycle" and "Timers" own the rules, and this file owns the template and what
the first cycle taught.

## Sections, in order

1. **The word.** The operator's sentence that opened the cycle, verbatim, with its date and the host
   it was given on, and one **authority** sentence: which steps it covers, and that merge, tag and
   release (step 9) wait for the operator's explicit word. A timer treats anything not covered as a
   question for the operator, asked once in a reply line while the other steps go on.
2. **Log.** Dated lines for what the primary did between timers. A timer never rewrites them.
3. **Steps.** The table below. A step's *done when* is something a file or an exit code can show, so
   the driver can check it from fresh bytes and mark it `done` with the time and the evidence.
4. **Frozen predictions.** One row per moved mechanism, a claim a recorded count settles and its
   falsifier, written against the resolved tree before the opening (section 3 of the skill).
5. **Timers.** One row per armed timer: name, id, cron, kind, what it does and why it exists. The
   ids are the only way to delete one later, so a replacement updates the row in the same turn.
6. **Firings.** One row per firing: time with its UTC offset, what was found, whether it was useful,
   the step after, and any timer change. An empty firing is still a row, because "three empty
   watches" is only knowable if they were written down.

## The steps

| # | step | done when |
| --- | --- | --- |
| 0 | read any host that was unreachable at the start (a peer's sessions, timers, handover) | the host answers and a `pro.md`-style file summarises what was read |
| 1 | stop the runs | `runs active` empty on every host |
| 2 | double sweep of the stopped runs (whole-run-investigation: brittle mechanisms, then what the last sweep missed) | `wri.ts collect` exits 0; `synthesis.md` and `vetting.md` exist |
| 3 | tune the earlier predictions | every earlier row has a resolution other than `open`; the next predictions are written |
| 4 | one gpt-6.1-sol high follow-up per confirmed or plausible brittle finding | a `followups/NN-report.md` per row of `vetting.md` |
| 5 | improvement plan | `plan.md`: a row per finding with owner, hostile test, expected result and disposition |
| 6 | implement on top of the open stack | the PRs are open on the native stack; a push checks only format, types and lint, so each commit stays unproved until step 8 |
| 7 | simulate the new path, then the most brittle components | `simulation.md` with a verdict per rehearsal |
| 8 | patch again from the simulation | every failure fixed inside its commit; `bun run land -- <top> --sanitize` passed (nearby tests per commit, full suite on the top) |
| 9 | consolidate, land and release (the skill's steps 9 and 10) | the operator's word; the stack regrouped by subject and proved with `--sanitize`; `bun run land -- <top> --merge`; the tag |
| 10 | fork fresh runs | the runs are live at a recorded SHA, predictions frozen first |

## The loop closes by itself

The **driver** (every three hours) takes the first step not `done` that needs neither an absent host
nor the operator. The **watch** (hourly) reads `runs pulse --once`, writes its row and speaks only
for a stopped run, a silence over 31 minutes with no host action, a login limit or a falsified
prediction. When every run of the cycle has reached its threshold or ended, the driver does the
close-out (opening, terminal, denominators, then each prediction `sufficed`, `partial`, `refuted` or
`untriggered`) and then **opens the next cycle**: it copies this template to a new folder, resets
steps 1 to 8 and 10, carries the unresolved predictions in as the new ones, sets the tree to the
current stack top, and begins at step 1. Step 9 is skipped, not waited for, while the operator has
not spoken: the runs fork on the open stack top (`forkedPR<N>`), which the skill already allows.

Where it stops is deliberately short:

- merge, tag and release, which need the operator's explicit word every time;
- stopping, pausing or relaunching a healthy run before it reaches the cycle's threshold;
- anything the walls keep apart (credentials, campaign logs, kept harnesses);
- a decision `vetting.md` marks operator-owned (a weight, a test level, an exam's subject), which it
  lists once and does not decide;
- a patch that would change the counting rule of the runs launched next, unless a recorded reading is
  shown to flip on it. It goes on a "Deferred" line of the plan with that reason.

## What the first cycle taught

Each line is an incident from 24 October, kept because the rule it produced is not obvious.

- **A review written from a stale ledger is stale.** The first timer review read a ledger 20 minutes
  out of date and most of its edits no longer applied; the second changed nothing; the third found
  the separate review timer redundant. A timer review now sits inside the driver, reads the ledger
  only, and a Codex review session is spent only on a new timer kind or three empty firings in a row.
- **Cadence found by use.** Half-hourly driving overlapped the watch. Hourly at :13 for the watch and
  three-hourly at :17 for the driver stayed useful; neither lands on :00 or :30, where the fleet
  clusters. Most firings after the first hours had nothing to report, and that is the design, not a defect.
- **A timer prompt holds facts that go false.** Run names, timer ids and step state are written as
  "state at the last edit: ... verify, do not assume". Times carry their offset: DST ended at 03:00
  on 25 October, so a morning appointment written as +02:00 would have fired an hour late.
- **Timers die with the session** and recurring ones expire after seven days. The handover lists the
  timers to re-arm and when.
- **Codex implementers cannot commit.** Their sandbox cannot nest the verifier's Seatbelt wall or
  write git directories, so they leave edits uncommitted for the primary to commit. They also tend
  to skip the tests that merely assert text they changed: one changed a prompt sentence and never
  ran the file that asserts it (six failures).
- **Stack ten patches bottom to top** with `git apply --3way` (four pairs conflicted, all in tests
  two fixes both touched), fold every later fix into its commit with `git commit --fixup` and
  `rebase -i --autosquash --update-refs`, and run the composed gate on the top before the push. It
  found a real interaction every single-commit check had passed: one fix stopped counting host
  waiting against a clock, which hung another fix's test that depended on it.
- **A hook-gated push can hang on the credential helper.** The osxkeychain helper hung; one push
  with `git -c credential.helper= -c "credential.helper=!gh auth git-credential" push` went through
  with no configuration changed. In zsh a refspec held in a variable is not word-split, so build the
  list in a bash array.
- **`bun run runs` spawns the first Bun on PATH.** A launch from a shell whose Bun differs from the
  tree's pin must put the pinned release first.
- **A swarm manifest's `workdir` must contain what its lanes write.** `wri.ts lanes` run from a
  stack checkout set every lane's `workdir` to that checkout, the sandbox then refused writes under
  `anabasis-runs/.ana/...`, and 22 of 23 lanes left their reports in scratch folders. Build the
  manifest with `workdir` set to the checkout that holds the investigation folder. Implementers need
  the opposite: one session per worktree, each with its own `workdir`, because a session whose
  `workdir` is the runs checkout cannot write the worktree even when it is listed in `ownedPaths`
  (all six first-pass implementers came back "blocked by filesystem permissions").
- **The driver script itself can be dead.** At v0.7.0 `scripts/cycle.ts` exited on a SyntaxError
  (it imported `hostsOf` from a module that no longer exported it) and nothing tested it, so the
  loop's first read would have failed silently. `test/cycle-script.test.ts` now runs it against a
  run name that does not exist and expects an empty row list; keep a test beside any script a timer
  depends on.
- **Ask the anti-gaming question every cycle.** The patches of a cycle are meant to make climbing
  faster, so a daily read-only audit lists every promotion since the last one with its
  objective-and-bill-removed p, whether its A/A control could read a step at the level, and the
  attempts under one reference, and lists every commit touching the comparison's inputs or
  statistics with the number of recorded readings it flips. It never changes a weight, a level or a
  threshold; it opens a Firings row when a flag is real.
- **Read `runs usage` at the launch, not after.** Two of three logins read "oversubscribed" an hour
  after the fork: at the week's pace each would run out before its reset. Say it once; moving a run
  or adding one on the free login is the operator's.

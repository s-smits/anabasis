---
name: builder-blocking-loop
description: "Get told the moment a live Builder session is blocked (five refused submits in a row, a repeated findings set, twelve checks without acceptance, two environment previews in a row, two hours without a submit) and fix the owner iteratively: read, fix on the owning PR, then keep the run or kill it and relaunch on the upgraded system, and rearm. Use while a paid run is live and the operator wants blocking caught and repaired, not only reported."
---

# Builder blocking loop

The improvement loop's watch step, narrowed to one question: is the Builder still getting closer to an
accepted submit? One watcher owns detection (`run-improvement-campaign/scripts/watch.mjs`); this
skill owns what happens when it fires.

## Arm

One Monitor per wave, never a polling turn:

```sh
bun .claude/skills/run-improvement-campaign/scripts/watch.mjs \
  --campaigns <run-worktree>/campaigns --runs <runId> \
  --state /private/tmp/ana-block-<runId>.json \
  --every 290 --stall-minutes 45 --max-seconds 21600
```

Exit 3 prints the rows to read; exit 0 means closed or a quiet window, and a quiet window is
rearmed as-is. Reuse the same `--state` on rearm so a row already read stays silent.

## Limits

Each sits one step above the worst a session that still reached acceptance recorded across the
40 truss epochs of 2026-09-13..15, so a healthy session does not fire:

| row | fires at | healthy worst | stalled example |
| --- | --- | --- | --- |
| refused submits in a row | 5 | 4 (`-12`, `rrrrA`) | none |
| same findings on consecutive refusals | 2 | 1 | none |
| `correctness_check` without an accepted submit | 12 | 11 (`-11`) | none |
| preview environment non-results in a row | 2 | 1 (`-7`) | 7d433e (`-16`), census wall |
| Builder minutes without a submit | 120 | 91 | `-13`, 129 min |
| no campaign evidence and no session write | 45 min | existing stall row | none |

A row is a lead, not a verdict. Change a limit only with a new survey of recorded epochs, in
`BUILDER_LIMITS` and this table together.

## When it fires

1. **Read the recorded bytes** named by the row: the newest `builder-execution*.json` submits
   (stage, `findingCodes`, `repeatedFindings`), `trials/*/environment-non-result.json`, the
   safeguard log, then `status.mjs --campaigns <dir> --run <id> --json`. Builder prose comes last.
2. **Name the owner.**
   - *environment*: a census or verifier wall, provider, sandbox. The fix belongs to the host
     path, never to the Builder.
   - *gate or contract*: a finding the Builder cannot act on, or one it acts on correctly
     that still refuses. Fix the gate, starter or shared contract.
   - *Builder behaviour*: refusals it could act on but did not. The fix is prompt or starter text
     only when the same failure repeats across runs (rule 14); a single session is no owner.
   - *progressing*: the row fired but the next checkpoint moved on. Record this and rearm.
3. **Fix on the owning PR** as stack-hop prescribes: the focused test for the defect, the
   smallest change, `simplify`, and one push through the gate. Protected verifier detail never
   enters a fix aimed at the Builder.
4. **Decide the run yourself.** A live run keeps its opening bytes, so a source fix never
   reaches it. The operator authorises a judgement call here (operator decision 2026-09-15):
   - **Kill and upgrade** when the run is heading the wrong way and the fix changes what a new
     run would measure. Examples: an environment wall that will cut every preview again, a gate
     defect the Builder cannot work around, or refusals that keep repeating a defect the system
     owns. Stop only this run, with `launch-run`'s immediate-stop procedure, and keep every
     receipt. Land the fix, recompose the stack and relaunch fresh from the new head through
     `launch-run`, with the same model and prompt.
   - **Keep running** when the session can still reach acceptance, the owner is Builder
     behaviour inside one session, or the fix would not change the remaining work. More
     evidence is worth more than a restart.

   Neither the number of rows nor elapsed time decides; which direction the run is heading and
   what the fix would change do. Record the choice and the reason in one line.
5. **Rearm** on the surviving or relaunched run, using the same state file for a survivor and a
   fresh one for a relaunch. Tell the operator in one line: the row, the owner, the fix head,
   and whether the run was kept or relaunched.

Every cycle ends at a rearm or a closed run, never at a report alone.

## Observe-only

When the operator says to let the run finish, skip steps 3 and 4. Append each row, then one
line naming the owner and the evidence read, to `<run-worktree>/.scratch/quick-run/blocking-log.txt`,
and rearm. The run goes to its terminal. Afterwards the log is the list of failure modes to fix
before the next launch.

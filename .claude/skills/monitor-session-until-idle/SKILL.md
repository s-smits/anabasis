---
name: monitor-session-until-idle
description: Critically supervise another Codex or agent session without taking it over, or audit a long, compacted or delegated session for commitments it forgot, narrowed or left unverified. Maintain executable closure, material-claim, and intervention ledgers; challenge unsupported claims before decision boundaries; correct proved errors; and stop only after accepted work and owned processes close. Use for long-running tasks, campaign watches, delegated reviews, and likely-mistake checks.
---

# Monitor a session until idle

Watch the target read-only. Treat its narration as claims and its receipts as evidence. Stop only after the accepted objective closes.

## Set the watch contract

Read the target from its first user request. Create one `monitor-watch-contract/v1` outside a frozen or controller-owned worktree. It has exactly three ledgers:

- `closures`: every accepted completion clause or owned operation, open until receipt-backed closure, hold or supersession;
- `claims`: every material positive assertion, `unverified` until its deciding receipt is cited;
- `interventions`: every `CHECK` or `DIRECT`, open from delivery through acknowledgement to verified or rejected effect.

Create and check the contract with the deterministic helpers:

```bash
bun .claude/skills/monitor-session-until-idle/scripts/thread-state.mjs history snapshot.json --all --json
bun .claude/skills/monitor-session-until-idle/scripts/thread-state.mjs summary snapshot.json --last 20 --json
bun .claude/skills/monitor-session-until-idle/scripts/thread-state.mjs summary snapshot.json --last 20 --json | bun .claude/skills/monitor-session-until-idle/scripts/watch-contract.mjs init -
bun .claude/skills/monitor-session-until-idle/scripts/thread-state.mjs summary snapshot.json --last 20 --json | bun .claude/skills/monitor-session-until-idle/scripts/watch-contract.mjs check - watch-contract.json
```

Persist the initial JSON with the normal edit tool, replace every placeholder, and add the exact user objective before checking it. The checker validates declared state; it does not infer domain truth from prose.

Mark a closure `held` only when the user explicitly holds that completion clause or owned operation. A question, a pause in commentary or polling, or the target's promise to continue in the background does not hold the accepted objective.

Look for deferred thread tools before saying they are unavailable. Read the task directly instead of using the UI. If a reviewer cannot read it, supply a bounded transcript or receipt-linked evidence.

Useful views of an exported task:

```bash
bun .claude/skills/monitor-session-until-idle/scripts/thread-state.mjs history snapshot.json --all
bun .claude/skills/monitor-session-until-idle/scripts/thread-state.mjs summary snapshot.json --last 12
bun .claude/skills/monitor-session-until-idle/scripts/thread-state.mjs diff before.json after.json --last 12
```

`thread-state.mjs` orders the supplied turns and summarises their items, truncating each item's
text to 1,200 characters. `watch-contract.mjs` checks the declared closure state. Inspect the cited
original items before changing any ledger status; the summaries are not complete transcripts.

Monitoring does not authorise a launch, merge, source edit, or repair of controller-owned output.

## Understand the current operation

Answer before steering:

1. What is running?
2. Which source, project, epoch, iteration, workspace commit, and condition does it use?
3. What is recorded, live, or only planned?
4. What can end it normally?
5. What remains outside the target's authority?

Treat run numbers as labels. Bind claims to exact identities. Check digests, executable roots, checkpoint versus executable identity, PR ancestry, and the actual local launcher or receipt.

Use two liveness signals when possible: task status, controller lock, provider child, heartbeat, workspace changes, recorded session result, or terminal receipt. Quiet output alone does not show a stall.

Keep evidence levels separate:

```text
draft → live observation → recorded session result → iteration receipt → typed terminal
```

A changed file or live process shows activity. Only a recorded receipt proves a stage. Keep authoring failures, runtime non-results, Built-case results, judge coverage, claims, promotion, and denominators separate.

## Act on the contract decision

Create an immediate `DIRECT` intervention for:

- authority drift in launch, spend, merge, model, or backend;
- source, project, epoch, condition, prediction, or PR ancestry mismatch;
- weakened wall, sandbox, verifier, credentials, or protected evidence;
- edits to controller-owned output or destructive changes;
- fabricated, unrecorded, cross-candidate, or denominator-damaging evidence;
- task-condition drift that breaks attribution;
- premature goal completion or blocked status, including a completed target turn while its accepted operation remains live without a terminal or explicit hold.

Create one `CHECK` for an unsupported material claim or owner contradiction before its next decision boundary. Ask for one discriminating receipt; do not pause healthy work. Leave lower-impact observations silent until their trigger fires.

Follow the checker result exactly:

- `DIRECT_IDENTITY_MISMATCH` or `DIRECT_COMMITMENT_LIVENESS`: send one bounded `DIRECT`;
- `CHECK_MATERIAL_CLAIMS`: send one receipt request for the listed claim ids;
- `VERIFY_INTERVENTION`: read the response and deciding receipt, then mark the intervention `verified` or `rejected`;
- `CONTINUE`: wait without messaging the target;
- `INSPECT_STATE`: inspect raw status before acting;
- `STOP_ELIGIBLE`: perform the final raw audit before stopping.

Use this warning form:

```text
CHECK <claim>: <conflicting evidence>. Before <boundary>, verify <one deciding receipt>.
DIRECT <class>: <exact evidence>.
Pause before <boundary>.
Preserve <identity or evidence>.
Next safe action: <one bounded action>.
```

Do not send status-only messages. Keep one intervention row per unresolved issue and never call an
acknowledgement a verified effect. Honour the requested cadence. Otherwise leave a few minutes
between unchanged polls. Prefer the task's wait tool. If shell monitoring is needed, start one
background command that exits on the real condition and poll it in bounded intervals. Each
foreground wait stays at or under 60 seconds.

## Monitoring loop

1. Read status and new items in chronological order.
2. Add or update closure, claim and intervention rows from raw evidence.
3. Check identity and liveness without treating silence as failure.
4. Run `watch-contract.mjs check`.
5. Execute only its bounded action; send no duplicate intervention.
6. On the next poll, verify the response and update the intervention row.
7. Repeat until the checker returns `STOP_ELIGIBLE`, then perform the final audit.

After answering a user question, reconcile any added commitment and resume this loop before yielding. Do not edit source, skills, checklists, or campaign output during a frozen run. Record improvements for after terminal unless the user authorises an emergency safety correction.

If a steer changes source or experiment identity, end or interrupt the old run and use a fresh project and prediction set. After a real provider turn begins, never reuse the interrupted project or repair a stale lock by hand. Mark observations from an interrupted unrecorded attempt as unbound.

Judge each owner prediction separately. A composite checkpoint moving farther does not prove every stacked change helped.

## Stop rule

| Target state | Action |
|---|---|
| Active and moving | Continue at the chosen cadence. |
| Active and quiet within its bound | Continue without calling it stalled. |
| Active with a material error | Warn once, then verify. |
| Typed terminal or error | Update the three ledgers and require `STOP_ELIGIBLE`. |
| Idle with completed latest turn | Require the contract decision; steer open closure or claim rows. |

The final audit checks the raw receipts behind every settled closure and intervention, confirms no active task or owned process remains, and reports unresolved claims as unverified. `STOP_ELIGIBLE` is necessary but does not replace this audit.

Stopping the watch is separate from the goal state. An authority-held launch is `no-go awaiting authority`, not blocked. Mark a goal complete only after every original completion clause is proved. Use blocked only under the goal tool's repeated-blocker rule.

## Audit a session for lost commitments

When the question is what a long, compacted or delegated session promised but did not finish, audit
instead of steering. Resolve the exact session first: transcript path, session id, start time, live
process and the implementation worktree, which may differ from the shell cwd. Freeze a cutoff (final
record id and timestamp, line count, worktree HEAD and status) and audit only records through it;
inspect the records appended afterwards once at the end. The transcript is authority for intent; the
repository, receipts, tests and later transcript are authority for completion. Compaction summaries
are lossy: compare the explicit pre-compaction decision with the first post-compaction plan, because
a summary that narrows `A + B` to `B` is itself a transition loss.

Classify each candidate as exactly one of `confirmed_omission`, `partial`, `unverified`, `active`,
`completed` or `superseded_or_intentional`, and for every proposed omission test that it was not
completed elsewhere, superseded or still in progress. A subagent suggestion, an exploratory "could",
a stale task reminder after a later decision, or an unsupported summary assertion is not a
commitment. Cite the record and the deciding file, commit, test or receipt. Lead the report with
whether work was truly lost, keep active work separate from forgotten work, and end with three to
seven next actions in dependency order.

## Handover

Report, in order:

1. whether the target stopped cleanly;
2. every intervention and its verified or rejected effect;
3. final identities and ledger state;
4. material claims still unverified;
5. what remains unproved;
6. the next action and authority needed.

Do not imply that local tests prove a future live run, one change explains a whole stack, judge advice is verifier truth, or a missing denominator is zero.

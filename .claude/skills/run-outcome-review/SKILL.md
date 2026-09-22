---
name: run-outcome-review
description: Review a campaign run or recorded case through its outcomes, or assess whether a live run is still producing useful evidence. Resolve identity, closure, denominators and failure ownership without changing a score. Read-only; launch-run owns an authorised stop and the campaign owns any replacement.
---

# Run Outcome Review

Read what the Builder produced and what the host actually measured. Name the question
whose answer changes the next owner, claim or experiment. A routine closure needs no
automatic investigation swarm or duplicate evidence collection.

Use [whole-run-investigation](../whole-run-investigation/SKILL.md) for requested broad
coverage or an unresolved whole-run question; follow its snapshot contract when using
its results and extended post-run handoff. This Skill owns deterministic outcome reading,
not stopping a process or launching its replacement.

## Establish identity and closure

Resolve the run id, project, worktree and full source commit from its controller
`opening.json`. Use that source's official readers; unavailable source is
`source-unresolved`. A newer reader's replay is a separate result.

Read the terminal and iteration receipts alongside case rows. A terminal named
`completed` can end with `candidate-unchanged` and no new battery. A process still
running can be inside one long authoring turn; use controller-written execution
checkpoints, not file mtimes, to establish progress.

For each battery, report verified, passed, unaccepted and typed non-result counts.
Use [references/case-rows.md](references/case-rows.md) for case classification, the
row schema, verified trace reading, non-result ownership and the symptom-to-owner table; it
replaces the former `run-receipts-and-nonresults` skill. Let its shared reader resolve promotion
moves and intentional collection links; never guess a case's current root.
Zero verified cases prove an operational result only. A later refusal preserves
earlier recorded denominators. Missing evidence stays unknown.

## Read the deciding evidence

Run through the prepared worktree's wrapper. Start with the one useful view:

```sh
bun run outcome <campaignDir> <runId>
bun run outcome <campaignDir> --builder
bun run outcome <campaignDir> <runId> --case <taskId>
```

Read the exact revision's `USAGE` in `tools/outcome/cli.ts` for scorecards, Judge,
observations, safeguards and filters. Do not copy that evolving command catalogue
into this Skill. A saved projection is an analyst snapshot, not controller evidence.

Join claim/readiness clauses, the actual promotion decision, analysis and authoring
records to the same battery and bundle. Claim validity does not mean all cases passed;
a held promotion is a recorded decision, not an adoption. Follow cascading refusals
back to their earliest deciding receipt before assigning several defects.

Use trace and observation detail to explain the recorded result. Name the denominator
for every time, cost, tool or usage total. Truncation gives lower bounds. Declared tools
without calls do not establish unused machinery; check native calls, exposure and
recording support before proposing deletion.

For a live run, record the reading time and bound findings to that snapshot. Before
synthesis, check for a new terminal or battery and state what changed; do not quietly
add later cases to an earlier finding's denominator.

## Assess whether a live run remains useful

This is the assessment formerly owned by `stop-unfruitful-run`. Bind at least two recorded
checkpoints to the same run and read the newest one before recommending a stop:

| Evidence | Question |
|---|---|
| Repeated typed findings, candidate identities and unchanged permitted work | Can the next round learn or change anything the earlier one could not? |
| A demonstrated defect with a source fix that this run cannot receive | What remaining observation would justify letting the old condition finish? |
| Repeated provider failures or a proven host fault | Is recovery possible within the authorised condition, or does it require an external change? |

A new family, changed denominator, candidate edit or live tool checkpoint can refute a stall.
Log silence, one slow turn, one transient non-result and a live PID alone decide nothing.
Do not label an unchanged finding a dead end without checking writable scope and new facts.
Recommend continue, investigate or stop, naming the evidence, owner and what stopping leaves
unknown. A revoked credential or disabled account is not a reason to repeat identical retries.

For a stop already covered by user authority, hand the exact run to
[launch-run's stop procedure](../launch-run/SKILL.md#stop-a-run). Otherwise request the missing
permission. Verify terminal, process and owned-child closure there. Preserve all recorded
denominators. A stopped run proves neither a capability limit nor that a later fix works.
Any replacement belongs to [run-improvement-campaign](../run-improvement-campaign/SKILL.md)
and its separate launch authority, condition and pre-opening prediction.

## Adjudicate the finding

Check a review's diagnosis against each case's public requirements and accepted bytes.
Different task inputs can explain a passing contrast. A missing context card is not
a missing domain rule. Review prose and safeguard firings are leads, not verdicts.
Read the measured source's `runJudgePhase` and calibration validity rule for standing;
zero paid controls can be the intended all-agreement route and leaves the Judge unvalidated.

Distinguish content from the shared mechanism. An unchanged evaluator-only repair
does not prove a retry defect: inspect its base bytes, admitted owner, writable scope,
actual edits and completed checks. Determine whether the selected owner could change
the implicated files. A generated gap alone does not justify hard-coding a domain fix.
After a repair, compare each disputed obligation with the actual diff and next review.
A finding downgraded from blocking to advisory is a changed judgement; if its missing
predicate remains absent, promotion and passing cases do not establish that it was fixed.

Compilation, linking, shared-core execution and target hardware behaviour are distinct
claims. Join the accepted source files and executed-tool receipts before naming the
strongest proved scope. For climbs and rebuilds use
[run-climb-lab's difficulty reference](../run-climb-lab/references/task-difficulty.md): a higher score on a
changed task/verifier condition is not causal improvement.

## Handoff

Return findings first: confirmed, refuted or deferred, with one owner, exact evidence,
denominator and the smallest remaining discriminator. Separate present source,
deterministic proof, live exercise and outcome proof. Name anything not reviewed.
Consolidate repeated symptoms under one deciding mechanism.

When the operator wants one run packaged for handover, follow
[references/handover-zip.md](references/handover-zip.md).
Never edit generated campaigns, domains, cases or accepted harnesses. Keep protected
verifier detail in operator analysis; only the existing typed public projection may
reach authoring. Hand predictions, safeguard disposition and replacement selection
to [run-improvement-campaign](../run-improvement-campaign/SKILL.md).

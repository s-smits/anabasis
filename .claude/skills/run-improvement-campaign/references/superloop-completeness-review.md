# Super Loop completeness review

Independent lenses for one question: **does the Super Loop close?** The loop is the campaign cycle
this skill owns — choose an experiment, prove the changed path, freeze a prediction, launch, watch,
read the recorded bytes, adjudicate, patch the owner, restack, launch again. A stage that runs but
whose output reaches no next stage is an open edge: work that costs money and changes nothing.

Completeness is not "does the code exist". An edge is **closed** only when all four hold:

1. a **producer** writes a recorded artifact at a named path;
2. a **consumer** in the loop reads that artifact, not a sibling copy of the same fact;
3. a **decision changes** on what it read — a different experiment, owner, gate, launch or stop;
4. a **hostile case** exists that would fail if the edge were cut.

Report each edge as `closed`, `open` (producer with no consumer, or a consumer reading nothing), or
`decorative` (both ends present, no decision changes). Use the repository's four evidence levels
separately: present in source, deterministically proved, live-exercised, outcome-proved. A rule
whose mechanism has left the source is dead text — say so rather than scoring it.

## Shared packet

**Which tree.** The loop's skills, scripts and this file live on `main`; read them at
`3d0e0b8be` or later. The product source the loop launches is the open stack **#743 → #750**,
whose head is PR **#750** (`codex/built-slot-account-0918`, `5456fb95b`) — read `src/`, `test/`
and `starters/` there, not on `main`, because `main` is behind the stack. Name both revisions in
the report; a finding against the wrong one is not a finding. Where a lens reads only skill files,
say so and cite `main` alone.

Every session receives: the absolute repository path and both revisions above, `AGENTS.md`, this
skill's `SKILL.md`, and the loop inventory below. Sessions are **read-only** and independent: do not
read another session's report, do not read protected verifier detail (verifier stdout/stderr, issue
text, counterexamples, reference artifacts, per-task failure locations), and do not start, stop or
modify a live run. Cite every claim as `path:line`. Name one innocent explanation for each open
edge. Where an edge's status turns on a fact you cannot read, return it as a falsifier, not a guess.

Loop inventory, as of 18 September 2026:

| stage | owner | scripts |
| --- | --- | --- |
| choose, patch, compose | `run-improvement-campaign/SKILL.md`, `simplify`, `stack-hop` | — |
| prove the changed path | `system-path-simulation` | `run-condition.mts`, `judge-replay.mts`, `review-settle.mts`, `seed-campaign.mts` |
| predict | `run-improvement-campaign` | `prediction.ts` |
| launch | `launch-run` | `launch.ts`, `probe.ts`, `options.ts`, `service.ts`, `stop.ts`; `preflight.mjs` |
| watch | `run-improvement-campaign` | `campaign.ts` |
| read | `whole-run-investigation` | `wri.mjs`, `references/outcome-review.md`; `bun run outcome` |
| attribute a climb | `whole-run-investigation` | `references/climb.md` |
| independent evaluation | `harness-query` | `harness-query.mts` |
| close | `run-improvement-campaign` | `campaign.ts`, `prediction.ts adjudicate`, `notes/current-state.md` |
| weekly | `weekly-run-review`, `safeguards` | `select-best-runs.ts`, `bun run outcome -- --safeguards` |

Required output, one table plus the notes below it:

| edge | producer (`path:line`) | artifact | consumer (`path:line`) | decision changed | evidence level | verdict | falsifier |

Then: the single most consequential open edge, the cheapest repair that closes it (prefer deleting
or reusing an owner over adding plumbing), and any mechanism you found with no live consumer at all.

## What closes this review

Read rule 3 against this file itself: a report that names open edges and reaches no consumer is
decorative, and the review has then done to the loop exactly what it accuses the loop of. So every
finding leaves as one of four typed outcomes, into an artifact the loop already reads. There is no
fifth, and a finding that fits none of the four is not a finding — drop it rather than write it up.

1. **A commit on the owning PR.** The edge is open because source is wrong and the repair is known.
   Closed by a sha on the PR whose source it corrects, never a new PR against an unmerged one.
2. **An open decision in `notes/current-state.md`.** The edge needs a decision, not a patch. The
   row names one owner, the missing evidence and the decision it will change; the snapshot holds at
   most five, so a sixth finding must displace a staler one or wait.
3. **A frozen prediction row.** Closing the edge *is* the next experiment's moved variable. Freeze
   it with `prediction.ts freeze` before that run's opening, with the falsifier the lens returned.
4. **A deletion.** The census found a mechanism with no live consumer. Route it to the weekly
   removal review, which already owns removals, with its last real use dated.

The hostile test for the review is the one it applies to every other stage: **if a review ran and no
PR commit, snapshot row, frozen prediction or deletion followed it, the review was decorative** —
record that, with the lenses that produced nothing, and run fewer next time. Counting findings is
not a result. The reviewer writes the four-column exit beside its table; the campaign session, not
the reviewer, performs the outcome, because a read-only lens changes no file.

## 1. prediction_to_opening

Own the edge from a frozen prediction to the run it constrains. Read `prediction.ts`, the ledger
layout under `notes/predictions/`, and the launch path. Decide whether a frozen row is bound to the
run id and source sha before the opening exists, whether `adjudicate` can be reached for every
frozen row, and what happens to a row whose mechanism a later PR retired. Test the failure the
skill already records: a row that only Git history dates before the run. State whether anything in
the loop refuses a launch, a claim or a next experiment because a prediction is missing or
unadjudicated — and if nothing does, say plainly that the ledger is a record, not a gate, and
whether that is the right answer here.

## 2. watch_to_assessment

Own the edge from `campaign.ts` to a decision. Determine what a deviation actually
emits, who reads it, and which of its signals — stall minutes, disk floor, blocked Builder session,
completion — leads to a different action rather than a line in a log. Check the detached-watcher
contract against the 600-second Bash wall and the 290-second polling rule. Distinguish a sensor
that changes the next move from one whose only consumer is a human reading a terminal.

## 3. recorded_rows_to_owner

Own the edge from the run's recorded bytes to a patched owner. Trace terminal, case kinds, claims,
promotion decisions and the safeguard census into the choice of the next change. Decide whether the
loop names an owner from evidence or from prose, whether the `FeedbackOwner` closure — nine
bundle files and `environment` — is the one actually used, and whether a finding can complete the cycle without ever reaching source.
Name every point where a recorded row is read by a human step with no script and no artifact.

## 4. proof_before_launch

Own the edge from `system-path-simulation` to the launched condition. Decide whether the proof is
required, recorded and read, or optional and skipped in practice; whether a proof over a test double
is distinguished from one over the real consumer; and whether the recorded proof choice reaches the
prediction and handover as the skill's table says. Check that the launch envelope is the only
authority that can start a paid run. Return what a changed condition can
reach a paid opening without.

## 5. independent_evaluation_to_next_experiment

Own the edge the loop was most recently extended for. An offline battery (a fixed pack solved on
each distinct harness and graded through the real verifier) and `harness-query` both produce evidence about a measured product **outside** the paid
controller. Decide, for each: does any loop step read its output; is there a recorded artifact the
next experiment consumes, or does the finding exist only in a session's terminal; and can its
verdicts reach a Builder-visible surface, which rule 4 forbids. Say precisely which of the two is
wired into the cycle, which is a side channel, and what the smallest closing edge would be — reusing
an existing artifact and consumer, not a new file format. Note also whether the cycle key the export
records (`label.py` `CYCLE_SURFACES`) is read by every later consumer or re-decided by each.

## 6. closure_and_handover

Own the edge from a terminal back to the next launch. Read the advisories `campaign.ts` prints, the
adjudication path, `notes/current-state.md` and its handover. Decide whether every terminal — including short and
zero-case runs — reaches closure, whether the append-only ledger's refusal of a second adjudication
is handled when two sessions close the same run, and whether the snapshot's 150-line and five-decision
limits are enforced by anything. State what a next agent would be unable to continue without
rereading a transcript, which is the condition this stage exists to prevent.

## 7. dead_mechanism_census

Own everything in the loop with no live consumer. For each skill script in the inventory, find its
callers: another script, a documented command, a test, or nothing. `scripts/stage.mjs` is the known
example — `SKILL.md:86` tells agents not to add it while the file sits in the same skill with only
its own test as a caller. Return every such mechanism with its last real use if you can date it, and
say for each whether the honest repair is deletion, one line of documentation, or a consumer. Do not
propose keeping a mechanism because removing it would be work.

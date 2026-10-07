# The synthesis

Load this when turning the readings into one adjudicated result: when checking `<dir>/synthesis.md`,
filling a run's `main_synthesis.md`, or answering the operator's "what do we change next". It guides
the primary and adds no gate and no campaign authority.

## What the synthesis must produce

`wri.ts synthesis` renders the synthesis agent's prompt from
[synthesis.template.md](synthesis.template.md), filling in the investigation directory, the note's
path, a fresh report index and the shared instructions; `--template <abs file>` renders an edited
copy instead. The template owns what the note owes, and this section says why each part is there,
so change the two together.

The agent reads every report `collect` marked ok, names every missing or invalid one as a gap rather
than filling it from memory, re-checks each finding it carries against the run's source at its own
commit, and quotes no campaign text. The note owes, in this order:

1. **The operator's question, per run.** By default the four links: the build harness ran on the
   shipped bytes; all feedback was produced and gathered; the review feedback was used; everything
   was handed over. Each cell is `happened`, `did not happen` or `undeterminable`, with a path and a
   count. The readings do not answer these links; the synthesis does, from what they found. When the
   orientation asks a different question, edit the template copy to match.
2. **The binding constraint**: the one mechanism that most limits the next run, and why it outranks
   the rest.
3. **One merged findings table**, one row per mechanism after collapsing repeats under their
   earliest demonstrated owner, ranked by consequence for the binding constraint and the four links:

   | finding | readings | runs | corpus count | owner | outcome |
   | --- | --- | --- | --- | --- | --- |

   `readings` names which of per-run (P), cross-run (C) and multi-run (M) raised it; agreement counts
   only between readings reached independently, so a mechanism M found alone that P also found is
   corroborated, and one only a single reading found is a lead. `runs` names where it holds and where
   it was checked absent. `corpus count` is the readings' count of distinct campaigns and domains,
   both counts where two readings differ. `owner` is `file:line` at the run's commit, saying when it
   has moved on main since. `outcome` is exactly one of `patch`, `decision`, `prediction` or `drop`,
   and only a fix whose shape recurs across campaigns is a `patch`.
4. **Conflicts resolved**: where readings disagree, the bytes that settle it, or the unresolved
   alternatives and the observation that would separate them.
5. **Verdicts on existing branch commits**: for each open branch commit the findings touch, keep,
   amend (how) or drop (why). A change whose branch had no eligible opportunity in these runs, or
   was never reached, is unexercised, not failed.
6. **Build plan**: clusters whose file sets are disjoint, so each can be built in parallel by its own
   agent in its own worktree; per cluster the owners, the mechanism, the test that fails without it,
   and the open PR it appends to. A fix goes onto that PR, never into a new one.
7. **Operator decisions**, each with one owner, the missing evidence and the decision it changes.
8. **Predictions**: falsifiable rows for the next run (moved variable, claim, direction,
   falsifier), for `run-improvement-campaign` to freeze before any launch.

## Adjudicating

Treat every report as research. Check each consequential claim against the exact source at the
run's commit and the consumer that actually ran, reconcile totals with the verified readers, and
resolve a disagreement by what each method could observe: neither confidence, a majority nor an
abstention wins. Mark each claim in the synthesis as re-checked against the bytes or as resting on
one report.

**Start from the operator's decision.** Ask what the operator is trying to decide, usually whether
the product works, what limited it, what changed or which repair is worth trying, and let that order
the synthesis rather than the order the reports arrived. Keep the exact one-line request in view,
because a convenient generated subproblem can underserve it.

**Weigh what the Builder wrote.** Before a pass rate enters, say how much of what produced it the
Builder did not write. Rank verdicts by independence: a pass lane 35 recomputed from public facts
outweighs one only the Builder's check produced, an installed external tool outweighs an authored
algorithm run through an installed interpreter, and a verdict whose tool digest no longer resolves
rests on an unestablished instrument. Name the recorded tool source and digest behind each
capability sentence.

**Keep the observation apart from the cause.** Every finding states what the recorded bytes show
and the cause inferred from them as two sentences, so the operator can keep a certain observation
while rejecting a plausible cause. "Eighteen of twenty-five cases passed and no check failed in
shipping" is an observation; "the checks were too weak" and "the tasks were too easy" are two causes,
and the lane that separates them is the evidence.

**Put the denominator beside the inference.** Partition verified, unaccepted and typed non-result
cases before any rate, and recount any `n` that folded unaccepted cases into the verified ones (a
claim's `n`, the climb history's `n`, an exporter's rate). Cases, batteries, submits, rounds and
provider units are different things. An unavailable cost, identity or opportunity is unknown, never
zero. Recount every "N of M" the synthesis leans on from the recorded rows, because a lane's counts
are claims.

**Find the consumer, not only the calculation.** Follow the short path from the input bytes to the
deciding output and on to what the controller consumed, and look for filtering, projection or
substitution between them. A prompt assertion, a type or a helper test proves only its own layer.
Consider a legitimate division of authority as seriously as a defect: generated diagnostics can be
advisory by design. If a cheap replay can separate two explanations, run it in private scratch
against the measured layer, with a positive control beside the hostile probe; never infer a
rejection from a timeout, an unavailable tool or an unaccepted submission.

**Reconcile by method.** When lanes disagree, compare their instruments first: the same bytes, the
same layer, the same families; did either read its counterpart or hidden truth before judging.
Reconcile lane 23's trace challenge with lane 22's process reading, and lane 7's valid alternatives
apart from row E's and lane 6's wrong-artifact discrimination. When a premise falls, walk forward
through everything built on it, including your own earlier conclusions, withdraw them by name, and
say what survives on independent evidence.

**Compare change without manufacturing a trend.** Write down what stayed fixed and what moved:
source, Builder, Built model, reviewer, harness, verifier, tasks and environment are separate
conditions. Never pool harness generations into one denominator. For a climb, keep the Builder's
stated intent, the controller's difficulty decision and the realised task bytes apart
([the climb reference](climb.md)).

**Judge tools and reviewers by what they changed.** Separate available tools, eligible
opportunities, use, successful use and decision-changing use. A solver tool that reports every margin
a check reads evaluates candidates rather than synthesising them (lane 34). Trace each review
finding to delivered feedback, the recipient's action and the next measurement, crediting the
authoring review and the battery review separately. Judge agreement is a second reading of the
Builder's rules, not independence, and a handful of Judge fails is a sample of what the Judge
noticed, not of false accepts.

**Ask whether this has happened before.** Read earlier notes under `notes/` for the same mechanism
(and, for runs before 2026-09-22, `/Users/air/Developer/harness-builder-v4/notes/`). A recurring
mechanism's remedy is often already in the source as a standing duty: a reviewer prompt line, a
gate, a sensor. Then the first question is whether that duty fired here. A duty that ran and found
nothing, one that found the mechanism and routed it nowhere, and one that never ran are three
findings, and only the first asks for a different remedy; lane 12 reads the reviewer's duties and
lane 14 where a finding went. A second remedy for a mechanism whose first never ran adds a wall that
pays no rent.

## What may be claimed

Four kinds of sentence may be written, each with its own evidence. **Safety:** the system refused a
bad or unprovable result. **Mechanism:** the intended branch executed and wrote its evidence.
**Capability:** verified artifacts passed under the named condition, naming the tool source and
digest and who authored the check, and how many passes lane 35 recomputed held. **Limit:** one fixed
harness reached a stated level and the deepest stable result was observed. Keep present in source,
deterministically proved, live-exercised and outcome-proved apart; a started run, PR prose or a
reference artifact proves no behaviour. For a live run, bind the T0 identities and counts before the
lanes and T1 before the synthesis, keep findings on unchanged bytes and mark changed-artifact
findings stale.

## Turning findings into the next change

Each retained proposal names its evidence, owner and consumer, the smallest coherent change, the
expected effect, its falsifier and the comparison that could decide it. Return no repair when the
evidence supports only a probe or a hold. A per-run archive ends its recommendations with `What to
do next` as **Patch** (a small correction the evidence already supports), **Consolidate** (the one
authority duplicated representations should derive from, and what disappears) and **Overhaul** (the
broader simplifying contract and what it replaces), where a section may say no change is justified.

When the operator asks what to change next, answer these from the archive, the notes and Git, with
no new run:

- **Is the proposal a real fix or a new file?** Name the line that decides differently afterwards;
  an item with no changed decision does not enter the queue.
- **Did the last fixes work?** Name the PR that carried each, whether its branch had an opportunity
  and was reached (lane 21, `UNREACHED CHANGED SAFEGUARDS`), and what it showed. Propose reversal
  for demonstrated harm or needless cost, not for an unchanged aggregate.
- **Did anything change between rounds?** A round accepting `changedPaths: []` measured a repeat;
  say what repeats established before proposing more rounds (lane 20, the `handoff` census).
- **Can the system fix this itself?** Leniency helps only where a writable owner exists; when every
  round routes blocking feedback to an owner no session can write, it buys longer silence (lane 14).
- **Can the fix be simulated first?** Where `system-path-simulation` can exercise the path, give the
  command.
- **Does the lesson survive outside this domain?** State the fix as its general shape; a fix whose
  shape does not recur across campaigns is named domain-specific and not built.
- **What does review cost?** A plan that adds a reviewer says what decision it expects that reviewer
  to change (the `yield` lane, lane 24's `REVIEW TURNS EXCEED SOLVER TURNS`).

Triage confirmed defects against the current stack head, not the run's source commit. Fetch first,
because a stale `origin/<head>` names an old stack; `git diff --quiet <stack head> <run source> --
<owner files>` says whether a defect is still there, where `--is-ancestor` answers nothing. Append
each fix to the open PR that owns its area, and push only on the operator's word. A review alone
authorises no PR, launch or source edit.

## When another method must settle a dispute

Use an independent review only for a consequential unresolved factual or method dispute, or when the
operator asks for one; a settled receipt contradiction needs no external model.
[Oracle handover](../../oracle-handover/SKILL.md) owns the packet. It carries the neutral question,
the exact run, source, bundle and model identities, the deciding source and safe receipt excerpts
with their paths, the hypotheses and contrary evidence apart from the recorded facts, and the
required finding, owner, falsifier and limits, and it lets the reviewer reject the premise. Protected
verifier detail, raw traces, hidden truth and reference artifacts stay out unless the operator asks
for traces, and the answer never flows back into a model-visible surface. Sending needs the
operator's authority for that action; a response is research, neither a verdict nor launch
authority.

## The archive and the note

A per-run archive is four files under `<dir>/<runId>/archive/`, scaffolded by `finish` and copied to
`notes/runs/<runName>/` when durable. It records the run's `lanes/` reports only; the isolated
lanes' reports and the cross-run and multi-run readings reach the record through the synthesis. The
files are `main_synthesis.md` (the adjudicated findings, with the headings `MAIN_HEADINGS` in
`scripts/archive-shape.ts` fixes), `luna_syntheses.md` (the accepted reports in manifest order),
`digest.md` (the sanitised deterministic digest) and `review.json` (`wri-archive/v2`). The first
`finish` writes a `verdicts.json` template with every state `inconclusive`; record the states and
reasons (a reason still reading as the scaffold wrote it is refused, so an unadjudicated lane cannot
pass as settled), fill `main_synthesis.md` from the synthesis's sections for that run, and run
`finish` again until the validator passes. It proves shape and bindings, not that the prose is true.
Safeguard rows count firings from the run's `SAFEGUARDS_LOG.txt`; with no log the count is
unavailable, never zero. A targeted answer needs no archive unless asked for.

The note, `notes/investigation-YYYYMMDD-<topic>.md` (local and ignored), is where a reader who was
not there starts: what the runs showed, why that is not what they would have expected, and what each
owner does now, with the source identity and the three denominators kept apart. Before writing it,
check for protected verifier detail, raw prose, counterexamples and reference artifacts. Preserve
frozen predictions and campaign-owned adjudications word for word: WRI can propose a refutation or
an experiment, and creates no campaign event, promotion or closure. Index the questions considered
once through [the checklist](../CHECKLIST.md); a targeted review names its material omissions.

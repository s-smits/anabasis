# Whole-run investigation session index

One line per session. Read this file to choose sessions; read the named body in
[review-angles.md](review-angles.md) (1–31) or
[review-angles-boundaries.md](review-angles-boundaries.md) (32–36). The manifest combines those
bodies and refuses a number or title that differs from this index. Full review gives each numbered
angle and both diagnostic lanes an independent Luna Max session; the triggers below govern depth,
or lane selection when the operator explicitly asks for targeted work.

Selection shorthand, used by `build-manifest.mjs --sessions`:

```text
--sessions 4,7,9        three separate sessions
--sessions 8-9          one session covering angles 8 and 9
--sessions 4,10+16+21   angle 4 alone, then one session joining three non-adjacent angles
--sessions mechanism,15 one intelligence session and the isolated trace session
--sessions category_and_hook_yield category/hook use and value after the primary census
--diagnostics           category/hook yield plus diagnostic follow-through
--auto 36 --diagnostics default full review: 36 independent angles plus two diagnostic lanes
--auto 9 --diagnostics  nine numbered-angle groups plus the two diagnostic lanes
```

Grouping requires an explicit override. Blinded pairs 5/6, 7/8 and 19/20 may never share a session.
Angles 15 and 36 are always alone. The script refuses incompatible groups instead of splitting them.

## Deterministic rows A-I — the primary reviewer, never a subagent

**A. Campaign identity, declared and agreed.** Bind the run ID, full source commit, request digest
and the three model slots from `opening.json`, and prove every projection describes that same run.

**B. Claim, replacement and promotion.** Say whether each claim could be created and whether
anything actually replaced the adopted harness, and classify each promotion by its experiment. The
guard that once gated a promotion is not part of this loop, so a run recorded under it is read from
its own archive rather than from a yield row.

**C. Workspace starter package, change evidence and Git ancestry.** Check a fresh workspace
committed the starter package and that the change evidence describes the tree it really produced.

**D. Static contract and tool conformance.** Check the candidate bundle satisfies the tool
specification, task set, artifact schema and generated-worker identities it declares.

**E. Fingerprint and the census that authenticates it.** Check the fingerprint binds exactly the
agent, grader and task-set hashes, and that the post-fingerprint control census reached a typed
verdict with one receipt per declared control.

**F. F2 solvability and shared gate non-results.** Check solvability settled for every authored
task through the public writer path, and that a verifier non-result shared with the census is
reported once with one owner.

**G. Case record partition and non-result typing.** Check graded, unaccepted and typed non-result
counts form one complete, exclusive partition, with `truthOk` and `pass` left null where unknown.

**H. Runtime identity and isolation integrity.** Check every case is bound to the model, runtime
and sandbox the claim names, and report the isolation as N rows under one proven policy rather than
N independent refusal proofs.

**I. Served-model attestation.** Check each case's identity row is a host-recorded attestation of
the model that served it, not the configured pin echoed back; read digest block 5b's attested,
unattested and no-completed-turn counts separately and block the condition sentence on a mismatch.

## Intelligence sessions — judgement, never inventory

**Product validity.** Join the original request to material artifact bytes, the deciding verifier
operation, the observable execution scope and the resulting claim. Activate when a green battery
supports a broader product claim than its instrument can see, or a required subsystem has been
replaced by a proxy. Preserve compile, host, target and hardware as separate scopes. Consumes
completed independent challenges; does not replace 5/6, 36 or the blinded 19/20 sessions.

**Representation.** Trace the public schema through every writer variant, DraftStore state,
submission and verifier input, and separately test whether each declared root can change a truth
result. Activate when the schema, writer, submission path, declared roots or truth checks changed,
or a parity or materiality finding already exists.

**Mechanism.** Reconstruct the first wrong transition from observed fact to owner, feedback, next
action and terminal. Activate when any gate, case, iteration, reviewer or terminal failed, when
non-results repeated, or when the recorded cause is incomplete.

**Strictness and yield.** Adjudicate each refusal, hold and stop against the exact gate source, and
report what the spend bought per new recorded fact. Activate when refused submits reach graded
batteries, on a strictness terminal, or when the OS wall acted in either direction. Consumes angle
23.

**Effect and history.** Say whether the registered treatment plausibly produced the observed
effect, and join the mechanism to its earliest and latest prior occurrence. Activate when a
comparison found a changed process or outcome, a treatment produced none, or a source fix is
claimed.

**Category and hook yield.** Separate correct delivery from useful progress through the recorded
observation rows. Resolve root-versus-battery writer scope before alleging missing capture;
compare the first activation with the nearest repeated, failed or absent opportunity. Activate on
new/changed hooks, unexplained silence, suppression, output without a consumer or an explicit usage
review. Recommend retain, repair, merge, remove or instrument only from a gap that affects a decision;
file presence is not invocation and a prompt link is not benefit.

**Diagnostic follow-through.** Disposition scan, Builder tool usage and review yield, then trace
up to two signals by decision impact. Distinguish unavailable presentation from recoverable bound
receipts, reconcile epoch/battery/version joins, establish aggregate units/lifetimes, and follow
attachment through action. Reuse primary counts and route same-defect closure to 35; close accurate
low-information warnings briefly. Activate on explicit
triage, unexplained follow-through, conflicting reports or suspect coverage. Angle 15 keeps its
private solver-process challenge; post-run diagnostics cannot have steered earlier work.

**Reference contract coverage.** Diff the built harness's families, tools and schema against the
consumer-hardware reference implementation. Activate only for that domain, with
`--consumer-hardware`.

**Reference verdict comparison.** Execute the reference on the graded cases and controls and return
angle 19's 2x2. Activate only for that domain, and only once an adapter between the artifact shape
and the reference entry point is proved.

## Semantic angles 1-36 — the subagent sessions

**1. Starter and kernel contract coherence.** Does what the starter teaches match what the kernel
accepts? Activate on any 0/N battery, an artifact-write failure, or a changed starter or kernel.

**2. Judge 1 census.** Is the Judge review recorded as complete, incomplete, off or unavailable,
and do its disagreements with the verifier hold? Deterministic first: block 2b; admit a reader
only on a census with a disagreement.

**3. Failed-trace diagnosis.** What do the failed traces show, and does the deterministic rebuild
advice packet the next authoring session read agree with them? Activate when failed shipping traces
exist.

**4. Steering coherence.** Do the prompts, warnings, hooks and written rules describe the system
that actually exists, and did material opening constraints reach the design and enforcing checks?
Activate on an opening/example mismatch, changed model-visible framing or an unsupported warning.

**5. Oracle and control hardness.** Would a plausible wrong artifact pass, and do the reject
controls reach every grading mechanism? Activate before any capability reading; mandatory when all
grounding is intrinsic, and 6 is mandatory beside it whenever discrimination-inertness is `fail`
or `risk`. Angle 27 owns per-check margin. Blinded with 6.

**6. Independent oracle mutation challenge.** Build a second bounded mutation corpus and challenge
angle 5's wrong-artifact discrimination result by execution. Keep a valid baseline; angle 36 owns
independently derived valid alternatives. Activate when angle 5 supports a material conclusion. Blinded with 5.

**7. Harness exhaustiveness against its own tasks.** Does the harness give a solver everything its
tasks require, and no more than its tasks are supposed to reward? Blinded with 8.

**8. Public disclosure and one-recipe challenge.** Does the public interface ship a sufficient
construction method, or has the admissible solution set collapsed to one recipe? Mandatory when a
battery is saturated with constant turns and the digest flags an `ORACLE-PREVIEW SUSPECT` tool.
Blinded with 7.

**9. Owner routing and the next authoring round.** When the run reopened the harness, did one
eligible owner receive the intended packet and a real opportunity to act? Follow actual source
authority and delivery. Angle 35 owns whether the same defect was repaired. Activate on a successor
authoring round, missing delivery or repeated `findingsHash`.

**10. Climb contract and direction.** Do the prediction, the observed Wilson interval, the recorded
next move and the recorded difficulty note agree? Activate when a climb, descend, hold-limit, widen,
repair-knob or rebuild decision exists. `10+16+21` is an optional explicit grouping.

**11. Builder observability and authoring effort.** How long did the Builder take, how many calls
failed, and can the evidence explain them? Activate on unexplained failed calls, a null or missing
session record, several epochs, or a held budget lease.

**12. The tenet 4 isolation, both directions.** Can protected verifier detail reach a model-visible
prompt, going to the Builder or to a judge? Activate on any change to the projection, prompt
builders or judge framing, and run the isolation tests rather than reading them. Angle 34 owns
whether the permitted public message still carries enough meaning to act.

**13. Closure, survival and the live-unproven record.** Did the run end, could a reader with only
the evidence name the actual reason it stopped, and what stays live-unproven? Deterministic first:
the terminal and absent-step rows; spend and exhaustion moved to angle 28. Admit a reader only when
the recorded cause does not explain the terminal.

**14. Concurrency and per-case isolation.** Did solving several cases at once change a result, and
did two cases ever share a confined child? Activate when `maxConcurrency` exceeds one or a
`sandbox` or bounded-timeout non-result appears, or the shared policy hash changed. Sampled-dormant
otherwise.

**15. Built Harness trace shape and challenge synthesis.** What do the agent's own traces show —
recurring obstacles, process uniformity per family, and the cross-battery diff? Always its
own session, and only with a complete, digest-verified trace-challenge packet.

**16. Family-wise limit coverage.** Does the aggregate hide a family or selected axis that is
all-pass, all-fail, missing or non-monotone? Start with block 3b, then examine its coverage and
meaning. Optional explicit group `10+16+21`; independent by default.

**17. Prediction lineage and state continuity.** Did the successor consume the correct prior
prediction, axis, findings and task identity, with an exact predecessor digest link? Activate when
the run holds more than one epoch or battery.

**18. Repeated-condition stability and fresh transfer.** Does the predicted boundary persist across
a repeated battery and then transfer to fresh or paired tasks? Activate with two or more batteries
at the same harness and level — block 3c's `REPEATED CONDITION` row is the only admission; without
it the row reads `no-opportunity`.

**19. End-user outcome validity, independent of the self-authored oracle.** Re-derived without
reading the oracle, would the submitted artifacts be correct by the domain's own standards?
Activate when graded, publicly re-derivable artifacts exist. Blinded with 20.

**20. Blinded end-user validity challenge.** Re-derive end-user correctness by a different method
or sample, blind to angle 19, the oracle and the controls. Activate beside 19, or on an operator
ask-alignment challenge. Blinded with 19.

**21. Between-battery meaning of a climb.** Do two consecutive public task sets actually carry the
axis their difficulty note names? Activate on consecutive authored batteries at one harness, or on
a fired rebuild, where it compares the rebuilt evaluation against the saturated one.

**22. Fact grounding of Builder-authored domain knowledge.** Are the authored domain facts true
against public documentation the session finds itself? Trigger: the domain declares factual tables
and every grounding is Builder-authored (registry source or installed tool), or the builder view
reports `public_source` in `neverUsed`, or an external tool was installed without a recorded source
lookup. The external-truth step needs a web-enabled transport.

**23. Strictness adjudication.** For each refusal, hold and stop, was the rule right and the work
wrong, or was the rule harsher than the public contract requires? Trigger: refused submits reach
graded batteries, a strictness terminal, one check holding every shipping rejection, or the wall
acting in either direction. The digest's refusal census settles the counts first; dormant otherwise.

**24. Builder memory: authored updates, carry-forward and read-back.** Did the memory files do any work —
curation taken when due, the peculiar cause recorded, stale carried lines corrected, and any
read-back at all? Activate on more than one authoring pass or epoch, or on an angle 17 continuity
gap, or block 4e's `MEMORY OVER READ CAP`. The research leg needs a web-enabled transport.

**25. Finding recurrence and closure across reviews.** Which earlier findings of this lane recur
unchanged, which cleared, and did the clearing follow a source change that reached the run? Activate
on a RECURRING FINDING, CLEARED WITHOUT SOURCE CHANGE or FINDING DROPPED UNREVIEWED row from
`finding-recurrence.mjs`; without an earlier archive in the lane the row reads `no-opportunity`.
Same defect means same falsifier. Reassigned 2026-09-08; earlier archives read this number as Judge
Prompt Maintainer yield.

**26. Epoch Reviewer yield and reach.** Did the epoch findings reach the Builder through admission,
and did the next iteration act on one? Activate when any `-epoch-review.json` is `completed`; read
counts, owners and digests only, never private finding text. Current v3 reviews are keyed by the
complete measured-condition digest. Read actual routes from admission feedback, including findings
whose proposed owner is null; missing feedback leaves the route unobservable. Read older schemas
against their recorded source and keep retained advice separate from demonstrated repair benefit.
Deterministic first: block 4d's owner tally; admit on `FINDINGS WITHOUT PROPOSED OWNER`.

**27. Check informativeness and margin.** Does each check still separate right from wrong on this
battery, and how close did any shipping artifact come to its boundary? Activate on block 1c's
`REACH-ONLY CHECKS` or `PERFECT BATTERY AFTER CLIMB`; consumes 5/6's frozen results.

**28. Allowance, role spend and censoring.** Which role spent the allowance, which steps were
absent on a limit, and which decisions were taken on a censored denominator? Activate on block 4c's
`DECISION ON CENSORED BATTERY` or `REVIEW TURNS EXCEED SOLVER TURNS`. Explicit exhaustion is a
normal R&D interruption (AGENTS.md), never a harness defect; a generic limit needs its own cause.

**29. Weak-solver control baseline.** Would a solver that cannot do the work pass this battery too?
Activate on a perfect battery whose checks are all reach-only or whose passes share one constant
tool sequence. Product-side prerequisite: names the missing baseline and owner, launches nothing.

**30. Cross-harness verdict agreement.** Do two independently built harnesses' verifiers agree on
the same public tasks and controls? Activate when a sibling adopted harness for the same prompt
exists and an artifact adapter is proved; otherwise report `adapter-missing`.

**31. Source-delta reach.** Did the source that changed since the previous run execute, and did its
safeguards fire? Activate on `scripts/source-delta.mjs` reporting `UNREACHED CHANGED SAFEGUARDS`;
model-visible text change routes to angle 12 instead.

**32. Authoring-to-host contract compatibility.** Can a legitimate authored check traverse the
real projection, tool-input and wall contracts? Contrast a permitted and forbidden request;
a successful local double is insufficient. Activate on host/local disagreement or interface change.

**33. Executable verifier dependency closure.** Which wrapper, imports, flags, configuration and
runtime assets decided the verdict, and could the reviewer see them? Activate on external-tool
grounding or a configuration-dependent coverage claim. Identity and inventory alone prove no closure.

**34. Public-safe feedback sufficiency.** Does the actual served message preserve the permitted
obligation, priority and uncertainty needed to act? Contrast public situations while keeping
protected-detail invariance. Activate on ambiguous repair or projection change; 12 retains leakage.

**35. Semantic repair closure.** Did the accepted successor repair the original defect, a neighbour,
or the test condition itself? Join one obligation and falsifier through the next measurement.
Activate on repairs or claimed review benefit; 9 retains routing and delivery.

**36. Valid-alternative rejection challenge.** Can correct alternatives fail? Derive and freeze
publicly valid artifacts before reading verifier internals or other oracle reports, then execute
them. Always alone. Activate on constructible tasks or suspicious valid-source rejection;
5/6 retain wrong-artifact corpora and 19/20 retain recorded user-artifact judgement.

## Deterministic session 30

**Session 30. Deterministic counter reconciliation.** Reconcile the climb readout rows (the climb ledger before 2026-09-21) the
difficulty author consumes against the default view and the recorded battery counts. Primary-reviewer
work in an exhaustive review only; it is never a model session and never a subagent session.

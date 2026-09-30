# Whole-run investigation session index

One sentence per row and per lane. Read this file to choose; read the body in
[review-angles.md](review-angles.md), whose headings this file repeats byte for byte, because
`build-manifest.ts` parses both and refuses the manifest when they drift. The nine rows are the
primary reviewer's own work and are never delegated. The thirty-eight lanes are what a paid
session can be given, and each opens with the deterministic trigger that starts it, so a lane whose
trigger never fired is not launched, whatever the tier allows — except the standing lanes of a
tier, which open on every run of that size because they read what a self-authored battery always
leaves open.

## Deterministic rows A–I

**A. campaign identity.** Resolve the campaign from the run's `opening.json` and real paths, bind
its source commit, digest, worktree and three slot pins with provenance, and refuse
`source-unresolved` rather than substitute a tree.

**B. claim and promotion state.** Read the claim and the `product-promotion/v1` row as promoted or
held with its clauses, and read the initial product's `initial-product/v1` selection as adoption
before its battery.

**C. workspace and Git.** Check that each `workspaceChange` describes the tree it produced, that
Git ancestry agrees, and that a deleted path is absent from the child.

**D. static conformance.** Check that `tool-conformance/v4` opened every task and bound one stable
worker registration and tool schema across the battery.

**E. fingerprint and gate census.** Check the fingerprint against the immutable snapshot the gates
read and join one `control-receipt/v2` receipt to every declared control.

**F. F2 solvability.** Read `solvability.json` and each `verifier.json`'s `checkReceipts`, and
report completed, unsettled and non-result tasks separately.

**G. case partition.** Partition `case-record.jsonl` into verified, unaccepted and typed
non-result through `src/claim/case-record.ts`, joined to `battery.json`, and recount any exported
figure before any rate is read.

**H. runtime identity and isolation.** Bind every case to the claimed model, runtime and sandbox,
record each tool run's `source`, `digest` and `kind` under one `verifierEnvironmentHash`, and name
each deciding tool whose bytes no longer resolve.

**I. served-model attestation.** Read `runtimeIdentities[]` for a provider `resultId` per row,
and refuse the identity claim, and nothing else, where a completed turn is unattested.

## Semantic lanes 1–38

**1. Request-to-verdict chain.** From an `in-process` check or an unread artifact root, say what
the verdict observes and whether a host double inverts the target's semantics while passing.

**2. Executable verifier dependency closure.** From the toolchain-retention rows and any
`kind: "script"` tool, trace the bytes that decided the verdict, name the unhashed edge, and say
whether a dangling link leaves the deciding instrument unestablished.

**3. Authoring-to-host contract compatibility.** From a gate refusal after a clear preview or a
host non-result, say whether a check written to the public interface can execute on the host.

**4. Operating guide and roster truth.** From a call the roster does not declare or a guide that
names one, say whether the guide, descriptions and payloads tell the solver the truth.

**5. Limit slack against the reference.** From `PERFECT BATTERY OVER AIM`, keep easy tasks and
checks that observe too little apart, and say how far inside the published limits shipping sits.

**6. Check discrimination and binding.** From `REACH-ONLY CHECKS` and `UNTRIPPED IN SHIPPING`, say
whether each check can fail on a shipping artifact and bind to what it constrains.

**7. Valid-alternative rejection challenge.** Only when verified cases exceed zero and lane 5 or 6
reads slack: freeze a public-only corpus alone, before verifier internals, and report false
rejections.

**8. Public disclosure and one-recipe.** From passes at a small share of the solve wall and constant
call sequences, say whether the brief and tools publish a sufficient construction algorithm.

**9. Rehearsal instrument reach.** From `REHEARSAL NOT-RUN`, say which families the rehearsal
verifier deadline lets the instrument grade at all.

**10. Difficulty calibration loop.** From `OFF-AIM STREAK`, the calibration table and the climb
edges, say whether the batteries move towards the aim round over round.

**11. Submit decision against rehearsal evidence.** From `SUBMITTED BYTES NEVER REHEARSED`, say
what the Builder did with each verdict before submitting.

**12. Epoch Reviewer standing duties.** From the `epoch-reviewer` yield rows and a review labelled
incomplete on the seed, read authoring and battery reviews alike and say whether each standing duty
fired before a new one is proposed.

**13. Public-safe feedback sufficiency.** From a finding whose gap the next round did not touch,
say whether `publicFinding` kept the permitted information the Builder needed to act.

**14. Finding routing and recurrence.** From `FINDINGS WITHOUT OWNER` and `ADVISORY
FINDING RECURS UNROUTED`, say what each finding became and whether its recurrence key could fire.

**15. Harness-versus-evaluation triage hand-off.** From the triage table, say whether diagnosis,
reviewer and advice agreed on the failing side and whether the successor repaired it.

**16. Judge disagreement adjudication.** From `CENSUS WITH DISAGREEMENT`, settle each Judge fail
on a verifier pass as a Judge error or a verifier defect by recomputing the cited rule.

**17. Round hand-off census.** From the census table on two or more rounds, say which channels
were present, served, read back and acted on.

**18. Same-task repair measurement.** From the same-task table, say whether an issue's state change
rests on task identity or on family names alone.

**19. Semantic repair closure.** From a repair proposal or accepted successor, say whether the same
defect was resolved, narrowed, removed or left unmeasured.

**20. Task movement and attribution.** From `REPEATED CONDITION` and the climb edges, say what
moved between rounds and whether the accepted bytes match the declared scope.

**21. Source-delta reach.** From `UNREACHED CHANGED SAFEGUARDS` and `MODEL-VISIBLE SURFACE
CHANGED`, say which changed source executed on this run.

**22. Solver process and walls.** From the wall shares and the tool-in-trace lead, say how the
solver spent its walls and whether a wall-bound case is a failure.

**23. Trace challenge.** Only when verified cases exceed zero and lane 1, 4, 8, 22 or 34 suspects a
shortcut: open the private packet alone and show from the trace where the deciding value came
from.

**24. Time, spend and provider waits.** From timeline gaps and the role-spend rows, say what each
long silence was, whether an allowance wait names its clock, and who owns it.

**25. Failure mechanism and non-result honesty.** From every unaccepted case, non-result,
non-completed terminal, strike and `adrift` stretch, name the earliest broken link and whether its
kind is honest.

**26. Builder memory and posture.** From `MEMORY OVER READ CAP`, a `thin` or `unreadable` posture
or a second epoch, say whether memory did any work and whether the posture could be read.

**27. Gate rent and confidence.** From a gate stall, a refusal cleared on unchanged bytes, a
low-prior firing, an unledgered code, a hold chain or a ceiling terminal, set each fired
component's ledger prior against what its episodes did, and name the gate that missed a demonstrated
defect.

**28. Evaluation-correction regrade.** From an evaluation correction beside the battery of its recorded
baseline, regrade that battery's accepted artifacts under the corrected evaluator and read the flips.

**29. Hardware target coverage against public ground truth.** From `HARDWARE TARGET NAMED`, pair the
harness's families, tools, roots and checks with the named target's vendor toolchain, datasheet and
simulators, name the scope each check observed and the obligations only a higher scope observes.

**30. Ground-truth verdict comparison.** Only when a hardware target is named and verified cases
exceed zero: prove an adapter to an executable ground-truth instrument, freeze its verdicts, then
report the two-by-two against the recorded verdicts; with no adapter, the adapter is the finding.

**31. Brief against the request.** Standing at every tier: map the request's obligations to the
brief, the tasks and the checks, and name invented rules, excluded obligations and demands the
interface makes inexpressible.

**32. Judge pass decidability.** Beside lane 16 and standing in deep reads: classify each Judge
pass as fully decided, decided with a declared gap or stating nothing, per pin, and name what the
citable set leaves out.

**33. Reference provenance and witness strength.** Standing in standard and deep reads: classify
each reference solve as computing or replaying, and say what its witness proves about the task.

**34. Check mirroring in solver tools.** Standing at every tier: say which declared checks a
Builder tool mirrors and whether solves show propose, read, adjust in place of a decision.

**35. Independent recomputation of passes.** From a dangling toolchain or a perfect battery,
recompute a sample of passes from public facts before reading the evaluator, and count which held.

**36. Difficulty pressure on the Builder.** From `OFF-AIM STREAK`, say which channels could have
pressed the Builder to change the tasks and what the Builder did with each.

**37. Battery size and probe graduation.** Standing in standard and deep reads: recompute each
battery's size from the sizing rule and say whether a graduation rested on unaccepted cases.

**38. False rejection among verified fails.** From `FAMILY UNMOVED all-fail` or any verified fail,
say from public facts whether each failing check could reject a valid answer.

## Tiers

The tier is the size of the recorded run, decided by `brief.ts` from the elapsed time, the epoch
count and the battery count, and it bounds how many lanes a sweep may be given. Lanes are chosen
by trigger; the default set applies only when no trigger picks, and a tier's standing lanes
(`STANDING_LANES` in `brief.ts`) join every sweep of that tier, triggered or not. Thirty-eight is
the ceiling, and lanes 7, 23 and 30 are never counted in a tier: each is launched alone, and only
when its own trigger fires.

| tier | run shape | lanes | default set | standing |
| --- | --- | --- | --- | --- |
| probe | not scored, or under two hours | 6 | 5, 8, 12, 25 | 31, 34 |
| standard | anything between | 12 | probe plus 1, 9, 14, 24 | 31, 33, 34, 37 |
| deep | twelve hours, three epochs or three batteries | 19 | standard plus 2, 6, 10, 11, 13, 22 | 31, 32, 33, 34, 37 |
| isolated | a trigger for lane 7, 23 or 30 fired | that lane, alone | — | — |

A default lane the tier names is still launched only when no trigger picks, so a standard run whose
block 4d printed nothing gives lane 14 nothing to read and the sweep says so rather than launching
it. A standing lane has no such condition, because its question — does the exam ask what the
request asks, what do the Builder's reference and tools prove — is open on every run.

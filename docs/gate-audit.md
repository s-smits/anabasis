# Gate audit, 2026-09-25

This file records one pass over every component that can refuse a Builder's candidate or hold a
measured battery back from a claim: the submit and preview gate (`src/gate/validation-pipeline.ts`
and what it calls), the battery pre-case in `src/correctness-bundle/verification-runner.ts`, and claim
readiness (`src/claim/readiness.ts`, `src/claim/claim.ts`). Each component was put to one question:
are we at least 98% sure it refuses something that is actually wrong? The operator set that bar so
that a gate the evidence cannot defend gives the Builder room rather than a refusal.

The pass had to cut each component in all three places at once. A refusal archived at submit alone
does not free anything, because the same condition then stops the battery before its first case or
marks the claim unclaimable, and the round is wasted after it has been paid for rather than before.

Two literatures set the line between a component we keep and one we are unsure of. Benchmarks
filtered so that models fail them select for broken answer keys as much as for hard questions:
Humanity's Last Exam kept only questions frontier models failed, and FutureHouse later found about
29% of its chemistry and biology answers in conflict with the literature. So every component that
checks the answer key itself — the reference solve, the accept controls, the identity of what ran —
stays. And an estimate of difficulty made from anything but the real solver loses to measured
solves (Bae et al., EACL 2026; Zotos et al., 2025), which is the case against a static rule that
decides from the task text alone whether a battery is demanding enough. Those rules are the ones
this pass took out or archived.

This file is the index of what survived. Each entry below names a refusal by the kebab id its
ledger card uses, says what it refuses and why that is at least 98% likely to be a real defect, and
where it has moved to a readout or advice, says what the Builder or the reviewer now reads instead.
The rewritten decisions live with the code that applies them: R1 in `src/correctness-bundle/tool-runs.ts`, R2
beside the control receipts the census writes and the claim reads, R3 in
`src/correctness-bundle/rule-decisions.ts`, and R4 in `heldCountsAgainstAuthor` (`src/run/full-run-round.ts`).
`test/gate-decisions.test.ts` holds STARTER.md's Gates section to the source: every code it names is
one some source file still emits.

The first pass marked each component with a `Gate audit 2026-09-25` comment line and archived the
unsure ones as commented-out blocks. The second pass, on 2026-09-26, deleted every archived block it
found no reason to restore and removed the markers, since an index in one file does not go stale in
fifty-two places at once. The archived bytes remain at commit 3be43b8.

## Kept

Each kept component refuses a candidate, holds a battery or bounds a loop because something is
actually wrong with it, and the refusal names what to repair.

### bundle-shape

Refuses a brief, task or control row that does not parse into its declared shape
(`shape-mismatch`, `fieldFinding` in `src/correctness-bundle/brief.ts`). Nothing downstream can read a malformed
row, so the refusal names the field instead of letting a later stage crash on it.

### task-shape

Refuses a `tasks.json` that is not a bare array, a task id that is duplicated or unsafe as a
directory name, a missing hidden operand, a declared public path absent from every applicable task,
and a task no check applies to (`tasks-shape`, `tasks-no-applicable-checks`; `src/correctness-bundle/tasks.ts`,
`src/author/candidate-check.ts`). Every later stage indexes by these, so a violation fails the
round at the first case rather than here. A check scoped to families the battery lacks
(`tasks-check-family-unbound`) no longer refuses, since 2026-09-26: a task probe that keeps
`brief.json` fixed may narrow the battery below a check's families, and that check simply does not
run this battery, which the claim's `firedByCheck` records as 0.

### task-count

Refuses a battery whose size differs from the one the run asked for (`tasks-exact-census`,
`src/correctness-bundle/tasks.ts`). Size is a measurement condition code owns, and it is refused rather than
clamped because a silently changed size is a silently changed condition.

### harness-config

Refuses runtime walls in `agent/config.yaml` beyond ten times their defaults, and a `files`
preset with no file-map root (`harness-config-invalid`, `tools-files-preset-artifact-root`;
`src/author/candidate-check.ts`). A wall the host would refuse at run time, or a preset that cannot
carry the artifact, otherwise fails as a non-result in a paid battery.

### tools-spec-structure

Refuses tool rows with bad keys, kinds or duplicate names, starter tools left in, and leftover
data-reader state (`tools-data-reader-state` and the structural codes of `src/correctness-bundle/tools-spec.ts`).
Conformance registers exactly this roster, so it has to parse into one stable worker contract.

### accept-schema

Refuses an accept control the public artifact schema cannot compile, or one off the declared
top-level schema (`controls-accept-public-schema-inconsistent`, `controls-accept-off-schema`;
`src/author/fresh-candidate-contract.ts`, `src/correctness-bundle/controls.ts`). That is a contradiction inside
the Builder's own bytes, and the solver is told the same schema.

### expected-check-inapplicable

Refuses a reject control whose named check does not apply to its task's family
(`controls-expected-check-inapplicable`, `src/correctness-bundle/controls.ts`). Such a reject can never fail on
that check, so it calibrates nothing.

### tool-identity

Refuses a malformed `toolId`, or one that resolves under neither `.toolchain` nor the host PATH
(`tool-id-invalid`, `tool-missing`; `src/author/candidate-check.ts`, `src/run/solvability-gate.ts`).
A tool is what the host hashed (design prior 9); a check naming no installed executable cannot run.

### bundle-walls

Refuses agent code importing the correctness model, an unvetted package or a built-in, key
material, non-regular files and capability escapes (`src/claim/bundle-validation.ts`,
`src/claim/fingerprint.ts`). This is the isolation of hidden data from the solver.

### experiment-plan-schema

Refuses an `EXPERIMENT.json` that does not read as `experiment-plan/v2` (`experiment-plan-schema`,
`experiment-proposal-shape`, `experiment-proposal-read`; `src/author/experiment-plan.ts`). The plan
feeds prediction scoring and the reviewer's orientation, which read only its one schema.

### f2-reference-verdict

Refuses a candidate whose reference solve is rejected by its own checks, with
`SOLVABILITY_CENSUS_BLOCKED` and `SOLVABILITY_FAILURE_CONCENTRATION` beside it
(`src/correctness-bundle/solvability.ts`, `src/run/solvability-gate.ts`). A reference the checks reject shows,
before any paid solve, that no pass is reachable through the declared path. This is the answer-key
check the benchmark literature says to keep. Of its 15 recorded episodes to 2026-09-25, 8 caught a
real defect, 3 were the candidate's own `.toolchain` that could not run inside the cell (truss-8,
-9 and -10: every check rejected every task, the reference bytes were identical before and after,
and only the tool condition moved) and 4 were host limits. Since 2026-09-27 the row names the
installed tools as the suspect, owned by the evaluator with `SOLVABILITY_INSTALLED_TOOLS_SUSPECT` at
`.toolchain`, when every applicable check rejected every task and none passed on a task held to at
least two checks, or when a rejected answer passed with the same bytes over the same correctness
model under a different tool condition earlier in the session. It still refuses. Of the host
limits, a tool stdout over the 1 MiB cap and a 126/127 exit were already tool non-results at the
head; the QEMU wall (firmware-10, never repaired) and host load (firmware-5) remain unseparated.

### f2-representation-defect

Refuses a reference answer the writer, the DraftStore or the submit path cannot carry
(`src/run/solvability-gate.ts`). Every solve would meet the same defect. Until 2026-09-26 it also
refused a writer that accepted `""` where the reference answer wrote null. The writer's parameters
are the compiled public schema, so that was a statement about a legitimately nullable string field
rather than a carry defect, and its only recorded firing cost a forty-call repair loop. The branch
is deleted; `contract.md` now tells the Builder to publish null as the absence value, and a solver
that writes `""` there is graded by the checks. Until 2026-09-27 a worker request the controller
stopped waiting for also landed here, because it carried the protocol kind without the host's
deadline mark. Both firings recorded on 2026-09-24 were that timeout on a loaded host, 0 of 2 a
defect in the bytes; the request timer now marks `deadline` and the case is a host non-result.

### f2-host-nonresult

Settles a reference solve or submission path the host broke as a per-case environment non-result
(`solvability-submission-path-host-non-result`, `solvability-reference-solve-host-non-result`;
`src/correctness-bundle/solvability.ts`), which ends a submit as `environment-blocked`. It fired
8 times across the firmware and truss runs of 2026-09-24/25, each a worker that missed its
1000 ms close deadline before the submit was accepted, 7 read as `gate-unvalidated` and 1 under
the older spelling `gate-environment`. None was a defect in the bytes: each cleared on a later
check of byte-identical candidates, and most of those candidates had cleared before. Since
2026-09-27 the census gives such a case one fresh attempt on the same bytes. The solve memory
keeps no host non-result, so the stage that failed runs again, and only a second host non-result
stands; the row keeps the first attempt's error as `rerunAfterNonResult`. A product failure is
not retried, since the same bytes fail the same way.

### accept-control-rejected

Refuses a candidate, and at claim time a battery, when a known-valid accept control fails a check
(`DISCRIMINATION_ACCEPT_REJECTED`; `src/correctness-bundle/run-controls.ts`, `src/correctness-bundle/control-receipts.ts`).
When the checks reject an answer the Builder vouches for, no measured pass can be read through them.
Since 2026-09-27 an accept whose blocking checks' tools did no work anywhere in the census is
routed to `.toolchain` rather than to the correctnessModel (below).

### controls-no-verdict

Refuses a control whose check threw or reached no verdict because its tool runs timed out or
crashed (`DISCRIMINATION_NOT_PROVEN`, `PROBE_NO_VERDICT`; `src/correctness-bundle/run-controls.ts`). It
witnesses nothing about the checks. A tool the host refused twice, for `sandbox` or
`verifierUnavailable`, is no longer counted here: since 2026-09-26 it is `verifier-tool-refused`,
which `tool-environment` below settles as the environment's.

### external-result-unbound

Refuses a check that returns while its tool runs are still running (`EXTERNAL_RESULT_UNBOUND`,
`src/correctness-bundle/run-controls.ts`). Its verdict grounds on nothing it waited for.

### tool-environment

Settles a census or tool run the host could not execute as an environment non-result
(`verifier-tool-refused`, and `settleToolUnavailable` and `settleEnvironment` in
`src/run/census-gate.ts`), and a reference solve the host broke as a per-case environment
non-result in `src/run/solvability-gate.ts`. It is never a verdict on the candidate (rule 15). A
blocking environment row is not remembered as a verdict on the bytes, and a submit that meets one
ends the session as `environment-blocked` (`gateTerminalClause`), so an environment owner on a
candidate defect costs the campaign rather than a strike. Two neighbours are therefore the
author's on purpose: `census-wall-exceeded`, since the checks and the reference solve are the
candidate's bytes and their time is the Builder's to cut, and `SOLVABILITY_CENSUS_UNAVAILABLE`, a
census with no evidence, whose every cause is either the candidate's bytes or cannot be told apart
from what its generated code did to the snapshot; the row names the cause code. Until 2026-09-26 a
control whose tool the host refused twice was a no-verdict refusal of the check and condition drift
was an evaluator row; both now carry the `environment` owner.

### condition-identity

Refuses a verifier condition that drifted, a worker whose contract differs across tasks, and a
generated toolset that did not terminate (`verifier-condition-drift`, `task-worker-binding-drift`,
`generated-toolset-termination`; `src/run/census-gate.ts`, `src/correctness-bundle/probe-tool-surface.ts`).
Measurement refuses the same, so the gate refuses it first. Verifier drift is the host's and
refuses as `environment`: a check of the same bytes runs again, and a submit that meets it ends the
session as `environment-blocked`. The other two are the candidate's.

### measure-grounding

Names at readiness an external check with no tool run on any verified case (`inertToolFindings`,
`src/claim/readiness.ts`). The per-case half is R1 (`grounded-verdict` below), which the claim now
reads from the battery's non-result rows rather than deriving again.

### build-failed-ceiling

Ends the campaign as `build-failed` after `buildFailedRounds` rounds that admit no candidate
(`src/run/full-run-round.ts`). A round that admits nothing measures nothing, so its retries share
one bounded allowance.

### environment-blocked-ceiling

Ends the campaign as `environment-blocked` after `environmentBlockedRounds` batteries of typed
non-results (`src/run/full-run-round.ts`). Remeasuring the same dead environment buys nothing.

### noop-submit-strike

Counts a byte-identical resubmit of a refused candidate as a strike, and ends the session as
`authoring-stalled` at `noopSubmitStrikes` (`src/gate/candidate-memory.ts`), which ends the campaign
as `build-failed`; the strike and final messages now say the campaign ends rather than the round.
The same bytes cannot earn a different verdict. The condition is the candidate's bytes, every
resolved tool entry and the tool tree's content, so a repair behind an unchanged wrapper script is
not a strike, and a tool run that only wrote bytecode, user caches or Arduino's compile counter is
(`toolTreeDigest`, `src/verify/tool-inventory.ts`).

### unchanged-candidate-strike

Counts a round that settles on its own entry tree, up to `unchangedCandidateStrikes`
(`src/run/full-run-build-step.ts`). Such a round has nothing new to measure.

### no-progress

Ends a round as the retryable `no-progress` clause after `stalledTurns` turns in a row without a
successful tool call (`POLICY.loop`, read by `src/author/builder-turn-loop.ts`). Those turns change nothing, and the clause resumes
the same conversation.

### battery-sizing

Refuses an out-of-range battery size, and sizes a fresh product's probe batteries between 5 and 10
(`src/run/battery-sizing.ts`). The size is part of the measurement condition.

### candidate-zero-verified

Holds a measured candidate with no verified case instead of selecting it
(`src/run/candidate-promotion.ts`). It holds no capability evidence to replace a product with.

### review-unread-hold

Returns an unread authoring review in place of a submit verdict when it shows a blocking finding
(`review-unread`, `src/gate/submit-tool.ts`, `join` in `src/run/authoring-review.ts`), so the
Builder reads a demonstrated defect before a submit ends the round it applies to. Until 2026-09-27
it held for any shown finding, advisory ones included, and the triage of 28 recorded runs counted
34 holds in 19 chains and about 79 minutes of waiting, with two campaigns whose every held review
was advisory and whose identical candidate was then accepted. An advisory finding asks for no change
before submit, so it now rides the next tool result and holds nothing.

### continuation-nudge

Asks for authoring after eight turns or two hours without a submit
(`src/author/builder-continuation.ts`). It is a prompt line and refuses nothing.

### command-guard

Refuses destructive Builder commands (`src/builder/command-guard.ts`). It is a safety net, not
isolation or evidence, and refuses no candidate.

### public-source-limits

Bounds each brokered HTTPS fetch to a public address, 5 redirects, 64 MB and 120 s
(`src/builder/public-source.ts`). This keeps the fetch off private hosts.

### workshop-export-limits

Refuses a verifier-workshop export over 64 MiB or onto an existing path
(`src/builder/verifier-workshop-export.ts`). The tool description states both, and no-overwrite
keeps an export from following an existing path or symlink.

### harness-reset-scope

Refuses `harness_reset` outside a reopen rebuild and a second reset of one scope per reopen
(`src/builder/harness-reset.ts`). A fresh build has no seed to return to, and the per-scope marker
keeps a resumed round from wiping its own work.

## Narrowed, 2026-09-26

### operating-guide-shape

Refuses an empty operating guide and the unchanged starter seed, which carries a
`starter-placeholder:` marker (`guideFindings`, `src/author/candidate-check.ts`). Both are a guide
nobody wrote. The 8,192-byte cap and the task-identifier scan are deleted: a long guide is a cost
the battery measures, and whether guidance says too much is review's.

### key-material-file

Refuses an agent file whose name can only mean an answer: an answer key, an `answers.json` and its
siblings, or hidden expectations (`KEY_MATERIAL_RE`, `src/claim/bundle-validation.ts`). The
`reference-solver` and `expected-outputs` patterns are deleted, because a solver-side search or a
tool tabulating what a public input implies is legitimate agent code under exactly those names, and
no recorded campaign ever tripped the rule. The rest of `bundle-walls` is unchanged.

## Rewritten, 2026-09-26

Components the second audit judged right in intent and wrong in shape, because each was a patch at
one stage. Each is now one decision with one owner that every stage applying it calls, so no stage
keeps a copy of its own.

### grounded-verdict (R1)

Replaces `f2-witness-relay`, `census-grounding-owed` and the per-case half of `measure-grounding`
(`src/correctness-bundle/tool-runs.ts`). A pass is ungrounded when an applicable check that declares required
tools, authored or external, has no completed run of one of them on that same subject. A fail is
never refused for a missing run: a skipped run could only have withheld a pass, and refusing one
mislabelled correct prechecks and every census reject that passed its check. One code,
`EXTERNAL_VERDICT_UNGROUNDED`. The F2 witness fails, a census control is refused, and a battery or
rehearsal case is a `verifier` non-result. Timeouts and crashes stay with
`DISCRIMINATION_PROBE_NO_VERDICT`, and `generated-correctness-model-relay` is gone as a
classification. The claim's `external-grounding-case-uncovered` clause is deleted, since no verified
pass can now lack its run.

### every-check-rejects (R2)

Replaces `reject-discrimination` and `public-rule-control-coverage`. Two decisions over the settled
control receipts, which the census writes and the claim reads back through `checkReceiptSet`, so the
two cannot disagree: a reject whose `expectedCheckId` did not fail on it
(`DISCRIMINATION_REJECT_PASSED`), and a check some bound task declares that no reject names
(`DISCRIMINATION_CHECK_UNREJECTED`). A reject whose tool run crashed is
`DISCRIMINATION_PROBE_NO_VERDICT`'s, and one that timed out refuses nothing and is listed in the
advisory `controls-tool-timeout` row. Neither is a miss, and unless the environment refused it,
neither names its check, so a check whose only reject reached no verdict is still unrejected. The per-family reject and the per-cell
accept requirements are gone: mutation analysis asks that every check be seen to kill a mutant, not
that every family supply one, and the claim's `intrinsic-` and `external-grounding-uncovered`
clauses are deleted as the same fact read a second time.

### declared-means-graded (R3)

Replaces `brief-artifact-root-unread` and `published-rules` (`src/correctness-bundle/rule-decisions.ts`),
restored as two refusals in `validateBrief`, so a fresh build and a continuation meet them alike.
An artifact root no check lists in its `artifactPaths`, with no check reading `$`, is refused
(`brief-artifact-root-unread`), and so is a check citing an undeclared rule row or only private
ones (`brief-cited-decision-withheld`); a private construction note cited beside a public rule
passes, which was the one recorded snapshot the stricter form would have refused. The requirement that every check cite some rule
(`brief-rule-unpublished`) is deleted: a citation cannot show that the cited prose states what the
check enforces. A declared path proves the value reaches a check and not that any verdict depends
on it, so the Epoch Reviewer's probe paragraph now asks for a probe of a root no public rule plainly
governs (`review-probing-findings/v8`).

### held-rounds (R4)

Replaces `held-candidate-ceiling` (`heldCountsAgainstAuthor`, `src/run/full-run-round.ts`). A held
candidate now counts against the unresolved-authoring allowance unless the environment owns the
hold: its battery was not delivered (no claim, or a provider stop that created none, which
`environment-blocked-ceiling` already counts), or its claim was refused only for the environment
clauses the climb already sets aside (`refusedForEnvironmentOnly`,
`src/run/climb-battery-admission.ts`, one owner for both). A zero-verified battery the environment
carried is the author's: prior 10 asks for a hard battery, and a battery nothing passed is one the
author cannot yet read. The old ceiling's one recorded firing, truss-sol-cb274b at b665608, ended a
run whose four held candidates had verified 10, 15, 11 and 15 cases, every claim refused for
`runtime-model-identity-unproven` alone because the codex route recorded no per-case served
identity. Under R4 none of those holds counts, and `test/full-run-round.test.ts` holds that case
beside one that adds a clause the environment does not own, which still counts. The promotion hold
behind it (`candidate-claim-refused`, `src/run/candidate-promotion.ts`) still holds such a candidate,
by an operator decision recorded there that routes any narrowing to the claim's own clauses in
`src/claim/`. The archived off-aim stop (`off-aim-allowance-stop`) is deleted rather than
restored as a flag, because `--iteration-budget` already bounds a campaign and the streak stays a
readout fact. A resumed round no longer tells the Builder its accepted candidate was taken forward,
which an unchanged candidate is not.

## Deleted, 2026-09-26

The second audit (54 components read against their recorded firings and their stated reason) found
no decision these fourteen changed correctly, so their commented-out code, markers and tests are gone
rather than waiting to be restored: `tool-program-argument`, `tool-self-authored`, `repeated-public-
condition`, `product-repair-required`, `operating-guide-retired-tool`, `task-variation`, `brief-
constant-uncited`, `brief-join-no-decoys`, `agent-deciding-computation`, `repeated-findings-stall`,
`tool-non-result-ceiling`, `preview-attempt-spent`, and in the pass after them `representation-blocking`
(a copied root or an absence spelling on every reference witness, shape heuristics that R3's root
probe and the reviewer's most-failed-check probe now ask by measurement) and `census-inert-tool`
(readiness's `inertToolFindings` already bounds the claim on the same fact). Two live refusals with no producer left to
refuse went with them: `tasks-difficulty-unrequested` and `tools-data-reader-state`.

## Correctness-check triage, 2026-09-27

A third pass read every firing of the census components across 28 recorded runs, per firing and
from the receipts, and changed what those firings showed was wrong.

### controls-boundary-witness (deleted)

Refused a reject whose `targetsBoundary: {publicInputPath, constantName}` together with its
`expectedCheckId` was not a triple some check's `numericBoundaries` declared
(`controls-boundary-check-mismatch`), or that claimed a join decoy beside the boundary
(`controls-boundary-join-witness-overloaded`). It fired twice, both times on a real misspelling,
and both times on a field nothing read: the census proves a reject by running its
`expectedCheckId` alone, and no census, claim or reader consumed the annotation. The Builder
answered the first firing by deleting the annotation. The field, both codes and
`numericBoundaryObligations`, whose only caller this was, are gone; a recorded `controls.json` that
still carries the field is admitted, since the row parse ignores keys it does not name.
`numericBoundaries` on a check stays, because `publishedMargins` reads it.

### accept-control-rejected (routing rewritten)

Seven of eight recorded refusals were real, and in five of those the fault was a tool that could
not run in the snapshot or the verifier cell — a relocated venv, a wrapper that would not launch,
an emulator the wall refused — while the finding told the Builder to fix the correctnessModel. A
tool that fails silently on one input is not yet that: a compiler refusing a broken accept also
exits 1 with nothing on stdout. What separates them is the rest of the census. An accept is routed
to `.toolchain`, as its own `DISCRIMINATION_ACCEPT_REJECTED` finding, when each of its blocking
checks has a run that ended nonzero with no stdout and that run's tool never exited 0 or wrote
stdout on any accept or reject (`unrunnableTools`, `src/correctness-bundle/run-controls.ts`). One
working run anywhere keeps the rejection the correctnessModel's. The refusal itself is unchanged;
only its owner and remedy moved.

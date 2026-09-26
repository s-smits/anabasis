# Gate audit, 2026-09-25

This file records one pass over every component that can refuse a Builder's candidate or hold a
measured battery back from a claim: the submit and preview gate (`src/gate/validation-pipeline.ts`
and what it calls), the battery pre-case in `src/truth/verification-runner.ts`, and claim
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

Every component still in the tree carries one comment line naming this file and its id:

```text
// Gate audit 2026-09-25 (docs/gate-audit.md, <id>): kept: <why>
// Gate audit 2026-09-25 (docs/gate-audit.md, <id>): commented out (unsure): <why>
```

A commented-out component is left in place, line for line, with its call sites and its tests, so
restoring it is uncommenting the blocks that carry its id and the prose lines named in its entry.
Its finding code is no longer produced, and the model-visible text that described it has been
taken out, since a rule the Builder is told about and nothing enforces is worse than no rule.

The blocks were archived in commit 3be43b8 and have not moved since, while the code around them has.
The consolidation that followed renamed what several of them read. A finding's owner, for one, is
now the bundle file at fault, such as `correctness-model/evaluator.ts`, rather than a word such as
`correctness-model`. So a restore starts from 3be43b8 and translates each uncommented line into the
current vocabulary before it can compile.

## Kept

Each kept component refuses a candidate, holds a battery or bounds a loop because something is
actually wrong with it, and the refusal names what to repair. Behaviour is unchanged; only the
comment line above the producer is new.

### bundle-shape

Refuses a brief, task or control row that does not parse into its declared shape
(`shape-mismatch`, `fieldFinding` in `src/truth/brief.ts`). Nothing downstream can read a malformed
row, so the refusal names the field instead of letting a later stage crash on it.

### task-shape

Refuses a `tasks.json` that is not a bare array, a task id that is duplicated or unsafe as a
directory name, a missing hidden operand, a declared public path absent from an applicable task,
and a check that applies to no task (`tasks-shape`, `tasks-check-family-unbound`,
`tasks-no-applicable-checks`; `src/truth/tasks.ts`, `src/author/candidate-check.ts`). Every later
stage indexes by these, so a violation fails the round at the first case rather than here.

### task-count

Refuses a battery whose size differs from the one the run asked for (`tasks-exact-census`,
`src/truth/tasks.ts`). Size is a measurement condition code owns, and it is refused rather than
clamped because a silently changed size is a silently changed condition.

### harness-config

Refuses runtime walls in `agent/config.yaml` beyond ten times their defaults, and a `files`
preset with no file-map root (`harness-config-invalid`, `tools-files-preset-artifact-root`;
`src/author/candidate-check.ts`). A wall the host would refuse at run time, or a preset that cannot
carry the artifact, otherwise fails as a non-result in a paid battery.

### tools-spec-structure

Refuses tool rows with bad keys, kinds or duplicate names, starter tools left in, and leftover
data-reader state (`tools-data-reader-state` and the structural codes of `src/truth/tools-spec.ts`).
Conformance registers exactly this roster, so it has to parse into one stable worker contract.

### accept-schema

Refuses an accept control the public artifact schema cannot compile, or one off the declared
top-level schema (`controls-accept-public-schema-inconsistent`, `controls-accept-off-schema`;
`src/author/fresh-candidate-contract.ts`, `src/truth/controls.ts`). That is a contradiction inside
the Builder's own bytes, and the solver is told the same schema.

### expected-check-inapplicable

Refuses a reject control whose named check does not apply to its task's family
(`controls-expected-check-inapplicable`, `src/truth/controls.ts`). Such a reject can never fail on
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
(`src/truth/solvability.ts`, `src/run/solvability-gate.ts`). A reference the checks reject shows,
before any paid solve, that no pass is reachable through the declared path. This is the answer-key
check the benchmark literature says to keep.

### f2-representation-defect

Refuses a reference answer the writer, the DraftStore or the submit path cannot carry
(`src/run/solvability-gate.ts`). Every solve would meet the same defect.

### accept-control-rejected

Refuses a candidate, and at claim time a battery, when a known-valid accept control fails a check
(`DISCRIMINATION_ACCEPT_REJECTED`; `src/truth/run-controls.ts`, `src/truth/control-receipts.ts`).
When the checks reject an answer the Builder vouches for, no measured pass can be read through them.

### controls-no-verdict

Refuses a control whose check threw or reached no verdict (`DISCRIMINATION_NOT_PROVEN`,
`PROBE_NO_VERDICT`; `src/truth/run-controls.ts`). It witnesses nothing about the checks.

### external-result-unbound

Refuses a check that returns while its tool runs are still running (`EXTERNAL_RESULT_UNBOUND`,
`src/truth/run-controls.ts`). Its verdict grounds on nothing it waited for.

### tool-environment

Settles a census or tool run the host could not execute as an environment non-result
(`census-wall-exceeded`, `CENSUS_UNAVAILABLE`, the settle functions of `src/run/census-gate.ts` and
`src/run/solvability-gate.ts`). It is never a verdict on the candidate (rule 15).

### condition-identity

Refuses a verifier condition that drifted, a worker whose contract differs across tasks, and a
generated toolset that did not terminate (`verifier-condition-drift`, `task-worker-binding-drift`,
`generated-toolset-termination`; `src/run/census-gate.ts`, `src/truth/probe-tool-surface.ts`).
Measurement refuses the same, so the gate refuses it first.

### measure-grounding

Makes a verified case whose externally grounded check ran no tool a typed non-result, and names at
readiness and in the claim an external check with no tool run on its verified cases
(`src/truth/solve-case.ts`, `src/claim/readiness.ts`, `src/claim/claim.ts`). Without the run there
is no tool evidence behind the verdict.

### build-failed-ceiling

Ends the campaign as `build-failed` after `buildFailedRounds` rounds that admit no candidate
(`src/run/full-run-round.ts`). A round that admits nothing measures nothing, so its retries share
one bounded allowance.

### environment-blocked-ceiling

Ends the campaign as `environment-blocked` after `environmentBlockedRounds` batteries of typed
non-results (`src/run/full-run-round.ts`). Remeasuring the same dead environment buys nothing.

### noop-submit-strike

Counts a byte-identical resubmit of a refused candidate as a strike, and ends the session as
`authoring-stalled` at `noopSubmitStrikes` (`src/gate/candidate-memory.ts`). The same bytes cannot
earn a different verdict.

### unchanged-candidate-strike

Counts a round that settles on its own entry tree, up to `unchangedCandidateStrikes`
(`src/run/full-run-build-step.ts`). Such a round has nothing new to measure.

### no-progress

Ends a round as the retryable `no-progress` clause after three turns in a row without a successful
tool call (`src/author/builder-turn-loop.ts`). Those turns change nothing, and the clause resumes
the same conversation.

### battery-sizing

Refuses an out-of-range battery size, and sizes a fresh product's probe batteries between 5 and 10
(`src/run/battery-sizing.ts`). The size is part of the measurement condition.

### candidate-zero-verified

Holds a measured candidate with no verified case instead of selecting it
(`src/run/candidate-promotion.ts`). It holds no capability evidence to replace a product with.

### review-unread-hold

Returns an authoring review's unread findings in place of a submit verdict (`review-unread`,
`src/gate/submit-tool.ts`). The Builder reads them before a submit ends the round they apply to.

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

## Commented out (unsure)

Each entry below names what the component refused, why the audit was unsure it refuses something
actually wrong, and how to restore it. To restore one, uncomment every block under a marker naming
its id (`grep -rn "gate-audit.md, <id>" src tools test .claude`), then put back the prose this entry
names.

### representation-blocking

Refused a candidate whose reference answer spelled an absence or whose artifact root transcribed a
public input (`REFERENCE_ANSWER_SPELLS_ABSENCE`, `ARTIFACT_ROOT_TRANSCRIBES_PUBLIC_INPUT`;
`src/run/representation-census.ts`, `src/run/solvability-gate.ts`). Both are shape heuristics over
the answer rather than a demonstrated wrong verdict. The witness shape and `inputInsensitivity`
stay live.

### census-inert-tool

Refused adoption when the census never launched a declared external tool
(`external-check-tool-unlaunched` at the census, `src/truth/probes.ts`). Readiness still names the
same fact through `inertToolFindings`, where it bounds a claim rather than an authoring round.

### census-grounding-owed

Refused adoption when an example's external check made no completed tool run and no host refusal
explained it (`generated-external-grounding-unexecuted`, `src/truth/grounding-coverage.ts`). The
refused bucket, a host that refused the tool, stays an environment non-result. Restore the
STARTER.md Grounding section with it.

### f2-witness-relay

Marked a reference solve that relayed the correctness model as a
`generated-correctness-model-relay` finding (`src/truth/solvability-witness.ts`).
`uncoveredExternalCheckIds`, which measurement reads, stays live.

### reject-discrimination

Refused a candidate, and at claim time a battery, when a reject control passed its named check
(`DISCRIMINATION_REJECT_PASSED` in `src/truth/run-controls.ts`, the reject side of
`src/truth/control-receipts.ts`, and the external and intrinsic grounding-uncovered clauses of
`src/claim/claim.ts`). A passing reject can be a loose check or a mis-built reject, and the audit
could not tell which one the refusal was catching. A candidate whose rejects pass is now measured
and claimable.

### public-rule-control-coverage

Refused a control corpus missing an accept per check-by-family cell, or a reject per check and per
family (`controls-public-rule-positive-missing`, `controls-public-rule-negative-missing`;
`publicRuleFindings` in `src/truth/controls.ts`). The census runs every control the Builder wrote,
and the audit was unsure that a coverage count refuses a wrong corpus rather than a small one.
`starter-pack/contract.md` still asks for that coverage as advice; restore AGENTS.md rule 12's
statement that the gate checks it.

### operating-guide-policy

Refused an empty, oversized (over 8,192 bytes), placeholder or task-naming operating guide
(`operating-guide-shape`, `operating-guide-task-identifier`, `MAX_GUIDE_BYTES`;
`src/author/candidate-check.ts`). A missing guide is still refused. Whether these byte shapes earn a
refusal rather than review was unclear. Restore the contract.md and STARTER.md guide-size sentences
with it.

### brief-artifact-root-unread

Refused an artifact-schema root no check lists in its `artifactPaths`
(`brief-artifact-root-unread`, `src/truth/brief-validator.ts`). Naming a path does not prove a
check reads it materially, so the refusal checked a declaration, not decoration.

### published-rules

Required every truth check to cite a public `ruleDecisions` row and no private one
(`brief-cited-decision-withheld`, `brief-rule-unpublished`). The producer sits commented at the end
of `src/truth/rule-decisions.ts`, beside the citation shape it read, and its call in
`src/author/fresh-candidate-contract.ts`. A citation cannot show that the cited prose states what
the check enforces.

### off-aim-allowance-stop

Stopped a campaign after `climb.offAimStreakRounds` consecutive rounds on one side of the aim
(`allowanceStop` in `src/run/next-move.ts`, `src/critic/policy.ts`, FRAME `readout.allowance`,
`tools/runs/pulse.ts`). The route after an off-aim streak belongs to the Builder, and the streak
stays a readout fact. Restore the AGENTS.md loop-ceiling entry and the FRAME stop wording with it.

### held-candidate-ceiling

Counted `candidate-zero-verified` holds toward the build-failed stall limit
(`src/run/full-run-round.ts`). A zero-verified battery is the hard battery design prior 10 asks
for, not an authoring stall.

## Deleted, 2026-09-26

The second audit (54 components read against their recorded firings and their stated reason) found
no decision these twelve changed correctly, so their commented-out code, markers and tests are gone
rather than waiting to be restored: `tool-program-argument`, `tool-self-authored`, `repeated-public-
condition`, `product-repair-required`, `operating-guide-retired-tool`, `task-variation`, `brief-
constant-uncited`, `brief-join-no-decoys`, `agent-deciding-computation`, `repeated-findings-stall`,
`tool-non-result-ceiling`, `preview-attempt-spent`. Two live refusals with no producer left to
refuse went with them: `tasks-difficulty-unrequested` and `tools-data-reader-state`.

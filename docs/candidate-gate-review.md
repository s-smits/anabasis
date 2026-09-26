# Candidate gate review

This review asks whether the candidate gate, which is the sequence `correctness_check` previews and
`submit` runs, needs rewriting. It does not. What it found is narrower. The gate refuses what it
is built to refuse, and it refuses it early. The defects that get past it are loose semantics,
such as a check that accepts a wrong answer or a reference replaying a precomputed design, and no
structural gate could refuse those, because each one satisfies its own declared contract. The
Epoch Reviewer does see them before adoption, but nothing at submit reads what it saw. Four small
changes follow from that, plus one decision for the operator that this branch does not take.

The analysis is against `claude/skills-main` at e884e6004 (PR #8's composed head). Two sources
supply the evidence. The first is the gate-health audit of nine recorded runs that commissioned
this review. The second is a count of the authoring-review files under both campaign roots written
since 2026-09-18.

## What the gate did in the recorded runs

The audit counted 94 previews: 50 were clear and 44 refused. All 21 submits were admitted at the
first attempt, and not one gate call ended as a host non-result. So the loop is doing what it was
designed for. The Builder takes its refusals in preview, where they cost nothing, and arrives at
submit clean. The refusals were overwhelmingly repairs of provably malformed input: an undeclared
root, a missing hidden row, a reject that did not fail on its named check, and 17 sandbox-tool
refusals. The most expensive was `TASK_FAMILY_BINDING_UNPROVEN`, which cost one session 28
minutes, and that session got past it by relabelling a check from external to authored. That is a
legitimate move under the contract, and it shows the check is binding a declaration rather than a
fact.

The part that should worry a reader comes after adoption. Eighteen of 22 claims were all-pass, and
the post-battery reviewer admitted a blocking evaluator defect in 7 of 21 reviews, across 5 of the
9 runs. Those defects were mostly not new at that point: of 99 authoring reviews, 35 carried at
least one blocking finding. Run fa03b7 in the truss campaign 3fd52f9e is the clearest instance.
Its catalogue mass check loosened the published strict mass ceiling by 0.05 kg. Four authoring
reviews between 15:53 and 16:21 on 2026-09-22 named the loosening, two as blocking and two as
advisory. The candidate was admitted anyway, and a battery was measured and a claim written over
the loose check. The post-battery review then raised it as blocking, and the rebuild advice
reopened the owner for i02. The shift between blocking and advisory matters as much as the
admission. A single model reading does not give a stable severity for the same defect, so that
reading cannot be allowed to refuse a submit on its own.

## Stage map

| Stage | Owner | Refuses | Cannot catch |
| --- | --- | --- | --- |
| bundle | `checkCandidate`, `src/author/candidate-check.ts:545` | schema, brief, tasks, controls and tools-spec shape; the solver shell preset; undeclared roots; path grammar | anything semantic: a check that is well-formed and wrong |
| validation | `admit`, `src/gate/validation-pipeline.ts:369` | a missing or malformed `EXPERIMENT.json`, a repeated public condition | whether the stated experiment is the one the bytes make |
| conformance | `executeStages`, `validation-pipeline.ts:273` | a generated tool that does not load, answer or keep one registration across tasks | whether the tools help the solver |
| gates: census | `makeCensusGate`, `src/run/census-gate.ts:532` | an accept that fails, a reject that passes or fails elsewhere, an unread root, transplanted deliverables | a reject that is a one-fact edit of the Builder's own answer, which calibrates only against the Builder's own misconceptions |
| gates: F2 | `makeSolvabilityCensusGate`, `src/run/solvability-gate.ts:99`, over `src/correctness-bundle/solvability.ts` | a task the reference cannot submit through the generated tools | a reference that replays a precomputed design: it proves the submission path, as rule 12 already says, and not solvability from public input |

Previews and submits share the gate through `sharedGate` (`validation-pipeline.ts:241`), keyed by
snapshot and engine condition, so a submit of previewed bytes reuses the clear run. Two memories
hold session state, and they look like duplicates without being duplicates. `ValidationMemory`
caches gate runs by bytes. `CandidateMemory` counts byte-identical resubmits of a refused
candidate as strikes. Each has its own owner and its own consumer, so merging them would buy
nothing.

The Epoch Reviewer is handed the tree at `reviewIfDue` (`src/run/builder-campaign.ts:487`), after
a completed tool call. It reads the snapshot when a clear preview changed the product
(`AuthoringReviewClock`, `src/gate/review-clock.ts`), or it reads the live workspace after 40
minutes. Its projected findings ride the next tool result as text, and that text is the whole
hand-off. Post-battery findings go on through `admitFindings` into rebuild advice, which reopens
the owner.

## Classifying the gaps

**(a) The gate should refuse.** None was found. Every structural refusal the recorded runs needed
already exists and fires at preview. Adding walls here would repeat the failure mode rule 8 names,
which is legitimate work blocked by a gate that pays no rent.

**(b) The reviewer should catch it, and the hand-off should carry it.** Four gaps fall here.

- **A battery-only change was never reviewed.** `correctnessModelHash` excludes `tasks.json` and
  `controls.json`, and the review clock compared only the agent and correctness-model hashes. A
  round that rewrote the hidden expectations and every control therefore owed the reviewer
  nothing, and a task probe is exactly that kind of round. *Fixed.*
- **Previews recorded how many findings they had, not which.** A session that repaired a tree
  before submit left no durable record of which gate had refused it. The 44 refusals above had to
  be recovered from stdout. *Fixed.*
- **Declared paths could not name one file of a file map.** `probe_check` accepted
  `$.firmware['fw_logic.cpp']` but a check could not declare it, so checks over a file map declared
  the map whole. The projection then handed every file to every check, and the rule-11 variation
  test was satisfied by any edit anywhere in the map. *Fixed:* the checks and the reviewer now use
  one grammar.
- **An authoring review does not record the fingerprint it read.** Recurrence and settlement
  therefore cannot be keyed to bytes before measurement. *Not built:* this matters only once
  something consumes pre-adoption findings, which is the operator decision below.

**(c) Only measurement can decide.** Two gaps are here. The first is a reference replaying a
precomputed design. The second is a control corpus that is one-fact edits of the Builder's own
accepts. The contract allows both, and telling a good instance from a bad one means solving the
task independently. That is what the Built Harness battery does, and what a Sol-solver shared pack
does better.

## The operator decision this does not take

The cheapest way to stop fa03b7's sequence would be to consult the authoring reviewer's blocking
findings at submit. That would not be sound as things stand, because a single model reading is
not stable on the same bytes, and letting it refuse adoption would make a model judgement part of
the gate, which the first design prior forbids. A sound version exists, however.
`probe_check` is deterministic. A probe-backed harness defect is a recorded pair of accept
artifacts on which the candidate's own declared checks gave the same verdict when the request says
they must differ. Submit could replay those probes against the submitted bytes and refuse only
when they still reproduce. That is code deciding on a model's proposed counterexample, the same
shape as a reject control. It needs the reviewed fingerprint recorded, a replay path under the
submit's verifier deadline, and a decision that reviewer-proposed controls may bind adoption.
That last decision belongs to the operator.

## What was changed on `claude/candidate-gate`

- `src/gate/review-clock.ts`: a validated preview whose `taskSetHash` moved owes a review. Tested
  in `test/review-clock.test.ts`; reverting the fix fails 1 test.
- `src/gate/check-tool.ts`, `src/author/builder-custom-tool-call.ts`,
  `tools/outcome/builder-execution-current.ts`: preview receipts carry the distinct blocking codes,
  and the model-visible body is unchanged, which the test asserts.
- `src/meta/json-evidence.ts`, `src/review/review-probe.ts`, `src/correctness-bundle/brief-validator.ts`: quoted
  keys are part of `jsonPathTokens`, and `probeSteps` is removed. The starter contract gains one
  sentence naming the spelling.
- `AGENTS.md` rule 14 now says the review trigger includes battery bytes.

What was deliberately left alone: merging the two session memories; re-validating F2 inputs that
the bundle stage already validated, which costs milliseconds; and marking claims with
post-battery blocking findings, which is a claim-reader change rather than a gate change.

# Tests that state an outcome over a space of inputs

Status (27 November 2026): the kernel's comparison and the move table are checked by enumeration
and search instead of examples (`test/compare-exhaustive.test.ts`, `test/decide-explore.test.ts`,
`test/pairs-property.test.ts`, `test/wall-practice.test.ts`), replacing six example files. The
mechanical mutants of the five owners are the oracle for each deletion (commit-r, step 8). The
compartments below are still example-based.

## Intended changes

1. **The kernel (this change).** Done to the rung "proved without a model". The mutants that only
   the old tests killed are restored as cases or answered in the pull request. A fold whose output
   has no rule apart from its code (`poolOf`, `releaseOrder`, `taskRecords`) keeps named cases
   where no definition written in the test can be compared with it.
2. **Campaign scenarios.** `test/round.test.ts`, `test/builder-led.test.ts`,
   `test/harness-builder.test.ts`, and `test/campaign.test.ts` walk chosen paths through a round. A
   search over the commands a round can take, from a rehearsal's seed, with the log's folds as
   invariants, would replace most of them; the mutants of `src/campaign/` and `tools/campaign/` are
   its oracle.
3. **The Builder's wall and tools.** `test/builder.test.ts` and `test/builder-led.test.ts` prove
   byte identity on chosen pairs of logs and repeat full faux sessions for individual `read_trace`,
   `layPractice`, `snapshot`, and `readHarnessFiles` paths. A perturbation generator over hidden
   values, checks, and held-out outcomes plus table-driven file/tool cases would replace most of
   it; `src/builder/` and `src/harness/files.ts` are its oracle.
4. **Run and investigation tools.** `test/wri-readers.test.ts` and the `runs-*` suites repeat
   verbose `LogEvent[]` fixtures across tests; consolidating `diagnosticRows`, `overview`, and
   lane-report parsing into one declarative fixture builder and invariant table cuts boilerplate
   cleanly without losing kills (`tools/wri/` as oracle).
5. **Auditor and Examiner sessions.** `test/review.test.ts`, `test/draft.test.ts`,
   `test/examiner.test.ts`, and `test/revise-exam.test.ts` enumerate individual probe, ruling, and
   drafting scenarios. Collapsing probe/ruling cases and `draftReading`/`from_file`/review-filter
   checks into tables and perturbation checks leaves only process/provider boundary smokes
   (`src/audit/` and `src/examiner/` as oracle).
6. **Check router, stack land, and mutation oracle.** `test/router.test.ts`, `test/land.test.ts`,
   and `test/commit-r-mutate.test.ts` exercise pure scheduling, stack-ordering, and
   diff-hunk rules through heavy filesystem and subprocess fixtures. Testing pure ranking,
   queue, and stack-graph invariants over generated small topologies and keeping a thin
   subprocess smoke layer reduces both lines and wall time.
7. **The search's environment against the record.** The decide search writes the events each move
   writes from a hand-made answer table. Replaying `decide` over `data/runs/` and checking that
   every recorded answer to a move is one the table offers would show that the searched space
   covers what campaigns did.
8. **The order of the rows.** `decide` takes the first row that answers. Exporting the rows would
   let the search assert that order on every reached log, with a witness for each pair of rows that
   both answer.

## History

- 21 November 2026, the operator: "only rewrite tests, tune Prod/surrouding code a little bit if
  it's breaking but do not massively overhaul functionality, focus on the simplification of tests /
  removing unit tests", and "we do not have to directly match prod we can tune a bit as long as
  main inner workings stay kind of consistent". The stop criteria set then: under about 50% net
  reduction of test lines, more than about 15% of old kills unanswered, or more than about ten
  seconds per search.
- 21 November 2026, the operator: "maybe we should run full formal verification at the end of
  --sanitize and/or --merge right?". The bounded checks already run in every gate. The mutant audit
  stays with the deletion of tests, since five modules took more than an hour of the fleet's
  slots. The operator has not decided this yet.

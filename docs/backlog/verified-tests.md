# Tests that state an outcome over a space of inputs

Status (21 November 2026): the kernel's comparison and the move table are checked by enumeration
and search instead of examples (`test/compare-exhaustive.test.ts`, `test/decide-explore.test.ts`,
`test/pairs-property.test.ts`, `test/wall-practice.test.ts`), replacing six example files. The
mechanical mutants of the five owners are the oracle for each deletion (commit-r, step 8). The
compartments below are still example-based.

## Intended changes

1. **The kernel (this change).** Done to the rung "proved without a model". The mutants that only
   the old tests killed are restored as cases or answered in the pull request. A fold whose output
   has no rule apart from its code (`poolOf`, `releaseOrder`, `taskRecords`) keeps named cases
   where no definition written in the test can be compared with it.
2. **Campaign scenarios.** `test/round.test.ts`, `test/campaign.test.ts` and the harness-builder
   tests walk chosen paths through a round. A search over the commands a round can take, from a
   rehearsal's seed, with the log's folds as invariants, would replace most of them; the mutants
   of `src/campaign/` are its oracle.
3. **The Builder's wall by perturbation.** `test/builder.test.ts` and `test/builder-led.test.ts`
   prove byte identity on chosen pairs of logs. A generator that perturbs every hidden value, check
   and held-out outcome of a small campaign, holding the tally, and compares every Builder message
   byte for byte would state rule 3 over a space instead of a pair.
4. **Run and investigation tools.** The `runs-*` and `wri-*` test files repeat fixtures across
   files; consolidating them to one fixture builder each is a refold, not a rewrite.
5. **The search's environment against the record.** The decide search writes the events each move
   writes from a hand-made answer table. Replaying `decide` over `data/runs/` and checking that
   every recorded answer to a move is one the table offers would show that the searched space
   covers what campaigns did.
6. **The order of the rows.** `decide` takes the first row that answers. Exporting the rows would
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

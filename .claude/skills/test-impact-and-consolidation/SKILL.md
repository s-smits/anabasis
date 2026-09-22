---
name: test-impact-and-consolidation
description: Measure which test files carry the least evidence and decide which may be merged or removed. Use when the suite has grown, when a run is slow, when asked which tests matter, or before adding a test that may already exist. Ranks by marginal coverage, then adjudicates each shortlisted file by planting faults.
---

# Test impact and consolidation

A suite grows one file at a time and nobody measures what each file still carries. This
skill measures it. It answers two questions with evidence: which test files pin behaviour
nothing else pins, and which pairs cover the same ground closely enough to merge.

Run it from a dedicated worktree with its own `node_modules`, never from a tree with live
work in it. Mutation writes faults into source; a mirror keeps them away from tracked files,
and a worktree keeps the measurement bound to one revision.

## The two-stage rule

Line coverage cannot decide this on its own. Two test files can execute the same lines and
assert entirely different things. So coverage only builds the shortlist, and sampled faults
provide evidence for each entry.

1. **Shortlist by marginal coverage.** A file whose every covered line is also covered by
   some other file is *subsumed*. That is a question, not a verdict.
2. **Adjudicate by mutation.** Plant a fault on a line the candidate covers, then run the
   candidate together with its peers. Only a candidate that catches nothing its peers miss
   is redundant.

Removing on stage 1 alone deletes evidence. On PR117 the shortlist held 18 files; the ones
that survived stage 2 were the point of the exercise.

## Procedure

The coverage and mutation helpers below are specialised historical runners that invoke Bun
tests directly. Check their discovery and runner limits before reuse; ordinary repository
verification follows the current `bun run test -- <paths>` wrapper contract.

Set up a worktree at the state you mean to measure, then use the frozen Bun graph. Bun 1.4 owns
the per-file lcov reports, so the measurement adds no package and does not rewrite a lock:

```sh
pr=117; topic=test-impact; wt=/absolute/path/harness-builder-v4-pr-$pr-$topic
scripts/worktree.sh pr "$pr" "$wt" "codex/pr-$pr-$topic"
```

Record the baseline before measuring anything, so a red file is known to be red beforehand:

```sh
scripts/worktree.sh run "$wt" bun run test > /private/tmp/claude-501/<project>/<session>/scratchpad/baseline.log 2>&1; echo "exit=$?"
```

Before reading any test name in that log as a failure, grep it for `idle-wall:` and `Interrupted
while still running`. The Bun test step parks on its 180-second idle wall often enough that a stall
is the likelier reading (4 stalls in 6 runs on 2026-08-23; 2 of 6 and 3 of 6 on 2026-08-31, in
trees that were already green). Rerun the interrupted file alone before accepting a red baseline.
A stall is not `BASELINE-RED`.

Run the static case census, then harvest one coverage report per test file and rank it:

```sh
REPO="$wt" scripts/worktree.sh run "$wt" bun \
  .claude/skills/test-impact-and-consolidation/scripts/case-census.mjs
REPO="$wt" scripts/worktree.sh run "$wt" bun \
  .claude/skills/test-impact-and-consolidation/scripts/coverage-harvest.mjs /abs/out/harvest 4
REPO="$wt" scripts/worktree.sh run "$wt" bun \
  .claude/skills/test-impact-and-consolidation/scripts/impact-rank.mjs /abs/out/harvest
```

`case-census.mjs` reports import subsets, exact duplicate callbacks, title twins and repeated
helpers. Its character-exact scanner is checked by `check-fixtures.mjs`; an identical callback
still needs reading because it may close over a different helper.

`impact-rank.mjs` prints the table and an ordered decision funnel. A harvested suite that failed
or timed out is `invalid-run`: cannot enter a merge queue. The helper still includes its partial coverage in aggregate line
counts, so rerun a failed harvest before using those counts to support removal. Absorption
chains collapse to their final survivor. Take only the valid shortlist to mutation, sharded over
separate mirrors:

```sh
for n in 1 2 3; do
  REPO="$wt" COV=/abs/out/harvest/cov MIRROR=/abs/out/m$n \
    scripts/worktree.sh run "$wt" bun \
    .claude/skills/test-impact-and-consolidation/scripts/mutation-adjudicate.mjs \
    /abs/out/mut-$n <candidates for this shard> &
done
```

One mirror cannot host two shards; they would overwrite each other's faults.

## Reading the verdicts

| verdict | meaning | action |
| --- | --- | --- |
| `LOAD-BEARING` | caught a fault no peer caught | keep, and say which fault |
| `REDUNDANT-IN-SCOPE` | caught faults, all also caught by same-subject peers | merge candidate, still read it first |
| `no-fault-caught` | no planted fault reached its assertions | inspect: either the operators missed the subject, or the file asserts little |
| `coverage-blind-read-it` | subject is outside `src/` | judge by reading; the numbers say nothing |
| `BASELINE-RED` | candidate or peer failed before a fault was planted | repair the baseline and repeat; it is no mutation evidence |
| `run-error` | a test process did not reach Bun's completed summary | fix the mirror or runner and repeat; it is no mutation evidence |

`REDUNDANT-IN-SCOPE` means "no fault in this sample was caught by it alone". It is evidence at the
sample size you ran, not a proof. Read the file before removing it, and prefer merging its
distinct cases into the peer that already covers the ground.

Then look at *which* peers caught the fault, because the verdict alone hides the difference
that matters. A wide integration test such as `full-run.test.ts` executes most of the tree,
so it turns red for almost any fault. That is detection, not diagnosis: it says the run
broke, never which unit broke. A candidate whose only catchers are the wide tests should
stay. Removal is defensible when a peer of similar scope catches the same fault — as
`secret-scan.test.ts` does for `diagnostic-redaction.test.ts`, and `record.test.ts` and
`run-triage.test.ts` do for `consolidation-cuts.test.ts`.

## What the numbers cannot see

Three kinds of test are invisible to both stages, and all three are cheap and worth keeping.
Never remove one on a low score.

- **Subprocess tests.** `trace-review`, `engine-wire`, `trusted-runtime` and `fullrun-launchd`
  do their work through `spawnSync`. Parent-process coverage records no child execution, so `reach` is 0.
- **Configuration and document pins.** `bun-entrypoints.test.ts` pins runtime and gate commands;
  `campaign-audit-protocol.test.ts` pins a skill prompt.
  Mutation operators only touch `src/`, so these score as redundant while enforcing
  a rule.
- **Type-level pins.** `non-result-kind.test.ts` holds `@ts-expect-error` directives that
  fail the typecheck rather than the run. Neither stage sees them.

A fourth kind is invisible to stage 2 alone. The operators need a comparison, a boolean or
an arithmetic term to corrupt, so code that only builds a structure yields no mutants at all
and reports `no-fault-caught`. `ask-manifest.test.ts` reads that way while pinning the exact
verifier invocation: the command, its arguments, `allowedEnv` and `attestedFiles`. Treat
`no-fault-caught` as "the harness had nothing to plant", and read the file.

## Traps that produce wrong answers

- **Ranking before the harvest finishes.** A half-written `coverage-final.json` parses as
  nothing and the file looks like it covers nothing. `impact-rank.mjs` refuses to run until
  `runs.json` exists, and names every report it could not read.
- **A narrow first-party filter.** Dropping `vendor/` made `jsonl.test.ts` look empty when
  it covers `vendor/pi-built/jsonl.ts`. Keep `src`, `tools`, `vendor` and `starters`.
- **Mutants that break the parse.** A fault that fails to transform turns every test red and
  makes a load-bearing file look duplicated. The operator list is syntax-preserving for that
  reason. Do not add operators that delete statements or reorder arguments.

## Calibration: the PR117 run

Run at `9be6b3e1`: 119 test files, 1556 tests, 39s, green. Coverage shortlisted 18 files as
subsumed — 68 tests and 5 of the 39 seconds. After mutation and reading, 11 of the 18 had to
stay and 7 were merge candidates. Nothing was safe to delete outright.

Expect that ratio. A shortlist is a list of questions, and on a suite that has been kept
under review most of the answers come back "keep". If a run reports that a third of the
suite can go, suspect the measurement before the suite.

The single most useful number is not the verdict but the catcher list. Of the 15 files
adjudicated, 5 were caught only by `full-run.test.ts` and `full-run-loop.test.ts`. Those
files are the suite's diagnosis layer: remove them and a fault still turns something red,
but nothing says which unit broke.

## Reporting

State the measured position before the recommendation: files, tests, isolation time, and how many
files the shortlist held. For each removal, name the peer that now carries the behaviour and
the fault that proves it. For each merge, give the pair and its overlap. Say plainly which
files the method could not judge and why, and confirm the suite's test count before and
after. A consolidation that loses a case is worse than one that saves nothing.

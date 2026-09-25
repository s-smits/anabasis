---
name: test-audit
description: "Invoke whenever writing, changing, reviewing, or sweeping tests in Anabasis. A write-time gate for every new or changed test, and a read-first audit that prunes or consolidates tests re-asserting source, duplicating a stronger owner, coupling to implementation, or keeping a test-only export alive. Knows the suite's helpers, fakes, walls, rule-4 invariance tests and runner, and hands removal claims that rest on overlap to test-impact-and-consolidation."
---

# Test audit

A test here earns its place the way a gate does: by changing a decision correctly. It has to be
able to fail, for a reason someone would care about, in a way no stronger test already covers. Most
of what the suite gets wrong is not a test that is broken. It is a test that is green for the
wrong reason — a hostile case that passes because something unrelated threw, a pin on a constant
copied out of the source, a mock that does the thing the assertion checks — and those cost exactly
as much to maintain as the tests that carry the product.

This skill has two modes over one value bar. **Authoring** gates every test you add or change,
before it lands. **Audit** sweeps existing tests for the same defects and prunes or consolidates
them, one owner at a time. It judges a test by reading it. Its sibling
`test-impact-and-consolidation` judges a file by measuring it, with marginal coverage and planted
faults, and any removal that rests on "another test already catches this" needs that measurement
or a reading just as specific.

## The suite you are working in

Read these before judging anything, because most bad tests here are a local reinvention of
something the suite already owns.

**Runner.** `bun run test -- <paths...>` runs `tools/runtime/test-suite.ts`, never a bare
`bun test`: one parallel Bun process, slowest-first ordering, a per-run temp root exported as
`ANA_TEST_TMPDIR` (which `src/meta/os.ts` `tmpdir()` honours), a 60-second per-test timeout and a
180-second idle wall scaled by host load. When a run goes red, read the `attribute` sentence it
printed before believing it: `clock-only` and `crowded-host` failures are rerun alone and the
second verdict is the suite's, while an `unhandled-error`, an unreported file or more than eight
failures is never excused. `bunfig.toml` preloads `test/env-baseline.ts`, which strips sandbox
toggles, forced colour and every credential-shaped variable name before a test starts.

**Discovery.** The tree is flat: every suite sits directly under `test/`, with `test/helpers/` the
only subdirectory, and `test/test-discovery-completeness.test.ts` refuses a suite anywhere except
`test/`, `packages/ui/test/` or `starters/`. The same test requires every in-checkout scratch
directory to be prefixed `.ana-scratch-` or named `.scratch`, so they stay ignored.

**Which tests a change can break.** `bun tools/runtime/affected-tests.ts --base <rev>` lists the
test files that import a changed file directly, and a file nothing imports is reached by any test
that names its path. The pre-push hook runs exactly that set over every earlier commit in a push,
so it is also the cheapest honest focused run while you edit.

**Helpers.** `test/helpers/` holds the shared fakes and fixtures, and a new test uses them rather
than writing its own:

| need | helper |
| --- | --- |
| a typed fake, a scripted provider session, a tool double, a captured rejection | `doubles.ts` (`double<T>`, `scriptedSession`, `toolDouble`, `rejectionOf`, `required`) |
| a temp directory that is cleaned up | `scratch.ts` (`scratchDir` with `afterAll(cleanupScratch)`) |
| a child process that sees the preloaded environment | `bun-spawn-sync.ts` (`spawnTextSync`, `execTextSync`) |
| a complete small domain bundle and a scripted solver | `matching-fixture.ts`, `uppercase-fixture.ts` |
| a Builder campaign, a tool host, an installed tool | `builder-campaign.ts`, `builder-census-campaign.ts` |
| a scripted Builder or Built seat for an end-to-end loop | `scripted-builder-runtime.ts`, `builder-session-script.ts`, `measure-doubles.ts` |
| a candidate for the solvability and F2 stages | `solvability-specimen.ts`, `experiment-freeze-products.ts` |
| a case record row, a claim's evidence, fixture thresholds | `case-record-row.ts`, `claim-evidence.ts`, `thresholds.ts` |
| an isolation repo with a planted remedy leak | `isolation-fixture.ts`, `candidate-isolation-proof.ts` |
| one lint rule over a labelled fixture | `oxlint-rule-fixture.ts` (`// REPORT` and `// ADMITTED` lines) |

List the directory before writing a fixture; the table names the common ones, not all 33.

**Fixtures are produced, never transcribed.** No test reads `campaigns/`, `domains/` or a recorded
run, and none should: `matching-fixture.ts` and `recorded-controller.ts` state the rule, which is
that a test invokes the system rather than writing what the system writes. A fixture that
hand-types an opening, a claim or a receipt the owner would have produced is testing the
transcription.

**Fakes are injected, not mocked.** Production seams take their dependencies as parameters, and
tests pass a `double<T>()`. `mock.module` appears in a handful of files and each replaces one
external boundary (the Claude CLI query, a hostile filesystem transition). The anti-slop
`no-module-mocking` rule catches only `vi` and `jest`, so nothing stops a new `mock.module` from
`bun:test` except this gate.

**Time is injected.** There are no fake timers. A clock is a `now` parameter, an explicit-time
constructor or, rarely, `spyOn(Date, "now")`, and a wait is `Promise.withResolvers` or a polled
deadline — `ana/no-hand-rolled-sleep` refuses a `setTimeout` promise.

**Walls are proved on the host that has them.** A platform proof is skipped by the mechanism, not
by the platform name: `describe.if(darwinSeatbeltSupport().ok)` or `osIsolationSupport().ok`, so a
host with the OS but without the mechanism does not claim a proof it never ran. A decision a wall
makes on paths (policy, argv plan) is tested everywhere with an injected `{platform}` runtime; only
the executed refusal waits for its host.

**Lint over tests is held where it is.** `.oxlintrc.json` switches off a fixed list of type-safety
rules under `test/**`, and `BASELINE.md` owns why. Do not widen it, do not add an entry, and do not
tune a rule while auditing tests (operator decision 2026-09-24): fix the test, or answer the finding
with a reasoned row through `bun run not-slop -- answer <id> "<why>"`. Complexity *does* cover
`test/` — no function above a cyclomatic 21 — while the file and function length ceilings do not.

## Authoring gate

Before adding a test, answer four questions. A missing answer means it does not go in yet.

1. **What observable behaviour, invariant or independent contract does it protect?** Name it in the
   test title as a behavioural sentence ("refuses a reject that passes its named check at the
   control census"), not as an implementation step.
2. **What credible regression makes it fail?** If you cannot describe the edit to `src/` that turns
   it red, it guards nothing.
3. **Why does existing coverage not catch that regression already?** Each contract has one primary
   owner test at its strongest boundary. Find it — grep the title vocabulary, run
   `affected-tests.ts` over the file you are changing, read the file header, which in about half the
   suite states the contract the file owns — and extend it. Prefer a new row in an `it.each` table
   or a new label in a shared fixture over a near-duplicate case. A second layer earns its own test
   only for a risk the owner cannot reach, such as a transport, lifecycle or composition failure.
4. **Does it need a seam no production caller needs?** An export, a flag, a wrapper or an injection
   hook added for the test is a cost the product carries forever. `unusedExports` in
   `tools/loc/source-policy.ts` counts a test as a reader, so the gate will never tell you the seam
   is test-only; you have to check. Test through the real boundary instead.

Then run the test against every [junk pattern](#junk-patterns). A match fails the gate unless the
[retention bar](#retention-bar) names the contract it independently guards. A test that would break
under a behaviour-preserving refactor is asserting implementation; rewrite it at the owning boundary
before it lands.

**Every hostile case names its refusal.** A negative test asserts the specific code, finding,
clause or message the production path emits, never a bare `.toThrow()`, `rejects.toThrow()`,
`toThrow(ErrorClass)` or `.ok === false`. Those pass whatever threw, including a typo in the
fixture, a guard you were not aiming at, or a missing file. And every refusal the product can make
by refusing *everything* is paired with a control that succeeds, the way `solve-sandbox.test.ts`
pairs each OS refusal with a read the same policy admits: a wall that refuses everything passes a
suite of refusals while making the product unusable.

**A regression test must be seen failing.** Before committing the fix, reverse just the fix with
`git diff -- <src path> | git apply -R`, run the test, confirm it fails *for the intended reason*
(read the assertion message, not only the exit code), and reapply. A regression that never went
red proves the mock. Say in the commit what fails when the fix is reverted and how many tests that
is. One regression at the owner boundary covers the bug; do not replay the scenario at every layer
it crosses.

**Name the behaviour, not the incident.** The run, campaign or battery a regression came from
belongs in the commit message and the PR body, which are read against a settled history. A test
title or comment is read against a tree that keeps moving, and "(run w29)" tells the next reader
nothing the assertion does not. Existing incident tags are not a reason to touch a file.

**Prompts are tested as properties.** A model-visible surface is a condition identity, so a moved
literal changes a digest. Pin what the text must satisfy — a byte ceiling, each duty stated once,
no clause owned by another surface, no digit where a number would go stale, every placeholder
filled — as `builder-start-prompt.test.ts` does, and not one `toContain` per sentence, which only
proves the prompt is the prompt and makes it unrewritable.

## Junk patterns

The shared checklist: authoring rejects a new test that matches one, audit hunts for existing tests
that do. Each carries the shape it takes in this suite, so a sweep knows what to grep for.

- **Assertion-free coverage probes.** A test with no `expect(` — though read it first: many
  delegate to a helper that asserts (`pins()`, `accept()`, `checkIntent`, node `assert` in `.mjs`
  suites). A `toBeTruthy` or `toBeDefined` alone is nearly always this pattern.
- **Self-comparisons and identity copiers.** An expected value computed by the function under test
  or by its own module (`expect(x.id).toBe(idOf(x))` where `idOf` is the implementation). Distinct
  from an invariance check, `render(A) === render(B)`, which is a contract.
- **Copied inventories.** A test that restates a constant, an export list, a default object, a set
  of names or a count straight out of `src/` (`expect(BACKEND_KINDS).toEqual([...])`, a copied
  `DEFAULT_HARNESS_SETTINGS`, `toHaveLength(12)` on a lane list). It fails on every legitimate change
  and on no bug. Keep it only when a second, independent owner must agree —
  `thresholds.frozen.yaml`, a sentence in model-visible prose, the tool list the model actually sees.
- **Exact source, doc or import greps.** `readFileSync` of a file under `src/`, `tools/`, `.claude/`
  or `AGENTS.md` followed by `toContain` on a line of code. Keep the ones that pin a user-facing
  byte, a gate step order or a path that must exist; drop the ones that pin a spelling.
- **Tombstones.** `existsSync(removedModule)).toBe(false)` and "this call is never made again"
  scans after a cut. The repository keeps no backwards compatibility and a removed mechanism does
  not come back by accident. Keep one only when the removed thing was a leak or wall hazard, and
  then as a behavioural test of the boundary, not of the file's absence.
- **Private predicates tested beside their real boundary.** A unit test of a helper whose every
  branch the owner test already drives, differing only in call shape (a unit test of an exported
  pre-session check beside the `runBuilderCampaign` test that proves the same ceiling).
- **Duplicate invocations of one contract.** The same scenario under a different title in a sibling
  file of the same family, or an e2e file whose body is another's with a different table. Families
  split by owner module are fine; one contract spread over three files is not.
- **Local replays of shared fakes.** A hand-rolled `fakeEmbed`, `VerifierHostHandle`, `runTurn`,
  `fakeLaunchctl` or fake Codex that `doubles.ts` or a family helper already provides, or would if
  the third copy moved there.
- **Tests whose only purpose is keeping a test-only export alive,** and dead production code whose
  only callers are tests. The census below finds them.
- **Mocks that implement the asserted behaviour.** A `mock.module` or `spyOn` whose return value is
  what the assertion then reads back. A mock standing in for a real seam, whose output the code
  under test then transforms, is not this: check what the assertion reads before calling it junk.
- **Fixtures that supply what the owner should produce:** a receipt, an admission, a callback
  ordering, or persistence asserted against a store the path never writes.
- **Capability tests that restate a declared flag** instead of exercising the delivery the flag
  promises.
- **Negative controls that pass for an unrelated reason** — the bare-throw shapes above, or a denial
  from a different guard than the one the title names. Rule 12 names the same defect in a reject
  control that fails elsewhere but not on its named check.
- **Names that promise more than the input exercises,** such as a "retires the window" test
  asserting only that the window was not cleared, or a "hostile" case whose input is benign.

## Retention bar

Keep a test when it independently enforces a contract a reader of the product depends on. In this
repository these are the ones that look like junk and are not:

- **Rule-4 invariance tests.** Change only protected verifier detail and assert that the
  model-visible text or its digest is byte-identical: `diagnosis-reader.test.ts` (the model — it
  also moves a public input and asserts the digest *does* change, so the test cannot pass on a
  constant), `context-tool`, `author-findings`, `climb-history`, `climb-readout`,
  `fresh-candidate-contract`, `public-resources`, `iteration-memory`. They look like `render(A) ===
  render(B)`, and that is the contract. A new model-visible surface gets one, with the
  sensitivity half.
- **`harness-trial.test.ts`'s closed key set.** `PERMITTED_KEY_PATHS` freezes every model-visible
  key of a rehearsal result, so a new field fails by default. It is an inventory on purpose.
- **Threshold bindings.** `frozen-manifest-binding.test.ts` checks executable constants against
  `thresholds.frozen.yaml`; that is two owners agreeing, not a copy.
- **Prompt properties and byte ceilings** in `builder-start-prompt`, `starter-pack`,
  `pi-built-runtime`, and the delivery tests that compare a CLI's stdout with the producer it
  delivers (`sps-show-prompt-surfaces`), which assert delivery, not rendering.
- **Wall proofs.** Every executed refusal in `darwin-seatbelt`, `linux-bwrap-verifier`,
  `candidate-isolation-*`, `solve-sandbox`, `generated-worker-sandbox` and `built-bash`, even when
  another platform skips it; and their path-policy twins, which run everywhere.
- **Typed non-results and denominators** — `non-result-contract`, `case-record`, and the verbatim
  provider error strings pinned there, which are a regression on the wording itself.
- **Lint rule contracts.** Every `test/no-*`, `prefer-*`, `require-*`, `anti-slop-*` and
  `oxlint-*` suite, with its `REPORT` and `ADMITTED` fixture lines. They are how a rule is held to
  its targets, and the operator has held rule strictness where it is.
- **Tests `test-impact-and-consolidation` cannot see:** subprocess tests, configuration and document
  pins, and `@ts-expect-error` type-level pins, which fail the typecheck rather than the run.
- **Composition owners.** `gate-end-to-end`, `full-run-scripted-loop`, `climb-loop` and the
  `experiment-*.e2e` suites prove that stages compose with one fault producing one row. They are
  slow and look redundant with every unit test beneath them, and they are the only place that
  composition is checked. Prune the unit cases they fully subsume, never the composition.
- **Call ordering when order is observable,** regressions with a credible failure mode, and source
  inspection when it is the cheapest independent guard: it fails when the user-facing key, byte or
  path changes and survives an identifier-only rename.
- **A retained test that fails on the baseline.** Treat it as a possible product bug, reproduce it,
  and repair the owner rather than deleting it.

Static or slow is not a deletion reason. A test that resembles implementation may still be the
independent contract; prove otherwise before removing it.

## Audit mode

### Discovery

Keep it read-only and report evidence before editing. Start with the numbers the suite already
gives you, then read.

1. **Record the baseline.** Run the whole suite once in the tree you will edit and keep the log:
   files, pass, skip, fail, `expect()` calls and seconds. That count is what the audit is measured
   against at the end.
2. **Static census.** `bun .claude/skills/test-impact-and-consolidation/scripts/case-census.mjs`
   (with `REPO=<tree>`) reports duplicate titles, identical callbacks, import-subset pairs and helper
   names repeated across suites. Duplication in this suite rarely shows as copied titles; it shows as
   one contract under different titles in a family, so read the families it points at.
3. **Test-only exports.** For each export under `src/`, `tools/` and `vendor/`, count the files
   outside `test/` that spell its name, excluding the file that declares it. Zero means either dead
   production code or a seam kept for a test. Both are candidates, and the second is the more
   common: a predicate exported so a unit test can call it while the owner calls it privately.
4. **Pattern greps.** Bare throws (`toThrow()` with nothing inside, `toThrow(SomeError)`),
   `toBeTruthy`/`toBeDefined` as a test's only assertion, `readFileSync` of source followed by
   `toContain`, `existsSync(...)).toBe(false)`, `.toEqual([` on a constant imported from `src/`, and
   `mock.module`/`spyOn`.

For a broad sweep, run parallel read-only lanes with disjoint file sets, each with its own scratch
subdirectory. Partition by family, because families are where duplication lives:
`builder-campaign-*` and `builder-session-*`/`builder-execution-*`; `claim-*`, `solvability-*`,
`truth-probes-*` and `verification-runner-*`; `full-run-*`, `climb-*`, `experiment-*` and
`run-*`; `candidate-isolation-*` and the other wall suites; the skill-script suites (`sps-*`,
`wri-*`, `swarm-*`, `monitor-*`); and everything else. Leave the lint-rule suites out of the sweep.

### Candidate evidence

Record every field before editing. A missing field means the candidate is not ready:

- exact test name and `file:line`;
- what failure it can actually detect, stated as an edit to `src/` that would turn it red;
- the non-test callers of the production seam it covers;
- the stronger owner-boundary test that remains, and the case in it that catches the same edit —
  or, for a removal resting on overlap, the planted fault from `test-impact-and-consolidation`;
- relevant history: `git log --follow -- <test file>` and the commit that added the case;
- the production or test-support deletion it unlocks;
- risk and the focused validation command.

### Edit shape

Choose one coherent owner-boundary batch per commit. Delete obsolete test-only exports, wrappers
and dead production paths instead of keeping aliases — the repository keeps no backwards
compatibility — and inline a predicate that was exported only for its test. Move a retained
regression into its canonical owner file. Fold near-duplicate cases into an `it.each` row of the
owner. Move a fake written out a third time into `test/helpers/`. Strengthen a hostile case to name
its refusal instead of deleting it when the contract it aims at is real.

The audit should leave production simpler, not only the suite smaller. Measure the production
delta (nonblank lines and complexity) at each report and justify every production line that grew.
Do not add replacement tests that restate the same implementation, and do not turn an uncertain
candidate into a deletion to raise the count. A consolidation that loses a case is worse than one
that saves nothing, so confirm the suite's test count before and after, and account for every test
that left: deleted as junk, merged into a named row, or moved.

## Validation

Never edit while a test run is live in the same tree.

1. Run the edited files and their neighbours:
   `scripts/worktree.sh run <dir> bun run test -- <paths...>`, with the neighbours taken from
   `bun tools/runtime/affected-tests.ts --base <rev>`.
2. For a regression test, show the revert-fails, reapply-passes pair described above.
3. For a removed source grep or inventory, run the executable owner of the real contract.
4. When an export lost its last reader, run `bun tools/loc/source-policy.ts` whole, with no
   arguments — it ignores paths — and remove the `export` it names.
5. `bun run format`, `bun run lint -- --strict`, then `git diff --check`.
6. Run the full suite once at the end and compare it with the baseline: files, tests and seconds.
7. Inspect `git diff --numstat`; report production and tooling separately from tests and helpers.
8. Run `/code-review` on the finished diff.

Every published commit passes the gate on its own: the pre-push hook runs the static steps and the
affected tests over each earlier commit and the whole gate on the tip. A failure is fixed inside
the commit that caused it with `git commit --fixup=<sha>` and an autosquash rebase, never on top.

## Landing and continuation

Commit, push, open a PR or land only when authorised. Tests follow production onto the open PR
stack, and `stack-hop` owns publication. Land one coherent batch at a time; after it lands, refresh
from the current stack head and rerun read-only discovery for the next one.

## Handoff

Report, in prose that carries its own reasons:

- the baseline and final counts — files, tests, `expect()` calls, suite seconds;
- the categories removed, with one example each, and what now covers it;
- production owner simplifications and the production line and complexity delta;
- retained look-alikes and why each stays;
- focused and full proof actually run, and anything skipped;
- product bugs the audit surfaced, each with its owner, fixed or not;
- PR and merge state, and named follow-ups.

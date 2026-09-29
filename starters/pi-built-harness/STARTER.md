# Build the requested harness

The candidate is eight files: `correctness-model/brief.json`, `tasks.json`, `controls.json`,
`evaluator.ts` and `reference/index.ts`, and `agent/tools-spec.json`, `tools.ts` and
`BUILT_AGENTS.md`. Helper modules may sit beside them. Exact shapes are in
[`starter-pack/contract.md`](starter-pack/contract.md);
[`starter-pack/examples.md`](starter-pack/examples.md) holds optional worked examples whose
domain and method are not requirements. Presets are in `starter-pack/add-ons.json`.
You may change the harness's runtime settings in `agent/config.yaml`.

## Loop

1. Install the domain's tools under `.toolchain`; time one call of each.
2. Write the files and extend the seed tests, then run
   `.toolchain/bun --preserve-symlinks --no-env-file test correctness-model/harness.test.ts correctness-model/evaluator.test.ts`.
3. Begin with `harness_inspect readiness` and page every family. Once one task, an accept and the
   tools exist, `harness_trial` solves that task blind with your own agent, one measured case each.
   `correctness_check` runs every gate below without adopting, and reviews changed product bytes
   for some minutes.
4. `submit` freezes and gates the candidate; a refusal names the code and file to fix.
5. Keep findings in `MEMORY.md` and open questions in `SCRATCHPAD.md`. The `context` tool searches
   both, the measured batteries and passing solve traces.

## Gates

Preview and submit freeze one snapshot; each stage reports all its rows. A bundle refusal or an
unsettled stage stops the rest, and F2 runs beside the census unless conformance refused.

**1. Bundle contract.** Reads the eight files and validates the brief, tasks and controls against
each other. No timer.
- `missing-bundle-file`: every file above exists, is readable and, where it is JSON, parses.
- `tasks-shape`: `tasks.json` is a bare array of task rows, not `{"tasks": [...]}`.
- `shape-mismatch`: a row misses a field. A constant is
  `{"name": "maxShiftHours", "value": 8, "unit": "h", "authority": "Staff policy", "citation": "Section 2.1"}`.
- `tasks-exact-census`: the battery holds the number of tasks the round asks for.
- `brief-artifact-root-unread`: every `artifactSchema` root is under some check's `artifactPaths`,
  or a check reads `$`. A root no check reads measures nothing.
- `brief-cited-decision-withheld`: every id in a check's `citedDecisionIds` is a declared
  `ruleDecisions` row, and at least one of them has `visibility: public`.

**2. Conformance.** Typechecks and loads `agent/` and `correctness-model/`, opens every task
through the generated tools and runs each tool once. Walls: 30 s per module import and per tool
call.
- `generated-module-types`: a check takes `runtime` as its second argument or on the request;
  see the shape below.
- `generated-module-load`: `reference/` is bundled alone, so files there import only
  `reference/` and the public `@ana` packages. The evaluator may import `reference/` helpers.
- `tools-description-drift`: `agent/tools.ts` serves the exact description `tools-spec.json`
  declares.
- `task-worker-binding-drift`: the generated tools expose the same registration and tool schema
  for every task, because one solver serves the whole battery.

**3. Control census.** Runs every applicable check on each accept and only `expectedCheckId` on
each reject, four examples at a time with the installed tools, on a host that may be busy. Each
tool call gets a fresh empty home. This stage and F2 share one wall.
- `DISCRIMINATION_ACCEPT_REJECTED`: an accept fails a check. Fix the check or the brief. When the
  finding names `.toolchain`, that check's tool exited 126 or 127 and no run of it in the census
  exited 0 or wrote stdout, so it could not start in the cell: repair its install first.
- `DISCRIMINATION_NOT_PROVEN`: a check threw on an example, or an example names a task outside
  the battery.
- `DISCRIMINATION_REJECT_PASSED`: a reject did not fail the check its `expectedCheckId` names.
  Change the example so that check fails, or fix the check.
- `DISCRIMINATION_CHECK_UNREJECTED`: a check some task applies to is no reject's `expectedCheckId`.
  Add a reject that fails it.
- `DISCRIMINATION_PROBE_NO_VERDICT`: a check's tool run crashed on an example, so that example
  proves nothing. A tool the host itself could not start is the environment's, not yours.
- `controls-tool-timeout` (advisory): a timed-out run refuses nothing; an uncovered reject reruns
  once. If all of a check's rejects time out, `DISCRIMINATION_CHECK_TIMED_OUT` holds the claim.
- `EXTERNAL_RESULT_UNBOUND`: a check returned before its tool runs finished. Await every run.
- `EXTERNAL_VERDICT_UNGROUNDED`: a check that declares required tools passed without a completed
  run of one of them (`starter-pack/contract.md`); refused here, failed in F2, a non-result in the
  battery.

**4. F2 reference solve.** Resolves required tools, then builds every task's artifact with
`reference/index.ts` through the public submission path and runs the checks over it, four tasks
at a time, each within a per-task wall.
- `solvability-tool-missing`: every tool an external check names resolves under `.toolchain` or
  on the host PATH.
- `SOLVABILITY_CENSUS_BLOCKED`: every task's reference solve passes within its wall. Bound a
  search by a fixed iteration count, since a clock budget changes the answer between runs. A
  longer search, however long it runs, records its best artifact per task in a module under
  `reference/` for `solve` to return, so the wall bounds only the replay.
- `SOLVABILITY_INSTALLED_TOOLS_SUSPECT`: the same refusal, pointed at `.toolchain`. It comes when
  every check that applies rejected every task and none passed, or when an answer the checks now
  reject passed with the same bytes under other installed tools. Run each check's tool inside the
  verifier wall and repair that before changing `reference/`.

```ts
import type { CheckFn } from "@ana/correctness-model-bundle";
export const checks: Record<string, CheckFn> = {
  "assignments-match": async ({ artifact }, runtime) => {
    const rows = (artifact as { assignments?: unknown }).assignments;
    if (runtime === undefined || !Array.isArray(rows)) return false;
    return rows.length > 0;
  },
};
```

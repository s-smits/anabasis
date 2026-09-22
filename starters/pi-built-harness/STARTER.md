# Build the requested harness

The candidate is eight files: `correctness-model/brief.json`, `tasks.json`, `controls.json`,
`evaluator.ts` and `reference/index.ts`, and `agent/tools-spec.json`, `tools.ts` and
`BUILT_AGENTS.md`. Helper modules may sit beside them. Exact shapes are in
[`starter-pack/contract.md`](starter-pack/contract.md);
[`starter-pack/examples.md`](starter-pack/examples.md) holds optional worked examples whose
domain and method are not requirements. Presets are in `starter-pack/add-ons.json`.
You may change the harness's runtime settings in `agent/config.yaml`.

## How hard to make the tasks

Four tiers — easy, medium, hard, frontier — by what one answer has to hold at once, rising from
one published limit to a whole set of adversarial states the same answer must clear, and then to a
set the solver has to search rather than read off the brief, the guide or your tool text. Take the
first battery from the **frontier** row, above what you believe the harness handles.

A battery after the first moves the demand or repairs the last measurement. Adding tasks is
neither, and growing a probe to the full size is no exception: the probe measured the level, so the
expansion carries it onto every new task and moves from there.

Six domains at all four tiers, and what each side of a missed aim asks for:
[`starter-pack/difficulty-ladder.md`](starter-pack/difficulty-ladder.md).

## Loop

1. Install the domain's tools under `.toolchain`; time one call of each.
2. Write the files and extend the seed tests, then run
   `.toolchain/bun --preserve-symlinks --no-env-file test correctness-model/harness.test.ts correctness-model/evaluator.test.ts`.
3. Begin with `harness_inspect readiness` and page every family. As soon as one task, an accept
   and the tools exist, `harness_trial` solves that task blind with your own agent: the one
   measurement of how hard your battery is, six per round. A battery you do not measure is one
   the controller measures for you, a round at a time. `correctness_check` runs every gate below
   without adopting, and on changed product bytes also runs a review of several minutes.
4. Call `submit` once you are confident a clear `correctness_check` and your own checks are
   sufficient evidence; polish and the review note wait for the next round. A refusal names
   the code and file to fix. Previewing unchanged bytes is free.
5. Keep findings in `MEMORY.md` and open questions in `SCRATCHPAD.md`.

## Gates

Preview and submit freeze one snapshot; each stage reports all its rows. A bundle refusal or an
unsettled stage stops the rest, and F2 runs beside the census unless conformance refused.

**1. Bundle contract.** Reads the eight files. No timer.
- `missing-bundle-file`: every file above exists, is readable and, where it is JSON, parses.
- `tasks-shape`: `tasks.json` is a bare array of task rows, not `{"tasks": [...]}`.
- `operating-guide-shape`: the guide is non-empty, has the seed placeholder removed and stays
  under its byte cap.

**2. Validation.** Validates the brief, tasks and controls against each other. No timer.
- `shape-mismatch`: a row misses a field. A constant is
  `{"name": "maxShiftHours", "value": 8, "unit": "h", "authority": "Staff policy", "citation": "Section 2.1"}`.
- `brief-material-root-missing`, `brief-artifact-root-unread`: mark the deliverable root
  `"taskConditioned": true`, and name every root in some check's `artifactPaths`.

**3. Conformance.** Typechecks and loads `agent/` and `correctness-model/`, opens every task
through the generated tools and runs each tool once. Walls: 30 s per module import and per tool
call.
- `generated-module-types`: a check takes `runtime` as its second argument or on the request;
  see the shape below.
- `generated-module-load`: `reference/` is bundled alone, so files there import only
  `reference/` and the public `@ana` packages. The evaluator may import `reference/` helpers.
- `tools-description-drift`: `agent/tools.ts` serves the exact description `tools-spec.json`
  declares.

**4. Control census.** Runs every applicable check on each accept and only `expectedCheckId` on
each reject, four examples at a time with the installed tools, on a host that may be busy. Each
tool call gets a fresh empty home. This stage and F2 share one wall.
- `DISCRIMINATION_REJECT_PASSED`: a reject passed the check it names. Change one fact of that
  task's accept so the check fails, or fix the check.
- `DISCRIMINATION_ACCEPT_REJECTED`: an accept fails a check. Fix the check or the brief.
- `DISCRIMINATION_CONTROL_RECEIPT_INVALID`: receipts match declarations: accepts pass, rejects
  fail their named check, and no hidden row belongs to a check declaring `"hidden": "none"`.

**5. Grounding.** Reads the tool runs the census recorded. No timer.
- `external-check-tool-unlaunched`: the check calls `runtime.tools.run` for its declared tool.
- `generated-external-grounding-unexecuted`: every example completes a run of each required tool
  before the check returns. A check may not return early on some examples and call the tool for
  others.

**6. F2 reference solve.** Resolves required tools, then builds every task's artifact with
`reference/index.ts` through the public submission path and runs the checks over it, four tasks
at a time, each within a per-task wall.
- `solvability-tool-self-authored`: a required executable that is your own file belongs to
  `{"kind": "authored"}` evidence.
- `solvability-tool-program-argument`: external evidence passes no multi-line argument and none
  over 256 bytes; operands go in files or stdin.
- `SOLVABILITY_CENSUS_BLOCKED`: every task's reference solve passes within its wall. Bound a
  search by a fixed iteration count, since a clock budget changes the answer between runs. A
  longer search, still minutes per task, records its best artifact per task in a module under
  `reference/` for `solve` to return, so the wall bounds the replay and not the limit.
The first two arrive upper-case with underscores.

**7. Family transplant.** Moves each accepted `taskConditioned` root into its sibling tasks and
runs the checks that read it.
- `TASK_FAMILY_UNIVERSAL_WITNESS`: some sibling's material check refuses the moved deliverable.
- `TASK_FAMILY_BINDING_UNPROVEN`: a material check runs each required tool to completion, then
  returns `false` for a deliverable that does not fit; it neither throws nor returns before the
  run.

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

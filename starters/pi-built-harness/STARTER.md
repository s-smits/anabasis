# Build the requested harness

The candidate is eight files: `correctness-model/brief.json`, `tasks.json`, `controls.json`,
`evaluator.ts` and `reference/index.ts`, and `agent/tools-spec.json`, `tools.ts` and
`BUILT_AGENTS.md`. Helper modules may sit beside them. Exact shapes are in
[`starter-pack/contract.md`](starter-pack/contract.md);
[`starter-pack/examples.md`](starter-pack/examples.md) holds optional worked examples whose
domain and method are not requirements. Presets are in `starter-pack/add-ons.json`.
You may change the harness's runtime settings in `agent/config.yaml`.

## How hard to make the tasks

A task is as hard as what one answer has to hold at once: one limit, then several sharing something
finite, then adversarial states the same answer must clear, then — **frontier**, where the first
battery starts — a set the solver must find rather than read off the brief, the guide or your
tools. Six domains at all four tiers, and what each side of a missed aim asks for:
[`starter-pack/difficulty-ladder.md`](starter-pack/difficulty-ladder.md).

## Loop

1. Install the domain's tools under `.toolchain`; time one call of each.
2. Write the files and extend the seed tests, then run
   `.toolchain/bun --preserve-symlinks --no-env-file test correctness-model/harness.test.ts correctness-model/evaluator.test.ts`.
3. Begin with `harness_inspect readiness` and page every family. Once one task, an accept and the
   tools exist, `harness_trial` solves that task blind with your own agent, one measured case each.
   `correctness_check` runs every gate below without adopting, and reviews changed product bytes
   for some minutes.
4. `submit` freezes and gates the candidate; a refusal names the code and file to fix.
5. Keep findings in `MEMORY.md` and open questions in `SCRATCHPAD.md`; the `context` tool searches
   them, the round plan, measured batteries and passing solve traces.

## Gates

Preview and submit freeze one snapshot; each stage reports all its rows. A bundle refusal or an
unsettled stage stops the rest, and F2 runs beside the census unless conformance refused.

**1. Bundle contract.** Reads the eight files. No timer.
- `missing-bundle-file`: every file above exists, is readable and, where it is JSON, parses.
- `tasks-shape`: `tasks.json` is a bare array of task rows, not `{"tasks": [...]}`.

**2. Validation.** Validates the brief, tasks and controls against each other. No timer.
- `shape-mismatch`: a row misses a field. A constant is
  `{"name": "maxShiftHours", "value": 8, "unit": "h", "authority": "Staff policy", "citation": "Section 2.1"}`.
- `tasks-exact-census`: the battery holds the number of tasks the round asks for.

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
- `DISCRIMINATION_ACCEPT_REJECTED`: an accept fails a check. Fix the check or the brief.
- `DISCRIMINATION_NOT_PROVEN`: a check threw on an example, or an example names a task outside
  the battery.

**5. F2 reference solve.** Resolves required tools, then builds every task's artifact with
`reference/index.ts` through the public submission path and runs the checks over it, four tasks
at a time, each within a per-task wall.
- `solvability-tool-missing`: every tool an external check names resolves under `.toolchain` or
  on the host PATH.
- `SOLVABILITY_CENSUS_BLOCKED`: every task's reference solve passes within its wall. Bound a
  search by a fixed iteration count, since a clock budget changes the answer between runs. A
  longer search, however long it runs, records its best artifact per task in a module under
  `reference/` for `solve` to return, so the wall bounds only the replay.

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

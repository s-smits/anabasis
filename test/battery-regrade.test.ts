/**
 * An evaluation correction after a battery at or above the aim regrades that battery's recorded
 * solves under the corrected evaluator instead of paying the Built solver to write the same
 * artifacts again. Two rounds, no provider: round one builds and measures, round two submits one
 * change and is measured. The solver counts its calls per battery, so "no solve" is a count of zero
 * rather than an inference from timing.
 */
import { PLAN_FIELDS } from "./helpers/experiment-plan.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import type { BuilderCommandGuardResult } from "../src/builder/command-guard.ts";
import { EMPTY_USER_CONTEXT } from "../src/builder/user-context.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { analyseStep } from "../src/run/analyse-step.ts";
import { type FullRunDeps, parseFullRunArgs, runFullRun, slugForDirectInput } from "../src/run/full-run.ts";
import { buildHarness } from "../src/run/harness-build.ts";
import { measureHarness } from "../src/run/harness-measure.ts";
import { measuredProductDir } from "../src/run/product-versions.ts";
import type { Solver } from "../src/correctness-bundle/solve.ts";
import { readRecordedBatteryRecord } from "../src/correctness-bundle/battery-record.ts";
import { required } from "./helpers/doubles.ts";
import { builtSession, fullFakeHost, probeEvidence } from "./helpers/measure-doubles.ts";
import { scriptedBuilderRuntime } from "./helpers/scripted-builder-runtime.ts";
import { writeFixtureThresholds } from "./helpers/thresholds.ts";
import {
  UPPERCASE_TASK_INPUTS,
  scriptedUppercaseSolver,
  uppercaseFixture,
} from "./helpers/uppercase-fixture.ts";

/** What round two changes: the evaluator, the public inputs, or both. */
interface SecondRound {
  evaluator?: string;
  inputs?: readonly string[];
  /** A new wording for the one public validity rule the solver reads. */
  assertion?: string;
}

const PROMPT = "Build a harness that uppercases one public input.";
const TASKS = 6;
const SLUG = slugForDirectInput(PROMPT, EMPTY_USER_CONTEXT.digest);
/** The correction: the answer is compared without regard to case, so an answer left in lower case
 *  that the first evaluator failed now passes. */
const CASE_BLIND_EVALUATOR =
  "export const checks = { answer: ({artifact, publicTask}) => String(Array.isArray(artifact.answer) && artifact.answer.length === 1 ? artifact.answer[0] : artifact.answer).toUpperCase() === publicTask.publicInput.input.toUpperCase() };";

const scratch: string[] = [];
const guard: BuilderCommandGuardResult = {
  state: "skipped",
  path: null,
  dcgVersion: null,
  binarySha256: null,
  skippedReason: "explicit-off",
};

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratchRepo(): string {
  mkdirSync(join(import.meta.dir, "..", ".scratch"), { recursive: true });
  const root = mkdtempSync(join(import.meta.dir, "..", ".scratch", "ana-regrade-"));
  scratch.push(root);
  writeFixtureThresholds(root);
  writeFileSync(join(root, ".env"), "CODEX_BUILT_MODEL=gpt-5.5\n");
  return root;
}

function writeTasks(workspace: string, inputs: readonly string[]): void {
  const put = (path: string, value: JsonValue) => writeFileSync(join(workspace, path), JSON.stringify(value));
  put(
    "correctness-model/tasks.json",
    inputs.map((input, index) => ({
      taskId: `t${index}`,
      family: index < 2 ? "first" : "second",
      intendedFeatures: { hiddenChecks: { min: 0, max: 0 } },
      publicInput: { input, length: input.length },
      difficultyAxisPath: "$.length",
      hidden: [],
    })),
  );
  put("correctness-model/controls.json", {
    accept: Array.from({ length: 25 }, (_, i) => ({
      id: `accept-${i}`,
      taskId: `t${i % inputs.length}`,
      artifact: { answer: inputs[i % inputs.length]!.toUpperCase() },
    })),
    reject: Array.from({ length: 25 }, (_, i) => ({
      id: `reject-${i}`,
      taskId: `t${i % inputs.length}`,
      artifact: { answer: "" },
      mutationClass: "hollow",
      expectedCheckId: "answer",
    })),
  });
}

/** Two rounds with the fixed flubbing solver, the second applying `second`. Returns each battery's
 *  solver calls, its passes and its regrade fact. */
async function twoRounds(flub: ReadonlySet<string>, second: SecondRound) {
  const root = scratchRepo();
  const calls = new Map<string, number>();
  const solverFor =
    (runId: string): Solver =>
    async (task, toolset, submitted) => {
      calls.set(runId, (calls.get(runId) ?? 0) + 1);
      return scriptedUppercaseSolver(flub)(task, toolset, submitted);
    };
  const drive: FullRunDeps["drive"] = (manifest, options) =>
    measureHarness(manifest, {
      ...options,
      solver: solverFor(options.runId),
      createVerifier: () => fullFakeHost(),
      isolationProbe: () => probeEvidence(true),
      sessionProbe: async () => builtSession(),
      judge: null,
    });
  let round = -1;
  const builderRuntime = scriptedBuilderRuntime(async (ctx) => {
    if (ctx.turn === 1) round += 1;
    if (round === 0) {
      uppercaseFixture(ctx.workspace, false, false, TASKS);
      writeTasks(ctx.workspace, UPPERCASE_TASK_INPUTS);
    } else {
      if (second.evaluator !== undefined) {
        writeFileSync(join(ctx.workspace, "correctness-model/evaluator.ts"), second.evaluator);
      }
      if (second.inputs !== undefined) writeTasks(ctx.workspace, second.inputs);
      if (second.assertion !== undefined) {
        const file = join(ctx.workspace, "correctness-model/brief.json");
        const brief = JSON.parse(readFileSync(file, "utf8"));
        brief.truthChecks[0].assertion = second.assertion;
        writeFileSync(file, JSON.stringify(brief));
      }
      writeFileSync(
        join(ctx.workspace, "EXPERIMENT.json"),
        JSON.stringify({
          scope: "product",
          gap: "the evaluator failed an answer the request accepts",
          change: "compare the answer without regard to case",
          ...PLAN_FIELDS,
          expectedResult: "the same artifacts score at least as well",
          target: { comparator: "at-least", verifiedPasses: TASKS - flub.size },
        }),
      );
    }
    await ctx.call("submit", {});
    return "submitted";
  });
  const { repoRoot, ...runArgs } = {
    ...parseFullRunArgs([
      "--prompt",
      PROMPT,
      "--project",
      SLUG,
      "--run",
      "rg",
      "--dcg",
      "false",
      "--max-iterations",
      "2",
      "--max-builder-turns",
      "2",
      "--expected-tasks",
      String(TASKS),
      "--built-backend",
      "codex",
      "--review-backend",
      "disabled",
    ]),
    repoRoot: root,
  };
  const outcome = await runFullRun(runArgs, repoRoot, {
    ensureDcg: () => guard,
    build: (manifest, options) => buildHarness(manifest, { ...options, builderRuntime }),
    drive,
    analyse: analyseStep,
  });
  const batteries = outcome.rounds.map((row) => {
    const dir = required(measuredProductDir(root, SLUG, row.runId), `no product bound to ${row.runId}`);
    const battery = readRecordedBatteryRecord(join(dir, "runs", row.runId), row.runId);
    return {
      runId: row.runId,
      solves: calls.get(row.runId) ?? 0,
      passes: battery.cases.map((c) => c.pass),
      regrade: battery.regrade ?? null,
    };
  });
  return { outcome, batteries };
}

describe("an evaluation correction regrades instead of re-solving", () => {
  it("after a battery above the aim, schedules no solve and records the pass the correction flipped", async () => {
    const { outcome, batteries } = await twoRounds(new Set(["t5"]), { evaluator: CASE_BLIND_EVALUATOR });
    expect(outcome.rounds.map((row) => [row.move, row.build])).toEqual([
      ["build", "adopted"],
      ["rebuild", "candidate"],
    ]);
    const [first, second] = batteries;
    expect(first?.solves).toBe(TASKS);
    expect(first?.passes).toEqual([true, true, true, true, true, false]);
    expect(second).toEqual({
      runId: "rg-i02",
      solves: 0,
      passes: [true, true, true, true, true, true],
      regrade: { of: "rg", reused: TASKS, changedPasses: 1 },
    });
  }, 180_000);

  it("after a battery below the aim, still measures a fresh battery", async () => {
    const { batteries } = await twoRounds(new Set(["t1", "t2", "t3", "t4", "t5"]), {
      evaluator: CASE_BLIND_EVALUATOR,
    });
    expect(batteries.map((row) => [row.solves, row.regrade])).toEqual([
      [TASKS, null],
      [TASKS, null],
    ]);
  }, 180_000);

  it("a task probe after a battery above the aim still measures a full battery", async () => {
    const inputs = [...UPPERCASE_TASK_INPUTS.slice(0, 5), "gh"];
    const { batteries } = await twoRounds(new Set(["t5"]), { inputs });
    expect(batteries.map((row) => [row.solves, row.regrade])).toEqual([
      [TASKS, null],
      [TASKS, null],
    ]);
  }, 180_000);

  it("a correction that also rewrites the public rule the solver reads measures a full battery", async () => {
    const { batteries } = await twoRounds(new Set(["t5"]), {
      evaluator: CASE_BLIND_EVALUATOR,
      assertion: "The answer equals the input in upper case, compared without regard to case.",
    });
    expect(batteries.map((row) => [row.solves, row.regrade])).toEqual([
      [TASKS, null],
      [TASKS, null],
    ]);
  }, 180_000);

  it("a correction that also moves one task measures a full battery", async () => {
    const inputs = [...UPPERCASE_TASK_INPUTS.slice(0, 5), "gh"];
    const { batteries } = await twoRounds(new Set(["t5"]), { evaluator: CASE_BLIND_EVALUATOR, inputs });
    expect(batteries.map((row) => [row.solves, row.regrade])).toEqual([
      [TASKS, null],
      [TASKS, null],
    ]);
  }, 180_000);
});

/**
 * A battery that grades recorded solves instead of paying the Built solver to write the same
 * artifacts again: an evaluation correction after a battery at or above the aim regrades all of
 * them, and a battery the environment cut short re-solves only its censored cases. Two rounds, no
 * provider: round one builds and measures, round two submits one change or remeasures. The solver
 * counts its calls per battery, so "no solve" is a count of zero rather than an inference from
 * timing.
 */
import { afterEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import type { BuilderCommandGuardResult } from "../src/builder/command-guard.ts";
import { EMPTY_USER_CONTEXT } from "../src/builder/user-context.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import type { JudgeSession } from "../src/review/judge.ts";
import { analyseStep } from "../src/run/analyse-step.ts";
import { type FullRunDeps, parseFullRunArgs, runFullRun, slugForDirectInput } from "../src/run/full-run.ts";
import { buildHarness } from "../src/run/harness-build.ts";
import { type HarnessMeasureOptions, measureHarness } from "../src/run/harness-measure.ts";
import { measuredProductDir } from "../src/run/product-versions.ts";
import { type Solver, nonResultOutcome } from "../src/correctness-bundle/solve.ts";
import { readRecordedBatteryRecord } from "../src/correctness-bundle/battery-record.ts";
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
  /** A program round two adds to the tool tree the solver's shell runs first on PATH. */
  toolchainProgram?: string;
  /** The Judge round two's battery is handed. */
  judge?: JudgeSession;
}

/** Where the first battery's solving condition differs from the run's Built slot: the effort its
 *  session reported, or the check's instrument withheld from its shell. */
interface FirstBattery {
  effort?: string;
  withheld?: true;
}

/** How the solver meets one task of one battery: the right answer, the input unchanged, a provider
 *  non-result, or an attempt that never submits. */
type Answer = "right" | "flub" | "provider" | "silent";

const PROMPT = "Build a harness that uppercases one public input.";
const TASKS = 6;
const SLUG = slugForDirectInput(PROMPT, EMPTY_USER_CONTEXT.digest);
/** The correction: the answer is compared without regard to case, so an answer left in lower case
 *  that the first evaluator failed now passes. */
const CASE_BLIND_EVALUATOR =
  "export const checks = { answer: ({artifact, publicTask}) => String(Array.isArray(artifact.answer) && artifact.answer.length === 1 ? artifact.answer[0] : artifact.answer).toUpperCase() === publicTask.publicInput.input.toUpperCase() };";

/** The same correction for a check that also runs its tool-tree instrument. */
const CASE_BLIND_TOOL_EVALUATOR =
  'export const checks = { answer: async ({artifact, publicTask}, runtime) => { const result = await runtime.tools.run({ toolId: "uppercase-fixture", args: [] }); return result.exitCode === 0 && String(artifact.answer).toUpperCase() === publicTask.publicInput.input.toUpperCase(); } };';

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

/** An executable program in the workspace's tool tree. */
function putProgram(workspace: string, name: string): void {
  mkdirSync(join(workspace, ".toolchain/bin"), { recursive: true });
  writeFileSync(join(workspace, ".toolchain/bin", name), "#!/bin/sh\nexit 0\n");
  chmodSync(join(workspace, ".toolchain/bin", name), 0o755);
}

/** The first battery answers every task in `flub` with its input unchanged and the rest right. */
function flubbing(flub: ReadonlySet<string>): (runId: string, taskId: string) => Answer {
  return (_runId, taskId) => (flub.has(taskId) ? "flub" : "right");
}

/** Two rounds, the solver answering each battery's task as `answer` says and the second round
 *  applying `second`. Returns each battery's solver calls, its passes and its regrade fact. */
async function twoRounds(
  answer: (runId: string, taskId: string) => Answer,
  second: SecondRound = {},
  first: FirstBattery = {},
) {
  const root = scratchRepo();
  const calls = new Map<string, number>();
  const solverFor =
    (runId: string): Solver =>
    async (task, toolset, submitted) => {
      calls.set(runId, (calls.get(runId) ?? 0) + 1);
      const kind = answer(runId, task.taskId);
      if (kind === "provider") return nonResultOutcome({ kind: "provider", message: "usage limit reached" });
      if (kind === "silent") return { turns: 1, completedTurns: 0, errors: [], runtimeIdentities: [] };
      return scriptedUppercaseSolver(new Set(kind === "flub" ? [task.taskId] : []))(task, toolset, submitted);
    };
  const drive: FullRunDeps["drive"] = (manifest, options) => {
    const firstBattery = options.runId === "rg";
    const built = options.resolvedSlots?.built;
    const measured: HarnessMeasureOptions = {
      ...options,
      solver: solverFor(options.runId),
      isolationProbe: () => probeEvidence(true),
      sessionProbe: async () => ({
        ...builtSession(),
        reasoningEffort: (firstBattery ? first.effort : undefined) ?? built?.reasoningEffort ?? "medium",
      }),
      judge: firstBattery ? null : (second.judge ?? null),
    };
    // A check that runs its instrument needs the real host; the double runs no tool.
    if (first.withheld !== true) measured.createVerifier = () => fullFakeHost();
    if (
      firstBattery &&
      first.withheld === true &&
      options.resolvedSlots !== undefined &&
      built !== undefined
    ) {
      measured.resolvedSlots = { ...options.resolvedSlots, built: { ...built, withholdInstruments: true } };
    }
    return measureHarness(manifest, measured);
  };
  const submits: string[] = [];
  let round = -1;
  const builderRuntime = scriptedBuilderRuntime(async (ctx) => {
    if (ctx.turn === 1) round += 1;
    if (round === 0) {
      // The instrument the launch withholds is the fixture's own tool-tree program, which its check
      // runs.
      uppercaseFixture(ctx.workspace, false, first.withheld === true, TASKS);
      writeTasks(ctx.workspace, UPPERCASE_TASK_INPUTS);
    } else {
      if (second.evaluator !== undefined) {
        writeFileSync(join(ctx.workspace, "correctness-model/evaluator.ts"), second.evaluator);
      }
      if (second.inputs !== undefined) writeTasks(ctx.workspace, second.inputs);
      if (second.toolchainProgram !== undefined) putProgram(ctx.workspace, second.toolchainProgram);
      if (second.assertion !== undefined) {
        const file = join(ctx.workspace, "correctness-model/brief.json");
        const brief = JSON.parse(readFileSync(file, "utf8"));
        brief.truthChecks[0].assertion = second.assertion;
        writeFileSync(file, JSON.stringify(brief));
      }
      writeFileSync(
        join(ctx.workspace, "EXPERIMENT.json"),
        JSON.stringify({
          gap: "the evaluator failed an answer the request accepts",
          change: "compare the answer without regard to case",
          families: [],
        }),
      );
    }
    const result = await ctx.call("submit", {});
    submits.push(result.content.map((part) => (part.type === "text" ? part.text : "")).join(""));
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
  const batteries = outcome.rounds.flatMap((row) => {
    const dir = measuredProductDir(root, SLUG, row.runId);
    if (dir === null) return [];
    const battery = readRecordedBatteryRecord(join(dir, "runs", row.runId), row.runId);
    return [
      {
        runId: row.runId,
        solves: calls.get(row.runId) ?? 0,
        passes: battery.cases.map((c) => c.pass),
        regrade: battery.regrade ?? null,
      },
    ];
  });
  const withheld = outcome.rounds.flatMap((row) => {
    const dir = measuredProductDir(root, SLUG, row.runId);
    return dir === null
      ? []
      : readRecordedBatteryRecord(join(dir, "runs", row.runId), row.runId).condition.advisorsRemoved;
  });
  return { outcome, batteries, calls, submits, withheld };
}

describe("an evaluation correction regrades instead of re-solving", () => {
  it("after a battery above the aim, schedules no solve and records the pass the correction flipped", async () => {
    const { outcome, batteries } = await twoRounds(flubbing(new Set(["t5"])), {
      evaluator: CASE_BLIND_EVALUATOR,
    });
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
    const { batteries } = await twoRounds(flubbing(new Set(["t1", "t2", "t3", "t4", "t5"])), {
      evaluator: CASE_BLIND_EVALUATOR,
    });
    expect(batteries.map((row) => [row.solves, row.regrade])).toEqual([
      [TASKS, null],
      [TASKS, null],
    ]);
  }, 180_000);

  it("a task probe after a battery above the aim still measures a full battery", async () => {
    const inputs = [...UPPERCASE_TASK_INPUTS.slice(0, 5), "gh"];
    const { batteries } = await twoRounds(flubbing(new Set(["t5"])), { inputs });
    expect(batteries.map((row) => [row.solves, row.regrade])).toEqual([
      [TASKS, null],
      [TASKS, null],
    ]);
  }, 180_000);

  it("a correction that also rewrites the public rule the solver reads measures a full battery", async () => {
    const { batteries } = await twoRounds(flubbing(new Set(["t5"])), {
      evaluator: CASE_BLIND_EVALUATOR,
      assertion: "The answer equals the input in upper case, compared without regard to case.",
    });
    expect(batteries.map((row) => [row.solves, row.regrade])).toEqual([
      [TASKS, null],
      [TASKS, null],
    ]);
  }, 180_000);

  describe("measures a fresh battery when only the solver's own condition moved", () => {
    const fresh = [
      [TASKS, null],
      [TASKS, null],
    ];
    it("the Built reasoning effort the recorded solves ran under", async () => {
      const { batteries } = await twoRounds(
        flubbing(new Set(["t5"])),
        { evaluator: CASE_BLIND_EVALUATOR },
        { effort: "minimal" },
      );
      expect(batteries.map((row) => [row.solves, row.regrade])).toEqual(fresh);
    }, 180_000);

    it("the check instrument withheld from the recorded solves' shell", async () => {
      const { batteries, withheld } = await twoRounds(
        flubbing(new Set(["t5"])),
        { evaluator: CASE_BLIND_TOOL_EVALUATOR },
        { withheld: true },
      );
      expect(withheld).toEqual(["instrument:uppercase-fixture"]);
      expect(batteries.map((row) => [row.solves, row.regrade])).toEqual(fresh);
    }, 180_000);

    it("a program added to the tool tree the solver's shell runs", async () => {
      const { batteries } = await twoRounds(flubbing(new Set(["t5"])), {
        evaluator: CASE_BLIND_EVALUATOR,
        toolchainProgram: "analyser",
      });
      expect(batteries.map((row) => [row.solves, row.regrade])).toEqual(fresh);
    }, 180_000);
  });

  it("keeps the configured Judge on the regrade, which saves only the solves", async () => {
    let reviews = 0;
    const judge: JudgeSession = {
      pin: "codex/scripted-judge",
      promptPolicyDigest: "a".repeat(64),
      invoke: async () => {
        reviews += 1;
        return {
          verdict: true,
          abstained: false,
          rationale: "matches",
          rules: [],
          error: null,
          errorKind: null,
          turns: 1,
        };
      },
    };
    const { batteries } = await twoRounds(flubbing(new Set(["t5"])), {
      evaluator: CASE_BLIND_EVALUATOR,
      judge,
    });
    expect(batteries.map((row) => [row.solves, row.regrade?.reused ?? null])).toEqual([
      [TASKS, null],
      [0, TASKS],
    ]);
    expect(reviews).toBeGreaterThan(0);
  }, 180_000);

  it("a correction that also moves one task measures a full battery", async () => {
    const inputs = [...UPPERCASE_TASK_INPUTS.slice(0, 5), "gh"];
    const { batteries } = await twoRounds(flubbing(new Set(["t5"])), {
      evaluator: CASE_BLIND_EVALUATOR,
      inputs,
    });
    expect(batteries.map((row) => [row.solves, row.regrade])).toEqual([
      [TASKS, null],
      [TASKS, null],
    ]);
  }, 180_000);
});

describe("a battery the environment cut short is remeasured before any rebuild", () => {
  const censored = (runId: string, taskId: string): Answer =>
    runId === "rg" && (taskId === "t4" || taskId === "t5") ? "provider" : "right";

  it("re-solves exactly the two provider non-results on unchanged bytes and regrades the other four", async () => {
    const { outcome, batteries } = await twoRounds(censored);
    expect(outcome.rounds.map((row) => [row.move, row.build])).toEqual([
      ["build", "adopted"],
      ["measure", "reused"],
    ]);
    const [first, second] = batteries;
    expect(first?.passes).toEqual([true, true, true, true, null, null]);
    expect(second).toEqual({
      runId: "rg-i02",
      solves: 2,
      passes: [true, true, true, true, true, true],
      regrade: { of: "rg", reused: 4, changedPasses: 0 },
    });
  }, 180_000);

  it("rebuilds when the censored battery solved under another Built effort", async () => {
    // Regrading four solves made at one effort beside two made at another would score one battery
    // under two conditions, so the round goes to the Builder instead.
    const { outcome, batteries } = await twoRounds(censored, {}, { effort: "minimal" });
    expect(outcome.rounds.map((row) => row.move)).toEqual(["build", "rebuild"]);
    expect(batteries.map((row) => row.regrade)).toEqual(batteries.map(() => null));
  }, 180_000);

  it("rebuilds when the two cases were unaccepted attempts rather than non-results", async () => {
    const silent = (runId: string, taskId: string): Answer =>
      runId === "rg" && (taskId === "t4" || taskId === "t5") ? "silent" : "right";
    const { outcome } = await twoRounds(silent);
    expect(outcome.rounds.map((row) => row.move)).toEqual(["build", "rebuild"]);
  }, 180_000);
});

describe("an identical exam after a battery at or above the aim", () => {
  it("is returned to the Builder with its typed clause and buys no second battery", async () => {
    const { outcome, batteries, calls, submits } = await twoRounds(flubbing(new Set()));
    expect(batteries.map((row) => row.runId)).toEqual(["rg"]);
    expect(submits.at(-1)).toContain("identical-exam-over-aim");
    expect(submits.at(-1)).toContain("not counted as a strike");
    expect(calls.get("rg-i02")).toBeUndefined();
    expect(outcome.rounds.at(-1)?.build).toBe("build-failed");
  }, 180_000);

  it("measures a fresh battery when one public task input moved", async () => {
    const inputs = [...UPPERCASE_TASK_INPUTS.slice(0, 5), "gh"];
    const { batteries } = await twoRounds(flubbing(new Set()), { inputs });
    expect(batteries.map((row) => row.solves)).toEqual([TASKS, TASKS]);
  }, 180_000);

  it("measures a fresh battery when the identical exam follows a battery below the aim", async () => {
    const { batteries } = await twoRounds(flubbing(new Set(["t1", "t2", "t3", "t4", "t5"])));
    expect(batteries.map((row) => row.solves)).toEqual([TASKS, TASKS]);
  }, 180_000);
});

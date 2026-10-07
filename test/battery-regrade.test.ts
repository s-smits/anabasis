/**
 * A battery that grades recorded solves instead of paying the Built solver to write the same
 * artifacts again.
 *
 * Hypothesis: one reading decides every reuse. A recorded solve is regraded exactly when it still
 * poses this candidate's exam — the same agent bytes, the same solving condition, the same public
 * task bytes and public rules — and did not end in an environment non-result; every other task is
 * solved. The round's operation decides only whether reuse applies at all (an evaluation
 * correction, a task probe or a remeasure, never a repeat), so a correction that also moves a task,
 * and a probe over a battery holding an unaccepted attempt, reuse what they still pose instead of
 * each paying for a full battery.
 *
 * A verified fail is solved again on unchanged bytes, each time in a remeasure that regrades the
 * other tasks, while every solve in its group has failed and there are fewer than three. A group is
 * the exam that task poses: its own bytes, the agent, the correctness model and the tool tree, under
 * one pin, run condition and effort. The other tasks' bytes are not part of it. So a correction
 * after a fail the solver repeats is the fourth battery, not the second.
 *
 * No provider: round one builds and measures, a later round submits one change or remeasures. The
 * solver counts its calls per battery, so "no solve" is a count of zero rather than an inference
 * from timing.
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
import { type FullRunDeps, runFullRun } from "../src/run/full-run.ts";
import { parseFullRunArgs } from "../src/run/launch-arguments.ts";
import { slugForDirectInput } from "../src/run/launch-project.ts";
import { buildHarness } from "../src/run/harness-build.ts";
import { type HarnessMeasureOptions, measureHarness } from "../src/run/harness-measure.ts";
import { measuredProductDir, productVersionDir, selectedProductDir } from "../src/run/product-versions.ts";
import { readClimbReadout } from "../src/run/climb-readout.ts";
import { type Solver, nonResultOutcome } from "../src/correctness-bundle/solve.ts";
import { readRecordedBatteryRecord, toolTreeDigestOf } from "../src/correctness-bundle/battery-record.ts";
import { bundleSnapshotToolTree } from "../src/claim/bundle-snapshot.ts";
import type { RunCondition } from "../src/claim/case-record.ts";
import { solverConditionMoved } from "../src/run/battery-reuse.ts";
import { batteryCondition } from "../src/run/run-driver.ts";
import { builtSession, fullFakeHost, probeEvidence } from "./helpers/measure-doubles.ts";
import { writeSettledReview } from "./helpers/review-fixtures.ts";
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
  /** Round two submits its entry tree as it found it, without even a note. */
  bare?: true;
  /** A line round two adds to the Built agent's instructions: a harness change. */
  agent?: string;
}

/** Where the first battery's solving condition differs from the run's Built slot: the effort its
 *  session reported, or the check's instrument withheld from its shell. */
interface FirstBattery {
  effort?: string;
  withheld?: true;
  /** The cases the first battery's completed review settles against the one check that decided each. */
  settled?: readonly string[];
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

/** The two remeasures that confirm a fail of t5 in battery "rg", each solving t5 alone. */
const CONFIRMED_T5 = [
  [1, { of: "rg", reused: 5, changedPasses: 0 }],
  [1, { of: "rg-i02", reused: 5, changedPasses: 0 }],
];

const scratch: string[] = [];
const guard: BuilderCommandGuardResult = { state: "skipped", path: null, skippedReason: "not-installed" };

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

/** The Builder's two rounds, the solver answering each battery's task as `answer` says and the
 *  second round applying `second`, with `remeasures` rounds more for the controller's remeasures
 *  between or after them. Returns each battery's solver calls, its passes and its regrade fact. */
async function twoRounds(
  answer: (runId: string, taskId: string) => Answer,
  second: SecondRound = {},
  first: FirstBattery = {},
  remeasures = 0,
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
      if (second.agent !== undefined) {
        writeFileSync(join(ctx.workspace, "agent/BUILT_AGENTS.md"), `# Built\n${second.agent}\n`);
      }
      if (second.assertion !== undefined) {
        const file = join(ctx.workspace, "correctness-model/brief.json");
        const brief = JSON.parse(readFileSync(file, "utf8"));
        brief.truthChecks[0].assertion = second.assertion;
        writeFileSync(file, JSON.stringify(brief));
      }
      // A note moves the workspace commit and nothing the battery measures.
      if (second.bare !== true) {
        writeFileSync(
          join(ctx.workspace, "MEMORY.md"),
          "# Memory\nThe evaluator compared the answer by case.\n",
        );
      }
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
      String(2 + remeasures),
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
    analyse: async (repo, slug, runId, measuredDir, options) => {
      const analysed = await analyseStep(repo, slug, runId, measuredDir, options);
      if (runId === "rg" && first.settled !== undefined) {
        const settled = first.settled.map((taskId) => ({ taskId }));
        writeSettledReview(join(repo, "campaigns", slug, "analysis"), runId, settled);
      }
      return analysed;
    },
  });
  const records = outcome.rounds.flatMap((row) => {
    const dir = measuredProductDir(root, SLUG, row.runId);
    return dir === null ? [] : [readRecordedBatteryRecord(join(dir, "runs", row.runId), row.runId)];
  });
  const batteries = records.map((battery) => ({
    runId: battery.runId,
    solves: calls.get(battery.runId) ?? 0,
    passes: battery.cases.map((c) => c.pass),
    regrade: battery.regrade ?? null,
  }));
  const withheld = records.flatMap((battery) => battery.condition.advisorsRemoved);
  // What the next round's author reads of each battery: the readout row, newest first.
  const readout = readClimbReadout(selectedProductDir(root, SLUG), records[0]?.backendPin ?? "", {
    repoRoot: root,
    slug: SLUG,
  });
  const promotion = (runId: string) =>
    JSON.parse(readFileSync(join(root, "campaigns", SLUG, "promotions", `${runId}.json`), "utf8"));
  const selected = selectedProductDir(root, SLUG);
  return { root, outcome, batteries, calls, submits, withheld, readout, promotion, selected };
}

describe("an evaluation correction regrades instead of re-solving", () => {
  it("after a battery above the aim, schedules no solve and records the pass the correction flipped", async () => {
    const { outcome, batteries } = await twoRounds(
      flubbing(new Set(["t5"])),
      { evaluator: CASE_BLIND_EVALUATOR },
      {},
      2,
    );
    expect(outcome.rounds.map((row) => [row.move, row.build])).toEqual([
      ["build", "adopted"],
      ["measure", "reused"],
      ["measure", "reused"],
      ["rebuild", "candidate"],
    ]);
    const [first, , , correction] = batteries;
    expect(first?.solves).toBe(TASKS);
    expect(first?.passes).toEqual([true, true, true, true, true, false]);
    expect(correction).toEqual({
      runId: "rg-i04",
      solves: 0,
      passes: [true, true, true, true, true, true],
      regrade: { of: "rg-i03", reused: TASKS, changedPasses: 1 },
    });
  }, 180_000);

  it("after a battery below the aim, regrades too: the correction moved the evaluator alone", async () => {
    const { batteries } = await twoRounds(
      flubbing(new Set(["t1", "t2", "t3", "t4", "t5"])),
      { evaluator: CASE_BLIND_EVALUATOR },
      {},
      2,
    );
    expect(batteries.map((row) => [row.solves, row.regrade])).toEqual([
      [TASKS, null],
      [5, { of: "rg", reused: 1, changedPasses: 0 }],
      [5, { of: "rg-i02", reused: 1, changedPasses: 0 }],
      [0, { of: "rg-i03", reused: TASKS, changedPasses: 5 }],
    ]);
  }, 180_000);

  it("a task probe solves only the task it changed and regrades the five it poses again", async () => {
    const inputs = [...UPPERCASE_TASK_INPUTS.slice(0, 5), "gh"];
    const { batteries, readout } = await twoRounds(flubbing(new Set(["t5"])), { inputs }, {}, 2);
    expect(batteries.map((row) => [row.solves, row.regrade])).toEqual([
      [TASKS, null],
      ...CONFIRMED_T5,
      [1, { of: "rg-i03", reused: 5, changedPasses: 0 }],
    ]);
    // The changed task alone decides the probe, and the solver still flubs it: the five regraded
    // passes never enter its sample.
    expect(readout?.rows[0]?.deciding).toEqual({ population: "changed-subset", passes: 0, n: 1 });
  }, 180_000);

  it("a task probe solves every task again once the Built effort the battery ran under moved", async () => {
    const inputs = [...UPPERCASE_TASK_INPUTS.slice(0, 5), "gh"];
    const { batteries } = await twoRounds(flubbing(new Set(["t5"])), { inputs }, { effort: "minimal" });
    expect(batteries.map((row) => [row.solves, row.regrade])).toEqual([
      [TASKS, null],
      [TASKS, null],
    ]);
  }, 180_000);

  it("a correction that also rewrites the public rule the solver reads measures a full battery", async () => {
    const { batteries } = await twoRounds(
      flubbing(new Set(["t5"])),
      {
        evaluator: CASE_BLIND_EVALUATOR,
        assertion: "The answer equals the input in upper case, compared without regard to case.",
      },
      {},
      2,
    );
    expect(batteries.map((row) => [row.solves, row.regrade])).toEqual([
      [TASKS, null],
      ...CONFIRMED_T5,
      [TASKS, null],
    ]);
  }, 180_000);

  describe("measures a fresh battery when only the solver's own condition moved", () => {
    // A first battery solved under another effort or another shell poses nothing the run's Built
    // slot can solve again, so its fail goes to the Builder unconfirmed.
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
      const { batteries } = await twoRounds(
        flubbing(new Set(["t5"])),
        { evaluator: CASE_BLIND_EVALUATOR, toolchainProgram: "analyser" },
        {},
        2,
      );
      expect(batteries.map((row) => [row.solves, row.regrade])).toEqual([
        [TASKS, null],
        ...CONFIRMED_T5,
        [TASKS, null],
      ]);
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
    const { batteries } = await twoRounds(
      flubbing(new Set(["t5"])),
      { evaluator: CASE_BLIND_EVALUATOR, judge },
      {},
      2,
    );
    expect(batteries.map((row) => [row.solves, row.regrade?.reused ?? null])).toEqual([
      [TASKS, null],
      [1, 5],
      [1, 5],
      [0, TASKS],
    ]);
    expect(reviews).toBeGreaterThan(0);
  }, 180_000);

  it("a correction that also moves one task solves that task and regrades the five it poses again", async () => {
    const inputs = [...UPPERCASE_TASK_INPUTS.slice(0, 5), "gh"];
    const { batteries } = await twoRounds(
      flubbing(new Set(["t5"])),
      { evaluator: CASE_BLIND_EVALUATOR, inputs },
      {},
      2,
    );
    expect(batteries.map((row) => [row.solves, row.regrade])).toEqual([
      [TASKS, null],
      ...CONFIRMED_T5,
      [1, { of: "rg-i03", reused: 5, changedPasses: 0 }],
    ]);
  }, 180_000);

  it("a task probe regrades an unchanged task whose attempt was unaccepted rather than solving it again", async () => {
    // An unaccepted attempt is a measured failure, not a censored case: solving it again would hand
    // the task a second chance the rest of the battery never had.
    const silentT2 = (runId: string, taskId: string): Answer =>
      runId === "rg" && taskId === "t2" ? "silent" : taskId === "t5" ? "flub" : "right";
    const inputs = [...UPPERCASE_TASK_INPUTS.slice(0, 5), "gh"];
    const { batteries } = await twoRounds(silentT2, { inputs }, {}, 2);
    expect(batteries.map((row) => [row.solves, row.regrade])).toEqual([
      [TASKS, null],
      ...CONFIRMED_T5,
      [1, { of: "rg-i03", reused: 5, changedPasses: 0 }],
    ]);
    // An unaccepted attempt scores as a fail, fresh or regraded, and is never solved again.
    expect(batteries[3]?.passes).toEqual([true, true, false, true, true, false]);
  }, 180_000);
});

describe("a fail is solved again while every solve in its group failed and there are fewer than three", () => {
  it("confirms a fail with two more solves of that task alone, then hands the Builder the round", async () => {
    const { outcome, batteries } = await twoRounds(flubbing(new Set(["t5"])), {}, {}, 2);
    expect(outcome.rounds.map((row) => [row.move, row.build])).toEqual([
      ["build", "adopted"],
      ["measure", "reused"],
      ["measure", "reused"],
      ["rebuild", "candidate"],
    ]);
    expect(
      batteries.slice(0, 3).map((row) => [row.solves, row.regrade?.reused ?? null, row.passes[5]]),
    ).toEqual([
      [TASKS, null, false],
      [1, 5, false],
      [1, 5, false],
    ]);
  }, 180_000);

  it("stops at the solve that disagrees: a fail that passes on its second solve is a flip", async () => {
    const flip = (runId: string, taskId: string): Answer =>
      runId === "rg" && taskId === "t5" ? "flub" : "right";
    const { outcome, batteries } = await twoRounds(flip, {}, {}, 1);
    expect(outcome.rounds.map((row) => row.move)).toEqual(["build", "measure", "rebuild"]);
    expect(batteries[1]).toMatchObject({ solves: 1, passes: [true, true, true, true, true, true] });
  }, 180_000);

  it("solves no fail again whose task passed in its group: a repeat's fail after a pass is a flip", async () => {
    const failsAfterFirst = (runId: string, taskId: string): Answer =>
      taskId === "t5" && runId !== "rg" ? "flub" : "right";
    const { outcome, batteries } = await twoRounds(failsAfterFirst, { bare: true }, {}, 1);
    expect(outcome.rounds.map((row) => row.move)).toEqual(["build", "rebuild", "rebuild"]);
    expect(batteries[1]).toMatchObject({ runId: "rg-i02", solves: TASKS, regrade: null });
    expect(batteries[1]?.passes[5]).toBe(false);
  }, 180_000);

  it("solves no pass again: a harness change's pass after a confirmed fail is read on its one solve", async () => {
    const answered = (runId: string, taskId: string): Answer =>
      taskId === "t5" && ["rg", "rg-i02", "rg-i03"].includes(runId) ? "flub" : "right";
    const { outcome, batteries } = await twoRounds(answered, { agent: "Answer in upper case." }, {}, 3);
    expect(outcome.rounds.map((row) => row.move)).toEqual([
      "build",
      "measure",
      "measure",
      "rebuild",
      "rebuild",
    ]);
    expect(batteries[3]).toMatchObject({ runId: "rg-i04", solves: TASKS, regrade: null });
    expect(batteries[3]?.passes[5]).toBe(true);
  }, 180_000);

  it("keeps the group when a neighbour's bytes move: the fail's second solve counts with its first", async () => {
    // The environment cuts t5 short three times, so the fourth battery's fail reaches the Builder on
    // one solve. The Builder keeps t5 and edits t0; the candidate solves t5 again beside t0 under the
    // same exam, so one more remeasure confirms it.
    const cutThenFail = (runId: string, taskId: string): Answer => {
      if (taskId !== "t5") return "right";
      return ["rg", "rg-i02", "rg-i03"].includes(runId) ? "provider" : "flub";
    };
    const inputs = ["z", ...UPPERCASE_TASK_INPUTS.slice(1)];
    const { outcome, batteries } = await twoRounds(cutThenFail, { inputs }, {}, 5);
    expect(outcome.rounds.map((row) => row.move)).toEqual([
      "build",
      "measure",
      "measure",
      "measure",
      "rebuild",
      "measure",
      "rebuild",
    ]);
    expect(batteries.slice(3, 6).map((row) => [row.solves, row.passes[5]])).toEqual([
      [1, false],
      [2, false],
      [1, false],
    ]);
  }, 180_000);

  it("starts a group with each edit of this task: its fail after a confirmed fail of the old bytes is solved again", async () => {
    const inputs = [...UPPERCASE_TASK_INPUTS.slice(0, 5), "gh"];
    const { outcome, batteries } = await twoRounds(flubbing(new Set(["t5"])), { inputs }, {}, 3);
    expect(outcome.rounds.map((row) => row.move)).toEqual([
      "build",
      "measure",
      "measure",
      "rebuild",
      "measure",
    ]);
    expect(batteries[4]).toMatchObject({ solves: 1, regrade: { of: "rg-i04", reused: 5, changedPasses: 0 } });
  }, 180_000);

  it.each([
    ["the agent", { agent: "Keep the answer as given." }],
    ["the correctness model", { assertion: "The answer is the input in upper case, letter for letter." }],
  ] as const)(
    "starts a group with each edit of %s: a fail after a confirmed fail is solved again",
    async (_, second) => {
      const { outcome, batteries } = await twoRounds(flubbing(new Set(["t5"])), second, {}, 3);
      expect(outcome.rounds.map((row) => row.move)).toEqual([
        "build",
        "measure",
        "measure",
        "rebuild",
        "measure",
      ]);
      expect(batteries.slice(3).map((row) => [row.solves, row.passes[5]])).toEqual([
        [TASKS, false],
        [1, false],
      ]);
    },
    180_000,
  );

  it("starts a group with each tool tree: a fail after a pass under the earlier tree is solved again", async () => {
    const failsUnderNewTree = (runId: string, taskId: string): Answer =>
      runId === "rg-i02" && taskId === "t5" ? "flub" : "right";
    const { outcome, batteries } = await twoRounds(
      failsUnderNewTree,
      { toolchainProgram: "analyser" },
      {},
      1,
    );
    expect(outcome.rounds.map((row) => [row.move, row.build])).toEqual([
      ["build", "adopted"],
      ["rebuild", "candidate"],
      ["measure", "reused"],
    ]);
    expect(batteries.map((row) => [row.solves, row.regrade])).toEqual([
      [TASKS, null],
      [TASKS, null],
      [1, { of: "rg-i02", reused: 5, changedPasses: 0 }],
    ]);
  }, 180_000);

  it("measures again whole a battery whose every case failed or was cut short", async () => {
    // Four fails the solver repeats beside two provider non-results: nothing is left to regrade, and
    // the remeasure still records the regrade it is, so a chain of them stays bounded.
    const lost = (runId: string, taskId: string): Answer => {
      if (taskId !== "t4" && taskId !== "t5") return "flub";
      return runId === "rg" ? "provider" : "right";
    };
    const { outcome, batteries } = await twoRounds(lost, {}, {}, 2);
    expect(outcome.rounds.map((row) => row.move)).toEqual(["build", "measure", "measure", "rebuild"]);
    expect(batteries.slice(0, 3).map((row) => [row.solves, row.regrade])).toEqual([
      [TASKS, null],
      [TASKS, { of: "rg", reused: 0, changedPasses: 0 }],
      [4, { of: "rg-i02", reused: 2, changedPasses: 0 }],
    ]);
  }, 180_000);

  it("solves again a fail the review settled against its check, like any other fail", async () => {
    // The Judge and the review say nothing about which fails are confirmed: validity is read apart.
    const { outcome, batteries } = await twoRounds(flubbing(new Set(["t5"])), {}, { settled: ["t5"] }, 1);
    expect(outcome.rounds.map((row) => row.move)).toEqual(["build", "measure", "measure"]);
    expect(batteries.slice(1).map((row) => [row.solves, row.regrade?.reused ?? null])).toEqual([
      [1, 5],
      [1, 5],
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

  it("re-solves a repeat's two provider non-results and regrades the other four", async () => {
    // The repeat's battery carries its own experiment on the bytes the first battery measured, and
    // the remeasure carries the one it measures again: a repeat's, which regrades, since the
    // controller chose the cases to solve.
    const repeatCensored = (runId: string, taskId: string): Answer =>
      runId === "rg-i02" && (taskId === "t4" || taskId === "t5") ? "provider" : "right";
    const { outcome, batteries, readout } = await twoRounds(repeatCensored, { bare: true }, {}, 1);
    expect(outcome.rounds.map((row) => [row.move, row.build])).toEqual([
      ["build", "adopted"],
      ["rebuild", "candidate"],
      ["measure", "reused"],
    ]);
    expect(batteries.map((row) => [row.solves, row.regrade])).toEqual([
      [TASKS, null],
      [TASKS, null],
      [2, { of: "rg-i02", reused: 4, changedPasses: 0 }],
    ]);
    expect(readout?.rows.map((row) => [row.runId, row.operation])).toEqual([
      ["rg-i03", "repeat"],
      ["rg-i02", "repeat"],
      ["rg", "new-baseline"],
    ]);
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

describe("a repeat after a battery at or above the aim", () => {
  it.each([
    ["with a note", {}],
    ["with no edit at all", { bare: true }],
  ] as const)(
    "%s is solved afresh, recorded as a repeat and selected as the product's new measurement",
    async (_name, second) => {
      const { root, outcome, batteries, submits, readout, promotion, selected } = await twoRounds(
        flubbing(new Set()),
        second,
      );
      expect(outcome.rounds.map((row) => [row.move, row.build])).toEqual([
        ["build", "adopted"],
        ["rebuild", "candidate"],
      ]);
      expect([promotion("rg-i02").decision, promotion("rg-i02").clauses]).toEqual(["promoted", []]);
      expect(selected).toBe(productVersionDir(root, SLUG, "rg-i02"));
      expect(submits.at(-1)).toContain("Accepted.");
      expect(batteries.map((row) => [row.runId, row.solves, row.regrade])).toEqual([
        ["rg", TASKS, null],
        ["rg-i02", TASKS, null],
      ]);
      const [repeat, first] = readout?.rows ?? [];
      expect([repeat?.runId, repeat?.operation, repeat?.passed, repeat?.claimRefusal]).toEqual([
        "rg-i02",
        "repeat",
        TASKS,
        null,
      ]);
      expect([repeat?.product, repeat?.taskSet, repeat?.scoring]).toEqual([
        first?.product,
        first?.taskSet,
        first?.scoring,
      ]);
    },
    180_000,
  );

  it("that verified nothing is held on its own battery, so a repeat loop still spends the allowance", async () => {
    const { outcome, promotion } = await twoRounds((runId) => (runId === "rg-i02" ? "silent" : "right"));
    expect(outcome.rounds.map((row) => row.build)).toEqual(["adopted", "candidate"]);
    const held = promotion("rg-i02");
    expect(held.decision).toBe("held");
    expect(held.clauses.map((clause: string) => clause.split(":")[0])).toContain("candidate-zero-verified");
  }, 180_000);
});

describe("the solving condition a regrade and a remeasure both read", () => {
  it("moves with the host's share of the Built prompt, and a battery recorded without it matches nothing", () => {
    const repoRoot = mkdtempSync(join(import.meta.dir, "..", ".scratch", "ana-solving-"));
    scratch.push(repoRoot);
    const candidateDir = join(repoRoot, "candidate");
    mkdirSync(candidateDir, { recursive: true });
    const input = {
      repoRoot,
      slug: SLUG,
      runPin: "claude/m",
      built: { reasoningEffort: "medium" },
      candidateDir,
    };
    const recorded = (condition: RunCondition) => ({
      backendPin: "claude/m",
      condition,
      bundleSnapshot: { toolTreeDigest: toolTreeDigestOf(bundleSnapshotToolTree(candidateDir)) },
    });
    const now = batteryCondition(candidateDir);
    // The same procedure clears the condition and reaches the effort, which no row here records.
    expect(solverConditionMoved(input, "r1", recorded(now))).toBe(
      "the Built reasoning effort moved, or the recorded solves name none",
    );
    expect(solverConditionMoved(input, "r1", recorded({ ...now, builtProcedure: "another" }))).toBe(
      "the solver's run condition moved",
    );
    const { builtProcedure: _recorded, ...older } = now;
    expect(solverConditionMoved(input, "r1", recorded(older))).toBe("the solver's run condition moved");
  });
});

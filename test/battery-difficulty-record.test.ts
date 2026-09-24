/**
 * What a measured battery records about its own difficulty, and what it refuses to record.
 *
 * The record carries counts only: attempts and passes per family, and attempts and passes over
 * the changed subset. A stored rate would be a second number that can disagree with them, and an
 * authored level is an ordinal label no decision reads (working rule 11). The dilution case is
 * the one that matters: five changed tasks that all fail, beside twenty unchanged tasks that all
 * pass, must not read as 20/25.
 */

import { PLAN_FIELDS } from "./helpers/experiment-plan.ts";
import { mkdirSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";

import { afterAll, describe, expect, it } from "bun:test";
import type { MeasuredDifficulty } from "../src/claim/battery-difficulty.ts";
import { recordedEvidence } from "../src/claim/evidence-log.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import { decideDifficulty } from "../src/run/climb-readout.ts";
import { type Solver, nonResultOutcome } from "../src/truth/solve.ts";
import type { BuildTask } from "../src/truth/tasks.ts";
import { makeVerify } from "../src/truth/verification-runner.ts";
import { required } from "./helpers/doubles.ts";
import {
  ACCEPTS,
  EVALUATOR_SOURCE,
  REJECTS,
  TASKS,
  TOOLS_SOURCE,
  fingerprintOf,
  removeScratchRoot,
  scratch,
  scriptedSolver,
  SCRIPTED_CONDITION,
  SCRIPTED_THRESHOLD_DIGEST,
} from "./helpers/verification-runner-fixtures.ts";

interface RecordedBatteryView {
  cases: Array<{ pass: unknown; truthOk: unknown }>;
  measured: MeasuredDifficulty;
}

afterAll(removeScratchRoot);

function bundleSlug(): string {
  const slugDir = scratch();
  mkdirSync(join(slugDir, "correctness-model"), { recursive: true });
  mkdirSync(join(slugDir, "agent"), { recursive: true });
  writeFileSync(join(slugDir, "correctness-model/evaluator.ts"), EVALUATOR_SOURCE);
  writeFileSync(join(slugDir, "agent/tools.ts"), TOOLS_SOURCE);
  writeFileSync(
    join(slugDir, "correctness-model/controls.json"),
    JSON.stringify({ accept: ACCEPTS, reject: REJECTS }),
  );
  return slugDir;
}

async function battery(slugDir: string, runId: string, tasks: BuildTask[]): Promise<RecordedBatteryView> {
  await makeVerify({
    solver: scriptedSolver(),
    backendPin: "scripted/none",
    condition: SCRIPTED_CONDITION,
    thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
    capabilities: ["web-search:off"],
    runId,
  })({ slug: "matching", slugDir, fingerprint: fingerprintOf(slugDir), tasks });
  return parseJsonAs<RecordedBatteryView>(readFileSync(join(slugDir, "runs", runId, "battery.json"), "utf8"));
}

describe("the changed subset the next difficulty decision reads", () => {
  it.each(
    ["verified-fail", "non-result"].flatMap((condition) =>
      ["proposal", "unlevelled"].map((mode) => ({ condition, mode })),
    ),
  )(
    "keeps $condition $mode apart from the unchanged 20/20 beside it",
    async ({ condition, mode }) => {
      const slugDir = bundleSlug();
      const first = required(TASKS.tasks[0], "first fixture task");
      const second = required(TASKS.tasks[1], "second fixture task");
      const third = required(TASKS.tasks[2], "third fixture task");
      const tasks = [
        ...Array.from({ length: 5 }, (_, i) => ({
          ...first,
          taskId: i === 0 ? first.taskId : `moved-${i}`,
          level: 2,
        })),
        ...Array.from({ length: 20 }, (_, i) => ({
          ...(i === 1 ? third : second),
          taskId: i === 0 ? second.taskId : i === 1 ? third.taskId : `unchanged-${i}`,
          level: 2,
        })),
      ];
      if (mode === "unlevelled") for (const task of tasks) Reflect.deleteProperty(task, "level");
      writeFileSync(join(slugDir, "correctness-model/tasks.json"), JSON.stringify(tasks));

      const runId = "run-thin-moved";
      const substantive = scriptedSolver(new Set(tasks.slice(0, 5).map((task) => task.taskId)));
      const solver: Solver = async (task, ...rest) =>
        condition === "non-result" && task.family === first.family
          ? nonResultOutcome({ kind: "runtime", message: "fixture worker could not start" })
          : substantive(task, ...rest);
      const proposal = {
        scope: "tasks" as const,
        target: { comparator: "at-least" as const, verifiedPasses: 0 },
        gap: "The old tasks are too easy.",
        change: "Change five public inputs.",
        ...PLAN_FIELDS,
        expectedResult: "The changed subset fails more often.",
      };
      await makeVerify({
        solver,
        backendPin: "scripted/none",
        condition: SCRIPTED_CONDITION,
        thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
        capabilities: ["web-search:off"],
        runId,
        experimentAuthoring: {
          proposal: { ...proposal, digest: hashJsonValue(proposal) },
          operation: { operation: "task-probe" as const, moved: ["tasks" as const] },
          actual: "climb" as const,
          baseline: { agentHash: "a", correctnessModelHash: "c", taskSetHash: "t" },
          changedTaskIds: tasks.slice(0, 5).map((task) => task.taskId),
        },
      })({ slug: "matching", slugDir, fingerprint: fingerprintOf(slugDir), tasks });

      const receipt = recordedEvidence(join(slugDir, "runs", runId), "battery.json");
      if (!receipt.ok) throw new Error(receipt.refusal);
      const written = parseJsonAs<{
        cases: Array<{
          pass: boolean | null;
          acceptedSubmit: boolean;
          truthOk: boolean | null;
          runtimeNonResultKind: string | null;
        }>;
        measured: MeasuredDifficulty;
      }>(receipt.bytes);
      const movedN = condition === "non-result" ? 0 : 5;
      expect(written.cases.filter((row) => row.acceptedSubmit && row.truthOk !== null)).toHaveLength(
        20 + movedN,
      );
      expect(written.cases.filter((row) => row.pass === true)).toHaveLength(20);
      expect(
        written.cases.filter(
          (row) => row.runtimeNonResultKind === "runtime" && row.pass === null && row.truthOk === null,
        ),
      ).toHaveLength(condition === "non-result" ? 5 : 0);
      // The subset is two counts and nothing else: a recorded rate can never disagree with them.
      expect(written.measured.changedSubset).toEqual({ attempts: movedN, passes: 0 });

      const decision = decideDifficulty([
        {
          runId,
          batterySha256: receipt.sha256,
          n: 25,
          passed: 20,
          unaccepted: 0,
          measured: written.measured,
        },
      ]);
      // 0 of 5 alone has Wilson interval [0, 0.434]; diluted by the unchanged 20/20 it reads 20/25.
      if (movedN === 0) {
        expect(decision).toMatchObject({
          action: "no-difficulty-evidence",
          rationale: expect.stringContaining("the deciding sample of 0/0"),
        });
      } else {
        expect(decision).toMatchObject({
          action: "placed",
          rationale: expect.stringContaining("[0.000, 0.434]"),
        });
      }
    },
    60_000,
  );
});

describe("the family tally", () => {
  it.concurrent("counts every verified case by family, and records nothing else", async () => {
    const slugDir = bundleSlug();
    const { measured } = await battery(
      slugDir,
      "run-family-001",
      TASKS.tasks.map((task) => ({ ...task, level: 2 })),
    );
    expect(Object.keys(measured)).toEqual(["items"]);
    expect(measured.items.map((row) => Object.keys(row))).toEqual(
      measured.items.map(() => ["item", "attempts", "passes"]),
    );
    expect(measured.items.reduce((sum, row) => sum + row.attempts, 0)).toBe(TASKS.tasks.length);
    // An authored level changes nothing about the tally, which is the point of having removed it.
    expect((await battery(slugDir, "run-family-002", TASKS.tasks)).measured).toEqual(measured);
  }, 60_000);

  it.concurrent("tallies an entirely unaccepted battery as failures without verifying anything", async () => {
    const slugDir = bundleSlug();
    // A solver that never submits hits the no-accepted-submission branch: pass false, truthOk
    // null, nothing verified. The attempt still enters the tally (climb dive F5); keeping it there
    // does not make an entirely unaccepted battery difficulty evidence, which decideDifficulty
    // sets aside on the refusal count instead.
    const idle: Solver = async () => ({ turns: 1, completedTurns: 1, errors: [] });
    await makeVerify({
      solver: idle,
      backendPin: "scripted/none",
      condition: SCRIPTED_CONDITION,
      thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
      capabilities: ["web-search:off"],
      runId: "run-family-003",
    })({ slug: "matching", slugDir, fingerprint: fingerprintOf(slugDir), tasks: TASKS.tasks });

    const failed = parseJsonAs<RecordedBatteryView>(
      readFileSync(join(slugDir, "runs", "run-family-003", "battery.json"), "utf8"),
    );
    expect(failed.cases.length).toBeGreaterThan(0);
    for (const row of failed.cases) {
      expect(row).toMatchObject({ acceptedSubmit: false, pass: false, truthOk: null });
    }
    expect(failed.measured.items.reduce((sum, row) => sum + row.attempts, 0)).toBe(failed.cases.length);
    expect(failed.measured.items.every((row) => row.passes === 0)).toBe(true);
  }, 60_000);
});

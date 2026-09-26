/**
 * The paid Judge battery review inside makeVerify: which subjects it offers, how wide it runs,
 * when it stops paying, and that the measurement is on disk before it starts. Every case runs the
 * real verifier over a battery of copies of the first fixture task, with a scripted Judge.
 */

import { existsSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";

import { afterAll, describe, expect, it } from "bun:test";
import { judgeDecision } from "../src/claim/judge.ts";
import { verifyRunDir } from "../src/claim/evidence-log.ts";
import type { Judge, JudgeAttempt } from "../src/review/judge-contract.ts";
import type { Solver } from "../src/correctness-bundle/solve.ts";
import type { VerificationRunnerOptions } from "../src/correctness-bundle/verification-runner.ts";
import { double, required } from "./helpers/doubles.ts";
import {
  ACCEPTS,
  FIRST_TASK,
  REJECTS,
  SCRATCH_ROOT,
  directPiSlug,
  fingerprintOf,
  removeScratchRoot,
  scriptedSolver,
  scriptedVerify,
} from "./helpers/verification-runner-fixtures.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { createRunObserver } from "../src/observe/run-observer.ts";

const PASS: JudgeAttempt = {
  verdict: true,
  abstained: false,
  rationale: "scripted verdict",
  rules: [],
  error: null,
  errorKind: null,
  turns: 1,
};

afterAll(removeScratchRoot);

/**
 * Runs `count` copies of the first fixture task under the Judge `judgeFor` returns for the run
 * directory, and returns that directory and its battery record. The synthetic battery replaces
 * t1/t2/t3, so the fixture controls are rebound to judge-1; an unknown taskId would make
 * discrimination unclaimable and end the run before any review.
 */
async function judgedBattery(
  runId: string,
  count: number,
  judgeFor: (runDir: string) => Judge,
  overrides: Partial<VerificationRunnerOptions> = {},
) {
  const slugDir = directPiSlug();
  const runDir = join(slugDir, "runs", runId);
  const tasks = Array.from({ length: count }, (_, index) => ({
    ...FIRST_TASK,
    taskId: `judge-${index + 1}`,
  }));
  writeFileSync(
    join(slugDir, "correctness-model/controls.json"),
    JSON.stringify({
      accept: ACCEPTS.map((control) => ({ ...control, taskId: "judge-1" })),
      reject: REJECTS.map((control) => ({
        ...required(
          REJECTS.find((row) => row.id === control.id.replace("-two-part", "")),
          "single-part reject",
        ),
        id: control.id,
        taskId: "judge-1",
      })),
    }),
  );
  await scriptedVerify(runId, {
    judge: { pin: "scripted/judge-v1", invoke: judgeFor(runDir) },
    ...overrides,
  })({
    slug: "matching",
    slugDir,
    fingerprint: fingerprintOf(slugDir),
    tasks,
  });
  return { runDir, battery: JSON.parse(readFileSync(join(runDir, "battery.json"), "utf8")) };
}

describe("makeVerify paid judge review", () => {
  it.concurrent("aborts after five consecutive real subjects fail to deliver valid output", async () => {
    // Seven eligible cases: five cannot deliver valid output, so the remaining two are never paid for.
    let judgeInvocations = 0;
    const { runDir, battery } = await judgedBattery("run-census-abort", 7, () => async () => {
      judgeInvocations += 1;
      return {
        ...PASS,
        verdict: null,
        rationale: null,
        error: "provider degraded turn",
        errorKind: "provider",
        turns: 0,
      };
    });
    expect(judgeInvocations).toBe(5);
    expect(JSON.parse(readFileSync(join(runDir, "judge/census-abort.json"), "utf8"))).toMatchObject({
      schema: "judge-census-abort/v1",
      attempted: 5,
      threshold: 5,
      lastError: "provider degraded turn",
    });
    // Scoring is untouched: the partial review aggregates through the existing vocabulary.
    expect(judgeDecision(battery.judge)).toBe("non-result");
    expect(battery.judge.offered).toBe(7);
  }, 30_000);

  it.concurrent("reviews five subjects at a time and records every case's evidence and phase", async () => {
    const observer = createRunObserver(SCRATCH_ROOT, "matching", "run-parallel-census");
    let active = 0;
    let mostAtOnce = 0;
    const { runDir, battery } = await judgedBattery(
      "run-parallel-census",
      7,
      () => async () => {
        active += 1;
        mostAtOnce = Math.max(mostAtOnce, active);
        await Bun.sleep(2);
        active -= 1;
        return PASS;
      },
      { observer },
    );
    expect(mostAtOnce).toBe(5);
    expect(battery.judge).toMatchObject({ judge: "unvalidated", offered: 7, disagreements: 0 });
    const judged = Array.from({ length: 7 }, (_, index) =>
      existsSync(join(runDir, `cases/judge-${index + 1}/judge.json`)),
    );
    expect(judged).toEqual(Array(7).fill(true));
    const phases = readFileSync(
      join(SCRATCH_ROOT, "campaigns/matching/observability/run-parallel-census.jsonl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .map((line) => parseJsonAs<{ phase?: string; state?: string }>(line));
    for (const phase of ["controls", "solve", "grade", "judge"]) {
      expect(phases.filter((event) => event.phase === phase && event.state === "started")).toHaveLength(1);
      expect(phases.filter((event) => event.phase === phase && event.state === "completed")).toHaveLength(1);
    }
  }, 30_000);

  // The verifier finishes its cases before the optional review starts, so a run stopped inside the
  // review still leaves a battery record the canonical readers accept, and the completed review
  // rewrites the same file.
  it.concurrent("publishes the finished measurement before the review runs", async () => {
    // How many cases the battery record held at each review call; -1 means no record existed.
    const casesSeenAtReview: number[] = [];
    const { battery } = await judgedBattery("run-review-ordering", 3, (runDir) => async () => {
      // Every review file written so far is named by the manifest on disk: a process killed here
      // leaves a run dir the reader accepts, with the measurement intact and the review partial.
      expect(verifyRunDir(runDir).filter((violation) => violation.code !== "evidence-torn")).toEqual([]);
      const path = join(runDir, "battery.json");
      // SAFETY: recordBatteryRecord writes this file in this process and always gives it a cases
      // array; the existsSync guard covers the only other state, the file being absent.
      casesSeenAtReview.push(
        existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as { cases: unknown[] }).cases.length : -1,
      );
      return PASS;
    });
    expect(casesSeenAtReview[0]).toBe(3);
    expect(battery.judge.offered).toBe(3);
  }, 30_000);

  it.concurrent("counts every disagreement and buys no control census for it", async () => {
    const subjectKinds = new Set<string>();
    const { runDir, battery } = await judgedBattery(
      "run-disagree-census",
      3,
      () => async (_input, context) => {
        subjectKinds.add(context?.subjectKind ?? "none");
        // The judge fails every battery case the verifier passed: three real disagreements.
        return { ...PASS, verdict: false, rules: ["publicInput"] };
      },
    );
    expect([...subjectKinds]).toEqual(["battery-case"]);
    expect(battery.judge).toMatchObject({ judge: "unvalidated", offered: 3, disagreements: 3 });
    expect(battery.judge).not.toHaveProperty("controlValidity");
    for (const retired of ["control-census-sample.json", "bait-corpus.json", "review-standing.json"]) {
      expect(existsSync(join(runDir, "judge", retired))).toBe(false);
    }
  }, 30_000);

  it.concurrent("offers only eligible subjects: an unaccepted case gets no judge call and no judge.json", async () => {
    // judge-2 never submits, so its case is unaccepted: no artifact to inspect and no verifier
    // verdict to compare against. It must never be offered to the judge or paid for.
    const base = scriptedSolver();
    const solver: Solver = async (task, toolset, submitted) => {
      if (task.taskId !== "judge-2") return await base(task, toolset, submitted);
      const declare = toolset.tools.find((tool) => tool.name === "declare_part");
      if (declare === undefined) throw new Error('generated toolset is missing tool "declare_part"');
      /* SAFETY: the same TASKS fixture; this branch reads only the parts list. */
      const input = task.publicInput as { parts: string[] };
      await declare.execute("c-unaccepted", double({ name: input.parts[0] }));
      return { turns: 1, completedTurns: 1, errors: [] };
    };
    const judged: string[] = [];
    const { runDir, battery } = await judgedBattery(
      "run-eligible-only",
      3,
      () => async (_input, context) => {
        judged.push(required(context, "the judge call context").subjectId);
        return PASS;
      },
      { solver },
    );
    expect(judged.sort()).toEqual(["judge-1", "judge-3"]);
    expect(battery.judge.offered).toBe(2);
    expect(
      ["judge-1", "judge-2", "judge-3"].map((id) => existsSync(join(runDir, `cases/${id}/judge.json`))),
    ).toEqual([true, false, true]);
    const unaccepted = JSON.parse(readFileSync(join(runDir, "cases/judge-2/case-result.json"), "utf8"));
    expect(unaccepted.acceptedSubmit).toBe(false);
  }, 30_000);
});

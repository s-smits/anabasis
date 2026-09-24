// The paid Judge battery review of makeVerify, split from verification-runner.test.ts so the
// slowest describe blocks run as separate files under the parallel test runner.

import { existsSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";

import { afterAll, describe, expect, it } from "bun:test";
import { judgeDecision } from "../src/claim/judge.ts";
import { verifyRunDir } from "../src/claim/evidence-log.ts";
import { makeVerify } from "../src/truth/verification-runner.ts";
import { type Solver } from "../src/truth/solve.ts";
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
  SCRIPTED_CONDITION,
  SCRIPTED_THRESHOLD_DIGEST,
} from "./helpers/verification-runner-fixtures.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { createRunObserver } from "../src/observe/run-observer.ts";

afterAll(removeScratchRoot);

describe("makeVerify paid judge census", () => {
  it.concurrent("aborts after five consecutive real subjects fail to deliver valid output", async () => {
    // Seven eligible cases: five cannot deliver valid output, so the
    // remaining two are never paid for.
    const slugDir = directPiSlug();
    const tasks = Array.from({ length: 7 }, (_, index) => ({
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
    let judgeInvocations = 0;
    const evaluate = makeVerify({
      solver: scriptedSolver(),
      backendPin: "scripted/none",
      condition: SCRIPTED_CONDITION,
      thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
      capabilities: ["web-search:off"],
      runId: "run-census-abort",
      judge: {
        pin: "scripted/judge-v1",
        invoke: async () => {
          judgeInvocations += 1;
          return {
            verdict: null,
            abstained: false,
            rationale: null,
            rules: [],
            error: "provider degraded turn",
            errorKind: "provider",
            turns: 0,
          };
        },
      },
    });
    await evaluate({
      slug: "matching",
      slugDir,
      fingerprint: fingerprintOf(slugDir),
      tasks: tasks,
    });
    // Exactly five errored real subjects; the remaining two eligible subjects and the
    // whole control corpus were never paid for.
    expect(judgeInvocations).toBe(5);
    const runDir = join(slugDir, "runs/run-census-abort");
    const abort = JSON.parse(readFileSync(join(runDir, "judge/census-abort.json"), "utf8"));
    expect(abort).toMatchObject({
      schema: "judge-census-abort/v1",
      attempted: 5,
      threshold: 5,
      lastError: "provider degraded turn",
    });
    // Scoring is untouched: the partial census aggregates through the existing vocabulary.
    const battery = JSON.parse(readFileSync(join(runDir, "battery.json"), "utf8"));
    expect(judgeDecision(battery.judge)).toBe("non-result");
    expect(battery.judge.offered).toBe(7);
    expect(existsSync(join(runDir, "judge/bait-corpus.json"))).toBe(false);
    expect(existsSync(join(runDir, "judge/review-standing.json"))).toBe(false);
  }, 30_000);

  it.concurrent("runs the battery census five-wide and records every case evidence", async () => {
    const slugDir = directPiSlug();
    const observer = createRunObserver(SCRATCH_ROOT, "matching", "run-parallel-census");
    const tasks = Array.from({ length: 7 }, (_, index) => ({
      ...FIRST_TASK,
      taskId: `judge-${index + 1}`,
    }));
    // The synthetic battery replaces t1/t2/t3, so the fixture controls re-bind to a task that
    // exists in it — an unknown taskId would (correctly) make discrimination unclaimable.
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
    let activeBattery = 0;
    let maximumBattery = 0;
    const evaluate = makeVerify({
      solver: scriptedSolver(),
      backendPin: "scripted/none",
      condition: SCRIPTED_CONDITION,
      thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
      capabilities: ["web-search:off"],
      runId: "run-parallel-census",
      observer,
      judge: {
        pin: "scripted/judge-v1",
        invoke: async (_input, context) => {
          if (context?.subjectKind === "battery-case") {
            activeBattery += 1;
            maximumBattery = Math.max(maximumBattery, activeBattery);
            await Bun.sleep(2);
            activeBattery -= 1;
          }
          return {
            verdict: true,
            abstained: false,
            rationale: "scripted verdict",
            rules: [],
            error: null,
            errorKind: null,
            turns: 1,
          };
        },
      },
    });
    await evaluate({
      slug: "matching",
      slugDir,
      fingerprint: fingerprintOf(slugDir),
      tasks: tasks,
    });
    const runDir = join(slugDir, "runs/run-parallel-census");
    const battery = JSON.parse(readFileSync(join(runDir, "battery.json"), "utf8"));
    expect(maximumBattery).toBe(5);
    expect(battery.judge.offered).toBe(7);
    expect(tasks.map((task) => existsSync(join(runDir, `cases/${task.taskId}/judge.json`)))).toEqual(
      Array(7).fill(true),
    );
    // No control census runs: the evidence reads unvalidated.
    expect(battery.judge.judge).toBe("unvalidated");
    expect(battery.judge.disagreements).toBe(0);
    expect(existsSync(join(runDir, "judge/bait-corpus.json"))).toBe(false);
    expect(existsSync(join(runDir, "judge/review-standing.json"))).toBe(false);
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

  // The verifier finishes its cases before the optional review starts. A run stopped inside the
  // review used to leave those verdicts with no battery record, so the canonical readers saw no
  // measurement at all (run 69868a, 25 cases). The measurement is now on disk before the first
  // review call, and the completed review rewrites the same file.
  it.concurrent("publishes the finished measurement before the review runs", async () => {
    const slugDir = directPiSlug();
    const tasks = Array.from({ length: 3 }, (_, index) => ({ ...FIRST_TASK, taskId: `early-${index + 1}` }));
    writeFileSync(
      join(slugDir, "correctness-model/controls.json"),
      JSON.stringify({
        accept: ACCEPTS.map((control) => ({ ...control, taskId: "early-1" })),
        reject: REJECTS.map((control) => ({
          ...required(
            REJECTS.find((row) => row.id === control.id.replace("-two-part", "")),
            "single-part reject",
          ),
          id: control.id,
          taskId: "early-1",
        })),
      }),
    );
    const runDir = join(slugDir, "runs/run-review-ordering");
    let firstReviewSeen = false;
    let casesSeenAtFirstReview = -1;
    const evaluate = makeVerify({
      solver: scriptedSolver(),
      backendPin: "scripted/none",
      condition: SCRIPTED_CONDITION,
      thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
      capabilities: ["web-search:off"],
      runId: "run-review-ordering",
      judge: {
        pin: "scripted/judge-v1",
        invoke: async () => {
          // Every review file written so far is named by the manifest on disk: a process killed
          // here leaves a run dir the reader accepts, with the measurement intact and the review
          // partial. The earlier subjects' judge rows must stay bound to the manifest the battery published.
          expect(verifyRunDir(runDir).filter((violation) => violation.code !== "evidence-torn")).toEqual([]);
          if (!firstReviewSeen) {
            firstReviewSeen = true;
            const path = join(runDir, "battery.json");
            // SAFETY: recordBatteryRecord writes this file in this process and always gives it a
            // cases array; the existsSync guard covers the only other state, the file being absent.
            casesSeenAtFirstReview = existsSync(path)
              ? (JSON.parse(readFileSync(path, "utf8")) as { cases: unknown[] }).cases.length
              : -1;
          }
          return {
            verdict: true,
            abstained: false,
            rationale: "scripted verdict",
            rules: [],
            error: null,
            errorKind: null,
            turns: 1,
          };
        },
      },
    });
    await evaluate({ slug: "matching", slugDir, fingerprint: fingerprintOf(slugDir), tasks });
    // -1 would mean no battery existed when the review started, which is the defect.
    expect(casesSeenAtFirstReview).toBe(3);
    const battery = JSON.parse(readFileSync(join(runDir, "battery.json"), "utf8"));
    expect(battery.judge.offered).toBe(3);
  }, 30_000);

  it.concurrent("buys no control census when every battery verdict disagreed with the verifier", async () => {
    const slugDir = directPiSlug();
    const tasks = Array.from({ length: 3 }, (_, index) => ({
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
    const controlKinds: string[] = [];
    const evaluate = makeVerify({
      solver: scriptedSolver(),
      backendPin: "scripted/none",
      condition: SCRIPTED_CONDITION,
      thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
      capabilities: ["web-search:off"],
      runId: "run-disagree-census",
      judge: {
        pin: "scripted/judge-v1",
        invoke: async (_input, context) => {
          if (context?.subjectKind !== "battery-case") controlKinds.push(context?.subjectKind ?? "?");
          return {
            // The judge fails every battery case the verifier passed: three real disagreements.
            verdict: false,
            abstained: false,
            rationale: "scripted verdict",
            rules: ["publicInput"],
            error: null,
            errorKind: null,
            turns: 1,
          };
        },
      },
    });
    await evaluate({
      slug: "matching",
      slugDir,
      fingerprint: fingerprintOf(slugDir),
      tasks: tasks,
    });
    const runDir = join(slugDir, "runs/run-disagree-census");
    const battery = JSON.parse(readFileSync(join(runDir, "battery.json"), "utf8"));
    // Only battery subjects reached the Judge session, and no census file was written.
    expect(controlKinds).toEqual([]);
    expect(battery.judge).toMatchObject({
      judge: "unvalidated",
      offered: 3,
      disagreements: 3,
    });
    expect(battery.judge).not.toHaveProperty("controlValidity");
    for (const retired of ["control-census-sample.json", "bait-corpus.json", "review-standing.json"]) {
      expect(existsSync(join(runDir, "judge", retired))).toBe(false);
    }
  }, 30_000);

  it.concurrent("offers only eligible subjects: an unaccepted case gets no judge call and no judge.json", async () => {
    const slugDir = directPiSlug();
    const tasks = Array.from({ length: 3 }, (_, index) => ({
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
    // judge-2 never submits, so its case is unaccepted: no artifact to inspect and no verifier
    // verdict to compare against — it must never be offered to the judge or paid for.
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
    const judgedBatterySubjects: string[] = [];
    const evaluate = makeVerify({
      solver,
      backendPin: "scripted/none",
      condition: SCRIPTED_CONDITION,
      thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
      capabilities: ["web-search:off"],
      runId: "run-eligible-only",
      judge: {
        pin: "scripted/judge-v1",
        invoke: async (_input, context) => {
          if (context?.subjectKind === "battery-case") judgedBatterySubjects.push(context.subjectId);
          return {
            verdict: true,
            abstained: false,
            rationale: "scripted verdict",
            rules: [],
            error: null,
            errorKind: null,
            turns: 1,
          };
        },
      },
    });
    await evaluate({
      slug: "matching",
      slugDir,
      fingerprint: fingerprintOf(slugDir),
      tasks: tasks,
    });
    const runDir = join(slugDir, "runs/run-eligible-only");
    const battery = JSON.parse(readFileSync(join(runDir, "battery.json"), "utf8"));
    expect(judgedBatterySubjects.sort()).toEqual(["judge-1", "judge-3"]);
    expect(battery.judge.offered).toBe(2);
    expect(existsSync(join(runDir, "cases/judge-1/judge.json"))).toBe(true);
    expect(existsSync(join(runDir, "cases/judge-2/judge.json"))).toBe(false);
    expect(existsSync(join(runDir, "cases/judge-3/judge.json"))).toBe(true);
    const unaccepted = JSON.parse(readFileSync(join(runDir, "cases/judge-2/case-result.json"), "utf8"));
    expect(unaccepted.acceptedSubmit).toBe(false);
  }, 30_000);
});

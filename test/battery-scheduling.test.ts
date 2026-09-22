/**
 * How a battery schedules its cases: the pool width it holds, when grading starts, what it does
 * with the cases it never ran, and when it stops scheduling at all.
 *
 * Two recorded failures own this file. Run truss-w35-opus lost 15 of 25 cases to one unbroken
 * sequence of provider usage-limit failures and kept scheduling into it. And a verifier lifetime
 * that stopped mid-battery silently graded nothing further, so the recorded pack was short with
 * no line saying why.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";

import { afterAll, describe, expect, it } from "bun:test";
import { verifyRunDir } from "../src/claim/evidence-log.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { createSafeguardContext, SAFEGUARDS_LOG_FILE } from "../src/meta/safeguard.ts";
import { createRunObserver } from "../src/observe/run-observer.ts";
import { BUILT_SOLVE_MAX_CONCURRENCY } from "../src/run/session-pool.ts";
import {
  BATTERY_PROVIDER_STOP_CONSECUTIVE,
  solveBatteryWithProviderStop,
} from "../src/truth/battery-provider-stop.ts";
import type { VerificationInput } from "../src/truth/build-deps.ts";
import { type Solver, nonResultOutcome } from "../src/truth/solve.ts";
import type { SolvedCase } from "../src/truth/solve-case.ts";
import type { BuildTask } from "../src/truth/tasks.ts";
import { commitPublicTask } from "../src/truth/task-split.ts";
import { makeVerify } from "../src/truth/verification-runner.ts";
import { createVerifierLifetime } from "../src/verify/verifier-lifetime.ts";
import {
  ACCEPTS,
  EVALUATOR_SOURCE,
  REJECTS,
  TASKS,
  TOOLS_SOURCE,
  fingerprintOf,
  SCRATCH_ROOT,
  removeScratchRoot,
  scratch,
  scriptedSolver,
  SCRIPTED_CONDITION,
  SCRIPTED_THRESHOLD_DIGEST,
} from "./helpers/verification-runner-fixtures.ts";

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

describe("the solve pool", () => {
  it.concurrent("holds its width, grades a settled case before the pool drains, and keeps task order", async () => {
    const slugDir = bundleSlug();
    // Six cases against a width of three, so the pool must queue rather than start them all.
    const tasks: VerificationInput["tasks"] = [0, 1].flatMap((copy) =>
      TASKS.tasks.map((task) => ({ ...task, taskId: copy === 0 ? task.taskId : `${task.taskId}b` })),
    );
    const order = tasks.map((task) => task.taskId);
    const scripted = scriptedSolver();
    let active = 0;
    let peak = 0;
    let openWave = (): void => {};
    const waveFull = new Promise<void>((resolve) => {
      openWave = resolve;
    });
    let releaseHeld = (): void => {};
    const held = new Promise<void>((resolve) => {
      releaseHeld = resolve;
    });
    const solver: Solver = async (task, toolset, submitted) => {
      active += 1;
      peak = Math.max(peak, active);
      if (task.taskId === order[0]) {
        // The first case may finish once the other two have started; the rest stay live until the
        // assertion below has seen its verifier evidence.
        await waveFull;
      } else {
        if (active === 3) openWave();
        await held;
      }
      const outcome = await scripted(task, toolset, submitted);
      active -= 1;
      return outcome;
    };
    const verification = makeVerify({
      solver,
      backendPin: "scripted/none",
      condition: SCRIPTED_CONDITION,
      thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
      capabilities: ["web-search:off"],
      runId: "run-concurrent-001",
    })({ slug: "matching", slugDir, fingerprint: fingerprintOf(slugDir), tasks });

    // SAFETY: the two copies of the three-task fixture above always supply a first task.
    const firstVerdict = join(slugDir, "runs/run-concurrent-001/cases", order[0] as string, "verifier.json");
    let gradedWhileSolving = false;
    for (let attempt = 0; attempt < 200 && !existsSync(firstVerdict); attempt += 1) await Bun.sleep(5);
    if (existsSync(firstVerdict)) gradedWhileSolving = active > 0;
    releaseHeld();
    await verification;

    const battery = parseJsonAs<{ cases: Array<{ taskId: string; pass: unknown }>; solveExecution: unknown }>(
      readFileSync(join(slugDir, "runs/run-concurrent-001/battery.json"), "utf8"),
    );
    expect(peak).toBe(3);
    expect(active).toBe(0);
    expect(gradedWhileSolving).toBe(true);
    // Grading begins while later solves are live, but the evidence keeps authored task order.
    expect(battery.cases.map((row) => row.taskId)).toEqual(order);
    for (const row of battery.cases) expect(row.pass).toBe(true);
    for (const taskId of order) {
      const caseDir = join(slugDir, "runs/run-concurrent-001/cases", taskId);
      expect(existsSync(join(caseDir, "artifact.json"))).toBe(true);
      expect(existsSync(join(caseDir, "verifier.json"))).toBe(true);
    }
    // The width a reader needs to compare two variants honestly.
    expect(battery.solveExecution).toEqual({ maxConcurrency: 3, scheduling: "bounded-worker-pool" });
    expect(verifyRunDir(join(slugDir, "runs/run-concurrent-001"))).toEqual([]);
  }, 60_000);

  it.concurrent("says a solved case is held behind earlier ones rather than going silent", async () => {
    // The pool delivers in input order, so a case that finishes early waits on every earlier one.
    // Run truss `…4c67fc` closed its last case span at "Case canopy-skewed-heads submitted" and
    // wrote nothing more while three solves were still live: from outside, a case held for its
    // turn read exactly like a verifier that had stopped answering.
    const slugDir = bundleSlug();
    const runId = "run-held-delivery";
    const observer = createRunObserver(SCRATCH_ROOT, "matching", runId);
    const observed = join(SCRATCH_ROOT, `campaigns/matching/observability/${runId}.jsonl`);
    const order = TASKS.tasks.map((task) => task.taskId);
    const scripted = scriptedSolver();
    let releaseFirst = (): void => {};
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const solver: Solver = async (task, toolset, submitted) => {
      if (task.taskId === order[0]) await firstHeld;
      return scripted(task, toolset, submitted);
    };
    const verification = makeVerify({
      solver,
      backendPin: "scripted/none",
      condition: SCRIPTED_CONDITION,
      thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
      capabilities: ["web-search:off"],
      runId,
      observer,
    })({ slug: "matching", slugDir, fingerprint: fingerprintOf(slugDir), tasks: TASKS.tasks });

    const heldRows = () =>
      (existsSync(observed) ? readFileSync(observed, "utf8") : "")
        .trim()
        .split("\n")
        .filter((line) => line !== "")
        .map((line) =>
          parseJsonAs<{
            phase?: string;
            state?: string;
            summary?: string;
            level?: string;
            subjectId?: string;
          }>(line),
        )
        .filter((row) => row.phase === "grade" && row.state === "deferred");
    // Both later cases solve at once and neither may be graded before the first one, so each has
    // to say so. Bounded, because a lost row must fail this test rather than hang it.
    for (let attempt = 0; attempt < 400 && heldRows().length < 2; attempt += 1) await Bun.sleep(5);
    const held = heldRows();
    releaseFirst();
    await verification;

    expect(held.map((row) => row.summary)).toEqual(
      order.slice(1).map((taskId, offset) => {
        const ahead = offset + 1;
        return `Case ${taskId} solved, held behind ${ahead} earlier case${ahead === 1 ? "" : "s"}`;
      }),
    );
    // A held case is how this pool is built to work, so the row is a fact at the default level.
    for (const row of held) expect(row.level).toBe("default");
    // The first case is never behind anything, and every case still grades in authored order.
    expect(heldRows().map((row) => row.subjectId)).toEqual(order.slice(1));
    const battery = parseJsonAs<{ cases: Array<{ taskId: string }> }>(
      readFileSync(join(slugDir, `runs/${runId}/battery.json`), "utf8"),
    );
    expect(battery.cases.map((row) => row.taskId)).toEqual(order);
  }, 60_000);

  it.each([false, true])(
    "logs skipped grading only after a real verifier lifetime stop: %s",
    async (stop) => {
      const slugDir = bundleSlug();
      const verifierLifetime = createVerifierLifetime({ root: join(slugDir, "lifetime") });
      const safeguardContext = createSafeguardContext(join(slugDir, "safeguards/r1"));
      let solved = 0;
      const verification = makeVerify({
        backendPin: "scripted/none",
        condition: SCRIPTED_CONDITION,
        thresholdManifestDigest: SCRIPTED_THRESHOLD_DIGEST,
        capabilities: ["web-search:off"],
        runId: "r1",
        verifierLifetime,
        safeguardContext,
        solver: async () => {
          if (solved++ === 0 && stop) {
            const lease = verifierLifetime.begin({ role: "evaluator" });
            lease.settle({
              receiptId: lease.id,
              exit: null,
              groupReaped: false,
              outputComplete: false,
              timedOut: true,
            });
          }
          return { turns: 1, completedTurns: 1, errors: [] };
        },
      })({ slug: "matching", slugDir, fingerprint: fingerprintOf(slugDir), tasks: TASKS.tasks });

      if (stop) await expect(verification).rejects.toThrow("verifier process cleanup is incomplete");
      else await verification;
      // Every case still solved: the stop bounds grading, not the battery's own denominator.
      expect(solved).toBe(TASKS.tasks.length);
      const battery = JSON.parse(readFileSync(join(slugDir, "runs/r1/battery.json"), "utf8"));
      expect(battery.cases).toHaveLength(stop ? 1 : TASKS.tasks.length);
      const logPath = join(safeguardContext.logDir, SAFEGUARDS_LOG_FILE);
      if (stop) {
        expect(readFileSync(logPath, "utf8").split("45-case-grading-skipped")).toHaveLength(
          TASKS.tasks.length,
        );
      } else expect(existsSync(logPath)).toBe(false);
    },
  );
});

describe("the battery stops scheduling after consecutive provider non-results", () => {
  const fakeTask = (id: string): BuildTask => ({
    taskId: id,
    family: "single-part",
    publicInput: { parts: [], bindings: [] },
    hidden: [],
  });
  const instants = { startedAt: "2026-08-23T00:00:00.000Z", endedAt: "2026-08-23T00:00:01.000Z" };
  const providerCase = (task: BuildTask): SolvedCase => ({
    task,
    committed: commitPublicTask(task),
    solved: nonResultOutcome({ kind: "provider", message: "status 429: usage limit reached" }),
    final: null,
    finalDefect: null,
    acceptedSubmit: false,
    instants,
  });

  it.concurrent("records the tasks it never scheduled as typed provider non-results naming the stop", async () => {
    const tasks = Array.from({ length: 12 }, (_, index) => fakeTask(`t${String(index)}`));
    let attempted = 0;
    const solved = await solveBatteryWithProviderStop(
      tasks,
      (task) => {
        attempted += 1;
        return Promise.resolve(providerCase(task));
      },
      BUILT_SOLVE_MAX_CONCURRENCY,
    );
    expect(solved).toHaveLength(12);
    // The stop fills after five consecutive failures; only cases the pool had already pulled when
    // it filled may add attempts beyond that.
    expect(attempted).toBeGreaterThanOrEqual(BATTERY_PROVIDER_STOP_CONSECUTIVE);
    expect(attempted).toBeLessThanOrEqual(BATTERY_PROVIDER_STOP_CONSECUTIVE + BUILT_SOLVE_MAX_CONCURRENCY);
    const skipped = solved.filter((row) =>
      (row.solved.nonResult?.message ?? "").includes("stopped scheduling"),
    );
    expect(skipped).toHaveLength(12 - attempted);
    for (const row of skipped) {
      expect(row.solved.nonResult?.kind).toBe("provider");
      expect(row.acceptedSubmit).toBe(false);
    }
  });

  it.concurrent("a recovery between failures resets the count and the battery runs to the end", async () => {
    const tasks = Array.from({ length: 12 }, (_, index) => fakeTask(`t${String(index)}`));
    let attempted = 0;
    const solved = await solveBatteryWithProviderStop(
      tasks,
      (task) => {
        attempted += 1;
        // Every third attempt recovers as an ordinary unaccepted attempt, so the longest possible
        // consecutive-provider run stays under the threshold even under pool reordering.
        if (attempted % 3 === 0) {
          return Promise.resolve({
            task,
            committed: commitPublicTask(task),
            solved: { turns: 1, completedTurns: 1, errors: [], toolCalls: 1, startedToolCalls: 1 },
            final: null,
            finalDefect: null,
            acceptedSubmit: false,
            instants,
          });
        }
        return Promise.resolve(providerCase(task));
      },
      BUILT_SOLVE_MAX_CONCURRENCY,
    );
    expect(attempted).toBe(12);
    expect(solved.some((row) => (row.solved.nonResult?.message ?? "").includes("stopped scheduling"))).toBe(
      false,
    );
  });
});

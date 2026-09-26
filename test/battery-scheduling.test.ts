/**
 * How a battery schedules its cases: the pool width it holds, when grading starts, what it does
 * with the cases it never ran, and when it stops scheduling at all.
 *
 * Two recorded failures own this file. Run truss-w35-opus lost 15 of 25 cases to one unbroken
 * sequence of provider usage-limit failures and kept scheduling into it. And a verifier lifetime
 * that stopped mid-battery silently graded nothing further, so the recorded pack was short with
 * no line saying why.
 */

import { existsSync, readFileSync } from "../src/meta/filesystem.ts";
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
} from "../src/correctness-bundle/battery-provider-stop.ts";
import { type SolveOutcome, type Solver, nonResultOutcome } from "../src/correctness-bundle/solve.ts";
import type { BuildTask } from "../src/correctness-bundle/tasks.ts";
import { commitPublicTask } from "../src/correctness-bundle/task-split.ts";
import { createVerifierLifetime } from "../src/verify/verifier-lifetime.ts";
import {
  SCRATCH_ROOT,
  TASKS,
  bundleSlug,
  matchingBattery,
  removeScratchRoot,
  scriptedSolver,
  scriptedVerify,
} from "./helpers/verification-runner-fixtures.ts";

afterAll(removeScratchRoot);

/** Waits, bounded, for a condition another worker makes true; a lost event fails the test rather than hanging it. */
async function until(done: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 400 && !done(); attempt += 1) await Bun.sleep(5);
}

const batteryOf = (slugDir: string, runId: string) =>
  parseJsonAs<{ cases: Array<{ taskId: string; pass: unknown }>; solveExecution: unknown }>(
    readFileSync(join(slugDir, "runs", runId, "battery.json"), "utf8"),
  );

describe("the solve pool", () => {
  it.concurrent("holds its width, grades a settled case before the pool drains, and keeps task order", async () => {
    const slugDir = bundleSlug();
    // Six cases against a width of three, so the pool must queue rather than start them all.
    const tasks = [...TASKS.tasks, ...TASKS.tasks.map((task) => ({ ...task, taskId: `${task.taskId}b` }))];
    const order = tasks.map((task) => task.taskId);
    const scripted = scriptedSolver();
    const waveFull = Promise.withResolvers<void>();
    const held = Promise.withResolvers<void>();
    let active = 0;
    let peak = 0;
    const solver: Solver = async (task, toolset, submitted) => {
      peak = Math.max(peak, ++active);
      // The first case may finish once the other two have started; the rest stay live until the
      // assertion below has seen its verifier evidence.
      if (task.taskId !== order[0] && active === 3) waveFull.resolve();
      await (task.taskId === order[0] ? waveFull.promise : held.promise);
      const outcome = await scripted(task, toolset, submitted);
      active -= 1;
      return outcome;
    };
    const runId = "run-concurrent-001";
    const verification = scriptedVerify(runId, { solver })({ ...matchingBattery(slugDir), tasks });

    const firstVerdict = join(slugDir, "runs", runId, "cases", String(order[0]), "verifier.json");
    await until(() => existsSync(firstVerdict));
    const gradedWhileSolving = existsSync(firstVerdict) && active > 0;
    held.resolve();
    await verification;

    const battery = batteryOf(slugDir, runId);
    expect([peak, active, gradedWhileSolving]).toEqual([3, 0, true]);
    // Grading begins while later solves are live, but the evidence keeps authored task order.
    expect(battery.cases).toEqual(order.map((taskId) => expect.objectContaining({ taskId, pass: true })));
    // The width a reader needs to compare two variants honestly.
    expect(battery.solveExecution).toEqual({ maxConcurrency: 3, scheduling: "bounded-worker-pool" });
    expect(verifyRunDir(join(slugDir, "runs", runId))).toEqual([]);
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
    const firstHeld = Promise.withResolvers<void>();
    const solver: Solver = async (task, toolset, submitted) => {
      if (task.taskId === order[0]) await firstHeld.promise;
      return scripted(task, toolset, submitted);
    };
    const verification = scriptedVerify(runId, { solver, observer })(matchingBattery(slugDir));

    type Row = { phase?: string; state?: string; summary?: string; level?: string; subjectId?: string };
    const heldRows = () =>
      (existsSync(observed) ? readFileSync(observed, "utf8") : "")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => parseJsonAs<Row>(line))
        .filter((row) => row.phase === "grade" && row.state === "deferred");
    // Both later cases solve at once and neither may be graded before the first one, so each has
    // to say so.
    await until(() => heldRows().length >= 2);
    const held = heldRows();
    firstHeld.resolve();
    await verification;

    // A held case is how this pool is built to work, so the row is a fact at the default level.
    expect(held).toEqual(
      order.slice(1).map((taskId, offset) =>
        expect.objectContaining({
          subjectId: taskId,
          level: "default",
          summary: `Case ${taskId} solved, held behind ${offset + 1} earlier case${offset === 0 ? "" : "s"}`,
        }),
      ),
    );
    // The first case is never behind anything, and every case still grades in authored order.
    expect(heldRows().map((row) => row.subjectId)).toEqual(order.slice(1));
    expect(batteryOf(slugDir, runId).cases.map((row) => row.taskId)).toEqual(order);
  }, 60_000);

  it.each([false, true])(
    "logs skipped grading only after a real verifier lifetime stop: %s",
    async (stop) => {
      const slugDir = bundleSlug();
      const verifierLifetime = createVerifierLifetime({ root: join(slugDir, "lifetime") });
      const safeguardContext = createSafeguardContext(join(slugDir, "safeguards/r1"));
      let solved = 0;
      const solver: Solver = async () => {
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
      };
      const verification = scriptedVerify("r1", { solver, verifierLifetime, safeguardContext })(
        matchingBattery(slugDir),
      );

      if (stop) await expect(verification).rejects.toThrow("verifier process cleanup is incomplete");
      else await verification;
      // Every case still solved: the stop bounds grading, not the battery's own denominator.
      const total = TASKS.tasks.length;
      expect(solved).toBe(total);
      expect(batteryOf(slugDir, "r1").cases).toHaveLength(stop ? 1 : total);
      const logPath = join(safeguardContext.logDir, SAFEGUARDS_LOG_FILE);
      const skipped = existsSync(logPath)
        ? readFileSync(logPath, "utf8").split("45-case-grading-skipped").length - 1
        : 0;
      expect(skipped).toBe(stop ? total - 1 : 0);
    },
  );
});

describe("the battery stops scheduling after consecutive provider non-results", () => {
  const tasks = Array.from(
    { length: 12 },
    (_, index): BuildTask => ({
      taskId: `t${String(index)}`,
      family: "single-part",
      publicInput: { parts: [], bindings: [] },
      hidden: [],
    }),
  );
  const provider = nonResultOutcome({ kind: "provider", message: "status 429: usage limit reached" });
  const unaccepted: SolveOutcome = {
    turns: 1,
    completedTurns: 1,
    errors: [],
    toolCalls: 1,
    startedToolCalls: 1,
  };
  /** Solves the battery, answering the n-th attempt (from 1) with what `outcome` returns for it. */
  async function run(outcome: (attempt: number) => SolveOutcome) {
    let attempted = 0;
    const solved = await solveBatteryWithProviderStop(
      tasks,
      (task) =>
        Promise.resolve({
          task,
          committed: commitPublicTask(task),
          solved: outcome(++attempted),
          final: null,
          finalDefect: null,
          acceptedSubmit: false,
          instants: { startedAt: "2026-08-23T00:00:00.000Z", endedAt: "2026-08-23T00:00:01.000Z" },
        }),
      BUILT_SOLVE_MAX_CONCURRENCY,
    );
    const skipped = solved.filter((row) =>
      (row.solved.nonResult?.message ?? "").includes("stopped scheduling"),
    );
    return { attempted, solved, skipped };
  }

  it.concurrent("records the tasks it never scheduled as typed provider non-results naming the stop", async () => {
    const { attempted, solved, skipped } = await run(() => provider);
    expect(solved).toHaveLength(12);
    // The stop fills after five consecutive failures; only cases the pool had already pulled when
    // it filled may add attempts beyond that.
    expect(attempted).toBeGreaterThanOrEqual(BATTERY_PROVIDER_STOP_CONSECUTIVE);
    expect(attempted).toBeLessThanOrEqual(BATTERY_PROVIDER_STOP_CONSECUTIVE + BUILT_SOLVE_MAX_CONCURRENCY);
    expect(skipped).toHaveLength(12 - attempted);
    for (const row of skipped) {
      expect(row).toMatchObject({ solved: { nonResult: { kind: "provider" } }, acceptedSubmit: false });
    }
  });

  it.concurrent("a recovery between failures resets the count and the battery runs to the end", async () => {
    // Every third attempt recovers as an ordinary unaccepted attempt, so the longest possible
    // consecutive-provider run stays under the threshold even under pool reordering.
    const { attempted, skipped } = await run((attempt) => (attempt % 3 === 0 ? unaccepted : provider));
    expect(attempted).toBe(12);
    expect(skipped).toEqual([]);
  });
});

import { describe, expect, it } from "bun:test";
import {
  BUILT_SOLVE_MAX_CONCURRENCY,
  builtSolveConcurrency,
  JUDGE_MAX_CONCURRENCY,
  mapWithConcurrencyLimit,
  runJudgeBatches,
} from "../src/run/session-pool.ts";

/** Yield to the event loop `count` times without a timer, so completion order is decided by the
 *  script rather than by machine speed. */
async function ticks(count: number): Promise<void> {
  for (let tick = 0; tick < count; tick += 1) await new Promise((resolve) => setImmediate(resolve));
}

describe("session pool", () => {
  it("returns results in input order when work completes out of order", async () => {
    const inputs = [0, 1, 2, 3, 4, 5, 6];
    const completed: number[] = [];
    const outputs = await mapWithConcurrencyLimit(inputs, 3, async (input) => {
      await ticks(inputs.length - input);
      completed.push(input);
      return `case-${input}`;
    });
    expect(outputs).toEqual(inputs.map((input) => `case-${input}`));
    // The guard is only meaningful if the work really did settle out of order.
    expect(completed).not.toEqual(inputs);
  });

  it("reports worker settlement before ordered delivery finishes", async () => {
    const releaseDelivery = Promise.withResolvers<void>();
    const workersSettled = Promise.withResolvers<void>();
    const events: string[] = [];
    const run = mapWithConcurrencyLimit(
      [0, 1],
      2,
      async (input) => input,
      async (output, index) => {
        events.push(`output-${output}`);
        if (index === 0) await releaseDelivery.promise;
      },
      () => {
        events.push("workers");
        workersSettled.resolve();
      },
    );
    await workersSettled.promise;
    expect(events).toEqual(["output-0", "workers"]);
    releaseDelivery.resolve();
    await run;
    expect(events).toEqual(["output-0", "workers", "output-1"]);
  });

  it("never runs more than the width at once, and still runs that many", async () => {
    let active = 0;
    let peak = 0;
    await mapWithConcurrencyLimit([1, 2, 3, 4, 5, 6, 7, 8], BUILT_SOLVE_MAX_CONCURRENCY, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await ticks(2);
      active -= 1;
      return null;
    });
    expect(peak).toBe(BUILT_SOLVE_MAX_CONCURRENCY);
    expect(active).toBe(0);
  });

  it("holds the two widths apart: the judge session stays wider than the battery session", () => {
    expect(JUDGE_MAX_CONCURRENCY).toBe(5);
    expect(BUILT_SOLVE_MAX_CONCURRENCY).toBe(3);
  });

  // The harness declares the Built width and the operator may bound it; a malformed value refuses
  // rather than falling back, because a silently changed width is a changed measurement condition.
  it("takes the Built width from the harness, lets ANA_BUILT_CONCURRENCY override it, and refuses a malformed one", () => {
    expect(builtSolveConcurrency(undefined, {})).toBe(3);
    expect(builtSolveConcurrency(8, {})).toBe(8);
    expect(builtSolveConcurrency(8, { ANA_BUILT_CONCURRENCY: "" })).toBe(8);
    // The operator's bound wins in both directions: it is the provider session limit being spent.
    expect(builtSolveConcurrency(8, { ANA_BUILT_CONCURRENCY: "2" })).toBe(2);
    expect(builtSolveConcurrency(2, { ANA_BUILT_CONCURRENCY: "6" })).toBe(6);
    for (const raw of ["0", "-2", "2.5", "six", "06"]) {
      expect(() => builtSolveConcurrency(8, { ANA_BUILT_CONCURRENCY: raw })).toThrow(
        "ANA_BUILT_CONCURRENCY must be a positive integer",
      );
    }
  });

  it("an empty input list opens no worker", async () => {
    let invoked = 0;
    const outputs = await mapWithConcurrencyLimit([], 3, async () => {
      invoked += 1;
      return null;
    });
    expect(outputs).toEqual([]);
    expect(invoked).toBe(0);
  });

  it("awaits the calls already running before it raises the first failure", async () => {
    const started: number[] = [];
    const completed: number[] = [];
    await expect(
      mapWithConcurrencyLimit([0, 1, 2, 3, 4, 5], BUILT_SOLVE_MAX_CONCURRENCY, async (input: number) => {
        started.push(input);
        if (input === 0) {
          await ticks(1);
          throw new Error("case 0 failed");
        }
        await ticks(6);
        completed.push(input);
        return input;
      }),
    ).rejects.toThrow("case 0 failed");
    // Both siblings ran to completion. Raising at the first rejection would return here with two
    // paid model sessions still open, still writing into their case directories, and with their
    // children unreaped — nothing else closes them, because a worker settles only when they do.
    expect(completed).toEqual([1, 2]);
    // The failure also stops the pool taking work it would only have to abandon.
    expect(started).toEqual([0, 1, 2]);
  });

  it("raises the earliest input's failure, not whichever failed first in time", async () => {
    // A provider outage takes every live case at once, so two failures in one round is ordinary.
    // Input 2 settles well before input 0 here; a serial run would have stopped at 0, and a rerun
    // of the same battery has to name the same case rather than the fastest child.
    const started: number[] = [];
    await expect(
      mapWithConcurrencyLimit([0, 1, 2, 3, 4, 5], BUILT_SOLVE_MAX_CONCURRENCY, async (input: number) => {
        started.push(input);
        if (input === 2) throw new Error("case 2 failed");
        if (input === 0) {
          await ticks(4);
          throw new Error("case 0 failed");
        }
        await ticks(8);
        return input;
      }),
    ).rejects.toThrow("case 0 failed");
    // The guard is only meaningful if case 2 really did run and fail first.
    expect(started).toContain(2);
  });

  it("runJudgeBatches stops after a refused batch — the judge's paid-spend stop, not the battery's", async () => {
    const seen: number[] = [];
    const batches: number[][] = [];
    await runJudgeBatches(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      async (input) => {
        seen.push(input);
        return input;
      },
      (batch) => {
        batches.push([...batch]);
        return batch.every((input) => input < JUDGE_MAX_CONCURRENCY);
      },
    );
    // Batch 1 (1..5) contains 5, so it is refused and batch 2 never runs.
    expect(batches).toEqual([[1, 2, 3, 4, 5]]);
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it("runJudgeBatches takes a width, and a width past the input count is one batch rather than an error", async () => {
    const batches: number[][] = [];
    await runJudgeBatches(
      [1, 2, 3, 4, 5, 6, 7],
      async (input) => input,
      (batch) => {
        batches.push([...batch]);
        return true;
      },
      64,
    );
    expect(batches).toEqual([[1, 2, 3, 4, 5, 6, 7]]);
    const narrow: number[][] = [];
    await runJudgeBatches(
      [1, 2, 3, 4, 5],
      async (input) => input,
      (batch) => {
        narrow.push([...batch]);
        return true;
      },
      2,
    );
    expect(narrow).toEqual([[1, 2], [3, 4], [5]]);
    // A width below one would divide the loop by zero and never terminate.
    const floored: number[][] = [];
    await runJudgeBatches(
      [1, 2],
      async (input) => input,
      (batch) => {
        floored.push([...batch]);
        return true;
      },
      0,
    );
    expect(floored).toEqual([[1], [2]]);
  });
});

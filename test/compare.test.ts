// The comparison's arithmetic against the plan's own figures, and its view over the log: what counts
// in a score, and what it refuses to compare.
import { describe, expect, it } from "bun:test";
import { anchor, draw, gain, pairsOf, scored, signP, solveSeconds, tally } from "../src/kernel/compare.ts";
import { type Condition, conditionId, fieldsApart } from "../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";

const [P, F] = [true, false];
/** A task the new harness wins, loses or ties, on three solves a harness. */
const pairs = (wins: number, losses: number, ties: number) => [
  ...Array.from({ length: wins }, (_, i) => ({ task: `w${String(i)}`, old: [F, F, P], fresh: [P, P, F] })),
  ...Array.from({ length: losses }, (_, i) => ({ task: `l${String(i)}`, old: [P, P, P], fresh: [P, F, P] })),
  ...Array.from({ length: ties }, (_, i) => ({ task: `t${String(i)}`, old: [P, F, P], fresh: [F, P, P] })),
];

describe("the pooled gain", () => {
  it("is the mean of the tasks' gains in points, bounded above at 90% over the tasks", () => {
    // 6 wins of a third, 1 loss of a third and 17 ties, on three solves a harness.
    const { points, upper } = gain(pairs(6, 1, 17));
    expect(points).toBeCloseTo((100 * (6 - 1)) / 3 / 24, 10);
    // Student's bound on 24 tasks: the 90th percentile on 23 degrees of freedom is 1.3195.
    const gains = [
      ...Array.from({ length: 6 }, () => 100 / 3),
      -100 / 3,
      ...Array.from({ length: 17 }, () => 0),
    ];
    const spread = Math.sqrt(gains.reduce((sum, each) => sum + (each - points) ** 2, 0) / 23);
    expect(upper).toBeCloseTo(points + (1.3195 * spread) / Math.sqrt(24), 2);
    expect(upper).toBeLessThan(10 + points);
  });

  it("bounds nothing on fewer than two tasks, and reads no spread as no doubt", () => {
    expect(gain([])).toEqual({ points: 0, upper: 100 });
    expect(gain(pairs(1, 0, 0))).toMatchObject({ upper: 100 });
    expect(gain(pairs(0, 0, 5))).toEqual({ points: 0, upper: 0 });
  });
});

describe("the sign test", () => {
  it("passes the plan's smallest wins at 0.10 and nothing one win short of them", () => {
    const smallest = [
      [4, 0],
      [6, 1],
      [7, 2],
      [9, 3],
    ] as const;
    expect(smallest.map(([wins, losses]) => signP(wins, losses))).toEqual([
      0.0625, 0.0625, 0.08984375, 0.072998046875,
    ]);
    expect(smallest.every(([wins, losses]) => signP(wins - 1, losses) > 0.1)).toBe(true);
    expect(signP(0, 0)).toBe(1);
  });

  it("counts a task once by how often each harness passed it, and leaves ties out of the test", () => {
    expect(tally(pairs(6, 1, 17))).toEqual({ wins: 6, losses: 1, ties: 17 });
    expect(scored(pairs(6, 1, 17)).p).toBe(0.0625);
    expect(scored(pairs(5, 1, 18)).p).toBe(0.109375);
    expect(() => tally([{ task: "t", old: [P, P, P], fresh: [P, P] }])).toThrow(
      "task t has 3 solve(s) under the old harness and 2 under the new",
    );
  });
});

describe("the anchor", () => {
  const easy = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ task: `e${String(i)}`, old: [P, P, P], fresh: [P, P, P] }));

  it("is held or lost by the same test turned round, on the tasks that can inform it", () => {
    expect(anchor([...pairs(2, 3, 5), ...easy(14)], 0.1, 8)).toEqual({
      wins: 2,
      losses: 3,
      ties: 19,
      informative: 10,
      reading: "held",
    });
    expect(anchor([...pairs(0, 4, 4), ...easy(16)], 0.1, 8).reading).toBe("lost");
    // One win against three losses is held at 0.10 and lost at a looser level the caller may give.
    expect(anchor([...pairs(1, 3, 4), ...easy(16)], 0.1, 8).reading).toBe("held");
    expect(anchor([...pairs(1, 3, 4), ...easy(16)], 0.35, 8).reading).toBe("lost");
  });

  it("is not tested by tasks both harnesses always fail, which can show neither a win nor a loss", () => {
    const dead = Array.from({ length: 20 }, (_, i) => ({
      task: `d${String(i)}`,
      old: [F, F, F],
      fresh: [F, F, F],
    }));
    expect(anchor([...dead, ...easy(4)], 0.1, 8)).toMatchObject({ informative: 0, reading: "not-tested" });
    expect(anchor([...dead, ...pairs(1, 0, 2)], 0.1, 8)).toMatchObject({
      informative: 3,
      reading: "not-tested",
    });
  });

  it("is not tested, rather than held, below the floor of informative tasks", () => {
    expect(anchor([...pairs(1, 0, 4), ...easy(19)], 0.1, 8)).toMatchObject({
      informative: 5,
      reading: "not-tested",
    });
  });
});

describe("a draw", () => {
  const pool = ["v1", "v2", "v3", "v4", "v5", "v6"];

  it("replays from its seed, moves no rank when the pool grows, and refuses a short pool", () => {
    const first = draw(pool, 3, "seed-a");
    expect(draw(pool.toReversed(), 3, "seed-a")).toEqual(first);
    expect(draw(pool, 3, "seed-b")).not.toEqual(first);
    const grown = draw([...pool, "v7"], 7, "seed-a").filter((version) => version !== "v7");
    expect(grown).toEqual(draw(pool, 6, "seed-a"));
    expect(() => draw(["v1", "v1"], 2, "seed-a")).toThrow("a draw of 2 needs as many task versions; 1 given");
  });
});

describe("the pairs a comparison reads from the log", () => {
  const at = "2026-10-08T00:00:00.000Z";
  const event = (kind: EventKind, data: JsonObject): LogEvent => ({ at, kind, data });
  const base: Condition = {
    contract: "c1",
    harness: "old",
    task: "v1",
    model: "claude/claude-sonnet-5-5",
    effort: "high",
    prices: { "claude/claude-sonnet-5-5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
    runtime: {},
    compaction: "off",
    solverTools: "old",
    verifierTools: "t1",
    sandbox: "p1",
    limits: {
      wallSeconds: 7_200,
      turns: 60,
      shellDefaultSeconds: 300,
      shellMaxSeconds: 900,
      concurrency: 4,
      diskBytes: 2 * 1024 ** 3,
    },
    host: "h1",
    side: "test",
  };
  const feasible = (version: string) => [
    event("task.proposed", { version }),
    ...[1, 2, 3, 4].map((gate) => event("task.gate", { version, gate, outcome: "passed", controls: "d" })),
  ];
  let solves = 0;
  /** One solve of `condition`'s task, recorded as the runner records one. */
  const solve = (condition: Condition, outcome: "pass" | "fail" | "non-result", seconds?: number) => {
    solves += 1;
    const [id, name] = [conditionId(condition), `s-${String(solves)}`];
    return [
      event("condition.recorded", { id, condition: requireJsonValue(condition) }),
      event("solve.started", { solve: name, condition: id, task: "t" }),
      event("solve.finished", {
        solve: name,
        ending: { outcome },
        ...keyIfDefined("seconds", seconds),
      }),
    ];
  };
  const fresh: Condition = { ...base, harness: "new", solverTools: "new" };
  const admitted = [
    ...feasible("v0"),
    event("anchor.drawn", { tasks: ["v0"] }),
    ...feasible("v1"),
    // Screening: one fail by the old harness admits the task, and neither solve is scored.
    ...solve(base, "fail"),
    ...solve(fresh, "pass"),
    event("task.state", { version: "v1", state: "admitted" }),
  ];

  it("names the fields two conditions differ in", () => {
    expect(fieldsApart(base, fresh)).toEqual(["harness", "solverTools"]);
    expect(fieldsApart(base, { ...base, limits: { ...base.limits, turns: 80 } })).toEqual(["limits"]);
  });

  it("counts a task's solves from its admission, the test side's passes and fails only", () => {
    const log = [
      ...admitted,
      ...solve(base, "pass", 600),
      ...solve(fresh, "non-result", 60),
      ...solve(fresh, "pass", 300),
      ...solve({ ...fresh, side: "strong" }, "pass", 60),
      ...solve(base, "fail", 900),
      ...solve(fresh, "pass"),
      ...solve({ ...base, task: "v0" }, "pass"),
      ...solve({ ...fresh, task: "v0" }, "fail"),
    ];
    const untimed = { old: [null], fresh: [null] };
    const counted = pairsOf(log, ["v1", "v0"], "old", "new");
    // Each counted solve is named, in the order its pass or fail is listed: the non-result and the
    // stronger side's solve, s-4 and s-6, are not among them.
    const anchored = {
      task: "v0",
      old: [P],
      fresh: [F],
      seconds: untimed,
      solves: { old: ["s-9"], fresh: ["s-10"] },
    };
    expect(counted).toEqual({
      pairs: [
        {
          task: "v1",
          old: [P, F],
          fresh: [P, P],
          seconds: { old: [600, 900], fresh: [300, null] },
          solves: { old: ["s-3", "s-7"], fresh: ["s-5", "s-8"] },
        },
        anchored,
      ],
      disputed: [],
    });
    // Each harness's mean over the counted solves the log timed.
    expect(solveSeconds(counted.pairs)).toEqual({ old: 750, fresh: 300 });
    expect(solveSeconds([])).toEqual({ old: null, fresh: null });
    // A check defect ruled on the scored task takes it out on both sides, and it is named.
    const disputed = [...log, event("task.state", { version: "v1", state: "disputed" })];
    expect(pairsOf(disputed, ["v1", "v0"], "old", "new")).toEqual({
      pairs: [anchored],
      disputed: ["v1"],
    });
  });

  it("scores a version that continues an anchor task from its own proposal, on its own solves alone", () => {
    const next: Condition = { ...base, task: "v0b" };
    const log = [
      ...admitted,
      // The old version's solves were made under the checker the campaign left.
      ...solve({ ...base, task: "v0" }, "fail"),
      ...solve({ ...fresh, task: "v0" }, "fail"),
      event("task.proposed", { version: "v0b", continues: "v0" }),
      ...[1, 2, 3, 4].map((gate) =>
        event("task.gate", { version: "v0b", gate, outcome: "passed", controls: "d" }),
      ),
      event("task.state", { version: "v0", state: "stale" }),
      // One of them graded again for the new version places it and scores nothing.
      event("verdict.regraded", { solve: "s-1", version: "v0b", ending: { outcome: "pass" } }),
      ...solve(next, "pass"),
      ...solve({ ...next, harness: "new", solverTools: "new" }, "fail"),
    ];
    expect(pairsOf(log, ["v0b"], "old", "new").pairs).toMatchObject([
      { task: "v0b", old: [P], fresh: [F], seconds: { old: [null], fresh: [null] } },
    ]);
    expect(() => pairsOf(log, ["v0"], "old", "new")).toThrow(
      "task v0 is stale; only an admitted task or an anchor task is scored",
    );
    // A version that continues a task outside the anchor is scored only once a round admits it.
    const outside = [...log, event("task.proposed", { version: "v1b", continues: "v1" })];
    expect(() => pairsOf(outside, ["v1b"], "old", "new")).toThrow("task v1b is held; only an admitted task");
  });

  it("refuses a released task, and solves that differ in more than the harness", () => {
    const released = [...admitted, event("task.state", { version: "v1", state: "released" })];
    expect(() => pairsOf(released, ["v1"], "old", "new")).toThrow(
      "task v1 is released; only an admitted task or an anchor task is scored",
    );
    const moved = [...admitted, ...solve(base, "pass"), ...solve({ ...fresh, host: "h2" }, "pass")];
    expect(() => pairsOf(moved, ["v1"], "old", "new")).toThrow(
      "task v1: its solves differ in host, and a comparison holds everything but the harness",
    );
    expect(() => pairsOf(admitted, ["v9"], "old", "new")).toThrow("task v9 is not proposed");
  });
});

// The comparison's arithmetic against the plan's own figures, and its view over the log: which
// solves count for a held-out task under a harness, and what it refuses to compare.
import { describe, expect, it } from "bun:test";
import { draw, pairings, pairsOf, scored, signP, spread, tally, within } from "../src/kernel/compare.ts";
import { type Condition, conditionId, fieldsApart, settingId } from "../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";

const [P, F] = [true, false];
/** A task the new harness wins, loses or ties, on three solves a harness. */
const pairs = (wins: number, losses: number, ties: number) => [
  ...Array.from({ length: wins }, (_, i) => ({ task: `w${String(i)}`, old: [F, F, P], fresh: [P, P, F] })),
  ...Array.from({ length: losses }, (_, i) => ({ task: `l${String(i)}`, old: [P, P, P], fresh: [P, F, P] })),
  ...Array.from({ length: ties }, (_, i) => ({ task: `t${String(i)}`, old: [P, F, P], fresh: [F, P, P] })),
];
/** What a solve used, where a case names only some of it. */
const used = (turns: number | null, cpu: number | null = null, seconds: number | null = null) => ({
  turns,
  prompts: null,
  cpu,
  seconds,
  billed: null,
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

  it("counts a task once by how often each harness was valid, and leaves ties out of the test", () => {
    expect(tally(pairs(6, 1, 17))).toEqual({ wins: 6, losses: 1, ties: 17 });
    expect(scored(pairs(6, 1, 17)).p).toBe(0.0625);
    expect(scored(pairs(5, 1, 18)).p).toBe(0.109375);
    expect(() => tally([{ task: "t", old: [P, P, P], fresh: [P, P] }])).toThrow(
      "task t has 3 solve(s) under the old harness and 2 under the new",
    );
  });
});

describe("a task's pairings", () => {
  it("gives a valid answer the pair over one that is not, and leaves two alike even", () => {
    // Two solves a side: the new harness is valid twice, the reference once.
    expect(pairings({ task: "t", old: [P, F], fresh: [P, P] })).toEqual({ fresh: 2, old: 0 });
    // Two valid answers are even, however good either is: no objective is read.
    expect(pairings({ task: "t", old: [P, P], fresh: [P, P] })).toEqual({ fresh: 0, old: 0 });
    expect(pairings({ task: "t", old: [F, F], fresh: [F, F] })).toEqual({ fresh: 0, old: 0 });
    // One valid answer a side wins a pair each, and the task is a tie.
    expect(pairings({ task: "t", old: [P, F], fresh: [F, P] })).toEqual({ fresh: 1, old: 1 });
  });

  it("reads as the harness with more valid answers, at every split of up to four solves a side", () => {
    for (let solves = 1; solves <= 4; solves += 1) {
      for (let valid = 0; valid <= solves; valid += 1) {
        for (let other = 0; other <= solves; other += 1) {
          const side = (passes: number) => Array.from({ length: solves }, (_, nth) => nth < passes);
          const won = pairings({ task: "t", old: side(other), fresh: side(valid) });
          expect(Math.sign(won.fresh - won.old)).toBe(Math.sign(valid - other));
        }
      }
    }
  });
});

describe("the same solves at a shorter budget", () => {
  const timed = [
    {
      task: "a",
      old: [P, P],
      fresh: [P, P],
      used: { old: [used(20, 900), used(22, 400)], fresh: [used(8, 300), used(10, 350)] },
    },
    { task: "b", old: [P, F], fresh: [P, F], used: { old: [used(6), used(24)], fresh: [used(7), used(24)] } },
  ];

  it("counts a solve past the budget as no answer, valid or not, in every unit the budget names", () => {
    // At the full limit both tasks tie. At twelve turns the reference harness's answers to `a`
    // came too late and the new harness's did not.
    expect(tally(timed)).toEqual({ wins: 0, losses: 0, ties: 2 });
    const [a, b] = within(timed, { turns: 12 });
    expect(a).toMatchObject({ old: [F, F], fresh: [P, P] });
    expect(b).toMatchObject({ old: [P, F], fresh: [P, F] });
    expect(tally(within(timed, { turns: 12 }))).toEqual({ wins: 1, losses: 0, ties: 1 });
    // A budget in two units cuts on either, and a unit the log does not hold for a solve cuts nothing.
    expect(within(timed, { turns: 30, cpu: 320 })[0]).toMatchObject({ old: [F, F], fresh: [P, F] });
    expect(within(timed, { seconds: 1 })[0]).toMatchObject({ old: [P, P], fresh: [P, P] });
    expect(within([{ task: "c", old: [P], fresh: [P] }], { turns: 1 })[0]).toMatchObject({ old: [P] });
    // The prompts a solver was given are a unit of their own: one prompt may take many turns.
    const prompted = [
      {
        task: "p",
        old: [P, P],
        fresh: [P, P],
        used: {
          old: [
            { ...used(40), prompts: 1 },
            { ...used(9), prompts: 6 },
          ],
          fresh: [
            { ...used(30), prompts: 2 },
            { ...used(8), prompts: 3 },
          ],
        },
      },
    ];
    expect(within(prompted, { prompts: 3 })[0]).toMatchObject({ old: [P, F], fresh: [P, P] });
    expect(within(prompted, { turns: 12 })[0]).toMatchObject({ old: [F, P], fresh: [F, P] });
    expect(spread(prompted).prompts).toEqual({ tasks: 2, median: (1.5 + 6) / 2, most: 6 });
  });

  it("says how far the use of a unit moved between repeated solves of one harness on one task", () => {
    // Turns: 22/20, 10/8, 24/6 and 24/7. CPU seconds: 900/400 and 350/300, on task `a` alone.
    const moved = spread(timed);
    expect(moved.turns).toEqual({ tasks: 4, median: (1.25 + 24 / 7) / 2, most: 4 });
    expect(moved.cpu).toEqual({ tasks: 2, median: (350 / 300 + 2.25) / 2, most: 2.25 });
    expect(moved.seconds).toBeNull();
    expect(spread([{ task: "c", old: [P], fresh: [P] }]).turns).toBeNull();
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
  const at = "2026-10-09T00:00:00.000Z";
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
  const heldOut = (version: string) => [
    event("task.proposed", { version }),
    event("task.gate", { version, gate: 1, outcome: "passed" }),
  ];
  let solves = 0;
  /** One solve of `condition`'s task, recorded as the runner records one, for comparison `c-1`
   *  unless `spent` names another. */
  const solve = (condition: Condition, outcome: "pass" | "fail" | "non-result", spent: JsonObject = {}) => {
    solves += 1;
    const [id, name] = [conditionId(condition), `s-${String(solves)}`];
    const { comparison = "c-1", ...end } = spent;
    return [
      event("condition.recorded", { id, condition: requireJsonValue(condition) }),
      event("solve.started", { solve: name, condition: id, task: "t", comparison }),
      event("solve.finished", { solve: name, ending: { outcome }, ...end }),
    ];
  };
  const fresh: Condition = { ...base, harness: "new", solverTools: "new" };
  const sides = { old: "old", fresh: "new", setting: settingId(base), comparison: "c-1" };
  const held = [...heldOut("v0"), ...heldOut("v1")];

  it("names the fields two conditions differ in", () => {
    expect(fieldsApart(base, fresh)).toEqual(["harness", "solverTools"]);
    expect(fieldsApart(base, { ...base, limits: { ...base.limits, turns: 80 } })).toEqual(["limits"]);
  });

  it("counts every pass and fail of a held-out task under either harness, with what each used", () => {
    const log = [
      ...held,
      ...solve(base, "pass", {
        turns: 20,
        prompts: 2,
        seconds: 600,
        cpu: { seconds: 90, unmeasured: 0 },
        billed: 6.5,
      }),
      ...solve(fresh, "non-result", { seconds: 60 }),
      ...solve(fresh, "pass", { turns: 9, seconds: 300 }),
      ...solve({ ...fresh, side: "strong" }, "pass"),
      ...solve(base, "fail", { seconds: 900 }),
      ...solve(fresh, "pass"),
      ...solve({ ...base, task: "v0" }, "pass"),
      ...solve({ ...fresh, task: "v0" }, "fail"),
      // A third harness's solve of the task is no side of this comparison.
      ...solve({ ...base, harness: "starter", solverTools: "starter" }, "fail"),
    ];
    const none = { turns: null, prompts: null, cpu: null, seconds: null, billed: null };
    const counted = pairsOf(log, ["v1", "v0"], sides);
    // Each counted solve is named: the non-result and the stronger side's solve, s-2 and s-4, are
    // not among them, and neither is the starter's.
    const other = {
      task: "v0",
      old: [P],
      fresh: [F],
      solves: { old: ["s-7"], fresh: ["s-8"] },
      used: { old: [none], fresh: [none] },
    };
    expect(counted).toEqual({
      pairs: [
        {
          task: "v1",
          old: [P, F],
          fresh: [P, P],
          solves: { old: ["s-1", "s-5"], fresh: ["s-3", "s-6"] },
          used: {
            old: [
              { turns: 20, prompts: 2, cpu: 90, seconds: 600, billed: 6.5 },
              { ...none, seconds: 900 },
            ],
            fresh: [{ ...none, turns: 9, seconds: 300 }, none],
          },
        },
        other,
      ],
      disputed: [],
    });
    // The same log read against the starter pairs the same new solves with that harness's.
    expect(pairsOf(log, ["v1"], { ...sides, old: "starter" }).pairs[0]).toMatchObject({
      old: [F],
      fresh: [P, P],
    });
    // A disputed task is out on both sides, and it is named.
    const disputed = [...log, event("task.state", { version: "v1", state: "disputed" })];
    expect(pairsOf(disputed, ["v1", "v0"], sides)).toEqual({ pairs: [other], disputed: ["v1"] });
  });

  it("counts no solve that opened another harness than its condition names", () => {
    // The runner stops a comparison on such a solve, and the comparison goes on from this log: a
    // kept harness once opened without its tool tree (2026-10-09), and its answer stayed in the
    // log under the condition that names the whole harness.
    const log = [
      ...held,
      ...solve(base, "pass", { harness: "old" }),
      ...solve(fresh, "fail", { harness: "other" }),
      ...solve(fresh, "pass", { harness: "new" }),
    ];
    expect(pairsOf(log, ["v1"], sides).pairs[0]).toMatchObject({ old: [P], fresh: [P] });
  });

  it("reads no solve another solver made: a setting is the solver, its limits and the host", () => {
    const moved = { ...fresh, host: "h2" };
    const log = [...held, ...solve(base, "pass"), ...solve(moved, "pass"), ...solve(fresh, "fail")];
    expect(pairsOf(log, ["v1"], sides).pairs[0]).toMatchObject({ old: [P], fresh: [F] });
    expect(pairsOf(log, ["v1"], { ...sides, setting: settingId(moved) }).pairs[0]).toMatchObject({
      old: [],
      fresh: [P],
    });
    const slower = { ...base, limits: { ...base.limits, wallSeconds: 14_400 } };
    expect(settingId(slower)).not.toBe(settingId(base));
    const elsewhere: Condition = { ...base, task: "v0", harness: "new", solverTools: "new" };
    expect(settingId(elsewhere)).toBe(settingId(base));
  });

  it("counts the solves that name the comparison and no other: both sides are solved afresh", () => {
    // An earlier comparison, a practice solve that names none, and a later comparison's solves
    // made while this one was stopped: none of them is a solve of `c-1`.
    const log = [
      ...held,
      ...solve(base, "fail", { comparison: "c-0" }),
      ...solve(fresh, "pass", { comparison: "c-0" }),
      ...solve(base, "pass"),
      ...solve(fresh, "pass", { comparison: null }),
      ...solve(base, "fail", { comparison: "c-2" }),
      ...solve(fresh, "fail"),
    ];
    expect(pairsOf(log, ["v1"], sides).pairs[0]).toMatchObject({ old: [P], fresh: [F] });
    expect(pairsOf(log, ["v1"], { ...sides, comparison: "c-0" }).pairs[0]).toMatchObject({
      old: [F],
      fresh: [P],
    });
    expect(pairsOf(log, ["v1"], { ...sides, comparison: "c-2" }).pairs[0]).toMatchObject({
      old: [F],
      fresh: [],
    });
  });

  it("orders a side's solves by when they started, so the first taken are not the quick ones", () => {
    // Two solves in flight at once: the one started second ends first, with a valid answer, as a
    // quick solve under a budget does. The first started is still the first of its side.
    const [slow, quick] = [solve(base, "fail"), solve(base, "pass")];
    const [slowEnd, quickEnd] = [slow.at(-1), quick.at(-1)];
    if (slowEnd === undefined || quickEnd === undefined) throw new Error("a solve has an ending");
    const log = [
      ...held,
      ...slow.slice(0, 2),
      ...quick.slice(0, 2),
      quickEnd,
      slowEnd,
      ...solve(fresh, "pass"),
    ];
    expect(pairsOf(log, ["v1"], sides).pairs[0]).toMatchObject({ old: [F, P] });
  });

  it("sets a harness against itself by its halves, which is how its own noise is read", () => {
    const log = [...held, ...solve(base, "pass"), ...solve(base, "fail"), ...solve(base, "pass")];
    expect(pairsOf(log, ["v1"], { ...sides, fresh: "old", halves: 1 }).pairs[0]).toMatchObject({
      old: [P],
      fresh: [F, P],
    });
    expect(pairsOf(log, ["v1"], { ...sides, fresh: "old", halves: 2 }).pairs[0]).toMatchObject({
      old: [P, F],
      fresh: [P],
    });
  });

  it("refuses a practice task, a refused one, one never proposed, and a harness set against itself", () => {
    const released = [...held, event("task.state", { version: "v1", state: "released" })];
    expect(() => pairsOf(released, ["v1"], sides)).toThrow(
      "task v1 is released; only a held-out task is scored",
    );
    const ungated = [event("task.proposed", { version: "v2" })];
    expect(() => pairsOf(ungated, ["v2"], sides)).toThrow(
      "task v2 has not passed its gate; only a held-out task is scored",
    );
    expect(() => pairsOf(held, ["v9"], sides)).toThrow("task v9 is not proposed");
    expect(() => pairsOf(held, ["v1"], { ...sides, fresh: "old" })).toThrow(
      "a comparison sets two harnesses against each other, and both sides are old",
    );
  });
});

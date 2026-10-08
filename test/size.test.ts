// The size of the measurement, against cases small enough to work by hand: what a round can show
// before it runs, what rounds that fell short show together and what a repeat would need, whether
// tasks or solves a side buy more, and when the measurement is what binds a climb.
import { describe, expect, it } from "bun:test";
import { shortOfAStep } from "../src/builder/short.ts";
import { binding } from "../src/kernel/binding.ts";
import { signP } from "../src/kernel/compare.ts";
import { type Condition, conditionId, settingId } from "../src/kernel/condition.ts";
import type { Stand } from "../src/kernel/ladder.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import {
  boughtBy,
  chanceOfStep,
  clearing,
  EFFECTS,
  informativeOf,
  repeatOf,
  roundSize,
  shortLines,
  shortRounds,
  sizeLines,
  taskChances,
  together,
} from "../src/kernel/size.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";

const LEVEL = 0.1;
const [P, F] = [true, false];
const at = "2026-10-08T00:00:00.000Z";
const event = (kind: EventKind, data: JsonObject): LogEvent => ({ at, kind, data });
/** A round's report: its parent and child, its reading and its scored tally. */
const reported = (
  session: string,
  harnesses: readonly [string, string],
  reading: string,
  scored: readonly [number, number, number] | null,
  more: JsonObject = {},
) =>
  event("comparison.reported", {
    session,
    old: harnesses[0],
    fresh: harnesses[1],
    reading,
    scored: scored === null ? null : { wins: scored[0], losses: scored[1], ties: scored[2] },
    ...more,
  });

describe("the chance that a round's scored test clears", () => {
  it("is none without a task, under the least sweep, or when every task ties", () => {
    expect(chanceOfStep(0, { win: 1, loss: 0 }, LEVEL)).toBe(0);
    // At 0.10 the least sweep is four, so three tasks all won clear nothing.
    expect(chanceOfStep(3, { win: 1, loss: 0 }, LEVEL)).toBe(0);
    expect(chanceOfStep(24, { win: 0, loss: 0 }, LEVEL)).toBe(0);
    expect(chanceOfStep(4, { win: 1, loss: 0 }, LEVEL)).toBe(1);
  });

  it("is the binomial sum over the untied tasks and the wins among them", () => {
    // Four tasks, each a win one time in two and never a loss: only 4-0 clears, 1 in 16.
    expect(chanceOfStep(4, { win: 0.5, loss: 0 }, LEVEL)).toBe(0.0625);
    // Five such tasks clear on four or five wins: (5 + 1) / 32.
    expect(chanceOfStep(5, { win: 0.5, loss: 0 }, LEVEL)).toBe(6 / 32);
    // No tie and no true difference. Of five only 5-0 clears, and of seven 7-0 and 6-1: the test's
    // own size, which stays under its level.
    expect(chanceOfStep(5, { win: 0.5, loss: 0.5 }, LEVEL)).toBe(1 / 32);
    expect(chanceOfStep(7, { win: 0.5, loss: 0.5 }, LEVEL)).toBe(8 / 128);
  });

  it("reproduces the plan's estimate: 24 tasks see a 12-point gain about one time in three", () => {
    // Twelve tasks in a hundred won outright: fewer than four wins in 24 is the sum of four terms.
    const under = [1, 24, 276, 2024].reduce(
      (sum, ways, wins) => sum + ways * 0.12 ** wins * 0.88 ** (24 - wins),
      0,
    );
    const chance = chanceOfStep(24, { win: 0.12, loss: 0 }, LEVEL);
    expect(chance).toBeCloseTo(1 - under, 12);
    expect(chance).toBeGreaterThan(0.32);
    expect(chance).toBeLessThan(0.33);
  });
});

describe("the smallest results that clear a level", () => {
  it("are the plan's at 0.10, as far as they fit in the set", () => {
    expect(clearing(24, LEVEL).slice(0, 4)).toEqual([
      { wins: 4, losses: 0 },
      { wins: 6, losses: 1 },
      { wins: 7, losses: 2 },
      { wins: 9, losses: 3 },
    ]);
    // Each is the fewest wins beside its losses, by the comparison's own test.
    for (const { wins, losses } of clearing(24, LEVEL)) {
      expect(signP(wins, losses)).toBeLessThanOrEqual(LEVEL);
      expect(signP(wins - 1, losses)).toBeGreaterThan(LEVEL);
      expect(wins + losses).toBeLessThanOrEqual(24);
    }
    expect(clearing(6, LEVEL)).toEqual([{ wins: 4, losses: 0 }]);
    expect(clearing(7, LEVEL)).toHaveLength(2);
    expect(clearing(3, LEVEL)).toEqual([]);
    expect(clearing(0, LEVEL)).toEqual([]);
  });
});

describe("one task's chances at so many solves a side", () => {
  it("do not move with the solves when both harnesses are settled", () => {
    for (const solves of [1, 3, 6]) {
      expect(taskChances({ old: 0, fresh: 1 }, solves)).toEqual({ win: 1, loss: 0 });
      expect(taskChances({ old: 1, fresh: 1 }, solves)).toEqual({ win: 0, loss: 0 });
    }
  });

  it("are the chance of more passes under the new harness, and under the old", () => {
    // One solve a side at 1 in 3 against 2 in 3: a win is a fail and a pass, 2/3 x 2/3.
    const once = taskChances({ old: 1 / 3, fresh: 2 / 3 }, 1);
    expect(once.win).toBeCloseTo(4 / 9, 12);
    expect(once.loss).toBeCloseTo(1 / 9, 12);
    // No true difference at one half: a quarter each way at one solve a side, and at three the
    // tie is (1 + 9 + 9 + 1) / 64, so more solves leave fewer ties and as many losses as wins.
    expect(taskChances({ old: 0.5, fresh: 0.5 }, 1)).toEqual({ win: 0.25, loss: 0.25 });
    expect(taskChances({ old: 0.5, fresh: 0.5 }, 3)).toEqual({ win: 22 / 64, loss: 22 / 64 });
  });
});

describe("what a round can show before it runs", () => {
  const asked = { target: 24, solves: 3, level: LEVEL };

  it("is nothing on an empty pool, and no step on fewer tasks than the least sweep", () => {
    const none = roundSize({ stops: 0, unplaced: 0 }, asked);
    expect(none).toMatchObject({ sure: 0, most: 0, clearing: [] });
    expect(sizeLines(none)).toEqual([]);
    const three = roundSize({ stops: 2, unplaced: 1 }, asked);
    expect(three).toMatchObject({ sure: 2, most: 3, clearing: [] });
    expect(three.chances.every((said) => said.sure === 0 && said.most === 0)).toBe(true);
    expect(sizeLines(three)).toEqual([
      "at most 3 task(s) can be scored, and at --level 0.1 a step takes 4, all won: this round cannot read step. Its screening still retires each candidate both harnesses pass, as too-easy",
    ]);
    // A target under the sweep caps the scored set as a small pool does.
    expect(roundSize({ stops: 9, unplaced: 30 }, { ...asked, target: 3 })).toMatchObject({
      sure: 3,
      most: 3,
      clearing: [],
    });
  });

  it("gives the scored set's range, the results that clear and each stated effect's chance", () => {
    const size = roundSize({ stops: 9, unplaced: 30 }, asked);
    expect(size).toMatchObject({ sure: 9, most: 24, target: 24, solves: 3, level: LEVEL });
    expect(size.chances.map((said) => said.effect)).toEqual([...EFFECTS]);
    // The plan's effect at the full set is the plan's estimate, and at the nine sure tasks it is
    // four or more of nine won at 0.12 each.
    const [plan, spread] = size.chances;
    expect(plan?.most).toBeCloseTo(chanceOfStep(24, { win: 0.12, loss: 0 }, LEVEL), 12);
    expect(plan?.sure).toBeCloseTo(chanceOfStep(9, { win: 0.12, loss: 0 }, LEVEL), 12);
    // Tasks turned outright read alike at any solves a side; a lift spread over every task does not.
    const once = roundSize({ stops: 9, unplaced: 30 }, { ...asked, solves: 1 });
    expect(once.chances[0]?.most).toBeCloseTo(plan?.most ?? 0, 12);
    expect(once.chances[1]?.most).toBeLessThan(spread?.most ?? 0);
    expect(sizeLines(size)[0]).toBe(
      "at most 24 tasks can be scored, 9 of them stopped by the parent's solves on record; at --level 0.1 the smallest results that clear are 4-0, 6-1, 7-2",
    );
    expect(sizeLines(size)[1]).toStartWith(
      "the chance that the scored test clears on 9 to 24 tasks at 3 solves a side, were the true effect: 12 points as 12 tasks in 100 turned from failed to passed, 0.02 to 0.32; ",
    );
  });

  it("says one size where nothing is placed, as a launch knows it", () => {
    const [first, second] = sizeLines(roundSize({ stops: 0, unplaced: 4 }, asked));
    expect(first).toBe(
      "at most 4 tasks can be scored; at --level 0.1 the smallest results that clear are 4-0",
    );
    // Four tasks, a quarter of them turned: all four won is 1 in 256.
    expect(second).toContain("25 points as 25 tasks in 100 turned, 0.00;");
    expect(second).toStartWith("the chance that the scored test clears on 4 tasks at 3 solves a side");
  });

  it("names the pool tasks it leaves out, which a round scores only on the child's fails", () => {
    // Five tasks the parent clears and one that ran to its wall are in the pool and in no size.
    const size = roundSize({ stops: 9, unplaced: 30, rest: 6 }, asked);
    expect(size).toMatchObject({ sure: 9, most: 24, rest: 6 });
    expect(sizeLines(size)[0]).toEndWith(
      "the smallest results that clear are 4-0, 6-1, 7-2; 6 pool tasks the parent clears or ran to the wall on are not counted, and a round scores one only when the child fails it",
    );
    // So a pool of which too few stop the parent is not said to hold no more than those.
    const [short] = sizeLines(roundSize({ stops: 2, unplaced: 1, rest: 1 }, asked));
    expect(short).toStartWith("at most 3 task(s) can be scored, and at --level 0.1 a step takes 4, all won");
    expect(short).toEndWith(
      "as too-easy; 1 pool task the parent clears or ran to the wall on is not counted, and a round scores one only when the child fails it",
    );
    expect(roundSize({ stops: 2, unplaced: 1 }, asked).rest).toBe(0);
  });
});

describe("what a repeat would need", () => {
  it("is the first size at which the observed shares clear half the time, and four times in five", () => {
    // Two of four tasks won and none lost: each task a win one time in two. Seven tasks give four
    // or more wins exactly half the time, and ten give them 848 times in 1024, nine 382 in 512.
    expect(repeatOf({ wins: 2, losses: 0, ties: 2 }, LEVEL)).toEqual({
      tasks: 4,
      wins: 2,
      losses: 0,
      again: 0.0625,
      needs: [
        { chance: 0.5, tasks: 7 },
        { chance: 0.8, tasks: 10 },
      ],
    });
    // Every task won: the least sweep is all it takes.
    expect(repeatOf({ wins: 4, losses: 0, ties: 0 }, LEVEL)?.needs).toEqual([
      { chance: 0.5, tasks: 4 },
      { chance: 0.8, tasks: 4 },
    ]);
  });

  it("names no size for a tally that does not favour the new harness, or that only tied", () => {
    const none = [
      { chance: 0.5, tasks: null },
      { chance: 0.8, tasks: null },
    ];
    expect(repeatOf({ wins: 2, losses: 3, ties: 19 }, LEVEL)?.needs).toEqual(none);
    expect(repeatOf({ wins: 0, losses: 0, ties: 4 }, LEVEL)).toMatchObject({ again: 0, needs: none });
    expect(repeatOf({ wins: 0, losses: 0, ties: 0 }, LEVEL)).toBeNull();
  });

  it("is hundreds of tasks at a thin effect, as v1 found", () => {
    // Three wins and two losses in 24: a round reads it half the time only from 242 scored tasks.
    const thin = repeatOf({ wins: 3, losses: 2, ties: 19 }, LEVEL);
    expect(thin?.needs[0]).toEqual({ chance: 0.5, tasks: 242 });
    expect(thin?.again).toBeLessThan(LEVEL);
  });
});

describe("rounds that fell short of a step, together", () => {
  const versions = (...tasks: string[]) => ({ versions: tasks });
  const log = [
    // Before the last step: no part of what fell short since.
    reported("b-0", ["h0", "h1"], "no-step", [1, 0, 3], versions("t1", "t2", "t3", "t4")),
    reported("b-1", ["h0", "h1"], "step", [4, 0, 0], versions("t1", "t2", "t3", "t4")),
    // Two rounds from the step's harness, each with another child, sharing three tasks.
    reported("b-2", ["h1", "h2"], "no-step", [1, 0, 3], versions("t1", "t2", "t3", "t4")),
    reported("b-3", ["h1", "h3"], "no-step", [1, 1, 2], versions("t1", "t2", "t3", "t5")),
    // A round that scored nothing tested nothing, and one stopped on its disputes compared nothing.
    reported("b-4", ["h1", "h4"], "not-scored", [0, 0, 0]),
    reported("b-5", ["h1", "h5"], "check-defects", null),
    // A round the operator sent on from a child, whose flags decide: its counted reading is read.
    reported("b-6", ["h3", "h6"], "flags-decide", [0, 0, 1], { ...versions("t9"), counted: "no-step" }),
    // A scored test that cleared, on an anchor too thin to test, is not short of informative pairs.
    reported("b-7", ["h1", "h7"], "anchor-not-tested", [4, 0, 0], versions("t1", "t2", "t3", "t4")),
  ];

  it("are the rounds since the last step whose scored test did not clear", () => {
    expect(shortRounds(log).map(({ session }) => session)).toEqual(["b-2", "b-3", "b-6"]);
    expect(shortRounds([])).toEqual([]);
    // A round is read by its last report: one a person's labels settled into a step is not short.
    const settled = [...log, reported("b-3", ["h1", "h3"], "step", [4, 0, 0])];
    expect(shortRounds(settled)).toEqual([]);
  });

  it("are summed as a description, with why the sum is no test of a step", () => {
    const read = together(shortRounds(log), LEVEL);
    expect(read).toMatchObject({
      rounds: 3,
      parents: 2,
      children: 3,
      // Nine pairs of six tasks: t1, t2 and t3 were scored in two rounds.
      pairs: 9,
      tasks: 6,
      wins: 2,
      losses: 1,
      ties: 6,
    });
    expect(read.apart).toEqual([
      "the rounds compared 3 children, and a step names one harness",
      "they started from 2 parents, and no round compared the first with the last",
      "each of the 3 was a look at its own level, and a sum read after every short round clears more often than the level allows",
      "the 9 pairs are of 6 tasks, and a task scored in several rounds is one task's evidence",
    ]);
    // What a repeat would need is read at the summed shares, and nothing is read off the sum's own p.
    expect(read.repeat).toEqual(repeatOf({ wins: 2, losses: 1, ties: 6 }, LEVEL));
    expect(read).not.toHaveProperty("p");
  });

  it("names no reason for one round alone, and says nothing when none fell short", () => {
    const [, , one] = shortRounds(log);
    const alone = together(one === undefined ? [] : [one], LEVEL);
    expect(alone).toMatchObject({ rounds: 1, pairs: 1, tasks: 1, apart: [] });
    expect(shortLines(together([], LEVEL), null)).toEqual([]);
    const lines = shortLines(together(shortRounds(log), LEVEL), null);
    expect(lines[0]).toBe(
      "3 rounds since the last step fell short of one: 2 wins, 1 losses and 6 ties over 9 scored pairs of 6 tasks",
    );
    expect(lines[1]).toStartWith("their sum is no test of a step: the rounds compared 3 children");
    expect(lines[2]).toStartWith(
      "were every task's chances the shares these showed, a round's scored test would clear 0.5 of the time from ",
    );
  });
});

describe("whether tasks or solves a side buy more", () => {
  it("is read at the pass rates each scored task showed, at twice the scoring solves either way", () => {
    // Four tasks, each one pass in two under the old harness and two in two under the new. At two
    // solves a side a task is a win unless the old harness passes both: 3 in 4. At four, 15 in 16.
    const pairs = ["t1", "t2", "t3", "t4"].map((task) => ({ task, old: [P, F], fresh: [P, P] }));
    expect(boughtBy(pairs, LEVEL)).toEqual({
      tasks: 4,
      solves: 2,
      asIs: 0.75 ** 4,
      // Eight tasks clear on four or more wins: all but (1 + 24 + 252 + 1512) of 65536.
      moreTasks: 1 - 1789 / 65536,
      moreSolves: 0.9375 ** 4,
    });
  });

  it("finds more solves a side buy nothing on settled tasks, and no step where no harness is ahead", () => {
    const settled = [
      { task: "w1", old: [F, F], fresh: [P, P] },
      { task: "w2", old: [F, F], fresh: [P, P] },
      { task: "d1", old: [F, F], fresh: [F, F] },
      { task: "e1", old: [P, P], fresh: [P, P] },
    ];
    // Half the tasks are won at any number of solves: 1 in 16 as it is and at twice the solves,
    // and at twice the tasks four or more of eight, 163 in 256.
    expect(boughtBy(settled, LEVEL)).toMatchObject({
      asIs: 0.0625,
      moreSolves: 0.0625,
      moreTasks: 163 / 256,
    });
    // Tasks both harnesses pass one time in two: more solves untie them, half each way.
    const noise = Array.from({ length: 8 }, (_, index) => ({
      task: `n${String(index)}`,
      old: [P, F],
      fresh: [F, P],
    }));
    const bought = boughtBy(noise, LEVEL);
    expect(bought?.moreSolves).toBeLessThanOrEqual(LEVEL);
    expect(bought?.moreTasks).toBeLessThanOrEqual(LEVEL);
    expect(boughtBy([], LEVEL)).toBeNull();
  });
});

/** A log with a pool of `pool` feasible tasks no solve has placed, and an anchor of one. */
function campaign(pool: number): LogEvent[] {
  const feasible = (version: string) => [
    event("task.proposed", { version }),
    ...[1, 2, 3, 4].map((gate) => event("task.gate", { version, gate, outcome: "passed", controls: "d" })),
  ];
  return [
    ...Array.from({ length: pool }, (_, index) => feasible(`t${String(index + 1)}`)).flat(),
    ...feasible("a1"),
    event("anchor.drawn", { tasks: ["a1"] }),
  ];
}

const condition = (task: string, harness: string): Condition => ({
  contract: "c1",
  harness,
  task,
  model: "faux/solver",
  effort: "medium",
  prices: { "faux/solver": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  runtime: {},
  compaction: "off",
  solverTools: harness,
  verifierTools: "t1",
  sandbox: "p1",
  limits: {
    wallSeconds: 600,
    turns: 12,
    shellDefaultSeconds: 30,
    shellMaxSeconds: 60,
    concurrency: 1,
    diskBytes: 1024,
  },
  host: "h",
  side: "test",
});

describe("the measurement as what binds a climb", () => {
  const RULE = { solves: 3, fails: 2 };
  const stand: Stand = { harness: "h1", setting: settingId(condition("any", "h1")) };
  const given = { rule: RULE, least: 4 };
  const thin = (session: string, informative: number, harness = "h1") =>
    reported(session, [harness, `${session}-child`], "no-step", [informative, 0, 6 - informative]);

  it("is read on the last two rounds from the harness, each short of the pairs a step takes", () => {
    const log = campaign(6);
    expect(binding(log, stand, given).binds).toBe("harness");
    // One short round can be its child's doing, or chance.
    expect(binding([...log, thin("b-1", 1)], stand, given).binds).toBe("harness");
    const twice = binding([...log, thin("b-1", 1), thin("b-2", 3)], stand, given);
    expect(twice).toMatchObject({ binds: "measurement", stops: 0, unplaced: 6 });
    expect(twice.why).toBe(
      "6 of the pool can be scored, and the last 2 rounds from this harness told the two harnesses apart on 1 and 3 tasks where a step takes 4: a round of this size has not been able to read one",
    );
    expect(informativeOf([...log, thin("b-1", 1), thin("b-2", 3)], "h1")).toEqual([1, 3]);
    // A later round with pairs enough to read a step on, short of one or not, is no thin round.
    expect(binding([...log, thin("b-1", 1), thin("b-2", 3), thin("b-3", 4)], stand, given).binds).toBe(
      "harness",
    );
    // Rounds from another harness say nothing of this one, and a round that scored no task none.
    const elsewhere = [...log, thin("b-1", 1, "h0"), thin("b-2", 1, "h0")];
    expect(binding(elsewhere, stand, given).binds).toBe("harness");
    const unscored = [...log, thin("b-1", 1), reported("b-2", ["h1", "h3"], "not-scored", [0, 0, 0])];
    expect(binding(unscored, stand, given).binds).toBe("harness");
  });

  it("is read when the round's target is under the least sweep", () => {
    const small = binding(campaign(6), stand, { ...given, target: 3 });
    expect(small.binds).toBe("measurement");
    expect(small.why).toBe(
      "6 of the pool can be scored and a step takes 4, and the round's target is 3: at this size no result reads a step",
    );
    expect(binding(campaign(6), stand, { ...given, target: 4 }).binds).toBe("harness");
  });

  it("comes after everything a short pool names: a larger round mends no pool", () => {
    // Two tasks can be scored and a step takes four, whatever the rounds from here showed.
    const log = [...campaign(2), thin("b-1", 1), thin("b-2", 1)];
    expect(binding(log, stand, { ...given, target: 3 })).toMatchObject({ binds: "tasks", unplaced: 2 });
  });
});

describe("the short rounds' two readings over a log", () => {
  it("reads each round's pairs as its report found them", () => {
    // One round: t1 the old harness fails and the new passes, t2 both pass, one solve a side.
    const log = campaign(2);
    const solved = (task: string, harness: string, pass: boolean, name: string) => {
      const ran = condition(task, harness);
      return [
        event("condition.recorded", { id: conditionId(ran), condition: requireJsonValue(ran) }),
        event("solve.started", { solve: name, condition: conditionId(ran) }),
        event("solve.finished", {
          solve: name,
          ending: pass ? { outcome: "pass" } : { outcome: "fail", kind: "rejected" },
        }),
      ];
    };
    const round = [
      ...log,
      event("build.started", { session: "b-1", parent: "h1" }),
      event("task.state", { version: "t1", state: "admitted", session: "b-1" }),
      event("task.state", { version: "t2", state: "admitted", session: "b-1" }),
      ...solved("t1", "h1", F, "s1"),
      ...solved("t1", "h2", P, "s2"),
      ...solved("t2", "h1", P, "s3"),
      ...solved("t2", "h2", P, "s4"),
      reported("b-1", ["h1", "h2"], "no-step", [1, 0, 1], { versions: ["t1", "t2"], solves: 1 }),
    ];
    const { together: read, bought } = shortOfAStep(round, LEVEL);
    expect(read).toMatchObject({ rounds: 1, pairs: 2, tasks: 2, wins: 1, losses: 0, ties: 1, apart: [] });
    // One task of two is won at any number of solves: two tasks cannot clear, and four clear when
    // all four are won, which at one in two each is 1 in 16.
    expect(bought).toEqual({ tasks: 2, solves: 1, asIs: 0, moreTasks: 0.0625, moreSolves: 0 });
    expect(shortLines(read, bought).at(-1)).toBe(
      "at the pass rates these tasks showed, 2 tasks at 1 a side clear 0.00 of the time; twice the scoring solves clear 0.06 as 4 tasks, and 0.00 as 2 solves a side. A task that passed every solve or none is taken to do so always, which leans this towards tasks",
    );
  });
});

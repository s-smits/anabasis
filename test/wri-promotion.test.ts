// Lane 27 preserves reported profiles, tested tasks and promotion safeguards.
// Missing profiles stay unmeasured even where raw solves passed.
import { describe, expect, it } from "bun:test";
import { conditionId } from "../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import { asRecord, type JsonObject } from "../src/meta/json-shape.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { climbTable, safeguardTriggers } from "../tools/wri/climb.ts";
import { indexOf, type TRIGGERS } from "../tools/wri/folds.ts";
import { joinedTest, testedOf, testSaid, untied } from "../tools/wri/promotion.ts";
import { overview } from "../tools/wri/read.ts";
import { conditionOf, roundSolves } from "./helpers/logged-round.ts";

const START = Date.parse("2026-10-10T20:00:00Z");
const HELD = ["v1", "v2", "v3", "v4"];
const REPORT = {
  budgets: [],
  spread: null,
  billed: null,
  against: null,
  counted: null,
  disputed: [],
  aside: [],
  short: [],
  withdrawn: [],
  capped: false,
  settled: null,
  versions: HELD,
};

/** A step as a rest comparison reads one: every task won, against a reference valid on 1 of 8 solves. */
const STEP = {
  scored: { wins: 4, losses: 0, ties: 0, p: 0.0625, unsolved: 0 },
  valid: { old: [3, 1, 0], fresh: [0, 0, 4] },
  noise: { wins: 1, losses: 0, ties: 3, p: 1 },
  reading: "step",
};

/** A log built event by event, a second apart. */
function campaign() {
  const log: LogEvent[] = [];
  const put = (kind: EventKind, data: JsonObject) => {
    log.push({ at: new Date(START + log.length * 1000).toISOString(), kind, data });
  };
  /** A comparison's start and its report. */
  const compare = (session: string, old: string, fresh: string, reported: JsonObject) => {
    const terms = { session, old, fresh, starter: "hbase", setting: "set-1", solves: 2, level: 0.1 };
    put("comparison.started", { ...terms, budgets: [], cap: null, tasks: HELD });
    return () => put("comparison.reported", { ...REPORT, ...terms, tasks: 4, ...reported });
  };
  return { log, put, compare };
}

/** A campaign whose held-out tasks are proposed and passed their gate. */
function held() {
  const made = campaign();
  for (const version of HELD) {
    made.put("task.proposed", { version });
    made.put("task.gate", { version, gate: 1, outcome: "passed" });
  }
  return made;
}

const triggered = (log: readonly LogEvent[]) => {
  const { triggers } = overview(log);
  return (name: keyof typeof TRIGGERS) =>
    triggers.filter((trigger) => trigger.name === name).map(({ detail }) => detail);
};

/**
 * A promotion read twice on `author` tasks the gate held on their author's answer alone, every
 * reference solve valid at one measure and the author's better, and `spread` held on reference
 * answers apart by the objective. Every frontier task is won in each reading, `by` the new side's
 * better measure or its bill of half the reference's; on validity alone they tie, unless the
 * reference `fails` each of its solves.
 */
function leaning({
  author,
  spread,
  fails,
  by = "objective",
}: {
  author: number;
  spread: number;
  fails: boolean;
  by?: "objective" | "bill";
}) {
  const { log: events, put } = campaign();
  const tasks = Array.from({ length: author + spread }, (_, at) => `t${String(at)}`);
  put("campaign.opened", { budget: 300, terms: {} });
  put("exam.started", { session: "x-1" });
  for (const [at, version] of tasks.entries()) {
    put("task.proposed", { version, taskId: version });
    const condition = conditionOf(version, "hbase");
    put("condition.recorded", { id: conditionId(condition), condition: requireJsonValue(condition) });
    for (const [solve, measure] of [1, at < author ? 1 : 1.5, 1].entries()) {
      const id = `${version}-gate-${String(solve)}`;
      put("solve.started", { solve: id, condition: conditionId(condition), comparison: "x-1" });
      put("verdict", { solve: id, kind: "pass", objective: measure });
      put("solve.finished", { solve: id, ending: { outcome: "pass" }, turns: 3 });
    }
    put("task.gate", { version, gate: 1, outcome: "passed", reference: { valid: 3, solves: 3 } });
    put("task.feasible", { version, session: "x-1", objective: { direction: "lower", measure: 0.5 } });
  }
  for (const session of ["g-1", "g-2"]) {
    const outcomes = Object.fromEntries(tasks.map((task) => [task, fails ? "FF PP" : "PP PP"]));
    const { events: solves, terms } = roundSolves(session, ["hbase", "hn"], outcomes);
    put("comparison.started", { session, old: "hbase", fresh: "hn", ...terms });
    let fresh = false;
    for (const { kind, data } of solves) {
      if (kind === "condition.recorded") fresh = asRecord(data.condition)?.harness === "hn";
      const passed = kind === "solve.finished" && asRecord(data.ending)?.outcome === "pass";
      if (passed) {
        put("verdict", {
          solve: data.solve ?? "",
          kind: "pass",
          objective: by === "bill" || fresh ? 1 : 1.5,
        });
      }
      put(kind, passed ? { ...data, billed: by === "objective" || fresh ? 1 : 2 } : data);
    }
    const differences = tasks.map(() => 16);
    put("comparison.reported", {
      ...REPORT,
      ...terms,
      session,
      old: "hbase",
      fresh: "hn",
      level: 0.02,
      objective: { direction: "lower" },
      scored: { wins: tasks.length, losses: 0, ties: 0, p: 0.5 ** tasks.length, differences },
      frontier: { of: tasks, differences },
      retained: "unmeasured",
      reading: "step",
    });
  }
  put("harness.promoted", {
    harness: "hn",
    from: "hbase",
    rests: ["g-1", "g-2"].map((comparison) => ({ comparison, against: "hbase", reading: "step" })),
  });
  return events;
}

describe("lane 27: a promotion and the climb after it", () => {
  it.each([
    [null, "unmeasured"],
    [{}, "unmeasured"],
    [{ old: [], fresh: [0, 0, 0] }, "unmeasured"],
    [{ old: [3], fresh: [3] }, "unmeasured"],
    [{ old: [3, 0, 0, 0, 0], fresh: [3, 0, 0, 0, 0] }, "0%"],
    [{ old: [0, 0, 0, 0, 3], fresh: [0, 0, 0, 0, 3] }, "100%"],
  ] as const)("preserves the validity measurement for profile %j", (valid, expected) => {
    const { log, put, compare } = campaign();
    for (const version of HELD) {
      put("task.proposed", { version });
      put("task.gate", { version, gate: 1, outcome: "passed" });
    }
    const first = compare("g-1", "hbase", "hn", { ...STEP, valid });
    // A raw pass must not fill an absent report profile.
    const ran = conditionOf("v1", "hbase");
    put("condition.recorded", { id: conditionId(ran), condition: requireJsonValue(ran) });
    put("solve.started", { solve: "r1", condition: conditionId(ran), comparison: "g-1" });
    put("solve.finished", { solve: "r1", ending: { outcome: "pass" } });
    first();
    expect(climbTable([{ name: "profile", events: log }])).toContain(`| g-1 ${expected} |`);
    put("harness.promoted", { harness: "hn", from: "hbase", rests: [{ comparison: "g-1" }] });
    compare("g-2", "hn", "hm", { ...STEP, valid })();
    compare("g-3", "hn", "hbase", { ...STEP, valid })();
    const after = triggered(log)("AFTER THE PROMOTION")[0];
    expect(after).toContain(`valid ${expected} against ${expected}`);
    expect(after).toContain(`control g-3: the promoted harness valid on ${expected}`);
  });

  it("reads a control's confirmation on tasks first drawn after the promotion apart from older ones", () => {
    // Q5 of the climb investigation, 3 November: both confirmations on record rested on tasks the
    // promoted harness had been promoted on. The starter is the fresh side, so the reference wins
    // what the starter loses, and a task set aside or short is left out of both ages.
    const { log, put, compare } = held();
    compare("g-1", "hbase", "hn", STEP)();
    put("harness.promoted", { harness: "hn", from: "hbase", rests: [{ comparison: "g-1" }] });
    const terms = {
      session: "g-2",
      old: "hn",
      fresh: "hbase",
      starter: "hbase",
      setting: "set-1",
      solves: 2,
      level: 0.1,
    };
    const tasks = ["v1", "v2", "v5", "v6", "v7", "v8"];
    put("comparison.started", { ...terms, budgets: [], cap: null, tasks });
    // v7 is set aside and v8 was short: neither has a score, and `of` names the task of each.
    const frontier = { tasks, aside: ["v7"], differences: [-1, -1, 1, 0], of: ["v1", "v2", "v5", "v6"] };
    put("comparison.reported", { ...REPORT, ...terms, tasks: 6, ...STEP, frontier });
    const after = triggered(log)("AFTER THE PROMOTION")[0];
    expect(after).toContain("first drawn after the promotion 0-1-1 p 1.000, before it 2-0-0 p 0.250");
    // A part whose scores do not line up with the tasks it names is read as holding none.
    put("comparison.started", { ...terms, session: "g-3", budgets: [], cap: null, tasks });
    put("comparison.reported", {
      ...REPORT,
      ...terms,
      session: "g-3",
      tasks: 6,
      ...STEP,
      frontier: { tasks, differences: [1], of: ["v1", "v2"] },
    });
    expect(triggered(log)("AFTER THE PROMOTION")[0]).toContain(
      "control g-3: the promoted harness valid on 13%",
    );
    expect(triggered(log)("AFTER THE PROMOTION")[0]).toContain("after the promotion none, before it none");
  });

  it("names a promotion no starter comparison confirmed, and leaves out one that a starter comparison did", () => {
    // The gate ablation of 1 November: five promotions, a Builder's comparison in each starter
    // comparison's place, and none confirmed.
    const { log, put, compare } = held();
    compare("g-1", "hbase", "hn", STEP)();
    put("harness.promoted", { harness: "hn", from: "hbase", rests: [{ comparison: "g-1" }] });
    compare("g-2", "hn", "hm", STEP)();
    expect(triggered(log)("PROMOTION UNCONFIRMED")).toEqual([
      "1 of 1 promotions: hn in epoch 2, open: no starter comparison reported",
    ]);
    // The starter loses every task to the promoted reference: six untied at level 0.1.
    const lost = { wins: 0, losses: 6, ties: 0, p: 1, unbilled: [-1, -1, -1, -1, -1, -1] };
    compare("g-3", "hn", "hbase", { ...STEP, scored: lost, reading: "no-step" })();
    expect(triggered(log)("PROMOTION UNCONFIRMED")).toEqual([]);
  });

  it("says how many of a step's wins it could lose, and reads no comparison that did not step", () => {
    // The gate ablation's g-3 of 1 November cleared at 6-0 with none to spare at 0.02; at 8-0 two
    // wins can go before the seventh-largest sweep no longer clears.
    const { log, compare } = held();
    const step = (wins: number) => ({
      ...STEP,
      level: 0.02,
      scored: { ...STEP.scored, unbilled: [...Array.from({ length: wins }, () => 1), 0, 0] },
    });
    compare("g-1", "hbase", "hn", { ...step(8), reading: "no-step" })();
    expect(triggered(log)("STEP CARRIERS")).toEqual([]);
    compare("g-2", "hbase", "hn", step(6))();
    compare("g-3", "hbase", "hm", step(8))();
    const [carriers = ""] = triggered(log)("STEP CARRIERS");
    expect(carriers).toMatch(/g-2 won 6 .*6 untied, none to spare; g-3 won 8 .*8 untied, 2 to spare/);
  });

  it("reads a promotion on the differences its step tested: the frontier and the retained tasks since 20 October, the frontier alone before", () => {
    const frontier = { differences: [4, 4], of: ["a", "b"] };
    const retained = { differences: [-4], of: ["c"] };
    const before = { scored: { differences: [4, 4, -4] }, frontier, retained };
    const since = { ...before, scored: { differences: [4, 4, -4], falseRate: 0.25 } };
    expect(testedOf(before)).toEqual({ differences: [4, 4], of: ["a", "b"] });
    expect(testedOf(since)).toEqual({ differences: [4, 4, -4], of: ["a", "b", "c"] });
    expect(testedOf({ ...since, retained: "unmeasured" }).differences).toEqual([4, 4]);
    // A task two readings tested counts once, its differences summed; one in `without` drops out.
    expect(joinedTest([since, since], new Set(["a"])).toSorted((x, y) => x - y)).toEqual([-8, 8]);
  });

  it.each(["/tmp", "/private/tmp", "/var/tmp", "/private/var/tmp"])(
    "excludes every seat's private root under %s",
    (temporary) => {
      const { log, put } = campaign();
      for (const [seat, by] of [
        ["solve", { solve: "solver" }],
        ["build", { session: "builder" }],
        ["exam", { session: "examiner" }],
      ] as const) {
        put(`${seat}.call`, {
          ...by,
          tool: "bash",
          args: { command: `cat ${temporary}/ana-built-bash/solve-${seat}/tmp/private` },
          isError: false,
        });
      }
      expect(triggered(log)("SHARED TEMPORARY FOLDER")).toEqual([]);
    },
  );
});

describe("lane 27 across campaigns", () => {
  it("sets each campaign in lane 27's columns, promoted or not", () => {
    const { log, put, compare } = campaign();
    put("campaign.opened", { budget: 300, terms: { level: "0.1", trigger: "0.25" } });
    // g-1 won on the objective alone and g-2 on validity; the reference was valid in every solve of
    // no task in either, so all eight scored tasks left room.
    compare("g-1", "hbase", "hn", { ...STEP, points: { validity: 0, objective: 1.2, bill: 0 } })();
    compare("g-2", "hbase", "hn", {
      ...STEP,
      valid: { old: [2, 2, 0], fresh: [0, 1, 3] },
      points: { validity: 2.4, objective: 0, bill: 0 },
    })();
    put("harness.promoted", {
      harness: "hn",
      from: "hbase",
      rests: ["g-1", "g-2"].map((comparison) => ({ comparison })),
    });
    const building = campaign();
    building.put("campaign.opened", { budget: 300, terms: {} });
    building.put("build.started", { session: "b-1", parent: "hbase", tasks: [] });
    const table = climbTable([
      { name: "promoting", events: log },
      { name: "building", events: building.log },
    ]).split("\n");
    expect(table).toHaveLength(4);
    const cells = table.map((row) => row.split("|").map((cell) => cell.trim()));
    expect(cells[2]).toMatchObject({
      1: "promoting",
      3: "level 0.1, trigger 0.25",
      4: "hn at 20:00Z",
      6: "g-1 4-0-0 p 0.063, 4 of 4, 1 of 4; g-2 4-0-0 p 0.063, 4 of 4, 1 of 4",
      7: "g-1 13%; g-2 25%",
      10: "8 of 8 scored tasks",
      11: "1 of 2, 0 confirmed",
    });
    expect(cells[3]?.slice(10, 12)).toEqual(["-", "0 of 0, 0 confirmed"]);
    expect(cells[3]?.slice(1, 7)).toEqual(["building", "none", "default", "none yet", "-", "none reported"]);
  });

  it("distinguishes author room, objective and bill dependence from promotions that need neither", () => {
    for (const [input, expected] of [
      [
        { author: 4, spread: 2, fails: false },
        [
          {
            lane: 9,
            name: "SAFEGUARD-8 PROMOTION ON AUTHOR ROOM",
            detail:
              "hn 6-0 p 0.016 joined at level 0.02, 2-0 p 0.250 without the tasks held on their author's answer alone",
          },
          {
            lane: 11,
            name: "SAFEGUARD-9 PROMOTION BEYOND VALIDITY",
            detail:
              "hn 6-0 p 0.016 joined at level 0.02, 0-0 p 1.000 on validity alone, 6-0 p 0.016 by the current score",
          },
        ],
      ],
      [
        { author: 0, spread: 6, fails: false, by: "bill" },
        [
          {
            lane: 11,
            name: "SAFEGUARD-9 PROMOTION BEYOND VALIDITY",
            detail:
              "hn 6-0 p 0.016 joined at level 0.02, 0-0 p 1.000 on validity alone, 0-0 p 1.000 by the current score",
          },
        ],
      ],
      [{ author: 1, spread: 6, fails: true }, []],
      [{ author: 4, spread: 1, fails: false }, []],
    ] as const) {
      expect(safeguardTriggers(indexOf(leaning(input)))).toEqual([...expected]);
    }
  });
});

describe("a tally as its step is read", () => {
  // g-3 of 1 November: 9 of 18 tied with the bill, 14 of 18 without it, which the step reads.
  const scored = {
    wins: 7,
    losses: 2,
    ties: 9,
    p: 0.09,
    unbilled: [0.4, 0.3, 0.2, -0.1, ...Array<number>(14).fill(0)],
  };

  it("counts the untied tasks without the bill where the report holds those scores", () => {
    expect(untied(scored)).toBe(untied({ wins: 3, losses: 1, ties: 14 }));
    expect(testSaid(scored)).toContain("without the bill 3-1-14");
  });

  it("reads a report from before the bill-free scores as it was tallied", () => {
    const old = { wins: 7, losses: 2, ties: 9, p: 0.09 };
    expect(untied(old)).toBe(untied({ wins: 7, losses: 2, ties: 9 }));
    expect(testSaid(old)).toBe("7-2-9 p 0.090");
  });
});

// Lane 27's triggers on a campaign small enough to count by hand: a Builder session leaves hn, two
// comparisons against a starter that answers almost nothing read it a step, the table promotes it,
// and the campaign moves its budget, holds out two tasks, runs a control and builds from it. One
// reference solve runs a program another campaign compiled under the host's `/tmp`, and two new
// solves write one script there.
// Missing validity profiles stay unmeasured even where raw solves passed.
import { describe, expect, it } from "bun:test";
import { type Condition, conditionId } from "../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import { asRecord, type JsonObject } from "../src/meta/json-shape.ts";
import { keyIfNotNull } from "../src/meta/optional-key.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { climbTable, safeguardTriggers } from "../tools/wri/climb.ts";
import { indexOf, type TRIGGERS } from "../tools/wri/folds.ts";
import { joinedTest, testedOf } from "../tools/wri/promotion.ts";
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
    log.push({ at: new Date(START + log.length * 1_000).toISOString(), kind, data });
  };
  const condition = (task: string, harness: string): Condition => ({
    contract: "c1",
    harness,
    task,
    model: "p/m",
    effort: "medium",
    prices: { "p/m": { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } },
    runtime: {},
    compaction: "off",
    solverTools: "s1",
    verifierTools: "v1",
    sandbox: "x1",
    limits: {
      wallSeconds: 480,
      turns: 24,
      shellDefaultSeconds: 10,
      shellMaxSeconds: 20,
      concurrency: 4,
    },
    host: "host-1",
    side: "test",
  });
  /** One solve of `task` under `harness` in `comparison`, or in practice for null, its commands as given. */
  const solve = (
    id: string,
    task: string,
    harness: string,
    comparison: string | null,
    commands: readonly string[],
  ) => {
    const ran = condition(task, harness);
    put("condition.recorded", { id: conditionId(ran), condition: requireJsonValue(ran) });
    put("solve.started", {
      solve: id,
      condition: conditionId(ran),
      limits: { wallSeconds: 480 },
      ...keyIfNotNull("comparison", comparison),
    });
    for (const [turn, command] of commands.entries()) {
      put("solve.call", { solve: id, turn, tool: "bash", args: { command }, isError: false });
    }
    put("solve.finished", { solve: id, ending: { outcome: "pass" }, seconds: 50, responseModels: ["m-1"] });
  };
  /** A comparison's start and its report. */
  const compare = (session: string, old: string, fresh: string, reported: JsonObject) => {
    const terms = { session, old, fresh, starter: "hbase", setting: "set-1", solves: 2, level: 0.1 };
    put("comparison.started", { ...terms, budgets: [], cap: null, tasks: HELD });
    return () => put("comparison.reported", { ...REPORT, ...terms, tasks: 4, ...reported });
  };
  return { log, put, solve, compare };
}

/** The campaign up to its promotion, with the table's move after it when `byTable`. */
function promoted(byTable: boolean, after = false) {
  const run = campaign();
  const { put, solve, compare } = run;
  put("campaign.opened", { budget: 300, terms: { level: "0.1", trigger: "0.25" } });
  for (const version of ["t1", ...HELD]) {
    put("task.proposed", { version, taskId: version });
    put("task.gate", { version, gate: 1, outcome: "passed" });
  }
  put("task.state", { version: "t1", state: "released" });
  put("build.started", { session: "b-1", parent: "hbase", tasks: ["t1"] });
  put("build.call", {
    session: "b-1",
    tool: "bash",
    args: { command: "make -C /tmp/pbuild install" },
    isError: false,
  });
  put("build.finished", { session: "b-1", ended: "finished", harness: "hn", changed: true });
  const first = compare("g-1", "hbase", "hn", STEP);
  solve("r1", "v1", "hbase", "g-1", ["/tmp/phq-inst/bin/phreeqc in.pqi"]);
  solve("n1", "v1", "hn", "g-1", ["cat > /tmp/m.py <<'EOF'", "python3 /tmp/m.py"]);
  solve("n2", "v2", "hn", "g-1", ["python3 /tmp/m.py", "ls ~/work"]);
  first();
  compare("g-2", "hbase", "hn", {
    ...STEP,
    valid: { old: [2, 2, 0], fresh: [0, 1, 3] },
    budgets: [{ turns: 4, wins: 2, losses: 0, ties: 2, p: 0.5 }],
  })();
  // The campaign's move is written as it begins, before the promotion it makes (12 October).
  const move = () => put("campaign.move", { move: "promote", why: "read a step twice", harness: "hn" });
  if (byTable && !after) move();
  put("harness.promoted", {
    harness: "hn",
    from: "hbase",
    rests: [
      { comparison: "g-1", against: "hbase", reading: "step" },
      { comparison: "g-2", against: "hbase", reading: "step" },
    ],
  });
  // The Builder's `promote` writes its move once the promotion is on record.
  if (byTable && after) move();
  return run;
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
  const events: LogEvent[] = [];
  const put = (kind: EventKind, data: JsonObject) => {
    events.push({ at: new Date(START + events.length * 1_000).toISOString(), kind, data });
  };
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
    const { log, put, solve, compare } = campaign();
    for (const version of HELD) {
      put("task.proposed", { version });
      put("task.gate", { version, gate: 1, outcome: "passed" });
    }
    const first = compare("g-1", "hbase", "hn", { ...STEP, valid });
    solve("r1", "v1", "hbase", "g-1", []);
    first();
    expect(climbTable([{ name: "profile", events: log }])).toContain(`| g-1 ${expected} |`);
    put("harness.promoted", { harness: "hn", from: "hbase", rests: [{ comparison: "g-1" }] });
    compare("g-2", "hn", "hm", { ...STEP, valid })();
    compare("g-3", "hn", "hbase", { ...STEP, valid })();
    const after = triggered(log)("AFTER THE PROMOTION")[0];
    expect(after).toContain(`valid ${expected} against ${expected}`);
    expect(after).toContain(`control g-3: the promoted harness valid on ${expected}`);
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
  /** A campaign whose Builder installs a program under `/tmp`, and one whose solves run it later. */
  const peers = () => {
    const builder = campaign();
    builder.put("campaign.opened", { budget: 300, terms: {} });
    builder.put("build.started", { session: "b-1", parent: "hbase", tasks: [] });
    builder.put("build.call", {
      session: "b-1",
      tool: "bash",
      args: { command: "make PREFIX=/tmp/phq-inst install && ls /tmp/phq-inst/bin/phreeqc" },
    });
    builder.put("build.call", { session: "b-1", tool: "bash", args: { command: "echo > /tmp/m.py" } });
    const promoting = promoted(true);
    // The promoting campaign's events start at the same second; its solves come after the install.
    const later = promoting.log.map((event) => ({
      ...event,
      at: new Date(Date.parse(event.at) + 60_000).toISOString(),
    }));
    return [
      { name: "promoting", events: later },
      { name: "building", events: builder.log },
    ];
  };

  it("sets each campaign in lane 27's columns, promoted or not", () => {
    const table = climbTable(peers()).split("\n");
    expect(table).toHaveLength(4);
    expect(table[2]).toContain("| promoting |");
    expect(table[2]).toContain("| level 0.1, trigger 0.25 | hn at 20:01Z |");
    expect(table[2]).toContain(
      "g-1 4-0-0 p 0.063, 4 of 4, 1 of 4; g-2 4-0-0 p 0.063, 4 of 4, 1 of 4 | g-1 13%; g-2 25%",
    );
    expect(table[3]).toContain("| building | none | default | none yet | - | none reported |");
  });

  it("names a promotion that cleared its level only on tasks held on their author's answer, and beyond validity by the objective", () => {
    // r3's third promotion on 19 October: 8-0 joined, 3-0 (p 0.125) without the tasks its gate held
    // on their author's answer alone, and 1-0 on validity alone.
    const said = safeguardTriggers(indexOf(leaning({ author: 4, spread: 2, fails: false })));
    expect(said.map(({ name, detail }) => `${name}: ${detail}`)).toEqual([
      "SAFEGUARD-8 PROMOTION ON AUTHOR ROOM: hn 6-0 p 0.016 joined at level 0.02, 2-0 p 0.250 without the tasks held on their author's answer alone",
      "SAFEGUARD-9 PROMOTION BEYOND VALIDITY: hn 6-0 p 0.016 joined at level 0.02, 0-0 p 1.000 on validity alone, 6-0 p 0.016 without the bill by the current score",
    ]);
  });

  it("names a promotion that cleared its level only on the bill", () => {
    // The M1 fork of #306 on 22 October: 11-0 joined, the bill deciding 10 tasks, 1-0 without it.
    const said = safeguardTriggers(indexOf(leaning({ author: 0, spread: 6, fails: false, by: "bill" })));
    expect(said.map(({ name, detail }) => `${name}: ${detail}`)).toEqual([
      "SAFEGUARD-9 PROMOTION BEYOND VALIDITY: hn 6-0 p 0.016 joined at level 0.02, 0-0 p 1.000 on validity alone, 0-0 p 1.000 without the bill by the current score",
    ]);
  });
});

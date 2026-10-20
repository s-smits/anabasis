// Lane 31's triggers on a campaign small enough to count by hand: a Builder session leaves hn, two
// comparisons against a starter that answers almost nothing read it a step, the table promotes it,
// and the campaign moves its budget, holds out two tasks, runs a control and builds from it. One
// reference solve runs a program another campaign compiled under the host's `/tmp`, and two new
// solves write one script there.
import { describe, expect, it } from "bun:test";
import { type Condition, conditionId } from "../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { keyIfNotNull } from "../src/meta/optional-key.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { climbTable, crossings, safeguardTriggers } from "../tools/wri/climb.ts";
import { indexOf, type TRIGGERS } from "../tools/wri/folds.ts";
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
 * answers apart by the objective. Every frontier task is won by 16 pairs in each reading; on
 * validity alone they tie, unless the reference `fails` each of its solves.
 */
function leaning({ author, spread, fails }: { author: number; spread: number; fails: boolean }) {
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
    for (const each of solves) put(each.kind, each.data);
    const differences = tasks.map(() => 16);
    put("comparison.reported", {
      ...REPORT,
      ...terms,
      session,
      old: "hbase",
      fresh: "hn",
      level: 0.02,
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

describe("lane 31: a promotion and the climb after it", () => {
  it("reads what a promotion rested on, by whose word and under which rule", () => {
    const read = triggered(promoted(true).log);
    expect(read("PROMOTED")).toEqual([
      "hn from hbase at event 34, 0.0 h and $0 after the opening, by the table; opened with level 0.1, trigger 0.25; rests on g-1 4-0-0 p 0.063 at level 0.1, untied 4 of 4, against the reference's own 1 of 4 (1-0-3 p 1.000); g-2 4-0-0 p 0.063 at level 0.1, untied 4 of 4, against the reference's own 1 of 4 (1-0-3 p 1.000); by budget turns 4 2-0-2 p 0.500",
    ]);
  });

  it("reads a promotion the Builder's tool made, whose move follows it, as the table's", () => {
    expect(triggered(promoted(true, true).log)("PROMOTED")[0]).toContain(", by the table;");
  });

  it("gives a rest comparison's load over the solves it measured, not the non-results it reran", () => {
    // Buffer's g-1 on 12 October: a median load of 15.3 over its 70 starts, and 37.9 over the 48 that measured.
    const { log, put, compare } = campaign();
    const reported = compare("g-1", "hbase", "hn", { ...STEP, versions: [] });
    const cut = { outcome: "non-result", kind: "provider" };
    for (const [id, load, ending] of [
      ["r1", 30, { outcome: "pass" }],
      ["r2", 2, cut],
      ["r3", 3, cut],
    ] as const) {
      put("solve.started", {
        solve: id,
        limits: { wallSeconds: 480 },
        load: [load, 1, 1],
        comparison: "g-1",
      });
      put("solve.finished", { solve: id, ending, seconds: 50 });
    }
    reported();
    put("harness.promoted", {
      harness: "hn",
      from: "hbase",
      rests: [{ comparison: "g-1", against: "hbase", reading: "step" }],
    });
    expect(triggered(log)("PROMOTED")[0]).toContain("; load median 30.0");
  });

  it("names a step won against a reference that answered nothing on most tasks, and no other", () => {
    const read = triggered(promoted(false).log);
    expect(read("PROMOTED")[0]).toContain("by the operator");
    // g-2's reference answered none on 2 of 4: half, which is not more than half.
    expect(read("STARTER BARE")).toEqual([
      "g-1: the reference answered none of its solves on 3 of 4 tasks (13% of solves valid), the new harness 100%",
    ]);
  });

  it("says nothing has followed a promotion yet, and then what did, in order", () => {
    const run = promoted(true);
    expect(triggered(run.log)("AFTER THE PROMOTION")).toEqual([
      "hn, 0.0 h and $0 since: Examiner sessions: none; Builder sessions: none",
    ]);
    const { put, compare } = run;
    put("campaign.setting", { minutes: 8, turns: 24, modelTurns: 8, target: 12 });
    put("exam.started", { session: "x-2" });
    for (const version of ["v5", "v6"]) {
      put("task.proposed", { version, taskId: version });
      put("task.gate", { version, gate: 1, outcome: "passed" });
    }
    put("exam.finished", { session: "x-2", ended: "finished", held: ["v5", "v6"] });
    // The control: the starter against the promoted harness, which answers 6 of its 8 solves.
    compare("g-3", "hn", "hbase", {
      ...STEP,
      scored: { wins: 0, losses: 3, ties: 1, p: 0.25 },
      valid: { old: [0, 2, 2], fresh: [3, 1, 0] },
      reading: "no-step",
    })();
    // A release after the promotion, of a task proposed before it: buffer-a's prepare move on
    // 10 October, which a reader that folded the stretch alone refused as never proposed.
    put("task.state", { version: "v5", state: "released" });
    put("build.started", { session: "b-2", parent: "hn", tasks: ["t1", "v5"] });
    for (const version of ["t1", "v5"]) run.solve(`q-${version}`, version, "hn", null, []);
    put("build.finished", { session: "b-2", ended: "finished", harness: "hm", changed: true });
    compare("g-4", "hn", "hm", STEP);
    expect(triggered(run.log)("AFTER THE PROMOTION")).toEqual([
      "hn, 0.0 h and $0 since: settings: model turns 8; Examiner sessions: x-2 held 2; control g-3: the promoted harness valid on 75% of its solves of 4 tasks, 0-3-1 p 0.250; g-4 started, not reported; Builder sessions: b-2 from the promoted harness, practising 2 (1 written since the promotion)",
    ]);
  });

  it("counts what named the host's /tmp, by side, and names the program found there and the script two solves shared", () => {
    expect(triggered(promoted(true).log)("SHARED TEMPORARY FOLDER")).toEqual([
      "3 solves by side: g-1 new hn 2, g-1 reference hbase 1; Builder calls: b-1 1; programs under it: /tmp/phq-inst/bin/phreeqc by r1; named by more than one solve or session: /tmp/m.py by 2",
    ]);
  });

  it("reads /var/tmp as the host's too, in either spelling, and a solve's own folder as its own", () => {
    const { log, put, solve } = campaign();
    put("campaign.opened", { budget: 300, terms: {} });
    solve("p1", "v1", "hn", "g-1", ["ls /private/var/tmp/run/bin/phreeqc", "cat /var/tmp/run/notes.txt"]);
    solve("p2", "v2", "hn", "g-1", ["cat /var/tmp/run/notes.txt", "ls /var/folders/x/T/own"]);
    solve("p3", "v3", "hn", "g-1", ["ls /var/folders/x/T/own"]);
    expect(triggered(log)("SHARED TEMPORARY FOLDER")).toEqual([
      "2 solves by side: g-1 new hn 2; programs under it: /private/var/tmp/run/bin/phreeqc by p1; named by more than one solve or session: /var/tmp/run/notes.txt by 2",
    ]);
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

  it("excludes denied calls from every seat", () => {
    const { log, put } = campaign();
    for (const [seat, by] of [
      ["solve", { solve: "solver" }],
      ["build", { session: "builder" }],
      ["exam", { session: "examiner" }],
    ] as const) {
      put(`${seat}.call`, {
        ...by,
        tool: "bash",
        args: { command: "cat /tmp/denied/bin/program" },
        isError: true,
        text: "Operation not permitted",
      });
    }
    expect(triggered(log)("SHARED TEMPORARY FOLDER")).toEqual([]);
  });

  it("keeps a shared sibling path while excluding private paths in the same successful calls", () => {
    const { log, put } = campaign();
    const shared = "/tmp/ana-built-bash-tools/bin/program";
    for (const seat of ["build", "exam"] as const) {
      put(`${seat}.call`, {
        session: seat,
        tool: "bash",
        args: { command: `cat /tmp/ana-built-bash/solve-${seat}/home/bin/private; ${shared}` },
        isError: false,
      });
    }
    const details = triggered(log)("SHARED TEMPORARY FOLDER");
    expect(details).toHaveLength(1);
    expect(details[0]).toContain(shared);
    expect(details[0]).not.toContain("/ana-built-bash/");
  });

  it("fires none of its triggers on a campaign that promoted nothing and named no /tmp", () => {
    const { log, put } = campaign();
    put("campaign.opened", { budget: 300, terms: {} });
    const lane = overview(log).triggers.filter((trigger) => trigger.lane === 31);
    expect(lane).toEqual([]);
  });
});

describe("lane 31 across campaigns", () => {
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

  it("sets each campaign in lane 31's columns, promoted or not", () => {
    const table = climbTable(peers()).split("\n");
    expect(table).toHaveLength(4);
    expect(table[2]).toContain("| promoting |");
    expect(table[2]).toContain("| level 0.1, trigger 0.25 | hn at 20:01Z |");
    expect(table[2]).toContain("g-1 4-0-0 p 0.063, 4/4, 1/4; g-2 4-0-0 p 0.063, 4/4, 1/4 | g-1 13%; g-2 25%");
    expect(table[3]).toContain("| building | none | default | none yet | - | none reported |");
    // A campaign that ended and was run again reads as going on, at its last move.
    const again = campaign();
    again.put("campaign.opened", { budget: 300, terms: {} });
    again.put("campaign.ended", { ending: "finished" });
    again.put("campaign.move", { move: "examine", session: "x-1" });
    expect(climbTable([{ name: "again", events: again.log }])).toContain("| examine x-1 |");
    again.put("campaign.ended", { ending: "budget" });
    expect(climbTable([{ name: "again", events: again.log }])).toContain("| ended |");
  });

  it("reads a campaign that ended and went on from its log by its last move, and one that ended as ended", () => {
    const resumed = campaign();
    resumed.put("campaign.opened", { budget: 300, terms: {} });
    resumed.put("campaign.move", { move: "build", session: "b-1" });
    resumed.put("campaign.ended", { ending: "environment" });
    resumed.put("campaign.move", { move: "examine", session: "x-1" });
    const [, , row] = climbTable([{ name: "resumed", events: resumed.log }]).split("\n");
    expect(row).toEndWith("| examine x-1 |");
    resumed.put("campaign.ended", { ending: "finished" });
    const [, , again] = climbTable([{ name: "resumed", events: resumed.log }]).split("\n");
    expect(again).toEndWith("| ended |");
  });

  it("names a solve that ran what another campaign's session left, with its side and every path", () => {
    expect(crossings(peers()).left).toEqual([
      "promoting solve r1 (g-1 reference) from 20:01Z: /tmp/phq-inst/bin/phreeqc (building b-1, 20:00Z)",
      "promoting solve n1 (g-1 new) from 20:01Z: /tmp/m.py (building b-1, 20:00Z)",
    ]);
  });

  it("names a promotion that cleared its level only on tasks held on their author's answer, and by the objective", () => {
    // r3's third promotion on 19 October: 8-0 joined, 3-0 (p 0.125) without the tasks its gate held
    // on their author's answer alone, and 1-0 on validity alone.
    const said = safeguardTriggers(indexOf(leaning({ author: 4, spread: 2, fails: false })));
    expect(said.map(({ name, detail }) => `${name}: ${detail}`)).toEqual([
      "SAFEGUARD-8 PROMOTION ON AUTHOR ROOM: hn 6-0 p 0.016 joined at level 0.02, 2-0 p 0.250 without the tasks held on their author's answer alone",
      "SAFEGUARD-9 PROMOTION BY THE OBJECTIVE ALONE: hn 6-0 p 0.016 joined at level 0.02, 0-0 p 1.000 on validity alone",
    ]);
  });

  it("names neither where the promotion stands without those tasks and on validity alone", () => {
    expect(safeguardTriggers(indexOf(leaning({ author: 1, spread: 6, fails: true })))).toEqual([]);
  });

  it("names neither for a promotion its own joined frontier does not carry", () => {
    expect(safeguardTriggers(indexOf(leaning({ author: 4, spread: 1, fails: false })))).toEqual([]);
  });
  it("counts a scratch name two campaigns' solves chose as no leak", () => {
    const [promoting] = peers();
    if (promoting === undefined) throw new Error("a campaign");
    const again = {
      name: "again",
      events: promoting.events.map((event) => ({ ...event, at: event.at.replace("T20", "T21") })),
    };
    const { left, scratch } = crossings([promoting, again]);
    expect(left).toEqual([]);
    expect(scratch).toBe("2 scratch paths named by solves of two campaigns, in 2 solves");
  });
});

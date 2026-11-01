// Whole-run reader boundaries: practice gaps, recorded tests, solve limits and program answers.
import { describe, expect, it } from "bun:test";
import { detectable, flipP, power } from "../src/kernel/compare.ts";
import { conditionId, settingId } from "../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject, JsonValue } from "../src/meta/json-shape.ts";
import { keyIfDefined, keyIfNotNull } from "../src/meta/optional-key.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { indexOf, type TRIGGERS } from "../tools/wri/folds.ts";
import { testedOf } from "../tools/wri/promotion.ts";
import { overview } from "../tools/wri/read.ts";
import { conditionOf } from "./helpers/logged-round.ts";

const START = Date.parse("2026-10-09T12:00:00Z");
const REPORTED = "comparison.reported";
const PROPOSED = "task.proposed";
const BUILD_STARTED = "build.started";
const BUILD_FINISHED = "build.finished";
const SOLVE_STARTED = "solve.started";
const SOLVE_FINISHED = "solve.finished";
const CONDITION_RECORDED = "condition.recorded";
const COMPARISON_STARTED = "comparison.started";
const GATE = "task.gate";
const EXAM_STARTED = "exam.started";
const HELD = ["v1", "v2", "v3", "v4"];
const TESTED = { wins: 0, losses: 0, ties: 0, p: 1 };
/** A report's fields where a case names none: a comparison that tallied nothing and stopped nowhere. */
const REPORT = {
  scored: TESTED,
  versions: [],
  aside: [],
  short: [],
  capped: false,
};
const events: LogEvent[] = [];
/** A writer of events onto `log`, a second apart from the start. */
const appendTo = (log: LogEvent[]) => (kind: EventKind, data: JsonObject) => {
  log.push({ at: new Date(START + log.length * 1000).toISOString(), kind, data });
};
const record = appendTo(events);

const condition = (task: string, harness: string) =>
  conditionOf(task, harness, { wallSeconds: 100, turns: 8 });
const SETTING = settingId(condition("any", "any"));

let solves = 0;
/** The comparison the next solves are made for: none until one starts. */
let comparison: string | null = null;
/** One finished solve of `task` under `harness`: a valid answer, one a check rejected, with the
 *  verdict a rejection carries, none within its limits, or none though its limits left it room. */
function solve(task: string, harness: string, outcome: "pass" | "rejected" | "late"): string {
  const ran = condition(task, harness);
  const id = `s${String((solves += 1))}`;
  record(CONDITION_RECORDED, { id: conditionId(ran), condition: requireJsonValue(ran) });
  record(SOLVE_STARTED, {
    solve: id,
    condition: conditionId(ran),
    limits: { wallSeconds: 100 },
    ...keyIfNotNull("comparison", comparison),
  });
  record("solve.call", { solve: id, turn: 1, tool: "submit", isError: false });
  record(SOLVE_FINISHED, {
    solve: id,
    ending:
      outcome === "pass"
        ? { outcome }
        : {
            outcome: "fail",
            kind: outcome === "late" ? "wall-ended" : "rejected",
          },
    seconds: 50,
    responseModels: ["m-1"],
    billed: 1,
  });
  if (outcome === "rejected") record("verdict", { solve: id, task, kind: "fail", blocking: ["check-a"] });
  return id;
}

for (const version of ["t1", ...HELD]) {
  record(PROPOSED, { version });
  record(GATE, { version, gate: 1, outcome: "passed" });
}
record("task.state", { version: "t1", state: "released" });
record(BUILD_STARTED, { session: "b-1", parent: "hp", tasks: ["t1"] });
record("build.call", { session: "b-1", tool: "write_file", args: { path: "agent/tools.mjs" } });
record("build.call", { session: "b-1", tool: "practice", args: { task: "t1" } });
// The practice solve runs under the state as it then stood, hb; the edit after it makes hc.
solve("t1", "hb", "rejected");
record("build.call", { session: "b-1", tool: "edit", args: { path: "agent/BUILT_AGENTS.md" } });
record(BUILD_FINISHED, { session: "b-1", ended: "finished", harness: "hc", changed: true, billed: 2 });
// The round's comparison. The reference harness's answers to v1 and v2 are rejected, one ruled a
// check defect and one ruled by nobody, and it gives none to v3 and v4 within its limits. The new
// harness answers all four.
comparison = "b-1";
const round = {
  session: "b-1",
  old: "hp",
  fresh: "hc",
  starter: "hbase",
  setting: SETTING,
  solves: 1,
  level: 0.1,
  tasks: 4,
};
record(COMPARISON_STARTED, { ...round, tasks: HELD });
const defect = solve("v1", "hp", "rejected");
solve("v1", "hc", "pass");
solve("v2", "hp", "rejected");
solve("v2", "hc", "pass");
for (const version of ["v3", "v4"]) {
  solve(version, "hp", "late");
  solve(version, "hc", "pass");
}
record("referee.finding", {
  solve: defect,
  task: "v1",
  ruling: "check-defect",
  check: "check-a",
  probes: [],
});
record(REPORTED, {
  ...REPORT,
  ...round,
  scored: { wins: 2, losses: 0, ties: 0, p: 0.25, unsolved: 0 },
  versions: ["v3", "v4"],
  aside: ["v1", "v2"],
  reading: "no-step",
});

describe("the whole-run investigation's reader", () => {
  it("counts as a session's practice a task released while it ran, and a solver's flag beside a pass as a flip", () => {
    // Buffer-r3 on 20 October: b-1 opened on 1 task and practised 24 solves, of which the set of its
    // opening counted 5; a flagged solve beside a passing one in g-3 was left out of the flips.
    const ended = (
      id: string,
      task: string,
      harness: string,
      outcome: string,
      made: JsonObject,
    ): LogEvent[] => {
      const ran = condition(task, harness);
      return (
        [
          [CONDITION_RECORDED, { id: conditionId(ran), condition: requireJsonValue(ran) }],
          [SOLVE_STARTED, { solve: id, condition: conditionId(ran), limits: { wallSeconds: 100 }, ...made }],
          [SOLVE_FINISHED, { solve: id, ending: { outcome }, seconds: 2, responseModels: ["m-1"] }],
        ] as const
      ).map(([kind, data]) => ({ at: new Date(START).toISOString(), kind, data }));
    };
    const practised = [
      ...(
        [
          [PROPOSED, { version: "t9" }],
          [GATE, { version: "t9", gate: 1, outcome: "passed" }],
          ["task.state", { version: "t9", state: "released" }],
        ] as const
      ).map(([kind, data]) => ({ at: new Date(START).toISOString(), kind, data })),
      ...ended("p9", "t9", "hc", "pass", {}),
    ];
    const done = events.findIndex(({ kind }) => kind === BUILD_FINISHED);
    const at = events.findIndex(({ kind }) => kind === REPORTED);
    const flagged = [...events.slice(done, at), ...ended("f3", "v3", "hc", "flagged", { comparison: "b-1" })];
    const { triggers } = overview([...events.slice(0, done), ...practised, ...flagged, ...events.slice(at)]);
    expect(triggers.map(({ name }) => name)).not.toContain("FINAL BYTES NEVER PRACTISED");
    const flips = triggers.find(({ name }) => name === "FLIPS")?.detail;
    expect(flips).toContain("b-1: 1 of 8 task and harness pairs");
    // Practice of the measured bytes after their comparison began says nothing of what it read.
    const afterwards = overview([...events.slice(0, done), ...flagged, ...events.slice(at), ...practised]);
    expect(afterwards.triggers.map(({ name }) => name)).toContain("FINAL BYTES NEVER PRACTISED");
  });
});

describe("the reader of final harness practice", () => {
  it("describes an unused child as frozen and a begun comparison by its report status", () => {
    const log = events.map((event) =>
      event.kind.startsWith("comparison.") ? { ...event, data: { ...event.data, fresh: "hb" } } : event,
    );
    const frozen = overview(log).triggers.filter(({ name }) => name === "FINAL BYTES NEVER PRACTISED");
    expect(frozen).toHaveLength(1);
    expect(frozen[0]?.detail).toContain("hc");
    expect(frozen[0]?.detail).toContain("frozen at session end");
    expect(frozen[0]?.detail).toContain("no comparison");
    expect(frozen[0]?.detail).not.toContain("measured");
    const add = appendTo(log);
    add(COMPARISON_STARTED, { session: "g-2", old: "hp", fresh: "hc", setting: SETTING });
    const ran = condition("t1", "hc");
    add(CONDITION_RECORDED, { id: conditionId(ran), condition: requireJsonValue(ran) });
    add(SOLVE_STARTED, { solve: "late-practice", condition: conditionId(ran) });
    add(SOLVE_FINISHED, { solve: "late-practice", ending: { outcome: "pass" } });
    const begun = overview(log).triggers.filter(({ name }) => name === "FINAL BYTES NEVER PRACTISED");
    expect(begun).toHaveLength(1);
    expect(begun[0]?.detail).toContain("g-2");
    expect(begun[0]?.detail).toContain("begun without a report");
    expect(begun[0]?.detail).toContain("last ran under hb");
    add(REPORTED, { ...REPORT, session: "g-2", old: "hp", fresh: "hc", setting: SETTING });
    const reported = overview(log).triggers.filter(({ name }) => name === "FINAL BYTES NEVER PRACTISED");
    expect(reported).toHaveLength(1);
    expect(reported[0]?.detail).toContain("reported comparison g-2");
    expect(reported[0]?.detail).toContain("last ran under hb");
  });

  it("reads an unreported comparison before later practice of its frozen checkpoint", () => {
    const log = events
      .flatMap((event): LogEvent[] => {
        if (event.kind === BUILD_FINISHED) return [];
        const data =
          event.data.session === "b-1" && event.kind.startsWith("comparison.")
            ? { ...event.data, session: "g-1" }
            : event.data.comparison === "b-1"
              ? { ...event.data, comparison: "g-1" }
              : event.data;
        const frozen = {
          at: event.at,
          kind: "build.checkpoint",
          data: { session: "b-1", harness: "hc" },
        } as const;
        return event.kind === COMPARISON_STARTED ? [frozen, { ...event, data }] : [{ ...event, data }];
      })
      .filter(({ kind }) => kind !== REPORTED);
    const add = appendTo(log);
    const ran = condition("t1", "hc");
    add(CONDITION_RECORDED, { id: conditionId(ran), condition: requireJsonValue(ran) });
    add(SOLVE_STARTED, { solve: "after-start", condition: conditionId(ran) });
    add(SOLVE_FINISHED, { solve: "after-start", ending: { outcome: "pass" } });
    const gaps = overview(log).triggers.filter(({ name }) => name === "FINAL BYTES NEVER PRACTISED");
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.detail).toContain("comparison g-1 begun without a report");
    expect(gaps[0]?.detail).toContain("last ran under hb");
  });
});

describe("the reader of no-step reports", () => {
  it.each([
    ["buffer-g6", [-16, -9, 2, -9, 150, 119, 0, 19]],
    [
      "v070-g4",
      [
        -100, 200, 42, 125, 35, 125, -26, -10, -25, 202, -25, 333, 125, 52, 200, 143, 8, 200, 136, 55, 200,
        -63, -45, 39, -250, -339, -63, -94, -100, -333, -109, -106,
      ],
    ],
  ])("keeps %s's no-step and power facts without diagnosing sweep dependence", (session, differences) => {
    const level = 0.02;
    const tested = {
      wins: differences.filter((value) => value > 0).length,
      losses: differences.filter((value) => value < 0).length,
      ties: differences.filter((value) => value === 0).length,
      p: flipP(differences),
      detectable: detectable(differences, level),
      falseRate: power(differences, 0.5, level),
      unsolved: 0,
    };
    const log = [...events];
    const put = appendTo(log);
    put(COMPARISON_STARTED, {
      session,
      old: "hp",
      fresh: "hf",
      tasks: HELD,
      level,
      solves: 1,
      setting: SETTING,
    });
    put(REPORTED, {
      ...REPORT,
      session,
      old: "hp",
      fresh: "hf",
      setting: SETTING,
      level,
      scored: tested,
      frontier: { differences },
      retained: { differences: [] },
      versions: HELD,
      reading: "no-step",
    });
    const last = indexOf(log).compared.find((each) => each.session === session)?.last;
    expect(last).toMatchObject({ reading: "no-step", scored: tested });
    expect(testedOf(last ?? {}).differences).toEqual(differences);
    expect(tested.p).toBeGreaterThan(level);
    const read = overview(log);
    expect(read.triggers.find(({ name }) => name === "CHAIN")?.detail).toContain(`${session} hp>hf no-step`);
    expect(
      read.triggers.some(
        (trigger) =>
          trigger.detail.startsWith(`${session}:`) &&
          /FEW INFORMATIVE PAIRS|sweep/i.test(`${trigger.name} ${trigger.detail}`),
      ),
    ).toBe(false);
  });
});

function comparedFromAnotherParent() {
  const log: LogEvent[] = [];
  const put = appendTo(log);
  /** One solve of v1 under `harness` for the round's comparison, ended as `ending` says. */
  const made = (id: string, harness: string, ending: JsonObject, seconds: number) => {
    const ran = condition("v1", harness);
    put(CONDITION_RECORDED, { id: conditionId(ran), condition: requireJsonValue(ran) });
    put(SOLVE_STARTED, {
      solve: id,
      condition: conditionId(ran),
      limits: { wallSeconds: 100 },
      comparison: "r-1",
    });
    put("solve.call", { solve: id, turn: 1, tool: "submit", isError: false });
    put(SOLVE_FINISHED, {
      solve: id,
      ending,
      seconds,
      responseModels: ["m-1"],
    });
  };
  put(PROPOSED, { version: "v1" });
  put(GATE, { version: "v1", gate: 1, outcome: "passed" });
  // The session goes on from the harness an earlier one left, hx. Its comparison is made against
  // the reference harness, href.
  put(BUILD_STARTED, { session: "r-1", parent: "hx", tasks: [] });
  put(BUILD_FINISHED, { session: "r-1", ended: "finished", harness: "hy", changed: true });
  put(EXAM_STARTED, { session: "x-8" });
  put("exam.finished", { session: "x-8", ended: "finished" });
  put(EXAM_STARTED, { session: "x-9" });
  for (const turn of [1, 2]) put("exam.turn", { session: "x-9", turn, usage: { cost: { total: 0.25 } } });
  const terms = { session: "r-1", old: "href", fresh: "hy", starter: "hbase", setting: SETTING };
  put(COMPARISON_STARTED, { ...terms, solves: 1, level: 0.1, tasks: ["v1"] });
  made("q1", "href", { outcome: "non-result", kind: "provider", reason: "cut" }, 50);
  made("q2", "href", { outcome: "fail", kind: "wall-ended" }, 100);
  // The new harness's valid answer came in two seconds of a hundred, with one call.
  made("q3", "hy", { outcome: "pass" }, 2);
  put(REPORTED, {
    ...REPORT,
    ...terms,
    solves: 1,
    level: 0.1,
    tasks: 1,
    scored: { ...TESTED, wins: 1, p: 0.5, unsolved: 0 },
    valid: { old: [1, 0], fresh: [0, 1] },
    noise: { wins: 0, losses: 4, ties: 0, p: 1, differences: [-2, -2, -2, -2] },
    versions: ["v1"],
    reading: "no-step",
  });
  return log;
}

describe("the reader of a round compared with another harness than its session started from", () => {
  const log = comparedFromAnotherParent();

  // Until 11 October lane 30 opened on every live campaign's running Examiner session, and row F's
  // moves left out the move being made, whose `campaign.move` is written when it ends.
  it("names a session open at the log's end in row F, with what it did so far, and says it apart in lane 30", () => {
    const live = [...log];
    const more = appendTo(live);
    more(EXAM_STARTED, { session: "x-10" });
    more("exam.turn", { session: "x-10", turn: 1, usage: { cost: { total: 0.25 } } });
    more(PROPOSED, { version: "v9", session: "x-10" });
    more(GATE, { version: "v9", gate: 1, outcome: "passed" });
    const read = overview(live);
    // `bun run runs stop` writes no ending, so an open session may be a stopped one, and the lane
    // still opens on it.
    const unfinished = read.triggers.find(({ name }) => name === "EXAMINER NEVER FINISHED")?.detail;
    expect(unfinished).toBe("x-9; x-10 open at the log's end");
    const line = read.rows.find(({ id }) => id === "F")?.lines.find((each) => each.includes("x-10"));
    expect(line).toContain("Examiner");
    expect(line).toContain("open");
    expect(line).toContain("1 turn and 1 task held out");
    expect(line).toContain(live.at(-3)?.at ?? "MISSING_TIMESTAMP");
  });

  // N on 28 October: twelve proposals, five held and one refused, six still at the gate.
  it("reads thin supply on the tasks the gate decided, leaving out those still at the gate", () => {
    const thin = (held: number, refused: number, pending: number) => {
      const exam: LogEvent[] = [];
      const more = appendTo(exam);
      more(EXAM_STARTED, { session: "x-1" });
      const outcomes = [
        ...Array.from({ length: held }, () => "passed"),
        ...Array.from({ length: refused }, () => "refused"),
        ...Array.from({ length: pending }, () => null),
      ];
      for (const [index, outcome] of outcomes.entries()) {
        more(PROPOSED, { version: `w${String(index)}`, session: "x-1" });
        if (outcome !== null) more(GATE, { version: `w${String(index)}`, gate: 1, outcome, reason: "room" });
      }
      return overview(exam).triggers.find(({ name }) => name === "SUPPLY THIN")?.detail;
    };
    expect(thin(5, 1, 6)).toBeUndefined();
    expect(thin(1, 3, 2)).toBe("1 of 4 decided tasks passed task admission");
  });

  // buffer-main's g-1 had four solves in flight on 11 October, and lane 27 read them as killed.
  it("reads a solve with no end as open while its comparison is, and as never finished once the campaign ended", () => {
    const live = [...log];
    const more = appendTo(live);
    more(COMPARISON_STARTED, {
      session: "g-9",
      old: "href",
      fresh: "hy",
      solves: 1,
      level: 0.1,
      tasks: ["v1"],
    });
    more(SOLVE_STARTED, { solve: "s-9", condition: "c-9", comparison: "g-9" });
    const open = overview(live);
    const unfinished = open.triggers.find(({ name }) => name === "SOLVE NEVER FINISHED")?.detail;
    expect(unfinished).toBe("1 solve open at the log's end");
    const lines = open.rows.flatMap((row) => row.lines);
    expect(lines).toContain("0 solves never finished, 1 open at the log's end");
    expect(lines).toContain("open at the log's end: g-9, a comparison: 0 solves ended and 1 open");
    more("campaign.ended", { ending: "no-room" });
    const ended = overview(live);
    const never = ended.triggers.find(({ name }) => name === "SOLVE NEVER FINISHED")?.detail;
    expect(never).toBe("1 solve");
    const endedLines = ended.rows.flatMap((row) => row.lines);
    expect(endedLines).toContain("1 solve never finished");
    expect(endedLines.some((line) => line.startsWith("open at the log's end"))).toBe(false);
  });

  it("counts a caller's kill among the non-results and a task admission's own cut of a room solve nowhere", () => {
    const killedBy = (origins: readonly string[]) => {
      const cut = [...log];
      const more = appendTo(cut);
      for (const [index, cancelledBy] of origins.entries()) {
        const id = `k-${String(index)}`;
        more(SOLVE_STARTED, { solve: id, condition: "c-k" });
        more(SOLVE_FINISHED, {
          solve: id,
          ending: { outcome: "non-result", kind: "killed", reason: "cancelled", cancelledBy },
        });
      }
      return overview(cut).triggers.find(({ name }) => name === "NON-RESULTS")?.detail ?? "";
    };
    expect(killedBy(["admission", "admission"])).not.toContain("killed");
    expect(killedBy(["admission", "caller"])).toContain("killed 1");
  });

  it("does not diagnose an A/A step carried by the bill", () => {
    const baselineNoise = overview(log).triggers.find(
      ({ name }) => name === "REFERENCE AGAINST ITSELF",
    )?.detail;

    const withUnbilled = (unbilled: readonly number[]) =>
      overview(
        log.map((each) =>
          each.kind === REPORTED
            ? {
                ...each,
                data: {
                  ...each.data,
                  noise: {
                    wins: 0,
                    losses: 4,
                    ties: 0,
                    p: 1,
                    differences: [-2, -2, -2, -2],
                    unbilled: [...unbilled],
                  },
                },
              }
            : each,
        ),
      ).triggers.find(({ name }) => name === "REFERENCE AGAINST ITSELF")?.detail;
    // Same tally and p; only whether the unbilled test supports the false step changes.
    const supported = withUnbilled([-2, -2, -2, -2]);
    expect(withUnbilled([0, 0, 0, 0])).not.toBe(supported);
    expect(supported).toBe(baselineNoise);
  });
});

describe("the reader of the load a comparison's solves started under", () => {
  /** A log of one comparison a row: its id, the one-minute load each of its solves started under,
   *  the host's cores where the log holds them, and the order its harnesses started in, `o` for the
   *  reference and `n` for the new, mirrored as the round orders them where none is given, and the
   *  model that served the new harness's solves, the one asked for where none is given, and the
   *  model every condition asks for, `p/m` where none is given. */
  const read = (rows: readonly (readonly [string, readonly number[], number?, string?])[]) => {
    const log: LogEvent[] = [];
    const put = appendTo(log);
    put("task.proposed", { version: "v1" });
    put(GATE, { version: "v1", gate: 1, outcome: "passed" });
    for (const [session, loads, cores, order] of rows) {
      const terms = { session, old: "hbase", fresh: "hy", starter: "hbase", setting: SETTING };
      put(COMPARISON_STARTED, { ...terms, solves: 1, level: 0.1, tasks: ["v1"] });
      for (const [index, load] of loads.entries()) {
        const old = (order?.[index] ?? "onno"[index % 4]) === "o";
        const ran = condition("v1", old ? "hbase" : "hy");
        const id = `${session}-${String(index)}`;
        put(CONDITION_RECORDED, { id: conditionId(ran), condition: requireJsonValue(ran) });
        put(SOLVE_STARTED, {
          solve: id,
          condition: conditionId(ran),
          limits: { wallSeconds: 100 },
          load: [load, 1, 1],
          comparison: session,
          ...keyIfDefined("cores", cores),
        });
        put(SOLVE_FINISHED, {
          solve: id,
          ending: { outcome: "pass" },
          seconds: 50,
          responseModels: ["m"],
        });
      }
      put(REPORTED, { ...REPORT, ...terms, versions: ["v1"], reading: "no-step" });
    }
    const { triggers } = overview(log);
    return (name: keyof typeof TRIGGERS) =>
      triggers.flatMap((trigger) => (trigger.name === name ? [trigger.detail] : []));
  };

  it("names a comparison whose task's counted solves started off its mirrored order", () => {
    // buffer-v070's g-1 on 24 October: one side's solves waited for a provider's reset. g-5's
    // places sum alike on both sides, which the balance test before 25 October let pass.
    const said = read([
      ["g-1", [1, 1, 1, 1, 1, 1, 1, 1], 4, "onoonnno"],
      ["g-2", [1, 1, 1, 1, 1, 1, 1, 1], 4, "onnoonno"],
      ["g-3", [1, 1, 1, 1, 1], 4, "onnoo"],
      ["g-4", [1, 1, 1, 1, 1, 1, 1, 1], 4, "noonnoon"],
      ["g-5", [1, 1, 1, 1, 1, 1, 1, 1], 4, "onnonoon"],
    ]);
    expect(said("STARTS OUT OF TURN")).toEqual([
      "g-1: 1 of 1 tasks started their harnesses' solves out of turn",
      "g-5: 1 of 1 tasks started their harnesses' solves out of turn",
    ]);
  });

  it("reads the wall and the load on the solves a comparison measured, not on the non-results it reran", () => {
    // Buffer's g-1 on 12 October: provider attempts of a second or two at a low load, then reruns.
    const log: LogEvent[] = [];
    const put = appendTo(log);
    const terms = { session: "g-1", old: "hbase", fresh: "hy", starter: "hbase", setting: SETTING };
    put(COMPARISON_STARTED, { ...terms, solves: 1, level: 0.1, tasks: ["v1"] });
    const ran = (id: string, harness: string, load: number, ending: JsonObject, seconds: number) => {
      const made = condition("v1", harness);
      put(CONDITION_RECORDED, { id: conditionId(made), condition: requireJsonValue(made) });
      put(SOLVE_STARTED, {
        solve: id,
        condition: conditionId(made),
        limits: { wallSeconds: 100 },
        load: [load, 1, 1],
        cores: 12,
        comparison: "g-1",
      });
      put(SOLVE_FINISHED, { solve: id, ending, seconds, responseModels: ["m-1"] });
    };
    for (const harness of ["hbase", "hy"]) {
      ran(`${harness}-cut`, harness, 2, { outcome: "non-result", kind: "provider" }, 1);
      ran(`${harness}-cut-again`, harness, 2, { outcome: "non-result", kind: "provider" }, 1);
      ran(`${harness}-rerun`, harness, 30, { outcome: "pass" }, 50);
    }
    put(REPORTED, { ...REPORT, ...terms, versions: ["v1"], reading: "no-step" });
    const { triggers } = overview(log);
    expect(triggers.filter(({ lane }) => lane === 29)).toEqual([
      {
        lane: 29,
        name: "WALL SHARE",
        detail: "g-1: median 50.0% under the reference harness, 50.0% under the new",
      },
      {
        lane: 29,
        name: "HOST LOADED",
        detail: "g-1: load 30.0 at the median and 30.0 at most when its solves started, on 12 cores",
      },
    ]);
  });
});

describe("the reader of misses at a limit, by comparison and side", () => {
  /** A log of one comparison, g-1 of hp against hc, whose solves each end as a row says, after a
   *  submit in the turn it gives, with the turns its end records (by default that turn). */
  const read = (
    endings: readonly (readonly [string, JsonObject, number, number?, number?])[],
    modelTurns: number | null = 8,
  ) => {
    const log: LogEvent[] = [];
    const put = appendTo(log);
    put("task.proposed", { version: "v1" });
    put(GATE, { version: "v1", gate: 1, outcome: "passed" });
    const terms = { session: "g-1", old: "hp", fresh: "hc", starter: "hp", setting: SETTING };
    put(COMPARISON_STARTED, { ...terms, solves: 1, level: 0.1, tasks: ["v1"] });
    for (const [index, [harness, ending, seconds, turn, turns = turn]] of endings.entries()) {
      const ran = condition("v1", harness);
      const id = `m${String(index)}`;
      put(CONDITION_RECORDED, { id: conditionId(ran), condition: requireJsonValue(ran) });
      put(SOLVE_STARTED, {
        solve: id,
        condition: conditionId(ran),
        limits: { wallSeconds: 100, modelTurns },
        comparison: "g-1",
      });
      put("solve.call", { solve: id, ...keyIfDefined("turn", turn), tool: "submit", isError: false });
      put(SOLVE_FINISHED, {
        solve: id,
        ending,
        seconds,
        ...keyIfDefined("turns", turns),
        responseModels: ["m-1"],
      });
    }
    put(REPORTED, { ...REPORT, ...terms, versions: ["v1"], reading: "no-step" });
    return overview(log).triggers.flatMap((trigger) =>
      trigger.name === "MISSES AT A LIMIT" ? [trigger.detail] : [],
    );
  };
  const refused = { outcome: "fail", kind: "rejected" };

  it("keeps misses in an unreported comparison out of the outside count, and counts practice and admission misses in it", () => {
    // buffer-171-opus: an admission solve names its Examiner session, and while only a null
    // comparison was read as outside one the lane printed 2 of 3 misses at a limit for 20 of 77.
    const log: LogEvent[] = [];
    const put = appendTo(log);
    put(COMPARISON_STARTED, { session: "g-1", old: "hp", fresh: "hc", tasks: [] });
    const named = { reference: "g-1", new: "g-1", practice: undefined, admission: "x-1" };
    for (const [id, under] of Object.entries(named)) {
      put(SOLVE_STARTED, { solve: id, limits: { wallSeconds: 100 }, ...keyIfDefined("comparison", under) });
      put(SOLVE_FINISHED, { solve: id, ending: refused, seconds: 97 });
      if (under === "g-1") {
        expect(overview(log).triggers.filter((trigger) => trigger.name === "MISSES AT A LIMIT")).toEqual([]);
      }
    }
    const misses = overview(log).triggers.filter((trigger) => trigger.name === "MISSES AT A LIMIT");
    expect(misses).toHaveLength(1);
    expect(misses[0]?.detail).toContain("outside a comparison: 2 of 2 misses at a limit");
    expect(misses[0]?.detail).toContain("wall share 2");
    expect(misses[0]?.detail).not.toContain("g-1");
  });

  it("counts a miss on its turns, on its context or near its wall as at a limit, by side, with the bound told", () => {
    // recode on 10 October: 41 of 58 scored misses ended on turns, and a read of the wall saw none.
    const [detail] = read([
      ["hp", { outcome: "fail", kind: "turns-ended" }, 40],
      ["hp", refused, 97],
      ["hp", refused, 40],
      ["hc", { outcome: "fail", kind: "context-ended" }, 40],
      ["hc", { outcome: "pass" }, 40],
    ]);
    expect(detail).toContain("g-1: 2 of 3 reference misses and 1 of 1 new at a limit");
    expect(detail).toContain("context-ended 1, turns-ended 1, wall share 1; turns 8");
    for (const [turn, turns, bound, counted] of [
      [19, 19, 20, false],
      [20, 20, 20, true],
      [15, 16, 16, true],
      [16, 16, 17, false],
      [undefined, undefined, 1, false],
      [1, 1, null, false],
    ] as const) {
      const result =
        turn === undefined
          ? read([["hp", refused, 40]], bound)
          : read([["hp", refused, 40, turn, turns]], bound);
      expect(result).toHaveLength(counted ? 1 : 0);
      if (counted) expect(result[0]).toContain(`last turn 1; turns ${String(bound)}`);
    }
  });
});

describe("the reader of comparisons the campaign command named apart from its Builder sessions", () => {
  // One Builder's harness is measured in two comparisons, each named independently.
  const log: LogEvent[] = [];
  const put = appendTo(log);
  /** One solve of `task` under `harness` for comparison `measuredIn`, in `seconds` of a hundred. */
  const made = (task: string, harness: string, passed: boolean, measuredIn: string, seconds = 2) => {
    const ran = condition(task, harness);
    const id = `${measuredIn}-${task}-${harness}`;
    put(CONDITION_RECORDED, { id: conditionId(ran), condition: requireJsonValue(ran) });
    put(SOLVE_STARTED, {
      solve: id,
      condition: conditionId(ran),
      limits: { wallSeconds: 100 },
      comparison: measuredIn,
    });
    put("solve.call", { solve: id, turn: 1, tool: "submit", isError: false });
    put(SOLVE_FINISHED, {
      solve: id,
      ending: passed ? { outcome: "pass" } : { outcome: "fail", kind: "rejected" },
      seconds,
      responseModels: ["m-1"],
    });
    put("verdict", {
      solve: id,
      task,
      ...(passed ? { kind: "pass" } : { kind: "fail", blocking: ["check-a"] }),
    });
  };
  /** A comparison of `hc` against `hp` on `tasks`, each row a task and whether each side passed it. */
  const compared = (session: string, rows: readonly (readonly [string, boolean, boolean])[]) => {
    const terms = { session, old: "hp", fresh: "hc", starter: "hbase", setting: SETTING };
    const tasks = rows.map(([task]) => task);
    put(COMPARISON_STARTED, { ...terms, solves: 1, level: 0.1, tasks });
    for (const [task, old, fresh] of rows) {
      made(task, "hp", old, session, 50);
      made(task, "hc", fresh, session);
    }
    put("campaign.move", { move: "compare" });
    put(REPORTED, {
      ...REPORT,
      ...terms,
      solves: 1,
      level: 0.1,
      tasks: rows.length,
      versions: tasks,
      reading: "no-step",
    });
  };
  for (const version of ["t1", "v1", "v2"]) {
    put(PROPOSED, { version });
    put(GATE, { version, gate: 1, outcome: "passed" });
  }
  put(BUILD_STARTED, { session: "b-1", parent: "hp", tasks: ["t1"] });
  put(BUILD_FINISHED, { session: "b-1", ended: "finished", harness: "hc", changed: true });
  put("campaign.move", { move: "build" });
  // g-1: the reference fails v1 and the new harness passes it. g-2: both pass v1, which no
  // comparison of g-2's lost, and the reference fails v2 where the new harness fails it too.
  compared("g-1", [["v1", false, true]]);
  compared("g-2", [
    ["v1", true, true],
    ["v2", false, false],
  ]);

  it("reads a quick win of a task won on the objective, where the reference was valid too", () => {
    // buffer-fresh-gpt-v071's g-1 on 26 October: six tasks won with all 48 solves valid.
    const onObjective = log.map((event) =>
      event.kind === REPORTED && event.data.session === "g-2"
        ? { ...event, data: { ...event.data, frontier: { of: ["v1", "v2"], differences: [3, 0] } } }
        : event,
    );
    const quick = overview(onObjective).triggers.find(({ name }) => name === "WIN AT A SMALL WALL SHARE");
    expect(quick?.detail).toContain("b-1: 2 passed solves of tasks the new harness won");
  });

  it("reads a task its report's test names by the difference that report recorded", () => {
    // The Linux fork of #306 on 22 October: a task its comparison tied read as won by a later score.
    const tied = log.map((event) =>
      event.kind === REPORTED && event.data.session === "g-1"
        ? { ...event, data: { ...event.data, frontier: { of: ["v1"], differences: [0] } } }
        : event,
    );
    const names = overview(tied).triggers.map(({ name }) => name);
    expect(names).not.toContain("WINS");
    expect(names).not.toContain("WIN AT A SMALL WALL SHARE");
  });
});

describe("the reader of a harness that answered for its solver", () => {
  /** A log of one Builder session that practised `t1` and left `hy`, then its comparison with `href`
   *  on `v1`. A practice row is one solve's calls in order; a compared row is the harness one ran
   *  under and its calls. */
  const read = (
    practice: readonly (readonly string[])[],
    compared: readonly (readonly [string, readonly string[]])[],
    evidence: readonly { answer?: JsonValue; ending?: JsonObject; kind?: string }[] = [],
  ) => {
    const log: LogEvent[] = [];
    const put = appendTo(log);
    let next = 0;
    const made = (task: string, harness: string, calls: readonly string[], measuredIn: string | null) => {
      const judged: (typeof evidence)[number] = evidence[next++] ?? { answer: {} };
      const ran = condition(task, harness);
      const id = `s${String(log.length)}`;
      put(CONDITION_RECORDED, { id: conditionId(ran), condition: requireJsonValue(ran) });
      put(SOLVE_STARTED, {
        solve: id,
        condition: conditionId(ran),
        limits: { wallSeconds: 100 },
        ...keyIfNotNull("comparison", measuredIn),
      });
      for (const [turn, tool] of calls.entries()) {
        put("solve.call", { solve: id, turn, tool, isError: false });
      }
      if (judged.answer !== undefined) {
        put("verdict", { solve: id, answer: judged.answer, kind: judged.kind ?? "pass" });
      }
      put(SOLVE_FINISHED, {
        solve: id,
        ending: judged.ending ?? { outcome: "pass" },
        seconds: 50,
        responseModels: ["m-1"],
      });
    };
    for (const version of ["t1", "v1"]) {
      put("task.proposed", { version });
      put(GATE, { version, gate: 1, outcome: "passed" });
    }
    put("task.state", { version: "t1", state: "released" });
    put("build.started", { session: "p-1", parent: "href", tasks: ["t1"] });
    for (const calls of practice) made("t1", "hy", calls, null);
    put(BUILD_FINISHED, { session: "p-1", ended: "finished", harness: "hy", changed: true });
    const terms = { session: "p-1", old: "href", fresh: "hy", starter: "hbase", setting: SETTING };
    put(COMPARISON_STARTED, { ...terms, solves: 1, level: 0.1, tasks: ["v1"] });
    for (const [harness, calls] of compared) made("v1", harness, calls, "p-1");
    put(REPORTED, {
      ...REPORT,
      ...terms,
      solves: 1,
      level: 0.1,
      tasks: 1,
      versions: ["v1"],
      reading: "no-step",
    });
    const { triggers } = overview(log);
    return triggers.find((trigger) => trigger.name === "ANSWER FROM A PROGRAM")?.detail;
  };

  it("counts judged program answers by side and rejects extra commands, writes and flags", () => {
    const calls = ["bash", "submit"];
    const flagged = { ending: { outcome: "flagged" } };
    const evidence = [
      flagged,
      { ending: { outcome: "fail", kind: "no-answer" } },
      { answer: null },
      { answer: {}, kind: "non-result", ending: { outcome: "non-result", kind: "verifier" } },
    ];
    for (const [practice, compared, judged, fact] of [
      [[calls, ["bash", "bash", "submit"]], [], [], "1 of 2 practice solves"],
      [[calls, calls, calls, calls], [], evidence, "2 of 4 practice solves"],
      [[calls], [], [flagged], undefined],
      [
        [],
        [
          ["hy", calls],
          ["href", calls],
          ["href", calls],
        ],
        [{ answer: {} }, flagged, { answer: null }],
        "1 of 1 under the new harness, 1 of 2 under the reference",
      ],
      [
        [],
        [
          ["hy", ["read", "bash", "submit"]],
          ["hy", ["bash", "bash", "submit"]],
          ["href", calls],
          ["href", ["write", "bash", "submit"]],
        ],
        [],
        "1 of 2 under the new harness, 1 of 2 under the reference",
      ],
      // Adjacent quiet cases lost in the cut: neither the reference alone nor a write is a lead.
      [[["bash", "bash", "submit"]], [["hy", ["write", "bash", "submit"]]], [], undefined],
      [[], [["href", calls]], [], undefined],
    ] as const) {
      expect(read(practice, compared, judged)).toEqual(
        fact === undefined ? undefined : `one shell call, then submit, in p-1: ${fact}`,
      );
    }
  });
});

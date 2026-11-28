// The pairs a comparison reads from its log (`pairsOf`), over seeded random logs against the
// generator's own record. The generator writes every way a solve can fail to count (another comparison
// or setting, a stronger solver, a non-result, no ending, a mismatched or third harness) and finishes
// solves out of order. The rule: the first `solves` a side started that count; a task short of them is
// short; a disputed task is out on both sides; the reference against itself splits into mirrored halves
// whose count carries over tasks.
import { describe, expect, it } from "bun:test";
import { pairsOf } from "../src/kernel/compare.ts";
import { conditionId, settingId } from "../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import {
  lastReports,
  latestBuilt,
  pairsReported,
  poolOf,
  referenceOf,
  releaseOrder,
} from "../src/kernel/reports.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined, keysIf } from "../src/meta/optional-key.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { conditionOf } from "./helpers/logged-round.ts";

interface Planned {
  readonly id: string;
  readonly task: string;
  readonly harness: string;
  readonly comparison: string | null;
  readonly host: string;
  readonly side: "test" | "strong";
  readonly outcome: "pass" | "fail" | "flagged" | "non-result" | "open";
  readonly opened: "unsaid" | "same" | "other";
  readonly billed: number | null;
  readonly objective: number | null;
}

interface Read {
  readonly old: string;
  readonly fresh: string;
  readonly halves?: "mirrored";
  readonly objective?: { readonly direction: "higher" };
}

const TASKS = ["v0", "v1", "v2"];
const COMPARISON = "c-1";
const SETTING = settingId(conditionOf("v0", "old"));
const COUNTED = new Set(["pass", "fail", "flagged"]);
const ENDINGS: Record<Exclude<Planned["outcome"], "open">, JsonObject> = {
  pass: { outcome: "pass" },
  fail: { outcome: "fail", kind: "rejected" },
  flagged: { outcome: "flagged" },
  "non-result": { outcome: "non-result", kind: "provider" },
};
const READS: readonly Read[] = [
  { old: "old", fresh: "new" },
  { old: "starter", fresh: "new" },
  { old: "old", fresh: "new", halves: "mirrored" },
  { old: "old", fresh: "old", halves: "mirrored" },
  { old: "old", fresh: "new", objective: { direction: "higher" } },
];

const event = (kind: EventKind, data: JsonObject): LogEvent => ({
  at: "2026-10-09T00:00:00.000Z",
  kind,
  data,
});

/** A small seeded generator (a linear congruential one), so every log can be made again from its seed. */
function generator(seed: number) {
  let state = seed;
  const next = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
  const pick = <T>(list: readonly [T, ...T[]]): T => list[Math.floor(next() * list.length)] ?? list[0];
  return { next, pick };
}

function logOf(seed: number) {
  const { next, pick } = generator(seed);
  const planned = Array.from(
    { length: Math.floor(next() * 15) },
    (_, at): Planned => ({
      id: `s-${String(at)}`,
      task: pick(["v0", "v1", "v2"]),
      harness: pick(["old", "old", "new", "new", "starter"]),
      comparison: pick([COMPARISON, COMPARISON, COMPARISON, "c-0", null]),
      host: pick(["h", "h", "h", "h2"]),
      side: pick(["test", "test", "test", "strong"]),
      outcome: pick(["pass", "fail", "pass", "fail", "flagged", "non-result", "open"]),
      opened: pick(["unsaid", "unsaid", "same", "other"]),
      billed: next() < 0.5 ? Math.round(next() * 100) / 10 : null,
      objective: next() < 0.6 ? Math.floor(next() * 20) : null,
    }),
  );
  const disputed = new Set(TASKS.filter(() => next() < 0.2));
  const finish = (solve: Planned): LogEvent[] => {
    if (solve.outcome === "open") return [];
    return [
      event("solve.finished", {
        solve: solve.id,
        ending: ENDINGS[solve.outcome],
        ...keyIfDefined(
          "harness",
          { unsaid: undefined, same: solve.harness, other: "elsewhere" }[solve.opened],
        ),
        ...keyIfDefined("billed", solve.billed ?? undefined),
      }),
      ...(solve.outcome === "pass" && solve.objective !== null
        ? [event("verdict", { solve: solve.id, kind: "pass", objective: solve.objective })]
        : []),
    ];
  };
  const events = TASKS.flatMap((version) => [
    event("task.proposed", { version }),
    event("task.gate", { version, gate: 1, outcome: "passed" }),
  ]);
  const running: Planned[] = [];
  const finishOne = () => {
    const [solve] = running.splice(Math.floor(next() * running.length), 1);
    if (solve !== undefined) events.push(...finish(solve));
  };
  for (const solve of planned) {
    const condition = { ...conditionOf(solve.task, solve.harness), host: solve.host, side: solve.side };
    const id = conditionId(condition);
    events.push(
      event("condition.recorded", { id, condition: requireJsonValue(condition) }),
      event("solve.started", {
        solve: solve.id,
        condition: id,
        ...keyIfDefined("comparison", solve.comparison ?? undefined),
      }),
    );
    running.push(solve);
    while (running.length > 0 && next() < 0.5) finishOne();
  }
  while (running.length > 0) finishOne();
  events.push(...[...disputed].map((version) => event("task.state", { version, state: "disputed" })));
  return { events, planned, disputed };
}

/** The pairs the rule gives on the plan, written from `pairsOf`'s statement and not from its code. */
function expectedOf(planned: readonly Planned[], disputed: ReadonlySet<string>, read: Read, solves: number) {
  const counted = planned.filter(
    (solve) =>
      solve.side === "test" &&
      solve.comparison === COMPARISON &&
      solve.host === "h" &&
      COUNTED.has(solve.outcome) &&
      solve.opened !== "other",
  );
  const short: string[] = [];
  const pairs = TASKS.flatMap((task, place) => {
    if (disputed.has(task)) return [];
    const of = (harness: string) =>
      counted.filter((solve) => solve.task === task && solve.harness === harness);
    // The first and last of every four against the two between, the count carrying on over tasks.
    const offset = read.old === read.fresh ? place * 2 * solves : 0;
    const outer = (at: number) => read.halves === undefined || [0, 3].includes((offset + at) % 4);
    const reference = of(read.old);
    const before = reference.filter((_, at) => outer(at));
    const after = read.old === read.fresh ? reference.filter((_, at) => !outer(at)) : of(read.fresh);
    if (before.length < solves || after.length < solves) {
      short.push(task);
      return [];
    }
    const side = <T>(field: (solve: Planned) => T) => ({
      old: before.slice(0, solves).map(field),
      fresh: after.slice(0, solves).map(field),
    });
    return [
      {
        task,
        ...side((solve) => solve.outcome === "pass"),
        solves: side((solve) => solve.id),
        used: side((solve) => ({ billed: solve.billed })),
        ...keyIfDefined(
          "objective",
          read.objective && {
            ...read.objective,
            ...side((solve) => (solve.outcome === "pass" ? solve.objective : null)),
          },
        ),
      },
    ];
  });
  return { pairs, short, disputed: TASKS.filter((task) => disputed.has(task)) };
}

describe("the pairs a comparison reads from its log", () => {
  it("are the first solves each side started of those that count, over 300 seeded logs and every way of reading them", () => {
    const seen = { pairs: 0, short: 0, disputed: 0, reordered: 0 };
    for (let seed = 1; seed <= 300; seed += 1) {
      const { events, planned, disputed } = logOf(seed);
      for (const read of READS) {
        for (const solves of [1, 2]) {
          const sides = { ...read, setting: SETTING, comparison: COMPARISON };
          const found = pairsOf(events, TASKS, sides, solves);
          expect(found).toEqual(expectedOf(planned, disputed, read, solves));
          seen.pairs += found.pairs.length;
          seen.short += found.short.length;
          seen.disputed += found.disputed.length;
        }
      }
      const finished = events.filter((one) => one.kind === "solve.finished").map((one) => one.data.solve);
      const started = planned.filter((one) => finished.includes(one.id)).map((one) => one.id);
      if (finished.some((id, at) => id !== started[at])) seen.reordered += 1;
    }
    // The logs reach every branch the rule names; a generator that stopped doing so would pass empty.
    for (const count of Object.values(seen)) expect(count).toBeGreaterThan(50);
  });

  it("refuses a task that is not held out, and a harness set against itself without halves", () => {
    const held = [
      event("task.proposed", { version: "v1" }),
      event("task.gate", { version: "v1", gate: 1, outcome: "passed" }),
    ];
    const sides = { old: "old", fresh: "new", setting: SETTING, comparison: COMPARISON };
    for (const [events, version, against, reason] of [
      [[...held, event("task.state", { version: "v1", state: "released" })], "v1", sides, /v1 is released/],
      [[...held, event("task.state", { version: "v1", state: "refused" })], "v1", sides, /v1 is refused/],
      [[event("task.proposed", { version: "v2" })], "v2", sides, /v2 has not passed its gate/],
      [held, "v9", sides, /v9 is not proposed/],
      [held, "v1", { ...sides, fresh: "old" }, /both sides are old/],
    ] as const) {
      expect(() => pairsOf(events, [version], against, 1)).toThrow(reason);
    }
  });

  const cond = (harness: string) => {
    const condition = conditionOf("v0", harness);
    return { id: conditionId(condition), condition: requireJsonValue(condition) };
  };

  it("isolates referee.pair votes to the read comparison and drops malformed vote events", () => {
    const [oldC, newC] = [cond("old"), cond("new")];
    const events: LogEvent[] = [
      event("task.proposed", { version: "v0" }),
      event("task.gate", { version: "v0", gate: 1, outcome: "passed" }),
      event("condition.recorded", oldC),
      event("condition.recorded", newC),
      event("solve.started", { solve: "2", condition: oldC.id, comparison: COMPARISON }),
      event("solve.finished", { solve: "2", ending: { outcome: "pass" } }),
      event("solve.started", { solve: "1", condition: newC.id, comparison: COMPARISON }),
      event("solve.finished", { solve: "1", ending: { outcome: "pass" } }),
      event("referee.pair", { comparison: "c-0", solve: "1", old: "2", judge: 1, holistic: 1 }),
      event("referee.pair", { comparison: COMPARISON, solve: 1, old: "2", judge: 1, holistic: 1 }),
      event("referee.pair", { comparison: COMPARISON, solve: "1", old: 2, judge: 1, holistic: 1 }),
      event("referee.pair", { comparison: COMPARISON, solve: "1", old: "2", judge: "x", holistic: 1 }),
      event("referee.pair", { comparison: COMPARISON, solve: "1", old: "2", judge: 1, holistic: "y" }),
    ];
    const sides = {
      old: "old",
      fresh: "new",
      setting: SETTING,
      comparison: COMPARISON,
      judge: { code: 1, judge: 1 },
    };
    expect(pairsOf(events, ["v0"], sides, 1).pairs[0]?.judged?.votes).toEqual([]);
    const withOwn = [
      ...events,
      event("referee.pair", { comparison: COMPARISON, solve: "1", old: "2", judge: 0.5, holistic: -0.5 }),
    ];
    expect(pairsOf(withOwn, ["v0"], sides, 1).pairs[0]?.judged?.votes).toEqual([
      { fresh: 0, old: 0, judge: 0.5, holistic: -0.5 },
    ]);
  });

  it("reads pairsReported over noise, sides and solves 2..4 against an explicit table, and drops malformed reports", () => {
    const [oldC, newC] = [cond("old"), cond("new")];
    const passSolves = (harness: string, cid: string, count: number) =>
      Array.from({ length: count }, (_, at) => [
        event("solve.started", { solve: `${harness}-${String(at)}`, condition: cid, comparison: COMPARISON }),
        event("solve.finished", { solve: `${harness}-${String(at)}`, ending: { outcome: "pass" } }),
      ]).flat();
    const expected: readonly {
      readonly noise: boolean;
      readonly solves: number;
      readonly sides: "both" | "old" | "fresh";
      readonly outcome: { readonly len: number; readonly old: string; readonly fresh: string } | null;
    }[] = [
      { noise: false, solves: 2, sides: "both", outcome: { len: 2, old: "old-", fresh: "new-" } },
      { noise: false, solves: 2, sides: "old", outcome: { len: 1, old: "old-", fresh: "old-" } },
      { noise: false, solves: 2, sides: "fresh", outcome: { len: 1, old: "new-", fresh: "new-" } },
      { noise: false, solves: 3, sides: "both", outcome: { len: 3, old: "old-", fresh: "new-" } },
      { noise: false, solves: 3, sides: "old", outcome: null },
      { noise: false, solves: 3, sides: "fresh", outcome: null },
      { noise: false, solves: 4, sides: "both", outcome: { len: 4, old: "old-", fresh: "new-" } },
      { noise: false, solves: 4, sides: "old", outcome: { len: 2, old: "old-", fresh: "old-" } },
      { noise: false, solves: 4, sides: "fresh", outcome: { len: 2, old: "new-", fresh: "new-" } },
      { noise: true, solves: 2, sides: "both", outcome: { len: 2, old: "old-", fresh: "old-" } },
      { noise: true, solves: 2, sides: "old", outcome: { len: 2, old: "old-", fresh: "old-" } },
      { noise: true, solves: 2, sides: "fresh", outcome: null },
      { noise: true, solves: 3, sides: "both", outcome: { len: 3, old: "old-", fresh: "old-" } },
      { noise: true, solves: 3, sides: "old", outcome: { len: 3, old: "old-", fresh: "old-" } },
      { noise: true, solves: 3, sides: "fresh", outcome: null },
      { noise: true, solves: 4, sides: "both", outcome: { len: 4, old: "old-", fresh: "old-" } },
      { noise: true, solves: 4, sides: "old", outcome: { len: 4, old: "old-", fresh: "old-" } },
      { noise: true, solves: 4, sides: "fresh", outcome: null },
    ];
    const logFor = (noise: boolean, solves: number): LogEvent[] => [
      event("task.proposed", { version: "v0" }),
      event("task.gate", { version: "v0", gate: 1, outcome: "passed" }),
      event("condition.recorded", oldC),
      event("condition.recorded", newC),
      event("comparison.started", {
        session: COMPARISON,
        ...keysIf(noise, () => ({ noise: true })),
      }),
      ...(noise
        ? passSolves("old", oldC.id, solves * 2)
        : [...passSolves("old", oldC.id, solves), ...passSolves("new", newC.id, solves)]),
      event("comparison.reported", {
        session: COMPARISON,
        old: "old",
        fresh: noise ? "old" : "new",
        setting: SETTING,
        solves,
        versions: ["v0"],
        scored: { wins: 0, losses: 0, ties: 1 },
      }),
    ];
    for (const row of expected) {
      const events = logFor(row.noise, row.solves);
      const [report] = lastReports(events);
      if (report === undefined) throw new Error("expected report");
      const pairs = pairsReported(events, report, row.sides);
      if (row.outcome === null) {
        expect(pairs).toEqual([]);
        continue;
      }
      expect(pairs).toHaveLength(1);
      expect(pairs[0]?.old).toHaveLength(row.outcome.len);
      expect(pairs[0]?.fresh).toHaveLength(row.outcome.len);
      expect(pairs[0]?.solves?.old.every((id) => id.startsWith(row.outcome?.old ?? ""))).toBe(true);
      expect(pairs[0]?.solves?.fresh.every((id) => id.startsWith(row.outcome?.fresh ?? ""))).toBe(true);
    }

    const validLog = logFor(false, 2);
    const [validReport] = lastReports(validLog);
    if (validReport === undefined) throw new Error("expected report");
    expect(pairsReported(validLog, validReport)).toHaveLength(1);
    for (const bad of [
      { ...validReport.data, scored: null },
      { ...validReport.data, old: 1 },
      { ...validReport.data, fresh: 1 },
      { ...validReport.data, setting: 1 },
      { ...validReport.data, solves: "2" },
    ]) {
      expect(pairsReported(validLog, { ...validReport, data: bad })).toEqual([]);
    }
  });
});

describe("report folds over ladder reports, checkpoints, references and release order", () => {
  it("filters ladder reports from current reads, keeps interrupted checkpoints, and falls back to the first old harness", () => {
    const log: LogEvent[] = [
      event("comparison.reported", { session: "g-1", old: "h-first", fresh: "h-1" }),
      event("comparison.reported", { session: "l-1", old: "h-lad", fresh: "h-2", ladder: true }),
      event("comparison.reported", { session: "g-2", old: "h-second", fresh: "h-3" }),
      event("comparison.reported", { old: "h-anon", fresh: "h-4" }),
    ];
    expect(lastReports(log).map(({ session }) => session)).toEqual(["g-1", "g-2"]);
    expect(lastReports(log, "all").map(({ session }) => session)).toEqual(["g-1", "l-1", "g-2"]);
    expect(referenceOf(log)).toBe("h-first");

    const crashed: LogEvent[] = [
      event("build.finished", { session: "b-0", harness: "h-0", changed: true, ended: "finished" }),
      event("build.checkpoint", { session: "b-1", harness: "h-chk" }),
      event("build.finished", { session: "b-1", harness: "h-0", changed: false, ended: "crashed" }),
    ];
    expect(latestBuilt(crashed)).toBe("h-chk");
  });

  it("orders unanswered tasks by first reading, floors failed-task holdback, caps draws, and leaves untouched tasks out of outcomes", () => {
    let seq = 0;
    const held = (version: string) => [
      event("task.proposed", { version }),
      event("task.gate", { version, gate: 1, outcome: "passed" }),
    ];
    const run = (session: string, task: string, harness: string, outcome: "pass" | "fail") => {
      const condition = conditionOf(task, harness);
      const cid = conditionId(condition);
      const solve = `rs-${String(++seq)}`;
      return [
        event("condition.recorded", { id: cid, condition: requireJsonValue(condition) }),
        event("solve.started", { solve, condition: cid, comparison: session }),
        event("solve.finished", {
          solve,
          ending: outcome === "pass" ? { outcome: "pass" } : { outcome: "fail", kind: "rejected" },
        }),
        ...(outcome === "fail" ? [event("referee.finding", { solve, ruling: "solver-fail" })] : []),
      ];
    };
    const report = (session: string, versions: string[]) =>
      event("comparison.reported", {
        session,
        old: "old",
        fresh: "new",
        starter: "old",
        setting: SETTING,
        solves: 1,
        versions,
        scored: { wins: 0, losses: 0, ties: versions.length },
      });

    const unansweredLog: LogEvent[] = [
      ...["t1", "t2", "untouched"].flatMap(held),
      event("task.state", { version: "untouched", state: "held" }),
      ...run("g-1", "t1", "old", "fail"),
      ...run("g-1", "t1", "new", "fail"),
      report("g-1", ["t1"]),
      ...run("g-2", "t2", "old", "fail"),
      ...run("g-2", "t2", "new", "fail"),
      report("g-2", ["t2"]),
      ...run("g-3", "t2", "old", "fail"),
      ...run("g-3", "t2", "new", "fail"),
      ...run("g-3", "t1", "old", "fail"),
      ...run("g-3", "t1", "new", "fail"),
      report("g-3", ["t2", "t1"]),
    ];
    expect(releaseOrder(unansweredLog, ["t1", "t2"], 2, "seed").map(([v]) => v)).toEqual(["t1", "t2"]);
    expect(releaseOrder(unansweredLog, ["t1", "t2"], 1, "seed").map(([v]) => v)).toEqual(["t1"]);
    expect(releaseOrder(unansweredLog, ["t1", "t2"], 0, "seed")).toEqual([]);
    expect(poolOf(unansweredLog).outcomes.has("untouched")).toBe(false);

    const failedLog: LogEvent[] = [
      ...["f1", "f2", "f3", "p1", "p2"].flatMap(held),
      ...run("g-1", "f1", "old", "fail"),
      ...run("g-1", "f1", "new", "pass"),
      ...run("g-1", "f2", "old", "fail"),
      ...run("g-1", "f2", "new", "pass"),
      ...run("g-1", "f3", "old", "fail"),
      ...run("g-1", "f3", "new", "pass"),
      ...run("g-1", "p1", "old", "pass"),
      ...run("g-1", "p1", "new", "pass"),
      ...run("g-1", "p2", "old", "pass"),
      ...run("g-1", "p2", "new", "pass"),
      report("g-1", ["f1", "f2", "f3", "p1", "p2"]),
    ];
    expect(releaseOrder(failedLog, ["f1", "f2", "f3", "p1", "p2"], 1, "seed").map(([v]) => v)).toEqual([
      "f1",
    ]);
    const all = releaseOrder(failedLog, ["f1", "f2", "f3", "p1", "p2"], 5, "seed").map(([v]) => v);
    expect(all).toHaveLength(3);
    expect(all[0]).toBe("f1");
    expect(all).not.toContain("f2");
    expect(all).not.toContain("f3");
  });
});

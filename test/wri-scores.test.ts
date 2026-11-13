// What a comparison's reading rests on: the recount against the record by task, the tallies by
// measure, the tasks won on every pairing, and for a step its removals and writers. Every task,
// score and harness here is invented.
import { describe, expect, it } from "bun:test";
import type { Paired } from "#src/kernel/compare.ts";
import { conditionId, settingId } from "#src/kernel/condition.ts";
import type { EventKind, LogEvent } from "#src/kernel/log.ts";
import type { JsonObject } from "#src/meta/json-shape.ts";
import { requireJsonValue } from "#src/meta/stable-json.ts";
import { beatsAll, recountOf, scoreRows } from "#tools/wri/scores.ts";
import { conditionOf } from "./helpers/logged-round.ts";

// Each task's objective a side (null for a failed solve) and the score its report recorded. v-1 to v-8:
// the new side valid, the reference not, v-1 recorded otherwise than it recounts. v-9: both valid,
// 0.5% apart, under the gap floor. v-10: both valid, the new answer better by a sixth.
const SOLVED = [
  ...Array.from({ length: 8 }, (_, at) => ({
    task: `v-${String(at + 1)}`,
    fresh: 5,
    old: null,
    recorded: at === 0 ? 500 : 600,
  })),
  { task: "v-9", fresh: 10.05, old: 10, recorded: 0 },
  { task: "v-10", fresh: 12, old: 10, recorded: 50 },
];

let clock = 0;
const event = (kind: EventKind, data: JsonObject): LogEvent => {
  clock += 1;
  return { at: new Date(Date.UTC(2026, 10, 7) + clock * 1000).toISOString(), kind, data };
};

const proposed = (version: string, session: string) => [
  event("task.proposed", {
    version,
    taskId: version,
    session,
    task: { taskId: version, family: "fam", publicInput: {}, hidden: null },
  }),
  event("task.gate", { version, gate: 1, outcome: "passed" }),
];

/** One comparison solve, valid with `objective` or failed where it is null. */
function solved(
  solve: string,
  harness: string,
  task: string,
  objective: number | null,
  comparison = "g-1",
): LogEvent[] {
  const condition = conditionOf(task, harness);
  const id = conditionId(condition);
  return [
    event("condition.recorded", { id, condition: requireJsonValue(condition) }),
    event("solve.started", { solve, condition: id, task, comparison }),
    event("solve.finished", {
      solve,
      ending: objective === null ? { outcome: "fail", kind: "limit" } : { outcome: "pass" },
    }),
    ...(objective === null ? [] : [event("verdict", { solve, task, kind: "pass", answer: {}, objective })]),
  ];
}

const tasks = SOLVED.map(({ task }) => task);
const events: LogEvent[] = [
  ...tasks.flatMap((task, at) => proposed(task, at < 5 ? "x-1" : "x-2")),
  ...SOLVED.flatMap(({ task, fresh, old }) => [
    ...solved(`n-${task}`, "h-new", task, fresh),
    ...solved(`o-${task}`, "h-old", task, old),
  ]),
  event("comparison.reported", {
    session: "g-1",
    old: "h-old",
    fresh: "h-new",
    setting: settingId(conditionOf("any", "any")),
    solves: 1,
    level: 0.02,
    objective: { direction: "higher" },
    reading: "step",
    versions: tasks,
    scored: { wins: 9, losses: 0, ties: 1 },
    // Recorded in the reverse order of `versions`, so pairing by position would mismatch every task.
    frontier: {
      differences: SOLVED.map(({ recorded }) => recorded).toReversed(),
      of: tasks.toReversed(),
    },
  }),
  event("comparison.started", { session: "g-2" }),
  ...solved("n-open", "h-new", "v-1", 5, "g-2").slice(0, 2),
  event("comparison.started", { session: "g-3" }),
  event("comparison.reported", {
    session: "g-3",
    old: "h-old",
    fresh: "h-new",
    scored: null,
    reading: "not-scored",
  }),
];

const rows = scoreRows(events);
const block = (session: string) => {
  const from = rows.findIndex((line) => line.startsWith(`${session}:`));
  const to = rows.findIndex((line, at) => at > from && /^g-\d+:/u.test(line));
  return rows.slice(from, to === -1 ? undefined : to);
};
const lineOf = (session: string, start: string) =>
  block(session).find((line) => line.trimStart().startsWith(start)) ?? "";

describe("recount", () => {
  it("matches the record to the recount by task, so only the one score that differs is counted", () => {
    expect(lineOf("g-1", "recount:")).toContain(
      "recount: 1 of 10 tasks matched by task (0 unmatched) score otherwise",
    );
  });

  it("counts an unnamed or unknown task as unmatched instead of pairing it by position", () => {
    const pair: Paired = { task: "v-1", old: [false], fresh: [true] };
    const found = recountOf({ frontier: { differences: [600, 600], of: ["v-1", "v-x"] } }, [pair]);
    expect(found.unmatched).toBe(1);
    expect(found.differing).toBe(0);
  });
});

describe("tallies by measure", () => {
  it("counts the objective only between two valid answers, and validity only where one of the two was valid", () => {
    expect(lineOf("g-1", "validity alone")).toContain("8-0-2");
    expect(lineOf("g-1", "objective alone")).toContain("1-0-9");
  });

  it("counts a task won on every pairing only where each pairing beat the reference by the gap floor", () => {
    expect(lineOf("g-1", "every new solve")).toContain("9 of 10 tasks");
    const close = { direction: "higher" as const, fresh: [10.05], old: [10] };
    expect(beatsAll({ task: "t", old: [true], fresh: [true], objective: close })).toBe(false);
    expect(beatsAll({ task: "t", old: [false, true], fresh: [true, true] })).toBe(false);
  });
});

describe("a step", () => {
  it("removes the largest wins first and names the count that loses the step", () => {
    expect(lineOf("g-1", "wins to spare")).toContain("(spareOf): 3; the step is lost once the 4 largest");
    expect(lineOf("g-1", "without each win")).toContain("0 of 9 single removals lose the step");
  });

  it("tallies the scores by the Examiner session that wrote each task", () => {
    expect(lineOf("g-1", "by writer")).toBe("  by writer: x-1 5-0-0 p 0.031; x-2 4-0-1 p 0.063");
  });

  it("reads the step again on the first tallied task of each family, which ten siblings make one", () => {
    expect(lineOf("g-1", "on one task a family")).toBe(
      "  on one task a family: 1-0-0 p 0.500, no step at the level",
    );
  });
});

describe("a comparison with no recorded scores", () => {
  it("says the report is absent for one begun and never reported, and recounts nothing", () => {
    expect(block("g-2")[0]).toContain("report absent");
    expect(block("g-2").join("\n")).not.toContain("recount:");
    expect(lineOf("g-2", "solves begun")).toBe("  solves begun 1, ended 0");
  });

  it("prints no recount beside a report that scored nothing", () => {
    expect(block("g-3").join("\n")).toContain("no task scores recorded, so no recount");
    expect(block("g-3").join("\n")).not.toContain("recount:");
  });
});

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

describe("the tally by practice", () => {
  const sibling = [...proposed("p-1", "x-1"), event("task.state", { version: "p-1", state: "released" })];
  const reportAt = events.findIndex(
    ({ kind, data }) => kind === "comparison.reported" && data.session === "g-1",
  );
  const said = (log: readonly LogEvent[]) =>
    scoreRows(log).find((line) => line.trimStart().startsWith("by practice")) ?? "";

  it("puts every score on the practised side once a task of the family was practice before the report", () => {
    expect(said([...sibling, ...events])).toBe(
      "  by practice: a task of the family was practice before the start 9-0-1 p 0.002; none was 0-0-0 p 1.000",
    );
  });

  it("counts no sibling released after the report, nor one released after a recorded start", () => {
    const none =
      "  by practice: a task of the family was practice before the start 0-0-0 p 1.000; none was 9-0-1 p 0.002";
    expect(said(events)).toBe(none);
    expect(said([...events.slice(0, reportAt + 1), ...sibling, ...events.slice(reportAt + 1)])).toBe(none);
    const started = event("comparison.started", { session: "g-1" });
    expect(said([started, ...sibling, ...events])).toBe(none);
  });
});

describe("the tasks a comparison is the first to test", () => {
  // g-4 tests v-10, which g-1 tested, and two tasks no comparison has: a sum of the `by practice`
  // lines over g-1 and g-4 counts v-10 twice, and a sum of these lines counts each task once.
  const again = [
    { task: "v-10", recorded: 50 },
    { task: "w-1", recorded: 600 },
    { task: "w-2", recorded: 600 },
  ];
  const later = [
    ...events,
    ...["w-1", "w-2"].flatMap((task) => proposed(task, "x-3")),
    ...again.flatMap(({ task }) => [
      ...solved(`n4-${task}`, "h-new", task, task === "v-10" ? 12 : 5, "g-4"),
      ...solved(`o4-${task}`, "h-old", task, task === "v-10" ? 10 : null, "g-4"),
    ]),
    event("comparison.reported", {
      session: "g-4",
      old: "h-old",
      fresh: "h-new",
      setting: settingId(conditionOf("any", "any")),
      solves: 1,
      level: 0.02,
      objective: { direction: "higher" },
      reading: "no-step",
      versions: again.map(({ task }) => task),
      scored: { wins: 3, losses: 0, ties: 0 },
      frontier: { differences: again.map(({ recorded }) => recorded), of: again.map(({ task }) => task) },
    }),
  ];
  const first = (session: string) => {
    const all = scoreRows(later);
    const from = all.findIndex((line) => line.startsWith(`${session}:`));
    return all.slice(from).find((line) => line.trimStart().startsWith("first tested here")) ?? "";
  };

  it("leaves out of the second tally a task an earlier comparison tested", () => {
    expect(first("g-4")).toBe(
      "  first tested here, 2 of 3 tasks: a task of the family was practice before the start 0-0-0 p 1.000; none was 2-0-0 p 0.250",
    );
  });

  it("counts every task where no comparison reported before", () => {
    expect(first("g-1")).toContain("first tested here, 10 of 10 tasks:");
    expect(first("g-1")).toContain("none was 9-0-1 p 0.002");
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

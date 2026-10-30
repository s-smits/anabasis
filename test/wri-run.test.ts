// The triggers of lanes 7, 8, 20, 28, 32 and 33 read how a run was conducted: the moves against the table,
// the Builder's compactions, the drafted exam, the launches and the log's order. Each case sets a
// log that should fire beside the nearest one that should not.
import { describe, expect, it } from "bun:test";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { overview } from "../tools/wri/read.ts";
import type { Receipt } from "../tools/runs/receipt.ts";

const START = Date.parse("2026-10-27T08:00:00Z");
const event = (kind: EventKind, data: JsonObject, minute: number): LogEvent => ({
  at: new Date(START + minute * 60_000).toISOString(),
  kind,
  data,
});
const logged = (...each: [EventKind, JsonObject][]): LogEvent[] =>
  each.map(([kind, data], index) => event(kind, data, index));
const fired = (events: readonly LogEvent[], name: string, launches: readonly Receipt[] = []) =>
  overview(events, launches).triggers.find((trigger) => trigger.name === name)?.detail;
const receipt = (commit: string, dirty = false): Receipt => ({
  at: new Date(START).toISOString(),
  pid: 1,
  flags: [],
  envFile: null,
  commit,
  dirty,
  load: 1,
  cores: 8,
  bun: "1.4.4",
});

/** A log whose events stand at the minutes their rows give, from the fixed start. */
const timed = (rows: readonly (readonly [number, EventKind, JsonObject])[]): LogEvent[] =>
  rows.map(([minute, kind, data]) => event(kind, data, minute));
const hoursOf = (events: readonly LogEvent[]) =>
  overview(events).rows[0]?.lines.find((line) => line.startsWith("hours:")) ?? "";
describe("the moves against the table (lane 28)", () => {
  it("counts the moves the Builder asked for where the table named another, and only those", () => {
    const moves = logged(
      ["campaign.move", { move: "compare", code: "asked", why: "" }],
      ["campaign.move", { move: "examine", code: "no-room", why: "" }],
      ["campaign.move", { move: "compare", code: "asked", why: "" }],
    );
    const detail = fired(moves, "MOVES ASKED");
    expect(detail).toContain("2 of 3 moves");
    expect(detail).toContain("compare 2");
    expect(fired(moves.slice(1, 2), "MOVES ASKED")).toBeUndefined();
  });

  it("names an ending the log goes on after, and leaves the last event's ending alone", () => {
    const ended = logged(
      ["campaign.ended", { ending: "budget" }],
      ["campaign.move", { move: "build", code: "led" }],
    );
    const detail = fired(ended, "ENDED AND WENT ON");
    expect(detail).toBe("budget at event 0");
    expect(fired(ended.slice(0, 1), "ENDED AND WENT ON")).toBeUndefined();
  });
});

describe("the Builder's conversation (lane 20)", () => {
  it("gives a session's compactions beside its turns and its read_opening calls", () => {
    const compacted = logged(
      ["build.started", { session: "b-1", parent: "starter" }],
      ["build.turn", { session: "b-1" }],
      ["build.turn", { session: "b-1" }],
      ["build.compacted", { session: "b-1", tokensBefore: 290_000, error: null }],
    );
    const detail = fired(compacted, "BUILDER COMPACTED");
    expect(detail).toBe("b-1: 1 compaction in 2 turns, read_opening 0");
    expect(fired(compacted.slice(0, 3), "BUILDER COMPACTED")).toBeUndefined();
  });
});

describe("the drafted exam (lane 8)", () => {
  it("gives the drafts and how each drafting session ended, and nothing for a stored pack", () => {
    const drafted = logged(
      ["exam.drafted", { session: "d-1", draft: {} }],
      [
        "draft.finished",
        { session: "d-1", ended: "stands", tries: 2, measurement: { status: "interrupted" } },
      ],
    );
    const detail = fired(drafted, "EXAM DRAFTED");
    expect(detail).toContain("1 draft recorded");
    expect(detail).toContain("d-1 stands after 2 attempts");
    expect(detail).toContain("measurement interrupted");
    expect(fired(drafted.slice(1), "EXAM DRAFTED")).toBeUndefined();
  });
});

describe("the launches (lane 32)", () => {
  const opened = logged(["campaign.opened", { project: "p" }]);

  it("fires on a second commit or a dirty tree, and stays quiet on one clean launch", () => {
    const detail = fired(opened, "LAUNCHES", [receipt("aaaaaaaa11"), receipt("bbbbbbbb22")]);
    expect(detail).toContain("2 launches at 2 commits (aaaaaaaa, bbbbbbbb)");
    expect(detail).toContain("0 from a dirty tree");
    expect(detail).toContain("under 1 login and 1 Bun version");
    expect(fired(opened, "LAUNCHES", [receipt("aaaaaaaa11", true)])).toContain("1 from a dirty tree");
    expect(fired(opened, "LAUNCHES", [receipt("aaaaaaaa11")])).toBeUndefined();
  });
});

describe("the log's order (lane 33)", () => {
  it("names a clock that runs backwards, a finish with no start and a comparison started twice", () => {
    const disordered = [
      event("solve.finished", { solve: "s1" }, 5),
      event("comparison.started", { session: "g1" }, 4),
      event("comparison.started", { session: "g1" }, 6),
    ];
    const detail = fired(disordered, "LOG OUT OF ORDER");
    expect(detail).toContain("1 event stamped before the one above it");
    expect(detail).toContain("1 solve finished with no start");
    expect(detail).toContain("comparison started twice: g1");
    const ordered = logged(
      ["solve.started", { solve: "s1" }],
      ["solve.finished", { solve: "s1" }],
      ["comparison.started", { session: "g1" }],
    );
    expect(fired(ordered, "LOG OUT OF ORDER")).toBeUndefined();
  });
});

describe("the refused rulings (lane 7)", () => {
  it("counts the refusals by the ruling asked for", () => {
    const refused = logged(
      ["referee.refused", { solve: "s1", asked: { ruling: "earned" } }],
      ["referee.refused", { solve: "s2", asked: { ruling: "check-defect" } }],
    );
    expect(fired(refused, "RULINGS REFUSED")).toBe("check-defect 1, earned 1");
    expect(fired([], "RULINGS REFUSED")).toBeUndefined();
  });
});

describe("the reader of the campaign's clock", () => {
  it("puts the hours by role beside the dollars, a cut session to its stop and a session beside a comparison once", () => {
    const log = timed([
      [0, "build.started", { session: "b-1", parent: "hp", tasks: [] }],
      // A stop cut b-1, and the campaign resumed half an hour later.
      [60, "campaign.ended", {}],
      [90, "build.started", { session: "b-2", parent: "hp", tasks: [] }],
      [150, "build.finished", { session: "b-2", ended: "finished", harness: "hc" }],
      [150, "comparison.started", { session: "g-1", old: "hp", fresh: "hc", tasks: [] }],
      [160, "exam.started", { session: "x-1" }],
      [190, "exam.finished", { session: "x-1", ended: "finished" }],
      [210, "comparison.reported", { session: "g-1", old: "hp", fresh: "hc", reading: "no-step" }],
    ]);
    const line = hoursOf(log);
    expect(line).toContain("builder 2.0 (57%)");
    expect(line).toContain("comparisons 1.0 (29%)");
    expect(line).toContain("examiner 0.5 (14%)");
    expect(line).toContain("between moves 0.5 (14%), of 3.5");
  });

  it("keeps a long provider wait beside the Builder's overlapping elapsed span", () => {
    const log = timed([
      [0, "build.started", { session: "b-1" }],
      // `ms` includes the grace minute, which `until` leaves out.
      [
        60,
        "campaign.waited",
        {
          for: "provider",
          ms: 35 * 3_600_000,
          until: new Date(START + (36 * 60 - 1) * 60_000).toISOString(),
        },
      ],
      [37 * 60, "build.finished", { session: "b-1", billed: 3 }],
    ]);
    const read = overview(log);
    const line = read.rows[0]?.lines.find((each) => each.startsWith("hours:")) ?? "";
    expect(line).toContain("builder 37.0 (100%)");
    expect(line).toContain("of 37.0");
    expect(line).toContain("recorded waits 35.0 h (provider 35.0)");
    expect(read.rows[0]?.lines).toContain("billed dollars: builder 3.00");
  });

  it("merges concurrent provider windows while retaining Examiner and comparison spans", () => {
    const log = timed([
      [0, "build.started", { session: "b-1" }],
      [60, "campaign.waited", { for: "provider", ms: 35 * 3_600_000 }],
      [120, "campaign.waited", { for: "provider", ms: 34 * 3_600_000 }],
      [180, "exam.started", { session: "x-1" }],
      [240, "exam.finished", { session: "x-1", billed: 2 }],
      [300, "comparison.started", { session: "g-1", old: "hp", fresh: "hc", tasks: [] }],
      [420, "comparison.reported", { session: "g-1", old: "hp", fresh: "hc", reading: "no-step" }],
      [37 * 60, "build.finished", { session: "b-1", billed: 3 }],
    ]);
    const line = hoursOf(log);
    expect(line).toContain("examiner 1.0 (3%)");
    expect(line).toContain("comparisons 2.0 (5%)");
    expect(line).toContain("between moves 0.0 (0%), of 37.0");
    // Both waits end at the Examiner's start at 3 h: merged 1 h to 3 h, where apart they would sum to 3.0.
    expect(line).toContain("recorded waits 2.0 h (provider 2.0)");
  });

  it("ends a draft that a later draft started over, instead of counting it to the log's end", () => {
    // truss v4 on 27 October: d-1 cut at a minute and a half, relaunched as d-2.
    const line = hoursOf(
      timed([
        [0, "draft.started", { session: "d-1" }],
        [2, "draft.started", { session: "d-2" }],
        [62, "draft.finished", { session: "d-2", billed: 1 }],
        [62, "build.started", { session: "b-1" }],
        [10 * 60, "build.finished", { session: "b-1", billed: 3 }],
      ]),
    );
    expect(line).toContain("examiner 1.0 (10%)");
    expect(line).toContain("builder 9.0 (90%)");
  });

  it("takes every recorded wait into one union, load waits back from their admission, and the hours a promotion with and without it", () => {
    const line = hoursOf(
      timed([
        [0, "build.started", { session: "b-1" }],
        [60, "campaign.waited", { for: "provider", ms: 2 * 3_600_000 }],
        // A load wait is recorded when the host admits the solve: this one began an hour into the
        // provider's window above, and the next overlaps it by an hour.
        [240, "campaign.waited", { load: 13, cores: 12, ms: 2 * 3_600_000 }],
        [300, "campaign.waited", { load: 13, cores: 12, ms: 2 * 3_600_000 }],
        [300, "harness.promoted", { harness: "hc" }],
        [480, "harness.promoted", { harness: "hd" }],
        // A kind nothing writes is no wait.
        [500, "campaign.waited", { for: "reserve", ms: 3_600_000 }],
        [600, "build.turn", { session: "b-1" }],
      ]),
    );
    expect(line).toContain("recorded waits 4.0 h (provider 2.0, load 3.0)");
    expect(line).toContain("5.0 h a promotion, 3.0 h outside recorded waits");
  });
});

describe("the reader of campaign spend", () => {
  it("counts a drafting session's dollars and its example solves as the Examiner's, as the host's budget does", () => {
    const log = timed([
      [0, "draft.started", { session: "d-1" }],
      [4, "solve.started", { solve: "e1", comparison: "d-1" }],
      [6, "solve.finished", { solve: "e1", ending: { outcome: "pass" }, billed: 1 }],
      [10, "draft.finished", { session: "d-1", ended: "finished", billed: 3 }],
      [20, "exam.started", { session: "x-1" }],
      [30, "exam.finished", { session: "x-1", ended: "finished", billed: 1 }],
      [40, "referee.finding", { solve: "p1", ruling: "earned", billed: 1 }],
    ]);
    const { rows, triggers } = overview(log);
    const dollars = rows[0]?.lines.find((line) => line.startsWith("billed dollars:"));
    expect(dollars).toContain("examiner 5.00");
    expect(dollars).toContain("referee 1.00");
    expect(triggers.filter((trigger) => trigger.name === "SPEND LED BY A ROLE")).toEqual([
      { lane: 31, name: "SPEND LED BY A ROLE", detail: "examiner: 83.3% of billed dollars" },
    ]);
  });

  it("counts the solves an Examiner session asked for as the Examiner's, and says its cost a task held out", () => {
    // `try_task`: about seven reference solves an admitted task at three a draft (the overhaul plan,
    // 4b), which until 12 October read as the solver's.
    const log = timed([
      [0, "exam.started", { session: "x-1" }],
      [1, "solve.started", { solve: "t1", comparison: "x-1", limits: { wallSeconds: 900 } }],
      [2, "solve.finished", { solve: "t1", ending: { outcome: "pass" }, billed: 2 }],
      [3, "task.proposed", { session: "x-1", version: "e1", taskId: "x-1-001" }],
      [3, "task.gate", { version: "e1", gate: 1, outcome: "passed" }],
      [4, "task.proposed", { session: "x-1", version: "e2", taskId: "x-1-002" }],
      [4, "task.gate", { version: "e2", gate: 1, outcome: "refused" }],
      [5, "exam.finished", { session: "x-1", ended: "finished", billed: 1, held: ["e1"], refused: ["e2"] }],
      [6, "solve.started", { solve: "s1", comparison: "g-1", limits: { wallSeconds: 900 } }],
      [7, "solve.finished", { solve: "s1", ending: { outcome: "pass" }, billed: 1.5 }],
    ]);
    for (const [events, dollars] of [
      [log, 3],
      [log.filter(({ kind }) => kind !== "exam.finished"), 2],
    ] as const) {
      const line = overview(events).rows[0]?.lines.find((each) => each.startsWith("billed dollars:"));
      expect(line).toContain(`examiner ${dollars.toFixed(2)}`);
      expect(line).toContain("solver 1.50");
      expect(line).toContain(`the Examiner's ${dollars.toFixed(2)} over 1 task`);
      expect(line).toContain(`${dollars.toFixed(2)} a task`);
    }
  });

  it("shows backend coverage and residual on matching closed work, with partial and unknown costs", () => {
    const accountEvents = logged(
      ["campaign.opened", { budget: { dollars: 800, reserve: 10 } }],
      ["solve.finished", { solve: "s", billed: 93.9648096, reportedCost: 136.81746535 }],
      ["build.started", { session: "b-open" }],
      ["build.turn", { session: "b-open", usage: { cost: { total: 2 } } }],
      ["exam.finished", { session: "x", billed: 4, reportedCost: null }],
    );
    const line = overview(accountEvents)
      .rows.flatMap((row) => row.lines)
      .find((each) => each.startsWith("campaign:"));
    // Calculated 99.96 of 800 in all; the backend's total stands beside the one ending that has it.
    expect(line).toContain("calculated spend 99.96 of 800 dollars");
    expect(line).toContain("backend $136.82 on 1 of 2 ending records");
    expect(line).toContain("calculated $93.96 on the same (+45.6%)");
  });
});

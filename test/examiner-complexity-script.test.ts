// The examiner-complexity readers: one line an Examiner session under the reference in force, a
// campaign's hours to its first comparison and promotion, every draft an Examiner wrote beside what
// the gate measured on it, blind grades against outcomes with non-results counted nowhere, and the
// ladder's rungs re-rated blind against their stated grades.
import { describe, expect, it } from "bun:test";
import { campaignLine, sessionLines } from "#skills/examiner-complexity/scripts/ambition.ts";
import { csvLines, draftRows } from "#skills/examiner-complexity/scripts/exams.ts";
import { gradeLines, outcomesOf } from "#skills/examiner-complexity/scripts/grades.ts";
import { compareLines, packetOf } from "#skills/examiner-complexity/scripts/rungs.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";

const event = (minutes: number, kind: EventKind, data: JsonObject): LogEvent => ({
  at: new Date(Date.UTC(2026, 9, 31, 0, minutes)).toISOString(),
  kind,
  data,
});

const gate = (minutes: number, outcome: string, valid: number) =>
  event(minutes, "task.gate", { outcome, reference: { solves: 3, valid } });

describe("ambition", () => {
  const log = [
    event(0, "campaign.opened", {}),
    event(1, "draft.started", { session: "d-1" }),
    event(2, "exam.started", { session: "x-1" }),
    gate(3, "refused", 3),
    gate(4, "passed", 1),
    event(30, "comparison.started", { session: "g-1" }),
    event(90, "harness.promoted", { harness: "abcdef0123456789" }),
    event(91, "exam.started", { session: "x-2" }),
    gate(92, "passed", 0),
  ];

  it("reads each session alone, under the reference in force when it opened", () => {
    const [draft, first, second] = sessionLines(log);
    expect(draft).toContain("d-1 · reference starter · held 0 of 0");
    expect(first).toContain("x-1 · reference starter · held 1 of 2 (every 1, some 1)");
    expect(second).toContain("x-2 · reference abcdef01 · held 1 of 1");
  });

  it("gives the hours to the first comparison and promotion, or says none yet", () => {
    expect(campaignLine(log)).toBe(
      "first comparison 0.5 h / 0 solves / $0, first promotion 1.5 h / 0 solves / $0; 1 compared, 1 promoted",
    );
    expect(campaignLine(log.slice(0, 5))).toContain("first comparison none yet, first promotion none yet");
  });
});

describe("exams", () => {
  const draft = (version: string, session: string, family: string, input: JsonObject) =>
    event(1, "task.proposed", {
      version,
      taskId: version,
      session,
      task: { taskId: version, family, publicInput: input },
    });
  const gated = (version: string, outcome: string, valid: number, solves: number, proved: boolean) =>
    event(2, "task.gate", { version, gate: 1, outcome, reference: { valid, solves }, proved });
  const parts = (count: number) => ({
    title: "A board",
    devices: Array.from({ length: count }, (_, at) => ({ id: at })),
  });
  const log = [
    event(0, "exam.started", { session: "x-1" }),
    draft("v1", "x-1", "leds", parts(3)),
    gated("v1", "refused", 3, 3, true),
    draft("v2", "x-1", "leds", parts(5)),
    gated("v2", "passed", 3, 3, true),
    draft("v3", "x-1", "pins", { cases: [1, 2] }),
    gated("v3", "refused", 0, 3, false),
    event(3, "harness.promoted", { harness: "abcdef0123456789" }),
    event(4, "exam.started", { session: "x-2" }),
    draft("v4", "x-2", "leds", parts(9)),
    gated("v4", "passed", 2, 3, true),
  ];

  it("groups a session's drafts by family and counts the gate's reading of each group", () => {
    expect(draftRows(log, "grouped")).toEqual([
      {
        session: "x-1",
        reference: "starter",
        family: "leds",
        drafts: 2,
        held: 1,
        refused: 1,
        noroom: 1,
        none: 0,
        proved: 2,
        chars: 76,
        title: "A board",
      },
      {
        session: "x-1",
        reference: "starter",
        family: "pins",
        drafts: 1,
        held: 0,
        refused: 1,
        noroom: 0,
        none: 1,
        proved: 0,
        chars: 15,
        title: "pins",
      },
      {
        session: "x-2",
        reference: "abcdef01",
        family: "leds",
        drafts: 1,
        held: 1,
        refused: 0,
        noroom: 0,
        none: 0,
        proved: 1,
        chars: 112,
        title: "A board",
      },
    ]);
  });

  it("gives a row a draft under every, so one session can be read close up", () => {
    const rows = draftRows(log, "every");
    expect(rows.map(({ family, drafts, chars }) => `${family} ${String(drafts)} ${String(chars)}`)).toEqual([
      "leds 1 58",
      "leds 1 76",
      "pins 1 15",
      "leds 1 112",
    ]);
  });

  it("quotes a title holding a comma and leaves the drafted exam's own examples out", () => {
    const examples = [
      ...log,
      event(5, "task.proposed", { version: "v5", taskId: "ex-001", task: {} }),
      gated("v5", "passed", 1, 3, false),
    ];
    expect(draftRows(examples, "grouped")).toHaveLength(3);
    const row = {
      session: "x-1",
      reference: "starter",
      family: "leds",
      drafts: 2,
      held: 1,
      refused: 1,
      noroom: 1,
      none: 0,
      proved: 2,
      chars: 76,
    };
    const lines = csvLines("a-run", [{ ...row, title: 'Two faders, one "mic"' }]);
    expect(lines[0]).toBe('a-run,x-1,starter,leds,2,1,1,1,0,2,76,"Two faders, one ""mic"""');
  });
});

describe("grades", () => {
  const solve = (id: string, task: string, ending: JsonObject, turns: number) => [
    event(0, "solve.started", { solve: id, task }),
    event(1, "solve.finished", { solve: id, ending, turns }),
  ];
  const log = [
    ...solve("a", "t-1", { outcome: "pass" }, 3),
    ...solve("b", "t-1", { outcome: "pass" }, 5),
    ...solve("c", "t-2", { outcome: "fail", kind: "rejected" }, 9),
    ...solve("d", "t-2", { outcome: "non-result", kind: "provider", reason: "x" }, 1),
  ];

  it("counts results by grade and leaves non-results out", () => {
    const lines = gradeLines(
      new Map([
        ["t-1", "2"],
        ["t-2", "5"],
        ["t-3", "6"],
      ]),
      outcomesOf([log]),
    );
    expect(lines).toEqual([
      "grade 2: 1 tasks, 2 of 2 solves valid, 1 tasks valid on every solve, median turns 3",
      "grade 5: 1 tasks, 0 of 1 solves valid, 0 tasks valid on every solve, median turns none",
    ]);
  });
});

describe("rungs", () => {
  it("hides each rung's grade from the grader and flags a rung graded below it", () => {
    const packet = packetOf();
    expect(packet).toContain("- 1.1: ");
    expect(packet).not.toMatch(/- \d\.\d: \d: /u);
    const lines = compareLines(
      new Map([
        ["1.1", [{ grade: 1, place: "none" }]],
        [
          "1.2",
          [
            { grade: 2, place: "model" },
            { grade: 1, place: "basin" },
          ],
        ],
      ]),
    );
    expect(lines).toContain("  1.1 stated 1, blind 1 none");
    expect(lines).toContain("  1.2 stated 3, blind 2 model, 1 basin  below, flat");
    expect(lines.at(-1)).toMatch(
      /^1 of 18 rungs at their stated grade, 1 below, 0 above, 1 not above the rung before, 16 not graded$/u,
    );
  });
});

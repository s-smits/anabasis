// A rejection's standing has one reader, `rulingsOf`: until 5 November a comparison's `rejections`
// skipped a finding with no ruling, which a killed or failed Referee leaves, and kept the earned
// ruling before it, while practice's `rejectionAside` read that rejection as unruled.
import { describe, expect, it } from "bun:test";
import { rejections, type Fixed } from "../src/campaign/comparison.ts";
import { conditionId, settingId } from "../src/kernel/condition.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import { labelsIn, rejectionAside, standsOf } from "../src/kernel/solves.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { conditionOf } from "./helpers/logged-round.ts";

const at = "2026-11-05T00:00:00.000Z";
const rejection = { id: "s-1", ending: { outcome: "fail", kind: "rejected" } satisfies JsonObject };
const condition = conditionOf("t-1", "old");
const fixed: Fixed = {
  id: "g-1",
  old: "old",
  fresh: "new",
  starter: "old",
  setting: settingId(condition),
  solves: 2,
  level: 0.02,
  tasks: ["t-1"],
  retained: [],
  objective: undefined,
};
const solved: LogEvent[] = [
  {
    at,
    kind: "condition.recorded",
    data: { id: conditionId(condition), condition: requireJsonValue(condition) },
  },
  { at, kind: "solve.started", data: { solve: "s-1", condition: conditionId(condition), comparison: "g-1" } },
  { at, kind: "solve.finished", data: { solve: "s-1", ending: rejection.ending } },
];
const finding = (ruling: string | null): LogEvent => ({
  at,
  kind: "referee.finding",
  data: { solve: "s-1", ruling },
});

describe("a rejection's standing", () => {
  it("is its last finding's ruling, and a finding with no ruling leaves it unruled", () => {
    const cases: [LogEvent[], string | null][] = [
      [[finding("earned")], "earned"],
      [[finding("earned"), finding(null)], null],
      [[finding("earned"), finding("unclear")], "unclear"],
      [[finding(null), finding("earned")], "earned"],
      [[finding(null)], null],
      [[], null],
    ];
    for (const [findings, ruling] of cases) {
      expect(rejectionAside(findings, rejection)).toBe(ruling !== "earned");
      expect(rejections([...solved, ...findings], fixed, new Map())).toEqual([
        { solve: "s-1", task: "t-1", ruling },
      ]);
    }
    expect(rejectionAside([], { id: "s-1", ending: { outcome: "fail", kind: "no-answer" } })).toBe(false);
  });
});

// Rule 8: a person's label stands over the Referee's ruling. Until 9 November practice's
// `rejectionAside` read the ruling alone, while the task table and the Examiner's view read the label.
describe("a labelled rejection's standing", () => {
  const settled = (session: string, labels: JsonObject): LogEvent => ({
    at,
    kind: "comparison.reported",
    data: { session, settled: { labels } },
  });
  it("is the label of its comparison's last report, over any ruling", () => {
    const cases: [LogEvent[], string | null][] = [
      [[finding("unclear"), settled("g-1", { "s-1": "earned" })], "earned"],
      [[finding("earned"), settled("g-1", { "s-1": "check-defect" })], "check-defect"],
      [[settled("g-1", { "s-1": "unclear" }), finding("earned")], "unclear"],
      [[settled("g-1", { "s-1": "earned" }), settled("g-1", {})], null],
      [[finding("earned"), settled("g-2", { "s-2": "unclear" })], "earned"],
    ];
    for (const [events, standing] of cases) {
      expect(standsOf(events).get("s-1") ?? null).toBe(standing);
      expect(rejectionAside(events, rejection)).toBe(standing !== "earned");
    }
    expect(labelsIn([finding("earned"), settled("g-1", { "s-1": "unclear", "s-3": 4 })])).toEqual(
      new Map([["s-1", "unclear"]]),
    );
  });
});

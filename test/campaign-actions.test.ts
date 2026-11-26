import { describe, expect, it } from "bun:test";
import type { ScheduledAction } from "../src/campaign/move.ts";
import type { Plan } from "../src/campaign/state.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject, JsonValue } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { formatCampaignStatus } from "../tools/campaign/campaign-status.ts";
import { CHOSE, LED, MOVED, readAgainst, selectComparison } from "../tools/campaign/campaign-terms.ts";

const AT = "2026-11-26T00:00:00.000Z";
const AT_ONE = "2026-11-26T00:01:00.000Z";
const AT_LATER = "2026-11-26T00:07:00.000Z";
const STARTER = "00000000starter";
const H1 = "11111111candidate";
const H2 = "22222222candidate";
const HASH = "contract-hash-1";

const ev = (kind: EventKind, data: JsonObject, at = AT): LogEvent => ({ at, kind, data });
const held = (version: string): LogEvent[] => [
  ev("task.proposed", { version }),
  ev("task.gate", { version, gate: 1, outcome: "passed" }),
];
const manyHeld = (prefix: string, count: number): LogEvent[] =>
  Array.from({ length: count }, (_, i) => held(`${prefix}-${String(i)}`)).flat();

const PLAN: Plan = {
  patience: 2,
  unprepared: false,
  practice: 2,
  wanted: { target: 5, level: 0.1, solves: 2 },
  pastStop: null,
  prompted: false,
  admits: [],
  left: null,
  promotions: null,
};

const BUILD_ACTION: ScheduledAction = { move: "build", code: "build", why: "continue" };
const COMPARE_STARTER: ScheduledAction = {
  move: "compare",
  code: "unread",
  fresh: "starter",
  reference: "promoted",
  why: "confirm",
};
const COMPARE_LATEST: ScheduledAction = {
  move: "compare",
  code: "unread",
  fresh: "latest",
  reference: "promoted",
  why: "recompare",
};

const pick = (events: readonly LogEvent[], overrides: Partial<Parameters<typeof selectComparison>[0]> = {}) =>
  selectComparison({
    events,
    plan: PLAN,
    decided: BUILD_ACTION,
    working: H1,
    reference: STARTER,
    contractHash: () => HASH,
    hasExaminer: true,
    examiningSession: null,
    ...overrides,
  });

const priorComp = (versions: readonly string[], fresh = H1): LogEvent[] => [
  ev("comparison.started", {
    session: "g-1",
    old: STARTER,
    fresh,
    starter: STARTER,
    tasks: [...versions],
    retained: [],
  }),
  ev("comparison.reported", {
    session: "g-1",
    old: STARTER,
    fresh,
    starter: STARTER,
    reading: "no-step",
    versions: [...versions],
    scored: { wins: 0, losses: 0, ties: versions.length },
    valid: { old: [1, 1, 0], fresh: [1, 1, 0], informative: { old: 1, fresh: 1 } },
  }),
];

const refusedOf = (result: ReturnType<typeof selectComparison>): string => {
  expect("refused" in result).toBe(true);
  return "refused" in result ? result.refused : "";
};

describe("selectComparison, readAgainst, and formatCampaignStatus", () => {
  it("handles reference match, scheduled starter/latest priority, duplicate refusal, lazy contractHash, and checkpoint freezing", () => {
    const base = [...manyHeld("t", 6), ev("build.checkpoint", { session: "b-1", harness: H1 })];
    let hashed = 0;
    const countHash = () => {
      hashed += 1;
      return HASH;
    };
    expect(refusedOf(pick(base, { working: STARTER, contractHash: countHash }))).toContain(
      "harness/ is the reference harness: there is nothing to compare",
    );
    expect(hashed).toBe(0);

    expect(pick(base, { working: STARTER, decided: COMPARE_STARTER, contractHash: countHash })).toEqual({
      move: COMPARE_STARTER,
      note: "harness/ is the reference harness, so the starter harness was read against it.",
    });
    expect(pick(base, { working: STARTER, decided: COMPARE_LATEST, contractHash: countHash })).toEqual({
      move: COMPARE_LATEST,
      note: "harness/ is the reference harness, so the latest harness was read against it.",
    });
    expect(pick(base, { working: H1, decided: COMPARE_STARTER, contractHash: countHash })).toEqual({
      move: COMPARE_STARTER,
      note: "The table's comparison of the starter ran first: compare reads harness/ next.",
    });
    expect(hashed).toBe(0);

    const alreadyCompared = [...base, ...priorComp(["t-0", "t-1", "t-2", "t-3", "t-4"], H1)];
    expect(readAgainst(alreadyCompared, H1, STARTER)).toBe(true);
    expect(readAgainst(alreadyCompared, H2, STARTER)).toBe(false);
    expect(
      refusedOf(pick([...alreadyCompared, ...manyHeld("fresh", 5)], { working: H1, decided: BUILD_ACTION })),
    ).toContain("read against the reference");
    expect(pick(alreadyCompared, { working: H1, decided: COMPARE_LATEST })).toEqual({
      move: COMPARE_LATEST,
      note: "",
    });
    expect(refusedOf(pick(alreadyCompared, { working: H2, decided: COMPARE_LATEST }))).toContain(
      "4 of 5 frontier tasks (80%) already scored in comparison g-1",
    );

    expect(pick(base, { working: H1, contractHash: countHash })).toEqual({
      move: { move: "compare", code: LED, fresh: H1, reference: "promoted", why: CHOSE },
      note: "",
    });
    expect(hashed).toBe(1);
    expect(pick(base, { working: H2 })).toEqual({
      move: { move: "compare", code: LED, fresh: H2, reference: "promoted", why: CHOSE },
      note: "",
      froze: H2,
    });
  });

  it("enforces exact frontier OVERLAP_LIMIT refusal, active Examiner guidance, and supply patience bypass", () => {
    const fiveTasks = ["t-0", "t-1", "t-2", "t-3", "t-4"];
    const base = [
      ...manyHeld("t", 5),
      ev("build.checkpoint", { session: "b-1", harness: H1 }),
      ...priorComp(fiveTasks, H1),
    ];

    const atExactLimit = [...base, ...held("n-0")];
    const refusedIdle = refusedOf(pick(atExactLimit, { working: H2 }));
    expect(refusedIdle).toContain("4 of 5 frontier tasks (80%) already scored in comparison g-1");
    expect(refusedIdle).toContain("Call examine");
    const refusedWriting = refusedOf(pick(atExactLimit, { working: H2, examiningSession: "x-4" }));
    expect(refusedWriting).toContain("4 of 5 frontier tasks (80%) already scored in comparison g-1");
    expect(refusedWriting).toContain("Examiner session x-4 is already writing tasks");

    const belowLimit = [...base, ...manyHeld("n", 2)];
    expect(pick(belowLimit, { working: H2 })).toMatchObject({
      move: { move: "compare", fresh: H2 },
      froze: H2,
    });

    expect(pick(atExactLimit, { working: H2, hasExaminer: false })).toMatchObject({
      move: { move: "compare", fresh: H2 },
    });

    const oneEmpty = [...atExactLimit, ev("exam.finished", { session: "x-1", ended: "finished", held: [] })];
    expect(refusedOf(pick(oneEmpty, { working: H2 }))).toContain("4 of 5 frontier tasks (80%)");
    const patienceSpent = [...oneEmpty, ev("exam.finished", { session: "x-2", ended: "finished", held: [] })];
    expect(pick(patienceSpent, { working: H2 })).toMatchObject({
      move: { move: "compare", fresh: H2 },
    });
  });

  it("formats open comparison duration from start or latest solve, Examiner progress, budget, and idle counts", () => {
    const turnWith = (events: readonly LogEvent[], plan: Plan = PLAN) => ({ events, plan });
    const idleBuild = (session: string): LogEvent[] => [
      ev(MOVED, { move: "build", session }),
      ev("build.started", { session }),
      ev("build.finished", { session, ended: "finished", changed: false }),
    ];

    const openNoSolves = [
      ...manyHeld("t", 6),
      ev(MOVED, { move: "examine", session: "x-1" }),
      ev("exam.started", { session: "x-1" }),
      ...held("x-t0"),
      ev("comparison.started", { session: "g-1", old: STARTER, fresh: H1, starter: STARTER }),
      ...idleBuild("b-1"),
      ...idleBuild("b-2"),
    ];
    const withoutSolves = formatCampaignStatus(
      turnWith(openNoSolves, { ...PLAN, left: { dollars: 12.5, reserve: 3 } }),
      undefined,
    );
    expect(withoutSolves).toContain("Campaign budget: 12.50 dollars left; 3 reserved for a solve.");
    expect(withoutSolves).toContain("Comparison g-1 has run 0 minutes and billed 0.00 dollars.");
    expect(withoutSolves).toContain("Examiner session x-1 stopped with the run of the campaign");
    expect(withoutSolves).toContain("The conversation before this one made no campaign move.");

    const openWithSolve = [
      ...openNoSolves,
      ev("solve.started", { solve: "s-1", comparison: "g-1", condition: "c" }, AT),
      ev("solve.finished", { solve: "s-1", ending: { outcome: "pass" } }, AT_LATER),
      ...idleBuild("b-3"),
    ];
    const withSolve = formatCampaignStatus(turnWith(openWithSolve), "x-1", AT_LATER);
    expect(withSolve).toContain("Comparison g-1 has run 7 minutes and billed 0.00 dollars.");
    expect(withSolve).toContain(
      "Examiner session x-1 is writing beside this conversation, 7 minutes, and has had 1 task admitted so far.",
    );
    expect(withSolve).toContain("The 2 conversations before this one made no campaign move.");

    const oneMinute = formatCampaignStatus(turnWith(openWithSolve), "x-1", AT_ONE);
    expect(oneMinute).toContain(
      "Examiner session x-1 is writing beside this conversation, 1 minute, and has had 1 task admitted so far.",
    );

    const noStart = [...manyHeld("t", 4), ev(MOVED, { move: "examine", session: "x-9" })];
    expect(formatCampaignStatus(turnWith(noStart), "x-9", AT_LATER)).toContain(
      "Examiner session x-9 is writing beside this conversation, 0 minutes, and has had 0 tasks admitted so far.",
    );
    expect(formatCampaignStatus(turnWith(noStart), undefined, AT_LATER)).toContain(
      "Examiner session x-9 stopped with the run of the campaign that began it, and had 0 tasks admitted.",
    );
  });

  it("formats finished Examiner states, reported comparisons, crash runs, practice facts, and tallied history", () => {
    const turnWith = (events: readonly LogEvent[], plan: Plan = PLAN) => ({ events, plan });
    const examCases: readonly (readonly [string | undefined, JsonValue, string, string])[] = [
      ["stands", ["v1", "v2"], "ended whole", "2 tasks"],
      ["finished", ["v1"], "ended whole", "1 task"],
      ["supplied", [], "ended whole", "0 tasks"],
      ["crashed", [], "crashed", "0 tasks"],
      ["killed", ["v1"], "was stopped", "1 task"],
      ["stopped", [], "was stopped", "0 tasks"],
      ["wall", ["v1"], "ended at its limits", "1 task"],
      ["turns", [], "ended at its limits", "0 tasks"],
      ["unexpected", "not-an-array", "ended at its limits", "0 tasks"],
      [undefined, null, "ended at its limits", "0 tasks"],
    ];
    for (const [ended, heldList, expectedPhrase, expectedCount] of examCases) {
      const events = [
        ev(MOVED, { move: "examine", session: "x-2" }),
        ev("exam.finished", {
          session: "x-2",
          ...keyIfDefined("ended", ended),
          held: heldList,
        }),
      ];
      expect(formatCampaignStatus(turnWith(events), undefined, AT_LATER)).toContain(
        `Examiner session x-2 ${expectedPhrase}, and had ${expectedCount} admitted.`,
      );
    }

    const noPractice = formatCampaignStatus(
      turnWith(manyHeld("t", 6), { ...PLAN, practice: null }),
      undefined,
    );
    expect(noPractice).toContain("No comparison has a tally yet.");
    expect(noPractice).not.toContain("Released for practice:");

    const partialPractice = [...manyHeld("t", 6), ev("task.state", { version: "t-0", state: "released" })];
    const partialStatus = formatCampaignStatus(
      turnWith(partialPractice, { ...PLAN, practice: 3 }),
      undefined,
    );
    expect(partialStatus).toContain(
      "Released for practice: 1 of the 3 tasks the campaign names, and another only while more than",
    );

    const fullPractice = [...partialPractice, ev("task.state", { version: "t-1", state: "released" })];
    const fullStatus = formatCampaignStatus(turnWith(fullPractice, { ...PLAN, practice: 2 }), undefined);
    expect(fullStatus).toContain("Released for practice: 2 of the 2 tasks the campaign names.");
    expect(fullStatus).not.toContain("and another only while");

    const reportedAndCrashed = [
      ...manyHeld("t", 5),
      ev("comparison.started", { session: "g-1", old: STARTER, fresh: H1, starter: STARTER }, AT),
      ev("solve.started", { solve: "s-1", comparison: "g-1", condition: "c" }, AT),
      ev("solve.finished", { solve: "s-1", ending: { outcome: "pass" }, billed: 1.25 }, AT_ONE),
      ev(
        "comparison.reported",
        {
          session: "g-1",
          old: STARTER,
          fresh: H1,
          starter: STARTER,
          reading: "no-step",
          versions: ["t-0", "t-1"],
          scored: { wins: 1, losses: 1, ties: 0 },
        },
        AT_LATER,
      ),
      ev("build.finished", { session: "b-1", ended: "crashed", changed: false, crash: "rate limit" }),
      ev("build.finished", { session: "b-2", ended: "crashed", changed: false, crash: "rate limit" }),
    ];
    const reportedStatus = formatCampaignStatus(turnWith(reportedAndCrashed), undefined, AT_LATER);
    expect(reportedStatus).toContain(
      "1 comparison with a tally; the last:\n- Harness 11111111 against harness 00000000",
    );
    expect(reportedStatus).toContain("Comparison g-1 took 7 minutes and billed 1.25 dollars.");
    expect(reportedStatus).toContain(
      "Sessions the provider failed in a row: 2 of the 3 that end the campaign.",
    );

    const twoReported = [
      ...reportedAndCrashed,
      ev("comparison.started", { session: "g-2", old: STARTER, fresh: H2, starter: STARTER }, AT),
      ev(
        "comparison.reported",
        {
          session: "g-2",
          old: STARTER,
          fresh: H2,
          starter: STARTER,
          reading: "step",
          versions: ["t-0", "t-1"],
          scored: { wins: 2, losses: 0, ties: 0 },
        },
        AT_LATER,
      ),
    ];
    const twoStatus = formatCampaignStatus(turnWith(twoReported), undefined, AT_LATER);
    expect(twoStatus).toContain(
      "2 comparisons with a tally; the last:\n- Harness 22222222 against harness 00000000",
    );
  });
});

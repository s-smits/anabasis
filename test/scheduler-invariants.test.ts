import { describe, expect, it } from "bun:test";
import { nextAction, practiceDue, supplyRun, tasksToAskFor, unaudited } from "../src/campaign/scheduler.ts";
import type { Plan } from "../src/campaign/state.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";

const AT = "2026-11-26T00:00:00.000Z";
const STARTER = "starter-h";
const CHECKED: LogEvent = { at: AT, kind: "checker.read", data: { contract: "c", checks: "k", faults: [] } };
const PLAN: Plan = {
  patience: 2,
  unprepared: false,
  practice: 2,
  wanted: { target: 8, level: 0.1, solves: 2 },
  pastStop: null,
  prompted: false,
  admits: [],
  left: null,
  promotions: null,
};

const ev = (kind: EventKind, data: JsonObject): LogEvent => ({ at: AT, kind, data });
const examFin = (session: string, heldIds: readonly string[] = [], ended = "finished") =>
  ev("exam.finished", { session, ended, held: [...heldIds] });
const promotedH1 = () => ev("harness.promoted", { harness: "h-1", from: STARTER, rests: [] });
const released = (version: string) => ev("task.state", { version, state: "released" });
const checkpoint = (session: string, harness: string) => ev("build.checkpoint", { session, harness });
const roomBoth = (): JsonObject => ({ old: [1, 1, 0], fresh: [1, 1, 0], informative: { old: 1, fresh: 1 } });
const roomStep = (): JsonObject => ({ old: [1, 1, 0], fresh: [0, 1, 1], informative: { old: 1, fresh: 1 } });
const held = (version: string): LogEvent[] => [
  ev("task.proposed", { version }),
  ev("task.gate", { version, gate: 1, outcome: "passed" }),
];
const manyHeld = (prefix: string, count: number): LogEvent[] =>
  Array.from({ length: count }, (_, i) => held(`${prefix}-${String(i)}`)).flat();
const compared = (
  session: string,
  old: string,
  fresh: string,
  reading: string,
  extra: JsonObject = {},
): LogEvent[] => [
  ev("comparison.started", { session, old, fresh, starter: STARTER }),
  ev("comparison.reported", {
    session,
    old,
    fresh,
    starter: STARTER,
    reading,
    versions: ["t-1"],
    scored: reading === "not-scored" ? null : { wins: 0, losses: 0, ties: 1 },
    valid: { old: [0, 0, 1], fresh: [0, 0, 1], informative: { old: 0, fresh: 0 } },
    ...extra,
  }),
];

describe("scheduler decision boundaries", () => {
  it("answers stop at its own index, enforces reserve strictly below, and pins row precedence", () => {
    const base = [CHECKED, ...manyHeld("t", 8), released("t-0")];
    const stopIdx = base.length;
    const stopped = nextAction([...base, ev("campaign.word", { word: "stop", why: "halt" })], PLAN);
    expect(stopped).toMatchObject({ move: "end", ending: "operator", answers: [stopIdx] });

    expect(nextAction(base, { ...PLAN, left: { dollars: 3, reserve: 3 } }).move).not.toBe("end");
    expect(nextAction(base, { ...PLAN, left: { dollars: 2.99, reserve: 3 } })).toMatchObject({
      move: "end",
      ending: "budget",
    });

    const defectLog = [
      ...base,
      checkpoint("b-1", "h-1"),
      ...compared("g-1", STARTER, "h-1", "check-defects"),
    ];
    expect(nextAction(defectLog, PLAN)).toMatchObject({ move: "end", ending: "exam" });

    const cappedNotScored = [
      ...base,
      checkpoint("b-1", "h-1"),
      ...compared("g-1", STARTER, "h-1", "not-scored", { capped: true }),
    ];
    expect(nextAction(cappedNotScored, PLAN)).toMatchObject({ move: "end", ending: "budget" });
    const uncappedNotScored = [
      ...base,
      checkpoint("b-1", "h-1"),
      ...compared("g-1", STARTER, "h-1", "not-scored", { capped: false, valid: roomBoth() }),
    ];
    expect(nextAction(uncappedNotScored, PLAN)).toMatchObject({ move: "build" });

    const tasksOverUnfinished = [
      CHECKED,
      ...manyHeld("t", 2),
      checkpoint("b-1", "h-1"),
      ev("comparison.started", { session: "g-open", old: STARTER, fresh: "h-1", starter: STARTER }),
    ];
    expect(nextAction(tasksOverUnfinished, { ...PLAN, practice: 1 })).toMatchObject({ move: "prepare" });
    expect(nextAction([CHECKED, ...manyHeld("t", 1)], PLAN)).toMatchObject({ move: "examine" });

    const unfinishedOverStep = [
      ...base,
      checkpoint("b-1", "h-1"),
      ...compared("g-1", STARTER, "h-1", "step", { valid: roomStep() }),
      checkpoint("b-2", "h-2"),
      ev("comparison.started", { session: "g-open", old: STARTER, fresh: "h-2", starter: STARTER }),
    ];
    expect(nextAction(unfinishedOverStep, PLAN)).toMatchObject({ move: "compare", id: "g-open" });

    const stepOverRevert = [
      ...base,
      checkpoint("b-1", "h-1"),
      ...compared("g-1", STARTER, "h-1", "step", { valid: roomStep() }),
      promotedH1(),
      ...manyHeld("e", 6),
      ...compared("g-2", "h-1", STARTER, "no-step", {
        versions: ["e-0"],
        scored: { wins: 0, losses: 1, ties: 0 },
        valid: roomBoth(),
      }),
      checkpoint("b-2", "h-2"),
      ...compared("g-3", "h-1", "h-2", "step", { versions: ["e-0"], valid: roomStep() }),
    ];
    expect(nextAction(stepOverRevert, PLAN)).toMatchObject({ move: "promote", harness: "h-2" });

    const revertOverNoRoom = [
      ...base,
      checkpoint("b-1", "h-1"),
      ...compared("g-1", STARTER, "h-1", "step", { valid: roomStep() }),
      promotedH1(),
      ...manyHeld("e", 6),
      ...compared("g-2", "h-1", STARTER, "no-step", {
        versions: ["e-0"],
        scored: { wins: 0, losses: 1, ties: 0 },
      }),
    ];
    expect(nextAction(revertOverNoRoom, PLAN)).toMatchObject({ move: "revert", harness: STARTER });

    const zeroTasksAfterCompare = [
      CHECKED,
      ...held("t-1"),
      checkpoint("b-1", "h-1"),
      ...compared("g-1", STARTER, "h-1", "no-step", { valid: roomBoth() }),
      ev("task.state", { version: "t-1", state: "disputed" }),
    ];
    expect(nextAction(zeroTasksAfterCompare, PLAN)).toMatchObject({ move: "examine" });
    const equalHeldAndReleased = [
      CHECKED,
      ...manyHeld("t", 2),
      released("t-0"),
      checkpoint("b-1", "h-1"),
      ...compared("g-1", STARTER, "h-1", "no-step", { valid: roomBoth() }),
    ];
    expect(nextAction(equalHeldAndReleased, PLAN)).toMatchObject({ move: "build" });
  });

  it("tracks newly admitted checker faults, latest unaudited draft, and interrupted draft tries", () => {
    const readWithFault = ev("checker.read", {
      contract: "c",
      checks: "k",
      faults: ["c1"],
      admitted: ["c1"],
    });
    expect(nextAction([readWithFault], { ...PLAN, admits: ["c1"] })).toMatchObject({
      move: "end",
      ending: "exam",
    });
    expect(nextAction([readWithFault], { ...PLAN, admits: ["c1", "c2"] })).toMatchObject({ move: "accept" });

    const draftedLog = [
      ev("exam.drafted", { session: "d-1" }),
      ev("referee.draft", { session: "d-1", error: "old error" }),
      ev("exam.drafted", { session: "d-2" }),
    ];
    expect(unaudited(draftedLog)).toBeNull();
    expect(unaudited([...draftedLog, ev("referee.draft", { session: "d-2", error: "new error" })])).toBe(
      "new error",
    );
    expect(
      nextAction(
        [...draftedLog, ev("referee.draft", { session: "d-2", error: "Provider is not configured" })],
        PLAN,
      ),
    ).toMatchObject({ move: "end", ending: "exam" });
    expect(
      nextAction([...draftedLog, ev("referee.draft", { session: "d-2", error: "rate limit" })], PLAN),
    ).toMatchObject({ move: "draft" });

    const draftPlan: Plan = { ...PLAN, prompted: true };
    expect(
      nextAction([ev("draft.finished", { session: "d-0", ended: "finished", tries: 2 })], draftPlan),
    ).toMatchObject({ move: "draft" });
    expect(
      nextAction([ev("draft.finished", { session: "d-0", ended: "finished", tries: 3 })], draftPlan),
    ).toMatchObject({ move: "end", ending: "exam" });
    const killedEmpty = Array.from({ length: 4 }, (_, i) =>
      ev("draft.finished", { session: `d-${String(i)}`, ended: "killed" }),
    );
    expect(nextAction(killedEmpty, draftPlan)).toMatchObject({ move: "draft" });
    const killedZero = Array.from({ length: 4 }, (_, i) =>
      ev("draft.finished", { session: `d-${String(i)}`, ended: "killed", tries: 0 }),
    );
    expect(nextAction(killedZero, draftPlan)).toMatchObject({ move: "draft" });
    const killedWithTry = Array.from({ length: 3 }, (_, i) =>
      ev("draft.finished", { session: `d-${String(i)}`, ended: "killed", tries: 1 }),
    );
    expect(nextAction(killedWithTry, draftPlan)).toMatchObject({ move: "end", ending: "exam" });
    const finishedZero = Array.from({ length: 3 }, (_, i) =>
      ev("draft.finished", { session: `d-${String(i)}`, ended: "finished", tries: 0 }),
    );
    expect(nextAction(finishedZero, draftPlan)).toMatchObject({ move: "end", ending: "exam" });
  });

  it("tracks fruitlessRun across reference switches, pre-comparison gates, order, and wantsTasks patience", () => {
    const base = [CHECKED, ...manyHeld("t", 8), released("t-0")];
    const earlierRef = [
      ...base,
      checkpoint("b-1", "h-1"),
      ...compared("g-1", STARTER, "h-1", "step"),
      examFin("x-1"),
      promotedH1(),
      ...compared("g-2", STARTER, "h-1", "no-step"),
    ];
    expect(supplyRun(earlierRef, PLAN)).toBe(0);

    const gatedBeforeCompare = [
      ...base,
      ...held("pre-1"),
      checkpoint("b-1", "h-1"),
      ...compared("g-1", STARTER, "h-1", "no-step"),
      examFin("x-1"),
      examFin("x-2", ["pre-1"]),
    ];
    expect(supplyRun(gatedBeforeCompare, PLAN)).toBe(1);

    const proposedBeforeGatedAfter = [
      ...base,
      ev("task.proposed", { version: "split-1" }),
      checkpoint("b-1", "h-1"),
      ...compared("g-1", STARTER, "h-1", "no-step"),
      examFin("x-1"),
      ev("task.gate", { version: "split-1", gate: 1, outcome: "passed" }),
      examFin("x-2", ["split-1"]),
    ];
    expect(supplyRun(proposedBeforeGatedAfter, PLAN)).toBe(0);

    const gatedAfterCompare = [
      ...base,
      checkpoint("b-1", "h-1"),
      ...compared("g-1", STARTER, "h-1", "no-step"),
      examFin("x-1"),
      ...held("post-1"),
      examFin("x-2", ["post-1"]),
    ];
    expect(supplyRun(gatedAfterCompare, PLAN)).toBe(0);

    const emptyFirst = [...base, examFin("x-1"), examFin("x-2")];
    expect(supplyRun(emptyFirst, PLAN)).toBe(2);

    const shortWithPatienceSpent = [
      CHECKED,
      ...manyHeld("t", 3),
      released("t-0"),
      checkpoint("b-1", "h-1"),
      ...compared("g-1", STARTER, "h-1", "no-step", { valid: roomBoth() }),
      examFin("x-1"),
      examFin("x-2"),
    ];
    expect(nextAction(shortWithPatienceSpent, PLAN)).toMatchObject({ move: "end", ending: "exam" });
  });

  it("caps tasksToAskFor at 24 after promotion, pins enoughWrittenSince and interrupted post-promotion examine, and checks practiceDue bounds", () => {
    const noTasks = [CHECKED];
    expect(
      tasksToAskFor(noTasks, { ...PLAN, wanted: { target: 24, level: 0.02, solves: 2 }, practice: 4 }),
    ).toBe(12);
    expect(
      tasksToAskFor([CHECKED, ...manyHeld("t", 5)], {
        ...PLAN,
        wanted: { target: 8, level: 0.1, solves: 2 },
        practice: null,
      }),
    ).toBe(4);
    expect(tasksToAskFor([CHECKED, ...manyHeld("t", 10)], PLAN)).toBe(0);
    const afterPromo = [
      CHECKED,
      ...manyHeld("t", 8),
      released("t-0"),
      checkpoint("b-1", "h-1"),
      ...compared("g-1", STARTER, "h-1", "step"),
      promotedH1(),
      released("t-1"),
    ];
    expect(
      tasksToAskFor(afterPromo, { ...PLAN, wanted: { target: 40, level: 0.02, solves: 2 }, practice: 4 }),
    ).toBe(24);
    expect(
      tasksToAskFor(afterPromo, { ...PLAN, wanted: { target: 8, level: 0.1, solves: 2 }, practice: 2 }),
    ).toBe(9);

    const exactSweepLog = [
      CHECKED,
      ...manyHeld("t", 8),
      released("t-0"),
      ev("task.proposed", { version: "a-edge" }),
      checkpoint("b-1", "h-1"),
      ev("comparison.started", { session: "g-1", old: STARTER, fresh: "h-1", starter: STARTER }),
      ev("task.gate", { version: "a-edge", gate: 1, outcome: "passed" }),
      ev("comparison.reported", {
        session: "g-1",
        old: STARTER,
        fresh: "h-1",
        starter: STARTER,
        reading: "no-step",
        versions: ["t-1"],
        scored: { wins: 0, losses: 0, ties: 1 },
        valid: { old: [0, 0, 1], fresh: [0, 0, 1], informative: { old: 0, fresh: 0 } },
      }),
      ...manyHeld("b", 3),
    ];
    expect(
      nextAction(exactSweepLog, { ...PLAN, wanted: { target: 8, level: 0.1, solves: 2 } }),
    ).toMatchObject({ move: "compare", fresh: "latest" });
    const oneShortAfterCompare = [
      CHECKED,
      ...manyHeld("t", 7),
      released("t-0"),
      checkpoint("b-1", "h-1"),
      ...held("pre-edge"),
      ...compared("g-1", STARTER, "h-1", "no-step"),
      ...manyHeld("b", 3),
    ];
    expect(
      nextAction(oneShortAfterCompare, { ...PLAN, wanted: { target: 8, level: 0.1, solves: 2 } }),
    ).toMatchObject({ move: "examine" });

    const interruptedExamAfterPromo = [
      CHECKED,
      ...manyHeld("t", 8),
      released("t-0"),
      checkpoint("b-1", "h-1"),
      ...compared("g-1", STARTER, "h-1", "step", { valid: roomStep() }),
      promotedH1(),
      ev("exam.started", { session: "x-1" }),
      examFin("x-1", [], "crashed"),
    ];
    expect(nextAction(interruptedExamAfterPromo, PLAN)).toMatchObject({ move: "examine" });

    const notScoredStarter = [
      CHECKED,
      ...manyHeld("t", 8),
      released("t-0"),
      checkpoint("b-1", "h-1"),
      ...compared("g-1", STARTER, "h-1", "step", { valid: roomStep() }),
      promotedH1(),
      ...manyHeld("n", 6),
      examFin("x-1", ["n-0", "n-1", "n-2", "n-3", "n-4", "n-5"]),
      ...compared("g-2", "h-1", STARTER, "not-scored", { versions: ["n-0"], valid: roomBoth() }),
    ];
    expect(nextAction(notScoredStarter, PLAN)).toMatchObject({ move: "compare", fresh: "starter" });

    expect(practiceDue([CHECKED, ...manyHeld("t", 8)], null, 0.1)).toBeNull();
    const confirmedStarter = compared("g-s", "h-1", STARTER, "no-step", {
      level: 0.1,
      versions: ["n-0", "n-1", "n-2", "n-3"],
      scored: { differences: [-1, -1, -1, -1] },
    });
    const afterPromoTasks = [
      CHECKED,
      ...manyHeld("t", 12),
      checkpoint("b-1", "h-1"),
      ...compared("g-0", STARTER, "h-1", "step", { level: 0.1 }),
      promotedH1(),
      ...manyHeld("n", 10),
    ];
    expect(practiceDue(afterPromoTasks, 3, 0.1)).toBeNull();
    const failedStarterPendingRevert = [
      ...afterPromoTasks,
      ...compared("g-fail", "h-1", STARTER, "no-step", {
        level: 0.1,
        versions: ["n-0", "n-1", "n-2", "n-3"],
        scored: { differences: [1, -1, 1, -1] },
      }),
    ];
    expect(practiceDue(failedStarterPendingRevert, 3, 0.1)).toBeNull();
    const afterConfirmedPromo = [...afterPromoTasks, ...confirmedStarter];
    expect(practiceDue(afterConfirmedPromo, 3, 0.1)?.to).toBe(3);
    const alreadyOneReleased = [...afterConfirmedPromo, released("n-0")];
    expect(practiceDue(alreadyOneReleased, 3, 0.1)?.to).toBe(3);
  });

  it("covers earlier pending promotions, fresh-side noRoom, post-revert build and baseline, not-scored recompare, and practiceDue nonFrontier", () => {
    const base = [CHECKED, ...manyHeld("t", 8), released("t-0")];
    const earlierStep = [
      ...base,
      checkpoint("b-1", "h-1"),
      ...compared("g-1", STARTER, "h-1", "step", { valid: roomStep() }),
      checkpoint("b-2", "h-2"),
    ];
    expect(nextAction(earlierStep, PLAN)).toMatchObject({ move: "promote", harness: "h-1" });

    const freshSideNoRoom = [
      ...base,
      checkpoint("b-1", "h-1"),
      ...compared("g-1", STARTER, "h-1", "step", {
        valid: { old: [1, 1, 0], fresh: [0, 0, 1], informative: { old: 1, fresh: 0 } },
      }),
      promotedH1(),
      examFin("x-1"),
    ];
    expect(nextAction(freshSideNoRoom, PLAN)).toMatchObject({ move: "examine" });

    const revertedWithRoom = [
      ...base,
      checkpoint("b-1", "h-1"),
      ...compared("g-1", STARTER, "h-1", "step", { valid: roomStep() }),
      promotedH1(),
      ev("harness.reverted", { harness: STARTER, from: "h-1" }),
    ];
    expect(nextAction(revertedWithRoom, PLAN)).toMatchObject({ move: "build" });

    const notScoredEnoughNew = [
      ...base,
      checkpoint("b-1", "h-1"),
      ...compared("g-1", STARTER, "h-1", "not-scored", { valid: roomBoth() }),
      ...manyHeld("n", 4),
    ];
    expect(nextAction(notScoredEnoughNew, PLAN)).toMatchObject({ move: "compare", fresh: "latest" });

    const dupReport = [
      CHECKED,
      ...manyHeld("t", 12),
      checkpoint("b-1", "h-1"),
      ...compared("g-1", STARTER, "h-1", "no-step"),
      released("t-0"),
      released("t-1"),
      ev("comparison.reported", {
        session: "g-1",
        old: STARTER,
        fresh: "h-1",
        starter: STARTER,
        reading: "no-step",
        versions: ["t-2"],
        scored: { wins: 0, losses: 0, ties: 1 },
      }),
    ];
    expect(practiceDue(dupReport, 2, 0.1)).toBeNull();

    const confirmedH1 = [
      ...compared("g-0", STARTER, "h-1", "step", { level: 0.1 }),
      promotedH1(),
      ...manyHeld("n", 7),
      ...compared("g-s", "h-1", STARTER, "no-step", {
        level: 0.1,
        versions: ["n-0", "n-1", "n-2", "n-3"],
        scored: { differences: [-1, -1, -1, -1] },
      }),
    ];
    const nonFrontierRelease = [
      CHECKED,
      ...manyHeld("t", 2),
      checkpoint("b-1", "h-1"),
      ...confirmedH1,
      ...compared("g-1", "h-1", "h-2", "no-step", { versions: ["n-0"] }),
      released("t-0"),
    ];
    expect(practiceDue(nonFrontierRelease, 3, 0.1)).toBeNull();
    const postSinceNewRelease = [
      CHECKED,
      ...manyHeld("t", 2),
      checkpoint("b-1", "h-1"),
      ...confirmedH1,
      ...compared("g-1", "h-1", "h-2", "no-step", { versions: ["n-0"] }),
      ...manyHeld("m", 2),
      released("m-0"),
    ];
    expect(practiceDue(postSinceNewRelease, 3, 0.1)?.to).toBe(3);

    const postPromoSevenNew = [CHECKED, ...manyHeld("t", 8), checkpoint("b-1", "h-1"), ...confirmedH1];
    expect(practiceDue(postPromoSevenNew, 3, 0.1)?.to).toBe(1);
    const afterReleaseBaseline = [
      CHECKED,
      ...manyHeld("t", 8),
      ...manyHeld("b", 8),
      released("t-0"),
      checkpoint("b-1", "h-1"),
      ...compared("g-1", STARTER, "h-1", "no-step"),
      ...manyHeld("c", 1),
    ];
    expect(practiceDue(afterReleaseBaseline, 3, 0.1)?.to).toBe(2);
    const revertedToStarterZeroBaseline = [
      CHECKED,
      ...manyHeld("t", 8),
      checkpoint("b-1", "h-1"),
      ...compared("g-1", STARTER, "h-1", "step", { valid: roomStep() }),
      promotedH1(),
      ev("harness.reverted", { harness: STARTER, from: "h-1" }),
    ];
    expect(practiceDue(revertedToStarterZeroBaseline, 3, 0.1)).toBeNull();
  });
});

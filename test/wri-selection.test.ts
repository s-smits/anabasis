// The sign draws of a starter read (comparison-reading's `selection.ts`), against every draw asked of
// the comparison's own test, and which tasks `starterReads` counts as no step's choice. Invented data.
import { describe, expect, it } from "bun:test";
import { stepCount } from "#skills/comparison-reading/scripts/selection.ts";
import { chosenForReference, epochsOf, starterReads } from "../src/campaign/climb.ts";
import { OPENING } from "../src/kernel/history.ts";
import { scoredSet } from "../src/campaign/round.ts";
import { flipP, isSignificant, WEIGHTS } from "../src/kernel/compare.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import { asRecord, isString, type JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { roundSolves } from "./helpers/logged-round.ts";

const STARTER = "a".repeat(64);
const NEW = "b".repeat(64);
const AT = "2026-10-30T00:00:00.000Z";
const chose = Array.from({ length: 7 }, (_, nth) => `chose-${String(nth)}`);

/** Every sign draw of the untied `free`, each asked of `isSignificant` with `fixed` as scored. */
function brute(fixed: readonly number[], free: readonly number[], level: number): number {
  const untied = free.filter((one) => one !== 0).map(Math.abs);
  let confirm = 0;
  for (let draw = 0; draw < 2 ** untied.length; draw += 1) {
    const signs = untied.map((size, at) => (Math.floor(draw / 2 ** at) % 2 === 1 ? size : -size));
    if (isSignificant([...fixed, ...signs], level)) confirm += 1;
  }
  return confirm;
}

function margins(count: number, seed: number): number[] {
  let state = seed;
  return Array.from({ length: count }, () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    const size = [0, 40, 40, 120, 300, 600, 600, 75][state % 8] ?? 0;
    return state % 3 === 0 ? -size : size;
  });
}

describe("how many sign draws of the tasks written after read a step", () => {
  it("agrees with every draw asked of isSignificant, at each size brute force reaches", () => {
    for (let free = 0; free <= 14; free += 1) {
      for (const [seed, level] of [
        [free + 1, 0.02],
        [free + 101, 0.1],
      ] as const) {
        const fixed = margins(10, seed * 7);
        const after = margins(free, seed);
        const counted = stepCount(fixed, after, level);
        expect(Number(counted.confirm)).toBe(brute(fixed, after, level));
        expect(counted.draws).toBe(2n ** BigInt(after.filter((one) => one !== 0).length));
      }
    }
  });

  it("keeps a tied task written after a tie in every draw rather than giving it two signs", () => {
    const counted = stepCount([600, 600, 600, 600, 600], [600, 0, 0], 0.02);
    expect([counted.free, counted.draws, counted.confirm]).toEqual([1, 2n, 1n]);
  });

  it("takes the test's threshold over every untied size, not over the fixed tasks' alone", () => {
    // Six fixed wins of 100 read a step alone (1 in 64), but beside one large task lost they do not.
    const fixed = [100, 100, 100, 100, 100, 100];
    expect(isSignificant(fixed, 0.02)).toBe(true);
    expect(flipP([...fixed, -900])).toBeGreaterThan(0.02);
    expect(stepCount(fixed, [900], 0.02).confirm).toBe(1n);
  });

  it("counts one draw for a read with no untied task written after, as its other tasks read", () => {
    expect(stepCount([600, 600, 600, 600, 600, 600], [], 0.02)).toEqual({ free: 0, draws: 1n, confirm: 1n });
    expect(stepCount([600, -600], [0, 0], 0.02)).toEqual({ free: 0, draws: 1n, confirm: 0n });
  });
});

const gate = (version: string, session?: string): LogEvent[] => [
  {
    at: AT,
    kind: "task.proposed",
    data: {
      version,
      taskId: version,
      task: { taskId: version, family: "fixture", publicInput: {}, hidden: null },
      ...keyIfDefined("session", session),
    },
  },
  { at: AT, kind: "task.gate", data: { version, gate: 1, outcome: "passed" } },
];

function comparison(
  session: string,
  sides: readonly [string, string],
  outcomes: Readonly<Record<string, string>>,
  reading: string,
  more: JsonObject = { level: 0.02 },
): LogEvent[] {
  const { events, terms } = roundSolves(session, sides, outcomes);
  const [old, fresh] = sides;
  return [
    { at: AT, kind: "comparison.started", data: { session, old, fresh, starter: STARTER } },
    ...events,
    {
      at: AT,
      kind: "comparison.reported",
      data: { session, old, fresh, starter: STARTER, reading, noise: null, scored: {}, ...terms, ...more },
    },
  ];
}

const promotion: LogEvent[] = [
  ...chose.flatMap((task) => gate(task)),
  ...comparison("g-1", [STARTER, NEW], Object.fromEntries(chose.map((task) => [task, "FF PP"])), "step"),
  { at: AT, kind: "harness.promoted", data: { harness: NEW, from: STARTER, rests: [] } },
];

describe("a starter read on the tasks no step chose", () => {
  const THIRD = "c".repeat(64);
  const second = Array.from({ length: 6 }, (_, nth) => `second-${String(nth)}`);
  const after = ["after-0", "after-1"];
  const all = [...chose, ...second, ...after];
  const beforeRead: LogEvent[] = [
    ...promotion,
    ...second.flatMap((task) => gate(task, "x-2")),
    ...comparison("g-2", [NEW, THIRD], Object.fromEntries(second.map((task) => [task, "FF PP"])), "step"),
    { at: AT, kind: "harness.promoted", data: { harness: THIRD, from: NEW, rests: [] } },
    ...after.flatMap((task) => gate(task, "x-3")),
  ];
  const log: LogEvent[] = [
    ...beforeRead,
    ...comparison("g-3", [THIRD, STARTER], Object.fromEntries(all.map((task) => [task, "PP FF"])), "step"),
  ];

  it("is drawn on none of the tasks a step chose before the reference, retained ones included", () => {
    expect(chosenForReference(beforeRead, NEW).size).toBe(0);
    const leftOut = chosenForReference(beforeRead, STARTER);
    expect([...leftOut].toSorted()).toEqual([...chose, ...second].toSorted());
    expect(scoredSet(beforeRead, 12, "c", leftOut).tasks.toSorted()).toEqual(after);
  });

  it("leaves out an ancestor's chosen tasks, which the origins count as written before and not chosen on", () => {
    const [read] = starterReads(log);
    expect(read?.origins["read at the promotion"].whole.wins).toBe(second.length);
    expect(read?.origins["written before, not chosen on"].whole.wins).toBe(chose.length);
    expect(read?.unchosen).toEqual({ tally: { wins: 2, losses: 0, ties: 0 }, read: "too few" });
  });

  it("keeps the tasks of a step the starter won, which chose nothing the reference descends from", () => {
    const lost = ["lost-0", "lost-1"];
    const read = starterReads([
      ...promotion,
      ...lost.flatMap((task) => gate(task, "x-2")),
      ...comparison("g-1s", [NEW, STARTER], Object.fromEntries(lost.map((task) => [task, "FF PP"])), "step"),
      ...second.flatMap((task) => gate(task, "x-2")),
      ...comparison("g-2", [NEW, THIRD], Object.fromEntries(second.map((task) => [task, "FF PP"])), "step"),
      { at: AT, kind: "harness.promoted", data: { harness: THIRD, from: NEW, rests: [] } },
      ...after.flatMap((task) => gate(task, "x-3")),
      ...comparison(
        "g-3",
        [THIRD, STARTER],
        Object.fromEntries([...all, ...lost].map((task) => [task, "PP FF"])),
        "step",
      ),
    ]).at(-1);
    expect(read?.session).toBe("g-3");
    expect(read?.unchosen.tally.wins).toBe(after.length + lost.length);
  });

  it("splits written-after starter reads across both validity signs and objectives, isolating read.after from earlier tasks", () => {
    const valWin = () => ({ outcomes: "PP FF", oldObj: [10, 10], freshObj: [10, 10] });
    const valLoss = () => ({ outcomes: "FF PP", oldObj: [10, 10], freshObj: [10, 10] });
    const afterValTasks = Array.from({ length: 7 }, (_, i) => `a-val-${String(i + 1)}`);
    const mixMargin = Math.round(0.5 * WEIGHTS.validity * 1000 - 0.25 * WEIGHTS.objective * 1000);
    const objLog: LogEvent[] = [
      ...gate("open-0"),
      ...comparison("g-1", [STARTER, NEW], { "open-0": "FF PP" }, "step"),
      { at: AT, kind: "harness.promoted", data: { harness: NEW, from: STARTER, rests: [] } },
      ...[...afterValTasks, "a-obj", "a-mix", "a-loss"].flatMap((task) => gate(task, "x-after")),
      ...comparisonWithObjectives(
        "g-2",
        [NEW, STARTER],
        {
          "open-0": valLoss(),
          ...Object.fromEntries(afterValTasks.map((task) => [task, valWin()])),
          "a-obj": { outcomes: "PP PP", oldObj: [20, 20], freshObj: [10, 10] },
          "a-mix": { outcomes: "PP PF", oldObj: [10, 10], freshObj: [20, 20] },
          "a-loss": valLoss(),
        },
        {
          level: 0.02,
          scored: {
            differences: [600, -600, -600, -600, -600, -600, -600, -600, -150, -mixMargin, 600],
          },
        },
      ),
    ];
    const [read] = starterReads(objLog);
    expect(read?.confirmed).toBe(false);
    expect(read?.origins["written after"]).toEqual({
      whole: { wins: 9, losses: 1, ties: 0 },
      validity: { wins: 8, losses: 1, ties: 0 },
      rest: { wins: 1, losses: 0, ties: 0 },
    });
    expect(read?.after).toBe("a step");
    expect(read?.rows.find(({ task }) => task === "open-0")?.writer).toBe(OPENING);
    expect(read?.rows.find(({ task }) => task === "a-mix")?.margin).toBe(mixMargin);
  });

  it("tracks epoch Builder sessions, confirmed starter reads, and unconfirmed reverts with null promoted", () => {
    const confirmedTasks = Array.from({ length: 6 }, (_, i) => `c-${String(i)}`);
    const confirmedLog: LogEvent[] = [
      ...gate("p-0"),
      eventBuild("b-0"),
      ...comparison("g-1", [STARTER, NEW], { "p-0": "FF PP" }, "step"),
      { at: AT, kind: "harness.promoted", data: { harness: NEW, from: STARTER, rests: [] } },
      eventBuild("b-1"),
      eventBuild("b-2"),
      ...confirmedTasks.flatMap((task) => gate(task, "x-1")),
      ...comparison(
        "g-2",
        [NEW, STARTER],
        Object.fromEntries(confirmedTasks.map((task) => [task, "PP FF"])),
        "no-step",
        { level: 0.02, scored: { differences: confirmedTasks.map(() => -600) } },
      ),
    ];
    const epochs = epochsOf(confirmedLog);
    expect(epochs[0]?.sessions).toBe(1);
    expect(epochs[1]?.sessions).toBe(2);
    expect(starterReads(confirmedLog)[0]?.confirmed).toBe(true);

    const unconfirmedLog: LogEvent[] = [
      ...gate("u-0"),
      ...comparison("g-1", [STARTER, NEW], { "u-0": "FF PP" }, "step"),
      { at: AT, kind: "harness.promoted", data: { harness: NEW, from: STARTER, rests: [] } },
      ...gate("u-1", "x-1"),
      ...comparison("g-2", [NEW, STARTER], { "u-1": "PP FF" }, "no-step", {
        level: 0.02,
        scored: { differences: [-600] },
      }),
      { at: AT, kind: "harness.promoted", data: { harness: THIRD, from: NEW, rests: [] } },
      { at: AT, kind: "harness.reverted", data: { harness: NEW, from: THIRD } },
    ];
    expect(starterReads(unconfirmedLog)[0]?.confirmed).toBe(false);
    expect(epochsOf(unconfirmedLog).at(-2)?.promoted).toBeNull();
    expect(epochsOf(unconfirmedLog).at(-1)).toMatchObject({
      reference: NEW,
      confirmed: false,
      reverted: true,
    });
  });
});

const eventBuild = (session: string): LogEvent => ({
  at: AT,
  kind: "build.started",
  data: { session },
});

function comparisonWithObjectives(
  session: string,
  sides: readonly [string, string],
  tasks: Readonly<
    Record<
      string,
      { readonly outcomes: string; readonly oldObj: readonly number[]; readonly freshObj: readonly number[] }
    >
  >,
  more: JsonObject,
): LogEvent[] {
  const outcomes = Object.fromEntries(Object.entries(tasks).map(([k, v]) => [k, v.outcomes]));
  const { events, terms } = roundSolves(session, sides, outcomes);
  const [old, fresh] = sides;
  const condInfo = new Map<string, { readonly task: string; readonly harness: string }>();
  const solveInfo = new Map<
    string,
    { readonly task: string; readonly harness: string; readonly nth: number }
  >();
  const counts = new Map<string, number>();
  const withVerdicts = events.flatMap((ev) => {
    if (ev.kind === "condition.recorded") {
      const cond = asRecord(ev.data.condition);
      if (isString(ev.data.id) && isString(cond?.task) && isString(cond?.harness)) {
        condInfo.set(ev.data.id, { task: cond.task, harness: cond.harness });
      }
      return [ev];
    }
    if (ev.kind === "solve.started" && isString(ev.data.solve) && isString(ev.data.condition)) {
      const info = condInfo.get(ev.data.condition);
      if (info !== undefined) {
        const key = `${info.task}:${info.harness}`;
        const nth = counts.get(key) ?? 0;
        counts.set(key, nth + 1);
        solveInfo.set(ev.data.solve, { ...info, nth });
      }
      return [ev];
    }
    if (ev.kind !== "solve.finished" || !isString(ev.data.solve)) return [ev];
    if (asRecord(ev.data.ending)?.outcome !== "pass") return [ev];
    const info = solveInfo.get(ev.data.solve);
    const spec = info === undefined ? undefined : tasks[info.task];
    const obj =
      info === undefined || spec === undefined
        ? undefined
        : (info.harness === old ? spec.oldObj : spec.freshObj)[info.nth];
    if (obj === undefined) return [ev];
    return [
      ev,
      {
        at: AT,
        kind: "verdict",
        data: { solve: ev.data.solve, kind: "pass", objective: obj },
      } satisfies LogEvent,
    ];
  });
  return [
    { at: AT, kind: "comparison.started", data: { session, old, fresh, starter: STARTER } },
    ...withVerdicts,
    {
      at: AT,
      kind: "comparison.reported",
      data: {
        session,
        old,
        fresh,
        starter: STARTER,
        reading: "no-step",
        noise: null,
        objective: { direction: "higher" },
        ...terms,
        ...more,
      },
    },
  ];
}

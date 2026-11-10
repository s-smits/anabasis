// The walk to the milestone, by the table and the epochs alone: can a campaign at this commit reach
// six confirmed promotions and read the ten A/A comparisons after them? A log is written by hand as
// `test/decide.test.ts` writes one, each move the one `decide` names or a Builder's own `compare`
// (`comparedOf`, `tools/d2/campaign-actions.ts`). It proves the path and nothing of a model: how often
// a promotion clears against the starter is the record's (`AGENTS.md`, "Promotion against
// confirmation"). Written on 5 November for the recount of what a release still requires.

import { describe, expect, it } from "bun:test";
import { barLines, epochsOf } from "../src/campaign/climb.ts";
import { decide } from "../src/campaign/decide.ts";
import type { Plan } from "../src/campaign/ground.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tallied } from "./helpers/tally.ts";

/** The terms a run with no cap carries: the default level, patience and target. */
const PLAN: Plan = {
  patience: 6,
  unprepared: false,
  practice: null,
  wanted: { target: 24, level: 0.02, solves: 2 },
  pastStop: null,
  prompted: false,
  admits: [],
  left: null,
  promotions: null,
};
const STARTER = "start";
/** Tasks won or lost by a side in every comparison here, and tied. */
const CLEAR = [8, 0, 4] as const;
/** Half the tasks answered, which leaves the reference room. */
const HALF = [4, 4, 4];
/** A sweep at 0.02: as many tasks as could clear the level alone. */
const SWEEP = 6;
const HELD_AT_OPENING = 32;
/** An A/A of the reference's first solves against its second, tied on most and even on the rest. */
const QUIET = [1, -1, 1, -1, 1, -1, 0, 0];

const event = (kind: EventKind, data: JsonObject): LogEvent => ({
  at: "2026-11-05T00:00:00.000Z",
  kind,
  data,
});
const heldOut = (version: string) => [
  event("task.proposed", { version, taskId: version }),
  event("task.gate", { version, gate: 1, outcome: "passed" }),
];
const versions = (from: string, count: number) =>
  Array.from({ length: count }, (_, at) => `${from}-${String(at)}`);
const OPENING = [
  event("checker.read", { contract: "c", checks: "k", faults: [] }),
  ...versions("v", HELD_AT_OPENING).flatMap(heldOut),
  ...heldOut("p"),
  event("task.state", { version: "p", state: "released" }),
];
const built = (harness: string) =>
  event("build.finished", { session: `b-${harness}`, harness, changed: true, ended: "finished" });
const examined = (session: string, count: number) => {
  const held = versions(session, count);
  return [event("exam.finished", { session, held, refused: [], proposed: count }), ...held.flatMap(heldOut)];
};
const promoted = (harness: string, from: string) => event("harness.promoted", { harness, from });
/** A comparison of `fresh` against the reference `old`, with its A/A beside it. */
function compared(
  session: string,
  sides: { readonly old: string; readonly fresh: string },
  reading: string,
  tally: readonly [number, number, number],
): LogEvent[] {
  const [wins, losses, ties] = tally;
  const scores = tallied(wins, losses, ties);
  return [
    event("comparison.started", { session, ...sides, starter: STARTER }),
    event("comparison.reported", {
      session,
      ...sides,
      starter: STARTER,
      reading,
      level: PLAN.wanted.level,
      ...scores,
      scored: scores.frontier,
      versions: versions("v", wins + losses + ties),
      valid: { old: HALF, fresh: HALF, informative: { old: 4, fresh: 4 } },
      noise: { differences: QUIET },
      setting: null,
    }),
  ];
}
/** The harness promoted by the promotion numbered `nth`, from the starter up. */
const harnessOf = (nth: number) => (nth === 0 ? STARTER : `h${String(nth)}`);
/** The reference's read against the starter: the starter is the new side, so the reference's wins
 *  are its losses. */
const starterRead = (session: string, reference: string, won: number) =>
  compared(session, { old: reference, fresh: STARTER }, "no-step", [0, won, 12 - won]);
/** A Builder's changed harness, compared on its own word, reading `reading`. */
const led = (session: string, reference: string, harness: string, reading = "step") => [
  built(harness),
  ...compared(session, { old: reference, fresh: harness }, reading, reading === "step" ? CLEAR : [4, 4, 4]),
];

/**
 * The log of `promotions` promotions, and at every one after the first the moves the table names:
 * tasks for the new reference, the starter comparison it owes, then a Builder's step. Each move is
 * asked of `decide` before it is written, so the table's naming it is what is proved.
 */
function walked(promotions: number, plan: Plan = PLAN): LogEvent[] {
  const log = [...OPENING, ...led("g-1", STARTER, "h1")];
  for (let nth = 1; nth <= promotions; nth += 1) {
    expect(decide(log, plan)).toMatchObject({ move: "promote", harness: harnessOf(nth), code: "step" });
    log.push(promoted(harnessOf(nth), harnessOf(nth - 1)));
    if (nth === promotions) break;
    log.push(
      ...confirming(log, nth, plan),
      ...led(`g-${harnessOf(nth + 1)}`, harnessOf(nth), harnessOf(nth + 1)),
    );
  }
  return log;
}

/** After the promotion numbered `nth`: the table asks for tasks, then owes the starter comparison. */
function confirming(log: readonly LogEvent[], nth: number, plan: Plan = PLAN): LogEvent[] {
  expect(decide(log, plan)).toMatchObject({ move: "examine", code: "no-room" });
  const written = examined(`x-${String(nth)}`, SWEEP);
  const held = [...log, ...written];
  expect(decide(held, plan)).toMatchObject({ move: "compare", fresh: "starter", code: "unread" });
  return [...written, ...starterRead(`s-${String(nth)}`, harnessOf(nth), 8)];
}

const confirmedCount = (log: readonly LogEvent[]) =>
  epochsOf(log).filter(({ confirmed }) => confirmed === true).length;

describe("requirement 1: six confirmed promotions in one campaign", () => {
  it("owes a starter comparison after every promotion, and reads the sixth's in the seventh epoch", () => {
    const sixth = walked(6);
    // Five are confirmed as the sixth is promoted, and it stands unread.
    expect(confirmedCount(sixth)).toBe(5);
    expect(epochsOf(sixth).at(-1)).toMatchObject({ nth: 7, confirmed: false, starter_tally: null });
    const whole = [...sixth, ...confirming(sixth, 6)];
    expect(confirmedCount(whole)).toBe(6);
    expect(epochsOf(whole).map(({ confirmed }) => confirmed)).toEqual([
      null,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(barLines(whole)[0]).toBe(
      "- Climb: 6 promotions, 6 confirmed against a milestone of 6; 0 read against the starter without a step, 0 not read against it.",
    );
  });

  it("ends a campaign capped at six before the sixth's starter comparison, so such a campaign confirms five at most", () => {
    const capped = { ...PLAN, promotions: 6 };
    const log = walked(6, capped);
    expect(decide(log, capped)).toMatchObject({ move: "end", ending: "operator", code: "stop" });
    expect(confirmedCount(log)).toBe(5);
    // A cap of seven or none reads it.
    expect(decide(log, { ...PLAN, promotions: 7 })).toMatchObject({ move: "examine" });
    expect(decide(log, PLAN)).toMatchObject({ move: "examine" });
  });

  it("does not owe a promotion a second reading once one tallied short of a step, so it stays unconfirmed", () => {
    const promotedOnce = walked(1);
    const held = [...promotedOnce, ...examined("x-1", SWEEP)];
    // Five of five is short of the level, and is the one reading the epoch gets.
    const short = [...held, ...starterRead("s-1", "h1", 5)];
    const written = [...short, ...examined("x-2", SWEEP)];
    expect(decide(written, PLAN)).not.toMatchObject({ fresh: "starter" });
    expect(epochsOf(written).at(-1)).toMatchObject({
      confirmed: false,
      starter_tally: { wins: 5, losses: 0 },
    });
  });

  it("lets a Builder's own comparison read first where no task is held out since the promotion, and its step promotes with the debt unpaid", () => {
    const promotedOnce = walked(1);
    // An Examiner session that held nothing: the table names a Builder session, and no starter.
    const empty = [...promotedOnce, ...examined("x-1", 0)];
    expect(decide(empty, PLAN)).toMatchObject({ move: "build" });
    const stepped = [...empty, ...led("g-h2", "h1", "h2")];
    expect(decide(stepped, PLAN)).toMatchObject({ move: "promote", harness: "h2" });
    const after = [...stepped, promoted("h2", "h1")];
    expect(epochsOf(after)[1]).toMatchObject({ nth: 2, confirmed: false, starter_tally: null });
    // A reading of one epoch never reaches another, so that promotion can no longer be confirmed.
    const next = [...after, ...examined("x-2", SWEEP), ...starterRead("s-2", "h2", 8)];
    expect(epochsOf(next).map(({ confirmed }) => confirmed)).toEqual([null, false, true]);
  });

  it("owes the starter comparison on one task held out, once the last reading left the reference room", () => {
    const held = [...walked(1), ...examined("x-1", 1)];
    expect(decide(held, PLAN)).toMatchObject({ move: "compare", fresh: "starter" });
  });
});

describe("requirement 3: the ten A/A comparisons after the sixth promotion", () => {
  const sixth = walked(6);
  const confirmedSixth = [...sixth, ...confirming(sixth, 6)];
  /** Built harnesses `count` in a row, each read with room and no step, from `from` up. */
  const flat = (from: number, count: number) =>
    Array.from({ length: count }, (_, at) =>
      led(`f-${String(from + at)}`, "h6", `f${String(from + at)}`, "no-step"),
    ).flat();
  const honesty = (log: readonly LogEvent[]) => barLines(log)[1];

  it("reads the comparisons after the sixth as one line, the starter comparison's A/A among them", () => {
    expect(honesty(sixth)).toContain("after promotion 6, 0 A/A comparisons");
    expect(honesty(confirmedSixth)).toContain("after promotion 6, 1 A/A comparison against the bar's 10");
  });

  it("ends a campaign that gains nothing at its improvement patience, seven A/A comparisons in, short of ten", () => {
    const five = [...confirmedSixth, ...flat(1, 5)];
    expect(decide(five, PLAN)).toMatchObject({ move: "build" });
    const stopped = [...five, ...flat(6, 1)];
    expect(decide(stopped, PLAN)).toMatchObject({ move: "end", ending: "stop", code: "bound" });
    expect(honesty(stopped)).toContain("after promotion 6, 7 A/A comparisons against the bar's 10");
  });

  it("goes on past the stop on `--past-stop`, or with a larger `--patience`, to the ten", () => {
    const flatTen = [...confirmedSixth, ...flat(1, 9)];
    const told = { ...PLAN, pastStop: "the milestone's ten A/A comparisons" };
    expect(decide(flatTen, told)).toMatchObject({ move: "build" });
    expect(honesty(flatTen)).toContain("after promotion 6, 10 A/A comparisons against the bar's 10");
    // Patience is the log's, as the opening records it (`patienceOf`).
    const opened = event("campaign.opened", { patience: 10 });
    expect(decide([opened, ...flatTen], PLAN)).toMatchObject({ move: "build" });
    expect(decide([opened, ...flatTen, ...flat(10, 1)], PLAN)).toMatchObject({ ending: "stop" });
  });

  it("restarts improvement patience at a seventh promotion, so a climbing campaign reads more", () => {
    const seventh = [...confirmedSixth, ...flat(1, 5), ...led("g-h7", "h6", "h7"), promoted("h7", "h6")];
    expect(decide(seventh, PLAN)).not.toMatchObject({ ending: "stop" });
    expect(honesty(seventh)).toContain("after promotion 6, 7 A/A comparisons");
  });
});

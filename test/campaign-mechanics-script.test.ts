// Check ending history, preceding moves and current stopping conditions using in-memory logs.
import { describe, expect, it } from "bun:test";
import { campaignEnding, endingLines } from "#skills/campaign-mechanics/scripts/ending.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";

const OPENED: JsonObject = {
  project: "p",
  budget: { dollars: 100, reserve: 10 },
  limit: null,
  sessions: 2,
  patience: 6,
  led: true,
};

/** A log under construction: each call appends one event. */
function logOf() {
  const events: LogEvent[] = [];
  const add = (kind: EventKind, data: JsonObject) => {
    events.push({ at: `2026-10-30T00:00:${String(events.length).padStart(2, "0")}.000Z`, kind, data });
    return api;
  };
  const api = {
    events,
    add,
    move: (move: string, code: string, session?: string) =>
      add("campaign.move", { move, code, why: "w", ...keyIfDefined("session", session) }),
    /** A Builder session from start to its ending. */
    built: (session: string, ended: string) =>
      add("build.started", { session }).add("build.finished", { session, ended, changed: false }),
  };
  return api;
}

/** A campaign opened over a read checker, so the table's exam row passes and its bounds are asked. */
const opened = () => logOf().add("campaign.opened", OPENED).add("checker.read", { faults: [] });

describe("ending.ts", () => {
  it("groups moves by campaign ending and counts Builder departures separately", () => {
    const log = opened()
      .move("build", "led", "b-1")
      .built("b-1", "finished")
      .move("compare", "asked", "g-1")
      .add("campaign.ended", { ending: "finished", why: "three idle conversations" })
      .move("build", "led", "b-2")
      .built("b-2", "finished");
    const { endings, since } = campaignEnding(log.events);
    expect(endings).toHaveLength(1);
    expect(endings[0]?.ending).toBe("finished");
    expect(endings[0]?.moves).toStrictEqual({
      total: 2,
      asked: 1,
      counts: { "build·led": 1, "compare·asked": 1 },
    });
    expect(since.moves).toStrictEqual({ total: 1, asked: 0, counts: { "build·led": 1 } });
  });

  it("ends on three consecutive crashes and resets the count when a session holds a task", () => {
    const crashed = opened()
      .built("b-1", "crashed")
      .built("b-2", "crashed")
      .add("exam.finished", { session: "x-1", ended: "crashed", crash: "rate limited", held: [] });
    const standing = campaignEnding(crashed.events).standing;
    expect(standing.crashes).toStrictEqual({ count: 3, of: 3, last: "rate limited" });
    expect(standing.decided).toMatchObject({ move: "end", ending: "environment" });

    const held = opened()
      .built("b-1", "crashed")
      .built("b-2", "crashed")
      .add("exam.finished", { session: "x-1", ended: "crashed", crash: "rate limited", held: ["t-1"] });
    const moved = campaignEnding(held.events).standing;
    expect(moved.crashes.count).toBe(0);
    expect(moved.decided.move).not.toBe("end");
  });

  it("lists pending operator instructions until an event answers them", () => {
    const left = opened().add("campaign.word", { word: "stop", why: "enough" });
    const pending = campaignEnding(left.events).standing;
    expect(pending.words).toStrictEqual(["stop (enough)"]);
    expect(pending.decided).toMatchObject({ move: "end", ending: "operator" });

    const answered = left.add("campaign.ended", { ending: "operator", why: "w", answers: [2] });
    const heard = campaignEnding(answered.events);
    expect(heard.standing.words).toStrictEqual([]);
    expect(heard.since.events).toBe(0);
  });

  it("reports insufficient solve reserve and missing held-out tasks", () => {
    const spent = opened().add("solve.finished", { solve: "s-1", ending: { outcome: "pass" }, billed: 95 });
    const { standing } = campaignEnding(spent.events);
    expect(standing.left).toStrictEqual({ dollars: 5, reserve: 10 });
    expect(standing.refused).toContain("no-held");
    expect(standing.decided).toMatchObject({ move: "end", ending: "budget" });
    expect(endingLines(campaignEnding(spent.events)).some((line) => line.includes("$5.00"))).toBe(true);
  });

  it("counts empty Examiner sessions and resets supply patience after a held task", () => {
    const empty = (log: ReturnType<typeof opened>, session: string) =>
      log.add("exam.finished", { session, ended: "finished", held: [] });
    const run = opened();
    for (const session of ["x-1", "x-2", "x-3"]) empty(run, session);
    expect(campaignEnding(run.events).standing.supply).toStrictEqual({ count: 3, of: 6 });

    run.add("exam.finished", { session: "x-4", ended: "finished", held: ["t-1"] });
    empty(run, "x-5");
    expect(campaignEnding(run.events).standing.supply.count).toBe(1);
  });
});

// What a campaign runs by (`src/builder/opening.ts`): its opening as the log records it, and the
// plan move 7 reads beside the log.

import { describe, expect, it } from "bun:test";
import { openingOf, planOf } from "../src/builder/opening.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";

const at = "2026-10-09T00:00:00.000Z";
const event = (kind: EventKind, data: JsonObject): LogEvent => ({ at, kind, data });
const setting = (modelTurns: number) =>
  event("campaign.setting", { solver: null, minutes: 120, turns: 24, modelTurns, tasks: null, target: 12 });

describe("what a campaign runs by", () => {
  const opened = event("campaign.opened", {
    budget: { dollars: 400, reserve: 10 },
    limit: 40,
    sessions: 2,
    seats: { builder: { model: "claude/claude-opus-5-5", effort: "high" }, examiner: null, reviewer: null },
  });
  const billed = (dollars: number) => event("solve.finished", { solve: "s-1", billed: dollars });
  const ASKED = { unprepared: false, level: 0.1 };

  it("is its opening: the limit, the sessions, and what is left of its total", () => {
    expect(openingOf([])).toBeNull();
    expect(openingOf([opened])).toMatchObject({
      limit: 40,
      sessions: 2,
      seats: { examiner: null },
      prompt: null,
      solver: null,
    });
    // A campaign that opened from a prompt holds it, with who solves, and its plan says so.
    const asked = {
      ...opened.data,
      prompt: "Queues.",
      solver: { model: "claude/claude-sonnet-5-5", effort: "high" },
    };
    const prompted = event("campaign.opened", asked);
    expect(openingOf([prompted])).toMatchObject({ prompt: "Queues.", solver: asked.solver });
    expect(planOf([prompted], { ...ASKED, admits: ["check-a"] })).toMatchObject({
      prompted: true,
      admits: ["check-a"],
    });
    expect(planOf([opened, billed(31.5), billed(8.5)], ASKED)).toEqual({
      sessions: 2,
      patience: 6,
      unprepared: false,
      practice: null,
      wanted: { target: 24, level: 0.1 },
      pastStop: null,
      left: { dollars: 360, reserve: 10 },
      prompted: false,
      admits: [],
    });
  });

  it("is the defaults for a campaign opened before there was a record, and no total", () => {
    const plan = planOf([setting(15), setting(8)], {
      unprepared: true,
      level: 0.2,
      target: 9,
      pastStop: "why",
      practice: 3,
    });
    expect(plan).toEqual({
      sessions: 2,
      patience: 6,
      unprepared: true,
      practice: 3,
      // The setting on record names twelve tasks to score, which stands over the caller's nine.
      wanted: { target: 12, level: 0.2 },
      pastStop: "why",
      left: null,
      prompted: false,
      admits: [],
    });
    const old = setting(8);
    expect(planOf([{ ...old, data: { ...old.data, tasks: ["t-1"] } }], ASKED).wanted.target).toBe(12);
  });
});

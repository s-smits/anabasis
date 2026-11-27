// What a campaign runs by (`src/campaign/opening.ts`): its opening as the log records it, and the plan
// (`planOf`) read beside the log.

import { describe, expect, it } from "bun:test";
import { openingOf, planOf } from "../src/campaign/opening.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";

const at = "2026-10-09T00:00:00.000Z";
const event = (kind: EventKind, data: JsonObject): LogEvent => ({ at, kind, data });

describe("what a campaign runs by", () => {
  const opened = event("campaign.opened", {
    budget: { dollars: 400, reserve: 10 },
    limit: 40,
    sessions: 2,
    seats: { builder: { model: "claude/claude-opus-5-5", effort: "high" }, examiner: null, reviewer: null },
  });
  const billed = (dollars: number) => event("solve.finished", { solve: "s-1", billed: dollars });
  const ASKED = { unprepared: false, level: 0.1 };

  it("is its opening and what is left of its total, read past an older opening's limit and sessions", () => {
    expect(openingOf([])).toBeNull();
    const opening = openingOf([opened]);
    expect(opening).toMatchObject({ seats: { examiner: null }, prompt: null, solver: null });
    expect(opening).not.toHaveProperty("limit");
    expect(opening).not.toHaveProperty("sessions");
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
      patience: 6,
      unprepared: false,
      practice: null,
      wanted: { target: 24, level: 0.1, solves: 2 },
      pastStop: null,
      left: { dollars: 360, reserve: 10 },
      prompted: false,
      admits: [],
      promotions: null,
      canRevise: true,
    });
    expect(planOf([event("campaign.opened", { ...opened.data, revise: false })], ASKED).canRevise).toBe(
      false,
    );
  });

  it("reads a successor opening written before its parent carried every field, as tuned only after a tune", () => {
    const carriedAfter = (kind: string) =>
      openingOf([
        event("campaign.opened", {
          ...opened.data,
          parent: { campaign: "a", revised: "h", kind, carried: { spent: 2, attempts: 1, tunes: 1 } },
        }),
      ])?.parent?.carried;
    expect(carriedAfter("tune")).toEqual({
      spent: 2,
      sinceStep: 0,
      attempts: 1,
      tunes: 1,
      tunedThisEpoch: true,
    });
    expect(carriedAfter("repair")?.tunedThisEpoch).toBe(false);
  });

  it("plans the operator's cap of promotions as its opening keeps it, and none where lifted or unnamed", () => {
    const capped = (promotions: string) =>
      event("campaign.opened", { ...opened.data, terms: { promotions } });
    expect(planOf([capped("2")], ASKED).promotions).toBe(2);
    expect(planOf([capped("none")], ASKED).promotions).toBeNull();
    expect(planOf([opened], ASKED).promotions).toBeNull();
  });

  it("keeps authored checks manual under attended mode even when judging is admitted", () => {
    const rows = [
      { id: "c-author", instrument: "author" },
      { id: "j-rubric", instrument: "judge" },
    ];
    const readEvent = event("checker.read", { rows, admitted: [] });
    const withFlags = (attended: boolean, judged: boolean) =>
      planOf([event("campaign.opened", { ...opened.data, attended, judged }), readEvent], ASKED).admits;
    expect(withFlags(false, false)).toEqual(["c-author"]);
    expect(withFlags(false, true)).toEqual(["c-author", "j-rubric"]);
    expect(withFlags(true, false)).toEqual([]);
    expect(withFlags(true, true)).toEqual(["j-rubric"]);
  });
});

/**
 * What the page computes before it draws, read without a browser: the address a route is written
 * as and read back from (`route.ts`), the values a pane formats (`format.ts`) and what the Campaign
 * pane reads off a comparison (`campaign-data.ts`). Each is held over a space of inputs rather than
 * one example. What a person can do with the drawn page is `browser-smoke.test.ts`.
 */
import { describe, expect, test } from "bun:test";
import { keyIfDefined } from "../../../src/meta/optional-key.ts";
import type { ComparisonBar, Outcomes } from "../src/models.ts";
import { changedRoute, PANES, type Route, type RouteChange, routeOf, searchOf } from "../src/route.ts";
import {
  carriedText,
  comparisonSlots,
  countTicks,
  digestText,
  leftOutText,
  outcomeTotals,
  pText,
  STARTER_NAME,
  tallyText,
} from "../src/views/campaign-data.ts";
import { ago, bytes, duration, money, percent, seconds, standing, time } from "../src/views/format.ts";
import { OUTCOMES } from "../src/views/outcome.ts";

const NONE: Outcomes = { won: 0, lost: 0, tiedEvery: 0, tiedSome: 0, tiedNone: 0, aside: 0 };

const BARE: Route = {
  project: null,
  campaign: null,
  pane: "campaign",
  move: null,
  solve: null,
  task: null,
  harness: null,
  file: null,
  diff: null,
  event: null,
  token: null,
};

/** Every route over two values a key, one of them needing escapes, and every pane. */
function* routes(): Generator<Route> {
  const texts = [null, "a b&c=d/é"] as const;
  const places = [null, 0, 7] as const;
  for (const pane of PANES) {
    for (let bits = 0; bits < 1 << 8; bits += 1) {
      const text = (bit: number) => texts[(bits >> bit) & 1] ?? null;
      for (const [move, event] of places.flatMap((place) =>
        [null, 5].map((other) => [place, other] as const),
      )) {
        yield {
          project: text(0) === null ? null : "vowels",
          campaign: text(1),
          pane,
          move,
          solve: text(2),
          task: text(3),
          harness: text(4),
          file: text(5),
          diff: text(6),
          event,
          token: text(7),
        };
      }
    }
  }
}

describe("the address of a route", () => {
  test("reads back every route it writes, the project dropped where a campaign names it, in one spelling", () => {
    let count = 0;
    for (const route of routes()) {
      const written = searchOf(route);
      const read = routeOf(written);
      expect(read).toEqual({ ...route, project: route.campaign === null ? route.project : null });
      expect(searchOf(read)).toBe(written);
      expect(written.includes("pane=campaign")).toBe(false);
      count += 1;
    }
    expect(count).toBe(PANES.length * 256 * 3 * 2);
    expect(searchOf(BARE)).toBe("");
  });

  test("reads an unknown pane as the Campaign pane, and a move or event that is no place in a log as none", () => {
    for (const pane of ["", "Moves", "harness", "campaign"]) {
      expect(routeOf(`?pane=${pane}`).pane).toBe("campaign");
    }
    for (const place of ["", "-1", "1.5", "x", "1e400", String(2 ** 53)]) {
      expect(routeOf(`?move=${place}&event=${place}`)).toMatchObject({ move: null, event: null });
    }
    expect(routeOf("?move=0&event=12")).toMatchObject({ move: 0, event: 12 });
  });

  test("clears on a change what the project, campaign or pane it moves held, and keeps what the change names", () => {
    const inCampaign = new Set<keyof Route>(["move", "solve", "task", "harness", "file", "diff", "event"]);
    const inPane = new Set<keyof Route>(["move", "solve", "task", "file", "diff", "event"]);
    const full: Route = {
      project: "vowels",
      campaign: "c1",
      pane: "moves",
      move: 3,
      solve: "s",
      task: "t",
      harness: "h",
      file: "f",
      diff: "d",
      event: 4,
      token: "k",
    };
    const keys: readonly (keyof Route)[] = [...inCampaign, "project", "campaign", "pane", "token"];
    const changes: RouteChange[] = [undefined, "vowels", "units", null].flatMap((project) =>
      [undefined, "c1", "c2", null].flatMap((campaign) =>
        ([undefined, "moves", "tasks"] as const).flatMap((pane) =>
          [undefined, 9].map((move) => ({
            ...keyIfDefined("project", project),
            ...keyIfDefined("campaign", campaign),
            ...keyIfDefined("pane", pane),
            ...keyIfDefined("move", move),
          })),
        ),
      ),
    );
    expect(changes).toHaveLength(96);
    for (const change of changes) {
      const after = changedRoute(full, change);
      const projectMoved = "project" in change && change.project !== full.project;
      const campaignMoved = "campaign" in change ? change.campaign !== full.campaign : projectMoved;
      const paneMoved = "pane" in change && change.pane !== full.pane;
      for (const key of keys) {
        const cleared =
          (key === "campaign" && projectMoved) ||
          (campaignMoved && inCampaign.has(key)) ||
          (paneMoved && inPane.has(key));
        const expected = key in change ? change[key] : cleared ? null : full[key];
        expect([JSON.stringify(change), key, after[key]]).toEqual([JSON.stringify(change), key, expected]);
      }
    }
    // The shell writing back the project of a link that named a campaign alone moves nothing in it.
    expect(changedRoute({ ...full, project: null }, { project: "vowels", campaign: "c1" })).toEqual(full);
  });
});

describe("a formatted value", () => {
  test("says a value the log does not hold is not recorded, and a measured zero as zero", () => {
    const rows: [string, string][] = [
      [money(null), "not recorded"],
      [money(0), "$0.00"],
      [money(12.345), "$12.35"],
      [seconds(null), "not recorded"],
      [seconds(0), "0 s"],
      [seconds(59.4), "59 s"],
      [seconds(60), "1 min"],
      [seconds(3599), "1 h"],
      [seconds(5400), "1 h 30 min"],
      [seconds(7200), "2 h"],
      [bytes(999), "999 B"],
      [bytes(1000), "1.0 kB"],
      [bytes(2_500_000), "2.5 MB"],
      [percent(null), "not recorded"],
      [percent(0), "0.0%"],
      [percent(0.004), "0.4%"],
      [percent(0.1), "10%"],
      [percent(0.456), "46%"],
      [duration("2026-11-01T00:00:00Z", null), "no end"],
      [duration("2026-11-01T00:00:00Z", "2026-11-01T00:01:30Z"), "2 min"],
      [ago(null, 0), "not recorded"],
      [ago("not a date", 0), "not a date"],
      [ago("2026-11-01T00:01:00Z", Date.parse("2026-11-01T00:00:00Z")), "0 s ago"],
      [ago("2026-11-01T00:00:00Z", Date.parse("2026-11-01T02:00:00Z")), "2 h ago"],
      [time(null), "not recorded"],
      [time("not a date"), "not a date"],
    ];
    for (const [said, expected] of rows) expect(said).toBe(expected);
    expect(time("2026-11-01T00:00:00Z")).not.toContain("2026-11-01T");
  });

  test("states a campaign as ended with its ending, running, or open with when it last wrote", () => {
    const now = Date.parse("2026-11-01T01:00:00Z");
    const ending = { ending: "budget" } as const;
    expect(standing({ status: "running", ending, lastEventAt: null }, now)).toBe("ended: budget");
    expect(standing({ status: "running", ending: null, lastEventAt: null }, now)).toBe("running");
    expect(standing({ status: "open", ending: null, lastEventAt: "2026-11-01T00:30:00Z" }, now)).toBe(
      "open, wrote 30 min ago",
    );
  });
});

function bar(id: string, setting: string | null, tasks: number, outcomes: Outcomes | null): ComparisonBar {
  return {
    id,
    move: 0,
    old: "o",
    fresh: "f",
    kind: "candidate",
    repeats: null,
    setting,
    level: 0.05,
    tasks,
    tally: null,
    reading: null,
    p: null,
    outcomes,
    leftOut: null,
    valid: null,
    noise: null,
    carried: null,
    rulings: { withheld: true, ruled: 0 },
    load: null,
    sets: null,
    named: null,
    cut: false,
    begun: 0,
    solved: 0,
    between: { examiner: [], builder: [] },
  };
}

describe("what the Campaign pane reads off its comparisons", () => {
  test("draws a column a comparison at its outcomes, an open one at its tasks, and a break where the setting moves", () => {
    const counted = { ...NONE, won: 3, tiedNone: 2, aside: 1 };
    const bars = [bar("b-1", "s1", 9, counted), bar("b-2", "s1", 4, null), bar("b-3", "s2", 5, NONE)];
    const slots = comparisonSlots(bars);
    expect(
      slots.map((slot) => (slot.kind === "bar" ? [slot.key, slot.height, slot.values] : slot.key)),
    ).toEqual([
      ["b-1", 6, { won: 3, tiedNone: 2, aside: 1 }],
      ["b-2", 4, { open: 4 }],
      "setting-b-3",
      ["b-3", 0, {}],
    ]);
    expect(outcomeTotals(bars)).toEqual(counted);
    expect(OUTCOMES.map(({ outcome }) => outcome).toSorted()).toEqual(Object.keys(NONE).toSorted());
  });

  test("ticks a count axis from nought at one even step to at or above its top, in two to six ticks", () => {
    for (let top = 0; top <= 1000; top += 1) {
      const ticks = countTicks(top);
      const step = ticks[1] ?? 0;
      expect(ticks[0]).toBe(0);
      expect(ticks.every((tick, at) => tick === at * step)).toBe(true);
      expect(ticks.at(-1) ?? 0).toBeGreaterThanOrEqual(Math.max(top, 1));
      expect(ticks.length).toBeGreaterThanOrEqual(2);
      expect(ticks.length).toBeLessThanOrEqual(6);
    }
  });

  test("names tallies, tests, carried measures, left-out tasks and harnesses in their one spelling", () => {
    const rows: [string, string][] = [
      [tallyText(null), "no tally"],
      [tallyText({ wins: 4, losses: 0, ties: 3 }), "4–0–3"],
      [pText(null), "no test"],
      [pText(0.0156), "p 0.016"],
      [carriedText({ validity: 0, objective: 0 }), "none"],
      [carriedText({ validity: 4, objective: 22 }), "validity 4, objective 22"],
      [carriedText({ validity: 0, objective: 2 }), "objective 2"],
      [leftOutText({ leftOut: null }), ""],
      [leftOutText({ leftOut: { disputed: 0, short: 0, withdrawn: 0 } }), ""],
      [
        leftOutText({ leftOut: { disputed: 1, short: 2, withdrawn: 3 } }),
        "1 disputed, 2 short of its solves, 3 withdrawn while it ran",
      ],
      [digestText(null, {}), STARTER_NAME],
      [digestText("0123456789abcdef", { "0123456789abcdef": "A" }), STARTER_NAME],
      [digestText("0123456789abcdef", { "0123456789abcdef": "B" }), "B (01234567)"],
      [digestText("0123456789abcdef", {}), "01234567"],
    ];
    for (const [said, expected] of rows) expect(said).toBe(expected);
  });
});

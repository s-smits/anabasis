// What `runs active` prints: each login's live runs across machines, the runs that name no login,
// and the hosts that went uncounted.
import { describe, expect, it } from "bun:test";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { liveOf, seatsIn } from "../tools/runs/live.ts";
import { activeLines, capOf, carried, fitOf, perRunHour, perRunRate } from "../tools/runs/logins.ts";

const live = [
  { name: "a", login: "2", host: "here" },
  { name: "b", login: "2", host: "m1" },
  { name: "c", login: "5", host: "here" },
  { name: "d", login: null, host: "linux" },
];

describe("each login's live runs", () => {
  it("counts a login's runs across machines, and names a login a run may take with none", () => {
    const lines = activeLines(live, ["2", "3"], []);
    expect(lines[0]).toContain("login 2");
    expect(lines[0]).toContain("2 live: a (here), b (m1)");
    expect(lines[1]).toContain("login 3");
    expect(lines[1]).toContain("none live");
  });

  it("keeps a login no run may take, and a run with no login, on lines of their own", () => {
    const lines = activeLines(live, ["2", "3"], []);
    expect(lines[2]).toContain("login 5");
    expect(lines[2]).toContain("1 live: c (here)");
    expect(lines[3]).toContain("no login");
    expect(lines[3]).toContain("1 live: d (linux)");
    expect(lines).toHaveLength(4);
  });

  it("says which hosts went uncounted", () => {
    expect(activeLines([], ["2"], ["linux"]).at(-1)).toContain("linux");
    expect(activeLines([], ["2"], [])).toHaveLength(1);
  });

  it("leaves a host uncounted whose answer is no list, as a tree before the verb answers", () => {
    expect(liveOf("m1", [])).toBeNull();
    expect(liveOf("m1", null)).toBeNull();
    expect(liveOf("m1", ["usage: bun run runs pulse|zip ..."])).toBeNull();
    expect(liveOf("m1", ["[]"])).toEqual([]);
    expect(liveOf("m1", ['[{"name":"a","login":"2","host":"here"}]'])).toEqual([
      { name: "a", login: "2", host: "m1" },
    ]);
  });
});

describe("capOf", () => {
  it("reads a login's own most before the one for every login", () => {
    const env = { ANA_LOGIN_RUNS: "2, 1:4" };
    expect(capOf(env, "1")).toBe("4");
    expect(capOf(env, "3")).toBe("2");
    expect(capOf({ ANA_LOGIN_RUNS: "1:4" }, "3")).toBeNull();
    expect(capOf({}, "2")).toBeNull();
  });
});

describe("seatsIn", () => {
  it("reads a seat's seed and login from its own flags, once a seed", () => {
    const seat =
      "bun .claude/skills/system-path-simulation/scripts/live-seat.ts start --tree /t --name sim-a --login 3 -- tools/d1b/examine.ts --login 9";
    const table = [
      seat,
      `zsh -c ${seat}`,
      "bun .claude/skills/system-path-simulation/scripts/live-seat.ts read --seat x",
      "bun tools/d1b/examine.ts --name sim-b",
    ];
    expect(seatsIn(table, "here")).toEqual([{ name: "sim-a", login: "3", host: "here" }]);
    expect(seatsIn([seat.replace(" --login 3", "")], "here")).toEqual([
      { name: "sim-a", login: null, host: "here" },
    ]);
  });
});

describe("how many runs a login's week carries", () => {
  const HOUR = 3_600_000;
  const reading = (hour: number, pct: number, runs?: number) => ({
    at: hour * HOUR,
    weeks: { "2": { pct, reset: 100 * HOUR } },
    ...keyIfDefined("runs", runs === undefined ? undefined : { "2": runs }),
  });

  it("measures a run's share of a week an hour from rises over the runs the earlier reading counted", () => {
    const history = [reading(0, 10, 2), reading(1, 12, 2), reading(2, 14, 2), reading(3, 16, 2)];
    expect(perRunRate(history)).toBe(1);
  });

  it("measures nothing from readings that counted no runs, too few run-hours, or a window that reset", () => {
    expect(perRunRate([reading(0, 10), reading(1, 12), reading(2, 14), reading(3, 16)])).toBeNull();
    expect(perRunRate([reading(0, 10, 2), reading(1, 12, 2)])).toBeNull();
    const reset = { at: 2 * HOUR, weeks: { "2": { pct: 0, reset: 268 * HOUR } }, runs: { "2": 2 } };
    expect(perRunRate([reading(0, 10, 2), reading(1, 12, 2), reset])).toBeNull();
  });

  it("fits as many runs as the week left carries to its reset, active 16 of 24 hours", () => {
    const now = 0;
    const active = perRunHour({ login: "2", pct: 0, reset: 0 }, 1, 1, now);
    expect(fitOf({ login: "3", pct: 92, reset: 42 * HOUR }, active, now)).toBe(0);
    expect(fitOf({ login: "2", pct: 33, reset: 9 * HOUR }, active, now)).toBe(11);
    expect(fitOf({ login: "2", pct: 33, reset: 9 * HOUR }, null, now)).toBeNull();
  });

  it("reads a week's own pace over its live runs until a rate is measured", () => {
    // 70% in the first 4 days, 3 days left: two runs need about 52%, one about 26%, of the 30% left.
    const week = { login: "2", pct: 70, reset: 72 * HOUR };
    const now = 0;
    expect(fitOf(week, perRunHour(week, 2, null, now), now)).toBe(1);
    expect(perRunHour(week, 0, null, now)).toBeNull();
    expect(perRunHour(week, 2, 1, now)).toBeCloseTo(16 / 24);
  });

  it("shows the lower of the cap and the fit, and marks more live runs than the week fits", () => {
    expect(carried(2, "2", 1)).toBe("2/1 active · oversubscribed");
    expect(carried(1, "2", 1)).toBe("1/1 active");
    expect(carried(1, "2", null)).toBe("1/2 active");
    expect(carried(1, "2", Number.POSITIVE_INFINITY)).toBe("1/2 active");
    expect(carried(0, null, null)).toBe("0 active");
  });
});

// What `runs active` prints: each login's live runs across machines, the runs that name no login,
// and the hosts that went uncounted.
import { describe, expect, it } from "bun:test";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { liveOf, seatsCodex, seatsIn } from "../tools/runs/live.ts";
import { activeLines, capOf, fitOf, perRunHour, perRunRate } from "../tools/runs/logins.ts";

describe("each login's live runs", () => {
  it("leaves a host uncounted whose answer is no list, as a tree before the verb answers", () => {
    for (const lines of [[], null, ["usage: bun run runs pulse|zip ..."]]) {
      expect(liveOf("m1", lines)).toBeNull();
    }
    expect(liveOf("m1", ["[]"])).toEqual([]);
    expect(liveOf("m1", ['[{"name":"a","login":"2","host":"here"}]'])).toEqual([
      { name: "a", login: "2", host: "m1" },
    ]);
  });
});

describe("each payer's cap", () => {
  it("prints each login's live runs out of its most, and the Codex login's most a machine", () => {
    const live = [
      { name: "a", login: "2", host: "here" },
      { name: "g", login: "codex", host: "m1" },
    ];
    const env = { ANA_LOGIN_RUNS: "2,1:4" };
    expect(activeLines(live, ["1", "2"], [], env)).toEqual([
      "login 1   0/4 live",
      "login 2   1/2 live: a (here)",
      "codex     1 live, at most 1 a machine: g (m1)",
    ]);
    expect(capOf(env, "codex")).toBe("1");
    expect(capOf({ ANA_LOGIN_RUNS: "codex:2" }, "codex")).toBe("2");
    expect(capOf({}, "2")).toBeNull();
  });

  it("names the Codex login the payer of a launch that seats an openai-codex model, and of no other", () => {
    expect(seatsCodex(["--solver", "openai-codex/gpt-6.1-sol", "--budget", "800"])).toBe(true);
    expect(seatsCodex(["--solver", "claude/claude-opus-5-5"])).toBe(false);
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

  it("measures a run's hourly share only across enough counted run-hours in one week", () => {
    const reset = { at: 2 * HOUR, weeks: { "2": { pct: 0, reset: 268 * HOUR } }, runs: { "2": 2 } };
    for (const [history, expected] of [
      [[reading(0, 10, 2), reading(1, 12, 2), reading(2, 14, 2), reading(3, 16, 2)], 1],
      [[reading(0, 10), reading(1, 12), reading(2, 14), reading(3, 16)], null],
      [[reading(0, 10, 2), reading(1, 12, 2)], null],
      [[reading(0, 10, 2), reading(1, 12, 2), reset], null],
    ] as const) {
      expect(perRunRate(history)).toBe(expected);
    }
  });

  it("fits as many runs as the week left carries for a run's 12 hours, or to a sooner reset, active 16 of 24 hours", () => {
    const now = 0;
    const active = perRunHour({ login: "2", pct: 0, reset: 0 }, 1, 1, now);
    // 8% left carries one run of 12 hours at 2/3% an hour, however far off the reset is.
    expect(fitOf({ login: "3", pct: 92, reset: 42 * HOUR }, active, now)).toBe(1);
    expect(fitOf({ login: "1", pct: 84, reset: 83 * HOUR }, active, now)).toBe(2);
    expect(fitOf({ login: "3", pct: 95, reset: 42 * HOUR }, active, now)).toBe(0);
    expect(fitOf({ login: "2", pct: 33, reset: 9 * HOUR }, active, now)).toBe(11);
    expect(fitOf({ login: "2", pct: 33, reset: 9 * HOUR }, null, now)).toBeNull();
  });

  it("reads a week's own pace over its live runs until a rate is measured", () => {
    // 70% in the first 4 days: shared over two runs, a run of 12 hours needs about 4.4% of the 30% left.
    const week = { login: "2", pct: 70, reset: 72 * HOUR };
    const now = 0;
    expect(fitOf(week, perRunHour(week, 2, null, now), now)).toBe(6);
    expect(perRunHour(week, 0, null, now)).toBeNull();
    expect(perRunHour(week, 2, 1, now)).toBeCloseTo(16 / 24);
  });
});

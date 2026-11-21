// A login reads open or closed from one reading. A picker rechecks once the reset or cache expiry
// arrives, and the next full `usage` overrules what was kept.
import { describe, expect, it } from "bun:test";
import { closedOf, notClosed, stateWords } from "../tools/runs/login-state.ts";
import type { Reading } from "../tools/runs/logins.ts";

const NOW = Date.parse("2026-11-05T21:00:00Z");
const HOUR = 3_600_000;
const WEEK_RESET = NOW + 34 * HOUR;
const FIVE_RESET = NOW + 3 * HOUR;
const iso = (at: number) => new Date(at).toISOString();

function reading(
  login: string,
  five: { pct: number | null; status?: string; reset?: number | null } = { pct: 10 },
  week: { pct: number | null; status?: string; reset?: number | null } = { pct: 10 },
): Reading {
  const window = ({ pct, status, reset }: typeof five, fallback: number) => ({
    pct,
    resetsAt: reset === null ? null : iso(reset ?? fallback),
    status: status ?? "allowed",
  });
  return {
    login,
    plain: false,
    via: "ratelimit-headers",
    fiveHour: window(five, FIVE_RESET),
    sevenDay: window(week, WEEK_RESET),
    notes: [],
  };
}

const clock = (at: number) => `clock ${String((at - NOW) / HOUR)}h`;

describe("a login's state, from one reading", () => {
  it("closes on a used-up or refused window, until that window's reset", () => {
    expect(closedOf(reading("2", { pct: 100 }))).toEqual({ until: FIVE_RESET });
    expect(closedOf(reading("3", { pct: null }, { pct: 40, status: "rejected" }))).toEqual({
      until: WEEK_RESET,
    });
  });

  it("calls a login that could not be read neither open nor closed", () => {
    const failed: Reading = { login: "4", plain: false, error: "403" };
    expect(closedOf(failed)).toBeNull();
    expect(stateWords(failed, ["4"], clock)).toBe("");
  });
});

describe("what a picker takes from the last reading kept", () => {
  const earlyReset = NOW + HOUR / 6;
  const closed = { at: NOW - HOUR / 2, weeks: {}, closed: { "3": WEEK_RESET, "2": earlyReset } };

  it("rechecks at the reset or after 45 minutes, leaving time for a keeper retry within the hour", () => {
    expect(notClosed(["2", "3"], [closed], earlyReset)).toEqual(["2"]);
    const expiry = closed.at + (3 * HOUR) / 4;
    expect(notClosed(["3"], [closed], expiry - 1)).toEqual([]);
    expect(notClosed(["2", "3"], [closed], expiry)).toEqual(["2", "3"]);
  });
});

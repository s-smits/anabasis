// A login reads open or closed from one reading; a closed one opens by the clock at its reset, the
// next full `usage` overrules what was kept, and a picker asks the provider only of the rest.
import { describe, expect, it } from "bun:test";
import { closedOf, closedResets, listedBy, notClosed, stateWords } from "../tools/runs/login-state.ts";
import type { Reading } from "../tools/runs/logins.ts";
import { room } from "../tools/runs/logins.ts";
import { roomFor } from "../tools/runs/keep.ts";

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
  it("reads a login with both windows allowed as open", () => {
    expect(closedOf(reading("2"))).toBeNull();
    expect(closedOf(reading("2", { pct: 99, status: "allowed_warning" }))).toBeNull();
  });

  it("closes on a used-up or refused window, until that window's reset", () => {
    expect(closedOf(reading("2", { pct: 100 }))).toEqual({ until: FIVE_RESET });
    expect(closedOf(reading("3", { pct: null }, { pct: 40, status: "rejected" }))).toEqual({
      until: WEEK_RESET,
    });
  });

  it("takes the later reset where both windows are closed", () => {
    expect(closedOf(reading("3", { pct: 100 }, { pct: 100 }))).toEqual({ until: WEEK_RESET });
  });

  it("keeps a closed window with no reset closed, with no time to open by", () => {
    expect(closedOf(reading("3", { pct: 100, reset: null }))).toEqual({ until: null });
  });

  it("calls a login that could not be read neither open nor closed", () => {
    const failed: Reading = { login: "4", plain: false, error: "403" };
    expect(closedOf(failed)).toBeNull();
    expect(stateWords(failed, ["4"], clock)).toBe("");
  });

  it("says open, closed until its reset, and that a login is out of the pool", () => {
    expect(stateWords(reading("2"), ["2"], clock)).toBe(" · open");
    expect(stateWords(reading("3", { pct: 100 }), ["3"], clock)).toBe(" · closed until clock 3h");
    expect(stateWords(reading("3", { pct: 100, reset: null }), ["3"], clock)).toBe(" · closed");
    expect(stateWords(reading("1"), ["2", "3"], clock)).toBe(" · open · not in the pool");
  });
});

describe("what usage lists and keeps", () => {
  const open = reading("2");
  const closed = reading("3", { pct: 100 });
  const noReset = reading("6", { pct: 100, reset: null });
  const failed: Reading = { login: "4", plain: false, error: "403" };
  const all = [open, closed, noReset, failed];
  const names = (flags: { open: boolean; closed: boolean }) => listedBy(all, flags).map(({ login }) => login);

  it("lists every login with no filter, one that could not be read included", () => {
    expect(names({ open: false, closed: false })).toEqual(["2", "3", "6", "4"]);
  });

  it("lists only the open or the closed under a filter, and a failed read under neither", () => {
    expect(names({ open: true, closed: false })).toEqual(["2"]);
    expect(names({ open: false, closed: true })).toEqual(["3", "6"]);
    expect(names({ open: true, closed: true })).toEqual(["2", "3", "6"]);
  });

  it("keeps a closed login only where it has a reset, so one with none is read again", () => {
    expect(closedResets(all)).toEqual({ "3": FIVE_RESET });
  });
});

describe("what a picker takes from the last reading kept", () => {
  const closed = { at: NOW - HOUR, weeks: {}, closed: { "3": WEEK_RESET, "2": FIVE_RESET } };

  it("leaves a login out until its reset", () => {
    expect(notClosed(["2", "3", "4"], [closed], NOW)).toEqual(["4"]);
  });

  it("opens a login once its reset has passed, with nothing written", () => {
    expect(notClosed(["2", "3"], [closed], FIVE_RESET)).toEqual(["2"]);
    expect(notClosed(["2", "3"], [closed], WEEK_RESET + 1)).toEqual(["2", "3"]);
  });

  it("lets a later reading overrule a closed login, as after credit added early", () => {
    expect(notClosed(["3"], [closed, { at: NOW - 60_000, weeks: {} }], NOW)).toEqual(["3"]);
    expect(notClosed(["3"], [{ at: NOW - 60_000, weeks: {} }, closed], NOW)).toEqual(["3"]);
  });

  it("asks of every login where nothing is kept, as on a host that never read usage", () => {
    expect(notClosed(["2", "3"], [], NOW)).toEqual(["2", "3"]);
  });
});

describe("a keeper with a login kept closed", () => {
  it("moves to the open one without asking the provider of the closed one", async () => {
    const asked: string[] = [];
    const kept = [{ at: NOW - HOUR, weeks: {}, closed: { "3": WEEK_RESET } }];
    const found = await roomFor(
      ["3", "4"],
      new Set(),
      { live: [], unasked: [] },
      (wanted) => {
        const open = notClosed(wanted, kept, NOW);
        asked.push(...open);
        return Promise.resolve(open.map((login) => reading(login)));
      },
      { env: {}, now: NOW },
    );
    expect(asked).toEqual(["4"]);
    expect(found.logins).toEqual(["4"]);
  });

  it("still refuses a login a fresh reading finds used up, whatever was kept", () => {
    expect(room([reading("4", { pct: 100 }), reading("2")], ["2", "4"], new Set())).toEqual(["2"]);
  });
});

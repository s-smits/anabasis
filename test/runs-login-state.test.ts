// A login reads open or closed from one reading. A picker rechecks once the reset or cache expiry
// arrives, and any later reading of the login overrules what was kept.
import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { closedOf, closures, notClosed, noted, noteReadings, stateWords } from "../tools/runs/login-state.ts";
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

describe("what a picker takes from the closures kept", () => {
  const earlyReset = NOW + HOUR / 6;
  const at = NOW - HOUR / 2;
  const kept = { "3": { at, until: WEEK_RESET }, "2": { at, until: earlyReset } };

  it("rechecks at the reset or after 45 minutes, leaving time for a keeper retry within the hour", () => {
    expect(notClosed(["2", "3"], kept, earlyReset)).toEqual(["2"]);
    const expiry = at + (3 * HOUR) / 4;
    expect(notClosed(["3"], kept, expiry - 1)).toEqual([]);
    expect(notClosed(["2", "3"], kept, expiry)).toEqual(["2", "3"]);
  });

  it("keeps a closure until a reading finds the login open, and an unread login as it was", () => {
    const failed: Reading = { login: "3", plain: false, error: "429" };
    expect(noted({}, [reading("2", { pct: 100 }), reading("3")], NOW)).toEqual({
      "2": { at: NOW, until: FIVE_RESET },
    });
    expect(noted(kept, [reading("2"), failed], NOW)).toEqual({ "3": kept["3"] });
    expect(noted(kept, [], WEEK_RESET)).toEqual({});
  });

  it("ignores corrupt or malformed cache files and round-trips valid closures", () => {
    const dir = mkdtempSync(join(tmpdir(), "ana-closures-"));
    const file = join(dir, "logins-closed.json");
    try {
      expect(closures(file)).toEqual({});
      for (const bad of ["", "{broken", "null", "[]", '"str"', "123"]) {
        writeFileSync(file, bad);
        expect(closures(file)).toEqual({});
      }
      writeFileSync(
        file,
        JSON.stringify({ "1": { at: NOW, until: FIVE_RESET }, "2": { at: "bad" }, "3": null }),
      );
      expect(closures(file)).toEqual({ "1": { at: NOW, until: FIVE_RESET } });
      noteReadings([reading("2", { pct: 100 })], NOW, file);
      expect(closures(file)).toEqual({
        "1": { at: NOW, until: FIVE_RESET },
        "2": { at: NOW, until: FIVE_RESET },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

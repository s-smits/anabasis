// The forecast of `runs usage` (`tools/runs/usage-model.ts`): what it fits on, when it speaks, and
// that it learns when runs come and go, which the per-run rate, holding the runs live now, cannot.
import { describe, expect, it } from "bun:test";
import { modelLines, perRunRate } from "../tools/runs/logins.ts";
import { ahead, assess, type Snapshot, weekEnd } from "../tools/runs/usage-model.ts";

const HOUR = 3_600_000;
const BASE = Date.UTC(2026, 10, 1, 12);
/** The hour of `BASE`'s day at local hour `hour`, so a test reads the same in any time zone. */
const atLocal = (hour: number) => BASE + ((hour - new Date(BASE).getHours() + 24) % 24) * HOUR;
const atNight = (at: number) => new Date(at).getHours() >= 22 || new Date(at).getHours() < 6;

/** Hourly readings up to `now` over `days` of four logins with two runs each from 22:00 to 06:00
 *  and none by day, or as many as `runsAt` says, each run spending 0.15% of its week an hour, with a
 *  little noise, each login refilled at its own weekly reset and read in whole percents. `spendAt`
 *  says how many spend where that differs from the runs counted. */
function history(
  days: number,
  now: number,
  runsAt = (at: number) => (atNight(at) ? 2 : 0),
  spendAt = runsAt,
): Snapshot[] {
  const start = now - days * 24 * HOUR;
  const pct = { "1": 0, "2": 0, "3": 0, "4": 0 };
  const resets = { "1": 30, "2": 70, "3": 110, "4": 150 };
  let seed = 7;
  const draw = () => {
    seed = (seed * 16_807) % 2_147_483_647;
    return seed / 2_147_483_647;
  };
  const kept: Snapshot[] = [];
  for (let at = start; at <= now; at += HOUR) {
    const runs: Record<string, number> = {};
    const weeks: Snapshot["weeks"] = {};
    for (const login of ["1", "2", "3", "4"] as const) {
      if (at >= start + resets[login] * HOUR) {
        pct[login] = 0;
        resets[login] += 168;
      }
      runs[login] = runsAt(at);
      weeks[login] = { pct: Math.floor(pct[login]), reset: start + resets[login] * HOUR };
      pct[login] += 0.15 * spendAt(at) + draw() * 0.02;
    }
    kept.push({ at, weeks, runs });
  }
  return kept;
}

describe("the usage model", () => {
  it("speaks only where it beats both older paces on the hours held out, from a sparse record too", () => {
    const now = atLocal(21);
    expect(assess(history(7, now - 72 * HOUR), now, perRunRate)).toBeNull();
    expect(modelLines([], [], null, now, null)[0]).toContain("off");
    const sparse = assess(
      history(7, now).filter((_, at) => at % 3 === 0),
      now,
      perRunRate,
    );
    expect(sparse?.model).not.toBeNull();
    expect(sparse?.error).toBeLessThan(Math.min(sparse?.week ?? 0, sparse?.run ?? 0));
    // Over the hours held out the logins spend all day with no run counted, which no feature shows.
    const unseen = (at: number) => (now - at < 48 * HOUR ? 2 : atNight(at) ? 2 : 0);
    const blind = assess(
      history(7, now, (at) => (now - at < 48 * HOUR ? 0 : unseen(at)), unseen),
      now,
      perRunRate,
    );
    // It beats the per-run rate there, and the week pace alone keeps it silent.
    expect(blind?.error).toBeLessThan(blind?.run ?? 0);
    expect(blind?.model).toBeNull();
  });

  it("reads the same with a burst of readings minutes after each hourly one", () => {
    const now = atLocal(21);
    const kept = history(7, now);
    const burst = kept.flatMap((one) => [one, { ...one, at: one.at + 2 * 60_000 }]);
    // The per-run rate pairs neighbouring readings, so only the model's own reading is compared.
    const model = (read: ReturnType<typeof assess>) => read && { ...read, run: 0 };
    expect(model(assess(burst, now, perRunRate))).toEqual(model(assess(kept, now, perRunRate)));
  });

  it("forecasts the night's runs at 21:00 with none live, and their end at 05:00 with two live", () => {
    // What the generator spends over the first `hours` after `now`.
    const spent = (now: number, hours: number) =>
      0.3 * Array.from({ length: hours }, (_, at) => now + at * HOUR).filter(atNight).length;
    for (const hour of [21, 5]) {
      const now = atLocal(hour);
      const kept = history(7, now);
      const read = assess(kept, now, perRunRate);
      if (read?.model == null) {
        throw new Error(`the model did not speak at ${String(hour)}:00: ${JSON.stringify(read)}`);
      }
      expect(read.error).toBeLessThan(Math.min(read.week, read.run));
      for (const curve of Object.values(ahead(read.model, kept))) {
        for (const hours of [1, 3, 12, 24]) {
          expect(Math.abs((curve[hours - 1] ?? 0) - spent(now, hours))).toBeLessThan(0.8);
        }
      }
    }
  });

  it("fits on the last week where the runs moved from the day to the night ten days ago", () => {
    const now = atLocal(21);
    const moved = (at: number) => {
      const hour = new Date(at).getHours();
      if (now - at < 10 * 24 * HOUR) return atNight(at) ? 2 : 0;
      return hour >= 10 && hour < 18 ? 2 : 0;
    };
    const read = assess(history(28, now, moved), now, perRunRate);
    expect(read?.days).toBe(7);
  });

  it("scores the hours held out on logins with room, so a spent login pads no error", () => {
    const now = atLocal(21);
    const kept = history(7, now);
    const spent = kept.map((one) => ({
      ...one,
      weeks: { ...one.weeks, "1": { pct: 100, reset: now + 100 * HOUR } },
    }));
    const [open, some] = [assess(kept, now, perRunRate), assess(spent, now, perRunRate)];
    // Three logins of four are held out, and login 1's rows of no rise count for nothing.
    expect(some?.held).toBeLessThan(open?.held ?? 0);
    expect(some?.error).toBeGreaterThan(0);
    const none = kept.map((one) => ({
      ...one,
      weeks: Object.fromEntries(
        Object.keys(one.weeks).map((login) => [login, { pct: 100, reset: now + 100 * HOUR }]),
      ),
    }));
    expect(assess(none, now, perRunRate)).toBeNull();
  });

  it("learns that a login spends more while the others have no room", () => {
    const now = atLocal(21);
    const others = ["2", "3", "4"];
    // Each login holds one run throughout, and each spell is a window of its own for every login from
    // one share used, so only the logins with room tell the fast spells from the slow.
    const spellOf = (at: number) => Math.floor((now - at) / (48 * HOUR));
    const kept: Snapshot[] = [];
    for (let at = now - 168 * HOUR; at <= now; at += HOUR) {
      const spell = spellOf(at);
      const fast = spell % 2 === 0;
      const reset = now + (100 + 10 * spell) * HOUR;
      const hours = (at - (now - (spell + 1) * 48 * HOUR)) / HOUR;
      const theirs = { pct: fast ? 100 : 50, reset };
      kept.push({
        at,
        weeks: {
          ...Object.fromEntries(others.map((login) => [login, theirs])),
          "1": { pct: 20 + hours * (fast ? 0.6 : 0.1), reset },
        },
        runs: { "1": 1, "2": 0, "3": 0, "4": 0 },
      });
    }
    const read = assess(kept, now, () => 0);
    const last = kept.at(-1);
    if (read?.model == null || last === undefined) throw new Error("the model did not speak");
    const { model } = read;
    const rise = (theirPct: number) => {
      const week = (pct: number) => ({ pct, reset: now + 100 * HOUR });
      const others3 = Object.fromEntries(others.map((login) => [login, week(theirPct)]));
      return ahead(model, [{ ...last, weeks: { ...others3, "1": week(22) } }])["1"]?.[0] ?? 0;
    };
    expect(rise(100)).toBeGreaterThan(rise(50));
  });
});

describe("weekEnd", () => {
  const at = Date.UTC(2026, 10, 6, 12);
  const week = (pct: number, hours = 100) => ({ pct, reset: at + hours * HOUR });
  /** A curve that rises `perHour` an hour and stops at what `left` holds, as `ahead` reads one. */
  const curve = (perHour: number, left: number) =>
    Array.from({ length: 24 }, (_, hour) => Math.min(left, perHour * (hour + 1)));

  it("reads the hour within the day, and past it at the day's mean rate", () => {
    expect(weekEnd(curve(2, 10), week(90), at)).toBe(at + 5 * HOUR);
    expect(weekEnd(curve(1, 48), week(52), at)).toBe(at + 48 * HOUR);
  });

  it("names no end at or after the reset, none for a spent week and none with no rise", () => {
    expect(weekEnd(curve(2, 10), week(90, 5), at)).toBeNull();
    expect(weekEnd(curve(2, 10), week(90, 4), at)).toBeNull();
    expect(weekEnd(curve(2, 0), week(100), at)).toBeNull();
    expect(weekEnd(curve(0, 50), week(50), at)).toBeNull();
  });

  it("takes the sooner of the curve and the live runs kept going, whichever way they differ", () => {
    expect(weekEnd(curve(0.5, 10), week(90), at, 2)).toBe(at + 5 * HOUR);
    expect(weekEnd(curve(2, 10), week(90), at, 0.5)).toBe(at + 5 * HOUR);
    expect(weekEnd(curve(0, 96), week(4, 200), at, 2)).toBe(at + 48 * HOUR);
  });
});

describe("the model's lines", () => {
  it("names the end, and says where the live runs kept going decide it", () => {
    // At 05:00 the last reading counts two live runs on each login.
    const now = atLocal(5);
    const kept = history(7, now);
    const read = assess(kept, now, perRunRate);
    const last = kept.at(-1);
    if (read?.model == null || last === undefined) throw new Error("the model did not speak");
    const weeks = Object.entries(last.weeks).map(([login, { reset }]) => ({ login, pct: 99, reset }));
    const trees = modelLines(weeks, kept, read, now, 0).join("\n");
    expect(trees).toContain("week out ~");
    expect(trees).not.toContain("if its runs keep going");
    const onlyRuns = weeks.map((week) => ({ ...week, pct: 50 }));
    const held = modelLines(onlyRuns, kept, read, now, 100).join("\n");
    expect(held).toContain("if its runs keep going");
    // At a reading that counts no run, no rate makes a run of them.
    const idle = kept.map((one) => ({ ...one, runs: { "1": 0, "2": 0, "3": 0, "4": 0 } }));
    expect(modelLines(onlyRuns, idle, read, now, 100).join("\n")).not.toContain("if its runs keep going");
  });
});

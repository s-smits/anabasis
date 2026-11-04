// The forecast of `runs usage` (`tools/runs/usage-model.ts`): what it fits on, when it speaks, and
// that it learns when runs come and go, which the per-run rate, holding the runs live now, cannot.
import { describe, expect, it } from "bun:test";
import { modelLines, perRunRate } from "../tools/runs/logins.ts";
import { ahead, assess, type Snapshot } from "../tools/runs/usage-model.ts";

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
    expect(modelLines([], [], null, now)[0]).toContain("off");
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
});

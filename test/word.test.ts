// Each kind of operator word has one lifetime, owned by `src/campaign/word.ts`: a stop, other tasks
// and a total are pending until the event that acts on one names it, and a pause holds for its wait
// and is answered by nothing, so `pendingWords` lists no pause and no retired `cause` word left
// as pending, and the host does not spell the pause's wait out for itself.
import { describe, expect, it } from "bun:test";
import {
  ANSWERED,
  PAUSE,
  PAUSE_STOP_WINDOW_MS,
  pauseSince,
  pauseWaitMs,
  paused,
  pendingWords,
} from "../src/campaign/word.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";

const START = Date.parse("2026-11-09T00:00:00.000Z");
const event = (kind: LogEvent["kind"], data: JsonObject, ms = 0): LogEvent => ({
  at: new Date(START + ms).toISOString(),
  kind,
  data,
});
const word = (data: JsonObject, ms = 0) => event("campaign.word", data, ms);

describe("an operator's word", () => {
  it("is pending until the event that acts on it names it, for a stop, other tasks and a total", () => {
    const left = [
      event("campaign.opened", {}),
      word({ word: "stop", why: "enough" }),
      word({ word: "tasks" }),
      word({ word: "budget", dollars: 50 }),
    ];
    expect(pendingWords(left)).toEqual([
      { at: 1, word: "stop", why: "enough", dollars: null },
      { at: 2, word: "tasks", why: "", dollars: null },
      { at: 3, word: "budget", why: "", dollars: 50 },
    ]);
    const answered = [
      ...left,
      event("campaign.move", { move: "examine", answers: [2] }),
      event("campaign.opened", { answers: [3] }),
    ];
    expect(pendingWords(answered).map(({ word: kind }) => kind)).toEqual(["stop"]);
    expect(pendingWords([...answered, event("campaign.ended", { answers: [1] })])).toEqual([]);
  });

  it("is never pending as a pause or as a word no move reads, however long ago it was left", () => {
    // An older log holds `cause`, a kind no writer leaves now: it stays readable, and the words
    // around it are read as ever.
    const left = [
      event("campaign.opened", {}),
      word({ word: "pause" }),
      word({ word: "cause", why: "x" }),
      word({ word: 7 }),
      word({ word: "stop" }),
    ];
    expect(pendingWords(left).map(({ at, word: kind }) => [at, kind])).toEqual([[4, "stop"]]);
    expect(ANSWERED).not.toContain(PAUSE);
  });

  it("holds the solves as a pause for its wait and a minute, from the process it was left for on", () => {
    const minutes = 30 * 60;
    const held = START + pauseWaitMs(minutes) + 60_000;
    const left = [event("campaign.opened", {}), word({ word: "pause" })];
    expect(paused(left, 0, START, minutes)).toBe(true);
    expect(paused(left, 0, held - 1, minutes)).toBe(true);
    expect(paused(left, 0, held, minutes)).toBe(false);
    // A pause left before this process began was for the one it stopped.
    expect(paused(left, 2, START, minutes)).toBe(false);
    expect(paused([event("campaign.opened", {}), word({ word: "stop" })], 0, START, minutes)).toBe(false);
  });

  it("activates an armed boundary pause only after its report and starter confirmation land, holding 9s later without deadlocking", () => {
    const minutes = 30 * 60;
    const armed = [
      event("campaign.opened", {}),
      event("comparison.started", { session: "g-1", starter: "s" }),
      event("comparison.reported", { session: "g-1", old: "s", fresh: "h1", reading: "step" }),
      event("harness.promoted", { harness: "h1" }),
      word({ word: PAUSE, why: "runs pause --after reported", after: "reported", base: 1 }, 1000),
    ];
    // Before the starter comparison reports, the armed pause neither holds solves nor marks a dead run paused.
    expect(pauseSince(armed, 0)).toBeUndefined();
    expect(paused(armed, 0, START + 2000, minutes)).toBe(false);
    // Once a non-starter comparison reports while the promotion is still unread against starter, still inactive.
    const unread = [
      ...armed,
      event("comparison.started", { session: "g-2", starter: "s" }, 5000),
      event("comparison.reported", { session: "g-2", old: "h1", fresh: "h2", reading: "no-step" }, 6000),
    ];
    expect(pauseSince(unread, 0)).toBeUndefined();
    expect(paused(unread, 0, START + 7000, minutes)).toBe(false);
    // Once the starter comparison reports at +10s, a compare arriving 9s later (+19s) is held; after the stop window it expires.
    const reached = [
      ...unread,
      event("comparison.started", { session: "g-3", starter: "s" }, 8000),
      event(
        "comparison.reported",
        { session: "g-3", old: "h1", fresh: "s", reading: "no-step", scored: { differences: [-1, 0] } },
        10_000,
      ),
    ];
    expect(pauseSince(reached, 0)?.data.after).toBe("reported");
    expect(paused(reached, 0, START + 19_000, minutes)).toBe(true);
    expect(paused(reached, 0, START + 10_000 + PAUSE_STOP_WINDOW_MS - 1, minutes)).toBe(true);
    expect(paused(reached, 0, START + 10_000 + PAUSE_STOP_WINDOW_MS, minutes)).toBe(false);
  });
});

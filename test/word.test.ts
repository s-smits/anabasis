// Each kind of operator word has one lifetime, owned by `src/campaign/word.ts`: a stop, other tasks
// and a total are pending until the event that acts on one names it, and a pause holds for its wait
// and is answered by nothing, so `pendingWords` lists no pause and no retired `cause` word left
// as pending, and the host does not spell the pause's wait out for itself.
import { describe, expect, it } from "bun:test";
import {
  ANSWERED,
  PAUSE,
  PAUSE_STOP_WINDOW_MS,
  pausePointReached,
  pauseSince,
  pauseWaitMs,
  paused,
  pendingWords,
  unpromotedStep,
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
    // An older log holds `cause`, a kind no writer leaves now: it stays readable, and the words around
    // it read as ever.
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

  it("holds across unpromoted steps, latches pre-promotion arming onto starter confirmation, and expires abandoned pauses in pauseSince", () => {
    const minutes = 30 * 60;
    const preArmed = [
      event("campaign.opened", {}, 0),
      word({ word: PAUSE, why: "runs pause --after reported", after: "reported", base: 0 }, 1000),
      event("comparison.started", { session: "g-1", starter: "s" }, 2000),
      event("comparison.reported", { session: "g-1", old: "s", fresh: "h1", reading: "step" }, 300_000),
    ];
    // Right after `comparison.reported` reads `step`, `unpromotedStep` prevents pausing before `harness.promoted`.
    expect(unpromotedStep(preArmed)).toBe(true);
    expect(pausePointReached(preArmed, "reported", 0)).toBe(false);
    expect(paused(preArmed, 0, START + 301_000, minutes)).toBe(false);

    // After promotion and starter confirmation 20 minutes later, the window starts at starter confirmation (1_500_000), not g-1 (300_000).
    const confirmed = [
      ...preArmed,
      event("harness.promoted", { harness: "h1" }, 301_000),
      event("comparison.started", { session: "g-2", starter: "s" }, 400_000),
      event(
        "comparison.reported",
        { session: "g-2", old: "h1", fresh: "s", reading: "no-step", scored: { differences: [-1, 0] } },
        1_500_000,
      ),
    ];
    expect(unpromotedStep(confirmed)).toBe(false);
    expect(pausePointReached(confirmed, "reported", 0)).toBe(true);
    expect(paused(confirmed, 0, START + 1_510_000, minutes)).toBe(true);
    expect(paused(confirmed, 0, START + 1_500_000 + PAUSE_STOP_WINDOW_MS - 1, minutes)).toBe(true);
    expect(paused(confirmed, 0, START + 1_500_000 + PAUSE_STOP_WINDOW_MS, minutes)).toBe(false);
    expect(pauseSince(confirmed, 0)?.data.after).toBe("reported");

    // If `runs pause` died and events kept landing past the stop window, `pauseSince` stops claiming intentional pause.
    const abandoned = [
      ...confirmed,
      event("build.call", { session: "b-2" }, 1_500_000 + PAUSE_STOP_WINDOW_MS),
    ];
    expect(pauseSince(abandoned, 0)).toBeUndefined();
  });
});

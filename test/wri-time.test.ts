// Hours less what an overloaded host cost: one weight a stretch after each recorded load, never
// counted inside a wait or past the sample's reach.
import { expect, test } from "bun:test";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import { overloadOf, waitedMs, waitsOf } from "../tools/wri/time.ts";

const T0 = Date.parse("2026-10-30T00:00:00.000Z");
const MIN = 60_000;
const at = (minutes: number) => new Date(T0 + minutes * MIN).toISOString();
const event = (minutes: number, kind: EventKind, data: LogEvent["data"]): LogEvent => ({
  at: at(minutes),
  kind,
  data,
});

test("a load of twice the cores costs half of the stretch it stands for", () => {
  const events = [
    event(0, "solve.started", { load: [8, 8, 8], cores: 4 }),
    event(10, "solve.finished", { load: [4, 4, 4] }),
    event(20, "campaign.ended", {}),
  ];
  // Ten minutes at half, then ten at a load equal to the cores, which costs nothing.
  expect(overloadOf(events)(T0, T0 + 20 * MIN)).toBe(5 * MIN);
  expect(overloadOf(events)(T0 + 5 * MIN, T0 + 20 * MIN)).toBe(2.5 * MIN);
});

test("a sample stands for at most fifteen minutes, and a load under the cores costs nothing", () => {
  const long = [event(0, "solve.started", { load: [8, 8, 8], cores: 4 }), event(60, "campaign.ended", {})];
  expect(overloadOf(long)(T0, T0 + 60 * MIN)).toBe(7.5 * MIN);
  const quiet = [event(0, "solve.started", { load: [2, 2, 2], cores: 4 }), event(10, "campaign.ended", {})];
  expect(overloadOf(quiet)(T0, T0 + 10 * MIN)).toBe(0);
});

test("time inside a recorded wait is already taken out and is not counted again", () => {
  const events = [
    event(0, "solve.started", { load: [8, 8, 8], cores: 4 }),
    // The solve queue writes its wait when it ends: four minutes, from minute two to six.
    event(6, "campaign.waited", { load: 8, cores: 4, ms: 4 * MIN }),
    event(10, "campaign.ended", {}),
  ];
  const waits = waitsOf(events);
  expect(waitedMs(waits, T0, T0 + 10 * MIN)).toBe(4 * MIN);
  // Six minutes outside the wait at half the stretch.
  expect(overloadOf(events)(T0, T0 + 10 * MIN)).toBe(3 * MIN);
});

test("a load with no cores on record yet is no sample", () => {
  const events = [event(0, "solve.finished", { load: [8, 8, 8] }), event(10, "campaign.ended", {})];
  expect(overloadOf(events)(T0, T0 + 10 * MIN)).toBe(0);
});

test("a provider's wait ends at its reset, an ending or the next session start, whichever comes first", () => {
  // buffer-506, 29 October: a reset 39 hours off was waited out under another login, which
  // writes no ending; its next session started four and a half hours on.
  const reset = (minutes: number) => event(minutes, "campaign.waited", { for: "provider", ms: 600 * MIN });
  const moved = [reset(0), event(270, "build.started", {}), event(400, "solve.finished", {})];
  expect(waitsOf(moved)).toEqual([{ from: T0, until: T0 + 270 * MIN, kind: "provider" }]);
  expect(waitsOf([reset(0), event(30, "campaign.ended", {})])[0]?.until).toBe(T0 + 30 * MIN);
  // A solve finishing beside the wait is no new start, and the reset bounds the rest.
  expect(waitsOf([reset(0), event(5, "solve.finished", {}), event(700, "solve.started", {})])[0]?.until).toBe(
    T0 + 600 * MIN,
  );
});

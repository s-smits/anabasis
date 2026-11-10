// Lane 7's count of released tasks a later comparison scored (`SCORED AFTER RELEASE`, `folds.ts`).
// Invented logs only.
import { describe, expect, it } from "bun:test";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { indexOf, taskTriggers } from "../tools/wri/folds.ts";

const event = (kind: EventKind, data: JsonObject): LogEvent => ({
  at: "2026-11-05T00:00:00.000Z",
  kind,
  data,
});
const started = (session: string, tasks: readonly string[], retained: readonly string[] = []) =>
  event("comparison.started", {
    session,
    old: "h1",
    fresh: "h2",
    tasks: [...tasks],
    retained: [...retained],
  });
const released = (version: string) => event("task.state", { version, state: "released" });
const proposed = ["task-a", "task-b", "task-c"].flatMap((version) => [
  event("task.proposed", { version, taskId: version }),
  event("task.gate", { version, gate: 1, outcome: "passed" }),
]);
const said = (events: readonly LogEvent[]) =>
  taskTriggers(indexOf([...proposed, ...events])).find(({ name }) => name === "SCORED AFTER RELEASE")
    ?.detail ?? null;

describe("scored after release", () => {
  it("counts once a task a comparison named after its release, retained too, and not one released unscored", () => {
    const events = [
      started("g-3", ["task-a", "task-b"]),
      released("task-a"),
      released("task-c"),
      started("g-4", ["task-b", "task-a"], ["task-a"]),
      started("g-5", ["task-a"]),
    ];
    expect(said(events)).toBe("1 of 2 released tasks scored after their release: task-a");
  });

  it("fires on none where every comparison named a task before its release", () => {
    expect(said([started("g-1", ["task-a"]), released("task-a")])).toBeNull();
  });
});

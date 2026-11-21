// What each Examiner writing session was told, rebuilt on the log before its start
// (`examiner-view.ts --each`), against the wake the host served. Invented data only.
import { describe, expect, it } from "bun:test";
import { examinerEach } from "#skills/design-and-seats/scripts/examiner-view.ts";
import { wakeOn } from "../src/examiner/write.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";

const LIMITS = { wallSeconds: 600, turns: 10, proposals: 4, tasks: 2, tries: 0 };
const TOLD = { wallSeconds: 600, turns: 10, puts: 4, tries: 0 };
const event = (kind: EventKind, data: JsonObject): LogEvent => ({
  at: "2026-11-05T00:00:00.000Z",
  kind,
  data,
});
const started = (session: string, examples: readonly string[], more: JsonObject = {}) =>
  event("exam.started", { session, examples: [...examples], limits: LIMITS, ...more });
const written = (taskId: string, family: string, session: string) => [
  event("task.proposed", {
    version: `v-${taskId}`,
    taskId,
    session,
    task: { taskId, family, publicInput: {}, hidden: null },
  }),
  event("task.gate", { version: `v-${taskId}`, gate: 1, outcome: "passed" }),
];
const reported = (session: string) =>
  event("comparison.reported", {
    session,
    old: "h1",
    fresh: "h2",
    starter: "h1",
    reading: "no-step",
    versions: ["v-t1"],
    scored: { wins: 0, losses: 0, ties: 1 },
  });
const resting = (session: string, text: string) =>
  event("exam.call", { session, tool: "propose_tasks", args: {}, text, isError: false, ms: 1, turn: 3 });

describe("examiner-view", () => {
  it("rebuilds a wake on the log before its ask, so a comparison reported after it changes nothing", () => {
    const opening = [started("x-1", []), ...written("t1", "f", "x-1"), reported("g-1")];
    const served = wakeOn(opening, [{ taskId: "t1", family: "f" }], TOLD);
    const rows = examinerEach([
      ...opening,
      started("x-2", ["t1"], { conversation: "x-1" }),
      resting("x-1", `x-1-001: held out.\n\n${served}\nTurn 0 of 10; 0 of 10 minutes used.`),
      reported("g-2"),
      event("exam.finished", { session: "x-2", ended: "supplied" }),
    ]);
    expect(served).toContain("g-1");
    expect(rows.find((row) => row.startsWith("x-2,"))).toContain(
      "the same text as the wake on record, which adds 1 line",
    );
  });

  it("names where a rebuilt wake parts from the wake on record, and a wake missing from the record as not recorded", () => {
    const opening = [started("x-1", []), ...written("t1", "f", "x-1")];
    const rows = (text: string | null) =>
      examinerEach([
        ...opening,
        started("x-2", ["t1"], { conversation: "x-1" }),
        ...(text === null ? [] : [resting("x-1", text)]),
      ]).find((row) => row.startsWith("x-2,"));
    expect(rows("The host asks for more tasks under the same exam.\n\nsomething else")).toContain(
      "parts from the wake on record at line 3",
    );
    expect(rows(null)).toContain("the wake on record: not recorded");
  });
});

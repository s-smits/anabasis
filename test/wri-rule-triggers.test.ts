// The reader's four triggers for a Rule Author's sessions, over a hand-built log: three sessions,
// one that left a candidate on its second addition, one that finished after none, and one that
// never wrote its record.
import { describe, expect, it } from "bun:test";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { overview, type TRIGGERS } from "../tools/wri/read.ts";

const START = Date.parse("2026-10-08T12:00:00Z");
const GATE: EventKind = "rule.gate";
/** The counts of the candidate's interference over the whole record. */
const READING = { applied: 4, refused: 2, unrunnable: 0, stale: 1 };
const events: LogEvent[] = [];
const record = (kind: EventKind, data: JsonObject) => {
  events.push({ at: new Date(START + events.length * 1_000).toISOString(), kind, data });
};

record("rule.started", { session: "r-1" });
record(GATE, { session: "r-1", try: 1, gate: "shape", outcome: "refused", reason: "the id is taken" });
record(GATE, { session: "r-1", try: 2, gate: "shape", outcome: "passed" });
record(GATE, {
  session: "r-1",
  try: 2,
  gate: "controls",
  outcome: "refused",
  kinds: ["other-check", "passed"],
});
record(GATE, { session: "r-1", try: 3, gate: "shape", outcome: "passed" });
record(GATE, { session: "r-1", try: 3, gate: "controls", outcome: "passed" });
record(GATE, { session: "r-1", try: 3, gate: "determinism", outcome: "passed" });
// While the session ran its check was put to the witnesses alone, and that reading is no candidate's.
record(GATE, {
  session: "r-1",
  try: 3,
  gate: "interference",
  outcome: "reported",
  over: "witnesses",
  applied: 1,
  refused: 1,
  unrunnable: 0,
  stale: 0,
  tasks: [{ taskId: "x-1-002", refused: 1, unrunnable: 0, kept: 0 }],
});
record(GATE, {
  session: "r-1",
  try: 3,
  gate: "interference",
  outcome: "reported",
  over: "record",
  ...READING,
  tasks: [
    { taskId: "x-1-001", refused: 1, unrunnable: 0, kept: 1 },
    { taskId: "x-1-002", refused: 1, unrunnable: 0, kept: 0 },
  ],
});
record("rule.candidate", {
  session: "r-1",
  try: 3,
  dir: "candidates/r-1",
  rule: { id: "R3", statement: "The note names the base." },
  check: { id: "check-note", assertion: "The note names the task's base." },
  base: { contract: "c1c1c1c1c1", checks: "k1k1k1k1k1" },
  contract: "c2c2c2c2c2",
  checks: "k2k2k2k2k2",
  reading: "refuses-some",
  suspect: false,
});
record("rule.finished", { session: "r-1", ended: "finished", tries: 3, candidate: "candidates/r-1" });
record("rule.started", { session: "r-2" });
record("rule.finished", { session: "r-2", ended: "finished", tries: 0, candidate: null, unfinished: null });
record("rule.started", { session: "r-3" });
record(GATE, { session: "r-3", try: 1, gate: "shape", outcome: "passed" });
record("rule.finished", {
  session: "r-3",
  ended: "turns",
  tries: 1,
  candidate: null,
  unfinished: "check-length",
});
record("rule.started", { session: "r-4" });

const of = (name: keyof typeof TRIGGERS) =>
  overview(events).triggers.flatMap((trigger) => (trigger.name === name ? [trigger.detail] : []));

describe("the reader on a campaign with Rule Author sessions", () => {
  it("counts the additions the gates refused, by gate and by control fault", () => {
    expect(of("RULE ADDITION REFUSED")).toEqual([
      "2 of 4 additions put to the gates; by gate: controls 1, shape 1; control faults: other-check 1, passed 1",
    ]);
  });

  it("reads a candidate's interference over the record, and names the candidate as another checker", () => {
    expect(of("CANDIDATE INTERFERENCE")).toEqual([
      "r-1: check-note refuses 2 of 4 accepted answers on record and could not run on 0, which leaves 1 task with none accepted; 1 more the existing checks no longer accept; reading refuses-some",
    ]);
    expect(of("RULE CANDIDATE LEFT")).toEqual([
      "r-1: rule R3 with check check-note over check program k1k1k1k1, as check program k2k2k2k2 in candidates/r-1; no event of this log adopts it",
    ]);
  });

  it("names the sessions that left no candidate, and how each ended", () => {
    expect(of("RULE SESSION ENDED")).toEqual([
      "r-2 ended finished after 0 additions; r-3 ended turns after 1 addition, and an addition that held was not finished on; r-4 never finished",
    ]);
  });

  it("fires none of them on a log no Rule Author wrote in", () => {
    const names = overview(events.filter(({ kind }) => !kind.startsWith("rule."))).triggers.map(
      (trigger) => trigger.name,
    );
    expect(names).toEqual(["NO CHECKER READING", "CHECKER NOT FROZEN"]);
  });
});

// The gather's record of turns another model answered than their seat asked for: written for a
// campaign that has them, left alone while it is the same, and never written for a clean one.
import { afterAll, describe, expect, it } from "bun:test";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import { degradations } from "../src/kernel/trace.ts";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { gitText } from "../src/meta/git.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { degradationLines, recordDegradations } from "../tools/runs/degradations.ts";

const ASKED = "claude/claude-opus-5-5";
const event = (minute: number, kind: EventKind, data: JsonObject): LogEvent => ({
  at: new Date(Date.UTC(2026, 9, 31, 12, minute)).toISOString(),
  kind,
  data,
});
const served = (responseModel: string): LogEvent[] => [
  event(0, "exam.started", { session: "x-1", model: ASKED }),
  event(1, "exam.turn", { session: "x-1", turn: 1, responseModel, error: null }),
  event(2, "exam.turn", { session: "x-1", turn: 2, responseModel, error: null }),
  event(3, "referee.turn", { reader: "r-1", turn: 1, responseModel: "claude-opus-5", error: null }),
];

describe("degradations", () => {
  it("counts a session's turns another model answered, and reads a dated snapshot as its model's", () => {
    expect(degradations(served("claude-opus-5"))).toEqual([
      {
        seat: "exam",
        id: "x-1",
        asked: ASKED,
        served: "claude-opus-5",
        turns: 2,
        first: "2026-10-31T12:01:00.000Z",
        last: "2026-10-31T12:02:00.000Z",
      },
    ]);
    expect(degradations(served("claude-opus-5-5-20261001"))).toEqual([]);
    expect(degradations(served("claude-opus-5"), 2)).toHaveLength(1);
  });

  it("writes a campaign's record once, and none for a campaign its models served as asked", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-degradations-"));
    afterAll(() => rmSync(root, { recursive: true, force: true }));
    gitText(root, "init", "-q");
    const write = (name: string, log: readonly LogEvent[]) => {
      mkdirSync(join(root, ".ana", "d2", name), { recursive: true });
      writeFileSync(
        join(root, ".ana", "d2", name, "log.jsonl"),
        log.map((one) => `${JSON.stringify(one)}\n`).join(""),
      );
    };
    write("recode-a", served("claude-opus-5"));
    write("buffer-a", served("claude-opus-5-5"));
    const said = recordDegradations([], root);
    expect(said).toHaveLength(1);
    expect(said[0]).toContain(
      "degraded: recode-a: 2 turns served by another model (claude-opus-5 for claude/claude-opus-5-5)",
    );
    const record = readFileSync(join(root, "data", "runs", "degradations", "recode-a.tsv"), "utf8");
    expect(record.split("\n")[0]).toBe("seat\tid\tasked\tserved\tturns\tfirst\tlast");
    expect(existsSync(join(root, "data", "runs", "degradations", "buffer-a.tsv"))).toBe(false);
    expect(recordDegradations([], root)).toEqual([]);
  });

  it("reads a campaign for an investigation, seat by seat, with the Referee's turns left out", () => {
    const lines = degradationLines(served("claude-opus-5"));
    expect(lines[0]).toBe("2 of 2 turns naming a model were served by another than their seat asked for");
    expect(lines).toContain("  exam: 2 of 2 turns; claude-opus-5 for claude/claude-opus-5-5");
    expect(degradationLines(served("claude-opus-5-5"))).toEqual([
      "all 2 turns naming a model were served as their seat asked",
    ]);
  });
});

import { afterAll, describe, expect, it } from "bun:test";
import { append, read, repair } from "../src/kernel/log.ts";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

const dir = mkdtempSync(join(tmpdir(), "ana-log-"));
let logs = 0;
const fresh = (): string => join(dir, `${++logs}.jsonl`);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("the log", () => {
  it("reads back every append in order, and a missing log as an empty history", () => {
    const path = fresh();
    expect(read(path)).toEqual([]);
    const started = append(path, "solve.started", { task: "t1" });
    const finished = append(path, "solve.finished", { answer: "a1", dollars: 0.5 });
    expect(read(path)).toEqual([started, finished]);
  });

  it("refuses a torn last line rather than reading around it", () => {
    const path = fresh();
    append(path, "verdict", { pass: true });
    appendFileSync(path, '{"at":"2026-10-07T00:00:00.000Z","kind":"verd');
    expect(() => read(path)).toThrow("the last line is torn");
  });

  it("cuts a torn last line back to the last whole event, and leaves a whole log alone", () => {
    const path = fresh();
    expect(repair(path)).toBeNull();
    const kept = append(path, "verdict", { pass: true });
    expect(repair(path)).toBeNull();
    const torn = '{"at":"2026-10-07T00:00:00.000Z","kind":"verd';
    appendFileSync(path, torn);
    expect(repair(path)).toBe(torn);
    expect(read(path)).toEqual([kept]);
    const next = append(path, "verdict", { pass: false });
    expect(read(path)).toEqual([kept, next]);
    const only = fresh();
    appendFileSync(only, torn);
    expect(repair(only)).toBe(torn);
    expect(read(only)).toEqual([]);
  });

  it("refuses a line that is not one of the plan's events", () => {
    const path = fresh();
    appendFileSync(path, '{"at":"2026-10-07T00:00:00.000Z","kind":"solve.retried","data":{}}\n');
    expect(() => read(path)).toThrow(`${path}:1 is not a log event`);
  });

  it("appends nothing after a torn last line, whatever the event", () => {
    const path = fresh();
    append(path, "verdict", { pass: true });
    appendFileSync(path, '{"at":"2026-10-07T00:00:00.000Z","kind":"verd');
    const torn = readFileSync(path, "utf8");
    expect(() => append(path, "solve.started", { task: "t1" })).toThrow("the last line is torn");
    expect(() => append(path, "task.proposed", { version: "v1" })).toThrow("the last line is torn");
    expect(readFileSync(path, "utf8")).toBe(torn);
  });

  it("refuses, writing nothing, a task event that would leave the log unreadable", () => {
    const path = fresh();
    const proposed = append(path, "task.proposed", { version: "v1" });
    expect(() => append(path, "task.proposed", { version: "v1" })).toThrow("task v1 is proposed twice");
    expect(() => append(path, "task.state", { version: "v1", state: "released" })).toThrow(
      "task v1 cannot go from held to released before its gate passed",
    );
    expect(() => append(path, "task.gate", { version: "v2", gate: 1, outcome: "passed" })).toThrow(
      "task v2 is not proposed",
    );
    expect(read(path)).toEqual([proposed]);
    // A second pass of the one gate is refused as well, and the first stands.
    const gated = append(path, "task.gate", { version: "v1", gate: 1, outcome: "passed" });
    expect(() => append(path, "task.gate", { version: "v1", gate: 1, outcome: "passed" })).toThrow(
      "task v1 logs its gate twice",
    );
    expect(read(path)).toEqual([proposed, gated]);
  });
});

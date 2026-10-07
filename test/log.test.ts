import { afterAll, describe, expect, it } from "bun:test";
import { append, read } from "../src/kernel/log.ts";
import { appendFileSync, mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
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

  it("refuses a line that is not one of the plan's events", () => {
    const path = fresh();
    appendFileSync(path, '{"at":"2026-10-07T00:00:00.000Z","kind":"solve.retried","data":{}}\n');
    expect(() => read(path)).toThrow(`${path}:1 is not a log event`);
  });
});

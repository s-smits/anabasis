// The three blind views of the tasks: one line a task of its public input's structure, one task's
// input whole up to `VALUE_BYTES`, and the skeleton of lane 27's grade rows. None may print an
// outcome, a tally, a reading or a hidden value.
import { afterAll, describe, expect, it } from "bun:test";
import { append } from "../src/kernel/log.ts";
import { mkdirSync, mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";
import { inputPaths, VALUE_BYTES } from "../tools/wri/tasks.ts";

/** What a blind view may never print: a reading, a tally, an outcome or a hidden value. */
const BLIND = [/step/u, /wins/u, /\b7\b/u, /pass/u, /HIDDEN-VALUE/u];

const dir = mkdtempSync(join(tmpdir(), "ana-wri-tasks-shape-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const log = join(dir, "camp-x", "log.jsonl");
mkdirSync(join(dir, "camp-x"), { recursive: true });
const SCORED = "b".repeat(64);
const PRACTISED = "e".repeat(64);
const STARTER = "1".repeat(64);
const FRESH = "2".repeat(64);
const long = "r".repeat(VALUE_BYTES + 40);
const task = (taskId: string, publicInput: JsonObject) => ({
  taskId,
  family: "rota",
  publicInput,
  hidden: { secret: "HIDDEN-VALUE" },
});
append(log, "task.proposed", {
  version: SCORED,
  taskId: "x-1-001",
  session: "x-1",
  task: task("x-1-001", {
    wards: [{ id: "W1" }, { id: "W22", beds: 4 }],
    spec: '{"inner":"VALUE-IN-JSON"}',
    text: long,
  }),
});
append(log, "task.proposed", {
  version: PRACTISED,
  taskId: "x-1-002",
  session: "x-1",
  task: task("x-1-002", { wards: [] }),
});
for (const version of [SCORED, PRACTISED]) append(log, "task.gate", { version, gate: 1, outcome: "passed" });
append(log, "task.state", { version: PRACTISED, state: "released" });
append(log, "comparison.started", {
  session: "g-1",
  old: STARTER,
  fresh: FRESH,
  starter: STARTER,
  tasks: [SCORED],
});
append(log, "comparison.reported", {
  session: "g-1",
  old: STARTER,
  fresh: FRESH,
  reading: "step",
  scored: { wins: 7, losses: 0, ties: 0 },
});

const run = (...args: string[]) => {
  const ran = runSync([capturedExecPath, resolve(import.meta.dir, "../tools/wri/tasks.ts"), log, ...args]);
  return { code: ran.exitCode, out: decodeOutput(ran.stdout) };
};

describe("the shape of each task", () => {
  it("names each key path with its kind and sizes, and no value, a JSON text counting as text", () => {
    expect(inputPaths({ wards: [{ id: "W1" }, { id: "W22", beds: 4 }], spec: '{"inner":"x"}' })).toBe(
      "wards list(2); wards[].id text(2-3); wards[].beds number; spec text(13)",
    );
  });

  it("prints one line a task, marks the practised one, and prints nothing blind readers may not see", () => {
    const { code, out } = run("--shape");
    expect(code).toBe(0);
    const lines = out.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("x-1-002  practised, never scored");
    for (const value of ["W22", "VALUE-IN-JSON", "rrrr"]) expect(out).not.toContain(value);
    for (const banned of BLIND) expect(out).not.toMatch(banned);
  });
});

describe("one task whole", () => {
  it("cuts a text past VALUE_BYTES and says so, printing no hidden value", () => {
    const { out } = run("--task", "x-1-001");
    expect(out).toContain("W22");
    expect(out).toContain(`[cut after ${String(VALUE_BYTES)} of ${String(VALUE_BYTES + 40)} characters]`);
    expect(out).not.toContain("r".repeat(VALUE_BYTES + 1));
    expect(out).not.toContain("HIDDEN-VALUE");
    expect(run("--task", "eeeeeeee").out).toContain("x-1-002");
  });
});

describe("the grade rows", () => {
  it("writes a row a scored task and a row a measured version, full digest, grades blank, no outcome", () => {
    const { out } = run("--rows");
    expect(out.replace(/\n$/u, "").split("\n")).toEqual([
      "task\tcamp-x\tx-1-001\t",
      `version\tcamp-x\t${FRESH}\t`,
    ]);
    for (const banned of BLIND) expect(out).not.toMatch(banned);
  });
});

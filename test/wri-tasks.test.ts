// The scored tasks as lane 14 grades them, and the three blind views of them: one line a task of
// its public input's structure, one task's input whole up to `VALUE_BYTES`, and the skeleton of
// lane 14's grade rows. None may print an outcome, a tally, a reading, a hidden value or an unscored task.
import { describe, expect, it } from "bun:test";
import { append } from "../src/kernel/log.ts";
import { mkdirSync, mkdtempSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";
import { siblingRows } from "../tools/wri/drafted.ts";
import { inputPaths, VALUE_BYTES } from "../tools/wri/tasks.ts";

const TRIS = { volume_L: 1, systems: ["Tris"] };
/** What a blind view may never print: a reading, a tally, an outcome or a hidden value. */
const BLIND = [/step/u, /wins/u, /\b7\b/u, /pass/u, /HIDDEN-VALUE/u];
const SCORED = "b".repeat(64);
const PRACTISED = "e".repeat(64);
const STARTER = "1".repeat(64);
const FRESH = "2".repeat(64);
const long = "r".repeat(VALUE_BYTES + 40);

const dir = mkdtempSync(join(tmpdir(), "ana-wri-tasks-"));
const tasksOf = (log: string, ...args: string[]) => {
  const ran = runSync([capturedExecPath, resolve(import.meta.dir, "../tools/wri/tasks.ts"), log, ...args]);
  return { code: ran.exitCode, out: decodeOutput(ran.stdout) };
};
/** A task an Examiner wrote, holding one hidden value no view may print. */
const task = (taskId: string, publicInput: JsonObject, family = "near-neutral buffer") => ({
  taskId,
  family,
  publicInput,
  hidden: { secret: "HIDDEN-VALUE" },
});

const log = join(dir, "camp", "log.jsonl");
mkdirSync(join(dir, "camp"), { recursive: true });
append(log, "task.proposed", { version: "a".repeat(64), taskId: "ex-001", family: "pack family" });
append(log, "task.proposed", {
  version: "b".repeat(64),
  taskId: "x-1-001",
  session: "x-1",
  task: task("x-1-001", TRIS),
});
append(log, "task.proposed", {
  version: "c".repeat(64),
  taskId: "x-1-002",
  session: "x-1",
  task: task("x-1-002", TRIS),
});
append(log, "task.proposed", {
  version: "e".repeat(64),
  taskId: "x-1-003",
  session: "x-1",
  task: task("x-1-003", { volume_L: 3, systems: ["Only practised"] }),
});
append(log, "comparison.started", { session: "g-1", tasks: ["a".repeat(64), "b".repeat(64)], retained: [] });
append(log, "comparison.started", { session: "g-2", tasks: ["b".repeat(64)], retained: ["b".repeat(64)] });
for (const version of ["b".repeat(64), "e".repeat(64)]) {
  append(log, "task.gate", { version, gate: 1, outcome: "passed" });
  append(log, "task.state", { version, state: "released" });
}

describe("the scored tasks", () => {
  it("prints each scored task's public input once a comparison, and no hidden value or unscored task", () => {
    const { code, out } = tasksOf(log);
    expect(code).toBe(0);
    expect(out).toContain("x-1-001  written by x-1  scored in g-1, g-2\n");
    expect(out).toContain('"systems":["Tris"]');
    expect(out).toContain("ex-001  written by the pack  scored in g-1");
    expect(out).toContain("public input is in the pack");
    expect(out).not.toContain("x-1-002");
    expect(out).not.toContain("HIDDEN-VALUE");
  });

  it("marks a task practised and never scored, with its public input, and lists a scored one once", () => {
    const { out } = tasksOf(log);
    expect(out).toContain("x-1-003  written by x-1  practised, never scored\n");
    expect(out).toContain('"systems":["Only practised"]');
    expect(out).not.toContain("x-1-001  written by x-1  practised");
    expect(out.match(/x-1-001/gu)).toHaveLength(1);
    expect(out).not.toContain("x-1-002");
    expect(out).not.toContain("HIDDEN-VALUE");
  });

  it("reads a drafted exam's task from the draft by its id, and none of its hidden values", () => {
    const drafted = join(dir, "drafted", "log.jsonl");
    mkdirSync(join(dir, "drafted"), { recursive: true });
    const example = {
      family: "drafted family",
      publicInput: { load: "DRAFT-INPUT" },
      hidden: { secret: "HIDDEN-VALUE" },
    };
    append(drafted, "exam.drafted", {
      session: "d-1",
      draft: { tasks: [example, { ...example, publicInput: {} }] },
    });
    append(drafted, "task.proposed", { version: "d".repeat(64), taskId: "ex-001", family: "drafted family" });
    append(drafted, "comparison.started", { session: "g-1", tasks: ["d".repeat(64)], retained: [] });
    const { out } = tasksOf(drafted);
    expect(out).toContain("ex-001  written by the draft  scored in g-1");
    expect(out).toContain('"load":"DRAFT-INPUT"');
    expect(out).not.toContain("in the pack");
    expect(out).not.toContain("HIDDEN-VALUE");
  });

  it("ignores plain files in the archive root and inside host folders when scanning siblings", () => {
    const archive = join(dir, "sibling-archive");
    mkdirSync(join(archive, "here", "camp-a"), { recursive: true });
    writeFileSync(join(archive, "README.md"), "not a host folder\n");
    writeFileSync(join(archive, "here", "notes.txt"), "not a campaign folder\n");
    const siblingLog = join(archive, "here", "camp-a", "log.jsonl");
    append(siblingLog, "campaign.opened", { prompt: "shared prompt" });
    const rows = siblingRows("shared prompt", archive, join(archive, "here", "other", "log.jsonl"));
    expect(rows[0]).toContain(": 1");
    expect(rows[1]).toContain("here/camp-a: no standing draft");
  });
});

const blindLog = join(dir, "camp-x", "log.jsonl");
mkdirSync(join(dir, "camp-x"), { recursive: true });
append(blindLog, "task.proposed", {
  version: SCORED,
  taskId: "x-1-001",
  session: "x-1",
  task: task(
    "x-1-001",
    { wards: [{ id: "W1" }, { id: "W22", beds: 4 }], spec: '{"inner":"VALUE-IN-JSON"}', text: long },
    "rota",
  ),
});
append(blindLog, "task.proposed", {
  version: PRACTISED,
  taskId: "x-1-002",
  session: "x-1",
  task: task("x-1-002", { wards: [] }, "rota"),
});
for (const version of [SCORED, PRACTISED]) {
  append(blindLog, "task.gate", { version, gate: 1, outcome: "passed" });
}
append(blindLog, "task.state", { version: PRACTISED, state: "released" });
append(blindLog, "comparison.started", {
  session: "g-1",
  old: STARTER,
  fresh: FRESH,
  starter: STARTER,
  tasks: [SCORED],
});
append(blindLog, "comparison.reported", {
  session: "g-1",
  old: STARTER,
  fresh: FRESH,
  reading: "step",
  scored: { wins: 7, losses: 0, ties: 0 },
});

const run = (...args: string[]) => tasksOf(blindLog, ...args);

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

// The scored tasks as lane 34 grades them: each one's public input, and nothing hidden or unscored.
import { afterAll, describe, expect, it } from "bun:test";
import { append } from "../src/kernel/log.ts";
import { mkdirSync, mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";

const dir = mkdtempSync(join(tmpdir(), "ana-wri-tasks-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const log = join(dir, "camp", "log.jsonl");
mkdirSync(join(dir, "camp"), { recursive: true });
const task = (taskId: string) => ({
  taskId,
  family: "near-neutral buffer",
  publicInput: { volume_L: 1, systems: ["Tris"] },
  hidden: { secret: "HIDDEN-VALUE" },
});
append(log, "task.proposed", { version: "a".repeat(64), taskId: "ex-001", family: "pack family" });
append(log, "task.proposed", {
  version: "b".repeat(64),
  taskId: "x-1-001",
  session: "x-1",
  task: task("x-1-001"),
});
append(log, "task.proposed", {
  version: "c".repeat(64),
  taskId: "x-1-002",
  session: "x-1",
  task: task("x-1-002"),
});
append(log, "comparison.started", { session: "g-1", tasks: ["a".repeat(64), "b".repeat(64)], retained: [] });
append(log, "comparison.started", { session: "g-2", tasks: ["b".repeat(64)], retained: ["b".repeat(64)] });

describe("the scored tasks", () => {
  it("prints each scored task's public input once a comparison, and no hidden value or unscored task", () => {
    const ran = runSync([capturedExecPath, resolve(import.meta.dir, "../tools/wri/tasks.ts"), log]);
    const out = decodeOutput(ran.stdout);
    expect(ran.exitCode).toBe(0);
    expect(out).toContain("x-1-001  written by x-1  scored in g-1, g-2\n");
    expect(out).toContain('"systems":["Tris"]');
    expect(out).toContain("ex-001  written by the pack  scored in g-1");
    expect(out).toContain("public input is in the pack");
    expect(out).not.toContain("x-1-002");
    expect(out).not.toContain("HIDDEN-VALUE");
  });
});

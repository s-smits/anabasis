import { afterAll, describe, expect, it } from "bun:test";
import { append, read } from "../src/kernel/log.ts";
import { taskSets } from "../src/kernel/task.ts";
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

const dir = mkdtempSync(join(tmpdir(), "ana-log-"));
let logs = 0;
const fresh = (): string => join(dir, `${++logs}.jsonl`);

async function waitForFile(path: string): Promise<void> {
  const deadline = performance.now() + 2000;
  while (!existsSync(path) && performance.now() < deadline) await Bun.sleep(5);
  expect(existsSync(path)).toBe(true);
}

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("the log", () => {
  it("refuses a line that is not one of the plan's events", () => {
    const path = fresh();
    appendFileSync(path, '{"at":"2026-10-07T00:00:00.000Z","kind":"solve.retried","data":{}}\n');
    expect(() => read(path)).toThrow(`${path}:1 is not a log event`);
    // A kind no command writes since 12 October, when a packet's pass labels went into the settled
    // report, still reads: a log is evidence (AGENTS.md, section 5).
    const before = fresh();
    appendFileSync(before, '{"at":"2026-10-11T00:00:00.000Z","kind":"pass.labelled","data":{}}\n');
    expect(read(before).map(({ kind }) => kind)).toEqual(["pass.labelled"]);
  });

  it("refuses reading or appending after a torn last line, whatever the event", () => {
    const path = fresh();
    append(path, "verdict", { pass: true });
    appendFileSync(path, '{"at":"2026-10-07T00:00:00.000Z","kind":"verd');
    const torn = readFileSync(path, "utf8");
    expect(() => read(path)).toThrow("the last line is torn");
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

  it("refuses a release from another process after a concurrent dispute, keeping the log readable", async () => {
    const path = fresh();
    append(path, "task.proposed", { version: "v1" });
    append(path, "task.gate", { version: "v1", gate: 1, outcome: "passed" });
    const script = `${path}.ts`;
    writeFileSync(
      script,
      `
      import { append } from ${JSON.stringify(new URL("../src/kernel/log.ts", import.meta.url).pathname)};
      import { existsSync, writeFileSync } from "node:fs";
      const [path, state] = process.argv.slice(2);
      writeFileSync(path + "." + state + ".ready", "");
      try {
        append(path, "task.state", {
          version: "v1", state,
          // This JSON field is read after validation, before the line is written.
          get reason() {
            writeFileSync(path + "." + state + ".validated", "");
            const deadline = performance.now() + 5000;
            while (!existsSync(path + "." + state + ".go")) {
              if (performance.now() > deadline) throw new Error("append barrier timed out");
              Bun.sleepSync(5);
            }
            return "concurrent transition";
          }
        });
      } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
      }
    `,
    );
    const dispute = Bun.spawn([process.execPath, script, path, "disputed"], { stderr: "pipe" });
    const children = [dispute];
    try {
      await waitForFile(`${path}.disputed.validated`);
      const release = Bun.spawn([process.execPath, script, path, "released"], { stderr: "pipe" });
      children.push(release);
      await waitForFile(`${path}.released.ready`);
      // Without the lock the release validates too. With it, the release must wait for the dispute.
      const deadline = performance.now() + 250;
      while (!existsSync(`${path}.released.validated`) && performance.now() < deadline) await Bun.sleep(5);
      writeFileSync(`${path}.disputed.go`, "");
      expect(await dispute.exited).toBe(0);
      writeFileSync(`${path}.released.go`, "");
      const released = await release.exited;
      expect(() => taskSets(read(path))).not.toThrow();
      expect(released).toBe(1);
      expect(await new Response(release.stderr).text()).toContain("cannot go from disputed to released");
      expect(read(path)).toHaveLength(3);
      expect(taskSets(read(path)).states.get("v1")).toBe("disputed");
      // The refused append must release its lock as well.
      append(path, "verdict", { pass: true });
      expect(read(path)).toHaveLength(4);
    } finally {
      for (const child of children) child.kill();
      await Promise.all(children.map((child) => child.exited));
    }
  });
});

// Where a kept harness's own files name a task, over invented tasks and two kept states: a task id
// that stands inside a longer one, a public identifier one task holds and a word every task holds, a
// family, a version prefix, and a name in an installed package that the harness did not write.
import { afterAll, describe, expect, it } from "bun:test";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { EXAMPLE } from "../src/harness/starter.ts";
import { nameRows } from "../tools/wri/names.ts";
import { writeHarness } from "./helpers/write-harness.ts";

const events: LogEvent[] = [];
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-names-test-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const states = join(root, "states");
const one = "a".repeat(64);
const two = "b".repeat(64);
const PRACTISED = "c0ffee11".padEnd(64, "0");
const HELD = "deadbeef".padEnd(64, "0");

const put = (kind: EventKind, data: JsonObject) => {
  events.push({ at: new Date(Date.UTC(2026, 10, 5) + events.length * 1000).toISOString(), kind, data });
};
const task = (version: string, taskId: string, publicInput: JsonObject) => {
  put("task.proposed", {
    version,
    taskId,
    session: "x-1",
    task: { taskId, family: "night-rota", publicInput },
  });
  put("task.gate", { version, gate: 1, outcome: "passed" });
};
task(PRACTISED, "x-2-3", { site: "Ward_7B", note: "use shift-plan" });
task(HELD, "x-2-9", { site: "Ward_9Q", note: "use shift-plan" });
task("1234abcd".padEnd(64, "0"), "x-3-1", { site: "Ward_1A", note: "use shift-plan" });
put("task.state", { version: PRACTISED, state: "released" });

writeHarness(join(states, one), {
  ...EXAMPLE,
  guide: "Read x-2-31 and the Night-Rota notes.\nUse shift-plan carefully.\n",
  programs: { fit: "#!/bin/sh\n# Ward_7B first\necho x-2-3 deadbeef\n" },
});
writeHarness(join(states, two), { ...EXAMPLE, programs: { fit: "#!/bin/sh\necho Ward_7B\n" } });
mkdirSync(join(states, two, ".toolchain", "lib", "python", "site-packages", "pkg"), { recursive: true });
writeFileSync(join(states, two, ".toolchain", "lib", "python", "site-packages", "pkg", "mod.py"), "x-2-9\n");

const rows = nameRows(events, states);
const blockOf = (digest: string) => {
  const start = rows.findIndex((row) => row.startsWith(digest.slice(0, 8)));
  const end = rows.findIndex((row, at) => at > start && !row.startsWith("  "));
  return rows.slice(start + 1, end === -1 ? undefined : end);
};

describe("where a harness names a task", () => {
  it("matches a task id whole, never inside a longer word", () => {
    const ids = blockOf(one).filter((row) => row.includes("  id x-2-3"));
    expect(ids).toHaveLength(1);
    expect(ids[0]).toContain("  bin/fit:3  id x-2-3  5  1  0  ");
  });

  it("marks each named task as practice or held out", () => {
    expect(blockOf(one).find((row) => row.includes("  id x-2-3"))).toContain("x-2-3 (practice)");
    expect(blockOf(one).find((row) => row.includes("  version deadbeef"))).toContain("x-2-9 (held out)");
  });

  it("finds a family whatever its case, naming every task of it", () => {
    const family = blockOf(one).find((row) => row.includes("  family night-rota"));
    expect(family).toContain("guide:1");
    expect(family).toContain("x-3-1");
  });

  it("prints a rare public identifier's place, length and holders, never its text", () => {
    const hits = blockOf(one).filter((row) => row.includes("  public"));
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("  bin/fit:2  public  7  2  1  x-2-3 (practice)");
    expect(rows.join("\n")).not.toContain("Ward_7B");
  });

  it("leaves out a word every task holds", () => {
    expect(rows.join("\n")).not.toMatch(/guide:2/u);
    expect(rows[0]).toContain("plain words left out");
  });

  it("reads no file the harness installed", () => {
    expect(blockOf(two).join("\n")).not.toContain("site-packages");
    expect(blockOf(two).join("\n")).not.toContain("x-2-9");
  });

  it("calls no hit a breach", () => {
    expect(rows.join("\n").toLowerCase()).not.toMatch(/breach|leak|violat/u);
  });
});

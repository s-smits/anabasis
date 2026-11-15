// Where a kept harness's own files name a task, over invented tasks and two kept states: a task id
// that stands inside a longer one, a public identifier one task holds and a word every task holds, a
// hyphenated compound of plain words beside a hyphenated identifier, a family, a version prefix, and
// a name in an installed package that the harness did not write.
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
task(PRACTISED, "x-2-3", { site: "Ward_7B", note: "use shift-plan", cover: "night-cover", bay: "bay-12b" });
task(HELD, "x-2-9", { site: "Ward_9Q", note: "use shift-plan" });
task("1234abcd".padEnd(64, "0"), "x-3-1", { site: "Ward_1A", note: "use shift-plan" });
put("task.state", { version: PRACTISED, state: "released" });

writeHarness(join(states, one), {
  ...EXAMPLE,
  guide: "Read x-2-31 and the Night-Rota notes.\nUse shift-plan carefully.\nKeep night-cover for bay-12b.\n",
  programs: { fit: "#!/bin/sh\n# Ward_7B first\necho x-2-3 deadbeef\n" },
});
writeHarness(join(states, two), { ...EXAMPLE, programs: { fit: "#!/bin/sh\necho Ward_7B\n" } });
mkdirSync(join(states, two, ".toolchain", "lib", "python", "site-packages", "pkg"), { recursive: true });
writeFileSync(join(states, two, ".toolchain", "lib", "python", "site-packages", "pkg", "mod.py"), "x-2-9\n");

const rows = nameRows(events, states);
const blockOf = (found: string[], digest: string) => {
  const start = found.findIndex((row) => row.startsWith(digest.slice(0, 8)));
  const end = found.findIndex((row, at) => at > start && !row.startsWith("  "));
  return found.slice(start + 1, end === -1 ? undefined : end);
};

describe("where a harness names a task", () => {
  it("names a task id whole, a family whatever its case, and a rare identifier by place, length and holders", () => {
    // x-2-31 holds x-2-3 inside a longer word; Ward_7B is the identifier; night-cover is a compound of
    // plain words, so only bay-12b beside it on guide:3 counts; guide:2 holds a word every task holds.
    expect(blockOf(rows, one)).toEqual([
      "  bin/fit:2  public  7  2  1  x-2-3 (practice)",
      "  bin/fit:3  id x-2-3  5  1  0  x-2-3 (practice)",
      "  bin/fit:3  version deadbeef  8  1  0  x-2-9 (held out)",
      "  guide:1  family night-rota  10  1  0  x-2-3 (practice), x-2-9 (held out), x-3-1 (held out)",
      "  guide:3  public  7  1  1  x-2-3 (practice)",
    ]);
    expect(rows[0]).toContain("(1 plain words left out)");
  });

  it("reads no file the harness installed, prints no identifier's text and calls no hit a breach", () => {
    expect(blockOf(rows, two)).toEqual(["  bin/fit:2  public  7  2  1  x-2-3 (practice)"]);
    expect(rows.join("\n")).not.toContain("Ward_7B");
    expect(rows.join("\n").toLowerCase()).not.toMatch(/breach|leak|violat/u);
  });
});

// Copied phrases, over invented tasks sharing one contract sentence: a nine-word span written with
// other case and punctuation, a five-word span, a six-word span of a held-out task, the shared
// sentence, and a harness that shares nothing but an installed file holding a task's story.
describe("where a harness copies a phrase of a task's public input", () => {
  const COMMON = "Answer with one JSON object that holds the total.";
  const copied: LogEvent[] = [];
  const add = (kind: EventKind, data: JsonObject) => {
    copied.push({ at: new Date(Date.UTC(2026, 10, 6) + copied.length * 1000).toISOString(), kind, data });
  };
  const story = (version: string, taskId: string, text: string) => {
    const publicInput = { brief: COMMON, story: text };
    add("task.proposed", { version, taskId, session: "y-1", task: { taskId, family: "stock", publicInput } });
    add("task.gate", { version, gate: 1, outcome: "passed" });
  };
  story(PRACTISED, "y-1-1", "the warehouse ledger drifts whenever pallets arrive after midnight");
  story(HELD, "y-1-2", "count every crate twice before the morning shift signs off");
  story("1234abcd".padEnd(64, "0"), "y-1-3", "unrelated words about rivers and bridges in spring");
  add("task.state", { version: PRACTISED, state: "released" });
  const shelves = join(root, "copied-states");
  writeHarness(join(shelves, one), {
    ...EXAMPLE,
    guide: [
      "Note: The Warehouse-Ledger drifts, whenever pallets arrive after midnight.",
      "Always count every crate twice before lunch.",
      "Check before the morning shift signs off, always.",
      COMMON,
      "",
    ].join("\n"),
  });
  writeHarness(join(shelves, two), { ...EXAMPLE, guide: "Nothing here repeats any task.\n" });
  const site = join(shelves, two, ".toolchain", "lib", "python", "site-packages", "pkg");
  mkdirSync(site, { recursive: true });
  writeFileSync(join(site, "mod.py"), "count every crate twice before the morning shift signs off\n");
  const lines = nameRows(copied, shelves);

  it("reports a span of six words once as its longest, never one of five, one every task shares or its text", () => {
    expect(blockOf(lines, one)).toEqual([
      "  guide:1  phrase  9  1  1  y-1-1 (practice)",
      "  guide:3  phrase  6  1  1  y-1-2 (held out)",
    ]);
    expect(lines[0]).toContain("4 spans every task shares left out");
    expect(lines.join("\n")).not.toMatch(/warehouse|morning shift/iu);
  });

  it("prints no phrase for a harness that shares nothing and reads none it installed", () => {
    expect(blockOf(lines, two)).toEqual([]);
    expect(lines.find((row) => row.startsWith(two.slice(0, 8)))).toContain(", 0 hits");
  });
});

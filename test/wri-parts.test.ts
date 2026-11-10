// Lane 16's parts: what each side's solves of a won task ran, and what the new harness wrote against
// the reference. Every program, task and harness here is invented.
import { afterAll, describe, expect, it } from "bun:test";
import { conditionId, settingId } from "#src/kernel/condition.ts";
import type { EventKind, LogEvent } from "#src/kernel/log.ts";
import type { Call } from "#src/kernel/trace.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "#src/meta/filesystem.ts";
import type { JsonObject } from "#src/meta/json-shape.ts";
import { tmpdir } from "#src/meta/os.ts";
import { dirname, join } from "#src/meta/path.ts";
import { requireJsonValue } from "#src/meta/stable-json.ts";
import { partsLines, solveRows, writtenAgainst } from "#tools/wri/parts.ts";
import { conditionOf } from "./helpers/logged-round.ts";

const room = mkdtempSync(join(tmpdir(), "wri-parts-"));
afterAll(() => rmSync(room, { recursive: true, force: true }));

/** A kept state: its guide, and each program under its tool tree by path. */
function keep(name: string, guide: string | null, programs: Record<string, string>): string {
  const state = join(room, name);
  mkdirSync(join(state, "agent"), { recursive: true });
  if (guide !== null) writeFileSync(join(state, "agent", "BUILT_AGENTS.md"), guide);
  for (const [path, text] of Object.entries(programs)) {
    const file = join(state, ".toolchain", path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  return state;
}

let clock = 0;
const event = (kind: EventKind, data: JsonObject): LogEvent => {
  clock += 1;
  return { at: new Date(Date.UTC(2026, 10, 6) + clock * 1000).toISOString(), kind, data };
};

/** One comparison solve: its condition, start, calls, end and verdict. */
function solved(solve: string, harness: string, task: string, commands: readonly string[]): LogEvent[] {
  const condition = conditionOf(task, harness);
  const id = conditionId(condition);
  return [
    event("condition.recorded", { id, condition: requireJsonValue(condition) }),
    event("solve.started", { solve, condition: id, task, comparison: "g-1" }),
    event("solve.turn", { solve, turn: 0, text: "the guide names fit.py; I will write my own" }),
    ...commands.map((command, turn) =>
      event("solve.call", { solve, turn, tool: "bash", args: { command }, text: "", isError: false, ms: 5 }),
    ),
    event("solve.finished", { solve, ending: { outcome: "pass" } }),
    event("verdict", { solve, task, kind: "pass", answer: { x: 1 } }),
  ];
}

const proposed = (version: string) => [
  event("task.proposed", {
    version,
    taskId: version,
    session: "x-1",
    task: { taskId: version, family: "fam", publicInput: {}, hidden: null },
  }),
  event("task.gate", { version, gate: 1, outcome: "passed" }),
];

const events: LogEvent[] = [
  ...proposed("v-1"),
  ...proposed("v-2"),
  ...solved("n-1", "h-new", "v-1", ["ls", "cd lib && python3 fit.py --in data.csv"]),
  ...solved("o-1", "h-old", "v-1", ["python3 mine.py", "cat buffer.json"]),
  ...solved("n-2", "h-new", "v-2", ["ls"]),
  ...solved("o-2", "h-old", "v-2", ["ls"]),
  event("comparison.reported", {
    session: "g-1",
    old: "h-old",
    fresh: "h-new",
    setting: settingId(conditionOf("any", "any")),
    solves: 1,
    versions: ["v-1", "v-2"],
    scored: { wins: 1, losses: 0, ties: 1 },
    frontier: { differences: [400, 0], of: ["v-1", "v-2"], valid: [[true], [true]] },
  }),
];

describe("writtenAgainst", () => {
  const old = keep("old", "guide one", { "bin/run": "echo run", "lib/old_name.py": "X = 1\n" });
  const fresh = keep("new", "guide two", {
    "bin/run": "echo run",
    "lib/new_name.py": "X = 1\n",
    "lib/fit.py": "print(2)\n",
    "lib/buffer.js": "module.exports = 1;\n",
  });

  it("reads a program moved with the same bytes as a rename, neither added nor removed", () => {
    const written = writtenAgainst(old, fresh);
    expect(written.renamed).toEqual([{ from: "lib/old_name.py", to: "lib/new_name.py" }]);
    expect(written.added).toEqual(["lib/buffer.js", "lib/fit.py"]);
    expect(written.removed).toEqual([]);
    expect(written.changed).toEqual(["guide"]);
    expect(written.unkept).toEqual([]);
  });

  it("says what the reference's state lacks, so its absence is not read as the new harness's addition", () => {
    expect(writtenAgainst(keep("bare", null, {}), fresh).unkept).toEqual(["tool tree", "guide"]);
    expect(writtenAgainst(join(room, "absent"), fresh).unkept).toEqual(["state"]);
  });
});

describe("partsLines", () => {
  const rows = solveRows(events, "g-1") ?? [];
  const written = writtenAgainst(
    keep("old2", "guide one", {}),
    keep("new2", "guide two", { "lib/fit.py": "print(2)\n", "lib/buffer.js": "1\n" }),
  );
  const lines = partsLines(rows, { session: "g-1", old: "h-old", fresh: "h-new", paired: 2 }, written);
  const rowOf = (solve: string) => lines.find((line) => line.includes(`  ${solve}  `)) ?? "";

  it("takes the won task's solves on both sides only", () => {
    expect(rows.map(({ solve, side }) => [solve, side])).toEqual([
      ["n-1", "new"],
      ["o-1", "reference"],
    ]);
  });

  it("attributes a program run after a cd to that program, at the call that ran it", () => {
    expect(rowOf("n-1")).toContain("ran call 2");
    expect(rowOf("n-1")).toContain("fit.py");
  });

  it("counts no use where only the solver's words name the program, nor a longer file that contains its stem", () => {
    expect(rowOf("o-1")).toContain("ran -");
    expect(rowOf("o-1")).toContain("named -");
  });

  it("prints a side's count for each program, marking the ones the new harness added or changed", () => {
    expect(lines).toContain("  fit.py (added or changed)  new 1/1  reference 0/1");
    expect(lines).toContain("  buffer.js (added or changed)  new 0/1  reference 0/1");
    expect(lines).toContain("  mine.py  new 0/1  reference 1/1");
  });

  it("returns nothing for a comparison the log never reported", () => {
    expect(solveRows(events, "g-9")).toBeNull();
  });
});

describe("the program table", () => {
  // Twelve solves a side: all run `ls`, the new side `fit.py` in all, the reference `once.py` in one (programsOf names the script, not `python3`).
  const call = (solve: string, command: string): Call => ({
    part: "call",
    index: 0,
    at: "2026-11-06T00:00:00.000Z",
    seat: "solve",
    id: solve,
    callId: null,
    turn: 0,
    tool: "bash",
    args: { command },
    isError: false,
    text: "",
    ms: 1,
  });
  const rows = (["new", "reference"] as const).flatMap((side) =>
    Array.from({ length: 12 }, (_, at) => {
      const solve = `${side}-${String(at)}`;
      const own = side === "new" ? ["python3 fit.py"] : at === 0 ? ["python3 once.py"] : [];
      return {
        task: "v-1",
        side,
        solve,
        valid: true,
        objective: null,
        ending: "pass",
        calls: [call(solve, "ls"), ...own.map((command) => call(solve, command))],
      };
    }),
  );
  const tableOf = (table: "all" | "parted") =>
    partsLines(rows, { session: "g-1", old: "h-old", fresh: "h-new", paired: 1 }, null, table).filter(
      (line) => line.startsWith("  "),
    );

  it("leaves out a program both sides ran alike and one side's one-off script, and says how many", () => {
    expect(tableOf("parted").map((line) => line.trim().split(" ")[0])).toEqual(["fit.py"]);
    const head = partsLines(rows, { session: "g-1", old: "h-old", fresh: "h-new", paired: 1 }, null).find(
      (line) => line.startsWith("Solves a side"),
    );
    expect(head).toContain("2 of 3 programs left out");
    expect(head).toContain("1 run by as many solves on each side");
    expect(head).toContain("new 0, reference 1");
  });

  it("prints every program with --all", () => {
    expect(tableOf("all")).toHaveLength(3);
  });
});

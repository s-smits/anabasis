// Lane 15's provenance: where each leaf of a judged answer first appears, verbatim. Every number and
// task here is invented, and no test reads a real campaign.
import { afterAll, describe, expect, it } from "bun:test";
import type { EventKind, LogEvent } from "#src/kernel/log.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "#src/meta/filesystem.ts";
import { isNumber, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { tmpdir } from "#src/meta/os.ts";
import { join } from "#src/meta/path.ts";
import { requireJsonValue } from "#src/meta/stable-json.ts";
import { conditionId, settingId } from "#src/kernel/condition.ts";
import {
  heldAt,
  holderOf,
  leavesOf,
  provenanceLines,
  provenanceOf,
  type Row,
  winsOf,
} from "#tools/wri/provenance.ts";
import { conditionOf } from "./helpers/logged-round.ts";

interface Solved {
  readonly solve: string;
  readonly harness: string;
  readonly task: string;
  readonly answer: JsonValue;
  readonly calls?: readonly { tool: string; args: JsonValue; text: string }[];
  readonly turns?: readonly string[];
  readonly comparison?: string;
}

const room = mkdtempSync(join(tmpdir(), "wri-provenance-"));
const log = join(room, "log.jsonl");
afterAll(() => rmSync(room, { recursive: true, force: true }));

let clock = 0;
const event = (kind: EventKind, data: JsonObject): LogEvent => {
  clock += 1;
  return { at: new Date(Date.UTC(2026, 10, 5) + clock * 1000).toISOString(), kind, data };
};

/** A kept state for `harness` beside the log: its guide and one program of its tool tree. */
function keep(harness: string, guide: string, program: string): void {
  const state = join(room, "states", harness);
  mkdirSync(join(state, "agent"), { recursive: true });
  mkdirSync(join(state, ".toolchain", "bin"), { recursive: true });
  writeFileSync(join(state, "agent", "BUILT_AGENTS.md"), guide);
  writeFileSync(join(state, ".toolchain", "bin", "fit.py"), program);
}

/** One solve's events: its condition, start, turns and calls, end and verdict. */
function solved({ solve, harness, task, answer, calls = [], turns = [], comparison }: Solved): LogEvent[] {
  const condition = conditionOf(task, harness);
  const id = conditionId(condition);
  return [
    event("condition.recorded", { id, condition: requireJsonValue(condition) }),
    event("solve.started", {
      solve,
      condition: id,
      task,
      ...keyIfDefined("comparison", comparison),
    }),
    ...turns.map((text, turn) => event("solve.turn", { solve, turn, text })),
    ...calls.map((call, at) => event("solve.call", { solve, turn: at, isError: false, ms: 10, ...call })),
    event("solve.call", {
      solve,
      turn: calls.length,
      tool: "submit",
      args: {},
      text: "ok",
      isError: false,
      ms: 1,
    }),
    event("solve.finished", { solve, ending: { outcome: "pass" } }),
    event("verdict", { solve, task, kind: "pass", answer }),
  ];
}

const proposed = (version: string, publicInput: JsonValue, hidden: JsonValue = null) => [
  event("task.proposed", {
    version,
    taskId: version,
    session: "x-1",
    task: { taskId: version, family: "fam", publicInput, hidden },
  }),
  event("task.gate", { version, gate: 1, outcome: "passed" }),
];

const firstOf = (row: Row | undefined, position: string) =>
  row?.found.find(({ leaf }) => leaf.position === position)?.first?.source ?? "nowhere";

describe("matching", () => {
  it("finds a number a program printed at more digits than the answer, where a substring search misses it", () => {
    const holder = holderOf("estimate 0.12345678 done");
    expect("estimate 0.12345678 done".includes("0.1235")).toBe(false);
    expect(heldAt(holder, { position: "$", value: 0.1235, size: 4 })).toBe(4);
  });

  it("finds an answer more precise than the printed value at the printed digits, and no lower than three", () => {
    expect(heldAt(holderOf("x = 0.1235"), { position: "$", value: 0.12345678, size: 8 })).toBe(4);
    expect(heldAt(holderOf("x = 0.12"), { position: "$", value: 0.12345678, size: 8 })).toBeNull();
  });

  it("matches a short number only as written, and never inside a longer one", () => {
    expect(heldAt(holderOf("rows 21 and 12"), { position: "$", value: 2, size: 1 })).toBeNull();
    expect(heldAt(holderOf("take 2 rows"), { position: "$", value: 2, size: 1 })).toBe(1);
  });

  it("walks a structured answer and a table's cells, keeping strings and numbers", () => {
    const leaves = leavesOf({
      files: { "out/a.csv": "name,score\nalpha,3.25\n", "out/b.json": '{"k":[1.5,"beta"]}' },
    });
    expect(leaves.map(({ position, value }) => [position, isNumber(value) ? "number" : "string"])).toEqual([
      ["out/a.csv:1:1", "string"],
      ["out/a.csv:1:2", "string"],
      ["out/a.csv:2:1", "string"],
      ["out/a.csv:2:2", "number"],
      ["out/b.json:$.k[0]", "number"],
      ["out/b.json:$.k[1]", "string"],
    ]);
    expect(leavesOf({ total: 7.125, parts: [{ name: "gamma" }] }).map(({ position }) => position)).toEqual([
      "$.total",
      "$.parts[0].name",
    ]);
  });
});

describe("provenanceOf", () => {
  keep("h-new", "guide text, step 0.5", "WIDTH = 0.2417\nprint(x)\n");
  const practiceSolve = solved({
    solve: "p-1",
    harness: "h-old",
    task: "v-practice",
    answer: { total: 1 },
  });
  const events: LogEvent[] = [
    ...proposed("v-practice", { rows: [4.8125] }),
    ...proposed("v-1", { rows: [3.5, 7.75] }, { truth: 6.0625 }),
    event("task.state", { version: "v-practice", state: "released" }),
    ...practiceSolve.map((each) =>
      each.kind === "verdict" ? { ...each, data: { ...each.data, objective: 0.2417 } } : each,
    ),
    ...solved({
      solve: "s-new",
      harness: "h-new",
      task: "v-1",
      comparison: "g-1",
      answer: { files: { "out/r.csv": "a,b,c,d,e,f\n3.5,0.1235,9.8765,0.2417,6.0625,2\n" } },
      turns: ["I will compute it; take 2 rows."],
      calls: [
        { tool: "bash", args: { command: "python3 fit.py" }, text: "mean 3.5 est 0.12345678" },
        { tool: "bash", args: { command: "fit --out out/r.csv" }, text: "" },
      ],
    }),
    ...proposed("v-late", { rows: [9.8765] }),
    event("task.state", { version: "v-late", state: "released" }),
  ];
  const [row] = provenanceOf(events, log, [{ solve: "s-new", side: "new" }]);

  it("counts a value the public input holds under the input, though a later call printed it", () => {
    expect(firstOf(row, "out/r.csv:2:1")).toBe("input");
  });

  it("finds a rounded value in the call output that printed it at more digits", () => {
    const found = row?.found.find(({ leaf }) => leaf.position === "out/r.csv:2:2");
    expect(found?.first?.source).toBe("call-output");
    expect(found?.first?.where).toContain("call 1");
    expect(found?.precision).toBe(4);
  });

  it("reads a value a program wrote straight to the file as nowhere, and names that call as the last to name it", () => {
    expect(firstOf(row, "out/r.csv:2:3")).toBe("nowhere");
    expect(row?.writers).toEqual([{ file: "out/r.csv", call: 2, ran: "bash(fit)" }]);
  });

  it("reads a value only the tool source holds there, and says the practice measures held it too", () => {
    const found = row?.found.find(({ leaf }) => leaf.position === "out/r.csv:2:4");
    expect(found?.first?.source).toBe("tool-src");
    expect([...(found?.held ?? [])].toSorted()).toEqual(["practice-measure", "tool-src"]);
  });

  it("keeps a value of the hidden values apart from the first source", () => {
    const found = row?.found.find(({ leaf }) => leaf.position === "out/r.csv:2:5");
    expect(found?.first).toBeNull();
    expect(found?.held.has("hidden")).toBe(true);
  });

  it("finds a short number in the solver's own words, with how many places hold it", () => {
    const found = row?.found.find(({ leaf }) => leaf.position === "out/r.csv:2:6");
    expect(found?.first?.source).toBe("turn-text");
    expect(found?.leaf.size).toBe(1);
    expect(found?.holders).toBe(1);
  });

  it("counts a practice task's input released before the harness was first set to solve, and none after", () => {
    const early = [...events.slice(-3), ...events.slice(0, -3)];
    const [before] = provenanceOf(early, log, [{ solve: "s-new", side: "new" }]);
    expect(firstOf(before, "out/r.csv:2:3")).toBe("practice-input");
  });

  it("prints counts and positions and none of the answer's values", () => {
    const text = provenanceLines(provenanceOf(events, log, [{ solve: "s-new", side: "new" }]), "all").join(
      "\n",
    );
    for (const value of ["0.1235", "9.8765", "0.2417", "6.0625", "3.5"]) expect(text).not.toContain(value);
    expect(text).toContain("out/r.csv:2:5");
  });
});

describe("winsOf", () => {
  it("takes the tasks the report recorded as won and both sides' solves of them", () => {
    const one = (solve: string, harness: string, task: string) =>
      solved({ solve, harness, task, comparison: "g-1", answer: { x: 1 } });
    const events = [
      ...proposed("v-1", {}),
      ...proposed("v-2", {}),
      ...one("o-1", "h-old", "v-1"),
      ...one("n-1", "h-new", "v-1"),
      ...one("o-2", "h-old", "v-2"),
      ...one("n-2", "h-new", "v-2"),
      event("comparison.reported", {
        session: "g-1",
        old: "h-old",
        fresh: "h-new",
        setting: settingId(conditionOf("any", "any")),
        solves: 1,
        versions: ["v-1", "v-2"],
        scored: { wins: 1, losses: 0, ties: 1 },
        frontier: { differences: [0, 300], of: ["v-1", "v-2"] },
      }),
    ];
    expect(winsOf(events, "g-9")).toBeNull();
    const asked = winsOf(events, "g-1") ?? [];
    expect(asked).toEqual([
      { solve: "n-2", side: "new" },
      { solve: "o-2", side: "reference" },
    ]);
  });
});

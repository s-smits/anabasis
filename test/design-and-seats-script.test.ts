// Check import reach, relevant wall tests, aggregate Examiner views and what a Builder opening is
// told of the past, without exposing task data.
import { afterAll, describe, expect, it } from "bun:test";
import { formatBuilderView } from "#skills/design-and-seats/scripts/builder-view.ts";
import { examinerCounts } from "#skills/design-and-seats/scripts/examiner-view.ts";
import { absentFrom, SEATS, seatLines, seatsOf } from "#skills/design-and-seats/scripts/seat-view.ts";
import { type Condition, conditionId } from "../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { keyIfNotNull } from "../src/meta/optional-key.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-seat-view-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const REPO = join(import.meta.dir, "..");

function tree(files: Readonly<Record<string, string>>): string {
  const at = mkdtempSync(join(root, "tree-"));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(at, path)), { recursive: true });
    writeFileSync(join(at, path), text);
  }
  return at;
}

const graph =
  (edges: Readonly<Record<string, readonly string[]>>) =>
  (file: string): readonly string[] =>
    edges[file] ?? [];

const runLine = (lines: readonly string[]) =>
  (lines.find((line) => line.startsWith("run: bun run test -- ")) ?? "").split(" ").slice(5);

describe("the seat view", () => {
  it("selects a seat's wall tests when one changes and selects none for unrelated files", () => {
    const [test = { file: "" }] = SEATS.Referee.tests;
    const touched = seatLines([test.file], seatsOf([test.file], graph({})));
    expect(runLine(touched)).toStrictEqual([test.file]);
    const none = seatLines(
      ["docs/plan.md", "src/meta/text.ts"],
      seatsOf(["docs/plan.md", "src/meta/text.ts"], graph({})),
    );
    expect(runLine(none)).toStrictEqual([]);
    expect(none.some((line) => line.includes("src 1") && line.includes("docs 1"))).toBe(true);
  });

  it("validates current owners and wall tests and reports missing or renamed entries", () => {
    expect(absentFrom(REPO)).toStrictEqual([]);
    const named = Object.values(SEATS).flatMap((entry) => [
      ...entry.owners,
      ...entry.tests.map(({ file }) => file),
    ]);
    const empty = tree({});
    expect(new Set(absentFrom(empty))).toStrictEqual(new Set(named));
    const [first = { file: "", name: "" }] = SEATS.solver.tests;
    const renamed = tree({ [first.file]: `it("${first.name} once reworded", () => {});\n` });
    expect(absentFrom(renamed).some((line) => line.startsWith(`${first.file}: `))).toBe(true);
  });
});

describe("the Examiner's view in counts", () => {
  /** Exam-side text no line of the view's counts may carry: a hidden value and a refusal's reason. */
  const HIDDEN = "hidden-canary-3b9";
  const REASON = "reason-canary-3b9";

  function admitted(): LogEvent[] {
    const events: LogEvent[] = [];
    const add = (kind: EventKind, data: JsonObject) =>
      events.push({ at: "2026-10-30T00:00:00.000Z", kind, data });
    const draft = (taskId: string, gate: JsonObject) => {
      const task = { taskId, family: "fixture", publicInput: {}, hidden: { value: HIDDEN } };
      add("task.proposed", { version: `v-${taskId}`, taskId, task });
      add("task.gate", { version: `v-${taskId}`, gate: 1, ...gate });
      if (gate.outcome === "refused") add("task.state", { version: `v-${taskId}`, state: "refused" });
    };
    draft("some", { outcome: "passed", reference: { valid: 1, solves: 3, billed: 0 } });
    draft("yours", { outcome: "passed", reference: { valid: 0, solves: 3, billed: 0 } });
    draft("every", { outcome: "passed", reference: { valid: 3, solves: 3, billed: 0 } });
    draft("closed", { outcome: "refused", reason: REASON, reference: { valid: 3, solves: 3, billed: 0 } });
    draft("cut", {
      outcome: "refused",
      reason: REASON,
      reference: { valid: 0, solves: 1, ran: 3, billed: 0 },
    });
    return events;
  }

  it("counts the tasks under each heading, without exposing hidden values or refusal reasons", () => {
    const lines = examinerCounts(admitted());
    expect(lines.find((line) => line.startsWith("blocks: "))).toContain('3 under "Not yet compared');
    expect(lines).toContain("promotion: none");
    for (const canary of [HIDDEN, REASON]) expect(lines.join("\n")).not.toContain(canary);
  });
});

describe("Builder history messages", () => {
  /** A held-out task's id and hidden value, neither of which may reach a Builder. */
  const HELD = "held-canary-7c1";
  const HIDDEN = "hidden-canary-7c1";
  const [STARTER, BUILT] = ["0".repeat(64), "a".repeat(64)];

  function past(): LogEvent[] {
    const events: LogEvent[] = [];
    const add = (kind: EventKind, data: JsonObject) =>
      events.push({ at: `2026-10-30T00:${String(events.length).padStart(2, "0")}:00.000Z`, kind, data });
    for (const [version, taskId, state] of [
      ["v-p", "t-practice", "released"],
      ["v-h", HELD, "held"],
    ] as const) {
      add("task.proposed", { version, taskId, task: { taskId, publicInput: {}, hidden: { value: HIDDEN } } });
      add("task.gate", {
        version,
        gate: 1,
        outcome: "passed",
        reference: { valid: 1, solves: 3, billed: 0 },
      });
      add("task.state", { version, state });
    }
    let solves = 0;
    const solved = (task: string, harness: string, comparison: string | null) => {
      const condition: Condition = {
        contract: "c1",
        harness,
        task,
        model: "faux/solver",
        effort: "medium",
        prices: { "faux/solver": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
        runtime: {},
        compaction: "off",
        solverTools: "s1",
        verifierTools: "t1",
        sandbox: "p1",
        limits: {
          wallSeconds: 480,
          turns: 24,
          shellDefaultSeconds: 120,
          shellMaxSeconds: 240,
          concurrency: 4,
        },
        host: "h1",
        side: "test",
      };
      const [id, solve] = [conditionId(condition), `s-${String((solves += 1))}-1`];
      add("condition.recorded", { id, condition: requireJsonValue(condition) });
      add("solve.started", { solve, condition: id, ...keyIfNotNull("comparison", comparison) });
      add("solve.finished", {
        solve,
        ending: { outcome: "fail", kind: "rejected" },
        turns: 3,
        seconds: 9,
        billed: 1,
      });
      add("referee.finding", { solve, ruling: "solver-fail" });
    };
    add("build.started", { session: "b-1", parent: STARTER, tasks: ["v-p"] });
    solved("v-p", BUILT, null);
    add("build.finished", {
      session: "b-1",
      ended: "wall",
      harness: BUILT,
      changed: true,
      practiceSolves: 1,
    });
    add("comparison.started", {
      session: "g-1",
      old: STARTER,
      fresh: BUILT,
      starter: STARTER,
      tasks: ["v-h"],
    });
    solved("v-h", BUILT, "g-1");
    add("comparison.reported", {
      session: "g-1",
      old: STARTER,
      fresh: BUILT,
      starter: STARTER,
      versions: ["v-h"],
      reading: "no-step",
      scored: { wins: 0, losses: 1, ties: 0, p: 1, unsolved: 0 },
      valid: { old: [1, 0, 0], fresh: [0, 0, 1] },
      aside: [],
    });
    return events;
  }

  it("excludes held-out tasks, hidden values, rulings and held-out solve ids", () => {
    const told = formatBuilderView(past()).join("\n");
    for (const canary of [HELD, HIDDEN, "solver-fail", "s-2-1"]) expect(told).not.toContain(canary);
  });
});

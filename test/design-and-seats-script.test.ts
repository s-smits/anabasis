// Check import reach, relevant wall tests, aggregate Examiner views and what a Builder opening is
// told of the past, without exposing task data.
import { afterAll, describe, expect, it } from "bun:test";
import { builderTold } from "#skills/design-and-seats/scripts/builder-view.ts";
import { examinerCounts } from "#skills/design-and-seats/scripts/examiner-view.ts";
import {
  absentFrom,
  importsIn,
  SEATS,
  seatLines,
  seatsOf,
} from "#skills/design-and-seats/scripts/seat-view.ts";
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

/** A graph given as a table, for the reach without a tree. */
const graph =
  (edges: Readonly<Record<string, readonly string[]>>) =>
  (file: string): readonly string[] =>
    edges[file] ?? [];

const reachOfSeat = (reaches: ReturnType<typeof seatsOf>, seat: string) =>
  reaches.find((each) => each.seat === seat);
const runLine = (lines: readonly string[]) =>
  (lines.find((line) => line.startsWith("run: bun run test -- ")) ?? "").split(" ").slice(5);

describe("the seat view", () => {
  it("resolves repository imports and excludes runtime, package and missing imports", () => {
    const at = tree({
      "src/a.ts": 'import "./b.ts";\nimport "node:fs";\nimport "./missing.ts";\nimport "left-pad";\n',
      "src/b.ts": 'import { a } from "./a.ts";\nexport const b = a;\n',
      "notes.md": "import './a.ts'",
    });
    const importsOf = importsIn(at);
    expect(importsOf("src/a.ts")).toStrictEqual(["src/b.ts"]);
    expect(importsOf("src/b.ts")).toStrictEqual(["src/a.ts"]);
    expect(importsOf("notes.md")).toStrictEqual([]);
  });

  it("finds the shortest import chain through cycles and excludes unreachable seats", () => {
    const [owner = ""] = SEATS.Builder.owners;
    const importsOf = graph({
      [owner]: ["src/long.ts", "src/kernel/fold.ts"],
      "src/long.ts": ["src/longer.ts"],
      "src/longer.ts": ["src/kernel/target.ts", owner],
      "src/kernel/fold.ts": ["src/kernel/target.ts"],
    });
    const changed = ["src/kernel/target.ts", "docs/plan.md"];
    const reaches = seatsOf(changed, importsOf);
    expect(reachOfSeat(reaches, "Builder")?.files).toStrictEqual([
      { file: "src/kernel/target.ts", chain: [owner, "src/kernel/fold.ts", "src/kernel/target.ts"] },
    ]);
    for (const seat of ["solver", "Examiner", "Referee"]) {
      expect(reachOfSeat(reaches, seat)?.files).toStrictEqual([]);
    }
    const lines = seatLines(changed, reaches);
    expect(runLine(lines).toSorted()).toStrictEqual(
      [...new Set(SEATS.Builder.tests.map(({ file }) => file))].toSorted(),
    );
    expect(lines.some((line) => line.includes("docs 1"))).toBe(true);
  });

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

  it("traces current seat owners and includes campaign tools only in the Builder view", () => {
    const reaches = seatsOf(
      [...SEATS.Builder.owners, ...SEATS.solver.owners, "src/kernel/log.ts"],
      importsIn(REPO),
    );
    const filesOf = (seat: string) => reachOfSeat(reaches, seat)?.files.map(({ file }) => file) ?? [];
    for (const [seat, owners] of [
      ["Builder", SEATS.Builder.owners],
      ["solver", SEATS.solver.owners],
    ] as const) {
      for (const file of [...owners, "src/kernel/log.ts"]) expect(filesOf(seat)).toContain(file);
    }
    expect(filesOf("solver")).not.toContain("tools/d2/campaign-actions.ts");
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

  it("counts admission outcomes and room sources without exposing hidden values or refusal reasons", () => {
    const lines = examinerCounts(admitted());
    const summary = lines.find((line) => line.startsWith("summary: ")) ?? "";
    for (const fact of [
      "held out 3 drafts",
      "1 on validity",
      "1 on an answer of yours",
      "1 on the objective alone",
      "refused 1 draft",
    ]) {
      expect(summary).toContain(fact);
    }
    expect(lines.some((line) => line.includes("1 group") && line.includes("1 interrupted draft"))).toBe(true);
    expect(lines.some((line) => line.startsWith("promotion: none"))).toBe(true);
    for (const canary of [HIDDEN, REASON]) expect(lines.join("\n")).not.toContain(canary);
  });

  it("reports absent measurements and identifies the comparison supporting a promotion", () => {
    expect(examinerCounts([]).filter((line) => line.endsWith(": none"))).toHaveLength(3);
    const promoted = [
      ...admitted(),
      {
        at: "2026-10-30T01:00:00.000Z",
        kind: "harness.promoted",
        data: { harness: "h2", rests: [{ comparison: "g-9" }] },
      },
    ] satisfies LogEvent[];
    const lines = examinerCounts(promoted);
    expect(lines.find((line) => line.startsWith("promotion: "))).toContain("g-9");
    // Admissions before the promotion measured the replaced reference, so the summary holds none of them.
    expect(lines.find((line) => line.startsWith("summary: "))).toBe("summary: none");
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
      add("referee.finding", { solve, ruling: "earned" });
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

  it("uses production messages for the next session, harness provenance, comparisons and practice failures", () => {
    const lines = builderTold(past());
    expect(lines[0]).toBe("session b-2, 1 released tasks");
    expect(lines[1]).toMatch(/aaaaaaaa.*\bb-1\b.*time limit/su);
    expect(lines).toContain("comparisons (1):");
    expect(lines.find((line) => line.startsWith("- Harness aaaaaaaa"))).toMatch(
      /0 won, 1 lost, 0 tied.*no step/u,
    );
    expect(lines).toContain("failed practice solves on released tasks (1):");
    expect(lines.find((line) => line.startsWith("- s-1-1"))).toContain("t-practice");
  });

  it("excludes held-out tasks, hidden values, rulings and held-out solve ids", () => {
    const told = builderTold(past()).join("\n");
    for (const canary of [HELD, HIDDEN, "earned", "s-2-1"]) expect(told).not.toContain(canary);
  });

  it("handles an empty harness history and honours an explicit parent", () => {
    expect(builderTold([])).toStrictEqual([
      "session b-1, 0 released tasks",
      "start: the log names no harness yet",
      "comparisons (0):",
      "failed practice solves on released tasks (0):",
    ]);
    expect(builderTold(past(), STARTER)[1]).toMatch(/00000000.*no Builder session/u);
  });
});

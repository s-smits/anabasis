// The task-by-task table of every comparison (`pairs.ts`): each row reads its own pair, never a score
// by its place in a list, and a task the report did not tally keeps a row. Invented logs only.
import { describe, expect, it } from "bun:test";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import { asRecord, isString, type JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { pairRows, tieKind } from "../tools/wri/pairs.ts";
import { roundSolves } from "./helpers/logged-round.ts";

const HEAD = "comparison\tread\tpart\ttask";
const event = (kind: EventKind, data: JsonObject): LogEvent => ({
  at: "2026-11-05T00:00:00.000Z",
  kind,
  data,
});

/** One comparison of the tasks `outcomes` spells ("PF PP"), each solve's measure in `measures` by task
 *  (the reference's two first), started on `tasks` with `retained`, its report carrying `more`. */
function comparison(
  outcomes: Readonly<Record<string, string>>,
  options: {
    readonly measures?: Readonly<Record<string, readonly number[]>>;
    readonly tasks?: readonly string[];
    readonly retained?: readonly string[];
    readonly versions?: readonly string[];
    readonly more?: JsonObject;
    readonly reported?: boolean;
  } = {},
): LogEvent[] {
  const { events, terms } = roundSolves("g-1", ["h1", "h2"], outcomes);
  // Each solve's task, by the condition its start names, in the order the round logged them.
  const conditions = new Map(
    events.flatMap(({ kind, data }) => {
      const task = asRecord(data.condition)?.task;
      return kind === "condition.recorded" && isString(data.id) && isString(task)
        ? [[data.id, task] as const]
        : [];
    }),
  );
  const order = new Map<string, number>();
  const verdicts = events.flatMap(({ kind, data }) => {
    if (kind !== "solve.started" || !isString(data.solve) || !isString(data.condition)) return [];
    const task = conditions.get(data.condition) ?? "";
    const at = order.get(task) ?? 0;
    order.set(task, at + 1);
    const objective = keyIfDefined("objective", options.measures?.[task]?.[at]);
    return [event("verdict", { solve: data.solve, kind: "pass", ...objective })];
  });
  const versions = options.versions ?? Object.keys(outcomes);
  const start = event("comparison.started", {
    session: "g-1",
    old: "h1",
    fresh: "h2",
    starter: "h0",
    tasks: [...(options.tasks ?? versions)],
    retained: [...(options.retained ?? [])],
  });
  const report = event("comparison.reported", {
    session: "g-1",
    old: "h1",
    fresh: "h2",
    starter: "h0",
    reading: "no-step",
    level: 0.02,
    scored: { wins: 0, losses: 0, ties: 0 },
    ...terms,
    versions: [...versions],
    objective: { measure: "m", direction: "lower" },
    ...options.more,
  });
  const proposed = Object.keys(outcomes).flatMap((task) => [
    event("task.proposed", { version: task, taskId: task, session: "e-1", family: "fam" }),
    event("task.gate", { version: task, gate: 1, outcome: "passed" }),
  ]);
  return [...proposed, start, ...events, ...verdicts, ...(options.reported === false ? [] : [report])];
}

/** The row of `task`, split into its columns by the header's names. */
function rowOf(rows: readonly string[], task: string): Record<string, string> {
  const head = (rows.find((row) => row.startsWith(HEAD)) ?? "").split("\t");
  const row = rows.find((one) => one.split("\t")[3] === task)?.split("\t") ?? [];
  return Object.fromEntries(head.map((name, at) => [name, row[at] ?? ""]));
}

describe("pairs", () => {
  it("reads each task's own score where the report lists the retained task before the frontier", () => {
    // A naive reader that zips the start's tasks with the report's scores by position puts c's win on a.
    const rows = pairRows(
      comparison(
        { a: "PP PP", b: "FF FF", c: "FF PP" },
        { tasks: ["a", "b", "c"], retained: ["c"], versions: ["c", "a", "b"] },
      ),
    );
    const [a, b, c] = [rowOf(rows, "a"), rowOf(rows, "b"), rowOf(rows, "c")];
    expect([c.part, a.part, b.part]).toEqual(["retained", "frontier", "frontier"]);
    expect(Number(c.diff)).toBeGreaterThan(0);
    expect([a.diff, b.diff, c.tie]).toEqual(["0", "0", "-"]);
    expect(b.tie).toBe("both-invalid");
    expect(rows.at(-1)).toContain("tallied 3 (frontier 2, retained 1)");
  });

  it("calls a tie of cancelling validity cancelling and never an exact repeat", () => {
    const rows = pairRows(comparison({ t: "PF PF" }, { measures: { t: [5, 5, 5, 5] } }));
    expect(rowOf(rows, "t").tie).toBe("cancelling");
    expect(rowOf(rows, "t").flips).toBe("1/1");
  });

  it("tells a tie within the floor from an exact repeat and from margins past it", () => {
    const tied = (measures: readonly number[]) =>
      tieKind({
        task: "t",
        old: [true, true],
        fresh: [true, true],
        objective: { direction: "lower", old: measures.slice(0, 2), fresh: measures.slice(2) },
      });
    expect(tied([100, 100, 100, 100])).toBe("exact-repeat");
    expect(tied([100, 100, 100.5, 100.9])).toBe("within-room");
    expect(tied([100, 100, 100, 101.1])).toBeNull();
    // Two pairings past the floor each way cancel to a zero score.
    expect(tied([100, 110, 100, 110])).toBe("cancelling");
  });

  it("names an opening task's writer and the Examiner session of a written one, and no bill as -", () => {
    const events = comparison({ t: "PP FF" });
    const opening = events.map((one) =>
      one.kind === "task.proposed" ? { ...one, data: { version: "t", taskId: "t" } } : one,
    );
    const row = rowOf(pairRows(opening), "t");
    expect([row.writer, row.family, row.billed]).toEqual(["the opening exam", "-", "-"]);
    expect(rowOf(pairRows(events), "t").writer).toBe("e-1");
  });

  it("keeps a row for a task set aside, one the cap left short and one no list names", () => {
    const rows = pairRows(
      comparison(
        { t: "PP FF", u: "PF PF" },
        { tasks: ["t", "u", "v", "w"], versions: ["t"], more: { aside: ["u"], short: ["v"], capped: true } },
      ),
    );
    expect(["t", "u", "v", "w"].map((task) => rowOf(rows, task).part)).toEqual([
      "frontier",
      "aside",
      "short",
      "unpaired",
    ]);
    expect(rowOf(rows, "u").old).toBe("pass,rejected");
    expect(rowOf(rows, "v").old).toBe("-");
    expect(rows.at(-1)).toContain("tallied 1 (frontier 1, retained 0), aside 1, short 1, unpaired 1");
  });

  it("prints an open comparison's tasks with each side's solves and no score", () => {
    const rows = pairRows(comparison({ t: "PP FP" }, { reported: false }));
    expect(rowOf(rows, "t").part).toBe("open");
    expect(rowOf(rows, "t").new).toBe("rejected,pass");
    expect(rowOf(rows, "t").diff).toBe("-");
    expect(rows.at(-1)).toBe("== g-1 candidate open: no report; 1 tasks named at its start");
  });

  it("prints the stored A/A beside the rebuilt one, and says so where they differ", () => {
    // The reference's halves on t split one valid against one not; the stored control says 0.
    const rows = pairRows(comparison({ t: "PF PP" }, { more: { noise: { differences: [0] } } }));
    const row = rowOf(rows, "t");
    expect(row.aa_stored).toBe("0");
    expect(row.aa_rebuilt).not.toBe("0");
    expect(rows.at(-1)).toContain("stored differs from rebuilt on 1 of 1");
    const unaligned = pairRows(comparison({ t: "PF PP" }, { more: { noise: { differences: [0, 0] } } }));
    expect(unaligned[0]).toContain("the stored A/A of 1 reports is not recorded by task");
    expect(rowOf(unaligned, "t").aa_stored).toBe("-");
  });

  it("gives each task its own sides' ratio to its best on record, the right way up either direction", () => {
    const feasible = (version: string, measure: number, direction: string) =>
      event("task.feasible", { version, session: "e-1", objective: { measure, direction } });
    const lower = comparison(
      { t: "PP PP", u: "PP PP" },
      { measures: { t: [10, 10, 20, 20], u: [4, 4, 4, 4] } },
    );
    const rows = pairRows([...lower, feasible("t", 10, "lower")]);
    // The comparison's median would print one figure for both; each task gets its own, u has no best.
    expect([rowOf(rows, "t").x_best, rowOf(rows, "u").x_best]).toEqual(["1.00/2.00", "-/-"]);
    const higher = comparison(
      { t: "PP PP" },
      { measures: { t: [5, 5, 10, 10] }, more: { objective: { measure: "m", direction: "higher" } } },
    );
    expect(rowOf(pairRows([...higher, feasible("t", 10, "higher")]), "t").x_best).toBe("2.00/1.00");
  });

  it("counts each win against its own task's A/A, and a win with no A/A apart, never as outside it", () => {
    // a wins by less than its reference's halves differ, b by more than its A/A of 0.
    const line = (rows: readonly string[]) =>
      rows.find((row) => row.includes("against their own task's")) ?? "";
    expect(line(pairRows(comparison({ a: "PF PP", b: "FF PP", c: "PF PF" })))).toContain(
      "inside 1, level 0, outside 1, no A/A 0",
    );
    // Three solves a side leave no even halves, so no task has an A/A; a naive 0 would read outside.
    const odd = comparison({ a: "FFF PPP" }, { more: { solves: 3 } });
    expect(line(pairRows(odd))).toContain("inside 0, level 0, outside 0, no A/A 1");
  });

  it("tallies the first solves apart from the second as a description, never as a reading", () => {
    const outcomes = Object.fromEntries(
      Array.from({ length: 7 }, (_, at) => [`t${String(at)}`, "FF PF"] as const),
    );
    const summary = pairRows(comparison(outcomes)).at(-1) ?? "";
    expect(summary).toContain(
      "solve halves, a description and not a reading: first solves 7-0-0 p 0.0078, second solves 0-0-7 p 1.0000",
    );
    // A half whose p is under the level still names no step: only the comparison reads.
    expect(summary.split("solve halves")[1]).not.toMatch(/step/);
  });
});

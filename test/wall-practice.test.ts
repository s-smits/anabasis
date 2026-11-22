// Rule 3's practice readers, checked on every small campaign rather than on a chosen pair of them;
// the byte identity of the messages that carry them rests on test/builder.test.ts and
// test/builder-led.test.ts. The Builder hears each comparison as its tally and reading, so whatever
// it reads besides (the frontier
// it compares on, the practice it is owed, the tasks a release hands it) must be the same in every
// log that differs only in which held-out tasks the other harness answered, given that tally. Each
// log below holds the reference's and the other harness's solves of three tasks in one or two
// comparisons, with every outcome of two solves a side; logs with one reference record and one tally
// are grouped, and the Builder's view must be one value in each group.
import { describe, expect, it } from "bun:test";
import { practiceDue } from "../src/campaign/decide.ts";
import { scored } from "../src/kernel/compare.ts";
import { conditionId, settingId } from "../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import { lastReports, pairsReported, poolOf, releaseOrder } from "../src/kernel/reports.ts";
import { taskSets } from "../src/kernel/task.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { keysIf } from "../src/meta/optional-key.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { conditionOf } from "./helpers/logged-round.ts";

interface Campaign {
  readonly reference: readonly string[];
  readonly other: readonly string[];
  /** Each task's two objective measures a side, where its answers are valid. */
  readonly measures?: { readonly reference: readonly number[][]; readonly other: readonly number[][] };
  readonly comparisons: number;
  readonly extra: number;
}

/** One side's two solves of a task: P a pass, F a rejection ruled earned, D a rejection no ruling
 *  has settled, which sets the task aside. */
const OUTCOMES = ["PP", "PF", "FF", "FD"] as const;
type Outcome = (typeof OUTCOMES)[number];
const TASKS = ["a", "b", "c"];
const [REFERENCE, OTHER] = ["h1", "h2"];
const OBJECTIVE = { direction: "lower", margin: 0.01 };
const SETTING = settingId(conditionOf("any", "any"));
const event = (kind: EventKind, data: JsonObject): LogEvent => ({
  at: "2026-11-21T00:00:00.000Z",
  kind,
  data,
});
const heldOut = (version: string) => [
  event("task.proposed", { version, taskId: version }),
  event("task.gate", { version, gate: 1, outcome: "passed" }),
];

let solves = 0;
function solved(
  session: string,
  task: string,
  harness: string,
  outcome: string,
  measures: readonly number[],
) {
  const condition = conditionOf(task, harness);
  const id = conditionId(condition);
  return [
    event("condition.recorded", { id, condition: requireJsonValue(condition) }),
    ...outcome.split("").flatMap((letter, at) => {
      solves += 1;
      const solve = `s-${String(solves)}`;
      const passed = letter === "P";
      return [
        event("solve.started", { solve, condition: id, comparison: session }),
        event("solve.finished", {
          solve,
          ending: passed ? { outcome: "pass" } : { outcome: "fail", kind: "rejected" },
        }),
        ...(passed
          ? [event("verdict", { solve, kind: "pass", answer: {}, objective: measures[at] ?? 1 })]
          : []),
        ...(letter === "F" ? [event("referee.finding", { solve, ruling: "earned" })] : []),
      ];
    }),
  ];
}

function logOf({ reference, other, measures, comparisons, extra }: Campaign): LogEvent[] {
  const extras = Array.from({ length: extra }, (_, at) => `x${String(at)}`);
  return [
    ...[...TASKS, ...extras].flatMap(heldOut),
    ...Array.from({ length: comparisons }, (_, at) => `b-${String(at + 1)}`).flatMap((session) => [
      ...TASKS.flatMap((task, at) => [
        ...solved(session, task, REFERENCE, reference[at] ?? "", measures?.reference[at] ?? []),
        ...solved(session, task, OTHER, other[at] ?? "", measures?.other[at] ?? []),
      ]),
      event("comparison.reported", {
        session,
        old: REFERENCE,
        fresh: OTHER,
        starter: REFERENCE,
        reading: "no-step",
        scored: { wins: 0, losses: 0, ties: 0 },
        setting: SETTING,
        solves: 2,
        versions: TASKS,
        ...keysIf(measures !== undefined, () => ({ objective: OBJECTIVE })),
      }),
    ]),
  ];
}

/** The tally the Builder hears, as production reads it from the solves. */
function tallyOf(log: readonly LogEvent[]) {
  const { wins, losses, ties } = scored(lastReports(log).flatMap((report) => pairsReported(log, report)));
  return { wins, losses, ties };
}

/** Everything about practice and the draw that reaches the Builder. */
function builderView(log: readonly LogEvent[]) {
  const { held } = taskSets(log);
  const pool = poolOf(log);
  return {
    frontier: pool.frontier.length,
    owed: practiceDue(log, 1000, 0.1)?.to ?? null,
    practiceFrontier: pool.practiceFrontier.length,
    // A release of fewer tasks takes from the front of this order, so the whole order shows them all.
    released: releaseOrder(log, held, held.length, "seed").map(([version]) => version),
  };
}

const tuples = <T>(alphabet: readonly T[], length: number): T[][] =>
  length === 0 ? [[]] : tuples(alphabet, length - 1).flatMap((head) => alphabet.map((one) => [...head, one]));

/** The groups of campaigns that the Builder cannot tell apart, each with the views they gave. */
function groups(campaigns: readonly Campaign[]) {
  const found = new Map<string, { views: Set<string>; size: number }>();
  for (const campaign of campaigns) {
    const log = logOf(campaign);
    const key = JSON.stringify([
      campaign.reference,
      campaign.measures?.reference,
      campaign.comparisons,
      campaign.extra,
      tallyOf(log),
    ]);
    const group = found.get(key) ?? { views: new Set<string>(), size: 0 };
    group.views.add(JSON.stringify(builderView(log)));
    group.size += 1;
    found.set(key, group);
  }
  // A log no reader takes in would make every group agree, so the logs must reach the tally.
  expect(new Set([...found.keys()].map((key) => key.slice(key.lastIndexOf("{")))).size).toBeGreaterThan(4);
  return [...found.values()];
}

describe("what practice tells the Builder", () => {
  // Two comparisons, so that a task can be the reference's unanswered or easy one (two readings
  // each); first with no task held beyond the three, then with enough to leave practice an allowance.
  for (const extra of [0, 4]) {
    it(`is one value whichever tasks the other harness answered, every outcome of two solves a side, ${String(extra)} more held`, () => {
      // The reference's record is part of a group's key, so it is taken up to the naming of tasks;
      // the other harness's ranges over every record, which is where a group's members differ.
      const others: readonly Outcome[][] = tuples(OUTCOMES, TASKS.length);
      const references = others.filter((record) =>
        record.every((one, at) => at === 0 || (record[at - 1] ?? one) <= one),
      );
      const found = groups(
        references.flatMap((reference) =>
          others.map((other) => ({ reference, other, comparisons: 2, extra })),
        ),
      );
      expect(found.filter(({ views }) => views.size > 1).length).toBe(0);
      // The check has teeth only where a group holds campaigns that differ in which task was won.
      expect(found.filter(({ size }) => size > 1).length).toBeGreaterThan(100);
    });
  }

  it("is one value whichever task the other harness bettered by the objective, every answer valid", () => {
    const valid = TASKS.map(() => "PP");
    const pairs = [
      [10, 10],
      [5, 5],
      [20, 20],
    ];
    // As above, the reference's record is taken up to the naming of tasks.
    const ordered = (record: readonly number[][]) =>
      record.every((one, at) => at === 0 || (record[at - 1]?.[0] ?? 0) <= (one[0] ?? 0));
    const campaigns = [1, 2].flatMap((comparisons) =>
      tuples(pairs, TASKS.length)
        .filter(ordered)
        .flatMap((reference) =>
          tuples(pairs, TASKS.length).map((other) => ({
            reference: valid,
            other: valid,
            measures: { reference, other },
            comparisons,
            extra: 0,
          })),
        ),
    );
    const found = groups(campaigns);
    expect(found.filter(({ views }) => views.size > 1).length).toBe(0);
    expect(found.filter(({ size }) => size > 1).length).toBeGreaterThan(20);
  });
});

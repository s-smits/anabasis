// Logs for the readers of what a climb rests on (lanes 28 and 29): two promotions, each read
// against the starter on the tasks that chose it and on tasks written after it, and a step carried
// by the objective alone beside its own A/A.
import type { EventKind, LogEvent } from "../../src/kernel/log.ts";
import { flipP } from "../../src/kernel/compare.ts";
import { asRecord, type JsonObject } from "../../src/meta/json-shape.ts";
import { keyIfDefined } from "../../src/meta/optional-key.ts";
import { roundSolves } from "./logged-round.ts";

/** What the reference and the new side measured on every valid answer, lower being better. */
interface Measures {
  readonly old: number;
  readonly fresh: number;
}

const STARTER = "a".repeat(64);
const FIRST = "b".repeat(64);
const SECOND = "c".repeat(64);
const AT = "2026-10-30T00:00:00.000Z";
const LOST = "FF PP";
const WON = "PP FF";

const at = (kind: EventKind, data: JsonObject): LogEvent => ({ at: AT, kind, data });
const named = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, nth) => `${prefix}${String(nth)}`);
const spelled = (tasks: readonly string[], outcome: string) =>
  Object.fromEntries(tasks.map((task) => [task, outcome]));

/** Tasks proposed by `session`, or with the opening where none is named, each passing its gate. */
function gated(tasks: readonly string[], session?: string): LogEvent[] {
  return tasks.flatMap((version) => [
    at("task.proposed", {
      version,
      taskId: version,
      task: { taskId: version, family: "fixture", publicInput: {}, hidden: null },
      ...keyIfDefined("session", session),
    }),
    at("task.gate", { version, gate: 1, outcome: "passed" }),
  ]);
}

/** A tested set as a report records it. */
function tested(differences: readonly number[]): JsonObject {
  const count = (sign: number) => differences.filter((one) => Math.sign(one) === sign).length;
  return {
    wins: count(1),
    losses: count(-1),
    ties: count(0),
    p: flipP(differences),
    differences: [...differences],
  };
}

/** Comparison `session` of `sides` on `outcomes` ("FF PP": the new side valid on both solves, the
 *  reference on neither), read `reading`, with its A/A's differences and, where `measures` is given,
 *  the objective each valid answer measured. */
function compared(
  session: string,
  sides: readonly [string, string],
  outcomes: Readonly<Record<string, string>>,
  read: { reading: string; noise?: readonly number[]; measures?: Measures },
): LogEvent[] {
  const { events, terms } = roundSolves(session, sides, outcomes);
  const [old, fresh] = sides;
  const { reading, noise, measures } = read;
  let side: keyof Measures = "old";
  const solved = events.flatMap((event) => {
    if (event.kind === "condition.recorded") {
      side = asRecord(event.data.condition)?.harness === fresh ? "fresh" : "old";
    }
    const passed = event.kind === "solve.finished" && asRecord(event.data.ending)?.outcome === "pass";
    return measures === undefined || !passed
      ? [event]
      : [event, at("verdict", { solve: event.data.solve ?? "", kind: "pass", objective: measures[side] })];
  });
  const sign = (outcome: string) => (outcome === LOST ? 600 : outcome === WON ? -600 : 0);
  const differences = Object.values(outcomes).map((outcome) => (measures === undefined ? sign(outcome) : 15));
  return [
    at("comparison.started", { session, old, fresh, starter: STARTER }),
    ...solved,
    at("comparison.reported", {
      session,
      old,
      fresh,
      starter: STARTER,
      level: 0.02,
      reading,
      scored: tested(differences),
      noise: noise === undefined ? null : tested(noise),
      ...keyIfDefined("objective", measures === undefined ? undefined : { direction: "lower" }),
      ...terms,
    }),
  ];
}

/**
 * Two promotions, each chosen on seven tasks it won, then read against the starter: it wins those
 * seven again, and on the three tasks written since the starter's promotion it loses all three in
 * the first read and, as `later` says, all three or none in the second.
 */
export function chainLog(later: "lost" | "won"): LogEvent[] {
  const [opening, before, after, since] = [named("c", 7), named("e", 7), named("a", 3), named("b", 3)];
  return [
    ...gated(opening),
    ...compared("g-1", [STARTER, FIRST], spelled(opening, LOST), { reading: "step" }),
    at("harness.promoted", { harness: FIRST, from: STARTER, rests: [] }),
    ...gated(after, "x-1"),
    ...compared(
      "g-2",
      [FIRST, STARTER],
      { ...spelled(opening, WON), ...spelled(after, LOST) },
      { reading: "no-step" },
    ),
    ...gated(before, "x-2"),
    ...compared("g-3", [FIRST, SECOND], spelled(before, LOST), { reading: "step" }),
    at("harness.promoted", { harness: SECOND, from: FIRST, rests: [] }),
    ...gated(since, "x-3"),
    ...compared(
      "g-4",
      [SECOND, STARTER],
      { ...spelled(before, WON), ...spelled(since, later === "lost" ? LOST : WON) },
      { reading: "no-step" },
    ),
  ];
}

/**
 * A step on six tasks every solve of both sides answered validly, the new side's answers better by
 * `margin` of the reference's, beside an A/A whose largest difference is 20 points: a margin of 0.05
 * scores 15 points a task. With `validity`, the reference misses one solve of the first task.
 */
export function objectiveLog(margin: number, validity: "tied" | "split" = "tied"): LogEvent[] {
  const tasks = named("t", 6);
  const tied = spelled(tasks, "PP PP");
  const outcomes = validity === "split" ? { ...tied, t0: "PF PP" } : tied;
  return [
    ...gated(tasks),
    ...compared("g-1", [STARTER, FIRST], outcomes, {
      reading: "step",
      noise: [0, 20, -20, 0, 0, 0],
      measures: { old: 1, fresh: 1 - margin },
    }),
  ];
}

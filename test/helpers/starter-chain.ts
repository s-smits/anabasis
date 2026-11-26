// Logs for the readers of what a climb rests on (lanes 11 and 17): two promotions, each read
// against the starter on the tasks that chose it and on tasks written after it, and a step carried
// by the objective alone beside its own A/A.
import type { EventKind, LogEvent } from "../../src/kernel/log.ts";
import { flipP } from "../../src/kernel/compare.ts";
import { asRecord, isNumber, isString, type JsonObject } from "../../src/meta/json-shape.ts";
import { keyIfDefined } from "../../src/meta/optional-key.ts";
import { roundSolves } from "./logged-round.ts";

/** The reference's measures on its first and second valid answer of each task (or of `tasks`), and
 *  the new side's, lower being better. */
interface Measures {
  readonly old: readonly [number, number];
  readonly fresh: number | readonly [number, number];
  readonly tasks?: Readonly<Record<string, readonly [number, number]>>;
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
 *  reference on neither), read `reading`, with each valid answer's objective where `measures` is
 *  given. */
function compared(
  session: string,
  sides: readonly [string, string],
  outcomes: Readonly<Record<string, string>>,
  read: { reading: string; measures?: Measures },
): LogEvent[] {
  const { events, terms } = roundSolves(session, sides, outcomes);
  const [old, fresh] = sides;
  const { reading, measures } = read;
  let side: "old" | "fresh" = "old";
  let task = "";
  let nth = 0;
  const solved = events.flatMap((event) => {
    if (event.kind === "condition.recorded") {
      const condition = asRecord(event.data.condition);
      side = condition?.harness === fresh ? "fresh" : "old";
      task = isString(condition?.task) ? condition.task : "";
      nth = 0;
    }
    const passed = event.kind === "solve.finished" && asRecord(event.data.ending)?.outcome === "pass";
    if (event.kind === "solve.finished") nth += 1;
    if (measures === undefined || !passed) return [event];
    const each = side === "fresh" ? measures.fresh : (measures.tasks?.[task] ?? measures.old);
    const objective = isNumber(each) ? each : each[nth - 1];
    return [event, at("verdict", { solve: event.data.solve ?? "", kind: "pass", objective: objective ?? 0 })];
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
      noise: null,
      ...keyIfDefined("objective", measures === undefined ? undefined : { direction: "lower" }),
      ...terms,
    }),
  ];
}

/**
 * Two promotions, each chosen on seven tasks it won and read against the starter: it wins those
 * seven again, and of the three tasks written since the starter's promotion loses all three in the
 * first read and, as `later` says, all or none in the second.
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
 * A step on six tasks every solve answered validly, the new side measuring `1 - margin` against the
 * reference's 1 and 0.93, so its A/A differs by 21 points a task (a margin of 0.05 scores 4, and
 * 0.5 scores 144). "split" has the reference miss one solve of the first task; "flip" has both
 * sides miss their second solve of the last task, tying it in the comparison and splitting it at
 * 600 points in the A/A. `byTask` gives the reference other measures on the tasks it names.
 */
export function objectiveLog(
  margin: number | readonly [number, number],
  validity: "tied" | "split" | "flip" = "tied",
  byTask?: Measures["tasks"],
): LogEvent[] {
  const tasks = named("t", 6);
  const tied = spelled(tasks, "PP PP");
  const outcomes =
    validity === "split" ? { ...tied, t0: "PF PP" } : validity === "flip" ? { ...tied, t5: "PF PF" } : tied;
  return [
    ...gated(tasks),
    ...compared("g-1", [STARTER, FIRST], outcomes, {
      reading: "step",
      measures: {
        old: [1, 0.93],
        fresh: isNumber(margin) ? 1 - margin : [1 - margin[0], 1 - margin[1]],
        ...keyIfDefined("tasks", byTask),
      },
    }),
  ];
}

import { describe, expect, it } from "bun:test";
import { formatComparisonHistory, formatPracticeFailures, formatSessionStart } from "../src/builder/past.ts";
import { spent } from "../src/builder/session.ts";
import { recordsOf } from "../src/builder/tools.ts";
import { practiceDue } from "../src/campaign/decide.ts";
import { campaignOf } from "../src/campaign/handover.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import { poolOf, releaseOrder } from "../src/kernel/reports.ts";
import { taskSets } from "../src/kernel/task.ts";
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "../src/meta/json-shape.ts";
import { wriCampaign } from "./helpers/wri-campaign.ts";

const STRUCTURE: ReadonlySet<string> = new Set([
  "version",
  "taskId",
  "task",
  "session",
  "solve",
  "condition",
  "comparison",
  "reader",
  "turn",
  "outcome",
  "kind",
  "ruling",
  "gate",
  "state",
  "harness",
  "id",
]);

function heldSide(events: readonly LogEvent[]): (event: LogEvent) => boolean {
  const held = new Set(taskSets(events).held);
  const conditions = new Set(
    events.flatMap(({ kind, data }) => {
      const task = asRecord(data.condition)?.task;
      return kind === "condition.recorded" && isString(task) && held.has(task) && isString(data.id)
        ? [data.id]
        : [];
    }),
  );
  const solves = new Set(
    events.flatMap(({ kind, data }) =>
      kind === "solve.started" &&
      isString(data.condition) &&
      conditions.has(data.condition) &&
      isString(data.solve)
        ? [data.solve]
        : [],
    ),
  );
  const named = (value: JsonValue | undefined, within: ReadonlySet<string>) =>
    isString(value) && within.has(value);
  return ({ kind, data }) =>
    kind.startsWith("exam.") ||
    kind.startsWith("referee.") ||
    named(data.version, held) ||
    named(data.task, held) ||
    named(data.solve, solves);
}

function scrambled(value: JsonValue, key: string | null, changed: string[], path: string): JsonValue {
  const scalar = isString(value) || isNumber(value);
  if (key !== null && STRUCTURE.has(key) && scalar) return value;
  if (Array.isArray(value)) {
    return value.map((each, at) => scrambled(each, key, changed, `${path}[${String(at)}]`));
  }
  const record = asRecord(value);
  if (record !== null) {
    return Object.fromEntries(
      Object.entries(record).map(([name, each]) => [name, scrambled(each, name, changed, `${path}.${name}`)]),
    );
  }
  if (!scalar) return value;
  changed.push(path);
  return isString(value) ? `~${value}~` : value * 7 + 3;
}

function scrambledLog(events: readonly LogEvent[]) {
  const inHeldSide = heldSide(events);
  const changed: string[] = [];
  const log = events.map((event, at) =>
    inHeldSide(event)
      ? // SAFETY: scrambling keeps every key and turns an object into an object.
        { ...event, data: scrambled(event.data, null, changed, `${String(at)}:${event.kind}`) as JsonObject }
      : event,
  );
  return { log, changed };
}

function builderView(events: readonly LogEvent[]): string {
  const campaign = campaignOf(events);
  const sets = taskSets(events);
  return JSON.stringify(
    {
      comparisons: formatComparisonHistory(campaign.steps),
      fails: formatPracticeFailures(
        campaign.fails,
        new Map(sets.released.map((version) => [version, version])),
      ),
      start: formatSessionStart(campaign, "hc", "b-9"),
      records: [...recordsOf(events)].map(([task, records]) => [task, [...records]]),
      held: sets.held,
      released: sets.released,
      pool: poolOf(events),
      owed: practiceDue(events, 1000, 0.1),
      order: releaseOrder(events, sets.held, sets.held.length, "seed"),
      spent: ["b-1", "b-2"].map((session) => spent(events, session)),
    },
    null,
    1,
  );
}

const leaves = (value: JsonValue, path: string): [string, JsonValue][] => {
  if (Array.isArray(value)) return value.flatMap((each, at) => leaves(each, `${path}[${String(at)}]`));
  const record = asRecord(value);
  return record === null
    ? [[path, value]]
    : Object.entries(record).flatMap(([name, each]) => leaves(each, `${path}.${name}`));
};

describe("what the Builder reads of the held-out side", () => {
  const events = wriCampaign((tag) => `secret ${tag}`);
  const { log, changed } = scrambledLog(events);

  it("is byte-identical whatever every held-out leaf outside the structure holds", () => {
    expect(builderView(log)).toBe(builderView(events));
  });

  it("changes every leaf the campaign's own secrets reach on the held-out side, and a reader quoting one would differ", () => {
    const other = wriCampaign((tag) => `other ${tag}`);
    const inHeldSide = heldSide(events);
    const secret = events.flatMap((event, at) => {
      if (!inHeldSide(event)) return [];
      const theirs = new Map(leaves(other[at]?.data ?? {}, `${String(at)}:${event.kind}`));
      return leaves(event.data, `${String(at)}:${event.kind}`).flatMap(([path, value]) =>
        JSON.stringify(theirs.get(path)) === JSON.stringify(value) ? [] : [path],
      );
    });
    expect(secret.length).toBeGreaterThan(20);
    expect(secret.filter((path) => !changed.includes(path))).toEqual([]);
    const statements = (from: readonly LogEvent[]) =>
      from.filter(({ kind }) => kind === "task.proposed").map(({ data }) => JSON.stringify(data.task));
    expect(statements(log)).not.toEqual(statements(events));
  });
});

import { parseJsonAs } from "../meta/json-runtime.ts";
import { asRecord, isNumber, isString, type JsonValue } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { hashJsonValue, requireJsonValue } from "../meta/stable-json.ts";
import { append, type EventKind, eventsOf, type LogEvent, read } from "./log.ts";
import type { PriceTable } from "./meter.ts";

const RECORDED: EventKind = "condition.recorded";
const VERIFIED = new WeakMap<LogEvent, { readonly id: string; readonly condition: Condition }>();
const SETTING_OF = new WeakMap<Setting, string>();

// oxlint-disable-next-line typescript/consistent-type-definitions -- a type alias stays assignable to `JsonObject`, and an interface has no implicit index signature
export type Limits = {
  readonly wallSeconds: number;
  readonly turns: number;
  readonly modelTurns?: number;
  readonly shellDefaultSeconds: number;
  readonly shellMaxSeconds: number;
  readonly concurrency: number;
};

export interface Condition {
  readonly contract: string;
  readonly harness: string;
  readonly task: string;
  readonly model: string;
  readonly effort: string;
  readonly prices: PriceTable;
  readonly runtime: Readonly<Record<string, string>>;
  readonly compaction: string;
  readonly solverTools: string;
  readonly verifierTools: string;
  readonly sandbox: string;
  readonly limits: Limits;
  readonly host: string;
  readonly side: "test" | "strong";
}

export type Setting = Omit<Condition, "task" | "harness" | "solverTools">;

export function limitsIn(value: JsonValue | undefined): Limits | null {
  const held = asRecord(value);
  if (held === null) return null;
  const { wallSeconds, turns, shellDefaultSeconds, shellMaxSeconds, concurrency } = held;
  const { modelTurns } = held;
  return isNumber(wallSeconds) &&
    isNumber(turns) &&
    isNumber(shellDefaultSeconds) &&
    isNumber(shellMaxSeconds) &&
    isNumber(concurrency)
    ? {
        wallSeconds,
        turns,
        shellDefaultSeconds,
        shellMaxSeconds,
        concurrency,
        ...keyIfDefined("modelTurns", isNumber(modelTurns) ? modelTurns : undefined),
      }
    : null;
}

export function conditionId(condition: Condition): string {
  if (condition.prices[condition.model] === undefined) {
    throw new Error(`the condition runs ${condition.model} but prices no such model`);
  }
  return hashJsonValue(condition);
}

export function settingId(setting: Setting): string {
  const cached = SETTING_OF.get(setting);
  if (cached !== undefined) return cached;
  const { contract, model, effort, prices, runtime, compaction } = setting;
  const { verifierTools, sandbox, limits, host, side } = setting;
  const id = hashJsonValue({
    contract,
    model,
    effort,
    prices,
    runtime,
    compaction,
    verifierTools,
    sandbox,
    limits,
    host,
    side,
  });
  SETTING_OF.set(setting, id);
  return id;
}

export function recordCondition(log: string, condition: Condition): string {
  const id = conditionId(condition);
  if (!read(log, (kind) => kind !== RECORDED).some((event) => event.data.id === id)) {
    append(log, RECORDED, { id, condition: requireJsonValue(condition) });
  }
  return id;
}

export function lastHost(events: readonly LogEvent[]): string | undefined {
  const host = asRecord(eventsOf(events, RECORDED).at(-1)?.event.data.condition)?.host;
  return isString(host) ? host : undefined;
}

export function conditionsOf(
  events: readonly LogEvent[],
  ids: ReadonlySet<string> | null = null,
  upTo = events.length - 1,
): Map<string, Condition> {
  const conditions = new Map<string, Condition>();
  for (const { event } of eventsOf(events, RECORDED, upTo)) {
    if (ids !== null && (!isString(event.data.id) || !ids.has(event.data.id))) continue;
    let verified = VERIFIED.get(event);
    if (verified === undefined) {
      const condition = parseJsonAs<Condition>(asRecord(event.data.condition) ?? {});
      const id = conditionId(condition);
      if (id !== event.data.id) throw new Error(`${event.at}: a condition does not hash to its id`);
      verified = { id, condition };
      VERIFIED.set(event, verified);
    }
    conditions.set(verified.id, verified.condition);
  }
  return conditions;
}

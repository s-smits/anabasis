import type { ModelUsage } from "@anthropic-ai/claude-agent-sdk";
import type { Api, AssistantMessage, Model, Models, Usage } from "@earendil-works/pi-ai";
import type { UsageState } from "@earendil-works/pi-durable";
import { isNumber, isString } from "../meta/json-shape.ts";
import { type EventKind, eventsOf, type LogEvent } from "./log.ts";
import { examinerSessions } from "./solves.ts";
import { ownersOf, unfinished } from "./trace.ts";

interface Price {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

export type PriceTable = Readonly<Record<string, Price>>;

type Tokens = Readonly<Record<"input" | "output" | "cacheRead" | "cacheWrite" | "cacheWrite1h", number>>;

type Spend = Tokens & { readonly dollars: number };

export type Ledger = Readonly<Record<string, Spend>>;

export interface BackendSpend {
  readonly ledger: Ledger;
  readonly byServed: boolean;
  readonly reported: number | null;
}

export type Spent = Readonly<{ turns: number; tokens: Tokens; billed: number; reportedCost: number | null }>;

type Turn = Pick<AssistantMessage, "provider" | "model" | "responseModel" | "usage">;

interface Parts {
  session: number;
  span: number;
  comparison: number;
}

const FIELDS = ["input", "output", "cacheRead", "cacheWrite", "cacheWrite1h", "dollars"] as const;
const NO_TOKENS: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 };
const NONE: Spend = { ...NO_TOKENS, dollars: 0 };
interface PartsCache {
  readonly length: number;
  readonly last: LogEvent | undefined;
  readonly map: Map<string, Parts>;
}
const PARTS_CACHE = new WeakMap<readonly LogEvent[], PartsCache>();

export const NOTHING_SPENT: Spent = { turns: 0, tokens: NO_TOKENS, billed: 0, reportedCost: null };

const BILLED_KINDS: readonly EventKind[] = [
  "solve.finished",
  "build.finished",
  "exam.finished",
  "draft.finished",
  "referee.finding",
  "referee.draft",
  "diagnosis.recorded",
];
const BILL_SPAN_KINDS: readonly EventKind[] = ["build.started", ...BILLED_KINDS];

const ROLES = new Map([
  ["solve", "solver"],
  ["build", "builder"],
  ["exam", "examiner"],
  ["draft", "examiner"],
  ["referee", "referee"],
  ["diagnosis", "diagnoser"],
]);
const ROLE_ORDER = [...new Set(ROLES.values())];

export function priceKey(model: Pick<Model<Api>, "provider" | "id">): string {
  return `${model.provider}/${model.id}`;
}

const priced = ({ cost }: Pick<Model<Api>, "cost">) => cost.input > 0 && cost.output > 0;

export function freezePrices(models: readonly Model<Api>[]): PriceTable {
  return Object.freeze(
    Object.fromEntries(
      models.map((model) => {
        if (!priced(model)) throw new Error(`${priceKey(model)} has no list price to freeze`);
        const { input, output, cacheRead, cacheWrite } = model.cost;
        return [priceKey(model), Object.freeze({ input, output, cacheRead, cacheWrite })];
      }),
    ),
  );
}

function sum(entries: Iterable<readonly [string, Spend, number]>): Ledger {
  const ledger = new Map<string, Record<(typeof FIELDS)[number], number>>();
  for (const [key, spend, sign] of entries) {
    const held = ledger.get(key) ?? { ...NONE };
    for (const field of FIELDS) held[field] += sign * spend[field];
    ledger.set(key, held);
  }
  return Object.fromEntries([...ledger].filter(([, spend]) => FIELDS.some((field) => spend[field] !== 0)));
}

const signed = (ledger: Ledger, sign: number) =>
  Object.entries(ledger).map(([key, spend]) => [key, spend, sign] as const);

const totalOf = (ledger: Ledger): Spend =>
  sum(Object.values(ledger).map((spend) => ["", spend, 1] as const))[""] ?? NONE;

const tokensOf = ({ dollars: _dollars, ...tokens }: Spend): Tokens => tokens;

const sizeOf = ({ input, output, cacheRead, cacheWrite }: Tokens) => input + output + cacheRead + cacheWrite;

export function ledgerOf(entries: Iterable<readonly [string, Usage]>): Ledger {
  return sum(
    Array.from(entries, ([key, usage]) => {
      const { input, output, cacheRead, cacheWrite, cacheWrite1h = 0 } = usage;
      return [
        key,
        { input, output, cacheRead, cacheWrite, cacheWrite1h, dollars: usage.cost.total },
        1,
      ] as const;
    }),
  );
}

export const minus = (later: Ledger, earlier: Ledger): Ledger =>
  sum([...signed(later, 1), ...signed(earlier, -1)]);

export function claudeSpend(
  provider: string,
  result: { readonly total_cost_usd: number; readonly modelUsage: Readonly<Record<string, ModelUsage>> },
): BackendSpend {
  const ledger = sum(
    Object.entries(result.modelUsage).map(([name, used]) => [
      `${provider}/${used.canonicalModel ?? name}`,
      {
        input: used.inputTokens,
        output: used.outputTokens,
        cacheRead: used.cacheReadInputTokens,
        cacheWrite: used.cacheCreationInputTokens,
        cacheWrite1h: used.cacheCreationEphemeral1hInputTokens ?? 0,
        dollars: used.costUSD,
      },
      1,
    ]),
  );
  return { ledger, byServed: true, reported: result.total_cost_usd };
}

export function durableSpend(usage: Pick<UsageState, "models" | "tools">): BackendSpend {
  const tools = Object.entries(usage.tools).map(([name, spent]) => [`tool/${name}`, spent] as const);
  return { ledger: ledgerOf([...Object.entries(usage.models), ...tools]), byServed: false, reported: null };
}

export function billOf(prices: PriceTable, ledger: Ledger): number {
  let total = 0;
  for (const [key, spend] of Object.entries(ledger)) {
    const price = prices[key];
    total +=
      price === undefined
        ? spend.dollars
        : (spend.input * price.input +
            spend.output * price.output +
            spend.cacheRead * price.cacheRead +
            (spend.cacheWrite - spend.cacheWrite1h) * price.cacheWrite +
            spend.cacheWrite1h * 2 * price.input) /
          1_000_000;
  }
  return total;
}

export function sessionLedger(backend: Ledger | null, filed: Ledger, served: Ledger): Ledger {
  if (backend === null || sizeOf(totalOf(backend)) < sizeOf(totalOf(filed))) return served;
  return sum([...signed(served, 1), ...signed(filed, -1), ...signed(backend, 1)]);
}

export function seatMeter(model: Model<Api>) {
  let prices = freezePrices([model]);
  const own = priceKey(model);
  const servedKey = ({ responseModel }: Turn) => {
    const key = responseModel === undefined ? own : priceKey({ provider: model.provider, id: responseModel });
    return Object.hasOwn(prices, key) ? key : own;
  };
  const turnsOf = (turns: readonly Turn[], keyOf: (turn: Turn) => string) =>
    ledgerOf(turns.map((turn) => [keyOf(turn), turn.usage]));
  return {
    catalogue: (models: Pick<Models, "getModels">) => {
      prices = freezePrices([...models.getModels(model.provider).filter(priced), model]);
    },
    turn: (turn: Turn) => billOf(prices, turnsOf([turn], servedKey)),
    rows: (ledger: Ledger) =>
      Object.entries(ledger).map(([key, spend]) => ({
        model: key,
        ...tokensOf(spend),
        cost: { total: billOf(prices, { [key]: spend }) },
      })),
    spent: (turns: readonly Turn[], backend: BackendSpend | null): Spent => {
      const served = turnsOf(turns, servedKey);
      const filed =
        backend?.byServed === false ? turnsOf(turns, (turn) => `${turn.provider}/${turn.model}`) : served;
      const ledger = sessionLedger(backend?.ledger ?? null, filed, served);
      return {
        turns: turns.length,
        tokens: tokensOf(totalOf(ledger)),
        billed: billOf(prices, ledger),
        reportedCost: backend?.reported ?? null,
      };
    },
  };
}

export const roleOf = (kind: string): string | undefined => ROLES.get(kind.split(".")[0] ?? "");

const billedOn = ({ kind, data }: LogEvent) =>
  kind !== "build.started" && isNumber(data.billed) ? data.billed : null;

export function billedAll(events: readonly LogEvent[], upTo = events.length - 1): number {
  if (upTo < 0) return 0;
  let total = 0;
  for (const { event } of eventsOf(events, BILLED_KINDS, upTo)) total += billedOn(event) ?? 0;
  return unfinished(events, upTo).reduce((all, { dollars }) => all + dollars, total);
}

export const reportedShare = (total: number | null, before: number | null) =>
  total === null || before === null ? null : Math.max(0, total - before);

export function billedBetween(events: readonly LogEvent[], from: number, to = events.length): number {
  const prefix = (at: number) => billedAll(events, Math.min(at, events.length) - 1);
  return from === 0 ? prefix(to) : prefix(to) - prefix(from);
}

export function costLine(events: readonly LogEvent[]): string {
  let [records, covered, backend, billed] = [0, 0, 0, 0];
  for (const { event } of eventsOf(events, BILLED_KINDS)) {
    const own = billedOn(event);
    if (own === null) continue;
    records += 1;
    if (!isNumber(event.data.reportedCost)) continue;
    covered += 1;
    backend += event.data.reportedCost;
    billed += own;
  }
  const off =
    billed > 0 ? ` (${backend >= billed ? "+" : ""}${((backend / billed - 1) * 100).toFixed(1)}%)` : "";
  return `backend $${backend.toFixed(2)} on ${String(covered)} of ${String(records)} ending records, calculated $${billed.toFixed(2)} on the same${off}`;
}

export function billedFor(events: readonly LogEvent[], id: string): number {
  const { span, comparison } = billedParts(events, id);
  return span + comparison;
}

function billedIndex(events: readonly LogEvent[]): Map<string, Parts> {
  const [last, cached] = [events.at(-1), PARTS_CACHE.get(events)];
  if (cached?.length === events.length && cached.last === last) return cached.map;
  const [owners, map, active] = [ownersOf(events), new Map<string, Parts>(), new Set<string>()];
  const add = (id: string, key: keyof Parts, dollars: number) => {
    const held = map.get(id) ?? { session: 0, span: 0, comparison: 0 };
    held[key] += dollars;
    map.set(id, held);
  };
  const credit = (event: LogEvent, session: string | null, own: number) => {
    const of = isString(event.data.solve) ? event.data.solve : event.data.reader;
    const owner = isString(of) ? owners.get(of) : undefined;
    for (const build of active) {
      add(build, "span", own);
      if ((session === null || session === build) && (owner === undefined || owner.by === build)) {
        add(build, "session", own);
      }
    }
    if (
      isString(event.data.solve) &&
      owner?.asked === true &&
      owner.by !== undefined &&
      !active.has(owner.by)
    ) {
      add(owner.by, "comparison", own);
    }
  };
  for (const { event } of eventsOf(events, BILL_SPAN_KINDS)) {
    const session = isString(event.data.session) ? event.data.session : null;
    if (event.kind === "build.started" && session !== null) active.add(session);
    const own = billedOn(event);
    if (own !== null) credit(event, session, own);
    if (event.kind === "build.finished" && session !== null) active.delete(session);
  }
  for (const { of, id: which, dollars } of unfinished(events)) {
    if (!isString(which)) continue;
    if (of === "build") {
      add(which, "span", dollars);
      add(which, "session", dollars);
      continue;
    }
    const owner = owners.get(which);
    if (owner?.by !== undefined && (owner.asked || of === "solve")) {
      add(owner.by, owner.asked ? "comparison" : "session", dollars);
    }
  }
  PARTS_CACHE.set(events, { length: events.length, last, map });
  return map;
}

export function billedParts(events: readonly LogEvent[], id: string): Readonly<Parts> {
  return { ...(billedIndex(events).get(id) ?? { session: 0, span: 0, comparison: 0 }) };
}

export function spendOf(events: readonly LogEvent[]): [string, number][] {
  const [sessions, owners, billed] = [examinerSessions(events), ownersOf(events), new Map<string, number>()];
  const add = (kind: string, solve: unknown, dollars: number) => {
    const base = roleOf(kind);
    const owner = isString(solve) ? owners.get(solve) : undefined;
    const role = base === "solver" && owner?.asked === true && sessions.has(owner.by) ? "examiner" : base;
    if (role !== undefined) billed.set(role, (billed.get(role) ?? 0) + dollars);
  };
  for (const { event } of eventsOf(events, BILLED_KINDS)) {
    add(event.kind, event.data.solve, billedOn(event) ?? 0);
  }
  for (const { of, id, dollars } of unfinished(events)) add(of, id, dollars);
  return ROLE_ORDER.flatMap((role): [string, number][] =>
    billed.has(role) ? [[role, billed.get(role) ?? 0]] : [],
  ).toSorted(([, a], [, b]) => b - a);
}

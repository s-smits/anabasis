/**
 * The meter: what a session spent, as one ledger of tokens and dollars by the model that served
 * them, and the bill it comes to at prices frozen into the condition, so a provider's price change
 * moves nothing already measured; and what a log holds billed.
 *
 * Every backend keeps such a ledger, and the meter prices that one instead of adding up turns. It
 * reads all three here: Claude Code's `result` carries `modelUsage`, the whole query's tokens and
 * dollars by served model, its own compactions and its calls on other models included
 * (`claudeSpend`); pi-durable keeps `pi.usage` for Codex and pi's own providers, DeepInfra among
 * them, every assistant entry, a retried attempt and a compaction summary included (`durableSpend`).
 * A backend only hands over what it recorded, and a seat bills it through `seatMeter`. Until
 * 1 November the session's bill was the sum of its turns: 305 exam and 19 build compactions Claude
 * Code ran billed $0 in the archive, and a retried attempt's dollars rode on the next turn.
 *
 * The price rule: a model the table lists is billed at its frozen list price, cache reads at their
 * discount and writes at their premium; a model it does not list, such as one Claude Code called on
 * its own, at the dollars its backend reported, never at zero.
 */
import type { ModelUsage } from "@anthropic-ai/claude-agent-sdk";
import type { Api, AssistantMessage, Model, Models, Usage } from "@earendil-works/pi-ai";
import type { UsageState } from "@earendil-works/pi-durable";
import { isNumber, isString, type JsonValue } from "../meta/json-shape.ts";
import type { LogEvent } from "./log.ts";
import { examinerSessions } from "./solves.ts";
import { METERED, ownedBy, ownersOf, unfinished } from "./trace.ts";

/** Dollars per million tokens. */
interface Price {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

/** Prices by `provider/model`, as frozen for one condition. */
export type PriceTable = Readonly<Record<string, Price>>;

/** Tokens by billing class, as the log records them: `input` is neither read from nor written to
 *  the cache, and `cacheWrite1h` is the part of `cacheWrite` kept for an hour, which Anthropic
 *  bills at twice the input price. */
type Tokens = Readonly<Record<"input" | "output" | "cacheRead" | "cacheWrite" | "cacheWrite1h", number>>;

/** One key's tokens and the dollars its backend reported for them. */
type Spend = Tokens & { readonly dollars: number };

/** Spend by `provider/model`, or `tool/<name>` for a tool's own usage. */
export type Ledger = Readonly<Record<string, Spend>>;

/** A backend's own account of a session: its ledger; whether it files each turn under the model
 *  that served it, as Claude Code does, or the one asked for, as pi-durable does; and the total it
 *  reported, where it reports one. */
export interface BackendSpend {
  readonly ledger: Ledger;
  readonly byServed: boolean;
  readonly reported: number | null;
}

/** What a seat spent, as its end records it: its model turns, its tokens and the dollars they come
 *  to (`billOf`), and the total Claude Code reported where it served the seat. An unfinished seat is
 *  counted by its turns' recorded dollars (`unfinished`, `src/kernel/trace.ts`). */
export type Spent = Readonly<{ turns: number; tokens: Tokens; billed: number; reportedCost: number | null }>;

/** A turn as the meter reads it. */
type Turn = Pick<AssistantMessage, "provider" | "model" | "responseModel" | "usage">;

const FIELDS = ["input", "output", "cacheRead", "cacheWrite", "cacheWrite1h", "dollars"] as const;
const NO_TOKENS: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 };
const NONE: Spend = { ...NO_TOKENS, dollars: 0 };

/** What a seat that never sat spent. */
export const NOTHING_SPENT: Spent = { turns: 0, tokens: NO_TOKENS, billed: 0, reportedCost: null };

/** The events that carry what their own model turns were billed, in a `billed` field: the end of
 *  each of those, and a reviewer's reading. */
export const BILLED: ReadonlySet<string> = new Set([
  ...METERED.map(({ of }) => `${of}.finished`),
  "referee.finding",
  "diagnosis.recorded",
]);

/** The role whose work an event kind's prefix holds, as `billedAll` reads its dollars: what it was
 *  billed where it ended, and the turns of a session that never ended. A drafting session is the
 *  Examiner's, as the host's budget counts it: esp32's d-1 billed $1.57 that read as no role's on
 *  12 October. The Diagnoser was a seat until 11 October (`7f0add79:docs/simplify.md`, E1): a log
 *  of before holds what it billed. */
const ROLES = new Map([
  ["solve", "solver"],
  ["build", "builder"],
  ["exam", "examiner"],
  ["draft", "examiner"],
  ["referee", "referee"],
  ["diagnosis", "diagnoser"],
]);

export function priceKey(model: Pick<Model<Api>, "provider" | "id">): string {
  return `${model.provider}/${model.id}`;
}

const priced = ({ cost }: Pick<Model<Api>, "cost">) => cost.input > 0 && cost.output > 0;

/**
 * Freeze the list prices of the models a condition runs. An unpriced model is refused, never billed
 * at $0. A long-context tier is left out (Codex's models list one above 272k input per request): a
 * model has one price, so a request's size moves only its token count.
 */
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

/** Spends added up by key, each times its sign; a key that comes to nothing is left out. */
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

/** A ledger over all its keys at once. */
const totalOf = (ledger: Ledger): Spend =>
  sum(Object.values(ledger).map((spend) => ["", spend, 1] as const))[""] ?? NONE;

const tokensOf = ({ input, output, cacheRead, cacheWrite, cacheWrite1h }: Spend): Tokens => ({
  input,
  output,
  cacheRead,
  cacheWrite,
  cacheWrite1h,
});

/** Every token once: the hour-long writes are inside `cacheWrite`. */
const sizeOf = ({ input, output, cacheRead, cacheWrite }: Tokens) => input + output + cacheRead + cacheWrite;

/** pi usages added up by the key each is filed under, with the dollars each reported. */
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

/** `later` less `earlier`, key by key over both; a key that comes to nothing is left out. */
export const minus = (later: Ledger, earlier: Ledger): Ledger =>
  sum([...signed(later, 1), ...signed(earlier, -1)]);

/** Claude Code's `result`: its ledger by the model that served each call, `canonicalModel` where it
 *  names one, and its own total. */
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

/** pi-durable's `pi.usage`: every assistant entry under the model asked for, and each tool's own
 *  usage under `tool/<name>`. */
export function durableSpend(usage: Pick<UsageState, "models" | "tools">): BackendSpend {
  const tools = Object.entries(usage.tools).map(([name, spent]) => [`tool/${name}`, spent] as const);
  return { ledger: ledgerOf([...Object.entries(usage.models), ...tools]), byServed: false, reported: null };
}

/** The dollars `ledger` comes to: each listed key at its frozen price, any other at its backend's dollars. */
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

/**
 * The ledger a session is billed on: its turns at the model that served each, and whatever its
 * backend's ledger holds beyond them, a retried attempt, a compaction summary or a tool's own calls.
 * A backend files a turn under its own key, pi-durable under the model asked for, so that excess is
 * read against the turns as the backend filed them (`filed`) and the turns are billed as served
 * (`served`); a backend that files by served model, as Claude Code does, passes one ledger twice.
 * A backend holding fewer tokens than its turns, a Claude Code result that crashed zeroed or a query
 * cleared mid-session, or none read, leaves the turns' own.
 */
export function sessionLedger(backend: Ledger | null, filed: Ledger, served: Ledger): Ledger {
  if (backend === null || sizeOf(totalOf(backend)) < sizeOf(totalOf(filed))) return served;
  return sum([...signed(served, 1), ...signed(filed, -1), ...signed(backend, 1)]);
}

/**
 * The meter of one seat on `model`. Its prices are frozen once the seat's backends exist: its own
 * model's, then every model its provider's catalogue prices. A turn is priced at the model that
 * served it where that is listed, and at the seat's own otherwise (recode, 25 October: Claude Code
 * answered claude-opus-5-5's requests as claude-opus-5).
 */
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
    /** One turn's dollars, which it records as its cost and the seat's cap reads while it runs. */
    turn: (turn: Turn) => billOf(prices, turnsOf([turn], servedKey)),
    /** A ledger key by key with its dollars, as a trace records a compaction summary's spend. */
    rows: (ledger: Ledger) =>
      Object.entries(ledger).map(([key, spend]) => ({
        model: key,
        ...tokensOf(spend),
        cost: { total: billOf(prices, { [key]: spend }) },
      })),
    /** What the seat spent: its backend's ledger where one was read (`sessionLedger`), else its turns'. */
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

// What a log holds billed: the ends of sessions and solves, and what an unfinished one metered.

/** The role of kind `kind`, or of a seat by its prefix alone. */
export const roleOf = (kind: string): string | undefined => ROLES.get(kind.split(".")[0] ?? "");

/** An event's billed dollars, or null where it carries none. */
const billedOn = ({ kind, data }: LogEvent) =>
  BILLED.has(kind) && isNumber(data.billed) ? data.billed : null;

/** Every billed dollar a log holds, whoever billed it: what a campaign's total budget is held
 *  against (`7f0add79:docs/plan.md`, row F49). A start the log holds no end of was killed before it could
 *  sum its turns, and is billed by what it metered (`unfinished`). */
export function billedAll(events: readonly LogEvent[]): number {
  let total = 0;
  for (const event of events) total += billedOn(event) ?? 0;
  return unfinished(events).reduce((all, { dollars }) => all + dollars, total);
}

/**
 * The billed dollars of the stretch from event `from` to event `to` (the log's end where none):
 * what the log had billed by `to` less what it had by `from`. A sum over the slice alone billed a
 * session open across its start at its whole sum where it ended, and nothing of one still open at
 * its end: on 14 October recode-151's epoch b-4 read $6.87 where it billed $0.04, the Builder's
 * conversation of three epochs ending inside it.
 */
export function billedBetween(events: readonly LogEvent[], from: number, to = events.length): number {
  return billedAll(events.slice(0, to)) - billedAll(events.slice(0, from));
}

/** The backend's own query totals beside the host's bill on the same ending records, the check
 *  that the meter prices what the backend charged. An ending without a total, and a session or a
 *  solve that never ended, are left out of both sides. Recode's three campaigns of October read
 *  backend totals 46 to 54% over the bill while every turn was priced at the requested model, and
 *  buffer's 0.6 to 1.9%, whose turns the requested model served. */
export function costLine(events: readonly LogEvent[]): string {
  let [records, covered, backend, billed] = [0, 0, 0, 0];
  for (const event of events) {
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

/**
 * The billed dollars a log holds for comparison `id`: every attempt of a solve whose start names
 * it, every reviewer's reading of such a solve, and, where a Builder session ran under the same id
 * (a round), everything billed from that session's start to its end. In a round that is the
 * session's own turns, its practice solves and their reviewers; in a campaign its Builder leads it
 * is also every move the session made. The session's own cap reads its own part (`billedParts`,
 * `halted` in `src/builder/session.ts`). What another comparison or session billed since
 * is not this one's, so a comparison gone on from its log after others ran is held to its own
 * spend. A solve of the comparison with no end on record, killed or still running, is counted by
 * what its turns and compactions have metered so far (`unfinished`); a solve still running is held
 * besides at a cap's reserve, which is what its sum may come to (`src/campaign/round.ts`). A live
 * Builder's turns are counted as they are metered, then replaced by its final sum.
 */
export function billedFor(events: readonly LogEvent[], id: string): number {
  const { span, comparison } = billedParts(events, id);
  return span + comparison;
}

/**
 * The same sum in its parts: what the Builder session under `id` billed of its own (`ownedBy`),
 * everything billed from that session's start to its end, whoever billed it (`span`, which a round's
 * comparison holds to its cap), and what the comparison under it did. A reader of a round tells
 * them apart (`src/campaign/handover.ts`). A start with no end is in the session's span and its own
 * where it is the session; a solve of the comparison in the comparison's part; and a practice solve
 * of the session in the session's own alone, so a killed Builder closed on its turns (`endCut`,
 * `tools/d2/harness-builder.ts`) keeps the practice it was killed in, and its cap reads what it read
 * before. Until 19 October the session's part was everything in its span, which in a campaign its
 * Builder leads is every move it made, counted again on the moves' own lines: on 19 October
 * buffer-fresh-opus's view put $123.34 on b-4, whose own turns and practice billed $2.65, and its
 * steps summed to $362.92 where the log had billed $199.48.
 */
export function billedParts(events: readonly LogEvent[], id: string) {
  const owners = ownersOf(events);
  const mine = ownedBy(events, id, owners);
  const asked = (solve: JsonValue | undefined) => {
    const owner = isString(solve) ? owners.get(solve) : undefined;
    return owner?.asked === true && owner.by === id;
  };
  const at = (kind: string) => events.findIndex((event) => event.kind === kind && event.data.session === id);
  const [opened, closed] = [at("build.started"), at("build.finished")];
  const billed = { session: 0, span: 0, comparison: 0 };
  for (const [index, event] of events.entries()) {
    const own = billedOn(event);
    if (own === null) continue;
    if (opened !== -1 && index >= opened && (closed === -1 || index <= closed)) {
      billed.span += own;
      if (mine(event)) billed.session += own;
    } else if (asked(event.data.solve)) billed.comparison += own;
  }
  for (const { of, id: which, dollars } of unfinished(events)) {
    if (of === "build" && which === id) {
      billed.span += dollars;
      billed.session += dollars;
    } else if (asked(which)) billed.comparison += dollars;
    else if (of === "solve" && isString(which) && owners.get(which)?.by === id) billed.session += dollars;
  }
  return billed;
}

/** Billed dollars by role, the largest first, counted as the campaign's own budget counts them:
 *  a session a stop cut has no end record, and its turns were read as nothing. Buffer's Examiner
 *  session x-1 read 0.00 against $1.68 billed, and the builder's share of the campaign read 71.3%
 *  where it was 42.2% (2026-10-10). A role the log holds no event of is left out: every log since
 *  11 October printed "diagnoser 0.00" for a seat that no longer exists. The closing report
 *  (`economyLines`, `tools/d2/close.ts`) and the investigation read the Examiner's share here: until
 *  28 October the closing report summed it again from the sessions' parts. */
export function spendOf(events: readonly LogEvent[]): [string, number][] {
  // A solve an Examiner session asked for to try a draft task (`try_task`, until 1 November) names the session where a
  // comparison's names the comparison, and is the Examiner's, as `countedSolves` keeps it out of
  // every tally: about seven reference solves an admitted task at three a draft (the overhaul plan,
  // 4b), which until 12 October read as the solver's. A drafting session's solves of its examples
  // are the Examiner's too: until 27 October this reader took only `exam.started`, and $2.23 of
  // buffer-fresh-opus-v072's drafting read as the solver's.
  const sessions = examinerSessions(events);
  const owners = ownersOf(events);
  const whoseRole = (kind: string, solve: JsonValue | undefined) => {
    const role = roleOf(kind);
    const owner = isString(solve) ? owners.get(solve) : undefined;
    return role === "solver" && owner?.asked === true && sessions.has(owner.by) ? "examiner" : role;
  };
  const billed = new Map<string, number>();
  const add = (role: string | undefined, dollars: number) => {
    if (role !== undefined) billed.set(role, (billed.get(role) ?? 0) + dollars);
  };
  for (const event of events) add(whoseRole(event.kind, event.data.solve), billedOn(event) ?? 0);
  for (const { of, id, dollars } of unfinished(events)) add(whoseRole(of, id), dollars);
  return [...new Set(ROLES.values())]
    .flatMap((role): [string, number][] => (billed.has(role) ? [[role, billed.get(role) ?? 0]] : []))
    .sort(([, a], [, b]) => b - a);
}

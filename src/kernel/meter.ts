/**
 * The meter: what a session spent, as one ledger of tokens and dollars by the model that served
 * them, and the bill it comes to at prices frozen into the condition, so a provider's price change
 * moves nothing already measured.
 *
 * Every backend keeps such a ledger, and the meter prices that one instead of adding up turns.
 * Claude Code's `result` carries `modelUsage`, the whole query's tokens and dollars by served model,
 * its own compactions and its calls on other models included (`claudeLedger`,
 * `src/agent/backends/claude.ts`); pi-durable keeps `pi.usage` for Codex and pi's own providers,
 * every assistant entry, a retried attempt and a compaction summary included. Until 1 November the
 * session's bill was the sum of its turns: 305 exam and 19 build compactions Claude Code ran billed
 * $0 in the archive, and a retried attempt's dollars rode on the next turn.
 *
 * The price rule: a model the table lists is billed at its frozen list price, cache reads at their
 * discount and writes at their premium; a model it does not list, such as one Claude Code called on
 * its own, at the dollars its backend reported, never at zero.
 */
import type { Api, Model, Usage } from "@earendil-works/pi-ai";

/** Dollars per million tokens. */
interface Price {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

/** Prices by `provider/model`, as frozen for one condition. */
export type PriceTable = Readonly<Record<string, Price>>;

/** Tokens by billing class, as the log records them. */
export interface Tokens {
  /** Input neither read from nor written to the cache. */
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  /** The part of `cacheWrite` kept for an hour, which Anthropic bills at twice the input price. */
  readonly cacheWrite1h: number;
}

/** One model's tokens and the dollars its backend reported for them. */
interface Spend {
  readonly tokens: Tokens;
  readonly dollars: number;
}

/** Spend by `provider/model`, or `tool/<name>` for a tool's own usage. */
export type Ledger = Readonly<Record<string, Spend>>;

const CLASSES = ["input", "output", "cacheRead", "cacheWrite", "cacheWrite1h"] as const;

export function priceKey(model: Pick<Model<Api>, "provider" | "id">): string {
  return `${model.provider}/${model.id}`;
}

/**
 * Freeze the list prices of the models a condition runs. An unpriced model is refused, never billed
 * at $0. A long-context tier is left out (Codex's models list one above 272k input per request): a
 * model has one price, so a request's size moves only its token count.
 */
export function freezePrices(models: readonly Model<Api>[]): PriceTable {
  return Object.freeze(
    Object.fromEntries(
      models.map((model) => {
        const { input, output, cacheRead, cacheWrite } = model.cost;
        if (!(input > 0 && output > 0)) throw new Error(`${priceKey(model)} has no list price to freeze`);
        return [priceKey(model), Object.freeze({ input, output, cacheRead, cacheWrite })];
      }),
    ),
  );
}

/** pi usages added up by the key each is filed under, with the dollars each reported. */
export function ledgerOf(entries: Iterable<readonly [string, Usage]>): Ledger {
  const ledger = new Map<string, Spend>();
  for (const [key, usage] of entries) {
    const held = ledger.get(key);
    const tokens = { ...usage, cacheWrite1h: usage.cacheWrite1h ?? 0 };
    ledger.set(key, {
      tokens: sumOf((part) => (held?.tokens[part] ?? 0) + tokens[part]),
      dollars: (held?.dollars ?? 0) + usage.cost.total,
    });
  }
  return Object.fromEntries(ledger);
}

/** A ledger's tokens over every key. */
export function tokensOf(ledger: Ledger): Tokens {
  const spends = Object.values(ledger);
  return sumOf((part) => spends.reduce((total, { tokens }) => total + tokens[part], 0));
}

/** `later` less `earlier`, key by key over both; a key that comes to nothing is left out. */
export function minus(later: Ledger, earlier: Ledger): Ledger {
  return Object.fromEntries(
    [...new Set([...Object.keys(later), ...Object.keys(earlier)])].flatMap((key) => {
      const tokens = sumOf((part) => (later[key]?.tokens[part] ?? 0) - (earlier[key]?.tokens[part] ?? 0));
      const dollars = (later[key]?.dollars ?? 0) - (earlier[key]?.dollars ?? 0);
      return dollars === 0 && sizeOf(tokens) === 0 ? [] : [[key, { tokens, dollars }]];
    }),
  );
}

/** The dollars `ledger` comes to: each listed key at its frozen price, any other at its backend's dollars. */
export function billOf(prices: PriceTable, ledger: Ledger): number {
  let total = 0;
  for (const [key, { tokens, dollars }] of Object.entries(ledger)) {
    const price = prices[key];
    total +=
      price === undefined
        ? dollars
        : (tokens.input * price.input +
            tokens.output * price.output +
            tokens.cacheRead * price.cacheRead +
            (tokens.cacheWrite - tokens.cacheWrite1h) * price.cacheWrite +
            tokens.cacheWrite1h * 2 * price.input) /
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
  if (backend === null || sizeOf(tokensOf(backend)) < sizeOf(tokensOf(filed))) return served;
  return minus(served, minus(filed, backend));
}

function sumOf(part: (name: (typeof CLASSES)[number]) => number): Tokens {
  const [input, output, cacheRead, cacheWrite, cacheWrite1h] = CLASSES.map(part);
  return {
    input: input ?? 0,
    output: output ?? 0,
    cacheRead: cacheRead ?? 0,
    cacheWrite: cacheWrite ?? 0,
    cacheWrite1h: cacheWrite1h ?? 0,
  };
}

/** Every token once: the hour-long writes are inside `cacheWrite`. */
function sizeOf(tokens: Tokens): number {
  return tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite;
}

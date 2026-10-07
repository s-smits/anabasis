/**
 * The meter: a solve's tokens by the classes a provider bills, and the dollars they come to at a price
 * table frozen into the condition, so a provider's price change moves nothing already measured.
 *
 * Dollars come two ways from the same tokens, and neither converts to the other: on the truss sweep
 * metered ran 4.49 times billed on one run and 4.97 times on another.
 * - Billed is what the provider charges, cache reads at their discount and cache writes at their
 *   premium. Gates and reports read it.
 * - Metered charges every input token at the full input price, so a solve costs the same whether its
 *   prompt prefix was warm or cold. Reports carry it beside billed.
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
  readonly cacheRead: number;
  readonly cacheWrite: number;
  /** The part of `cacheWrite` kept for an hour, which Anthropic bills at twice the input price. */
  readonly cacheWrite1h: number;
  readonly output: number;
}

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

/** pi's per-turn usage, summed by class. */
export function tokensOf(usages: readonly Usage[]): Tokens {
  const sum = (count: (usage: Usage) => number) => usages.reduce((total, usage) => total + count(usage), 0);
  return {
    input: sum((usage) => usage.input),
    cacheRead: sum((usage) => usage.cacheRead),
    cacheWrite: sum((usage) => usage.cacheWrite),
    cacheWrite1h: sum((usage) => usage.cacheWrite1h ?? 0),
    output: sum((usage) => usage.output),
  };
}

/**
 * The billed and metered dollars of `tokens` on `model`. Billed is pi-ai 1.0.4's `calculateCost`
 * (dist/models.js:657) on the summed classes, departing from it only in leaving out the tier, as
 * `freezePrices` does: a sum of turns is the turns' sum while every turn is priced alike.
 */
export function dollars(prices: PriceTable, model: string, tokens: Tokens) {
  const price = prices[model];
  if (price === undefined) throw new Error(`${model} is not in the condition's price table`);
  const shortWrite = tokens.cacheWrite - tokens.cacheWrite1h;
  const billed =
    tokens.input * price.input +
    tokens.output * price.output +
    tokens.cacheRead * price.cacheRead +
    shortWrite * price.cacheWrite +
    tokens.cacheWrite1h * 2 * price.input;
  const metered =
    (tokens.input + tokens.cacheRead + tokens.cacheWrite) * price.input + tokens.output * price.output;
  return { billed: billed / 1_000_000, metered: metered / 1_000_000 };
}

/**
 * The meter: what a solve cost, in the two allowances the budget pair keeps apart.
 *
 * Model spend is tokens times a price table frozen into the condition, so a provider's price change
 * moves nothing already measured. Cached input is charged at the full input price, so a solve costs
 * the same whether its prompt prefix was warm or cold. Tool time is CPU seconds, summed across every
 * process the solve ran; provider latency and runner load are not in it.
 */
import type { Api, Model, Usage } from "@earendil-works/pi-ai";

/** Dollars per million tokens. */
export interface Price {
  readonly input: number;
  readonly output: number;
}

/** Prices by `provider/model`, as frozen for one condition. */
export type PriceTable = Readonly<Record<string, Price>>;

/** Tokens as the log records them: cached input apart from fresh input, though both cost the same. */
export interface Tokens {
  readonly input: number;
  readonly cached: number;
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
        const { input, output } = model.cost;
        if (!(input > 0 && output > 0)) throw new Error(`${priceKey(model)} has no list price to freeze`);
        return [priceKey(model), Object.freeze({ input, output })];
      }),
    ),
  );
}

/** pi's per-turn usage, summed. Cache writes are input the provider happened to keep. */
export function tokensOf(usages: readonly Usage[]): Tokens {
  return {
    input: usages.reduce((sum, usage) => sum + usage.input, 0),
    cached: usages.reduce((sum, usage) => sum + usage.cacheRead + usage.cacheWrite, 0),
    output: usages.reduce((sum, usage) => sum + usage.output, 0),
  };
}

export function dollars(prices: PriceTable, model: string, tokens: Tokens): number {
  const price = prices[model];
  if (price === undefined) throw new Error(`${model} is not in the condition's price table`);
  return ((tokens.input + tokens.cached) * price.input + tokens.output * price.output) / 1_000_000;
}

import { describe, expect, it } from "bun:test";
import type { Usage } from "@earendil-works/pi-ai";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { dollars, freezePrices, tokensOf } from "../src/kernel/meter.ts";

const rates = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };
const catalog = getBuiltinModels("anthropic").find((model) => model.id === "claude-opus-5");
if (catalog === undefined) throw new Error("pi's Anthropic catalog has no claude-opus-5");
const opus = { ...catalog, provider: "claude", cost: rates };
const free = { ...opus, provider: "openrouter", id: "free", cost: { ...rates, input: 0 } };
const usage = (input: number, cacheRead: number, cacheWrite: number, output: number): Usage => ({
  input,
  output,
  cacheRead,
  cacheWrite,
  totalTokens: input + cacheRead + cacheWrite + output,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

describe("the meter", () => {
  it("charges cached input at the full input price", () => {
    const prices = freezePrices([opus]);
    const tokens = tokensOf([usage(1_000, 600_000, 0, 2_000), usage(500, 300_000, 98_500, 3_000)]);
    expect(tokens).toEqual({ input: 1_500, cached: 998_500, output: 5_000 });
    expect(dollars(prices, "claude/claude-opus-5", tokens)).toBeCloseTo(5 + 0.125, 10);
  });

  it("freezes the list price, so a later catalog change moves nothing", () => {
    const prices = freezePrices([{ ...opus, cost: { ...rates } }]);
    expect(Object.isFrozen(prices)).toBe(true);
    expect(Object.isFrozen(prices["claude/claude-opus-5"])).toBe(true);
  });

  it("refuses an unpriced model, and a model the table does not hold", () => {
    expect(() => freezePrices([opus, free])).toThrow("openrouter/free has no list price");
    expect(() => dollars(freezePrices([opus]), "claude/claude-sonnet-5", tokensOf([]))).toThrow(
      "not in the condition's price table",
    );
  });
});

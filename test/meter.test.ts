import { describe, expect, it } from "bun:test";
import type { Usage } from "@earendil-works/pi-ai";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { dollars, freezePrices, tokensOf } from "../src/kernel/meter.ts";

const rates = { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 };
const catalog = getBuiltinModels("anthropic").find((model) => model.id === "claude-opus-5");
if (catalog === undefined) throw new Error("pi's Anthropic catalog has no claude-opus-5");
const opus = { ...catalog, provider: "claude", cost: rates };
const free = { ...opus, provider: "openrouter", id: "free", cost: { ...rates, input: 0 } };
const usage = (
  input: number,
  cacheRead: number,
  cacheWrite: number,
  output: number,
  cacheWrite1h = 0,
): Usage => ({
  input,
  output,
  cacheRead,
  cacheWrite,
  cacheWrite1h,
  totalTokens: input + cacheRead + cacheWrite + output,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
});

describe("the meter", () => {
  it("stores each billing class, and bills each at its own price beside metering all input at full", () => {
    const prices = freezePrices([opus]);
    const tokens = tokensOf([usage(1_000, 600_000, 0, 2_000), usage(500, 300_000, 98_500, 3_000, 90_000)]);
    expect(tokens).toEqual({
      input: 1_500,
      cacheRead: 900_000,
      cacheWrite: 98_500,
      cacheWrite1h: 90_000,
      output: 5_000,
    });
    // Billed: 1,500 x $5 + 5,000 x $25 + 900,000 x $0.50 + 8,500 x $6.25 + 90,000 x $10, per million.
    // Metered: 1,000,000 input tokens x $5 + 5,000 x $25, per million.
    expect(dollars(prices, "claude/claude-opus-5", tokens)).toEqual({
      billed: expect.closeTo(0.0075 + 0.125 + 0.45 + 0.053125 + 0.9, 10),
      metered: expect.closeTo(5 + 0.125, 10),
    });
  });

  it("freezes the list price, so a later catalog change moves nothing", () => {
    const prices = freezePrices([{ ...opus, cost: { ...rates } }]);
    expect(Object.isFrozen(prices)).toBe(true);
    expect(prices["claude/claude-opus-5"]).toEqual(rates);
    expect(Object.isFrozen(prices["claude/claude-opus-5"])).toBe(true);
  });

  it("refuses an unpriced model, and a model the table does not hold", () => {
    expect(() => freezePrices([opus, free])).toThrow("openrouter/free has no list price");
    expect(() => dollars(freezePrices([opus]), "claude/claude-sonnet-5", tokensOf([]))).toThrow(
      "not in the condition's price table",
    );
  });
});

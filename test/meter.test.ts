// The meter's unit tests. Every price, count and expected dollar is written out in the test that
// uses it, with the arithmetic beside it, so a reader checks each figure by hand.
import { describe, expect, it } from "bun:test";
import type { Usage } from "@earendil-works/pi-ai";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { billOf, freezePrices, ledgerOf, minus, sessionLedger, tokensOf } from "../src/kernel/meter.ts";
import { nearly } from "./helpers/matchers.ts";

const catalog = getBuiltinModels("anthropic").find((model) => model.id === "claude-opus-5-5");
if (catalog === undefined) throw new Error("pi's Anthropic catalog has no claude-opus-5-5");

describe("prices", () => {
  it("prices each class of tokens at its own rate, an hour-long cache write at twice the input rate", () => {
    // Dollars per million tokens: input 4, output 20, cache read 0.20, cache write 5.
    const prices = freezePrices([
      { ...catalog, provider: "claude", cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } },
    ]);
    const bill = billOf(prices, {
      "claude/claude-opus-5-5": {
        // 98,500 cache writes, of which 90,000 live an hour and 8,500 five minutes.
        tokens: { input: 1_500, output: 5_000, cacheRead: 900_000, cacheWrite: 98_500, cacheWrite1h: 90_000 },
        dollars: 123,
      },
    });
    // input        1,500 x  4.00 = 0.006
    // output       5,000 x 20.00 = 0.1
    // cache read 900,000 x  0.20 = 0.18
    // 5-min write  8,500 x  5.00 = 0.0425
    // 1-h write   90,000 x  8.00 = 0.72
    // The backend's own 123 dollars are ignored: the table lists the model.
    expect(bill).toEqual(nearly(0.006 + 0.1 + 0.18 + 0.0425 + 0.72, 10));
  });

  it("keeps the price frozen when the catalogue changes after it", () => {
    const model = {
      ...catalog,
      provider: "claude",
      cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
    };
    const prices = freezePrices([model]);
    model.cost.input = 500;
    const bill = billOf(prices, {
      "claude/claude-opus-5-5": {
        tokens: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 },
        dollars: 0,
      },
    });
    // 1,000,000 input tokens x $4 per million, the price when the table was frozen.
    expect(bill).toEqual(nearly(4, 10));
  });

  it("prices a model the table does not list at the dollars its backend reported, never at zero", () => {
    const prices = freezePrices([
      { ...catalog, provider: "claude", cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } },
    ]);
    const none = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 };
    const bill = billOf(prices, {
      // Listed: 1,000,000 input tokens x $4 = $4, whatever the backend said ($99).
      "claude/claude-opus-5-5": { tokens: { ...none, input: 1_000_000 }, dollars: 99 },
      // Not listed: the backend's $0.42 for a model Claude Code called on its own.
      "claude/claude-side-model": { tokens: { ...none, input: 1_000_000 }, dollars: 0.42 },
      // A tool's usage names no model: its own $0.01.
      "tool/web_search": { tokens: none, dollars: 0.01 },
    });
    expect(bill).toEqual(nearly(4 + 0.42 + 0.01, 10));
  });

  it("refuses to freeze a model with no input or no output price", () => {
    const priced = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };
    expect(() => freezePrices([{ ...catalog, cost: { ...priced, input: 0 } }])).toThrow(/no list price/);
    expect(() => freezePrices([{ ...catalog, cost: { ...priced, output: 0 } }])).toThrow(/no list price/);
  });
});

describe("ledgers", () => {
  it("adds a backend's usages by the model that served them, with the dollars it reported", () => {
    const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    const first: Usage = {
      input: 100,
      output: 20,
      cacheRead: 1_000,
      cacheWrite: 50,
      totalTokens: 1_170,
      cost: { ...zero, total: 0.25 },
    };
    const second: Usage = {
      input: 300,
      output: 40,
      cacheRead: 0,
      cacheWrite: 10,
      cacheWrite1h: 10,
      totalTokens: 350,
      cost: { ...zero, total: 0.5 },
    };
    const other: Usage = {
      input: 7,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 8,
      cost: { ...zero, total: 0.01 },
    };
    const ledger = ledgerOf([
      ["codex/a", first],
      ["codex/a", second],
      ["codex/b", other],
    ]);
    expect(ledger).toEqual({
      // 100 + 300 input, 20 + 40 output, 1,000 + 0 read, 50 + 10 written (10 of them for an hour).
      "codex/a": {
        tokens: { input: 400, output: 60, cacheRead: 1_000, cacheWrite: 60, cacheWrite1h: 10 },
        dollars: 0.75,
      },
      "codex/b": {
        tokens: { input: 7, output: 1, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 },
        dollars: 0.01,
      },
    });
    // The session's tokens over every model: 400 + 7 input, 60 + 1 output.
    expect(tokensOf(ledger)).toEqual({
      input: 407,
      output: 61,
      cacheRead: 1_000,
      cacheWrite: 60,
      cacheWrite1h: 10,
    });
  });

  it("takes what a ledger gained since an earlier reading of it, and nothing for a model that did not move", () => {
    const earlier = {
      "faux/a": {
        tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 },
        dollars: 1,
      },
      "faux/still": {
        tokens: { input: 3, output: 3, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 },
        dollars: 0.2,
      },
    };
    const later = {
      "faux/a": {
        tokens: { input: 30, output: 9, cacheRead: 4, cacheWrite: 0, cacheWrite1h: 0 },
        dollars: 3,
      },
      "faux/still": earlier["faux/still"],
      "faux/b": {
        tokens: { input: 7, output: 1, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 },
        dollars: 0.5,
      },
    };
    expect(minus(later, earlier)).toEqual({
      // 30 - 10 input, 9 - 5 output, 4 - 0 read, $3 - $1.
      "faux/a": {
        tokens: { input: 20, output: 4, cacheRead: 4, cacheWrite: 0, cacheWrite1h: 0 },
        dollars: 2,
      },
      "faux/b": later["faux/b"],
    });
    expect(minus(later, later)).toEqual({});
  });
});

describe("a session's ledger", () => {
  const spend = (input: number, dollars: number) => ({
    tokens: { input, output: 50, cacheRead: 5_000, cacheWrite: 0, cacheWrite1h: 0 },
    dollars,
  });
  const turns = { "claude/claude-opus-5-5": spend(100, 0.1) };

  it("is the backend's where it files the turns as served and holds at least their tokens", () => {
    // Claude Code's result: the turns' 5,150 tokens and a compaction's 40,000 the turns never saw.
    const backend = { "claude/claude-opus-5-5": spend(40_100, 0.3) };
    expect(sessionLedger(backend, turns, turns)).toEqual(backend);
  });

  it("bills the turns at the model that served them, and only the backend's excess at the key it filed", () => {
    // pi-durable files every turn under the model asked for; the turns were served by another, and
    // a retried attempt of 1,000 input tokens is in pi's ledger alone.
    const asked = { "openai-codex/gpt-6-luna": spend(100, 0.1) };
    const served = { "openai-codex/gpt-6.1-sol": spend(100, 0.1) };
    const backend = { "openai-codex/gpt-6-luna": spend(1_100, 0.12) };
    const ledger = sessionLedger(backend, asked, served);
    expect(Object.keys(ledger).sort()).toEqual(["openai-codex/gpt-6-luna", "openai-codex/gpt-6.1-sol"]);
    expect(ledger["openai-codex/gpt-6.1-sol"]).toEqual(spend(100, 0.1));
    expect(ledger["openai-codex/gpt-6-luna"]?.tokens).toEqual({
      input: 1_000,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cacheWrite1h: 0,
    });
    expect(ledger["openai-codex/gpt-6-luna"]?.dollars).toBeCloseTo(0.02, 10);
  });

  it("is the turns' own where the backend reported none, a zeroed one, or less than the turns hold", () => {
    const zeroed = {
      "claude/claude-opus-5-5": {
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 },
        dollars: 0,
      },
    };
    // A query cleared mid-session: 5,149 tokens against the turns' 5,150.
    const cleared = { "claude/claude-opus-5-5": spend(99, 0.1) };
    expect(sessionLedger(null, turns, turns)).toBe(turns);
    expect(sessionLedger(zeroed, turns, turns)).toBe(turns);
    expect(sessionLedger(cleared, turns, turns)).toBe(turns);
  });
});

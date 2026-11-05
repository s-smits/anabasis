// The meter's unit tests. Every price, count and expected dollar is written out in the test that
// uses it, with the arithmetic beside it, so a reader checks each figure by hand.
import { describe, expect, it } from "bun:test";
import type { Usage } from "@earendil-works/pi-ai";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import {
  billedFor,
  billedParts,
  billOf,
  claudeSpend,
  costLine,
  durableSpend,
  freezePrices,
  ledgerOf,
  minus,
  NOTHING_SPENT,
  seatMeter,
  sessionLedger,
  spendOf,
} from "../src/kernel/meter.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { nearly } from "./helpers/matchers.ts";

const none = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 };
const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

const catalog = getBuiltinModels("anthropic").find((model) => model.id === "claude-opus-5-5");
if (catalog === undefined) throw new Error("pi's Anthropic catalog has no claude-opus-5-5");
// Dollars per million tokens: input 4, output 20, cache read 0.20, cache write 5.
const opus = {
  ...catalog,
  provider: "claude",
  cost: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};
// The model Claude Code answered opus's requests with on 25 October, at half opus's prices.
const served = {
  ...opus,
  id: "claude-opus-5",
  cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
};
const usage = (tokens: Partial<typeof none>, dollars = 0): Usage => ({
  ...none,
  ...tokens,
  totalTokens: 0,
  cost: { ...zero, total: dollars },
});
const turn = (responseModel: string | undefined, tokens: Partial<typeof none>, dollars = 0) => ({
  provider: "claude",
  model: "claude-opus-5-5",
  usage: usage(tokens, dollars),
  ...keyIfDefined("responseModel", responseModel),
});
const event = (kind: EventKind, data: JsonObject): LogEvent => ({ at: "2026-11-01T00:00:00Z", kind, data });

describe("prices", () => {
  it("prices each class of tokens at its own rate, an hour-long cache write at twice the input rate", () => {
    const bill = billOf(freezePrices([opus]), {
      // 98,500 cache writes, of which 90,000 live an hour and 8,500 five minutes.
      "claude/claude-opus-5-5": {
        input: 1500,
        output: 5000,
        cacheRead: 900_000,
        cacheWrite: 98_500,
        cacheWrite1h: 90_000,
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
    const model = { ...opus, cost: { ...opus.cost } };
    const prices = freezePrices([model]);
    model.cost.input = 500;
    // 1,000,000 input tokens x $4 per million, the price when the table was frozen.
    expect(billOf(prices, { "claude/claude-opus-5-5": { ...none, input: 1_000_000, dollars: 0 } })).toEqual(
      nearly(4, 10),
    );
  });

  it("prices a model the table does not list at the dollars its backend reported, never at zero", () => {
    const bill = billOf(freezePrices([opus]), {
      // Listed: 1,000,000 input tokens x $4 = $4, whatever the backend said ($99).
      "claude/claude-opus-5-5": { ...none, input: 1_000_000, dollars: 99 },
      // Not listed: the backend's $0.42 for a model Claude Code called on its own.
      "claude/claude-side-model": { ...none, input: 1_000_000, dollars: 0.42 },
      // A tool's usage names no model: its own $0.01.
      "tool/web_search": { ...none, dollars: 0.01 },
    });
    expect(bill).toEqual(nearly(4 + 0.42 + 0.01, 10));
  });

  it("refuses to freeze a model with no input or no output price", () => {
    expect(() => freezePrices([{ ...opus, cost: { ...opus.cost, input: 0 } }])).toThrow(/no list price/);
    expect(() => freezePrices([{ ...opus, cost: { ...opus.cost, output: 0 } }])).toThrow(/no list price/);
  });
});

describe("ledgers", () => {
  it("adds a backend's usages by the key they are filed under, with the dollars it reported", () => {
    const ledger = ledgerOf([
      ["codex/a", usage({ input: 100, output: 20, cacheRead: 1000, cacheWrite: 50 }, 0.25)],
      ["codex/a", usage({ input: 300, output: 40, cacheWrite: 10, cacheWrite1h: 10 }, 0.5)],
      ["codex/b", usage({ input: 7, output: 1 }, 0.01)],
    ]);
    expect(ledger).toEqual({
      // 100 + 300 input, 20 + 40 output, 1,000 + 0 read, 50 + 10 written (10 of them for an hour).
      "codex/a": {
        input: 400,
        output: 60,
        cacheRead: 1000,
        cacheWrite: 60,
        cacheWrite1h: 10,
        dollars: 0.75,
      },
      "codex/b": { ...none, input: 7, output: 1, dollars: 0.01 },
    });
  });

  it("takes what a ledger gained since an earlier reading of it, and nothing for a key that did not move", () => {
    const earlier = {
      "faux/a": { ...none, input: 10, output: 5, dollars: 1 },
      "faux/still": { ...none, input: 3, output: 3, dollars: 0.2 },
    };
    const later = {
      "faux/a": { ...none, input: 30, output: 9, cacheRead: 4, dollars: 3 },
      "faux/still": earlier["faux/still"],
      "faux/b": { ...none, input: 7, output: 1, dollars: 0.5 },
    };
    // 30 - 10 input, 9 - 5 output, 4 - 0 read, $3 - $1.
    expect(minus(later, earlier)).toEqual({
      "faux/a": { ...none, input: 20, output: 4, cacheRead: 4, dollars: 2 },
      "faux/b": later["faux/b"],
    });
    expect(minus(later, later)).toEqual({});
  });
});

describe("a backend's ledger", () => {
  it("reads Claude Code's result by the model that served each call, under its canonical name where it gives one", () => {
    const used = (input: number, costUSD: number) => ({
      inputTokens: input,
      outputTokens: 10,
      cacheReadInputTokens: 100,
      cacheCreationInputTokens: 40,
      webSearchRequests: 0,
      costUSD,
      contextWindow: 200_000,
      maxOutputTokens: 32_000,
    });
    const spend = claudeSpend("claude", {
      total_cost_usd: 1.5,
      modelUsage: {
        "claude-opus-5": { ...used(1000, 1), cacheCreationEphemeral1hInputTokens: 40 },
        // A dated name Claude Code reports beside the plain one: one model, one key.
        "claude-opus-5-20261001": { ...used(500, 0.25), canonicalModel: "claude-opus-5" },
        "claude-haiku-5-5": used(20, 0.25),
      },
    });
    expect(spend).toEqual({
      ledger: {
        // 1,000 + 500 input, 10 + 10 output, 100 + 100 read, 40 + 40 written (40 for an hour), $1 + $0.25.
        "claude/claude-opus-5": {
          input: 1500,
          output: 20,
          cacheRead: 200,
          cacheWrite: 80,
          cacheWrite1h: 40,
          dollars: 1.25,
        },
        // No hour-long count given: none.
        "claude/claude-haiku-5-5": {
          input: 20,
          output: 10,
          cacheRead: 100,
          cacheWrite: 40,
          cacheWrite1h: 0,
          dollars: 0.25,
        },
      },
      byServed: true,
      reported: 1.5,
    });
  });

  it("reads pi-durable's usage under the model asked for, a tool's own under tool/<name>, with no total of its own", () => {
    const spend = durableSpend({
      models: { "openai-codex/gpt-6-luna": usage({ input: 900, output: 30 }, 0.4) },
      tools: { web_search: usage({}, 0.01) },
    });
    expect(spend).toEqual({
      ledger: {
        "openai-codex/gpt-6-luna": { ...none, input: 900, output: 30, dollars: 0.4 },
        "tool/web_search": { ...none, dollars: 0.01 },
      },
      byServed: false,
      reported: null,
    });
  });
});

describe("a session's ledger", () => {
  const spend = (input: number, dollars: number) => ({
    ...none,
    input,
    output: 50,
    cacheRead: 5000,
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
    const ledger = sessionLedger(
      { "openai-codex/gpt-6-luna": spend(1100, 0.12) },
      { "openai-codex/gpt-6-luna": spend(100, 0.1) },
      { "openai-codex/gpt-6.1-sol": spend(100, 0.1) },
    );
    expect(Object.keys(ledger).toSorted()).toEqual(["openai-codex/gpt-6-luna", "openai-codex/gpt-6.1-sol"]);
    expect(ledger["openai-codex/gpt-6.1-sol"]).toEqual(spend(100, 0.1));
    expect(ledger["openai-codex/gpt-6-luna"]).toEqual({ ...none, input: 1000, dollars: nearly(0.02, 10) });
  });

  it("is the turns' own where the backend reported none, a zeroed one, or less than the turns hold", () => {
    // A query cleared mid-session: 5,149 tokens against the turns' 5,150.
    for (const backend of [
      null,
      { "claude/claude-opus-5-5": spend(0, 0) },
      { "claude/claude-opus-5-5": spend(99, 0.1) },
    ]) {
      expect(sessionLedger(backend, turns, turns)).toEqual(turns);
    }
  });
});

describe("a seat's meter", () => {
  const catalogued = () => {
    const meter = seatMeter(opus);
    // The provider lists the served model and one with no price, which is left out, not refused.
    meter.catalogue({ getModels: () => [served, { ...served, id: "claude-free", cost: { ...zero } }] });
    return meter;
  };

  it("prices a turn at the model that served it where the table lists it, and at the seat's own otherwise", () => {
    const meter = catalogued();
    // 1,000,000 input tokens: $2 at claude-opus-5, $4 at the seat's claude-opus-5-5.
    expect(meter.turn(turn("claude-opus-5", { input: 1_000_000 }))).toEqual(nearly(2, 10));
    expect(meter.turn(turn("claude-free", { input: 1_000_000 }))).toEqual(nearly(4, 10));
    expect(meter.turn(turn("claude-unknown", { input: 1_000_000 }))).toEqual(nearly(4, 10));
    expect(meter.turn(turn(undefined, { input: 1_000_000 }))).toEqual(nearly(4, 10));
  });

  it("prices a turn at the seat's own model before the catalogue is read", () => {
    expect(seatMeter(opus).turn(turn("claude-opus-5", { input: 1_000_000 }))).toEqual(nearly(4, 10));
  });

  it("bills a seat Claude Code served on its result, a compaction included, with the total it reported", () => {
    const meter = catalogued();
    const turns = [turn("claude-opus-5", { input: 100_000, output: 1000 }, 0.21)];
    // The result holds the turn and a compaction's 400,000 input tokens on claude-opus-5.
    const backend = claudeSpend("claude", {
      total_cost_usd: 1.23,
      modelUsage: {
        "claude-opus-5": {
          inputTokens: 500_000,
          outputTokens: 1000,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          webSearchRequests: 0,
          costUSD: 1.01,
          contextWindow: 200_000,
          maxOutputTokens: 32_000,
        },
      },
    });
    // 500,000 x $2 + 1,000 x $10 per million = $1.01 at the served model's list price.
    expect(meter.spent(turns, backend)).toEqual({
      turns: 1,
      tokens: { ...none, input: 500_000, output: 1000 },
      billed: nearly(1.01, 10),
      reportedCost: 1.23,
    });
  });

  it("bills a seat with no backend ledger read on its turns, and reports no total", () => {
    const meter = catalogued();
    const turns = [turn("claude-opus-5", { input: 1_000_000 }), turn(undefined, { output: 100_000 })];
    // $2 for the served turn, 100,000 x $20 per million = $2 for the other at the seat's model.
    expect(meter.spent(turns, null)).toEqual({
      turns: 2,
      tokens: { ...none, input: 1_000_000, output: 100_000 },
      billed: nearly(4, 10),
      reportedCost: null,
    });
  });

  it("bills a seat pi-durable served on its turns as served and its ledger's excess at the model asked for", () => {
    const meter = catalogued();
    const turns = [turn("claude-opus-5", { input: 1_000_000 }, 2)];
    // pi-durable filed the turn and a retried attempt of 500,000 input tokens under claude-opus-5-5.
    const backend = durableSpend({
      models: { "claude/claude-opus-5-5": usage({ input: 1_500_000 }, 6) },
      tools: {},
    });
    // The turn at claude-opus-5, $2; the retry at claude-opus-5-5, 500,000 x $4 per million = $2.
    expect(meter.spent(turns, backend)).toEqual({
      turns: 1,
      tokens: { ...none, input: 1_500_000 },
      billed: nearly(4, 10),
      reportedCost: null,
    });
  });

  it("gives a seat that never sat nothing spent", () => {
    expect(NOTHING_SPENT).toEqual({ turns: 0, tokens: none, billed: 0, reportedCost: null });
  });
});

describe("what a log holds billed", () => {
  it("sets the backend's totals beside the bill on the same endings, and counts an ending with no total only as a record", () => {
    const line = costLine([
      event("solve.finished", { solve: "s-1", billed: 2, reportedCost: 2.2 }),
      event("build.finished", { session: "b-1", billed: 1, reportedCost: 1.1 }),
      event("exam.finished", { session: "x-1", billed: 5 }),
      event("solve.started", { solve: "s-2", billed: 7, reportedCost: 7 }),
    ]);
    // Backend $2.20 + $1.10 = $3.30 on 2 of 3 endings; the bill on those two $3; 3.30 / 3 = +10%.
    expect(line).toMatch(/\$3\.30\D+2\D+3\D+\$3\.00\D+\+10\.0%/);
  });

  it("bills each role its own, the Examiner the solves its sessions asked for, and leaves out a role with no event", () => {
    const spend = spendOf([
      event("exam.started", { session: "x-1" }),
      event("solve.started", { solve: "s-1", comparison: "x-1" }),
      event("solve.finished", { solve: "s-1", billed: 1 }),
      event("exam.finished", { session: "x-1", billed: 0.5 }),
      event("solve.started", { solve: "s-2", comparison: "c-1" }),
      event("solve.finished", { solve: "s-2", billed: 2 }),
      event("referee.finding", { solve: "s-2", reader: "r-1", billed: 0.125 }),
      // A Builder session killed after one turn: what the turn metered.
      event("build.started", { session: "b-1" }),
      event("build.turn", { session: "b-1", usage: { cost: { total: 0.25 } } }),
      // A solve the Examiner asked for, killed after one turn.
      event("solve.started", { solve: "s-3", comparison: "x-1" }),
      event("solve.turn", { solve: "s-3", usage: { cost: { total: 0.75 } } }),
    ]);
    // solver 2; examiner 1 + 0.5 + 0.75; builder 0.25; referee 0.125; no diagnoser.
    expect(spend).toEqual([
      ["examiner", 2.25],
      ["solver", 2],
      ["builder", 0.25],
      ["referee", 0.125],
    ]);
  });

  it("splits a round's bill into its Builder session's own, the session's whole span and its comparison's", () => {
    const events = [
      event("build.started", { session: "b-1" }),
      event("solve.started", { solve: "p-1" }),
      event("solve.finished", { solve: "p-1", billed: 1 }),
      // An Examiner session inside the Builder's span: in the span, not the session's own.
      event("exam.finished", { session: "x-1", billed: 4 }),
      event("build.finished", { session: "b-1", billed: 0.5 }),
      event("solve.started", { solve: "s-1", comparison: "b-1" }),
      event("solve.finished", { solve: "s-1", billed: 2 }),
      // A solve of the comparison still running: what its turn metered.
      event("solve.started", { solve: "s-2", comparison: "b-1" }),
      event("solve.turn", { solve: "s-2", usage: { cost: { total: 0.25 } } }),
    ];
    // Own 1 + 0.5; span 1 + 4 + 0.5; comparison 2 + 0.25.
    expect(billedParts(events, "b-1")).toEqual({ session: 1.5, span: 5.5, comparison: 2.25 });
    expect(billedFor(events, "b-1")).toBe(5.5 + 2.25);
  });
});

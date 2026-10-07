import { describe, expect, it } from "bun:test";
import { type Condition, conditionId } from "../src/kernel/condition.ts";

const condition: Condition = {
  contract: "c1",
  harness: "h1",
  task: "t1",
  model: "claude/claude-opus-5",
  effort: "high",
  prices: { "claude/claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 } },
  runtime: { "@earendil-works/pi-ai": "1.0.4", "@anthropic-ai/claude-agent-sdk": "0.3.285" },
  compaction: "off",
  solverTools: "s1",
  verifierTools: "v1",
  sandbox: "p1",
  limits: {
    wallSeconds: 7_200,
    turns: 24,
    shellDefaultSeconds: 300,
    shellMaxSeconds: 900,
    concurrency: 3,
    diskBytes: 2 * 1024 ** 3,
  },
  host: "0.1.0",
  side: "test",
};

describe("a condition", () => {
  it("is named by its content, whatever order its fields were written in", () => {
    const { contract, ...rest } = condition;
    const reordered: Condition = { ...rest, contract };
    expect(conditionId(reordered)).toBe(conditionId(condition));
  });

  it("pins the runtime, compaction, sandbox and every limit, so a change in any is another condition", () => {
    const changes: Partial<Condition>[] = [
      { runtime: { ...condition.runtime, "@anthropic-ai/claude-agent-sdk": "0.3.286" } },
      { compaction: "auto" },
      { sandbox: "p2" },
      { limits: { ...condition.limits, wallSeconds: 7_800 } },
      { limits: { ...condition.limits, turns: 48 } },
      { limits: { ...condition.limits, shellMaxSeconds: 600 } },
      { limits: { ...condition.limits, concurrency: 6 } },
      { limits: { ...condition.limits, diskBytes: 4 * 1024 ** 3 } },
      { side: "strong" },
    ];
    const ids = changes.map((change) => conditionId({ ...condition, ...change }));
    expect(new Set([conditionId(condition), ...ids]).size).toBe(changes.length + 1);
  });

  it("refuses a model its price table does not price", () => {
    expect(() => conditionId({ ...condition, model: "claude/claude-sonnet-5" })).toThrow(
      "prices no such model",
    );
  });
});

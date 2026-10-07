import { describe, expect, it } from "bun:test";
import { type Condition, conditionId } from "../src/kernel/condition.ts";

const condition: Condition = {
  contract: "c1",
  harness: "h1",
  task: "t1",
  model: "claude/claude-opus-5",
  effort: "high",
  budget: { dollars: 2, cpuSeconds: 600 },
  prices: { "claude/claude-opus-5": { input: 5, output: 25 } },
  wallSeconds: 1_800,
  solverTools: "s1",
  verifierTools: "v1",
  host: "0.1.0",
  side: "test",
};

describe("a condition", () => {
  it("is named by its content, whatever order its fields were written in", () => {
    const { contract, ...rest } = condition;
    const reordered: Condition = { ...rest, contract };
    expect(conditionId(reordered)).toBe(conditionId(condition));
    expect(conditionId({ ...condition, side: "strong" })).not.toBe(conditionId(condition));
  });

  it("refuses a model its price table does not price", () => {
    expect(() => conditionId({ ...condition, model: "claude/claude-sonnet-5" })).toThrow(
      "prices no such model",
    );
  });
});

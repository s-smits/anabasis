import { describe, expect, it } from "bun:test";
import { type Condition, conditionId, conditionsOf, recordCondition } from "../src/kernel/condition.ts";
import { append, read } from "../src/kernel/log.ts";
import { mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";

const condition: Condition = {
  contract: "c1",
  harness: "h1",
  task: "t1",
  model: "claude/claude-opus-5",
  effort: "high",
  prices: { "claude/claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 } },
  runtime: { "@earendil-works/pi-ai": "1.1.0", "@anthropic-ai/claude-agent-sdk": "0.3.285" },
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
  },
  host: "0.1.0",
  side: "test",
};

describe("a condition", () => {
  it("is logged once under its id and read back whole, and a record edited under its id is refused", () => {
    const scratch = mkdtempSync(join(tmpdir(), "ana-condition-"));
    try {
      const log = join(scratch, "log.jsonl");
      const strong: Condition = { ...condition, side: "strong" };
      const ids = [condition, strong, condition].map((each) => recordCondition(log, each));
      expect(ids).toEqual([conditionId(condition), conditionId(strong), conditionId(condition)]);
      expect(read(log).map((event) => event.kind)).toEqual(["condition.recorded", "condition.recorded"]);
      expect(conditionsOf(read(log)).get(conditionId(strong))).toEqual(strong);
      // A record edited under another's id: the strong record with its harness changed.
      const edited = requireJsonValue({ ...strong, harness: "h2" });
      append(log, "condition.recorded", { id: conditionId(condition), condition: edited });
      expect(() => conditionsOf(read(log))).toThrow("does not hash to its id");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

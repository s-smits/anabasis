import assert from "../src/meta/assert.ts";
import { test } from "bun:test";
import { classifyBunTestProcess } from "../.claude/skills/test-impact-and-consolidation/scripts/mutation-run-result.mjs";

test("keeps a completed assertion failure as mutation evidence", () => {
  assert.equal(classifyBunTestProcess(1, "1 fail\nRan 1 test across 1 file."), "failed");
  assert.equal(classifyBunTestProcess(0, "1 pass\nRan 1 test across 1 file."), "passed");
});

test("keeps setup and runner failures out of mutation evidence", () => {
  assert.equal(classifyBunTestProcess(1, "error: module not found"), "run-error");
  assert.equal(classifyBunTestProcess(124, "worker stopped producing output"), "run-error");
});

import { describe, expect, it } from "bun:test";
import { freeName, seats } from "../tools/runs/fresh.ts";

describe("bun run runs fresh", () => {
  it("seats one model at an effort a seat: the Builder, the Examiner, the Referee, the solver", () => {
    const opus = "claude/claude-opus-5-5";
    expect(seats("opus", undefined)).toEqual([
      "--builder",
      opus,
      "--builder-effort",
      "high",
      "--examiner",
      opus,
      "--examiner-effort",
      "high",
      "--reviewer",
      opus,
      "--reviewer-effort",
      "medium",
      "--solver",
      opus,
      "--solver-effort",
      "medium",
    ]);
    expect(seats("sonnet", undefined).filter((_, at) => at % 4 === 3)).toEqual([
      "xhigh",
      "xhigh",
      "high",
      "high",
    ]);
    // GPT-6.1 Sol through the Codex login, at high in every seat.
    expect(seats("gpt", undefined).filter((_, at) => at % 2 === 1)).toEqual([
      "openai-codex/gpt-6.1-sol",
      "high",
      "openai-codex/gpt-6.1-sol",
      "high",
      "openai-codex/gpt-6.1-sol",
      "high",
      "openai-codex/gpt-6.1-sol",
      "high",
    ]);
    // DeepSeek V4.1 Flash 1017 on OpenRouter, at high in every seat.
    expect(new Set(seats("deepseek", undefined).filter((_, at) => at % 2 === 1))).toEqual(
      new Set(["openrouter/deepseek/deepseek-v4.1-flash-1017", "high"]),
    );
    expect(() => seats("haiku", "hhmm")).toThrow("--model takes opus|sonnet|gpt|deepseek");
    expect(() => seats("opus", "hhm")).toThrow("--effort takes four of lmhx");
    expect(() => seats("opus", "hhmq")).toThrow("--effort takes four of lmhx");
  });

  it("names a run once: a taken name goes on as -r2, -r3", () => {
    const taken = new Set(["truss-fresh-opus", "truss-fresh-opus-r2"]);
    expect(freeName("truss-fresh-opus", (name) => taken.has(name))).toBe("truss-fresh-opus-r3");
    expect(freeName("esp32-fresh-opus", (name) => taken.has(name))).toBe("esp32-fresh-opus");
  });
});

import { describe, expect, it } from "bun:test";
import { freeName, limits, seats } from "../tools/runs/fresh.ts";

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
    expect(() => seats("haiku", "hhmm")).toThrow("--model takes opus|sonnet|gpt");
    expect(() => seats("opus", "hhm")).toThrow("--effort takes four of lmhx");
    expect(() => seats("opus", "hhmq")).toThrow("--effort takes four of lmhx");
  });

  it("solves at the model's limits unless the campaign's own flags name one", () => {
    expect(limits("opus", [])).toEqual(["--solve-minutes", "8", "--solve-model-turns", "16"]);
    expect(limits("sonnet", ["--solve-minutes", "12"])).toEqual(["--solve-model-turns", "16"]);
    expect(limits("gpt", [])).toEqual(["--solve-minutes", "30", "--solve-model-turns", "16"]);
    expect(limits("opus", ["--solve-model-turns=24", "--solve-minutes", "8"])).toEqual([]);
  });

  it("names a run once: a taken name goes on as -r2, -r3", () => {
    const taken = new Set(["truss-fresh-opus", "truss-fresh-opus-r2"]);
    expect(freeName("truss-fresh-opus", (name) => taken.has(name))).toBe("truss-fresh-opus-r3");
    expect(freeName("esp32-fresh-opus", (name) => taken.has(name))).toBe("esp32-fresh-opus");
  });
});

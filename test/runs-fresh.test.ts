import { describe, expect, it } from "bun:test";
import { modelOf, seats } from "../tools/runs/fresh.ts";

describe("bun run runs fresh", () => {
  it("seats one model at an effort a seat: the Builder, the Examiner, the Referee, the solver", () => {
    const opus = "claude/claude-opus-5-5";
    expect(seats(opus, modelOf("opus").effort)).toEqual([
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
    expect(seats(modelOf("sonnet").id, modelOf("sonnet").effort).filter((_, at) => at % 4 === 3)).toEqual([
      "xhigh",
      "xhigh",
      "high",
      "high",
    ]);
    // GPT-6.1 Sol through the Codex login, at high in every seat.
    expect(seats(modelOf("gpt").id, modelOf("gpt").effort).filter((_, at) => at % 2 === 1)).toEqual([
      "openai-codex/gpt-6.1-sol",
      "high",
      "openai-codex/gpt-6.1-sol",
      "high",
      "openai-codex/gpt-6.1-sol",
      "high",
      "openai-codex/gpt-6.1-sol",
      "high",
    ]);
    // Any other model a backend serves runs at high in every seat, named by its id.
    const deepseek = "openrouter/deepseek/deepseek-v4.1-flash-1017";
    expect(modelOf(deepseek)).toEqual({ id: deepseek, effort: "hhhh", label: "deepseek-v4.1-flash-1017" });
    expect(() => modelOf("openrouter/no-such/model")).toThrow("no backend serves openrouter/no-such/model");
    expect(() => modelOf("haiku")).toThrow("--model takes opus|sonnet|gpt or a served model's");
    expect(() => seats(opus, "hhm")).toThrow("--effort takes four of lmhx");
    expect(() => seats(opus, "hhmq")).toThrow("--effort takes four of lmhx");
  });
});

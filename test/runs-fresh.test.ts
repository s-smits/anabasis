import { describe, expect, it } from "bun:test";
import { modelOf, seats } from "../tools/runs/fresh.ts";
import { present } from "./helpers/matchers.ts";

describe("bun run runs fresh", () => {
  it("seats each preset model at its four efforts and accepts a served model", () => {
    for (const [preset, id, efforts] of [
      ["opus", "claude/claude-opus-5-5", ["high", "high", "medium", "medium"]],
      ["sonnet", "claude/claude-sonnet-5-5", ["xhigh", "xhigh", "high", "high"]],
      ["gpt", "openai-codex/gpt-6.1-sol", ["high", "high", "high", "high"]],
    ] as const) {
      const model = modelOf(preset);
      expect(seats(model.id, model.effort)).toEqual(
        ["builder", "examiner", "reviewer", "solver"].flatMap((seat, index) => [
          `--${seat}`,
          id,
          `--${seat}-effort`,
          present(efforts[index]),
        ]),
      );
    }
    const id = "openrouter/deepseek/deepseek-v4.1-flash-1017";
    expect(modelOf(id)).toEqual({ id, effort: "hhhh", label: "deepseek-v4.1-flash-1017" });
    for (const model of ["openrouter/no-such/model", "haiku"]) expect(() => modelOf(model)).toThrow();
    for (const effort of ["hhm", "hhmq"]) {
      expect(() => seats(modelOf("opus").id, effort)).toThrow(/--effort/);
    }
  });
});

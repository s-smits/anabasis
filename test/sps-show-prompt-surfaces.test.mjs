import { describe, expect, it } from "bun:test";
import { builderSystemPrompt } from "../src/author/builder-start-prompt.ts";
import { BUILT_NUDGE, builtSystemPrompt } from "../src/solve/built-starter.ts";
import { DEFAULT_HARNESS_SETTINGS } from "../src/truth/harness-config.ts";
import { runTypeScript } from "../.claude/skills/system-path-simulation/scripts/test-support.mjs";

function run(args) {
  return runTypeScript("show-prompt-surfaces.mts", args);
}

describe("production prompt text", () => {
  it("prints the exact default Builder system prompt", () => {
    const result = run(["--surface", "system"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${builderSystemPrompt()}\n`);
    expect(result.stderr).toBe("");
  });

  it("prints the exact web-search system condition", () => {
    const result = run(["--surface", "system", "--web-search"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${builderSystemPrompt(true)}\n`);
    expect(result.stdout).not.toBe(`${builderSystemPrompt(false)}\n`);
  });

  it("prints the Built solver's universal prompt, nudge and shell schema at the seeded walls", () => {
    const result = run(["--surface", "built"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`${builtSystemPrompt(DEFAULT_HARNESS_SETTINGS.solveMs)}\n`);
    expect(result.stdout).toContain(`${BUILT_NUDGE}\n`);
    expect(result.stdout).toContain(
      `${DEFAULT_HARNESS_SETTINGS.shellDefaultSeconds} when omitted, at most ${DEFAULT_HARNESS_SETTINGS.shellMaxSeconds}`,
    );
  });

  it("greps case-insensitively with one line of context", () => {
    const result = run(["--surface", "system", "--grep", "starter.md FIRST"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Read STARTER.md first");
    expect(result.stdout.split("\n").length).toBeLessThan(builderSystemPrompt().split("\n").length);
  });

  it("names a grep miss without printing the full surface", () => {
    const result = run(["--surface", "system", "--grep", "not-present-47f58c"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('(no line carries "not-present-47f58c" on this surface)\n');
  });

  it.each([
    [
      "an empty grep instead of matching every line",
      ["--surface", "system", "--grep", ""],
      "--grep must not be empty",
    ],
    [
      "web search on the built surface",
      ["--surface", "built", "--web-search"],
      "--surface built takes only --grep",
    ],
  ])("refuses %s", (_name, args, message) => {
    const result = run(args);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(message);
  });
});

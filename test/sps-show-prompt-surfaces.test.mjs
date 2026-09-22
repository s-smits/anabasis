import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { builderSystemPrompt } from "../src/author/builder-start-prompt.ts";
import { prepareUserContext } from "../src/builder/user-context.ts";
import { directKickoff } from "../src/run/direct-input.ts";
import { BUILT_NUDGE, builtSystemPrompt } from "../src/solve/built-starter.ts";
import { DEFAULT_HARNESS_SETTINGS } from "../src/truth/harness-config.ts";
import { REPO_ROOT, runTypeScript } from "../.claude/skills/system-path-simulation/scripts/test-support.mjs";
import { runtimeProcess } from "../src/meta/process.ts";

let root;

function run(args, options = {}) {
  return runTypeScript("show-prompt-surfaces.mts", args, options);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "simulation-prompt-surfaces-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

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

  it("prints the exact kickoff while preserving prompt whitespace", () => {
    const prompt = "  build this  ";
    const result = run(["--surface", "kickoff", "--prompt", prompt]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${directKickoff(prompt, prepareUserContext(REPO_ROOT))}\n`);
  });

  it("accepts a dashed prompt through --prompt=<value>", () => {
    const prompt = "--build this";
    const result = run(["--surface", "kickoff", `--prompt=${prompt}`]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`USER REQUEST (verbatim)\n${prompt}\n`);
  });

  it("uses the script's run tree while invoked from another cwd", () => {
    const contextName = `.scratch/prompt-surface-context-${runtimeProcess.pid}.txt`;
    const contextPath = join(REPO_ROOT, contextName);
    mkdirSync(join(REPO_ROOT, ".scratch"), { recursive: true });
    writeFileSync(contextPath, "public context\n");
    try {
      const result = run(["--surface", "kickoff", "--prompt", "build", "--context", contextPath], {
        cwd: root,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(`- ctx-1: prompt-surface-context-${runtimeProcess.pid}.txt`);
    } finally {
      rmSync(contextPath, { force: true });
    }
  });

  it("prints the Built solver's universal prompt, nudge and shell schema at the seeded walls", () => {
    const result = run(["--surface", "built"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`${builtSystemPrompt(DEFAULT_HARNESS_SETTINGS.solveMs)}\n`);
    expect(result.stdout).toContain(`${BUILT_NUDGE}\n`);
    expect(result.stdout).toContain(
      `${DEFAULT_HARNESS_SETTINGS.shellDefaultSeconds} when omitted, at most ${DEFAULT_HARNESS_SETTINGS.shellMaxSeconds}`,
    );
    expect(run(["--surface", "built", "--prompt", "x"]).exitCode).toBe(2);
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
});

describe("prompt text argument refusals", () => {
  it("refuses an absent surface", () => {
    const result = run([]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("pass --surface system, kickoff or built");
  });

  it("refuses an empty kickoff prompt", () => {
    const result = run(["--surface", "kickoff", "--prompt", " \t "]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("kickoff surface needs --prompt");
  });

  it("refuses an empty grep instead of matching every line", () => {
    const result = run(["--surface", "system", "--grep", ""]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--grep must not be empty");
  });

  it("refuses an unknown option", () => {
    const result = run(["--surface", "system", "--surfaec", "typo"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('unknown option "--surfaec"');
  });

  it("refuses duplicate singleton options", () => {
    const result = run(["--surface", "system", "--surface", "kickoff", "--prompt", "build"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('option "--surface" may be passed only once');
  });

  it("refuses a value attached to a boolean flag", () => {
    const result = run(["--surface", "system", "--web-search", "false"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('unexpected positional argument "false"');
  });

  it("refuses a kickoff-only prompt on the system surface", () => {
    const result = run(["--surface", "system", "--prompt", "build"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--prompt is only valid with --surface kickoff");
  });

  it("refuses kickoff context on the system surface", () => {
    const result = run(["--surface", "system", "--context", root]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--context is only valid with --surface kickoff");
  });

  it("refuses web search on the kickoff surface", () => {
    const result = run(["--surface", "kickoff", "--prompt", "build", "--web-search"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--web-search is only valid with --surface system");
  });
});

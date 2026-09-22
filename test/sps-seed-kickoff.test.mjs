import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { prepareUserContext } from "../src/builder/user-context.ts";
import { directKickoff } from "../src/run/direct-input.ts";
import { REPO_ROOT, runTypeScript } from "../.claude/skills/system-path-simulation/scripts/test-support.mjs";

let root;

function run(args, options = {}) {
  return runTypeScript("seed-kickoff.mts", args, options);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "simulation-seed-kickoff-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("seed kickoff byte identity", () => {
  it("preserves leading and trailing whitespace in an inline prompt", () => {
    const prompt = "  build this harness  ";
    const result = run(["--prompt", prompt]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${directKickoff(prompt, prepareUserContext(REPO_ROOT))}\n`);
  });

  it("preserves prompt-file bytes including a final newline", () => {
    const prompt = "build this harness\n";
    const path = join(root, "prompt.txt");
    writeFileSync(path, prompt);
    const result = run(["--prompt-file", path]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${directKickoff(prompt, prepareUserContext(REPO_ROOT))}\n`);
  });

  it("accepts a value beginning with dashes through --prompt=<value>", () => {
    const prompt = "--build the requested harness";
    const result = run([`--prompt=${prompt}`]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`USER REQUEST (verbatim)\n${prompt}\n`);
  });

  it("refuses when neither prompt source is present", () => {
    const result = run([]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("pass exactly one of --prompt-file");
  });

  it("refuses when both prompt sources are present", () => {
    const path = join(root, "prompt.txt");
    writeFileSync(path, "from file");
    const result = run(["--prompt-file", path, "--prompt", "inline"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("pass exactly one of --prompt-file");
  });

  it("refuses a whitespace-only prompt", () => {
    const result = run(["--prompt", " \n\t "]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("the prompt is empty");
  });

  it("requires an exact simulated-position label", () => {
    const path = join(root, "position.txt");
    writeFileSync(path, "SIMULATED POSITIONING\nThis is not the declared label.\n");
    const result = run(["--prompt", "build", "--position-file", path]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('must open with "SIMULATED POSITION"');
  });

  it("accepts the label followed by an em-dash explanation", () => {
    const path = join(root, "position.txt");
    const position = "SIMULATED POSITION — this session was seeded.\nYou were in A.\n";
    writeFileSync(path, position);
    const result = run(["--prompt", "build", "--position-file", path]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(position);
  });

  it("preserves the position block's trailing whitespace", () => {
    const path = join(root, "position.txt");
    const position = "SIMULATED POSITION\nYou were in A.  \n\n";
    writeFileSync(path, position);
    const result = run(["--prompt", "build", "--position-file", path]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(position);
  });

  it("preserves appendix bytes including trailing spaces and blank lines", () => {
    const path = join(root, "appendix.txt");
    const appendix = "CONTROLLER CONTRACT\nScope B.  \n\n";
    writeFileSync(path, appendix);
    const result = run(["--prompt", "build", "--append-file", path]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(appendix);
  });

  it("keeps repeated appendices in operator order", () => {
    const first = join(root, "first.txt");
    const second = join(root, "second.txt");
    writeFileSync(first, "FIRST\n");
    writeFileSync(second, "SECOND\n");
    const result = run(["--prompt", "build", "--append-file", first, "--append-file", second]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.indexOf("FIRST\n")).toBeLessThan(result.stdout.indexOf("SECOND\n"));
  });

  it("uses the production context admission and records the admitted count", () => {
    const context = join(root, "context");
    mkdirSync(context);
    writeFileSync(join(context, "facts.txt"), "public fact\n");
    const out = join(root, "kickoff.txt");
    const result = run(["--prompt", "build", "--context", context, "--out", out]);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(out, "utf8")).toContain("context/facts.txt");
    expect(result.stderr).toContain("1 context files");
  });

  it("writes the same bytes to a file that stdout mode returns", () => {
    const out = join(root, "kickoff.txt");
    const stdoutResult = run(["--prompt", "build"]);
    const fileResult = run(["--prompt", "build", "--out", out]);
    expect(fileResult.exitCode).toBe(0);
    expect(fileResult.stdout).toBe("");
    expect(readFileSync(out, "utf8")).toBe(stdoutResult.stdout);
  });
});

describe("seed kickoff argument refusals", () => {
  it("refuses an unknown option", () => {
    const result = run(["--prompt", "build", "--promtp", "typo"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('unknown option "--promtp"');
  });

  it("refuses a duplicate singleton instead of silently taking the last value", () => {
    const result = run(["--prompt", "first", "--prompt", "second"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('option "--prompt" may be passed only once');
  });

  it("refuses a missing repeatable value with the option name", () => {
    const result = run(["--prompt", "build", "--append-file"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('option "--append-file" needs a value');
  });

  it("refuses relative file paths", () => {
    const path = join(root, "prompt.txt");
    writeFileSync(path, "build");
    const result = run(["--prompt-file", "prompt.txt"], { cwd: root });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--prompt-file must be an absolute path");
  });
});

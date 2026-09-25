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

function file(name, text) {
  const path = join(root, name);
  writeFileSync(path, text);
  return path;
}

/** The production from-scratch kickoff for a prompt, admitting the given context paths. */
function kickoff(prompt, contextPaths = []) {
  return directKickoff(prompt, prepareUserContext(REPO_ROOT, contextPaths));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "simulation-seed-kickoff-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("seed kickoff byte identity", () => {
  it.each([
    [
      "an inline prompt with surrounding whitespace",
      "  build this harness  ",
      (prompt) => ["--prompt", prompt],
    ],
    [
      "a prompt file with its final newline",
      "build this harness\n",
      (prompt) => ["--prompt-file", file("p.txt", prompt)],
    ],
  ])("prints the production kickoff for %s byte for byte", (_name, prompt, args) => {
    const result = run(args(prompt));
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${kickoff(prompt)}\n`);
  });

  it.each([
    ["a plain label with trailing whitespace", "SIMULATED POSITION\nYou were in A.  \n\n"],
    [
      "a label followed by an em-dash explanation",
      "SIMULATED POSITION — this session was seeded.\nYou were in A.\n",
    ],
  ])("appends the position block (%s) and each appendix verbatim, in operator order", (_name, position) => {
    const appendix = "CONTROLLER CONTRACT\nScope B.  \n\n";
    const args = ["--prompt", "build", "--position-file", file("position.txt", position)];
    args.push("--append-file", file("first.txt", appendix), "--append-file", file("second.txt", "SECOND\n"));
    const result = run(args);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${kickoff("build")}\n\n${position}\n\n${appendix}\n\nSECOND\n`);
  });

  it("admits context through production from the script's run tree, and --out holds the stdout bytes", () => {
    // Invoked from another cwd whose own `context/` a cwd-relative admission would also pick up.
    const context = join(root, "context");
    mkdirSync(context);
    writeFileSync(join(context, "facts.txt"), "public fact\n");
    const printed = run(["--prompt", "build", "--context", context], { cwd: root });
    expect(printed.stdout).toBe(`${kickoff("build", [context])}\n`);
    expect(printed.stdout).toContain("context/facts.txt");
    const out = join(root, "kickoff.txt");
    const written = run(["--prompt", "build", "--context", context, "--out", out], { cwd: root });
    expect(written.exitCode).toBe(0);
    expect(written.stdout).toBe("");
    expect(written.stderr).toContain("1 context files");
    expect(readFileSync(out, "utf8")).toBe(printed.stdout);
  });

  it.each([
    ["neither prompt source", () => [], "pass exactly one of --prompt-file"],
    [
      "both prompt sources",
      () => ["--prompt-file", file("p.txt", "x"), "--prompt", "inline"],
      "pass exactly one of",
    ],
    ["a whitespace-only prompt", () => ["--prompt", " \n\t "], "the prompt is empty"],
    [
      "a position block without the exact label",
      () => [
        "--prompt",
        "build",
        "--position-file",
        file("position.txt", "SIMULATED POSITIONING\nnot it.\n"),
      ],
      'must open with "SIMULATED POSITION"',
    ],
  ])("refuses %s", (_name, args, message) => {
    const result = run(args());
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(message);
  });
});

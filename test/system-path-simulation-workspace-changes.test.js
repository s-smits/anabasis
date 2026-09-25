import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { execTextSync } from "./helpers/bun-spawn-sync.ts";
import {
  changedPaths,
  SESSION_NOTE_PATHS,
} from "../.claude/skills/system-path-simulation/scripts/workspace-changes.mts";
import { runTypeScript } from "../.claude/skills/system-path-simulation/scripts/test-support.mjs";

const roots = [];

function git(cwd, ...args) {
  return execTextSync("git", args, { cwd });
}

function repository() {
  const root = mkdtempSync(join(tmpdir(), "simulation-workspace-changes-"));
  roots.push(root);
  git(root, "init", "--quiet");
  git(root, "config", "user.email", "simulation@example.invalid");
  git(root, "config", "user.name", "Simulation Test");
  writeFileSync(join(root, "base.txt"), "base\n");
  git(root, "add", "base.txt");
  git(root, "commit", "--quiet", "-m", "fixture");
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("workspace change evidence", () => {
  it("reports a clean workspace with a stable 64-character digest", () => {
    const root = repository();
    const first = changedPaths(root);
    const second = changedPaths(root);
    expect(first).toEqual(second);
    expect(first.all).toEqual([]);
    expect(first.substantive).toEqual([]);
    expect(first.diffSha).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not lose the first character of the first path", () => {
    const root = repository();
    writeFileSync(join(root, "MEMORY.md"), "session note\n");
    writeFileSync(join(root, "actual.txt"), "work\n");
    expect(changedPaths(root).all).toContain("MEMORY.md");
  });

  it("excludes only the three session note paths by default", () => {
    const root = repository();
    mkdirSync(join(root, "agent"));
    for (const path of SESSION_NOTE_PATHS) writeFileSync(join(root, path), `${path}\n`);
    writeFileSync(join(root, "result.txt"), "material\n");
    expect(changedPaths(root)).toMatchObject({
      all: ["MEMORY.md", "SCRATCHPAD.md", "agent/BUILT_AGENTS.md", "result.txt"],
      substantive: ["result.txt"],
    });
  });

  it("accepts an explicit exclusion set without applying the default", () => {
    const root = repository();
    writeFileSync(join(root, "MEMORY.md"), "note\n");
    writeFileSync(join(root, "result.txt"), "material\n");
    expect(changedPaths(root, ["result.txt"]).substantive).toEqual(["MEMORY.md"]);
  });

  it("preserves leading and trailing spaces in a filename", () => {
    const root = repository();
    writeFileSync(join(root, " leading and trailing "), "material\n");
    expect(changedPaths(root).all).toEqual([" leading and trailing "]);
  });

  it("preserves a newline inside a filename", () => {
    const root = repository();
    const path = "line one\nline two.txt";
    writeFileSync(join(root, path), "material\n");
    expect(changedPaths(root).all).toEqual([path]);
  });

  it("does not read an arrow inside a filename as a rename", () => {
    const root = repository();
    const path = "choice -> outcome.txt";
    writeFileSync(join(root, path), "material\n");
    expect(changedPaths(root).all).toEqual([path]);
  });

  it("reports the destination of a staged rename", () => {
    const root = repository();
    git(root, "mv", "base.txt", "renamed.txt");
    expect(changedPaths(root).all).toEqual(["renamed.txt"]);
  });

  it("reports a deleted tracked path", () => {
    const root = repository();
    rmSync(join(root, "base.txt"));
    expect(changedPaths(root).all).toEqual(["base.txt"]);
  });

  it("changes the digest when an unstaged tracked file changes", () => {
    const root = repository();
    const clean = changedPaths(root).diffSha;
    writeFileSync(join(root, "base.txt"), "changed\n");
    expect(changedPaths(root).diffSha).not.toBe(clean);
  });

  it("changes the digest for staged-only content", () => {
    const root = repository();
    const clean = changedPaths(root).diffSha;
    writeFileSync(join(root, "staged.txt"), "staged\n");
    git(root, "add", "staged.txt");
    expect(changedPaths(root).diffSha).not.toBe(clean);
  });

  it("changes the digest when untracked bytes change at the same path", () => {
    const root = repository();
    writeFileSync(join(root, "new.txt"), "first\n");
    const first = changedPaths(root).diffSha;
    writeFileSync(join(root, "new.txt"), "second\n");
    expect(changedPaths(root).diffSha).not.toBe(first);
  });

  it("changes the digest when a symlink target changes", () => {
    const root = repository();
    symlinkSync("first-target", join(root, "pointer"));
    const first = changedPaths(root).diffSha;
    unlinkSync(join(root, "pointer"));
    symlinkSync("second-target", join(root, "pointer"));
    expect(changedPaths(root).diffSha).not.toBe(first);
  });

  it("prints the module result through the CLI", () => {
    const root = repository();
    writeFileSync(join(root, "result.txt"), "material\n");
    const result = runTypeScript("workspace-changes.mts", [root]);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(changedPaths(root));
    expect(result.stderr).toBe("");
  });

  it("refuses a missing workspace argument before calling Git", () => {
    const result = runTypeScript("workspace-changes.mts");
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("workspace-changes: expected 1 positional argument\n");
  });
});

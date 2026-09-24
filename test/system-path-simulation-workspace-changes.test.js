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

  it.each([
    [
      "leading and trailing spaces",
      (root) => writeFileSync(join(root, " leading and trailing "), "x\n"),
      [" leading and trailing "],
    ],
    [
      "a newline",
      (root) => writeFileSync(join(root, "line one\nline two.txt"), "x\n"),
      ["line one\nline two.txt"],
    ],
    [
      "an arrow that is not a rename",
      (root) => writeFileSync(join(root, "choice -> outcome.txt"), "x\n"),
      ["choice -> outcome.txt"],
    ],
    ["a staged rename's destination", (root) => git(root, "mv", "base.txt", "renamed.txt"), ["renamed.txt"]],
    ["a deleted tracked path", (root) => rmSync(join(root, "base.txt")), ["base.txt"]],
  ])("reports %s as exactly that path", (_name, change, expected) => {
    const root = repository();
    change(root);
    expect(changedPaths(root).all).toEqual(expected);
  });

  it.each([
    [
      "an unstaged tracked file changes",
      () => {},
      (root) => writeFileSync(join(root, "base.txt"), "changed\n"),
    ],
    [
      "only staged content changes",
      () => {},
      (root) => {
        writeFileSync(join(root, "staged.txt"), "staged\n");
        git(root, "add", "staged.txt");
      },
    ],
    [
      "untracked bytes change at the same path",
      (root) => writeFileSync(join(root, "new.txt"), "first\n"),
      (root) => writeFileSync(join(root, "new.txt"), "second\n"),
    ],
    [
      "a symlink target changes",
      (root) => symlinkSync("first-target", join(root, "pointer")),
      (root) => {
        unlinkSync(join(root, "pointer"));
        symlinkSync("second-target", join(root, "pointer"));
      },
    ],
  ])("changes the digest when %s", (_name, before, after) => {
    const root = repository();
    before(root);
    const first = changedPaths(root).diffSha;
    after(root);
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
});

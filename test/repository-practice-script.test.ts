// Check preflight suggestions against the gate, hook routes, size policy and label set, and the
// direction check against an import graph. Fixtures use temporary repositories.
import { afterAll, describe, expect, it } from "bun:test";
import { breaches } from "#skills/repository-practice/scripts/direction.ts";
import { treeLines } from "#skills/repository-practice/scripts/preflight.ts";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { runTextSyncOrThrow } from "../src/meta/subprocess.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-preflight-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const git = (repo: string, ...args: string[]) =>
  runTextSyncOrThrow(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t.dev", ...args]).trim();

function write(repo: string, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  }
}

/** A repository whose first commit holds two modules, each with the test that imports it. */
function repository(): string {
  const repo = mkdtempSync(join(root, "repo-"));
  git(repo, "init", "-q", "-b", "main");
  write(repo, {
    "src/kernel/compare.ts": "export const a = 1;\n",
    "src/kernel/other.ts": "export const b = 2;\n",
    "test/compare.test.ts": 'import { a } from "../src/kernel/compare.ts";\nexport const t = a;\n',
    "test/other.test.ts": 'import { b } from "../src/kernel/other.ts";\nexport const u = b;\n',
    "README.md": "A readme.\n",
  });
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "first");
  return repo;
}

describe("the tree a change is made in", () => {
  it("refuses a run in a main worktree and allows one in a worktree of its own, and reads the hooks", () => {
    const repo = repository();
    const main = treeLines(repo, "no-stack");
    expect(main[0]).toStartWith("hooks: unset");
    expect(main[1]).toStartWith("tree: no run here");
    const own = join(root, `own-${String(Date.now())}`);
    git(repo, "worktree", "add", "-q", "--detach", own);
    git(own, "config", "core.hooksPath", ".githooks");
    expect(treeLines(own, "no-stack")).toStrictEqual([
      "hooks: on (.githooks)",
      "tree: may hold a run or a simulation",
    ]);
  });
});

describe("the direction check", () => {
  it("reports production-to-helper and test imports while allowing helpers to import production", () => {
    const edges = new Map<string, readonly string[]>([
      ["src/a.ts", ["src/b.ts", ".claude/skills/x/scripts/y.ts"]],
      ["tools/d2/c.ts", ["tools/wri/folds.ts", "test/helpers/matchers.ts", "src/a.ts"]],
      [".claude/skills/x/scripts/y.ts", ["src/a.ts"]],
      ["studies/s/run.ts", ["src/a.ts"]],
    ]);
    const found = breaches([...edges.keys()], (file) => edges.get(file) ?? []);
    expect(found).toStrictEqual([
      { file: "src/a.ts", imported: ".claude/skills/x/scripts/y.ts", root: ".claude/" },
      { file: "tools/d2/c.ts", imported: "tools/wri/folds.ts", root: "tools/wri/" },
      { file: "tools/d2/c.ts", imported: "test/helpers/matchers.ts", root: "test/" },
    ]);
  });
});

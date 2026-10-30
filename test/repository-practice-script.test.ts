// Check preflight suggestions against the gate, hook routes, size policy and label set.
// Fixtures use temporary repositories.
import { afterAll, describe, expect, it } from "bun:test";
import {
  changeOf,
  labelsOf,
  owedOf,
  proseFindings,
  told,
  treeLines,
} from "#skills/repository-practice/scripts/preflight.ts";
import { CATEGORIES } from "#tools/runtime/land.ts";
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

const body = (lines: number) =>
  Array.from({ length: lines }, (_, at) => `export const v${String(at)} = ${String(at)};`).join("\n");

describe("what a change owes", () => {
  it("names the test one import from a changed module and leaves out the test of the module beside it", () => {
    const repo = repository();
    write(repo, { "src/kernel/compare.ts": "export const a = 3;\n" });
    const owed = owedOf(repo, changeOf(repo, { base: "HEAD" }));
    expect(owed.documentationOnly).toBe(false);
    expect(owed.tests).toStrictEqual(["test/compare.test.ts"]);
    expect(owed.areas.map((area) => area.id)).toContain("measurement");
    expect(owed.areas.map((area) => area.id)).not.toContain("seats");
    expect(owed.ui).toStrictEqual([]);
  });

  it("reads a recorded commit as the working tree read it, and a documentation change as owing no test", () => {
    const repo = repository();
    write(repo, { "src/kernel/other.ts": "export const b = 4;\n" });
    git(repo, "commit", "-q", "-am", "code");
    write(repo, { "README.md": "A longer readme.\n", "docs/plan.md": "A plan.\n" });
    const docs = owedOf(repo, changeOf(repo, { base: "HEAD" }));
    expect(docs.documentationOnly).toBe(true);
    expect(docs.tests).toStrictEqual([]);
    expect(docs.changed).toBe(2);
    expect(docs.importance.label).toBe("importance:I3");
    expect(docs.category.label).toBe("docs");
    const code = owedOf(repo, changeOf(repo, { commit: git(repo, "rev-parse", "HEAD") }));
    expect(code.documentationOnly).toBe(false);
    expect(code.tests).toStrictEqual(["test/other.test.ts"]);
  });

  it("owes the UI gate for a change to the UI or its setup, and names rule 3's area for a seat's source", () => {
    const repo = repository();
    write(repo, {
      "packages/ui/src/view.ts": "export const v = 1;\n",
      "src/builder/prompt.ts": "export const p = 1;\n",
    });
    const owed = owedOf(repo, changeOf(repo, { base: "HEAD" }));
    expect(owed.ui).toStrictEqual(["packages/ui/src/view.ts"]);
    const seats = owed.areas.find((area) => area.id === "seats");
    expect(seats?.files).toStrictEqual(["src/builder/prompt.ts"]);
    expect(seats?.said).toContain("test/builder.test.ts");
    const setup = repository();
    write(setup, { "tsconfig.json": "{}\n" });
    expect(owedOf(setup, changeOf(setup, { base: "HEAD" })).ui).toStrictEqual(["tsconfig.json"]);
  });

  it("reports a changed file one line over the ceiling and not one at it", () => {
    const repo = repository();
    write(repo, { "src/kernel/compare.ts": `${body(801)}\n`, "src/kernel/other.ts": `${body(800)}\n` });
    const size = owedOf(repo, changeOf(repo, { base: "HEAD" })).size;
    expect(size).toHaveLength(1);
    expect(size[0]).toStartWith("src/kernel/compare.ts: 801 ");
  });

  it("prints one line a fact, the suggested labels marked as a suggestion", () => {
    const repo = repository();
    write(repo, { "src/kernel/compare.ts": "export const a = 5;\n" });
    const lines = told(owedOf(repo, changeOf(repo, { base: "HEAD" })));
    expect(lines.find((line) => line.startsWith("tests "))).toEndWith("bun run test -- test/compare.test.ts");
    expect(lines.at(-1)).toStartWith("labels (a suggestion): importance:I1");
  });
});

describe("the suggested labels", () => {
  it("files a code change under its code's subject, not under the prose beside it", () => {
    const labels = labelsOf(["src/examiner/session.ts", "docs/plan.md"]);
    expect(labels.category.label).toBe("supply");
    expect(labels.importance.label).toBe("importance:I2");
  });

  it("suggests only categories the landing accepts", () => {
    const paths = [
      "src/kernel/log.ts",
      "src/kernel/compare.ts",
      "src/campaign/decide.ts",
      "src/builder/tools.ts",
      "src/examiner/write.ts",
      "src/referee/referee.ts",
      "src/wall/base.ts",
      "tools/d2/host.ts",
      "tools/runs/manage.ts",
      "tools/runtime/gate.ts",
      "tools/oxlint/ana/index.ts",
      "AGENTS.md",
      "a/b/c.ts",
    ];
    for (const path of paths) expect(CATEGORIES.has(labelsOf([path]).category.label)).toBe(true);
    expect(labelsOf(["test/compare.test.ts"]).category.label).toBe("misc");
  });
});

describe("the prose of a changed Markdown file", () => {
  it("finds an em dash, a banned word, a relative date, an exclamation and an American spelling", () => {
    const text = [
      "One — two.",
      "A robust reader.",
      "It ran yesterday.",
      "It passed!",
      "Its behavior changed.",
    ].join("\n");
    expect(proseFindings("x.md", text).map((found) => [found.line, found.kind])).toStrictEqual([
      [1, "em dash"],
      [2, "banned word"],
      [3, "relative date"],
      [4, "exclamation mark"],
      [5, "American spelling"],
    ]);
  });

  it("leaves the same words alone in code, a quotation, a link and a path", () => {
    const text = [
      'Use no `robust` and no "bulletproof".',
      "```",
      "One — two, yesterday!",
      "```",
      "The case [optimize](cases/optimize.md) and `x!` and docs/behavior.md.",
    ].join("\n");
    expect(proseFindings("x.md", text)).toStrictEqual([]);
  });
});

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

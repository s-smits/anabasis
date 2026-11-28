import { afterAll, describe, expect, it } from "bun:test";
import { addedLines, gitText } from "#src/meta/git.ts";
import { mkdtempSync, rmSync, writeFileSync } from "#src/meta/filesystem.ts";
import { tmpdir } from "#src/meta/os.ts";
import { join } from "#src/meta/path.ts";

const co = mkdtempSync(join(tmpdir(), "ana-added-lines-"));
afterAll(() => rmSync(co, { recursive: true, force: true }));

describe("added lines of staged files", () => {
  it("keys every staged file by its own path, read as a literal pathspec", () => {
    gitText(co, "init", "-q");
    gitText(co, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
    const names = ["plain.ts", "café.ts", "we[ir]d.ts", "tab\there.ts"];
    for (const name of names) writeFileSync(join(co, name), "a\nb\n");
    gitText(co, "add", ".");
    const staged = gitText(co, "diff", "--cached", "--name-only", "-z").split("\0").filter(Boolean);
    const lines = addedLines(co, "--cached", "HEAD", "--", ...staged.map((path) => `:(literal)${path}`));
    expect(new Map([...lines].map(([path, set]) => [path, [...set]]))).toStrictEqual(
      new Map(names.map((name) => [name, [1, 2]])),
    );
  });
});

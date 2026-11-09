// The replay that `bun run land --sanitize` makes of a chain whose parent moved (`restacked`,
// `tools/runtime/restack.ts`), over real commits: each pull request's own commits move onto the new
// head beneath it, from the head it was built on, and nothing of the parent's old commits comes with them.
import { afterAll, describe, expect, it } from "bun:test";
import { gitText } from "#src/meta/git.ts";
import { mkdtempSync, rmSync, writeFileSync } from "#src/meta/filesystem.ts";
import { tmpdir } from "#src/meta/os.ts";
import { join } from "#src/meta/path.ts";
import type { Pull } from "#tools/runtime/pulls.ts";
import { type FormerHead, restacked, Unreplayable } from "#tools/runtime/restack.ts";

const co = mkdtempSync(join(tmpdir(), "ana-restack-"));
afterAll(() => rmSync(co, { recursive: true, force: true }));
const git = (...args: string[]): string => gitText(co, ...args);
function step(file: string, text: string): string {
  writeFileSync(join(co, file), text);
  git("add", file);
  git("commit", "-q", "-m", `write ${file}: ${text.trim()}`);
  return git("rev-parse", "HEAD");
}
const pull = (number: number, headRefOid: string): Pull => ({
  number,
  headRefName: `p${String(number)}`,
  baseRefName: number === 1 ? "main" : `p${String(number - 1)}`,
  headRefOid,
  isDraft: true,
  labels: [],
});
const tree = (commit: string): string => git("rev-parse", `${commit}^{tree}`);
const show = (commit: string, file: string): string => git("show", `${commit}:${file}`);

git("init", "-q", "-b", "main");
git("config", "user.name", "t");
git("config", "user.email", "t@t.dev");
const trunk = step("base.txt", "base\n");
// #1 holds two commits, #2 one on #1, #3 one on #2.
step("a.txt", "a\n");
const a = step("a2.txt", "a2\n");
const b = step("b.txt", "b\n");
const c = step("c.txt", "c\n");
// #1 rewritten under its children, as a fix folded into its last commit is.
git("switch", "-q", "--detach", a);
writeFileSync(join(co, "a2.txt"), "a2, fixed\n");
git("commit", "-q", "-a", "--amend", "--no-edit");
const fixed = git("rev-parse", "HEAD");
const former =
  (heads: Record<number, string>): FormerHead =>
  (parent) =>
    heads[parent.number] ?? null;

describe("restacking a chain whose parent moved", () => {
  it("keeps a chain that holds what is beneath it", () => {
    const line = [pull(1, a), pull(2, b), pull(3, c)];
    expect(restacked(co, line, trunk, former({}))).toStrictEqual(
      new Map([
        [1, a],
        [2, b],
        [3, c],
      ]),
    );
  });

  it("moves each child's own commits onto the rewritten parent, and none of the parent's old ones", () => {
    const heads = restacked(co, [pull(1, fixed), pull(2, b), pull(3, c)], trunk, former({ 1: a }));
    const [b1 = "", c1 = ""] = [heads.get(2), heads.get(3)];
    expect(heads.get(1)).toBe(fixed);
    expect(git("rev-parse", `${b1}^`)).toBe(fixed);
    expect(git("rev-parse", `${c1}^`)).toBe(b1);
    expect(git("rev-list", "--count", `${fixed}..${c1}`)).toBe("2");
    expect(show(c1, "a2.txt")).toBe("a2, fixed");
    expect(show(c1, "c.txt")).toBe("c");
    // The merge base beneath the rewritten parent is `a`'s parent, from which the old a2.txt would come across.
    expect(git("merge-base", fixed, b)).not.toBe(a);
  });

  it("moves a child onto a parent that only gained a commit", () => {
    git("switch", "-q", "--detach", a);
    const grown = step("a3.txt", "a3\n");
    const heads = restacked(co, [pull(1, grown), pull(2, b)], trunk, former({ 1: a }));
    expect(git("rev-parse", `${heads.get(2) ?? ""}^`)).toBe(grown);
    expect(tree(heads.get(2) ?? "")).not.toBe(tree(b));
  });

  it("refuses a child that holds none of its parent's earlier heads, and one that conflicts", () => {
    const line = [pull(1, fixed), pull(2, b)];
    expect(() => restacked(co, line, trunk, former({}))).toThrow(Unreplayable);
    git("switch", "-q", "--detach", a);
    writeFileSync(join(co, "b.txt"), "b, written beneath\n");
    git("add", "b.txt");
    git("commit", "-q", "-m", "write b.txt beneath");
    const clash = git("rev-parse", "HEAD");
    expect(() => restacked(co, [pull(1, clash), pull(2, b)], trunk, former({ 1: a }))).toThrow(
      "does not replay cleanly",
    );
  });
});

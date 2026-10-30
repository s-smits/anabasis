import { describe, expect, it } from "bun:test";
import { doubled } from "../tools/runtime/doubled.ts";
import type { Pull } from "../tools/runtime/pulls.ts";

const pull = (number: number, head: string, base: string, oid = head): Pull => ({
  number,
  headRefName: head,
  baseRefName: base,
  headRefOid: oid,
  isDraft: true,
  labels: [],
});

/** Ancestry over a history written as each commit's parent. */
const history =
  (parents: Record<string, string>) =>
  (head: string, other: string): boolean => {
    for (let at: string | undefined = head; at !== undefined; at = parents[at]) if (at === other) return true;
    return false;
  };

const numbersOf = (found: ReturnType<typeof doubled>) =>
  found.map(({ pull: one, repeats }) => [one.number, repeats.map((other) => other.number)]);

describe("pull requests that repeat another's commits", () => {
  // main <- a (#529) <- b (#530) <- c (#531)
  const holds = history({ a: "main", b: "a", c: "b" });

  it("names a pull request whose head holds another's that is not beneath it", () => {
    const open = [pull(529, "a", "main"), pull(530, "b", "a"), pull(531, "c", "a")];
    expect(numbersOf(doubled(open, holds))).toEqual([[531, [530]]]);
  });

  it("names none once it stands on the one it holds", () => {
    const open = [pull(529, "a", "main"), pull(530, "b", "a"), pull(531, "c", "b")];
    expect(doubled(open, holds)).toEqual([]);
  });

  it("allows stacking out of the order of the numbers, and a child with no commits of its own", () => {
    const open = [pull(540, "a", "main"), pull(535, "b", "a"), pull(536, "b2", "b", "b")];
    expect(doubled(open, holds)).toEqual([]);
  });

  it("names a pull request based on main that holds a whole open chain", () => {
    const open = [pull(529, "a", "main"), pull(530, "b", "a"), pull(531, "c", "main")];
    expect(numbersOf(doubled(open, holds))).toEqual([[531, [529, 530]]]);
  });
});

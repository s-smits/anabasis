// The one reader of the open stacks' chains (`tools/runtime/pulls.ts`), which `land`, `follow`,
// `stack.ts`, `republish.ts`, `split` and `doubled.ts` all call: the chains of bases, what stands
// beneath and above one pull request, and the stack landed and followed first.
import { describe, expect, it } from "bun:test";
import { beneath, chainAbove, chains, firstStack, type Pull, stackHolding } from "../tools/runtime/pulls.ts";

const pull = (number: number, head: string, base: string): Pull => ({
  number,
  headRefName: head,
  baseRefName: base,
  headRefOid: head.padEnd(40, "0"),
  isDraft: false,
  labels: [],
});
const numbers = (pulls: readonly Pull[] | undefined): number[] => (pulls ?? []).map((each) => each.number);

describe("the chains of bases", () => {
  // main <- a #1 <- b #2 <- c #3, a fork d #9 off a, a lone #7, and #5 on a merged branch.
  const open = [
    pull(7, "lone", "main"),
    pull(3, "c", "b"),
    pull(1, "a", "main"),
    pull(9, "d", "a"),
    pull(2, "b", "a"),
    pull(5, "late", "merged"),
  ];

  it("lists each chain bottom first, longest first, and a fork off the middle apart", () => {
    const { stacks, sides } = chains(open);
    expect(stacks.map(numbers)).toEqual([[1, 2, 3], [5], [7]]);
    expect(numbers(sides)).toEqual([9]);
  });

  it("reads beneath by bases and above by the longest chain, the lower number winning a tie", () => {
    expect(numbers(beneath(open, pull(3, "c", "b")))).toEqual([2, 1]);
    expect(numbers(chainAbove(open, pull(1, "a", "main")))).toEqual([2, 3]);
    const tie = [pull(1, "a", "main"), pull(4, "y", "a"), pull(2, "x", "a")];
    expect(numbers(chainAbove(tie, pull(1, "a", "main")))).toEqual([2]);
    expect(numbers(chainAbove(open, pull(9, "d", "a")))).toEqual([]);
  });

  it("survives a loop of bases without reading forever", () => {
    const loop = [pull(1, "a", "b"), pull(2, "b", "a")];
    expect(numbers(beneath(loop, pull(1, "a", "b")))).toEqual([2]);
    expect(numbers(chainAbove(loop, pull(1, "a", "b")))).toEqual([2]);
  });

  it("finds the stack that holds a pull request, and none for a fork off the middle", () => {
    expect(numbers(stackHolding(open, 2))).toEqual([1, 2, 3]);
    expect(stackHolding(open, 9)).toBeUndefined();
  });
});

describe("the stack landed and followed first", () => {
  it("is the stack of two or more that holds the oldest pull request, ahead of an older lone one", () => {
    const open = [pull(4, "lone", "main"), pull(20, "x", "main"), pull(8, "y", "x"), pull(12, "z", "main")];
    expect(numbers(firstStack([...open, pull(13, "w", "z")]))).toEqual([20, 8]);
    expect(numbers(firstStack([pull(12, "z", "main"), pull(4, "lone", "main")])), "only lone ones").toEqual([
      4,
    ]);
  });

  it("takes a pull request stacked on the top before anyone linked it", () => {
    const open = [pull(193, "a", "main"), pull(194, "b", "a"), pull(199, "c", "b"), pull(202, "e", "c")];
    expect(firstStack(open).at(-1)?.number).toBe(202);
  });

  it("is empty where nothing is open", () => {
    expect(firstStack([])).toEqual([]);
  });
});

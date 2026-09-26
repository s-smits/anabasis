import { describe, expect, test } from "bun:test";
import { type OpenPullRequest, stackOf } from "../.claude/skills/launch-run/scripts/launch.ts";
import { describeSourceRef, launchSourceRef, sourceRefOf } from "../src/run/source-ref.ts";

const sha = (digit: string) => digit.repeat(40);
const MAIN = sha("0");
const OPEN: OpenPullRequest[] = [
  { number: 32, headRefName: "climb", headRefOid: sha("a"), baseRefName: "main" },
  { number: 33, headRefName: "gate", headRefOid: sha("b"), baseRefName: "climb" },
  { number: 34, headRefName: "rent", headRefOid: sha("c"), baseRefName: "gate" },
];
// A linear history main < a < m (inside #33) < b < c.
const ORDER = [MAIN, sha("a"), sha("m"), sha("b"), sha("c")];
const contains = (commit: string, head: string) => ORDER.indexOf(commit) <= ORDER.indexOf(head);

describe("the launch source stack", () => {
  test("a PR head names its pull request and every base down to main", () => {
    const placed = stackOf(sha("c"), MAIN, OPEN, contains);
    expect(placed.atHead).toBe(true);
    expect(placed.stack?.map((edge) => edge.pr)).toEqual([34, 33, 32]);
  });

  test("an earlier commit of a pull request is placed in it, not at its head", () => {
    const placed = stackOf(sha("m"), MAIN, OPEN, contains);
    expect(placed).toMatchObject({ atHead: false, stack: [{ pr: 33 }, { pr: 32 }] });
  });

  test("a commit already on main is carried by no open pull request", () => {
    expect(stackOf(MAIN, MAIN, OPEN, contains)).toEqual({ atHead: false, stack: [] });
  });
});

describe("the recorded reference", () => {
  const ref = { requested: "pr:34", main: MAIN, ...stackOf(sha("c"), MAIN, OPEN, contains) };

  test("round-trips through the launcher's environment and reads the stack bottom up", () => {
    const read = launchSourceRef(JSON.stringify(ref), sha("c"));
    expect(read).toEqual(ref);
    expect(describeSourceRef(ref)).toBe("PR #34 rent at its head; stack main → #32 → #33 → #34");
  });

  test("refuses a reference whose head is not the launched commit", () => {
    expect(() => launchSourceRef(JSON.stringify(ref), sha("b"))).toThrow(
      "does not describe the launched commit",
    );
    expect(() => sourceRefOf({ ...ref, stack: [{ pr: 34 }] }, sha("c"))).toThrow();
  });

  test("an absent reference and an unreadable GitHub are told apart", () => {
    expect(launchSourceRef(undefined, sha("c"))).toBeNull();
    const blind = sourceRefOf({ requested: sha("c"), main: MAIN, atHead: false, stack: null }, sha("c"));
    expect(describeSourceRef(blind ?? ref)).toContain("GitHub was unreadable");
  });

  test("names a pull request that moved since the launch", () => {
    expect(describeSourceRef(ref, () => sha("d"))).toContain(`since moved to ${sha("d").slice(0, 9)}`);
    expect(describeSourceRef(ref, () => sha("c"))).toContain("unmoved since");
  });
});

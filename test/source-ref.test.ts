import { afterAll, describe, expect, test } from "bun:test";
import {
  type OpenPullRequest,
  resolveSource,
  sourceRef,
  stackOf,
} from "../.claude/skills/launch-run/scripts/launch.ts";
import { mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
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

describe("a launch whose origin cannot be reached", () => {
  const repo = mkdtempSync(join(tmpdir(), "ana-source-ref-"));
  afterAll(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", "-C", repo, "-c", "user.name=t", "-c", "user.email=t@t", ...args]);
    expect(result.exitCode).toBe(0);
    return result.stdout.toString().trim();
  };
  git("init", "--quiet");
  git("commit", "--quiet", "--allow-empty", "-m", "local");
  git("remote", "add", "origin", join(repo, "no-such-remote"));
  const commit = git("rev-parse", "HEAD");

  test("still resolves a local full sha and records its provenance as unavailable", () => {
    expect(resolveSource(commit, repo)).toBe(commit);
    const ref = sourceRef(commit, commit, repo);
    expect(ref).toEqual({ requested: commit, main: null, atHead: false, stack: null });
    expect(launchSourceRef(JSON.stringify(ref), commit)).toEqual(ref);
    expect(describeSourceRef(ref)).toBe(`requested ${commit}; origin was unreachable at launch`);
  });

  test("still refuses a requested revision it cannot resolve", () => {
    expect(() => resolveSource("pr:5", repo)).toThrow();
    expect(() => resolveSource("f".repeat(40), repo)).toThrow();
  });

  test("never reads a null main beside a recorded stack", () => {
    expect(() => sourceRefOf({ requested: commit, main: null, atHead: false, stack: [] }, commit)).toThrow();
  });
});

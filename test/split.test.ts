import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";

import { afterAll, beforeEach, describe, expect, it } from "bun:test";

import { execTextSync, spawnTextSync } from "./helpers/bun-spawn-sync.ts";

const script = join(import.meta.dir, "..", "tools", "runtime", "split.ts");
const fixture = mkdtempSync(join(tmpdir(), "ana-split-"));
const bin = join(fixture, "bin");
const ghLog = join(fixture, "gh.log");
mkdirSync(bin);
writeFileSync(
  join(bin, "gh"),
  `#!/bin/sh
printf '%s\\n' "$*" >> "$ANA_GH_LOG"
case "$*" in
"pr view"*) printf '%s\\n' "$ANA_FAKE_CUT" ;;
"repo view"*) echo main ;;
"pr list"*) printf '%s\\n' "$ANA_FAKE_OPEN" ;;
"pr edit"*) if [ -n "$ANA_FAKE_EDIT_REFUSED" ]; then echo "edit refused" >&2; exit 1; fi ;;
"api"*) printf '%s\\n' "$ANA_FAKE_STACK" ;;
esac
`,
);
chmodSync(join(bin, "gh"), 0o755);

let work = "";
let origin = "";
let old: Record<string, string> = {};
let round = 0;

const git = (...args: string[]): string => execTextSync("git", args, { cwd: work }).trim();
const atOrigin = (...args: string[]): string => execTextSync("git", ["-C", origin, ...args]).trim();
const unmoved = (name: string): void => {
  expect(atOrigin("rev-parse", name)).toBe(String(old[name]));
};

function commit(file: string, message: string): void {
  writeFileSync(join(work, file), `${message}\n`);
  git("add", "-A");
  git("commit", "-qm", message);
}

const pull = (number: number, head: string, base: string) => ({
  number,
  headRefName: head,
  baseRefName: base,
  headRefOid: old[head],
  isDraft: false,
  labels: [],
});

function run(
  args: readonly string[],
  state: string,
  above: readonly ReturnType<typeof pull>[],
  extra: Record<string, string> = {},
) {
  return spawnTextSync("bun", [script, ...args], {
    cwd: work,
    env: {
      ...Bun.env,
      PATH: `${bin}:${join(capturedExecPath, "..")}:${Bun.env.PATH ?? ""}`,
      ANA_GH_LOG: ghLog,
      ANA_FAKE_CUT: JSON.stringify({ state, headRefName: "cut", headRefOid: old.cut }),
      ANA_FAKE_OPEN: JSON.stringify(above),
      ...extra,
    },
  });
}

/** Merges `cut` on the origin as GitHub's merge does, with a merge commit holding its tree. */
function mergeCut(): void {
  git("checkout", "-q", "main");
  git("merge", "-q", "--no-ff", "-m", "merge the cut", "cut");
  git("push", "-q", "origin", "main");
}

const chain = () => [pull(2, "one", "cut"), pull(3, "two", "one")];

/** A new branch from `from`, pushed and listed in `old`, which forks the chain or stands aside. */
function pushBranch(name: string, from: string): void {
  git("checkout", "-q", "-b", name, from);
  commit(name, name);
  git("push", "-q", "origin", name);
  old[name] = git("rev-parse", name);
  git("checkout", "-q", "main");
}

/** The digest of a commit's whole object but its parent lines: tree, author, committer and message,
 *  byte for byte, which text read through UTF-8 could not tell apart. */
const barParents = (repository: string, sha: string): string =>
  execTextSync("sh", [
    "-c",
    `git -C '${repository}' cat-file commit ${sha} | LC_ALL=C sed '/^parent /d' | git hash-object --stdin`,
  ]).trim();

/** What `contentKey` (`tools/runtime/gate.ts`) keys a static pass by, the fullest of its two keys. */
const passKey = (repository: string, sha: string): string =>
  execTextSync("git", ["-C", repository, "rev-parse", `${sha}^^{tree}`, `${sha}^{tree}`]).trim();

const logged = (start: string): string[] =>
  readFileSync(ghLog, "utf8")
    .split("\n")
    .filter((line) => line.startsWith(start));
const baseEdits = (): string[] => logged("pr edit");
const stackCalls = (): string[] => logged("stack ");

beforeEach(() => {
  round += 1;
  work = join(fixture, `work-${String(round)}`);
  origin = join(fixture, `origin-${String(round)}.git`);
  mkdirSync(work);
  execTextSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  git("init", "-q", "-b", "main");
  git("config", "user.email", "fixture@localhost");
  git("config", "user.name", "fixture");
  git("remote", "add", "origin", origin);
  commit("base", "base");
  git("checkout", "-q", "-b", "cut");
  commit("cut", "the cut");
  git("checkout", "-q", "-b", "one");
  commit("one", "one");
  git("checkout", "-q", "-b", "two");
  commit("two", "two, with a body\n\nand its second paragraph");
  git("checkout", "-q", "main");
  git("push", "-q", "origin", "main", "cut", "one", "two");
  old = Object.fromEntries(["cut", "one", "two"].map((name) => [name, git("rev-parse", name)]));
  writeFileSync(ghLog, "");
});

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe("splitting a stack above a merged pull request", () => {
  it("moves every branch above the merge onto the trunk with each tree, author and message as it was", () => {
    mergeCut();
    const result = run(["1", "--yes"], "MERGED", chain());
    expect(result.status).toBe(0);
    for (const name of ["one", "two"]) {
      const now = atOrigin("rev-parse", name);
      expect(now).not.toBe(old[name]);
      expect(barParents(origin, now)).toBe(barParents(work, String(old[name])));
    }
    expect(atOrigin("rev-parse", "one^")).toBe(atOrigin("rev-parse", "main"));
    expect(atOrigin("rev-parse", "two^")).toBe(atOrigin("rev-parse", "one"));
    expect(baseEdits()).toEqual(["pr edit 2 --base main"]);
  });

  it("keeps the passes' whole key: a copy's parent holds the tree the old parent held", () => {
    mergeCut();
    expect(run(["1", "--yes"], "MERGED", chain()).status).toBe(0);
    for (const name of ["one", "two"]) {
      expect(atOrigin("rev-parse", name)).not.toBe(old[name]);
      expect(passKey(origin, name)).toBe(passKey(work, String(old[name])));
    }
  });

  it("keeps the bytes of a message that is not UTF-8", () => {
    git("checkout", "-q", "two");
    writeFileSync(join(work, "latin"), "latin\n");
    writeFileSync(join(fixture, "latin.msg"), Buffer.from("café\n", "latin1"));
    git("add", "-A");
    git("commit", "-q", "--cleanup=verbatim", "-F", join(fixture, "latin.msg"));
    git("push", "-q", "origin", "two");
    old.two = git("rev-parse", "two");
    mergeCut();
    expect(run(["1", "--yes"], "MERGED", chain()).status).toBe(0);
    expect(atOrigin("rev-parse", "two")).not.toBe(old.two);
    expect(barParents(origin, "two")).toBe(barParents(work, old.two));
  });

  it("copies both arms of a fork once, each onto the copy of the commit it stood on", () => {
    pushBranch("arm", "one");
    mergeCut();
    const result = run(["1", "--yes"], "MERGED", [...chain(), pull(4, "arm", "one")]);
    expect(result.status).toBe(0);
    expect(atOrigin("rev-parse", "one^")).toBe(atOrigin("rev-parse", "main"));
    expect(result.stdout).toContain("3 commits copied");
    expect(atOrigin("rev-parse", "two^")).toBe(atOrigin("rev-parse", "one"));
    expect(atOrigin("rev-parse", "arm^")).toBe(atOrigin("rev-parse", "one"));
  });

  it("finds the chain where land already moved its bottom to the trunk, and edits no base again", () => {
    mergeCut();
    const result = run(["1", "--yes"], "MERGED", [pull(2, "one", "main"), pull(3, "two", "one")]);
    expect(result.status).toBe(0);
    expect(atOrigin("rev-parse", "one^")).toBe(atOrigin("rev-parse", "main"));
    expect(baseEdits()).toEqual([]);
  });

  it("leaves alone a lone pull request on the trunk that does not hold the merged head", () => {
    pushBranch("beside", "main");
    mergeCut();
    expect(run(["1", "--yes"], "MERGED", [...chain(), pull(4, "beside", "main")]).status).toBe(0);
    unmoved("beside");
  });

  it("leaves alone a pull request based on the merged branch that does not hold its head", () => {
    pushBranch("behind", "main");
    mergeCut();
    expect(run(["1", "--yes"], "MERGED", [...chain(), pull(4, "behind", "cut")]).status).toBe(0);
    unmoved("behind");
    expect(baseEdits()).toEqual(["pr edit 2 --base main"]);
  });

  it("reads a split before its merge and moves nothing", () => {
    const result = run(["1"], "OPEN", chain());
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("2 commits copied");
    expect(result.stdout).toContain("Nothing moved");
    unmoved("one");
    unmoved("two");
  });

  it("lists neither the pull request split nor any twice where GitHub still lists it open", () => {
    const result = run(["1"], "OPEN", [pull(1, "cut", "main"), ...chain()]);
    expect(result.status).toBe(0);
    expect(result.stdout.match(/^#\d+ \S+(?= \S+ -> )/gmu)).toEqual(["#2 one", "#3 two"]);
  });

  it("moves nothing without --yes after the merge either", () => {
    mergeCut();
    expect(run(["1"], "MERGED", chain()).status).toBe(0);
    unmoved("one");
  });

  it("refuses --yes on a pull request closed without a merge", () => {
    const result = run(["1", "--yes"], "CLOSED", chain());
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("#1 is CLOSED");
    unmoved("one");
  });

  it("divides an open pull request's native stack in two and moves no branch or base", () => {
    const result = run(["1", "--yes"], "OPEN", chain(), { ANA_FAKE_STACK: "9 5,1,2,3" });
    expect(result.status).toBe(0);
    expect(stackCalls()).toEqual([
      "stack unstack 9",
      "stack link --base main 5 1",
      "stack link --base cut 2 3",
    ]);
    expect(baseEdits()).toEqual([]);
    unmoved("one");
    unmoved("two");
  });

  it("links neither part of one pull request, which no stack needs", () => {
    const result = run(["1", "--yes"], "OPEN", chain(), { ANA_FAKE_STACK: "9 1,2" });
    expect(result.status).toBe(0);
    expect(stackCalls()).toEqual(["stack unstack 9"]);
  });

  it("dissolves no stack where nothing stands above the pull request, or where it is in none", () => {
    for (const stack of ["9 2,3,1", "9 2,3", ""]) {
      const result = run(["1", "--yes"], "OPEN", chain(), { ANA_FAKE_STACK: stack });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("no native stack holds pull requests above #1");
    }
    expect(stackCalls()).toEqual([]);
  });

  it("links the stack above on the trunk after the merge, once its bases have moved", () => {
    mergeCut();
    const result = run(["1", "--yes"], "MERGED", chain(), { ANA_FAKE_STACK: "9 2,3" });
    expect(result.status).toBe(0);
    expect(baseEdits()).toEqual(["pr edit 2 --base main"]);
    expect(stackCalls()).toEqual(["stack unstack 9", "stack link --base main 2 3"]);
    expect(atOrigin("merge-base", "--is-ancestor", "main", "two")).toBe("");
  });

  it("leaves the native stack as it is without --yes", () => {
    mergeCut();
    expect(run(["1"], "MERGED", chain(), { ANA_FAKE_STACK: "9 2,3" }).status).toBe(0);
    expect(run(["1"], "OPEN", chain(), { ANA_FAKE_STACK: "9 1,2,3" }).status).toBe(0);
    expect(stackCalls()).toEqual([]);
  });

  it("pushes past a pre-push hook that would refuse, since a copy changes no tree", () => {
    mergeCut();
    const hook = join(work, ".git", "hooks", "pre-push");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);
    const result = run(["1", "--yes"], "MERGED", chain());
    expect(result.status).toBe(0);
    expect(atOrigin("rev-parse", "two")).not.toBe(String(old.two));
  });

  it("refuses a trunk that moved past the merge, since every copy would then lose its pass", () => {
    mergeCut();
    commit("later", "a later landing");
    git("push", "-q", "origin", "main");
    const result = run(["1", "--yes"], "MERGED", chain());
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("another tree");
    unmoved("one");
  });

  it("moves no branch at all where the lease on one of them fails", () => {
    mergeCut();
    const listed = chain();
    git("checkout", "-q", "two");
    commit("pushed", "pushed by another session");
    git("push", "-q", "origin", "two");
    const moved = git("rev-parse", "two");
    const result = run(["1", "--yes"], "MERGED", listed);
    expect(result.status).toBe(1);
    // Git's own words reach the operator: the lease refused `two`, and atomicity alone held `one`.
    expect(result.stderr).toContain("stale info");
    expect(result.stderr).toContain("atomic push failed");
    expect(result.stdout).not.toContain("Pushed");
    unmoved("one");
    expect(atOrigin("rev-parse", "two")).toBe(moved);
  });

  it("says the push went through where a base edit then fails, and a second run finishes it", () => {
    mergeCut();
    const first = run(["1", "--yes"], "MERGED", chain(), { ANA_FAKE_EDIT_REFUSED: "1" });
    expect(first.status).toBe(1);
    expect(first.stdout).toContain("Pushed 2 branches");
    expect(first.stderr).toContain("edit refused");
    const pushed = atOrigin("rev-parse", "two");
    old = { ...old, one: atOrigin("rev-parse", "one"), two: pushed };
    const second = run(["1", "--yes"], "MERGED", chain());
    expect(second.status).toBe(0);
    expect(atOrigin("rev-parse", "two")).toBe(pushed);
    expect(baseEdits()).toEqual(["pr edit 2 --base main", "pr edit 2 --base main"]);
  });

  it("refuses a chain holding a merge, whose other parent no copy could map", () => {
    git("checkout", "-q", "-b", "aside", "main");
    commit("aside", "aside");
    git("checkout", "-q", "two");
    git("merge", "-q", "--no-ff", "-m", "merge aside", "aside");
    git("push", "-q", "origin", "two");
    old.two = git("rev-parse", "two");
    mergeCut();
    const result = run(["1", "--yes"], "MERGED", chain());
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is a merge");
    unmoved("one");
  });

  it("says so where nothing stands on the pull request", () => {
    mergeCut();
    const result = run(["1"], "MERGED", []);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no open pull request");
  });
});

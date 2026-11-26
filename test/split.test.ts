import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { runCaptured } from "../src/meta/subprocess.ts";

import { afterAll, describe, expect, it } from "bun:test";

import { execTextSync } from "./helpers/bun-spawn-sync.ts";

const script = join(import.meta.dir, "..", "tools", "runtime", "split.ts");
const fixture = mkdtempSync(join(tmpdir(), "ana-split-"));
const bin = join(fixture, "bin");
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
"stack link"*) if [ -n "$ANA_FAKE_LINK_REFUSED" ]; then echo "link refused" >&2; exit 1; fi ;;
"api"*) grep -q '^stack unstack' "$ANA_GH_LOG" || printf '%s\\n' "$ANA_FAKE_STACK" ;;
esac
`,
);
chmodSync(join(bin, "gh"), 0o755);

const templateWork = join(fixture, "template-work");
const templateOrigin = join(fixture, "template-origin.git");
mkdirSync(templateWork);
execTextSync("git", ["init", "-q", "--bare", "-b", "main", templateOrigin]);
const initGit = (...args: string[]): string => execTextSync("git", args, { cwd: templateWork }).trim();
const initCommit = (file: string, message: string): void => {
  writeFileSync(join(templateWork, file), `${message}\n`);
  initGit("add", "-A");
  initGit("commit", "-qm", message);
};
initGit("init", "-q", "-b", "main");
initGit("config", "user.email", "fixture@localhost");
initGit("config", "user.name", "fixture");
initGit("remote", "add", "origin", templateOrigin);
initCommit("base", "base");
initGit("checkout", "-q", "-b", "cut");
initCommit("cut", "the cut");
initGit("checkout", "-q", "-b", "one");
initCommit("one", "one");
initGit("checkout", "-q", "-b", "two");
initCommit("two", "two, with a body\n\nand its second paragraph");
initGit("checkout", "-q", "main");
initGit("push", "-q", "origin", "main", "cut", "one", "two");
const templateOld = Object.fromEntries(
  ["cut", "one", "two"].map((name) => [name, initGit("rev-parse", name)]),
);

/** The digest of a commit's whole object but its parent lines, byte for byte, which text read
 *  through UTF-8 could not tell apart. */
const barParents = (repository: string, sha: string): string =>
  execTextSync("sh", [
    "-c",
    `git -C '${repository}' cat-file commit ${sha} | LC_ALL=C sed '/^parent /d' | git hash-object --stdin`,
  ]).trim();

/** What `contentKey` (`tools/runtime/gate.ts`) keys a static pass by, the fullest of its two keys. */
const passKey = (repository: string, sha: string): string =>
  execTextSync("git", ["-C", repository, "rev-parse", `${sha}^^{tree}`, `${sha}^{tree}`]).trim();

let round = 0;

function sandbox() {
  round += 1;
  const work = join(fixture, `work-${String(round)}`);
  const origin = join(fixture, `origin-${String(round)}.git`);
  const ghLog = join(fixture, `gh-${String(round)}.log`);
  cpSync(templateWork, work, { recursive: true });
  cpSync(templateOrigin, origin, { recursive: true });
  const git = (...args: string[]): string => execTextSync("git", args, { cwd: work }).trim();
  git("remote", "set-url", "origin", origin);
  writeFileSync(ghLog, "");
  const old: Record<string, string> = { ...templateOld };
  const atOrigin = (...args: string[]): string => execTextSync("git", ["-C", origin, ...args]).trim();
  const unmoved = (name: string): void => {
    expect(atOrigin("rev-parse", name)).toBe(String(old[name]));
  };
  const commit = (file: string, message: string): void => {
    writeFileSync(join(work, file), `${message}\n`);
    git("add", "-A");
    git("commit", "-qm", message);
  };
  const pull = (number: number, head: string, base: string) => ({
    number,
    headRefName: head,
    baseRefName: base,
    headRefOid: old[head],
    isDraft: false,
    labels: [],
  });
  const run = async (
    args: readonly string[],
    state: string,
    above: readonly ReturnType<typeof pull>[],
    extra: Record<string, string> = {},
  ) => {
    const result = await runCaptured([capturedExecPath, script, ...args], {
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
    return { ...result, status: result.exitCode };
  };
  /** Merges `cut` on the origin as GitHub's merge does, with a merge commit holding its tree. */
  const mergeCut = (): void => {
    git("checkout", "-q", "main");
    git("merge", "-q", "--no-ff", "-m", "merge the cut", "cut");
    git("push", "-q", "origin", "main");
  };
  const chain = () => [pull(2, "one", "cut"), pull(3, "two", "one")];
  const whole = () => [pull(5, "five", "main"), pull(1, "cut", "five"), ...chain()];
  const pushBranch = (name: string, from: string): void => {
    git("checkout", "-q", "-b", name, from);
    commit(name, name);
    git("push", "-q", "origin", name);
    old[name] = git("rev-parse", name);
    git("checkout", "-q", "main");
  };
  const logged = (start: string): string[] =>
    readFileSync(ghLog, "utf8")
      .split("\n")
      .filter((line) => line.startsWith(start));
  const baseEdits = (): string[] => logged("pr edit");
  const stackCalls = (): string[] => logged("stack ");
  return {
    work,
    origin,
    old,
    git,
    atOrigin,
    unmoved,
    commit,
    pull,
    run,
    mergeCut,
    chain,
    whole,
    pushBranch,
    baseEdits,
    stackCalls,
  };
}

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true });
});

describe.concurrent("splitting a stack above a merged pull request", () => {
  it("moves every branch above the merge onto the trunk with each tree, author and message as it was", async () => {
    const { work, origin, old, atOrigin, run, mergeCut, chain, baseEdits } = sandbox();
    mergeCut();
    const result = await run(["1", "--yes"], "MERGED", chain());
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

  it("keeps the passes' whole key: a copy's parent holds the tree the old parent held", async () => {
    const { work, origin, old, atOrigin, run, mergeCut, chain } = sandbox();
    mergeCut();
    expect((await run(["1", "--yes"], "MERGED", chain())).status).toBe(0);
    for (const name of ["one", "two"]) {
      expect(atOrigin("rev-parse", name)).not.toBe(old[name]);
      expect(passKey(origin, name)).toBe(passKey(work, String(old[name])));
    }
  });

  it("copies both arms of a fork once, each onto the copy of the commit it stood on", async () => {
    const { atOrigin, pull, run, mergeCut, chain, pushBranch } = sandbox();
    pushBranch("arm", "one");
    mergeCut();
    const result = await run(["1", "--yes"], "MERGED", [...chain(), pull(4, "arm", "one")]);
    expect(result.status).toBe(0);
    expect(atOrigin("rev-parse", "one^")).toBe(atOrigin("rev-parse", "main"));
    expect(result.stdout).toContain("3 commits copied");
    expect(atOrigin("rev-parse", "two^")).toBe(atOrigin("rev-parse", "one"));
    expect(atOrigin("rev-parse", "arm^")).toBe(atOrigin("rev-parse", "one"));
  });

  it("finds the chain where land already moved its bottom to the trunk, and edits no base again", async () => {
    const { atOrigin, pull, run, mergeCut, baseEdits } = sandbox();
    mergeCut();
    const result = await run(["1", "--yes"], "MERGED", [pull(2, "one", "main"), pull(3, "two", "one")]);
    expect(result.status).toBe(0);
    expect(atOrigin("rev-parse", "one^")).toBe(atOrigin("rev-parse", "main"));
    expect(baseEdits()).toEqual([]);
  });

  it("leaves alone a lone pull request on the trunk that does not hold the merged head", async () => {
    const { unmoved, pull, run, mergeCut, chain, pushBranch } = sandbox();
    pushBranch("beside", "main");
    mergeCut();
    expect((await run(["1", "--yes"], "MERGED", [...chain(), pull(4, "beside", "main")])).status).toBe(0);
    unmoved("beside");
  });

  it("leaves alone a pull request based on the merged branch that does not hold its head", async () => {
    const { unmoved, pull, run, mergeCut, chain, pushBranch, baseEdits } = sandbox();
    pushBranch("behind", "main");
    mergeCut();
    expect((await run(["1", "--yes"], "MERGED", [...chain(), pull(4, "behind", "cut")])).status).toBe(0);
    unmoved("behind");
    expect(baseEdits()).toEqual(["pr edit 2 --base main"]);
  });

  it("reads a split before its merge and moves nothing", async () => {
    const { unmoved, run, chain } = sandbox();
    const result = await run(["1"], "OPEN", chain());
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("2 commits copied");
    expect(result.stdout).toContain("Nothing moved");
    unmoved("one");
    unmoved("two");
  });

  it("moves nothing without --yes after the merge either", async () => {
    const { unmoved, run, mergeCut, chain } = sandbox();
    mergeCut();
    expect((await run(["1"], "MERGED", chain())).status).toBe(0);
    unmoved("one");
  });

  it("refuses --yes on a pull request closed without a merge", async () => {
    const { unmoved, run, chain } = sandbox();
    const result = await run(["1", "--yes"], "CLOSED", chain());
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("#1 is CLOSED");
    unmoved("one");
  });

  it("divides an open pull request's stack in two and moves no branch or base", async () => {
    const { unmoved, run, whole, baseEdits, stackCalls } = sandbox();
    const result = await run(["1", "--yes"], "OPEN", whole(), { ANA_FAKE_STACK: "9 5,1,2,3" });
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

  it("finishes a division cut short after its unstack from the chain of bases", async () => {
    const { run, whole, stackCalls } = sandbox();
    const first = await run(["1", "--yes"], "OPEN", whole(), {
      ANA_FAKE_STACK: "9 5,1,2,3",
      ANA_FAKE_LINK_REFUSED: "1",
    });
    expect(first.status).toBe(1);
    const second = await run(["1", "--yes"], "OPEN", whole(), { ANA_FAKE_STACK: "9 5,1,2,3" });
    expect(second.status).toBe(0);
    expect(stackCalls()).toEqual([
      "stack unstack 9",
      "stack link --base main 5 1",
      "stack link --base main 5 1",
      "stack link --base cut 2 3",
    ]);
  });

  it("dissolves no stack where nothing stands above the pull request, or where it is not open", async () => {
    const { pull, run, chain, stackCalls } = sandbox();
    const aside = pull(4, "beside", "main");
    for (const open of [[pull(1, "cut", "main")], [pull(1, "cut", "main"), aside], chain()]) {
      const result = await run(["1", "--yes"], "OPEN", open, { ANA_FAKE_STACK: "9 1,2,3" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("no open pull request is based on #1");
    }
    expect(stackCalls()).toEqual([]);
  });

  it("links the stack above on the trunk after the merge, once its bases have moved", async () => {
    const { atOrigin, run, mergeCut, chain, baseEdits, stackCalls } = sandbox();
    mergeCut();
    const result = await run(["1", "--yes"], "MERGED", chain(), { ANA_FAKE_STACK: "9 2,3" });
    expect(result.status).toBe(0);
    expect(baseEdits()).toEqual(["pr edit 2 --base main"]);
    expect(stackCalls()).toEqual(["stack unstack 9", "stack link --base main 2 3"]);
    expect(atOrigin("merge-base", "--is-ancestor", "main", "two")).toBe("");
  });

  it("links the stack above on a second run where the first stopped after its unstack", async () => {
    const { old, atOrigin, pull, run, mergeCut, chain, stackCalls } = sandbox();
    mergeCut();
    const extra = { ANA_FAKE_STACK: "9 2,3" };
    expect(
      (await run(["1", "--yes"], "MERGED", chain(), { ...extra, ANA_FAKE_LINK_REFUSED: "1" })).status,
    ).toBe(1);
    old.one = atOrigin("rev-parse", "one");
    old.two = atOrigin("rev-parse", "two");
    expect(
      (await run(["1", "--yes"], "MERGED", [pull(2, "one", "main"), pull(3, "two", "one")], extra)).status,
    ).toBe(0);
    expect(stackCalls()).toEqual([
      "stack unstack 9",
      "stack link --base main 2 3",
      "stack link --base main 2 3",
    ]);
  });

  it("leaves the native stack as it is without --yes", async () => {
    const { run, mergeCut, chain, stackCalls } = sandbox();
    mergeCut();
    expect((await run(["1"], "MERGED", chain(), { ANA_FAKE_STACK: "9 2,3" })).status).toBe(0);
    expect((await run(["1"], "OPEN", chain(), { ANA_FAKE_STACK: "9 1,2,3" })).status).toBe(0);
    expect(stackCalls()).toEqual([]);
  });

  it("pushes past a pre-push hook that would refuse, since a copy changes no tree", async () => {
    const { work, old, atOrigin, run, mergeCut, chain } = sandbox();
    mergeCut();
    const hook = join(work, ".git", "hooks", "pre-push");
    writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    chmodSync(hook, 0o755);
    const result = await run(["1", "--yes"], "MERGED", chain());
    expect(result.status).toBe(0);
    expect(atOrigin("rev-parse", "two")).not.toBe(String(old.two));
  });

  it("refuses a trunk that moved past the merge, since every copy would then lose its pass", async () => {
    const { git, unmoved, commit, run, mergeCut, chain } = sandbox();
    mergeCut();
    commit("later", "a later landing");
    git("push", "-q", "origin", "main");
    const result = await run(["1", "--yes"], "MERGED", chain());
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("another tree");
    unmoved("one");
  });

  it("moves no branch at all where the lease on one of them fails", async () => {
    const { git, atOrigin, unmoved, commit, run, mergeCut, chain } = sandbox();
    mergeCut();
    const listed = chain();
    git("checkout", "-q", "two");
    commit("pushed", "pushed by another session");
    git("push", "-q", "origin", "two");
    const moved = git("rev-parse", "two");
    const result = await run(["1", "--yes"], "MERGED", listed);
    expect(result.status).toBe(1);
    // Git's own words reach the operator: the lease refused `two`, and atomicity alone held `one`.
    expect(result.stderr).toContain("stale info");
    expect(result.stderr).toContain("atomic push failed");
    expect(result.stdout).not.toContain("Pushed");
    unmoved("one");
    expect(atOrigin("rev-parse", "two")).toBe(moved);
  });

  it("says the push went through where a base edit then fails, and a second run finishes it", async () => {
    const { old, atOrigin, run, mergeCut, chain, baseEdits } = sandbox();
    mergeCut();
    const first = await run(["1", "--yes"], "MERGED", chain(), { ANA_FAKE_EDIT_REFUSED: "1" });
    expect(first.status).toBe(1);
    expect(first.stdout).toContain("Pushed 2 branches");
    expect(first.stderr).toContain("edit refused");
    const pushed = atOrigin("rev-parse", "two");
    old.one = atOrigin("rev-parse", "one");
    old.two = pushed;
    const second = await run(["1", "--yes"], "MERGED", chain());
    expect(second.status).toBe(0);
    expect(atOrigin("rev-parse", "two")).toBe(pushed);
    expect(baseEdits()).toEqual(["pr edit 2 --base main", "pr edit 2 --base main"]);
  });

  it("refuses a chain holding a merge, whose other parent no copy could map", async () => {
    const { git, old, unmoved, commit, run, mergeCut, chain } = sandbox();
    git("checkout", "-q", "-b", "aside", "main");
    commit("aside", "aside");
    git("checkout", "-q", "two");
    git("merge", "-q", "--no-ff", "-m", "merge aside", "aside");
    git("push", "-q", "origin", "two");
    old.two = git("rev-parse", "two");
    mergeCut();
    const result = await run(["1", "--yes"], "MERGED", chain());
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("is a merge");
    unmoved("one");
  });
});

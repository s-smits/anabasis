// Retiring what the worktrees no longer use: an idle campaign leaves its worktree for the archive,
// whole, and readers find it there; a worktree nothing uses goes once it holds no run log, one with
// an uncommitted change only after two weeks, and a branch no worktree holds once nothing used it
// for a week. A commit nothing else keeps reachable keeps a tag. An idle seed is deleted instead,
// the archive's too.
import { afterAll, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runTextSyncOrThrow } from "../src/meta/subprocess.ts";

import { archiveIdle, retireUnused, type Sweep } from "../tools/runs/retire.ts";
import { arrayWith } from "./helpers/matchers.ts";

const DAY = 86_400_000;
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-runs-retire-test-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const git = (repo: string, ...args: string[]) => runTextSyncOrThrow(["git", "-C", repo, ...args]).trim();
const commit = (repo: string, message: string) =>
  git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", message);
const main = join(root, "main");
const tree = join(root, "wt");
const dirty = join(root, "dirty");
const archive = join(main, "data", "runs", "here");
const branches = () => git(main, "for-each-ref", "--format=%(refname:lstrip=2)", "refs/heads").split("\n");

/** A campaign `name` in `at`, its log last written `daysAgo` days before now. */
function campaign(at: string, name: string, daysAgo: number, folder = join(at, ".ana", "d2", name)): void {
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "log.jsonl"), "");
  writeFileSync(join(folder, "launch-run-1.json"), "{}");
  const then = new Date(Date.now() - daysAgo * DAY);
  utimesSync(join(folder, "log.jsonl"), then, then);
}

mkdirSync(main);
git(main, "init", "-q", "-b", "trunk");
commit(main, "c");
git(main, "worktree", "add", "-q", "--detach", tree, "HEAD");
git(main, "worktree", "add", "-q", "--detach", dirty, "HEAD");
// A commit of the dirty tree's own, which no branch holds.
commit(dirty, "d");
writeFileSync(join(dirty, "draft.ts"), "");
campaign(main, "young", 2);
campaign(tree, "old", 2);
campaign(tree, "young", 0);

const sweep = (days: number, yes: boolean): Sweep => ({ main, days: 1, now: Date.now() + days * DAY, yes });

describe("retiring", () => {
  it("archives idle campaigns and retires unused trees only after their grace periods", () => {
    expect(archiveIdle(sweep(0, false)).size).toBe(2);
    retireUnused(sweep(3, false), new Set());
    expect([existsSync(join(tree, ".ana", "d2", "old")), existsSync(tree), existsSync(archive)]).toEqual([
      true,
      true,
      false,
    ]);

    archiveIdle(sweep(0, true));
    expect(existsSync(join(archive, "old", "launch-run-1.json"))).toBe(true);
    expect(existsSync(join(tree, ".ana", "d2", "old"))).toBe(false);
    expect(existsSync(join(tree, ".ana", "d2", "young", "log.jsonl"))).toBe(true);
    // A worktree that holds a run log stays, however long since its commit.
    retireUnused(sweep(8, true), new Set());
    expect(existsSync(tree)).toBe(true);

    retireUnused(sweep(3, true), archiveIdle(sweep(3, true)));
    expect(existsSync(join(archive, "young.wt", "log.jsonl"))).toBe(true);
    expect(existsSync(tree)).toBe(true);

    // A host's controller is a worktree too, and only its own prune removes it.
    const controller = join(main, ".git", "ana-code", "c".repeat(40));
    git(main, "worktree", "add", "-q", "--detach", controller, "HEAD");
    retireUnused(sweep(8, true), new Set());
    expect(existsSync(tree)).toBe(false);
    expect(existsSync(dirty)).toBe(true);
    expect(existsSync(controller)).toBe(true);
    expect(git(main, "worktree", "list")).not.toContain(tree);

    const head = git(dirty, "rev-parse", "HEAD");
    retireUnused(sweep(15, true), new Set());
    expect(existsSync(dirty)).toBe(false);
    expect(git(main, "rev-parse", `retired/${head.slice(0, 9)}`)).toBe(head);
  });

  it("keeps a worktree a process works in, however long idle", async () => {
    const busy = join(root, "busy");
    git(main, "worktree", "add", "-q", "--detach", busy, "HEAD");
    const sleeper = Bun.spawn(["sleep", "30"], { cwd: busy });
    try {
      retireUnused(sweep(30, true), new Set());
      expect(existsSync(busy)).toBe(true);
    } finally {
      sleeper.kill();
      await sleeper.exited;
    }
    retireUnused(sweep(30, true), new Set());
    expect(existsSync(busy)).toBe(false);
  });

  it("deletes a branch no worktree holds once nothing used it for a week, and tags only a commit nothing else holds", () => {
    const held = join(root, "held");
    git(main, "worktree", "add", "-q", "-b", "held", held, "HEAD");
    git(main, "branch", "merged", "HEAD");
    git(main, "branch", "fresh", "HEAD");
    git(main, "switch", "-q", "-c", "own");
    commit(main, "only on own");
    const own = git(main, "rev-parse", "HEAD");
    git(main, "switch", "-q", "trunk");
    // Used a day before the sweep, so younger than a week: the branch, and the tree that holds `held`.
    const recent = new Date(Date.now() + 7 * DAY);
    utimesSync(join(main, ".git", "logs", "refs", "heads", "fresh"), recent, recent);
    writeFileSync(join(held, "note"), "");
    utimesSync(join(held, "note"), recent, recent);

    retireUnused(sweep(8, false), new Set());
    expect(branches()).toEqual(arrayWith(["fresh", "held", "merged", "own", "trunk"]));

    retireUnused(sweep(8, true), new Set());
    expect(branches().toSorted()).toEqual(["fresh", "held", "trunk"]);
    expect(git(main, "rev-parse", `retired/${own.slice(0, 9)}`)).toBe(own);
    expect(git(main, "tag", "--list", "retired/*").split("\n")).toHaveLength(2);
  });

  it("files two trees' live solve logs of one file name apart, and overwrites neither", () => {
    const other = join(root, "wt2");
    git(main, "worktree", "add", "-q", "--detach", other, "HEAD");
    for (const at of [main, other]) {
      mkdirSync(join(at, ".ana", "live"), { recursive: true });
      writeFileSync(join(at, ".ana", "live", "s.jsonl"), at);
      const then = new Date(Date.now() - 2 * DAY);
      utimesSync(join(at, ".ana", "live", "s.jsonl"), then, then);
    }
    archiveIdle(sweep(0, true));
    expect(readFileSync(join(archive, ".live", "s.jsonl"), "utf8")).toBe(main);
    expect(readFileSync(join(archive, ".live", "s.jsonl.wt2"), "utf8")).toBe(other);
  });

  it("deletes an idle seed, in a worktree or in the archive, and keeps a young one", () => {
    campaign(main, "sim-old", 2);
    campaign(main, "sim-young", 0);
    campaign(main, "sim-filed", 2, join(archive, "sim-filed"));
    for (const folder of ["sim-old", "sim-young"].map((name) => join(main, ".ana", "d2", name))) {
      writeFileSync(join(folder, "seed.json"), "{}");
    }
    writeFileSync(join(archive, "sim-filed", "seed.json"), "{}");
    const gone = archiveIdle(sweep(0, true));
    expect(gone).toContain(join(main, ".ana", "d2", "sim-old", "log.jsonl"));
    expect(
      [
        join(main, ".ana", "d2", "sim-old"),
        join(archive, "sim-old"),
        join(archive, "sim-filed"),
        join(main, ".ana", "d2", "sim-young"),
        join(archive, "old"),
      ].map((path) => existsSync(path)),
    ).toEqual([false, false, false, true, true]);
  });
});

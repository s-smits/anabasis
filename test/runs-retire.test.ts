// Retiring what the worktrees no longer use: an idle campaign leaves its worktree for the archive,
// whole, and readers find it there; a worktree nothing uses goes once it holds no run log, one with
// an uncommitted change only after a week, and a commit no branch holds keeps a tag. An idle seed
// is deleted instead, the archive's too.
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
import { archived, readable, readNamed } from "../tools/runs/registry.ts";
import { archiveIdle, retireTrees, type Sweep } from "../tools/runs/retire.ts";

const DAY = 86_400_000;
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-runs-retire-test-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const git = (repo: string, ...args: string[]) => runTextSyncOrThrow(["git", "-C", repo, ...args]).trim();
const main = join(root, "main");
const tree = join(root, "wt");
const dirty = join(root, "dirty");
const archive = join(main, "data", "runs", "here");

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
git(main, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "c");
git(main, "worktree", "add", "-q", "--detach", tree, "HEAD");
git(main, "worktree", "add", "-q", "--detach", dirty, "HEAD");
// A commit of the dirty tree's own, which no branch holds.
git(dirty, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "d");
writeFileSync(join(dirty, "draft.ts"), "");
campaign(main, "young", 2);
campaign(tree, "old", 2);
campaign(tree, "young", 0);

const sweep = (days: number, yes: boolean): Sweep => ({ main, days: 1, now: Date.now() + days * DAY, yes });

describe("retiring", () => {
  it("says what it would move and moves nothing without --yes", () => {
    expect(archiveIdle(sweep(0, false)).size).toBe(2);
    retireTrees(sweep(3, false), new Set());
    expect([existsSync(join(tree, ".ana", "d2", "old")), existsSync(tree), existsSync(archive)]).toEqual([
      true,
      true,
      false,
    ]);
  });

  it("moves an idle campaign into the archive whole, and leaves one that wrote within the day", () => {
    archiveIdle(sweep(0, true));
    expect(existsSync(join(archive, "old", "launch-run-1.json"))).toBe(true);
    expect(existsSync(join(tree, ".ana", "d2", "old"))).toBe(false);
    expect(existsSync(join(tree, ".ana", "d2", "young", "log.jsonl"))).toBe(true);
    // A worktree that holds a run log stays, however long since its commit.
    retireTrees(sweep(3, true), new Set());
    expect(existsSync(tree)).toBe(true);
  });

  it("reads an archived campaign where no worktree holds the name, and the worktree's where one does", () => {
    expect(archived(main).map(({ name, archived: from }) => `${name}@${String(from)}`)).toEqual([
      "old@here",
      "young@here",
    ]);
    expect(readNamed("old", main).path).toBe(join(archive, "old", "log.jsonl"));
    expect(readNamed("young", main).path).toBe(join(tree, ".ana", "d2", "young", "log.jsonl"));
  });

  it("files a name the archive holds already under its tree's, and then deletes the idle tree", () => {
    retireTrees(sweep(3, true), archiveIdle(sweep(3, true)));
    expect(existsSync(join(archive, "young.wt", "log.jsonl"))).toBe(true);
    expect(existsSync(tree)).toBe(false);
    // The tree with a change no commit names stays for a week.
    expect(existsSync(dirty)).toBe(true);
    expect(git(main, "worktree", "list")).not.toContain(tree);
  });

  it("deletes a tree with a change no commit names after a week, and tags the commit no branch holds", () => {
    const head = git(dirty, "rev-parse", "HEAD");
    retireTrees(sweep(8, true), new Set());
    expect(existsSync(dirty)).toBe(false);
    expect(git(main, "rev-parse", `retired/${head.slice(0, 9)}`)).toBe(head);
  });

  it("reads one archived copy of each name, this machine's before a host's", () => {
    for (const [from, name] of [
      ["m1", "old"],
      ["linux", "far"],
      ["m1", "far"],
    ] as const) {
      mkdirSync(join(main, "data", "runs", from, name), { recursive: true });
      writeFileSync(join(main, "data", "runs", from, name, "log.jsonl"), "");
    }
    const copies = readable(main).map(({ name, archived: from }) => `${name}@${String(from)}`);
    expect(copies.filter((copy) => copy.startsWith("old@"))).toEqual(["old@here"]);
    expect(copies.filter((copy) => copy.startsWith("far@"))).toHaveLength(1);
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

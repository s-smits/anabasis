/**
 * `.githooks/pre-push` run as Git runs it, over real commits in a fixture repository, with Bun
 * replaced only at the gate's steps (`test/helpers/fake-bun.ts`). The hook, `tools/runtime/pre-push.ts`
 * and the gate's choice of steps and nearby tests are the real ones, so a case reads which commits
 * were gated, with which pass, and what each pass's test step ran. Nothing is pushed anywhere: the
 * hook is handed the ref lines Git would hand it.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

import { afterAll, beforeEach, describe, expect, it } from "bun:test";

import { execTextSync, spawnTextSync } from "./helpers/bun-spawn-sync.ts";
import { fakeBun, gatesRun } from "./helpers/fake-bun.ts";

const hook = join(import.meta.dir, "..", ".githooks", "pre-push");
const fixture = mkdtempSync(join(tmpdir(), "ana-pre-push-"));
const work = join(fixture, "work");
const bin = join(fixture, "bin");
const log = join(fixture, "gates.log");
const fake = (mkdirSync(bin), fakeBun(bin, log));
const absent = "0".repeat(40);

const git = (...args: string[]): string => execTextSync("git", args, { cwd: work }).trim();
function commit(file: string, text: string, message: string): string {
  writeFileSync(join(work, file), text);
  git("add", file);
  git("commit", "-qm", message);
  return git("rev-parse", "HEAD");
}
const blob = (text: string): string =>
  execTextSync("git", ["hash-object", "-w", "--stdin"], { cwd: work, stdin: text }).trim();
/** A tree or commit's tree with one more file at the top, holding `text` or its own name. */
const withFile = (from: string, name: string, text = name): string =>
  execTextSync("git", ["mktree"], {
    cwd: work,
    stdin: `${[git("ls-tree", from), `100644 blob ${blob(text)}\t${name}`].filter((row) => row !== "").join("\n")}\n`,
  }).trim();
const short = (sha: string): string => sha.slice(0, 9);

mkdirSync(join(work, "src"), { recursive: true });
mkdirSync(join(work, "test"));
git("init", "-q", "-b", "main");
git("config", "user.email", "fixture@localhost");
git("config", "user.name", "fixture");
writeFileSync(join(work, "src", "b.ts"), "export const b = 1;\n");
writeFileSync(
  join(work, "test", "owner.test.ts"),
  'import { owner } from "../src/owner.ts";\nexport { owner };\n',
);
git("add", "-A");
const base = commit("src/owner.ts", "export const owner = 1;\n", "base");
const docs = commit("README.md", "two\n", "docs");
const source = commit("src/owner.ts", "export const owner = 2;\n", "source");
const second = commit("src/b.ts", "export const b = 2;\n", "second");
// The remote holds main at `base`, as a clone's remote-tracking ref says.
git("update-ref", "refs/remotes/origin/main", base);

afterAll(() => rmSync(fixture, { recursive: true, force: true }));

function push(updates: readonly string[], env: Record<string, string> = {}) {
  return spawnTextSync("sh", [hook, "origin", "fixture-remote"], {
    cwd: work,
    stdin: `${updates.join("\n")}\n`,
    env: { ...Bun.env, ...fake, ...env },
  });
}
const update = (local: string, remote: string, branch = "topic"): string =>
  `refs/heads/${branch} ${local} refs/heads/${branch} ${remote}`;
const forgetPasses = (): void => rmSync(join(work, ".git", "ana-gate-passed"), { force: true });

/** The same patches as `source` and `second`, on a trunk that has since changed: what a rebase replaced. */
function oldCopies() {
  const oldTrunk = git("commit-tree", withFile(base, "gone.txt"), "-p", base, "-m", "old trunk");
  const oldDocs = git("commit-tree", withFile(docs, "gone.txt"), "-p", oldTrunk, "-m", "docs");
  const oldSource = git("commit-tree", withFile(source, "gone.txt"), "-p", oldDocs, "-m", "source");
  const oldSecond = git("commit-tree", withFile(second, "gone.txt"), "-p", oldSource, "-m", "second");
  return { oldSource, oldSecond };
}

/** A line with no history in common with this one: what another repository's commits look like. */
function foreignLine(): string[] {
  const first = git("commit-tree", withFile(git("mktree"), "v2-a.txt"), "-m", "v2 a");
  const middle = git("commit-tree", withFile(first, "v2-b.txt"), "-p", first, "-m", "v2 b");
  return [first, middle, git("commit-tree", withFile(middle, "v2-c.txt"), "-p", middle, "-m", "v2 c")];
}

beforeEach(() => {
  rmSync(log, { force: true });
  forgetPasses();
});

describe("pre-push", () => {
  it("checks a documentation-only update with git diff --check and runs no gate", () => {
    const result = push([update(docs, base)]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain(
      "documentation only: git diff --check passed on 1 commit, and no gate runs.",
    );
    expect(gatesRun(log)).toEqual([]);
  });

  it("refuses a documentation-only update whose diff check fails", () => {
    const unclean = git(
      "commit-tree",
      withFile(base, "README.md", "trailing \n"),
      "-p",
      base,
      "-m",
      "spaced",
    );
    const result = push([update(unclean, base)]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("README.md:1: trailing whitespace.");
    expect(result.stderr).toContain(`git diff --check fails on ${short(unclean)}. Nothing was pushed.`);
    expect(gatesRun(log)).toEqual([]);
  });

  it("gives each earlier new commit its static steps and nearby tests, and the pushed head the whole gate", () => {
    const result = push([update(second, docs)]);
    expect(result.status).toBe(0);
    expect(gatesRun(log)).toEqual([`${source} test/owner.test.ts`, `${second} suite`]);
    const steps = readFileSync(log, "utf8")
      .split("\n")
      .filter((line) => line.startsWith(source));
    expect(steps.map((line) => line.split("\t")[1])).toEqual([
      "install --frozen-lockfile",
      "run format:check",
      "run typecheck",
      "run lint -- --strict",
      "run test -- test/owner.test.ts",
    ]);
  });

  it("runs nothing again that passed on these exact bytes", () => {
    push([update(second, docs)]);
    rmSync(log, { force: true });
    const again = push([update(second, docs)]);
    expect(again.status).toBe(0);
    expect(again.stderr.match(/passed earlier on these exact bytes/gu)).toHaveLength(2);
    expect(gatesRun(log)).toEqual([]);
  });

  it("stops at the commit that fails, prints where its fix goes, and ends on the failing step", () => {
    const result = push([update(second, docs)], { ANA_FAKE_FAIL: `${source} lint` });
    expect(result.status).toBe(1);
    expect(gatesRun(log)).toEqual([`${source} -`]);
    expect(result.stderr).toContain(`git commit --fixup=${short(source)}`);
    const last = result.stderr.trimEnd().split("\n").at(-1) ?? "";
    expect(last).toStartWith(`pre-push: ${short(source)} FAILS lint ON ITS OWN. Nothing was pushed. Log: `);
    expect(readFileSync(last.slice(last.indexOf("Log: ") + 5), "utf8")).toContain(
      "gate: step lint failed (exit 1)",
    );
    // The commits beneath a fix keep their passes; this one has none to keep.
    expect(push([update(second, docs)]).stderr).not.toContain("passed earlier");
  });

  it("publishes a push that only deletes without a gate", () => {
    const result = push([`(delete) ${absent} refs/heads/topic ${second}`]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("every update is a deletion");
  });

  it("reads a new branch against what the clone's remote-tracking refs already hold", () => {
    const result = push([update(second, absent, "fresh")]);
    expect(result.status).toBe(0);
    expect(gatesRun(log)).toEqual([`${source} test/owner.test.ts`, `${second} suite`]);
  });

  it("runs no gate for a push that only replays what the remote held", () => {
    const result = push([update(second, oldCopies().oldSecond)]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("replays of commits the remote already held: 3.");
    expect(result.stderr).toContain("nothing this push adds is new work, so no gate runs.");
    expect(gatesRun(log)).toEqual([]);
  });

  // An edit to the lower pull request changes its commit's patch and replays the one above it.
  it("gives the whole gate to the pushed head holding the newest edit, and none to the replays above", () => {
    const { oldSource, oldSecond } = oldCopies();
    const edited = git("commit-tree", withFile(source, "extra.ts"), "-p", docs, "-m", "source");
    const replayed = git("commit-tree", withFile(second, "extra.ts"), "-p", edited, "-m", "second");
    const result = push([update(edited, oldSource, "parent"), update(replayed, oldSecond)]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("replays of commits the remote already held: 2.");
    expect(gatesRun(log)).toEqual([`${edited} suite`]);
  });

  // PR #141 brought v2's 393 commits in through one merge; v1's hook gated each of them.
  it("gates the first-parent line of a merge that brings in another history, and none of that history", () => {
    const [, , last = ""] = foreignLine();
    const merged = git(
      "commit-tree",
      withFile(withFile(second, "v2-c.txt"), "v2-a.txt"),
      "-p",
      second,
      "-p",
      last,
      "-m",
      "merge v2",
    );
    const result = push([update(merged, absent, "v2")]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("from a line made elsewhere: 3. The merge is gated; they are not.");
    expect(gatesRun(log)).toEqual([`${source} test/owner.test.ts`, `${second} -`, `${merged} suite`]);
  });

  it("leaves out a history another remote of this clone already holds", () => {
    const [, , last = ""] = foreignLine();
    git("update-ref", "refs/remotes/v2/main", last);
    try {
      const own = git("commit-tree", withFile(last, "own.ts"), "-p", last, "-m", "own");
      const result = push([update(own, absent, "imported")]);
      expect(result.status).toBe(0);
      expect(gatesRun(log)).toEqual([`${own} suite`]);
    } finally {
      git("update-ref", "-d", "refs/remotes/v2/main");
    }
  });

  // The wrapper prints its host-wall lines in colour, so the recorded shape begins with an escape.
  const red = "\u001b[0m\u001b[31m";
  const said: [string, string, string][] = [
    [
      "a host-wall rerun",
      `${red}host-wall: 1 test(s) failed on time alone, none on an assertion; running their 1 file(s) again in one fresh process: test/two.test.ts`,
      "still running after 0 min: 2 tests passed, 1 failed so far; 1 test(s) failed on time alone, none on an assertion, so the failed files are running again in one fresh process and that run decides.",
    ],
    [
      "a host-wall error, which keeps the failures",
      `${red}host-wall: error: the host reached a load average of 20.0 on 8 cores, but 1 file(s) printed no result at all: test/two.test.ts`,
      "still running after 0 min: 2 tests passed, 1 failed so far.\n",
    ],
  ];
  for (const [name, wall, pulse] of said) {
    it(`names each pass's log and pulses what the test wrapper said after ${name}`, () => {
      const result = push([update(source, docs)], {
        ANA_FAKE_SUITE: `(pass) one\n(fail) two\n${wall}\n(pass) two`,
        ANA_GATE_PULSE_SECONDS: "1",
      });
      expect(result.status).toBe(0);
      const named = /Log: (\/\S+\.log)/u.exec(result.stderr)?.[1] ?? "";
      expect(readFileSync(named, "utf8")).toContain("(pass) two");
      expect(result.stderr).toContain(`pre-push: ${short(source)} ${pulse}`);
    }, 20_000);
  }
});

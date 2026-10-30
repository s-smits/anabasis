/**
 * `.githooks/pre-push` run as Git runs it, over real commits in a fixture repository, with Bun
 * replaced only at the gate's steps (`test/helpers/fake-bun.ts`). The hook, `tools/runtime/pre-push.ts`
 * and the gate's choice of steps are the real ones, so a case reads which heads were checked and
 * with which steps. Nothing is pushed anywhere: the hook is handed the ref lines Git would hand it.
 * What a pass runs beyond the hook's checks is `test/gate.test.ts`'s.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

import { afterAll, beforeEach, describe, expect, it } from "bun:test";

import { execTextSync, spawnTextSync } from "./helpers/bun-spawn-sync.ts";
import { fakeBun, gatesRun, logLines } from "./helpers/fake-bun.ts";

const hook = join(import.meta.dir, "..", ".githooks", "pre-push");
const fixture = mkdtempSync(join(tmpdir(), "ana-pre-push-"));
const work = join(fixture, "work");
const bin = join(fixture, "bin");
const log = join(fixture, "gates.log");
const fake = (mkdirSync(bin), fakeBun(bin, log));
const absent = "0".repeat(40);
const verify = { ANA_PUSH_VERIFY: "1" };
const STATIC = [
  "install --frozen-lockfile",
  "run format:check",
  "run secrets",
  "run typecheck",
  "run lint -- --strict",
];
// `gh` answers `pr list` with ANA_FAKE_PULLS and writes every call it gets to a log.
const ghLog = join(fixture, "gh.log");
writeFileSync(
  join(bin, "gh"),
  `#!/bin/sh\necho "$*" >> "${ghLog}"\ncase "$1 $2" in "pr list") printf '%s\\n' "\${ANA_FAKE_PULLS:-[]}" ;; esac\n`,
  { mode: 0o755 },
);
const statusesPosted = (): string[] =>
  logLines(ghLog).flatMap(
    (call) => /statuses\/(\w+) -f state=pending -f context=mergeable /u.exec(call)?.[1] ?? [],
  );

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
/** The steps the fake saw run over one commit's checkout. */
const stepsOver = (sha: string): string[] =>
  logLines(log).flatMap((row) => {
    const [at = "", args = ""] = row.split("\t");
    return at === sha ? [args] : [];
  });

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
    env: { ...Bun.env, ANA_GATE_FRESH: "", ...fake, ...env },
  });
}
const update = (local: string, remote: string, branch = "topic"): string =>
  `refs/heads/${branch} ${local} refs/heads/${branch} ${remote}`;

beforeEach(() => {
  rmSync(log, { force: true });
  rmSync(ghLog, { force: true });
  rmSync(join(work, ".git", "ana-gate-passed"), { force: true });
});

describe("pre-push", () => {
  it("checks a documentation-only update with git diff --check and runs no gate step", () => {
    const result = push([update(docs, base)]);
    expect(result.status).toBe(0);
    expect(result.stderr).toContain(
      "documentation only: git diff --check and the secret scan passed on 1 commit.",
    );
    expect(gatesRun(log)).toEqual([]);
  });

  it.each(["spaced.ts", "NOTES.md"])(
    "refuses whitespace in %s below the head before any gate runs",
    (file) => {
      const unclean = git("commit-tree", withFile(docs, file, "x \n"), "-p", docs, "-m", "spaced");
      const head = git(
        "commit-tree",
        withFile(unclean, file === "spaced.ts" ? "c.ts" : "NEXT.md"),
        "-p",
        unclean,
        "-m",
        "head",
      );
      const result = push([update(head, docs)]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`git diff --check fails on ${short(unclean)}. Nothing was pushed.`);
      expect(gatesRun(log)).toEqual([]);
    },
  );

  it("refuses a push that adds a credential-shaped literal, documentation included, before any step runs", () => {
    const key = ["AKIA", "5J3KLMNOPQRSTUVW"].join("");
    const leaked = git(
      "commit-tree",
      withFile(docs, "NOTES.md", `aws: "${key}"\n`),
      "-p",
      docs,
      "-m",
      "notes",
    );
    const head = git("commit-tree", withFile(leaked, "c.ts"), "-p", leaked, "-m", "head");
    const result = push([update(head, docs)]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("NOTES.md:1: ");
    expect(result.stderr).toContain(
      "the secret scan found a credential-shaped literal in what this push adds.",
    );
    expect(gatesRun(log)).toEqual([]);
  });

  it("checks a plain push of source with git diff --check and the secret scan, and runs no gate step", () => {
    const result = push([update(second, docs)]);
    expect(result.status).toBe(0);
    expect(gatesRun(log)).toEqual([]);
  });

  it("gives the pushed head its static steps and the tests near its own change where the push asks", () => {
    const result = push([update(second, docs)], verify);
    expect(result.status).toBe(0);
    expect(gatesRun(log)).toEqual([`${second} -`]);
    expect(stepsOver(second)).toEqual(STATIC);
    expect(stepsOver(source)).toEqual([]);
    rmSync(log, { force: true });
    expect(push([update(source, docs)], verify).status).toBe(0);
    expect(gatesRun(log)).toEqual([`${source} test/owner.test.ts`]);
  });

  it("refuses a push whose head fails the strict lint, and names the step and its log", () => {
    const result = push([update(second, docs)], { ...verify, ANA_FAKE_FAIL: `${second} lint` });
    expect(result.status).toBe(1);
    const last = result.stderr.trimEnd().split("\n").at(-1) ?? "";
    expect(last).toStartWith(`pre-push: ${short(second)} FAILS lint ON ITS OWN. Nothing was pushed. Log: `);
    expect(readFileSync(last.slice(last.indexOf("Log: ") + 5), "utf8")).toContain(
      "gate: step lint failed (exit 1)",
    );
  });

  it("marks pending only the open pull requests stacked above a pushed branch, once its checks pass", () => {
    const pull = (number: number, head: string, onto: string) => ({
      number,
      headRefName: head,
      baseRefName: onto,
      headRefOid: head.padEnd(40, "0"),
      isDraft: true,
      labels: [],
    });
    const pulls = JSON.stringify([
      pull(1, "topic", "main"),
      pull(2, "above", "topic"),
      pull(3, "higher", "above"),
      pull(4, "beside", "main"),
    ]);
    const result = push([update(second, docs)], { ANA_FAKE_PULLS: pulls });
    expect(result.status).toBe(0);
    expect(statusesPosted()).toEqual(["above".padEnd(40, "0"), "higher".padEnd(40, "0")]);
    expect(result.stderr).toContain("marked #2, #3 pending above this push.");
    rmSync(ghLog, { force: true });
    const unclean = git("commit-tree", withFile(docs, "spaced.ts", "x \n"), "-p", docs, "-m", "spaced");
    expect(push([update(unclean, docs)], { ANA_FAKE_PULLS: pulls }).status).toBe(1);
    expect(logLines(ghLog)).toEqual([]);
  });

  // A restack pushes every moved head at once; the lower heads' trees are the land proof's.
  it("checks only the pushed heads no other pushed head holds", () => {
    const oldTrunk = git("commit-tree", withFile(base, "gone.txt"), "-p", base, "-m", "old trunk");
    const oldDocs = git("commit-tree", withFile(docs, "gone.txt"), "-p", oldTrunk, "-m", "docs");
    const oldSource = git("commit-tree", withFile(source, "gone.txt"), "-p", oldDocs, "-m", "source");
    const oldSecond = git("commit-tree", withFile(second, "gone.txt"), "-p", oldSource, "-m", "second");
    const edited = git("commit-tree", withFile(source, "extra.ts"), "-p", docs, "-m", "source");
    const replayed = git("commit-tree", withFile(second, "extra.ts"), "-p", edited, "-m", "second");
    const beside = git("commit-tree", withFile(source, "beside.ts"), "-p", source, "-m", "beside");
    const result = push(
      [update(edited, oldSource, "parent"), update(replayed, oldSecond), update(beside, absent, "beside")],
      verify,
    );
    expect(result.status).toBe(0);
    expect(gatesRun(log)).toEqual([`${replayed} -`, `${beside} -`]);
  });
});

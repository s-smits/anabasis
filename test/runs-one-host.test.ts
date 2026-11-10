// An untouched clone is one host. Each case starts from what a person holds on the first day: their
// Bun, an empty home, a repository of their own, and an ssh that would record any attempt to use it.
// Nothing here is told `--here`, since an empty list of hosts already means this machine alone.
import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { decodeOutput, runSync, runTextSyncOrThrow } from "../src/meta/subprocess.ts";
import { treeFault } from "../tools/d2/campaign.ts";
import { allowedLogins, plainOnly } from "../tools/runs/logins.ts";
import { fakeHosts } from "./helpers/fake-hosts.ts";

const REPO = join(import.meta.dir, "..");
const CLI = join(REPO, "tools/runs/cli.ts");
const MODEL = "claude/claude-opus-5-5";
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-one-host-")));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const home = join(root, "home");
const bin = join(root, "bin");
const clone = join(root, "clone");
const calls = join(root, "ssh-calls");
for (const dir of [home, bin, clone]) mkdirSync(dir, { recursive: true });
writeFileSync(join(bin, "ssh"), `#!/bin/sh\necho "$*" >> "${calls}"\nexit 255\n`);
chmodSync(join(bin, "ssh"), 0o755);
const scrubbed = {
  HOME: home,
  PATH: `${bin}:${dirname(capturedExecPath)}:/usr/bin:/bin`,
};
for (const args of [
  ["init", "-q", "-b", "main"],
  ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "first"],
]) {
  runTextSyncOrThrow(["git", ...args], { cwd: clone, env: scrubbed });
}

function runs(args: readonly string[], extra: Record<string, string> = {}) {
  const { exitCode, stdout, stderr } = runSync([capturedExecPath, CLI, ...args], {
    cwd: clone,
    env: { ...scrubbed, ...extra },
  });
  return { code: exitCode, out: decodeOutput(stdout), err: decodeOutput(stderr) };
}

const sshAttempts = (): boolean => runSync(["test", "-e", calls]).exitCode === 0;
/** A Bun frame or a stack trace, which an ordinary refusal does not owe the person who read it. */
const framed = (text: string) => /^\s+at |^Bun v/mu.test(text);

describe("a clone with no hosts", () => {
  test("every verb a first day reaches stays here and tries no ssh", () => {
    for (const verb of [
      [],
      ["status"],
      ["hosts"],
      ["active"],
      ["catalogue"],
      ["fetch"],
      ["sync"],
      ["sync", "--check"],
      ["alerts"],
    ]) {
      const result = runs(verb);
      expect([verb, result.code, result.err]).toEqual([verb, 0, ""]);
    }
    expect(runs(["sync", "--yes"]).out).toContain("nothing to do");
    expect(sshAttempts()).toBe(false);
  });

  test("a refusal is one line and exit 1, and a defect keeps its trace", () => {
    for (const [verb, says] of [
      [["usage"], "CLAUDE_CODE_OAUTH_TOKEN"],
      [["fresh", "truss"], "CLAUDE_CODE_OAUTH_TOKEN"],
      [["fresh", "truss", "--host", "nowhere"], "no host nowhere"],
      [["fetch", "gone"], "ANA_HOSTS lists no host"],
      [["on"], "no host named"],
      [["status", "--no-such-flag"], "no-such-flag"],
    ] as const) {
      const result = runs(verb);
      expect([verb, result.code]).toEqual([verb, 1]);
      expect(result.err).toContain(says);
      expect(framed(result.err)).toBe(false);
    }
    expect(sshAttempts()).toBe(false);
  });

  test("here names this machine on every verb, whether or not the verb has a use for it", () => {
    for (const verb of [
      ["status", "--here"],
      ["retire", "--here"],
      ["active", "--here"],
      ["hosts", "--health", "--here"],
      ["on", "here", "status"],
    ]) {
      const result = runs(verb);
      expect([verb, result.code, framed(result.err)]).toEqual([verb, 0, false]);
    }
    expect(sshAttempts()).toBe(false);
  });

  test("ANA_HOSTS set and empty is unset, and one that is no JSON names the variable", () => {
    expect(runs(["status"], { ANA_HOSTS: "" }).code).toBe(0);
    const faulty = runs(["status"], { ANA_HOSTS: "nonsense" });
    expect(faulty.code).toBe(1);
    expect(faulty.err).toContain("ANA_HOSTS is not JSON");
    expect(framed(faulty.err)).toBe(false);
  });

  test("a copied .env.example holds no login, and the plain credential is the login a run takes", () => {
    const copied = { CLAUDE_CODE_OAUTH_TOKEN: "", CLAUDE_CODE_OAUTH_TOKEN2: "" };
    expect(allowedLogins(copied)).toEqual([]);
    expect(plainOnly(copied)).toBe(false);
    const plain = { ...copied, CLAUDE_CODE_OAUTH_TOKEN: "held" };
    expect(plainOnly(plain)).toBe(true);
  });

  test("fresh with no credential names the key to set and how to give it", () => {
    const empty = { CLAUDE_CODE_OAUTH_TOKEN: "", CLAUDE_CODE_OAUTH_TOKEN2: "" };
    for (const [env, key] of [
      [{}, "set CLAUDE_CODE_OAUTH_TOKEN in"],
      [empty, "set CLAUDE_CODE_OAUTH_TOKEN in"],
      [{ ANA_LOGINS: "2,3" }, "set CLAUDE_CODE_OAUTH_TOKEN2 or CLAUDE_CODE_OAUTH_TOKEN3 in"],
      [{ ANA_LOGINS: "2", CLAUDE_CODE_OAUTH_TOKEN: "held" }, "set CLAUDE_CODE_OAUTH_TOKEN2 in"],
    ] as const) {
      const { code, err } = runs(["fresh", "truss"], env);
      expect([env, code]).toEqual([env, 1]);
      expect(err).toContain(key);
      expect(err).toContain("--env-file");
      expect(err).not.toContain("no allowed login has room");
      expect(framed(err)).toBe(false);
    }
    expect(sshAttempts()).toBe(false);
  });

  test("a dry run says a real run would be refused here, and names the credential and how to give it", () => {
    const { exitCode, stderr } = runSync(
      [
        capturedExecPath,
        join(REPO, "tools/d2/harness-builder.ts"),
        "--name",
        "one-host-test",
        "--project",
        "p",
        "--prompt",
        "x",
        "--budget",
        "1",
        "--dry-run",
        "--solver",
        MODEL,
        "--builder",
        MODEL,
        "--examiner",
        MODEL,
        "--reviewer",
        MODEL,
      ],
      { cwd: clone, env: scrubbed },
    );
    expect(exitCode).toBe(1);
    // The command runs this tree's source, so the refusal is this tree's: a clone's main worktree
    // owes it, and the gate's scratch worktree of a commit does not.
    expect(decodeOutput(stderr).includes("a real run here is refused")).toBe(treeFault(REPO) !== null);
    expect(decodeOutput(stderr)).toContain("--env-file=<file>");
    expect(sshAttempts()).toBe(false);
  });

  test("a handover document aliases this machine alone, and refuses where hosts were not loaded", () => {
    const script = join(REPO, ".claude/skills/oracle-handover/scripts/document.ts");
    const alone = runSync([capturedExecPath, script, "--aliases"], { cwd: clone, env: scrubbed });
    expect(alone.exitCode).toBe(0);
    expect(decodeOutput(alone.stdout)).toContain("host-a is ");
    const named = join(root, "named");
    mkdirSync(named);
    runTextSyncOrThrow(["git", "init", "-q", "-b", "main"], { cwd: named, env: scrubbed });
    writeFileSync(join(named, ".env.runs"), 'ANA_HOSTS=\'[{"name":"peer"}]\'\n');
    const unread = runSync([capturedExecPath, script, "--aliases"], { cwd: named, env: scrubbed });
    expect(unread.exitCode).toBe(1);
    expect(decodeOutput(unread.stderr)).toContain("names ANA_HOSTS, and this command did not load it");
    expect(decodeOutput(unread.stdout)).not.toContain("peer");
  });

  test("a search that could not run at all fails", () => {
    const made = fakeHosts();
    const driver = (hosts: string) => `import { search } from "REPOSITORY/tools/runs/search.ts";
await search(["needle"], {
  hosts: ${hosts},
  local: () => { throw new Error("rg is not installed on this host"); },
  print: console.log,
});
process.exit();`;
    const none = made.run(driver("[]"));
    expect(none.code).toBe(1);
    expect(none.out).toContain("search failed");
    rmSync(made.root, { recursive: true, force: true });
  });

  test("a run from a clone with no remote says so", () => {
    const result = runSync(
      [
        capturedExecPath,
        "-e",
        `import { publishedAt } from "${REPO}/tools/runs/code.ts";
try { publishedAt(${JSON.stringify(clone)}, "HEAD"); } catch (error) { console.log(error.message); }`,
      ],
      { cwd: clone, env: scrubbed },
    );
    expect(decodeOutput(result.stdout)).toContain("origin");
  });
});

// An untouched clone is one host: each case starts from a person's first day (their Bun, an empty home,
// their own repository, an ssh that records any use). An empty list of hosts already means this machine
// alone, so nothing is told `--here`.
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

const REPO = join(import.meta.dir, "..");
const CLI = join(REPO, "tools/runs/cli.ts");
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
  // A child's own temporary root, as the suite gives each test file, so a sweep does not read the
  // scratch real runs left in the machine's.
  ANA_TEST_TMPDIR: root,
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

  test("a named fetch that can ask no host refuses, though a copy of that campaign is held", () => {
    // A reader takes a peer's copy as it stands where no host is listed, but a named fetch must not: it
    // prints the copy's path and exits 0 with nothing brought.
    const copy = join(clone, "data/runs/peer/held");
    mkdirSync(copy, { recursive: true });
    const opened = { at: "2026-11-15T00:00:00.000Z", kind: "campaign.opened", data: { project: "held" } };
    writeFileSync(join(copy, "log.jsonl"), `${JSON.stringify(opened)}\n`);
    try {
      const result = runs(["fetch", "held"]);
      expect([result.code, result.out]).toEqual([1, ""]);
      expect(result.err).toContain("ANA_HOSTS lists no host");
      expect(runs(["fetch"]).code).toBe(0);
    } finally {
      rmSync(join(clone, "data"), { recursive: true, force: true });
    }
    expect(sshAttempts()).toBe(false);
  });
});

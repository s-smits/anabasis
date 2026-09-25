/**
 * A0.2: the process captures its source identity once, returns null outside a
 * Git worktree, and records a digest for evidence. The suite runs inside the Anabasis repo, so the
 * live capture must resolve a real commit.
 */
import { isBoolean } from "../src/meta/json-shape.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import { execTextSync } from "./helpers/bun-spawn-sync.ts";
import {
  SOURCE_IDENTITY,
  captureSourceDigest,
  captureSourceIdentity,
  digestExecutableRoots,
  sourceStillFrozen,
} from "../src/run/source-identity.ts";
import { runtimeProcess } from "../src/meta/process.ts";

const OUTSIDE = mkdtempSync(join(tmpdir(), "no-git-"));
afterAll(() => {
  rmSync(OUTSIDE, { recursive: true, force: true });
});

describe("the frozen source identity (A0.2)", () => {
  it("captures the executing repo's commit and a dirty disclosure", () => {
    expect(SOURCE_IDENTITY).not.toBeNull();
    if (SOURCE_IDENTITY === null) throw new Error("unreachable");
    expect(SOURCE_IDENTITY.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(isBoolean(SOURCE_IDENTITY.dirty)).toBe(true);
    // The digest binds the executable roots' bytes; a dirty boolean alone is disclosure. It is
    // absolute content, so it is always a hex digest — never null for "matches HEAD".
    expect(SOURCE_IDENTITY.sourceDigest).toMatch(/^[0-9a-f]{64}$/);
    const fresh = captureSourceIdentity();
    expect(fresh?.commit).toBe(SOURCE_IDENTITY.commit);
  });

  it("owns the drift comparison: frozen baseline only, absence stays disclosure", () => {
    // The frozen identity is the one baseline; consumers never diff two ad-hoc captures.
    expect(sourceStillFrozen(SOURCE_IDENTITY)).toBeNull();
    expect(sourceStillFrozen(null)).toBeNull();
    // The default recapture reads the root bytes alone; it agrees with the frozen digest in place.
    expect(captureSourceDigest()?.sourceDigest).toBe(SOURCE_IDENTITY?.sourceDigest);
    expect(sourceStillFrozen()).toBeNull();
    if (SOURCE_IDENTITY === null) throw new Error("unreachable inside the repo");
    // A commit hash is attribution, never the drift test: the same executed bytes under a moved
    // HEAD are not drift. The conjunction this replaces refused the census as `owner: environment`
    // for any commit at all, including one that touched no root (live-run-06 near-miss).
    expect(sourceStillFrozen({ ...SOURCE_IDENTITY, commit: "b".repeat(40) })).toBeNull();
    // Different executable bytes are drift, committed or not — the live-03 P1 case (dirty disk
    // against a clean frozen process).
    expect(sourceStillFrozen({ ...SOURCE_IDENTITY, sourceDigest: "f".repeat(64), dirty: true })).toMatch(
      /frozen identity/,
    );
  });

  it("hashes root contents, so a commit outside the roots is not drift and a byte inside is", () => {
    const repo = mkdtempSync(join(tmpdir(), "roots-"));
    const cwd = runtimeProcess.cwd();
    const run = (args: string[]) => execTextSync("git", args, { cwd: repo });
    try {
      run(["init", "-q"]);
      run(["config", "user.email", "pin@example.test"]);
      run(["config", "user.name", "pin"]);
      mkdirSync(join(repo, "src"), { recursive: true });
      mkdirSync(join(repo, "starters", "pi-built-harness"), { recursive: true });
      writeFileSync(join(repo, "src", "a.ts"), "export const a = 1;\n");
      writeFileSync(join(repo, "starters", "pi-built-harness", "STARTER.md"), "read me first\n");
      writeFileSync(join(repo, "thresholds.frozen.yaml"), "policy: one\n");
      writeFileSync(join(repo, "NOTES.md"), "one\n");
      run(["add", "-A"]);
      run(["commit", "-qm", "first"]);
      runtimeProcess.chdir(repo);
      const before = captureSourceIdentity();
      expect(before?.sourceDigest).toMatch(/^[0-9a-f]{64}$/);

      // A commit that touches nothing under the roots: HEAD moves, executed bytes do not.
      writeFileSync(join(repo, "NOTES.md"), "two\n");
      run(["add", "-A"]);
      run(["commit", "-qm", "docs only"]);
      const afterDocs = captureSourceIdentity();
      expect(afterDocs?.commit).not.toBe(before?.commit);
      expect(afterDocs?.sourceDigest).toBe(before?.sourceDigest);

      // Model-visible starter bytes are part of the condition even though they are copied rather
      // than imported as modules.
      writeFileSync(join(repo, "starters", "pi-built-harness", "STARTER.md"), "changed contract\n");
      expect(captureSourceIdentity()?.sourceDigest).not.toBe(before?.sourceDigest);
      writeFileSync(join(repo, "starters", "pi-built-harness", "STARTER.md"), "read me first\n");
      expect(captureSourceIdentity()?.sourceDigest).toBe(before?.sourceDigest);

      // The frozen policy is executable configuration even though it is not TypeScript.
      writeFileSync(join(repo, "thresholds.frozen.yaml"), "policy: two\n");
      expect(captureSourceIdentity()?.sourceDigest).not.toBe(before?.sourceDigest);
      writeFileSync(join(repo, "thresholds.frozen.yaml"), "policy: one\n");
      expect(captureSourceIdentity()?.sourceDigest).toBe(before?.sourceDigest);

      // A byte under an executable root is drift whether or not it is committed.
      writeFileSync(join(repo, "src", "a.ts"), "export const a = 2;\n");
      expect(captureSourceIdentity()?.sourceDigest).not.toBe(before?.sourceDigest);
      run(["add", "-A"]);
      run(["commit", "-qm", "src change"]);
      expect(captureSourceIdentity()?.sourceDigest).not.toBe(before?.sourceDigest);
    } finally {
      runtimeProcess.chdir(cwd);
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("digests a named checkout from elsewhere, and reads a committed path from HEAD on request", () => {
    const repo = mkdtempSync(join(tmpdir(), "roots-at-"));
    const cwd = runtimeProcess.cwd();
    const run = (args: string[]) => execTextSync("git", args, { cwd: repo });
    try {
      run(["init", "-q"]);
      run(["config", "user.email", "pin@example.test"]);
      run(["config", "user.name", "pin"]);
      mkdirSync(join(repo, "src"), { recursive: true });
      writeFileSync(join(repo, "src", "a.ts"), "export const a = 1;\n");
      writeFileSync(join(repo, ".bun-version"), "1.4.2\n");
      run(["add", "-A"]);
      run(["commit", "-qm", "first"]);
      const named = digestExecutableRoots(repo);
      runtimeProcess.chdir(repo);
      // The same checkout read in place and named from another directory is one digest.
      expect(captureSourceDigest()?.sourceDigest).toBe(named);
      runtimeProcess.chdir(cwd);

      // A local pin edit is drift on the disk reading, and none when the pin is read as committed.
      writeFileSync(join(repo, ".bun-version"), "9.9.9\n");
      expect(digestExecutableRoots(repo)).not.toBe(named);
      expect(digestExecutableRoots(repo, [".bun-version"])).toBe(named);
      // Only the named path is read from HEAD: a source edit still moves the digest.
      writeFileSync(join(repo, "src", "a.ts"), "export const a = 2;\n");
      expect(digestExecutableRoots(repo, [".bun-version"])).not.toBe(named);
    } finally {
      runtimeProcess.chdir(cwd);
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("is typed absence outside a git work tree, never a guess", () => {
    const cwd = runtimeProcess.cwd();
    try {
      runtimeProcess.chdir(OUTSIDE);
      expect(captureSourceIdentity()).toBeNull();
      expect(captureSourceDigest()).toBeNull();
    } finally {
      runtimeProcess.chdir(cwd);
    }
  });
});

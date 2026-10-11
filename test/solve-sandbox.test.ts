// Copied from v1 (github.com/s-smits/anabasis, 3f93d06b): test/solve-sandbox.test.ts, its first two
// blocks verbatim, the policy and the executed fixture. Its last three blocks test v1's Built worker
// and isolation claim, which did not come over, and the five imports only they read went with them.
// Every policy and probe here now takes the disk cap v1 did not have, and the cases under "the disk
// cap" are new.
//
// Host-owned solve isolation, proved by running it rather than by reading it. Every case here
// executes the sandbox on the host the suite is running on, because a profile that is checked only
// as configuration is a profile nobody has seen refuse anything, and the whole point of the wall
// is what the kernel does with it.
//
// Each refusal is paired with a control read that has to succeed, and that half is the one worth
// explaining: a sandbox that refuses every operation would pass a suite testing refusals alone
// while making the product unusable. Run 4 is the reason it is not hypothetical — it walled off
// its own repair-attribution and Judge paths.
import { spawnTextSync as spawnSync } from "./helpers/bun-spawn-sync.ts";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { homedir, tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { DARWIN_SANDBOX_EXEC } from "../src/verify/darwin-seatbelt.ts";
import {
  guardedAncestors,
  moveBlockingRules,
  probeMoveGuardCheck,
} from "../src/verify/seatbelt-path-guard.ts";

/** Profile syntax depends on the host: SBPL on Darwin, bubblewrap arguments on Linux.
 *  Check that syntax on its host and check the shared policy fields on both. */
const onDarwin = runtimeProcess.platform === "darwin";
const onLinux = runtimeProcess.platform === "linux";
import {
  HOST_BWRAP_SOLVE_ISOLATION_FIXTURE,
  HOST_SOLVE_ISOLATION_FIXTURE,
  HOST_SOLVE_ISOLATION_PROFILE_ID,
  observedRefusal,
  probeHostSolveReadDeny,
  solveIsolationPolicy,
  isolationArgv,
} from "../src/verify/solve-sandbox.ts";
import { LINUX_BWRAP_ID } from "../src/verify/linux-bwrap.ts";
import { runtimeProcess } from "../src/meta/process.ts";

/** A cap these policies name and never mount: on Darwin nothing mounts outside `mountDiskCap`, and
 *  on Linux the probe's launches mount it inside their own namespace. */
const cap = { root: join(tmpdir(), "ana-solve-sandbox-cap"), bytes: 64 * 1024 * 1024 };
const dirs: string[] = [];
function workRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "ana-solve-sandbox-"));
  dirs.push(root);
  return root;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the solve isolation's policy", () => {
  it("denies the repository's other worktrees with it, and names them in its identity", () => {
    // A campaign runs from a worktree kept for it, and its log, every hidden value in it, lies
    // under `.ana` there. Until 10 October a shell in a sibling worktree could read it.
    const repoRoot = workRepo();
    const sibling = workRepo();
    const alone = solveIsolationPolicy({ repoRoot, cap });
    const closed = solveIsolationPolicy({ repoRoot, otherTrees: [sibling], cap });
    if ("unsupported" in alone || "unsupported" in closed) {
      throw new Error("this host cannot run the isolation");
    }
    expect(alone.deniedReadRoots).not.toContain(sibling);
    expect(closed.deniedReadRoots).toContain(sibling);
    expect(closed.deniedReadRoots).toContain(realpathSync.native(sibling));
    expect(closed.deniedWriteRoots).toContain(sibling);
    expect(closed.policyHash).not.toBe(alone.policyHash);
  });

  it("mounts nothing on a denied worktree removed since the policy was made, so a solve still starts", () => {
    // The other worktrees are read once when a campaign opens. On 10 October two were removed
    // while a simulated campaign ran, and from the next policy on every solve ended
    // `sandbox-crash`: Bubblewrap cannot make a mountpoint under the read-only root. A removed
    // tree cannot be read, so it stays in the identity and takes no mount.
    const repoRoot = workRepo();
    const sibling = workRepo();
    const policy = solveIsolationPolicy({ repoRoot, otherTrees: [sibling], cap });
    if ("unsupported" in policy) throw new Error(`this host cannot run the isolation: ${policy.unsupported}`);
    rmSync(sibling, { recursive: true, force: true });
    expect(policy.deniedReadRoots).toContain(sibling);
    if (onLinux) {
      const argv = isolationArgv(policy, "/bin/true", [], {});
      expect(argv).not.toContain(sibling);
      expect(argv).toEqual(expect.arrayContaining(["--tmpfs", realpathSync.native(repoRoot)]));
    }
  });

  it("denies the repository and whole operator home, reopening only explicit runtimes", () => {
    const repoRoot = workRepo();
    const policy = solveIsolationPolicy({ repoRoot, cap });
    if ("unsupported" in policy) throw new Error(`this host cannot run the isolation: ${policy.unsupported}`);
    expect(policy.deniedReadRoots).toContain(homedir());
    // Both path forms of the repository, or the symlink form stays readable and the isolation leaks.
    expect(policy.deniedReadRoots).toContain(repoRoot);
    expect(policy.deniedReadRoots).toContain(realpathSync.native(repoRoot));
    expect(policy.deniedWriteRoots.length).toBeGreaterThan(0);
    expect(policy.allowedReadRoots.every((root) => root.startsWith(`${homedir()}/`))).toBe(true);
    expect(policy.allowedReadRoots.some((root) => root.includes("/.ssh") || root.includes("/.claude"))).toBe(
      false,
    );
    if (onDarwin) {
      for (const root of policy.allowedReadRoots) expect(policy.profile).toContain(JSON.stringify(root));
      expect(policy.profile).not.toContain(".credentials.json");
    }
    if (onLinux) {
      // Linux's evidence field is descriptive only; assert the argv the child actually receives.
      expect(isolationArgv(policy, "/bin/true", [], {})).toEqual(
        expect.arrayContaining(["--tmpfs", realpathSync.native(repoRoot)]),
      );
    }
    expect(policy.profileId).toBe(HOST_SOLVE_ISOLATION_PROFILE_ID);
  });

  it("lifts exactly the denies covering one path for the discrimination check", () => {
    const repoRoot = workRepo();
    const real = solveIsolationPolicy({ repoRoot, cap });
    const open = solveIsolationPolicy({ repoRoot, cap, liftDeniesCovering: join(repoRoot, "canary.txt") });
    if ("unsupported" in real || "unsupported" in open) throw new Error("this host cannot run the isolation");
    expect(open.deniedReadRoots.length).toBeLessThan(real.deniedReadRoots.length);
    expect(open.policyHash).not.toBe(real.policyHash);
    // Lifting the repository restriction must preserve the separate home restriction.
    expect(open.deniedReadRoots).toContain(homedir());
  });

  // A read restriction names a path, so a profile without `seatbelt-path-guard.ts` refuses the
  // direct read and the rename of the denied directory, and then lets a rename of its parent
  // through: the canary comes back at exit 0. These assertions are the structural half of the
  // guard; the executed half is the fixture's fourth check.
  it("denies the rename of every protected root's ancestors, so a deny cannot be relocated", () => {
    const repoRoot = workRepo();
    const policy = solveIsolationPolicy({ repoRoot, cap });
    if ("unsupported" in policy) throw new Error(`this host cannot run the isolation: ${policy.unsupported}`);
    // The parent of each denied root is guarded against relocation.
    const ancestors = guardedAncestors(policy.deniedReadRoots);
    expect(ancestors).toContain(dirname(realpathSync.native(repoRoot)));
    expect(ancestors).toContain(dirname(homedir()));
    expect(ancestors).not.toContain("/");
    if (onDarwin) {
      // Both halves of the rename: the source is unlinked and the destination is created.
      expect(policy.profile).toContain("(deny file-write-unlink");
      expect(policy.profile).toContain("(deny file-write-create");
      for (const ancestor of ancestors) {
        expect(policy.profile).toContain(`(literal ${JSON.stringify(ancestor)})`);
      }
      // Upstream tags every rule with a per-session random suffix for its log stream. Copying that
      // would make the profile bytes differ per run and break `profileDigest === policyHash`.
      expect(policy.profile).not.toContain("with message");
    }
    const again = solveIsolationPolicy({ repoRoot, cap });
    if ("unsupported" in again) throw new Error("this host cannot run the isolation");
    expect(again.profile).toBe(policy.profile);
    expect(again.policyHash).toBe(policy.policyHash);
  });

  it("refuses to create an isolation policy on an unsupported platform", () => {
    // This policy supports neither Seatbelt nor bubblewrap on win32.
    const policy = solveIsolationPolicy({ repoRoot: workRepo(), cap, runtime: { platform: "win32" } });
    expect("unsupported" in policy).toBe(true);
  });

  it("refuses an ordinary home canary and reads only an explicit runtime inside a denied root", () => {
    const repoRoot = workRepo();
    const runtimeRoot = join(repoRoot, "node_modules", "transport-runtime");
    mkdirSync(runtimeRoot, { recursive: true });
    const runtimeCanary = join(runtimeRoot, "canary.txt");
    writeFileSync(runtimeCanary, "RUNTIME-CANARY\n");
    const homeRoot = mkdtempSync(join(homedir(), ".ana-solve-home-"));
    dirs.push(homeRoot);
    const homeCanary = join(homeRoot, "canary.txt");
    writeFileSync(homeCanary, "HOME-CANARY\n");
    const policy = solveIsolationPolicy({ repoRoot, cap, readAllowRoots: [runtimeRoot] });
    if ("unsupported" in policy) throw new Error(`this host cannot run the isolation: ${policy.unsupported}`);
    const result = spawnSync(
      policy.mechanismPath,
      isolationArgv(policy, "/bin/sh", ["-c", `cat ${homeCanary} 2>&1; cat ${runtimeCanary} 2>&1`]),
      { cwd: tmpdir(), timeout: 10_000 },
    );
    const output = `${result.stdout}${result.stderr}`;
    expect(output).not.toContain("HOME-CANARY");
    expect(output).toContain("RUNTIME-CANARY");
  });
});

describe("the executed fixture", () => {
  it("proves the OS refused a protected read the lifted policy shows would otherwise succeed", () => {
    const repoRoot = workRepo();
    writeFileSync(join(repoRoot, "hidden-tasks.json"), "{}\n");
    const evidence = probeHostSolveReadDeny({ repoRoot, cap });
    expect(evidence.fixture).toBe(
      onLinux ? HOST_BWRAP_SOLVE_ISOLATION_FIXTURE : HOST_SOLVE_ISOLATION_FIXTURE,
    );
    expect(evidence.available).toBe(true);
    expect(evidence.deniedReadRefused).toBe(true);
    expect(evidence.controlReadSucceeded).toBe(true);
    expect(evidence.discriminationReadSucceeded).toBe(true);
    expect(evidence.moveGuardRefused).toBe(true);
    if (onLinux) expect(evidence.evidence.join("\n")).toContain("stayed hidden");
    expect(evidence.isolated).toBe(true);
    // Given no other worktree the sibling read is not tried; given one, a read of its package.json
    // is refused too, which every wall checks once a process before its first use (`walledBase`).
    // The probe writes nothing into a sibling, which another user may own (10 October).
    expect(evidence.siblingReadRefused).toBeNull();
    const sibling = workRepo();
    writeFileSync(join(sibling, "package.json"), '{\n  "name": "a-sibling"\n}\n');
    const closed = probeHostSolveReadDeny({ repoRoot, otherTrees: [sibling], cap });
    expect(closed.siblingReadRefused).toBe(true);
    expect(closed.isolated).toBe(true);
    expect(closed.evidence.join("\n")).toContain("other-worktree read: REFUSED");
    expect(readdirSync(sibling)).toEqual(["package.json"]);
    const policy = solveIsolationPolicy({ repoRoot, cap });
    if ("unsupported" in policy) throw new Error("this host cannot run the isolation");
    // The evidence binds the rules it executed, so a later reader can re-derive them.
    expect(evidence.profileDigest).toBe(policy.policyHash);
  });

  // The fourth check on its own: the rules copied from sandbox-runtime refuse the rename that the
  // same profile without them permits. Without the lifted half a refusal could come from a
  // filesystem error unrelated to the sandbox rules.
  it.skipIf(!onDarwin)(
    "refuses an ancestor rename under the copied rules and permits it without them",
    () => {
      const check = probeMoveGuardCheck(DARWIN_SANDBOX_EXEC);
      expect(check.refused).toBe(true);
      expect(check.liftedSucceeded).toBe(true);
      expect(check.detail).toContain("refused under the guard rules");
    },
  );

  it("emits nothing when there is nothing to protect, rather than a rule matching everything", () => {
    expect(moveBlockingRules([])).toStrictEqual([]);
    expect(guardedAncestors([])).toStrictEqual([]);
  });

  it("reports an unavailable mechanism as unproven instead of throwing", () => {
    const evidence = probeHostSolveReadDeny({ repoRoot: workRepo(), cap, runtime: { platform: "win32" } });
    expect(evidence.available).toBe(false);
    expect(evidence.isolated).toBe(false);
    expect(evidence.profileDigest).toBeNull();
  });

  it("never reads a bare non-zero exit as a refusal", () => {
    expect(observedRefusal("bash: no such file", 127, "MARKER")).toBe(false);
    expect(observedRefusal("cat: Operation not permitted", 1, "MARKER")).toBe(true);
    // The canary in the output refutes a refusal outright, whatever the exit code said.
    expect(observedRefusal("MARKER\ncat: Operation not permitted", 1, "MARKER")).toBe(false);
  });
});

describe("the disk cap", () => {
  it("is part of the policy's identity, so another root or size is another policy", () => {
    const repoRoot = workRepo();
    const hashes = [cap, { ...cap, bytes: cap.bytes * 2 }, { ...cap, root: `${cap.root}-other` }].map(
      (each) => {
        const policy = solveIsolationPolicy({ repoRoot, cap: each });
        if ("unsupported" in policy) throw new Error("this host cannot run the isolation");
        return policy.policyHash;
      },
    );
    expect(new Set(hashes).size).toBe(3);
  });

  it("refuses a root inside a denied tree, where the worker could not write it", () => {
    const repoRoot = workRepo();
    expect(() => solveIsolationPolicy({ repoRoot, cap: { ...cap, root: join(repoRoot, "solve") } })).toThrow(
      "sits inside a denied root",
    );
  });

  // Argv only: this suite's host may not be Linux, and the order is what the policy is. The denied
  // roots exist, since a root that does not takes no mount.
  it("mounts a sized tmpfs at the root after the denies and before any read-only remount", () => {
    const argv = isolationArgv(
      {
        profile: "linux",
        mechanismId: LINUX_BWRAP_ID,
        deniedReadRoots: [homedir(), workRepo()],
        allowedReadRoots: ["/home/operator/.bun"],
        cap: { root: "/tmp/solve-1", bytes: 1_048_576 },
      },
      "/bin/true",
      [],
    );
    const size = argv.indexOf("--size");
    expect(argv.slice(size, size + 4)).toEqual(["--size", "1048576", "--tmpfs", "/tmp/solve-1"]);
    expect(size).toBeGreaterThan(argv.indexOf("--dev-bind"));
    expect(size).toBeGreaterThan(argv.lastIndexOf("/home/operator/.bun"));
    expect(size).toBeLessThan(argv.indexOf("--remount-ro"));
  });
});

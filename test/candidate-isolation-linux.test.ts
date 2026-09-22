/**
 * The bubblewrap half. The argv is built without spawning, so its shape is checked on any host;
 * the executed proofs need a live bwrap and unprivileged user namespaces and run only on Linux.
 * There a blocked read is an ABSENT path, so the proof is that the protected bytes never appear.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, realpathSync, writeFileSync } from "../src/meta/filesystem.ts";
import { dirname, join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import {
  CandidateIsolationRefusal,
  linuxCandidatePlan,
  openPathRecord,
  runIsolated,
} from "../src/builder/candidate-isolation-runtime.ts";
import { deriveCandidateIsolation } from "../src/builder/candidate-isolation.ts";
import { networkResolverReadPaths, presentSystemReadRoots } from "../src/verify/linux-bwrap.ts";
import { LINUX_BWRAP_ID, osIsolationSupport } from "../src/verify/os-isolation.ts";
import { makeIsolationRepo } from "./helpers/isolation-fixture.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const SCRATCH = realpathSync.native(scratchDir("ana-isolation-"));
const onLinux = runtimeProcess.platform === "linux";

afterAll(cleanupScratch);
/** Whether `argv` contains the consecutive tokens in `seq`, such as a bwrap flag and its paths. */
function argvHasSequence(argv: readonly string[], ...seq: string[]): boolean {
  for (let start = 0; start + seq.length <= argv.length; start += 1) {
    if (seq.every((token, offset) => argv[start + offset] === token)) return true;
  }
  return false;
}
const { repoRoot, binding } = makeIsolationRepo(SCRATCH, "repo");
const policy = deriveCandidateIsolation(binding, "author");

// The bubblewrap argv is built without spawning, so its shape is checked on any host (including
// this Darwin one). A synthetic mechanism stands in for a live bwrap: the plan reads the policy
// value and the real fixture tree, never the mechanism binary.
describe("linux bubblewrap plan construction", () => {
  const support = {
    mechanismId: LINUX_BWRAP_ID,
    mechanismDigest: "a".repeat(64),
    baselineDigest: "b".repeat(64),
  };
  const census = join(binding.iterationDir, "census.json");
  const brief = join(binding.iterationDir, "slug", "correctness-model", "brief.json");

  it("binds the workspace read-write, clears inherited environment, and overmounts every protected region", () => {
    const { argv } = linuxCandidatePlan(policy, "exec", support, ["/bin/sh"], { ANA_EXPLICIT: "granted" });
    // The networked authoring session shares the net namespace; the workshop cell does not.
    expect(argv).not.toContain("--unshare-net");
    expect(
      linuxCandidatePlan(deriveCandidateIsolation(binding, "workshop"), "exec", support, ["/bin/sh"]).argv,
    ).toContain("--unshare-net");
    expect(argv).toContain("--disable-userns");
    expect(argv).toContain("--clearenv");
    expect(argvHasSequence(argv, "--setenv", "ANA_EXPLICIT", "granted")).toBe(true);
    // The candidate workspace is the one read-write root; a writable root is bound once.
    expect(argvHasSequence(argv, "--bind", binding.iterationDir, binding.iterationDir)).toBe(true);
    expect(argvHasSequence(argv, "--ro-bind", binding.iterationDir, binding.iterationDir)).toBe(false);
    // The .oss cell (readDenyRoots) is hidden by an empty tmpfs, the Linux form of a subpath deny.
    expect(argvHasSequence(argv, "--tmpfs", binding.ossRoot)).toBe(true);
    // A shadow root (writeDenyRoots) is re-bound read-only after the workspace bind: the Builder's
    // own `bun test` still resolves the @ana links through it, and cannot write a shim there.
    const shadow = join(binding.iterationDir, "node_modules");
    mkdirSync(shadow, { recursive: true });
    const withShadow = linuxCandidatePlan(policy, "exec", support, ["/bin/sh"]).argv;
    expect(argvHasSequence(withShadow, "--ro-bind", shadow, shadow)).toBe(true);
    expect(withShadow.indexOf(shadow)).toBeGreaterThan(withShadow.indexOf(binding.iterationDir));
    expect(argvHasSequence(withShadow, "--tmpfs", shadow)).toBe(false);
    // An evidence file inside the writable tree is covered with host /dev/null. Reads return
    // empty content; the path itself remains present.
    expect(argvHasSequence(argv, "--ro-bind", "/dev/null", census)).toBe(true);
    // An authored file the guard allows stays reachable — the isolation does not over-hide.
    expect(argvHasSequence(argv, "--ro-bind", "/dev/null", brief)).toBe(false);
    // The walk behind those mounts is remembered per directory. A measured-evidence file written
    // into a new subdirectory between two plans still reaches the second plan's mount list.
    const late = join(binding.iterationDir, "slug", "late", "census.json");
    mkdirSync(dirname(late), { recursive: true });
    writeFileSync(late, "{}");
    expect(
      argvHasSequence(
        linuxCandidatePlan(policy, "exec", support, ["/bin/sh"]).argv,
        "--ro-bind",
        "/dev/null",
        late,
      ),
    ).toBe(true);
  });

  it("grants the resolver symlink target only to a policy with network access", () => {
    // On a systemd-resolved host /etc/resolv.conf points into /run, which no posture binds, so a
    // network-allowed cell had a socket and no way to turn a name into an address. The bind is the
    // link target alone; the /run directory around it stays absent.
    const resolver = networkResolverReadPaths();
    const author = linuxCandidatePlan(policy, "exec", support, ["/bin/sh"]).argv;
    const cell = linuxCandidatePlan(deriveCandidateIsolation(binding, "workshop"), "exec", support, [
      "/bin/sh",
    ]).argv;
    for (const path of resolver) {
      expect(argvHasSequence(author, "--ro-bind", path, path)).toBe(true);
      expect(argvHasSequence(cell, "--ro-bind", path, path)).toBe(false);
      expect(author).not.toContain(dirname(path));
    }
    // A host whose /etc/resolv.conf is a plain file needs no extra bind: /etc already carries it.
    if (resolver.length === 0) expect(presentSystemReadRoots()).toContain("/etc");
  });

  it("keeps the digest a mechanism-bound policy identity that cannot collide with the Darwin one", () => {
    const base = linuxCandidatePlan(policy, "exec", support, ["/bin/sh"]).profileDigest;
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    // A policy function, not a filesystem-state function: the same inputs give the same digest,
    // exactly as the Darwin profile digest is stable across a turn.
    expect(linuxCandidatePlan(policy, "exec", support, ["/bin/sh"]).profileDigest).toBe(base);
    // The mechanism id feeds the identity, so no Linux digest can equal a Darwin SBPL digest.
    const otherMechanism = linuxCandidatePlan(
      policy,
      "exec",
      { ...support, mechanismId: "other-mechanism/v1" },
      ["/bin/sh"],
    ).profileDigest;
    expect(otherMechanism).not.toBe(base);
    // Mode and the spawned command both move the digest, as they move the emitted bytes.
    expect(linuxCandidatePlan(policy, "read", support, ["/bin/sh"]).profileDigest).not.toBe(base);
    expect(linuxCandidatePlan(policy, "exec", support, ["/bin/cat"]).profileDigest).not.toBe(base);
  });
});

// The executed bubblewrap proofs need a live bwrap and unprivileged user namespaces, so they run
// only on a Linux host. A blocked read there is an ABSENT path, so the proof is that the protected
// bytes never appear, not that a specific errno is returned.
describe.skipIf(!onLinux)("executed OS enforcement (linux bubblewrap)", () => {
  it("resolves the bubblewrap mechanism on this host", () => {
    expect(osIsolationSupport().mechanismId).toBe(LINUX_BWRAP_ID);
  });

  it("reads an authored file and refuses measured evidence without leaking remedy text", async () => {
    const record = openPathRecord(binding.epochDir, "linux-read");
    const authored = join(binding.iterationDir, "slug", "correctness-model", "brief.json");
    const allowed = await runIsolated(policy, record, {
      capability: "read",
      mode: "read",
      command: "/bin/cat",
      args: [authored],
      cwd: binding.iterationDir,
      paths: [authored],
    });
    expect(allowed.status).toBe(0);
    expect(allowed.stdout).toContain("authored");
    let refusal: unknown;
    try {
      await runIsolated(policy, record, {
        capability: "read",
        mode: "read",
        command: "/bin/cat",
        args: [join(binding.iterationDir, "census.json")],
        cwd: binding.iterationDir,
        paths: [join(binding.iterationDir, "census.json")],
      });
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(CandidateIsolationRefusal);
    if (!(refusal instanceof CandidateIsolationRefusal)) throw new Error("measured read was not refused");
    expect(refusal.message).not.toContain("remedy");
  });

  it("bounds a bash child to the workspace: the measured evidence reads empty and secrets are absent", async () => {
    const record = openPathRecord(binding.epochDir, "linux-bash");
    const outcome = await runIsolated(policy, record, {
      capability: "bash",
      mode: "exec",
      command: "/bin/sh",
      args: [
        "-lc",
        `cat ${join(binding.iterationDir, "census.json")} 2>&1; cat ${join(repoRoot, ".env")} 2>&1; cat ${join(repoRoot, "node_modules", "pkg", ".npmrc")} 2>&1`,
      ],
      cwd: binding.iterationDir,
      paths: [binding.iterationDir],
      env: {},
      osRefusalIsOutcome: true,
    });
    // census.json is overmounted with /dev/null → empty; the repoRoot .env sits outside the
    // namespace under the tmpfs scratch → absent; the .npmrc token inside the bound toolchain root
    // is overmounted by the name-based secret walk → absent.
    expect(outcome.stdout).not.toContain("remedy");
    expect(outcome.stdout).not.toContain("SECRET=1");
    expect(outcome.stdout).not.toContain("NPMSECRETTOKEN");
  });
});

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
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { homedir, tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { preflightPiBuilt } from "../src/backends/pi-built.ts";
import { type SessionProfileEvidence, composedIsolation } from "../src/backends/session-isolation.ts";
import { type IsolationProbeEvidence, disclosedIsolation } from "../src/backends/isolation-evidence.ts";
import { builtSolveIsolation } from "../src/run/built-agent-runtime.ts";
import { EnvironmentRefusal } from "../src/backends/environment-refusal.ts";
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
import { runtimeProcess } from "../src/meta/process.ts";

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
  it("denies the repository and whole operator home, reopening only explicit runtimes", () => {
    const repoRoot = workRepo();
    const policy = solveIsolationPolicy({ repoRoot });
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
    const real = solveIsolationPolicy({ repoRoot });
    const open = solveIsolationPolicy({ repoRoot, liftDeniesCovering: join(repoRoot, "canary.txt") });
    if ("unsupported" in real || "unsupported" in open) throw new Error("this host cannot run the isolation");
    expect(open.deniedReadRoots.length).toBeLessThan(real.deniedReadRoots.length);
    expect(open.policyHash).not.toBe(real.policyHash);
    // Lifting the repository restriction must preserve the separate home restriction.
    expect(open.deniedReadRoots).toContain(homedir());
  });

  // A read restriction names a path. Measured 2026-07-27 against the profile this module emitted
  // before `seatbelt-path-guard.ts`: the direct read was refused, renaming the denied directory was
  // refused, but renaming its parent succeeded and returned the canary at exit 0. These assertions
  // are the structural half of the fix; the executed half is the fixture's fourth check.
  it("denies the rename of every protected root's ancestors, so a deny cannot be relocated", () => {
    const repoRoot = workRepo();
    const policy = solveIsolationPolicy({ repoRoot });
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
    const again = solveIsolationPolicy({ repoRoot });
    if ("unsupported" in again) throw new Error("this host cannot run the isolation");
    expect(again.profile).toBe(policy.profile);
    expect(again.policyHash).toBe(policy.policyHash);
  });

  it("refuses to create an isolation policy on an unsupported platform", () => {
    // This policy supports neither Seatbelt nor bubblewrap on win32.
    const policy = solveIsolationPolicy({ repoRoot: workRepo(), runtime: { platform: "win32" } });
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
    const policy = solveIsolationPolicy({ repoRoot, readAllowRoots: [runtimeRoot] });
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
    const evidence = probeHostSolveReadDeny({ repoRoot });
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
    const policy = solveIsolationPolicy({ repoRoot });
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
    const evidence = probeHostSolveReadDeny({ repoRoot: workRepo(), runtime: { platform: "win32" } });
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

describe("composition: a probe certifies only its own family's session", () => {
  const repoRoot = "/tmp/ana-fixture-repo";
  const hostProbe: IsolationProbeEvidence = {
    fixture: HOST_SOLVE_ISOLATION_FIXTURE,
    available: true,
    isolated: true,
    deniedReadRefused: true,
    controlReadSucceeded: true,
    discriminationReadSucceeded: true,
    profileDigest: "d".repeat(64),
    evidence: ["executed"],
  };
  const bwrapProbe: IsolationProbeEvidence = { ...hostProbe, fixture: HOST_BWRAP_SOLVE_ISOLATION_FIXTURE };
  const hostSession: SessionProfileEvidence = {
    role: "built",
    model: "m1",
    reasoningEffort: "medium",
    providerVersion: null,
    activePermissionProfile: HOST_SOLVE_ISOLATION_PROFILE_ID,
    policyHash: "d".repeat(64),
    confinedPid: runtimeProcess.pid + 1,
    controllerPid: runtimeProcess.pid,
  };

  it("accepts host isolation only when the session used the probed policy bytes", () => {
    expect(composedIsolation(hostProbe, hostSession)).toBe("physical");
    expect(composedIsolation(bwrapProbe, hostSession)).toBe("physical");
    expect(composedIsolation(hostProbe, { ...hostSession, policyHash: "e".repeat(64) })).toBe("contractual");
    const { policyHash: _dropped, ...noBytes } = hostSession;
    expect(composedIsolation(hostProbe, noBytes)).toBe("contractual");
    expect(composedIsolation({ ...hostProbe, profileDigest: null }, hostSession)).toBe("contractual");
  });

  it("refuses a session that activated another profile, and a retired family's probe", () => {
    expect(
      composedIsolation(hostProbe, { ...hostSession, activePermissionProfile: "harness-runtime-isolated" }),
    ).toBe("contractual");
    // Recorded evidence from the removed Codex family no longer certifies anything.
    // The retired fixture id is outside the union, as a parsed old record would carry it.
    const retired: IsolationProbeEvidence = JSON.parse(
      JSON.stringify({ ...hostProbe, fixture: "codex-read-deny/v2" }),
    );
    expect(composedIsolation(retired, hostSession)).toBe("contractual");
  });

  // PR399 removed the runtime-fact preflight, which left this the pre-Builder refusal for a host
  // with no isolation mechanism. A plain Error would record `abortClause: null`; the typed class is
  // what prepareControllerTerminal reads as environment-blocked.
  it("refuses a host without an isolation mechanism as a typed environment refusal", () => {
    expect(() => builtSolveIsolation(workRepo(), [], { platform: "win32" })).toThrow(EnvironmentRefusal);
  });

  it("returns the supporting host's policy bytes", () => {
    expect(builtSolveIsolation(workRepo()).policyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each(["claude-opus-5", "claude-fable-5-1"])(
    "runs the exact Pi Built worker under the host isolation for %s",
    async (model) => {
      const policy = builtSolveIsolation(repoRoot);
      const session = await preflightPiBuilt({
        profile: {
          provider: "anthropic",
          transport: "claude",
          model,
          thinkingLevel: "medium",
        },
        auth: async () => ({ type: "bearer", token: "fake-pi-built-test-token" }),
        policy,
      });
      expect(session.role).toBe("built");
      expect(session.policyHash).toBe(policy.policyHash);
      // The preflight starts a real child under this policy and records its separate process id.
      expect(session.confinedPid).toBeGreaterThan(0);
      expect(session.controllerPid).toBe(runtimeProcess.pid);
      expect(session.confinedPid).not.toBe(runtimeProcess.pid);
      expect(session.modelSelection).toEqual({
        resolvedModel: model,
        effort: "medium",
        source: "pi-provider-catalogue",
      });
      // Composition compares the session policy hash with the supplied probe hash. The executed
      // probe tests above separately check that the policy enforces the intended restrictions.
      expect(composedIsolation({ ...hostProbe, profileDigest: policy.policyHash }, session)).toBe("physical");
      await expect(
        preflightPiBuilt({
          profile: { provider: "anthropic", transport: "claude", model, thinkingLevel: "off" },
          auth: async () => ({ type: "bearer", token: "fake-pi-built-test-token" }),
          policy,
        }),
      ).rejects.toThrow("unsupported reasoning effort: off");
    },
  );

  it("refuses host isolation without evidence of a separate confined process", () => {
    // A library-style agent loop (pi-agent-core, @opencode-ai/sdk-next) runs the model's tools in
    // the controller's own process, so there is no second pid to witness. Whatever the probe
    // proved about the mechanism, the session still needs evidence of its own confinement.
    const { confinedPid: _dropped, ...noBoundary } = hostSession;
    expect(composedIsolation(hostProbe, noBoundary)).toBe("contractual");
    expect(
      composedIsolation(hostProbe, {
        ...hostSession,
        confinedPid: runtimeProcess.pid,
        controllerPid: runtimeProcess.pid,
      }),
    ).toBe("contractual");
  });
});

// The isolation disclosure requires every probe condition to hold. A `physical` label alone
// is insufficient; without a probe, the reader reports `contractual`. These checks exercise
// that classification using complete and deliberately incomplete evidence fixtures.
describe("disclosedIsolation: physical only from the executed conjunction", () => {
  const provenIsolation: IsolationProbeEvidence = {
    fixture: HOST_SOLVE_ISOLATION_FIXTURE,
    available: true,
    isolated: true,
    deniedReadRefused: true,
    controlReadSucceeded: true,
    discriminationReadSucceeded: true,
    evidence: ["denied read refused", "control read succeeded", "deny-lifted read succeeded"],
  };

  it("accepts the full conjunction and nothing less", () => {
    expect(disclosedIsolation(provenIsolation)).toBe("physical");
    expect(disclosedIsolation(undefined)).toBe("contractual");
    // Each check of the conjunction is individually required.
    expect(disclosedIsolation({ ...provenIsolation, available: false })).toBe("contractual");
    expect(disclosedIsolation({ ...provenIsolation, isolated: false })).toBe("contractual");
    expect(disclosedIsolation({ ...provenIsolation, deniedReadRefused: false })).toBe("contractual");
    // If the permitted control read also fails, the probe has not distinguished the intended
    // restriction from a mechanism that prevents all reads.
    expect(disclosedIsolation({ ...provenIsolation, controlReadSucceeded: false })).toBe("contractual");
    // A refusal the deny-lifted profile cannot reverse is not attributable to the deny rules.
    expect(disclosedIsolation({ ...provenIsolation, discriminationReadSucceeded: false })).toBe(
      "contractual",
    );
  });
});

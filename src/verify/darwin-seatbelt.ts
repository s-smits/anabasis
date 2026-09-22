import { existsSync, lstatSync, readFileSync, realpathSync } from "../meta/filesystem.ts";
import { dirname, isAbsolute, join } from "../meta/path.ts";
import type { RuntimePlatform } from "../meta/runtime-values.ts";
import { sha256, sha256OfFile } from "../meta/digest.ts";
import { hashJsonBytes } from "../meta/json-runtime.ts";

import { compareCodeUnits, hashJsonValue } from "../meta/stable-json.ts";
import { darwinRuntimeReadPaths } from "./darwin-runtime-closure.ts";
import type { VerifierConfinementRequest } from "./verifier-port.ts";
import {
  type ReadRootMetadata,
  sameReadRootMetadata,
  snapshotReadRootPath,
} from "./read-root-attestation.ts";
import {
  type ExactReadSnapshot,
  exactFileReadPaths,
  attestedInputDrift,
  type ExactReadDrift,
  exactReadDrift,
  exactSymlinkMetadataPaths,
  isRegularFile,
  mechanismDrift,
  snapshotExactReads,
} from "./exact-read-attestation.ts";
import {
  isOverbroadSandboxReadRoot,
  ancestorDirectories,
  SEATBELT_BASELINE,
  darwinPlatformReadRoots,
  darwinUserTempRoot,
  userTempChildTreeRules,
  verifierTempSiblingDenyRules,
  surroundingSandbox,
} from "./wall-policy.ts";
import { type IsolationPosture, seatbeltProfile } from "./isolation-description.ts";
import { canonicalForms, sbRule } from "./seatbelt-path-guard.ts";
import { runtimeProcess } from "../meta/process.ts";

export const DARWIN_SEATBELT_ID = "darwin-seatbelt/v1" as const;
export const DARWIN_SANDBOX_EXEC = "/usr/bin/sandbox-exec";
const DARWIN_SYSTEM_PROFILE = "/System/Library/Sandbox/Profiles/system.sb";

export interface DarwinSeatbeltRuntime {
  platform?: RuntimePlatform;
  sandboxExecPath?: string;
  systemProfilePath?: string;
  /** A surrounding sandbox is not verifier-specific proof. Nested Seatbelt application also
   *  fails on macOS, so this condition must refuse rather than silently run unwrapped. */
  outerSandboxed?: boolean;
}

interface DarwinSeatbeltSupport {
  ok: boolean;
  reason: string | null;
  /** The Darwin `sandbox-exec` wrapper and its exact bytes. */
  mechanismPath: string;
  mechanismDigest: string | null;
  /** Digest of the imported `system.sb` closure, the Darwin isolation's baseline. */
  baselineDigest: string | null;
}

interface DarwinSeatbeltPlan {
  command: string;
  args: string[];
  policyHash: string;
  profile: string;
  workdir: string;
  support: {
    mechanismPath: string;
    mechanismDigest: string;
    baselineDigest: string;
  };
  exactReadSnapshots: ExactReadSnapshot[];
  readRoots: string[];
}

interface ProfileClosure {
  digest: string;
  /** Every profile file, by canonical path. */
  files: string[];
  /** Every `(import ...)` edge: the path the directive names, and the file it resolved to. */
  imports: Array<{ imported: string; canonical: string }>;
}

interface RememberedSupport {
  /** The wrapper and every profile file, by canonical path, as they were when hashed. */
  files: ReadRootMetadata[];
  imports: ProfileClosure["imports"];
  support: DarwinSeatbeltSupport;
}

interface PreparedVerifierReads {
  command: string;
  workdir: string;
  reads: string[];
  exactReadSnapshots: ExactReadSnapshot[];
  readRoots: string[];
}

/** Shared network and process restrictions for both mechanisms. The verifier decides whether an
 *  answer is correct, so it stays offline: network access could fetch or disclose protected data.
 *  External-tool evidence also depends on the host recording the tool requests it executes. */
export const VERIFIER_POSTURE: IsolationPosture = { network: false };

/** The last attested support per wrapper and profile pair. The support is resolved for every
 *  confined child, so one census of 50 controls hashed the wrapper and the profile closure 50 times.
 *  It is reused while the wrapper and the entry profile still resolve to the same files, every
 *  hashed file keeps identical complete metadata (device, inode, mode, size, mtime, ctime: the
 *  rule `readFileDigest` applies to single files) and every import directive still resolves to the
 *  file it was read from, so a swapped directory link under an unchanged file is attested again. */
const SUPPORT_BY_RUNTIME = new Map<string, RememberedSupport>();

function sandboxProfileClosure(entryPath: string): ProfileClosure {
  const visited = new Set<string>();
  const records: Array<{ path: string; sha256: string }> = [];
  const imports: ProfileClosure["imports"] = [];
  const visit = (path: string): void => {
    const canonical = realpathSync.native(path);
    if (visited.has(canonical)) return;
    if (!isRegularFile(canonical)) throw new Error("an imported Seatbelt profile is unavailable");
    visited.add(canonical);
    const bytes = readFileSync(canonical);
    records.push({ path: canonical, sha256: sha256(bytes) });
    const source = bytes.toString("utf8");
    for (const match of source.matchAll(/\(import\s+"([^"]+)"\)/g)) {
      const name = match[1];
      if (name === undefined) continue;
      const imported = isAbsolute(name) ? name : join(dirname(canonical), name);
      imports.push({ imported, canonical: realpathSync.native(imported) });
      visit(imported);
    }
  };
  visit(entryPath);
  return {
    digest: hashJsonValue(
      records.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
    ),
    files: [...visited],
    imports,
  };
}

function supportStillCurrent(
  remembered: RememberedSupport,
  sandboxExecPath: string,
  systemProfilePath: string,
): boolean {
  try {
    return (
      realpathSync.native(sandboxExecPath) === remembered.support.mechanismPath &&
      realpathSync.native(systemProfilePath) === remembered.files[1]?.path &&
      remembered.files.every((file) => sameReadRootMetadata(file, snapshotReadRootPath(file.path))) &&
      remembered.imports.every(({ imported, canonical }) => realpathSync.native(imported) === canonical)
    );
  } catch {
    return false;
  }
}

function attestedSupport(sandboxExecPath: string, systemProfilePath: string): DarwinSeatbeltSupport {
  const key = `${sandboxExecPath}\0${systemProfilePath}`;
  const remembered = SUPPORT_BY_RUNTIME.get(key);
  if (remembered !== undefined && supportStillCurrent(remembered, sandboxExecPath, systemProfilePath)) {
    return remembered.support;
  }
  const mechanismPath = realpathSync.native(sandboxExecPath);
  const closure = sandboxProfileClosure(systemProfilePath);
  const support: DarwinSeatbeltSupport = {
    ok: true,
    reason: null,
    mechanismPath,
    mechanismDigest: sha256OfFile(mechanismPath),
    baselineDigest: closure.digest,
  };
  SUPPORT_BY_RUNTIME.set(key, {
    files: [mechanismPath, ...closure.files].map(snapshotReadRootPath),
    imports: closure.imports,
    support,
  });
  return support;
}

/** Check support without a model call. Reasons omit paths to keep the operator's filesystem
 *  layout out of CLI diagnostics. Hash the wrapper and every imported profile because
 *  `(import "system.sb")` alone is not a stable policy identity across OS updates. */
export function darwinSeatbeltSupport(runtime: DarwinSeatbeltRuntime = {}): DarwinSeatbeltSupport {
  const sandboxExecPath = runtime.sandboxExecPath ?? DARWIN_SANDBOX_EXEC;
  const systemProfilePath = runtime.systemProfilePath ?? DARWIN_SYSTEM_PROFILE;
  const outerSandboxed = runtime.outerSandboxed ?? surroundingSandbox(Bun.env);
  const unavailable = (reason: string): DarwinSeatbeltSupport => ({
    ok: false,
    reason,
    mechanismPath: sandboxExecPath,
    mechanismDigest: null,
    baselineDigest: null,
  });
  if ((runtime.platform ?? runtimeProcess.platform) !== "darwin") {
    return unavailable("Darwin Seatbelt is unavailable on this platform");
  }
  if (outerSandboxed) {
    return unavailable(
      "a surrounding sandbox is not verifier-specific isolation and nested Seatbelt is unsupported",
    );
  }
  if (!isRegularFile(sandboxExecPath) || !isRegularFile(systemProfilePath)) {
    return unavailable("the Darwin Seatbelt executable or imported system profile is unavailable");
  }
  try {
    return attestedSupport(sandboxExecPath, systemProfilePath);
  } catch {
    return unavailable("the Darwin Seatbelt mechanism or imported profile closure cannot be attested");
  }
}

// Both OS implementations use these path checks and the shared read snapshots below. They
// resolve directories, refuse overly broad roots and retain the selected executable path.
// Sharing preparation keeps Linux and Darwin subject to the same input restrictions;
// the error messages therefore name the sandbox rather than a particular OS mechanism.
function canonicalExistingDirectory(path: string): string {
  if (!isAbsolute(path)) throw new Error("sandbox readable roots must be absolute");
  if (!existsSync(path) || !lstatSync(path).isDirectory()) {
    throw new Error("a sandbox readable root is missing or is not a directory");
  }
  const canonical = realpathSync.native(path);
  if (isOverbroadSandboxReadRoot(canonical)) {
    throw new Error("a sandbox readable root resolves to an over-broad host root");
  }
  return canonical;
}

function existingFilePath(path: string): string | null {
  if (!isAbsolute(path) || !isRegularFile(path)) return null;
  return path;
}

/**
 * The concrete OS policy differs by platform, but both verifier isolations need the same immutable
 * inputs: the selected command name, a private workdir, declared read roots, and exact delegated files.
 * Keep their snapshot construction in one place so either mechanism cannot accidentally admit a
 * lexical path the other re-attests, or turn an unavailable attested file into a platform-specific
 * outcome. `runtimeReadPaths` is Darwin's Mach-O closure hook; Bubblewrap supplies no extras.
 */
export function prepareVerifierReads(
  input: VerifierConfinementRequest,
  unresolvedCommand: string,
  runtimeReadPaths: (command: string) => readonly string[] = () => [],
): PreparedVerifierReads | { unsupported: string } {
  // Exact-read snapshots bind lexical links and target bytes. Execution must retain the
  // selected name: equivalent hardlink bytes can dispatch to different tools (cc/git).
  const command = existingFilePath(input.resolvedCommand);
  if (command === null) return { unsupported: unresolvedCommand };
  const workdir = canonicalExistingDirectory(input.workdir);
  const readRoots = [...new Set(input.sandboxReadRoots.map(canonicalExistingDirectory))].sort(
    compareCodeUnits,
  );
  const attestedReads = input.attestedFiles.map((path) => {
    if (existingFilePath(path) === null) throw new Error("a sandbox attested file is unavailable");
    return path;
  });
  const exactReadSnapshots = snapshotExactReads([command, ...attestedReads, ...runtimeReadPaths(command)]);
  const reads = exactFileReadPaths(exactReadSnapshots);
  return {
    command,
    workdir,
    reads,
    exactReadSnapshots,
    readRoots,
  };
}

/** Re-attest every external byte the policy and verifier execution depend on. Preparation owns
 * the first snapshot; the host calls this after the policy-application canary immediately before
 * spawn and again after the process closes. Persistent drift can therefore never write a verdict
 * under stale evidence identity. */
export function verifyDarwinSeatbeltPlan(
  plan: DarwinSeatbeltPlan,
  runtime: DarwinSeatbeltRuntime = {},
): ExactReadDrift | null {
  // `sandbox-exec` and the imported system profile sit on the read-only system volume, which is
  // exactly where the failed syscall of 2026-09-03 refused a battery as drift: a support failure
  // there is unavailable, not changed.
  return (
    mechanismDrift(
      darwinSeatbeltSupport(runtime),
      plan.support,
      "Darwin Seatbelt executable or imported profile closure",
    ) ?? attestedInputDrift(exactReadDrift(plan.exactReadSnapshots))
  );
}

/** Builds the verifier Seatbelt policy, binding its baseline, exact runtime closure, inputs and roots. */
export function prepareDarwinSeatbelt(
  input: VerifierConfinementRequest & {
    runtime?: DarwinSeatbeltRuntime;
    /** The platform roots fixed at host construction; a direct caller gets the live host list. */
    platformRoots?: string[];
  },
): DarwinSeatbeltPlan | { unsupported: string } {
  const support = darwinSeatbeltSupport(input.runtime);
  if (!support.ok || support.baselineDigest === null || support.mechanismDigest === null) {
    return { unsupported: support.reason ?? "Darwin Seatbelt is unavailable" };
  }
  // The system profile owns /System and /usr/lib; every other runtime image and loader link is
  // derived from the pinned command. Synthetic non-Darwin tests keep the structural path only.
  const prepared = prepareVerifierReads(
    input,
    "the verifier command cannot be resolved for Seatbelt",
    (command) => (runtimeProcess.platform === "darwin" ? darwinRuntimeReadPaths(command) : [command]),
  );
  if ("unsupported" in prepared) return prepared;
  const { command, workdir, reads, exactReadSnapshots, readRoots } = prepared;
  // The closure preserves metadata-only ancestor and symlink traversal without a package-prefix grant.
  const metadataAncestors = [workdir, ...reads, ...readRoots]
    .flatMap(ancestorDirectories)
    .filter((path) => path !== "/")
    .filter((path, index, all) => all.indexOf(path) === index)
    .sort();
  const metadataPaths = [
    ...new Set([...metadataAncestors, ...exactSymlinkMetadataPaths(exactReadSnapshots)]),
  ].sort();
  const platformRoots = input.platformRoots ?? darwinPlatformReadRoots();
  const configuredTemp = darwinUserTempRoot();
  const userTempRoots =
    configuredTemp === undefined ? [] : [...new Set(canonicalForms(configuredTemp))].sort();
  const policyIdentity = {
    schema: DARWIN_SEATBELT_ID,
    mechanism: {
      path: support.mechanismPath,
      sha256: support.mechanismDigest,
    },
    baseline: { import: SEATBELT_BASELINE, closureSha256: support.baselineDigest },
    default: "deny",
    network: VERIFIER_POSTURE.network ? "allow" : "deny",
    process: "allow-process-star-under-inherited-seatbelt",
    reads: {
      exact: exactReadSnapshots,
      roots: readRoots,
      platform: platformRoots,
      metadata: metadataPaths,
      privateWorkdir: true,
    },
    writes: { privateWorkdir: true, devNull: true, userTempChildren: userTempRoots },
  };
  const policyHash = hashJsonBytes(policyIdentity);
  const profile = seatbeltProfile({
    shared: {
      ...VERIFIER_POSTURE,
      metadata: { literals: metadataPaths },
      // The private workdir, the attested command and its delegated files, and the read roots the
      // engine declared. Nothing else: this wall decides correctness and must stay reproducible.
      reads: { literals: reads, subpaths: [workdir, ...platformRoots, ...readRoots] },
      writes: { subpaths: [workdir], literals: ["/dev/null"] },
    },
    seatbelt: {
      finalRules: [
        // Clang and Apple's python3 shim use the confstr temp root rather than TMPDIR. The grant
        // opens what a command creates there; the concurrent verifier workdirs beside it are then
        // closed by name, and the engine's own workdir is re-opened last.
        ...userTempChildTreeRules(userTempRoots),
        ...verifierTempSiblingDenyRules(),
        ...sbRule("allow file-read* file-read-metadata file-write*", "subpath", [workdir]),
      ],
    },
  });
  return {
    command: support.mechanismPath,
    args: ["-p", profile, command, ...input.engineArgs],
    policyHash,
    profile,
    workdir,
    support: {
      mechanismPath: support.mechanismPath,
      mechanismDigest: support.mechanismDigest,
      baselineDigest: support.baselineDigest,
    },
    exactReadSnapshots,
    readRoots,
  };
}

/** Policy-application probe reused by preflight and immediately before live spawn. It proves
 * Seatbelt accepted this profile, not that the configured verifier itself is healthy. The target
 * is host-chosen and inert; the engine cannot supply the probe's result. */
export async function applyDarwinSeatbeltPlan(
  plan: DarwinSeatbeltPlan,
  timeoutMs = 5_000,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const code = await Bun.spawn({
      cmd: [plan.command, "-p", plan.profile, "/usr/bin/true"],
      cwd: plan.workdir,
      env: {},
      timeout: timeoutMs,
      killSignal: "SIGKILL",
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    }).exited;
    return code === 0
      ? { ok: true }
      : { ok: false, reason: "the Darwin Seatbelt policy could not be applied" };
  } catch {
    return { ok: false, reason: "the Darwin Seatbelt policy could not be applied" };
  }
}

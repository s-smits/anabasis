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
  /** A surrounding sandbox is not verifier-specific isolation and Seatbelt cannot nest, so support refuses. */
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

/** The verifier's posture on both mechanisms: offline, since network access could fetch or
 *  disclose protected data and would escape the host's record of tool requests. */
export const VERIFIER_POSTURE: IsolationPosture = { network: false };

/** The last attested support per wrapper and profile pair, resolved for every confined child. It is
 *  reused while the wrapper and entry profile resolve to the same files, every hashed file keeps
 *  identical complete metadata, and every import still resolves to the file it was read from. */
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

/** Checks support without a model call; reasons omit paths to keep host layout out of diagnostics.
 *  The wrapper and every imported profile are hashed, since `system.sb` changes across OS updates. */
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

// Shared by both OS mechanisms, so the messages name the sandbox rather than one mechanism.
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
 * The immutable inputs both verifier isolations need: the selected command, a private workdir,
 * declared read roots and exact delegated files, snapshotted in one place so the mechanisms admit
 * the same paths. `runtimeReadPaths` is Darwin's Mach-O closure hook.
 */
export function prepareVerifierReads(
  input: VerifierConfinementRequest,
  unresolvedCommand: string,
  runtimeReadPaths: (command: string) => readonly string[] = () => [],
): PreparedVerifierReads | { unsupported: string } {
  // Keep the selected name: identical hardlink bytes can dispatch to different tools (cc/git).
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

/** Re-attests every external byte the policy and execution depend on. The host calls this just
 *  before spawn and again after the process closes, so no verdict is written under stale identity. */
export function verifyDarwinSeatbeltPlan(
  plan: DarwinSeatbeltPlan,
  runtime: DarwinSeatbeltRuntime = {},
): ExactReadDrift | null {
  // A support failure on the read-only system volume is `unavailable`, not a changed byte.
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
  // The system profile covers /System and /usr/lib; other runtime images come from the pinned
  // command's closure. Non-Darwin tests keep the command alone.
  const prepared = prepareVerifierReads(
    input,
    "the verifier command cannot be resolved for Seatbelt",
    (command) => (runtimeProcess.platform === "darwin" ? darwinRuntimeReadPaths(command) : [command]),
  );
  if ("unsupported" in prepared) return prepared;
  const { command, workdir, reads, exactReadSnapshots, readRoots } = prepared;
  // Metadata-only grants let ancestors and symlinks be traversed without a package-prefix grant.
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
      // Only the workdir, attested files and declared roots, so the wall stays reproducible.
      reads: { literals: reads, subpaths: [workdir, ...platformRoots, ...readRoots] },
      writes: { subpaths: [workdir], literals: ["/dev/null"] },
    },
    seatbelt: {
      finalRules: [
        // Clang and Apple's python3 shim use the confstr temp root rather than TMPDIR. Open it, close
        // concurrent verifier workdirs by name, then re-open this engine's own workdir.
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

/** Proves Seatbelt accepts this profile by running the host-chosen inert `/usr/bin/true` under it;
 *  says nothing about the verifier's own health. */

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

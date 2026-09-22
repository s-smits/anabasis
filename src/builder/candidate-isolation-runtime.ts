/**
 * Runs one guarded operation under the host isolation and records a path row for each path it
 * touches. Darwin uses the Seatbelt profile from candidate-isolation-profile.ts; Linux uses a
 * Bubblewrap mount namespace with read-only roots, a read-write cell and overmounted protected
 * nodes. The recorded profile digest names the mechanism, so the two are never confused.
 */
import { existsSync, readdirSync, realpathSync, statSync } from "../meta/filesystem.ts";
import { isAbsolute, join, relative, sep } from "../meta/path.ts";
import { hashJsonBytes } from "../meta/json-runtime.ts";
import type { RuntimeSignal } from "../meta/runtime-values.ts";
import {
  bwrapBaselineArgs,
  bwrapEnvironmentArgs,
  bwrapReadBinds,
  bwrapTmpfsDenies,
  bwrapWriteBinds,
} from "../verify/linux-bwrap.ts";
import { type OsIsolationRuntime, osIsolationSupport } from "../verify/os-isolation.ts";
import {
  type ReadRootMetadata,
  sameReadRootMetadata,
  snapshotReadRootPath,
} from "../verify/read-root-attestation.ts";
import {
  BUILDER_SECRET_PATH_PATTERNS,
  type CandidateAccessPolicy,
  type IsolationMode,
  guardPath,
} from "./candidate-isolation.ts";
import { candidateIsolationProfile } from "./candidate-isolation-profile.ts";
import type { PathRecord } from "./path-record.ts";
import type { OptionalEnvValues } from "../backends/scrub-env.ts";
import { killProcessGroup } from "../meta/subprocess.ts";

export { type PathRecord, type PathRecordRow, openPathRecord, readPathRecordRows } from "./path-record.ts";

export interface IsolatedRequest {
  capability: string;
  mode: IsolationMode;
  command: string;
  args: string[];
  cwd: string;
  /** Every path this operation touches; each is guarded and gets a record row. */
  paths: string[];
  env?: OptionalEnvValues;
  /** Standard input, kept out of argv and the path record; the caller records its digest. */
  stdin?: string;
  /** Controller-staged files admitted as exact read literals in the OS profile, not via the guard. */
  controllerReadFiles?: string[];
  /** Set by exec capabilities: an OS refusal on a path the guard never checked is the command's
   *  own outcome. Unset, an OS refusal of a guard-allowed path throws as an isolation defect. */
  osRefusalIsOutcome?: boolean;
  /** Deadline after which the process group is killed; defaults to `ISOLATED_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** The caller's abort: the group is killed when it fires, as at the deadline. */
  signal?: AbortSignal | undefined;
}

const ISOLATED_OUTPUT_MAX = 4 * 1024 * 1024;
export const ISOLATED_TIMEOUT_MS = 10 * 60_000;

export interface IsolatedOutcome {
  stdout: string;
  stderr: string;
  /** True when the controller capture limit discarded later child output. */
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  status: number | null;
  signal: RuntimeSignal | null;
  timedOut: boolean;
}

/** Optional stdin, deadline and abort signal for a collected run. */
type CollectedRun = {
  readonly stdin?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
};

/** The Bubblewrap identity fields bound into a plan digest. */
interface LinuxIsolationSupport {
  mechanismId: string;
  mechanismDigest: string | null;
  baselineDigest: string | null;
}

/** One directory's deny decisions under one policy, reused while the directory's own metadata is
 *  unchanged so the walk does not grow with every confined call. An entry change moves the mtime;
 *  deeper changes are seen by the child directory's own listing. */
interface RememberedListing {
  metadata: ReadRootMetadata;
  denyDirs: string[];
  denyFiles: string[];
  children: string[];
}

/** The Bubblewrap argv and its digest. The digest binds the policy and mechanism, not the argv,
 *  so it stays stable while the mount list follows the files that currently exist. */
interface LinuxCandidatePlan {
  argv: string[];
  profileDigest: string;
}

type IsolatedPathDecision = { requested: string; decision: ReturnType<typeof guardPath> };

/** What the OS did with an allowed request. */
type IsolatedRunEvidence = {
  readonly profileDigest: string;
  readonly enforcement: "os-refused" | "os-allowed";
  readonly stdout: string;
};

const LISTINGS_BY_POLICY = new Map<string, RememberedListing>();

/** A guard refusal or a guard/OS disagreement, with a model-actionable message. */
export class CandidateIsolationRefusal extends Error {}
/** The enforcement mechanism is unavailable; the campaign refuses, nothing runs degraded. */
export class CandidateIsolationUnavailable extends Error {}

/** Recognise likely OS refusals; a non-zero exit alone may be a normal result, such as rg's no-match 1. */
function looksOsRefused(status: number | null, stderr: string): boolean {
  return status !== 0 && /operation not permitted|sandbox/i.test(stderr);
}

/** Resolves a relative command against the PATH the process will run with: the request's
 *  environment when it declares one, otherwise the controller's. */
function resolveCommandPath(command: string, env: OptionalEnvValues | undefined): string {
  if (isAbsolute(command)) return realpathSync.native(command);
  const hit = ((env === undefined ? Bun.env.PATH : env.PATH) ?? "")
    .split(":")
    .filter((dir) => dir !== "")
    .map((dir) => join(dir, command))
    .find(existsSync);
  if (hit === undefined) {
    throw new CandidateIsolationUnavailable(`command not found for isolated execution: ${command}`);
  }
  return realpathSync.native(hit);
}

const liveCommands = new Set<Bun.Subprocess>();

/** Kills every isolated command still running. Children run in their own process groups, so a
 *  signal to the controller does not reach them. */
export function stopIsolatedCommands(): void {
  for (const child of liveCommands) killProcessGroup(child, "SIGKILL");
}

/** Spawns a command with capped capture and a group-kill deadline. Also used by the microvm
 *  workshop runner. */
export async function spawnCollected(
  command: string,
  args: string[],
  cwd: string,
  env: OptionalEnvValues,
  run: CollectedRun = {},
): Promise<IsolatedOutcome> {
  const { stdin, signal } = run;
  const timeoutMs = run.timeoutMs ?? ISOLATED_TIMEOUT_MS;
  // Detached into its own group so a timeout kills grandchildren too.
  const child = Bun.spawn({
    cmd: [command, ...args],
    cwd,
    env,
    stdin: stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  });
  liveCommands.add(child);
  const collect = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    let text = "";
    let truncated = false;
    for await (const chunk of stream) {
      const incoming = decoder.decode(chunk);
      const room = Math.max(0, ISOLATED_OUTPUT_MAX - text.length);
      if (incoming.length > room) truncated = true;
      if (room > 0) text += incoming.slice(0, room);
    }
    return { text, truncated };
  };
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killProcessGroup(child, "SIGKILL");
  }, timeoutMs);
  const abort = () => killProcessGroup(child, "SIGKILL");
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted === true) abort();
  const input = async () => {
    if (stdin === undefined) return;
    const sink = child.stdin;
    if (sink === undefined) {
      throw new Error("isolated child process did not expose its declared standard input");
    }
    await sink.write(stdin);
    await sink.end();
  };
  try {
    const [status, stdout, stderr] = await Promise.all([
      child.exited,
      collect(child.stdout),
      collect(child.stderr),
      input(),
    ]);
    return {
      stdout: stdout.text,
      stderr: stderr.text,
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
      status,
      signal: child.signalCode ?? null,
      timedOut,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    killProcessGroup(child, "SIGKILL");
    await child.exited;
    liveCommands.delete(child);
  }
}

function isUnderPath(path: string, root: string): boolean {
  const rel = relative(root, path);
  return path === root || (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Collects the nodes a Bubblewrap mount must hide under `root`. A denied directory prunes its
 * subtree; a denied file is later replaced by /dev/null. The caller supplies the deny predicate.
 */
function collectDeniedNodes(
  policyDigest: string,
  root: string,
  denied: (path: string) => boolean,
  denyDirs: string[],
  denyFiles: string[],
): void {
  const key = `${policyDigest}\0${root}`;
  let listing: RememberedListing;
  try {
    const metadata = snapshotReadRootPath(root);
    const remembered = LISTINGS_BY_POLICY.get(key);
    if (remembered !== undefined && sameReadRootMetadata(remembered.metadata, metadata)) {
      listing = remembered;
    } else {
      listing = { metadata, denyDirs: [], denyFiles: [], children: [] };
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        const full = join(root, entry.name);
        if (entry.isDirectory()) (denied(full) ? listing.denyDirs : listing.children).push(full);
        else if (entry.isFile() && denied(full)) listing.denyFiles.push(full);
      }
      // A root reached through a link is listed fresh each time: its metadata is the link's.
      if (metadata.kind === "directory") LISTINGS_BY_POLICY.set(key, listing);
    }
  } catch {
    return;
  }
  denyDirs.push(...listing.denyDirs);
  denyFiles.push(...listing.denyFiles);
  for (const child of listing.children) collectDeniedNodes(policyDigest, child, denied, denyDirs, denyFiles);
}

/** Collects what must be hidden inside the bound roots: under the epoch directory the full guard
 *  decides; elsewhere in the repository only the secret and `.git` name checks, which are cheaper. */
function deniedMounts(
  policy: CandidateAccessPolicy,
  binds: readonly string[],
  present: (path: string) => boolean,
) {
  const denyDirs: string[] = [];
  const denyFiles: string[] = [];
  for (const root of binds) {
    if (isUnderPath(root, policy.epochDir)) {
      collectDeniedNodes(
        policy.digest,
        root,
        (path) => guardPath(policy, "read", "read", path).decision === "deny",
        denyDirs,
        denyFiles,
      );
    } else if (isUnderPath(root, policy.repoRoot)) {
      collectDeniedNodes(
        policy.digest,
        root,
        (path) => {
          const posix = relative(policy.repoRoot, path).split(sep).join("/");
          return (
            BUILDER_SECRET_PATH_PATTERNS.some((pattern) => pattern.test(posix)) ||
            posix === ".git" ||
            posix.startsWith(".git/")
          );
        },
        denyDirs,
        denyFiles,
      );
    }
  }
  const tmpfsDenies = [...new Set([...policy.readDenyRoots, ...denyDirs])].filter(present).sort();
  return { tmpfsDenies, fileDenies: [...new Set(denyFiles)].filter(present).sort() };
}

export function linuxCandidatePlan(
  policy: CandidateAccessPolicy,
  mode: IsolationMode,
  support: LinuxIsolationSupport,
  extraReadPaths: readonly string[],
  environment: OptionalEnvValues = {},
): LinuxCandidatePlan {
  // A host scratch root becomes a fresh tmpfs so other runs' files stay hidden. The tmpfs goes
  // first, so a repository cell under a scratch root is re-exposed by its later bind.
  const underRepo = (path: string) => isUnderPath(path, policy.repoRoot);
  const scratchRoots = mode === "read" ? [] : [...new Set(policy.scratchWriteRoots)].filter(existsSync);
  const scratchTmpfs = scratchRoots.filter((root) => !underRepo(root)).sort();
  const writeRuleRoots =
    mode === "read"
      ? []
      : [...policy.allow.write.map((rule) => rule.path), ...scratchRoots.filter(underRepo)];
  const writeBinds = [...new Set(writeRuleRoots)].filter(existsSync).sort();
  const writeSet = new Set(writeBinds);
  const readRuleRoots = [
    ...policy.allow.read.map((rule) => rule.path),
    ...(mode === "read" ? [] : policy.allow.write.map((rule) => rule.path)),
    ...extraReadPaths,
  ];
  const readBinds = [...new Set(readRuleRoots)]
    .filter((path) => existsSync(path) && !writeSet.has(path))
    .sort();
  // A write-deny root stays readable, as under Seatbelt: the workspace node_modules carries the
  // @ana links `bun test` resolves through, so it is re-bound read-only rather than hidden.
  const readOnlyBinds = mode === "read" ? [] : policy.writeDenyRoots.filter(existsSync);
  const { tmpfsDenies, fileDenies } = deniedMounts(policy, [...readBinds, ...writeBinds], existsSync);
  const argv = [
    ...bwrapBaselineArgs({ network: policy.network !== "deny" }),
    ...scratchTmpfs.flatMap((root) => ["--tmpfs", root]),
    ...bwrapReadBinds(readBinds),
    ...bwrapWriteBinds(writeBinds),
    ...bwrapReadBinds(readOnlyBinds),
    ...bwrapTmpfsDenies(tmpfsDenies),
    ...fileDenies.flatMap((path) => ["--ro-bind", "/dev/null", path]),
    ...["/", ...tmpfsDenies].flatMap((path) => ["--remount-ro", path]),
    ...bwrapEnvironmentArgs(environment),
  ];
  const identity = {
    schema: `${policy.schema}/linux-bwrap`,
    mechanismId: support.mechanismId,
    mechanism: support.mechanismDigest,
    systemReadBaseline: support.baselineDigest,
    policyDigest: policy.digest,
    mode,
    extraReads: [...extraReadPaths].sort(),
  };
  return { argv, profileDigest: hashJsonBytes(identity) };
}

/**
 * Decides every requested path against the policy. Denied paths are recorded and the request is
 * refused. Both the local runner and the microvm cell call this, so the decision has one owner.
 */
export function decideGuardedPaths(
  policy: CandidateAccessPolicy,
  record: PathRecord,
  request: IsolatedRequest,
): IsolatedPathDecision[] {
  const decisions = request.paths.map((requested) => ({
    requested,
    decision: guardPath(policy, request.capability, request.mode, requested),
  }));
  const denied = decisions.filter((entry) => entry.decision.decision === "deny");
  if (denied.length === 0) return decisions;
  for (const entry of denied) {
    record.append({
      capability: request.capability,
      mode: request.mode,
      policyDigest: policy.digest,
      profileDigest: null,
      requested: entry.requested,
      resolved: entry.decision.resolved,
      decision: "deny",
      reason: entry.decision.reason,
      enforcement: "guard-denied",
      bytes: null,
    });
  }
  const refusal = denied[0];
  throw new CandidateIsolationRefusal(
    refusal?.decision.decision === "deny" ? refusal.decision.message : "unreachable",
  );
}

/** Records the allowed paths of a request that ran. Shared with the microvm runner so both write
 *  the same row shape. */
export function recordAllowedPaths(
  policy: CandidateAccessPolicy,
  record: PathRecord,
  request: IsolatedRequest,
  decisions: readonly IsolatedPathDecision[],
  run: IsolatedRunEvidence,
): void {
  const { profileDigest, enforcement, stdout } = run;
  for (const entry of decisions) {
    record.append({
      capability: request.capability,
      mode: request.mode,
      policyDigest: policy.digest,
      profileDigest,
      requested: entry.requested,
      resolved: entry.decision.decision === "allow" ? entry.decision.resolved : null,
      decision: "allow",
      reason: entry.decision.reason,
      enforcement,
      bytes: enforcement === "os-allowed" ? new TextEncoder().encode(stdout).byteLength : null,
    });
  }
}

/**
 * Runs a guarded operation. The guard refuses without spawning; an allowed request runs under
 * Seatbelt or Bubblewrap derived from the same policy. On Darwin, an OS refusal of a guard-allowed
 * request is a derivation defect.
 */
export async function runIsolated(
  policy: CandidateAccessPolicy,
  record: PathRecord,
  request: IsolatedRequest,
  runtime: OsIsolationRuntime = {},
): Promise<IsolatedOutcome> {
  const support = osIsolationSupport(runtime);
  if (!support.ok) {
    throw new CandidateIsolationUnavailable(`workspace isolation is unavailable: ${support.reason}`);
  }
  const decisions = decideGuardedPaths(policy, record, request);
  const commandPath = resolveCommandPath(request.command, request.env);
  const controllerReadFiles = (request.controllerReadFiles ?? []).map((path) => {
    const resolved = realpathSync.native(path);
    if (!statSync(resolved).isFile()) {
      throw new CandidateIsolationUnavailable("a controller-staged workshop input is unavailable");
    }
    return resolved;
  });
  const extraReadPaths = [commandPath, ...controllerReadFiles];
  let profileDigest: string;
  let spawnArgs: string[];
  if (support.platform === "linux") {
    const plan = linuxCandidatePlan(policy, request.mode, support, extraReadPaths, request.env ?? {});
    profileDigest = plan.profileDigest;
    spawnArgs = [...plan.argv, commandPath, ...request.args];
  } else {
    const { profile, profileDigest: darwinDigest } = candidateIsolationProfile(
      policy,
      request.mode,
      extraReadPaths,
    );
    profileDigest = darwinDigest;
    spawnArgs = ["-p", profile, commandPath, ...request.args];
  }
  const outcome = await spawnCollected(support.mechanismPath, spawnArgs, request.cwd, request.env ?? {}, {
    stdin: request.stdin,
    timeoutMs: request.timeoutMs,
    signal: request.signal,
  });
  // Only Darwin reports a refusal observably; Linux shows a denied path as absent, which a caller
  // cannot tell from a missing file. A refusal with some output is normal partial behaviour.
  const enforcement =
    support.platform !== "linux" && looksOsRefused(outcome.status, outcome.stderr) && outcome.stdout === ""
      ? "os-refused"
      : "os-allowed";
  recordAllowedPaths(policy, record, request, decisions, {
    profileDigest,
    enforcement,
    stdout: outcome.stdout,
  });
  if (enforcement === "os-refused" && request.osRefusalIsOutcome !== true) {
    throw new CandidateIsolationRefusal(
      `workspace access check disagreed with the operating system for ${request.capability} on [${request.paths.join(", ")}]; stop the build and fix the isolation setup`,
    );
  }
  return outcome;
}

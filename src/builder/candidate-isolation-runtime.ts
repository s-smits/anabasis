/**
 * The candidate workspace access rules' execution half: it runs one guarded operation under the
 * host isolation and records the row that lets a later reader ask whether the Builder read outside its
 * allowance. The policy module owns what is allowed; this module turns that decision into a child
 * process and a durable path record, with one writer and one spawn shape per host.
 *
 * Darwin uses the SBPL profile emitted by candidate-isolation-profile.ts. Linux uses Bubblewrap's mount
 * namespace: readable roots are bound read-only, the workshop cell is bound read-write, protected
 * nodes are overmounted, and network follows the shared policy. The evidence names the mechanism
 * and profile digest so a Darwin and Linux execution cannot be mistaken for the same isolation.
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
  /** Exact standard input for a fixed isolated command. It is never included in argv or the path
   *  record; the capability owner must bind its digest in its own request evidence. */
  stdin?: string;
  /** Controller-owned regular files staged outside model-writable roots. They are admitted as
   * exact read literals in the concrete OS profile, never through the model-facing guard. */
  controllerReadFiles?: string[];
  /** exec capabilities (bash) set this: a child command tripping the isolation on paths the guard
   *  never checked is an expected isolation refusal and belongs in the command's own output, not a
   *  derivation disagreement. Guarded-path capabilities leave it unset, so a refused spawn on
   *  a guard-allowed target still throws as an isolation defect. */
  osRefusalIsOutcome?: boolean;
  /** Deadline for this one command; the group is killed when it passes. Defaults to
   *  `ISOLATED_TIMEOUT_MS`; a capability that lets the model ask for longer bounds it first. */
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

/** What a collected run may be given beyond its command line: bytes on stdin, and a wall other
 *  than the standing isolated one. */
type CollectedRun = {
  readonly stdin?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
};

/** The Bubblewrap identity fields carried into a candidate plan digest. The plan remains testable
 * with a synthetic mechanism on either host because only evidence-bound values appear here. */
interface LinuxIsolationSupport {
  mechanismId: string;
  mechanismDigest: string | null;
  baselineDigest: string | null;
}

/** One directory's share of the walk below, as its listing decided it under one policy. The walk
 *  ran again for every confined call and grew with the workspace: 54 ms per `/bin/true` on the
 *  starter workspace and 185 ms once `.toolchain` held 20,000 files (anabasis VM, 2026-09-13). A
 *  directory's listing is reused while its own complete metadata is unchanged; adding, removing
 *  or renaming an entry moves the mtime, and a change deeper down is seen by the child it
 *  belongs to. The same `sameReadRootMetadata` rule guards Seatbelt's remembered support. */
interface RememberedListing {
  metadata: ReadRootMetadata;
  denyDirs: string[];
  denyFiles: string[];
  children: string[];
}

/**
 * Build the Bubblewrap argv and the mechanism-distinct digest for one guarded call. The
 * deny-default namespace grants the system baseline, then binds the policy's readable roots
 * read-only and its writable cell read-write. Protected regions inside those roots are overmounted
 * so they are absent, rather than merely refused by a path-string rule.
 *
 * The digest binds the policy identity and mechanism, not the transient set of existing files. It
 * therefore stays stable for a turn in the same way as the Darwin SBPL profile digest, while the
 * actual mount list still follows the guard's concrete decisions.
 */
/** The Bubblewrap invocation and the identity it was derived under. The digest binds the policy,
 *  not the argv: the mount list follows the guard's concrete decisions and the identity does not. */
interface LinuxCandidatePlan {
  argv: string[];
  profileDigest: string;
}

type IsolatedPathDecision = { requested: string; decision: ReturnType<typeof guardPath> };

/** What the OS did with an allowed request: which profile enforced it, whether the enforcement
 *  let it through, and the output it produced. */
type IsolatedRunEvidence = {
  readonly profileDigest: string;
  readonly enforcement: "os-refused" | "os-allowed";
  readonly stdout: string;
};

const LISTINGS_BY_POLICY = new Map<string, RememberedListing>();

/** A guard refusal or a guard/OS derivation disagreement — clean, model-actionable message. */
export class CandidateIsolationRefusal extends Error {}
/** The enforcement mechanism is unavailable; the campaign refuses, nothing runs degraded. */
export class CandidateIsolationUnavailable extends Error {}

/** Recognise likely OS refusals; a non-zero exit alone may be a normal result, such as rg's no-match 1. */
function looksOsRefused(status: number | null, stderr: string): boolean {
  return status !== 0 && /operation not permitted|sandbox/i.test(stderr);
}

/** A request that declares an environment resolves a relative command against that environment's PATH — the one
 * the process will actually run with; resolving against the controller's PATH picked a host rg
 * the workshop cell then refused (pr180: every `inspect` failed). A request that declares no
 * environment keeps the controller's PATH, as before. */
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

/** Kill every isolated command still running. Each child is detached into its own group, so a
 *  stop signal to the controller never reaches it; the controller's closure calls this instead. */
export function stopIsolatedCommands(): void {
  for (const child of liveCommands) killProcessGroup(child, "SIGKILL");
}

/** Exported for the microvm workshop runner, which spawns ssh instead of bwrap or sandbox-exec
 *  but keeps this module's capture caps, group-kill timeout and outcome shape. */
export async function spawnCollected(
  command: string,
  args: string[],
  cwd: string,
  env: OptionalEnvValues,
  run: CollectedRun = {},
): Promise<IsolatedOutcome> {
  const { stdin, signal } = run;
  const timeoutMs = run.timeoutMs ?? ISOLATED_TIMEOUT_MS;
  // Detached: an isolated command can fork grandchildren, and signalling the group on timeout
  // kills the tree instead of orphaning it.
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
 * Collect the concrete nodes a Bubblewrap mount must hide. A denied directory prunes its whole
 * subtree; a denied file is replaced by /dev/null. The caller supplies the predicate because an
 * epoch root needs the full resolving guard, while a broad toolchain root needs only the lexical
 * secret-name and .git checks. Keeping the traversal here makes those two enforcement shapes share
 * the same pruning and error treatment without widening either policy.
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

/** Walk the roots this call binds and collect what the guard refuses inside them. Two owners decide
 *  it: under the epoch directory the resolving guard answers for every concrete node, and elsewhere
 *  under the repository the secret and `.git` name checks do, which keeps a large tree bounded. */
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
  // A host-wide scratch root becomes a fresh tmpfs: binding the real host /tmp would expose other
  // runs. The workshop's own scratch cell is instead a real read-write bind. Laying the tmpfs
  // first lets a repository cell under a scratch root be re-exposed by its later bind.
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
  // A write-deny root stays readable, as under Seatbelt's `deny file-write*`: the workspace
  // node_modules carries the @ana links the Builder's own `bun test` resolves through, so it is
  // re-bound read-only over the writable workspace rather than hidden by a tmpfs.
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

/** The guard's typed refusal rows are the same whichever mechanism would have run the allowed
 *  request. This was exported for the microvm workshop runner alone; that runner calls
 *  `decideGuardedPaths` below now, so the refusal has one caller and stays inside the module. */
function rejectGuardedPaths(
  policy: CandidateAccessPolicy,
  record: PathRecord,
  request: IsolatedRequest,
  decisions: readonly IsolatedPathDecision[],
): void {
  const denied = decisions.filter((entry) => entry.decision.decision === "deny");
  if (denied.length === 0) return;
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

/**
 * Decide every requested path against the policy and refuse the request if any is denied.
 *
 * The two isolation runners — the in-process one below and the microvm cell — each spelled this
 * out, which meant two places deciding which paths a candidate may reach. One of them is enough,
 * and a guard whose answer depends on which runner asked is the defect worth ruling out.
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
  rejectGuardedPaths(policy, record, request, decisions);
  return decisions;
}

/** Exported beside `decideGuardedPaths` for the microvm workshop runner: an allowed request
 *  writes the same row whichever mechanism ran it, and only what the OS reported about the
 *  enforcement differs. Written out twice, the two copies could disagree about a field the
 *  evidence reader joins on. */
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
 * Run a guarded filesystem operation through the only capability path. The guard writes typed
 * refusals without spawning; an allowed request then runs under Darwin Seatbelt or Linux
 * Bubblewrap, both derived from the same policy. A Darwin guard-allowed/OS-refused pair is a
 * blocking derivation defect. Linux hides a denied node as absent, so its command outcome remains
 * the appropriate observable rather than a string-matched refusal.
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
  // Partial refusals within an allowed tree can be normal command behaviour (for example a search
  // skipping an unreadable child). Linux represents a denied path as absent, which is
  // indistinguishable from a legitimate missing file; the disagreement check therefore remains
  // specific to Darwin's observable Seatbelt refusal and leaves Linux child failures to callers.
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

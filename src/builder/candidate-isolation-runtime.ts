/**
 * The execution half of the candidate workspace access rules: it runs one guarded operation under
 * the host isolation and records the row that lets a later reader ask whether the Builder read
 * outside its allowance. The policy module owns what is allowed; this one turns that decision into
 * a child process and a durable path record, with one writer and one spawn shape per host.
 *
 * The two hosts reach the same policy by different means. Darwin runs the SBPL profile emitted by
 * candidate-isolation-profile.ts. Linux uses a Bubblewrap mount namespace: readable roots are
 * bound read-only, the cell is bound read-write, protected nodes are overmounted so they are
 * absent rather than merely refused, and the network follows the shared policy. Because the two
 * mechanisms fail differently — a Darwin refusal is observable, a Linux one looks like a missing
 * file — the evidence names the mechanism and the profile digest, so a Darwin and a Linux
 * execution can never be read as the same isolation.
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
  /** Exact standard input for a fixed isolated command. It never enters argv or the path record,
   *  so the capability that owns the request has to bind its digest in its own evidence if the
   *  bytes are to be accounted for at all. */
  stdin?: string;
  /** Controller-owned regular files staged outside any model-writable root. They are admitted as
   *  exact read literals in the concrete OS profile and never through the model-facing guard,
   *  because the model neither chose them nor can name them. */
  controllerReadFiles?: string[];
  /** Set by the exec capabilities, meaning bash. A child command that trips the isolation on paths
   *  the guard never checked is an ordinary refusal and belongs in that command's own output. A
   *  guarded-path capability leaves it unset, so an OS refusal of a path the guard had allowed
   *  still throws: there the two layers disagreed about one derivation, which is a defect. */
  osRefusalIsOutcome?: boolean;
  /** Deadline for this one command, after which the process group is killed. It defaults to
   *  `ISOLATED_TIMEOUT_MS`, and a capability that lets the model ask for longer bounds the value
   *  before it arrives here. */
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

/** What a collected run may be given beyond its command line: bytes on stdin, a wall other than
 *  the standing isolated one, and the caller's own abort. All three are optional because most
 *  callers want none of them, and a run that omits the wall gets `ISOLATED_TIMEOUT_MS` rather
 *  than no wall at all. */
type CollectedRun = {
  readonly stdin?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
};

/** The Bubblewrap identity fields carried into a plan digest. Only evidence-bound values appear
 *  here, which is what keeps the plan testable with a synthetic mechanism on either host. */
interface LinuxIsolationSupport {
  mechanismId: string;
  mechanismDigest: string | null;
  baselineDigest: string | null;
}

/**
 * One directory's share of the deny walk below, as its own listing decided it under one policy.
 *
 * The walk runs again for every confined call and its cost scales with the tree, so a `.toolchain`
 * holding tens of thousands of files is paid for by every guarded command. A directory's listing may
 * therefore be reused while its own complete metadata is unchanged: adding, removing or renaming an
 * entry moves the mtime, and a change further down is seen by the child directory that holds it,
 * which has a remembered listing of its own. `sameReadRootMetadata` is the same comparison that
 * guards Seatbelt's remembered support in darwin-seatbelt.ts, so one rule decides when either cache
 * is stale.
 */
interface RememberedListing {
  metadata: ReadRootMetadata;
  denyDirs: string[];
  denyFiles: string[];
  children: string[];
}

/**
 * The Bubblewrap invocation for one guarded call and the identity it was derived under. The
 * namespace denies by default, so the plan grants the system baseline, then binds the policy's
 * readable roots read-only and its writable cell read-write. A protected region inside one of
 * those roots is overmounted rather than left to a path-string rule, which means it is absent to
 * the child instead of present and refused.
 *
 * The digest binds the policy identity and the mechanism, not the mount list, because the mount
 * list follows whichever files happen to exist at this moment while the isolation the evidence
 * names does not. That keeps it stable across a turn in the same way the Darwin SBPL profile
 * digest is, so two calls under one policy carry one profile identity.
 */
interface LinuxCandidatePlan {
  argv: string[];
  profileDigest: string;
}

type IsolatedPathDecision = { requested: string; decision: ReturnType<typeof guardPath> };

/** What the OS did with an allowed request: which profile enforced it, whether the enforcement let
 *  it through, and the output it produced. These three travel together because the row writer
 *  needs all of them at once, and both runners hand it the same triple. */
type IsolatedRunEvidence = {
  readonly profileDigest: string;
  readonly enforcement: "os-refused" | "os-allowed";
  readonly stdout: string;
};

const LISTINGS_BY_POLICY = new Map<string, RememberedListing>();

/** A guard refusal, or the two layers disagreeing about one derivation, carrying a message the
 *  model can act on. */
export class CandidateIsolationRefusal extends Error {}
/** The enforcement mechanism is unavailable. The campaign refuses rather than running the command
 *  unconfined, because a Builder command that ran outside the isolation would leave a path record
 *  that says it was guarded. */
export class CandidateIsolationUnavailable extends Error {}

/** Recognise the stderr a Seatbelt refusal leaves. A non-zero exit alone will not do, because a
 *  command may exit non-zero as its ordinary answer — rg reports no match with 1 — and treating
 *  that as a refusal would turn every empty search into an isolation defect. */
function looksOsRefused(status: number | null, stderr: string): boolean {
  return status !== 0 && /operation not permitted|sandbox/i.test(stderr);
}

/** Resolves a relative command against the PATH the process will actually run with, which is the
 *  request's own environment when it declares one. Resolving against the controller's PATH instead
 *  picks a host binary the workshop cell then refuses, so every call through that capability fails.
 *  A request that declares no environment still keeps the controller's PATH, since that is the
 *  environment it will inherit. */
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

/** Kills every isolated command still running. Each child is detached into its own process group
 *  below, which is what lets a timeout take its grandchildren with it, and that same detachment
 *  means a stop signal delivered to the controller never reaches any of them. The controller's
 *  closure in full-run.ts calls this instead, so a stopped run leaves no confined command behind. */
export function stopIsolatedCommands(): void {
  for (const child of liveCommands) killProcessGroup(child, "SIGKILL");
}

/** Spawns a command with capped capture and a group-kill deadline. It is exported for the microvm
 *  workshop runner in vm-workshop-cell.ts, which spawns ssh rather than bwrap or sandbox-exec and
 *  so shares none of the profile derivation, but does need the same capture caps, the same
 *  group-kill wall and the same outcome shape — a second spawn of its own would be a second owner
 *  of process lifetime, which the `no-lifetime-outside-owner` lint rule reports. */
export async function spawnCollected(
  command: string,
  args: string[],
  cwd: string,
  env: OptionalEnvValues,
  run: CollectedRun = {},
): Promise<IsolatedOutcome> {
  const { stdin, signal } = run;
  const timeoutMs = run.timeoutMs ?? ISOLATED_TIMEOUT_MS;
  // Detached into its own process group: an isolated command can fork grandchildren, and
  // signalling the group on timeout kills the tree rather than orphaning it under the controller.
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
 * Collects the concrete nodes a Bubblewrap mount must hide under `root`. A denied directory prunes
 * its whole subtree, since nothing inside a hidden directory can be reached anyway; a denied file
 * is collected separately because the caller replaces it with /dev/null rather than a tmpfs.
 *
 * The deny predicate comes from the caller because the two enforcement shapes need different ones:
 * an epoch root needs the full resolving guard, while a broad toolchain root needs only the
 * lexical secret-name and `.git` checks, which are cheap enough to run over a large tree. Keeping
 * the traversal here lets both shapes share one pruning rule and one treatment of an unreadable
 * directory, without either policy having to widen to match the other.
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

/** Walks the roots this call binds and collects what the guard refuses inside them. Two owners
 *  decide that: under the epoch directory the resolving guard answers for every concrete node,
 *  because that is the tree whose contents the policy is actually about; elsewhere under the
 *  repository the secret and `.git` name checks answer instead, which is what keeps a walk over a
 *  large tree bounded. A root under neither contributes nothing, so a bind outside both is hidden
 *  only by whatever `policy.readDenyRoots` already names. */
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
  // A host-wide scratch root becomes a fresh tmpfs, because binding the real host /tmp would show
  // this call every other run's scratch. The workshop's own scratch cell is a real read-write bind
  // instead, since the command is meant to write there. Laying the tmpfs down first is what lets a
  // repository cell that happens to sit under a scratch root be re-exposed by its own later bind.
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
  // A write-deny root stays readable, as it does under Seatbelt's `deny file-write*`: the
  // workspace node_modules carries the @ana links the Builder's own `bun test` resolves through,
  // so hiding it behind a tmpfs would break the command rather than confine it. It is re-bound
  // read-only over the writable workspace instead, which denies the write and keeps the read.
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
 * Decides every requested path against the policy, records each denial, and refuses the whole
 * request if any path was denied. Every denied path gets its row before the throw, because a
 * refusal the record does not name is a refusal no later reader can count.
 *
 * The two isolation runners — the in-process one below and the microvm cell in vm-workshop-cell.ts
 * — each spelled this out, which meant two places deciding which paths a candidate may reach. One
 * of them is enough, and a guard whose answer depends on which runner asked is the defect worth
 * ruling out.
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

/** Records the allowed paths of a request that ran. It is exported beside `decideGuardedPaths` for
 *  the microvm workshop runner: an allowed request writes the same row whichever mechanism ran it,
 *  and only what the OS reported about the enforcement differs. Written out twice, the two copies
 *  could come to disagree about a field the evidence reader joins on. */
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
 * Runs a guarded filesystem operation through the only capability path there is. The guard writes
 * its typed refusals and throws without spawning anything, so a denied request costs no child; an
 * allowed request then runs under Darwin Seatbelt or Linux Bubblewrap, both derived from the same
 * policy object. When the mechanism itself is missing the call refuses rather than running
 * unconfined, and verifier-workshop.ts turns that into a `mechanism-unavailable` non-result while a
 * refusal becomes `sandbox-refused` — two typed outcomes the environment owner can tell apart.
 *
 * A Darwin request the guard allowed and the OS refused is a blocking derivation defect, because
 * there the two layers disagreed about one policy. Linux cannot report that: it hides a denied node
 * by making it absent, which the child cannot tell from a file that was never there, so on Linux
 * the command's own outcome stays the observable and no string match pretends otherwise.
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
  // A partial refusal inside an allowed tree can be ordinary command behaviour — a search skipping
  // an unreadable child, say — which is why a run that produced stdout is never read as refused.
  // Linux represents a denied path as absent, indistinguishable from a legitimate missing file, so
  // the disagreement check stays specific to Darwin's observable Seatbelt refusal and leaves a
  // Linux child's failure to the caller that asked for the command.
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

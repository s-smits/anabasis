import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { lstatSync, readlinkSync, realpathSync, statSync } from "../meta/filesystem.ts";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "../meta/path.ts";
import { sha256 } from "../meta/digest.ts";
import {
  attestReadRootFile,
  createReadRootBudget,
  READ_ROOT_AGGREGATE_MAX_BYTES,
  READ_ROOT_AGGREGATE_MAX_DURATION_MS,
  READ_ROOT_MAX_BYTES,
  type ReadRootBudget,
} from "./read-root-attestation.ts";
import { errorMessage } from "../meta/runtime-values.ts";

/** Why an exact read could not be attested; never a domain failure. */
type ExactReadRefusalKind = "changed" | "limit" | "unavailable";

/** Bounds a hostile or unexpectedly large runtime closure. */
export const EXACT_READ_MAX_PATHS = 16_384;
/** Symlink targets are normally a few KiB; this bounds a hostile one. */
const EXACT_READ_MAX_SYMLINK_BYTES = 1024 * 1024;

export interface ExactReadSnapshot {
  path: string;
  kind: "file" | "symlink";
  target: "file" | "directory";
  /** Content digest for files and file symlinks; directory symlinks use their link text. */
  digest: string;
  /** Retargeting a symlink to byte-identical content still invalidates the policy. */
  linkDigest: string | null;
}

/** Why a re-attestation did not confirm the snapshot. `changed` is a real byte difference, the
 *  wall's own refusal. `unavailable` is a re-read the host could not complete (failed syscall,
 *  exhausted budget): it says nothing about the bytes, belongs to the environment and may be
 *  retried. Keep the two apart, or a stalled disk reads as a changed identity. */
export type ExactReadDrift = { kind: "changed" | "unavailable"; detail: string };

/** A wall mechanism as its plan attested it: the executable, its bytes and the read baseline. */
interface AttestedMechanism {
  mechanismPath: string;
  mechanismDigest: string | null;
  baselineDigest: string | null;
}

/** The same mechanism read again at verifier execution, with whether the host could read it. */
interface ReattestedMechanism extends AttestedMechanism {
  ok: boolean;
  reason: string | null;
}

export class ExactReadAttestationError extends Error {
  constructor(
    readonly kind: ExactReadRefusalKind,
    message: string,
  ) {
    super(message);
    this.name = "ExactReadAttestationError";
  }
}

function refusalKind(error: unknown): ExactReadRefusalKind {
  const message = errorMessage(error);
  if (/changed|replacement|retarget|descriptor|shorter|differs/.test(message)) return "changed";
  if (/budget|exceeded|more than|too large|too many|deeper/.test(message)) return "limit";
  return "unavailable";
}

function refusal(error: unknown, path: string): ExactReadAttestationError {
  if (error instanceof ExactReadAttestationError) return error;
  const message = errorMessage(error);
  return new ExactReadAttestationError(
    refusalKind(error),
    `exact sandbox read unavailable at ${path}: ${message}`,
  );
}

function assertAggregateTime(budget: ReadRootBudget, path: string): void {
  if (Date.now() - budget.startedAt > READ_ROOT_AGGREGATE_MAX_DURATION_MS) {
    throw new ExactReadAttestationError(
      "limit",
      `exact sandbox read aggregate attestation exceeded ${String(READ_ROOT_AGGREGATE_MAX_DURATION_MS)}ms: ${path}`,
    );
  }
}

function reserveSymlinkBytes(budget: ReadRootBudget, bytes: number, path: string): void {
  const amount = BigInt(bytes);
  if (
    amount > READ_ROOT_MAX_BYTES - budget.contentBytes ||
    amount > READ_ROOT_AGGREGATE_MAX_BYTES - budget.contentBytes
  ) {
    throw new ExactReadAttestationError("limit", `exact sandbox read byte budget exceeded: ${path}`);
  }
  budget.contentBytes += amount;
}

function symlinkBytes(path: string, budget?: ReadRootBudget): Uint8Array {
  try {
    const linkStat = lstatSync(path, { bigint: true });
    if (!linkStat.isSymbolicLink()) throw new Error("the exact-read path is no longer a symbolic link");
    if (linkStat.size > BigInt(EXACT_READ_MAX_SYMLINK_BYTES)) {
      throw new ExactReadAttestationError(
        "limit",
        `exact sandbox symlink target exceeds ${String(EXACT_READ_MAX_SYMLINK_BYTES)} bytes: ${path}`,
      );
    }
    const raw = readlinkSync(path, { encoding: "buffer" });
    if (!(raw instanceof Uint8Array)) throw new Error("the symlink target was not returned as bytes");
    if (raw.byteLength > EXACT_READ_MAX_SYMLINK_BYTES) {
      throw new ExactReadAttestationError(
        "limit",
        `exact sandbox symlink target exceeds ${String(EXACT_READ_MAX_SYMLINK_BYTES)} bytes: ${path}`,
      );
    }
    if (budget !== undefined) {
      assertAggregateTime(budget, path);
      reserveSymlinkBytes(budget, raw.byteLength, path);
    }
    return raw;
  } catch (error) {
    throw refusal(error, path);
  }
}

function symlinkText(path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(symlinkBytes(path));
  } catch (error) {
    throw refusal(error, path);
  }
}

function bytesEqual(left: Uint8Array | null, right: Uint8Array | null): boolean {
  if (left === null || right === null) return left === right;
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

function targetSignature(value: NonNullable<ReturnType<typeof statSync>>): string {
  return [
    value.isFile(),
    value.isDirectory(),
    value.dev,
    value.ino,
    value.mode,
    value.size,
    value.mtimeMs,
    value.ctimeMs,
  ].join(":");
}

function addReadPath(reads: Set<string>, path: string): void {
  if (reads.has(path)) return;
  if (reads.size >= EXACT_READ_MAX_PATHS) {
    throw new ExactReadAttestationError(
      "limit",
      `exact sandbox read has more than ${String(EXACT_READ_MAX_PATHS)} paths`,
    );
  }
  reads.add(path);
}

/**
 * Whether a path leads to a regular file: readable, runnable, and safe to snapshot.
 *
 * `stat` rather than `lstat`, because packaged binaries and profiles are routinely installed as
 * links (Homebrew's `bin` links into `../Cellar`). `linux-bwrap.ts` keeps an `lstat` copy on
 * purpose: it asks what the path is, not what it leads to.
 */
export function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Every lexical path form the loader may traverse for one regular file. */
function exactReadForms(path: string): string[] {
  if (!isAbsolute(path) || !isRegularFile(path)) {
    throw new Error(`exact sandbox read is unavailable: ${capturedJsonStringify(path)}`);
  }
  const reads = new Set<string>();
  const pending = [resolve(path)];
  for (const candidate of pending) {
    if (reads.has(candidate)) continue;
    addReadPath(reads, candidate);
    const { root } = parse(candidate);
    const parts = relative(root, candidate).split(sep);
    let current = root;
    for (const [index, part] of parts.entries()) {
      current = join(current, part);
      if (!lstatSync(current).isSymbolicLink()) continue;
      addReadPath(reads, current);
      const target = symlinkText(current);
      const rewritten = join(
        isAbsolute(target) ? target : resolve(dirname(current), target),
        ...parts.slice(index + 1),
      );
      if (isRegularFile(rewritten) && !reads.has(rewritten)) pending.push(rewritten);
    }
    addReadPath(reads, realpathSync.native(candidate));
  }
  return [...reads];
}

function snapshot(path: string, budget: ReadRootBudget): ExactReadSnapshot {
  assertAggregateTime(budget, path);
  let lexical: ReturnType<typeof lstatSync>;
  let target: ReturnType<typeof statSync>;
  try {
    lexical = lstatSync(path);
    target = statSync(path);
  } catch (error) {
    throw refusal(error, path);
  }
  const kind = lexical.isSymbolicLink() ? "symlink" : "file";
  // A file is attested by its bytes, a directory only through the link that reaches it; a plain
  // directory has no bytes and is unsupported.
  const targetPath = target.isFile() ? realpathSync.native(path) : null;
  const linkBytes = kind === "symlink" ? symlinkBytes(path, budget) : null;
  let digest: string;
  if (targetPath !== null) digest = attestReadRootFile(targetPath, budget).digest;
  else if (target.isDirectory() && linkBytes !== null) digest = sha256(linkBytes);
  else {
    throw new ExactReadAttestationError(
      "unavailable",
      `exact sandbox read has unsupported target: ${capturedJsonStringify(path)}`,
    );
  }
  let lexicalAfter: ReturnType<typeof lstatSync>;
  let targetAfter: ReturnType<typeof statSync>;
  let linkBytesAfter: Uint8Array | null;
  let targetPathAfter: string | null;
  try {
    lexicalAfter = lstatSync(path);
    targetAfter = statSync(path);
    linkBytesAfter = lexicalAfter.isSymbolicLink() ? symlinkBytes(path) : null;
    targetPathAfter = targetAfter.isFile() ? realpathSync.native(path) : null;
  } catch (error) {
    throw refusal(error, path);
  }
  if (
    lexicalAfter.isSymbolicLink() !== lexical.isSymbolicLink() ||
    targetSignature(targetAfter) !== targetSignature(target) ||
    !bytesEqual(linkBytes, linkBytesAfter) ||
    (targetPathAfter !== targetPath &&
      (targetPath === null ||
        targetPathAfter === null ||
        targetSignature(statSync(targetPath)) !== targetSignature(target) ||
        targetSignature(statSync(targetPathAfter)) !== targetSignature(targetAfter)))
  ) {
    throw new ExactReadAttestationError("changed", `exact sandbox read changed while attesting: ${path}`);
  }
  return {
    path,
    kind,
    target: target.isFile() ? "file" : "directory",
    digest,
    linkDigest: linkBytes === null ? null : sha256(linkBytes),
  };
}

export function snapshotExactReads(paths: readonly string[]): ExactReadSnapshot[] {
  const budget = createReadRootBudget();
  const reads = new Set<string>();
  try {
    for (const path of paths) {
      assertAggregateTime(budget, path);
      for (const read of exactReadForms(path)) addReadPath(reads, read);
    }
    return [...reads].sort().map((path) => snapshot(path, budget));
  } catch (error) {
    throw refusal(error, "the exact-read set");
  }
}

function snapshotDifference(entry: ExactReadSnapshot, current: ExactReadSnapshot): string | null {
  if (current.kind !== entry.kind) return "kind";
  if (current.target !== entry.target) return "target";
  if (current.digest !== entry.digest) return "digest";
  if (current.linkDigest !== entry.linkDigest) return "linkDigest";
  return null;
}

export function exactReadDrift(expected: readonly ExactReadSnapshot[]): ExactReadDrift | null {
  try {
    const budget = createReadRootBudget();
    if (expected.length > EXACT_READ_MAX_PATHS) {
      throw new ExactReadAttestationError(
        "limit",
        `exact sandbox read has more than ${String(EXACT_READ_MAX_PATHS)} paths`,
      );
    }
    for (const entry of expected) {
      const field = snapshotDifference(entry, snapshot(entry.path, budget));
      if (field !== null) {
        return { kind: "changed", detail: `${field} differs from its snapshot: ${entry.path}` };
      }
    }
    return null;
  } catch (error) {
    const kind = error instanceof ExactReadAttestationError ? error.kind : refusalKind(error);
    const message = errorMessage(error);
    return { kind: kind === "changed" ? "changed" : "unavailable", detail: `${kind}: ${message}` };
  }
}

/** One wording for both OS walls, so the recorded reason reads the same on Darwin and Linux. */
export function attestedInputDrift(drift: ExactReadDrift | null): ExactReadDrift | null {
  if (drift === null) return null;
  return drift.kind === "changed"
    ? {
        kind: "changed",
        detail: `a sandbox command or attested input changed during verifier execution (${drift.detail})`,
      }
    : {
        kind: "unavailable",
        detail: `an attested input could not be re-read during verifier execution (${drift.detail})`,
      };
}

/**
 * One split for both OS walls: a support failure is `unavailable`, and only a mechanism whose path
 * or digest moved is `changed`. `mechanism` names what was attested, for the reason text.
 */

export function mechanismDrift(
  support: ReattestedMechanism,
  attested: AttestedMechanism,
  mechanism: string,
): ExactReadDrift | null {
  if (!support.ok) {
    return {
      kind: "unavailable",
      detail: `the ${mechanism} could not be re-attested during verifier execution: ${support.reason ?? "unavailable"}`,
    };
  }
  if (
    support.mechanismPath !== attested.mechanismPath ||
    support.mechanismDigest !== attested.mechanismDigest ||
    support.baselineDigest !== attested.baselineDigest
  ) {
    return { kind: "changed", detail: `the ${mechanism} changed during verifier execution` };
  }
  return null;
}

export function exactReadSnapshotsMatch(expected: readonly ExactReadSnapshot[]): boolean {
  return exactReadDrift(expected) === null;
}

export function exactFileReadPaths(snapshots: readonly ExactReadSnapshot[]): string[] {
  return snapshots
    .values()
    .filter(({ target }) => target === "file")
    .map(({ path }) => path)
    .toArray();
}

export function exactSymlinkMetadataPaths(snapshots: readonly ExactReadSnapshot[]): string[] {
  return snapshots
    .values()
    .filter(({ kind }) => kind === "symlink")
    .map(({ path }) => path)
    .toArray();
}

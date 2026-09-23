/**
 * `EvidenceLog` writes run evidence and records the bytes it produced (steering-delta P1: protect
 * records from the Built Harness). It was introduced when generated modules ran in process and
 * could modify an earlier case's files between runner writes. Runtime isolation now keeps them
 * out, and the writer's manifest check remains useful beside it, because it lets a reader detect
 * changes made outside this writer rather than assume exclusive ownership.
 *
 *  - Write each file atomically using a temporary file and rename, avoiding partial JSON at
 *    the final path. Keep each file's sha256 in memory when writing it.
 *  - Publish those recorded hashes in `run-manifest.json`. Do not rebuild them from disk:
 *    a file changed during the battery must disagree with the manifest, rather than having
 *    its altered bytes accepted as the writer's output.
 *  - `verifyRunDir()` reports changed, unrecorded, missing and incomplete files. The readiness
 *    check consumes these findings when deciding whether the evidence can be used.
 *
 * This module checks file integrity; it does not deny filesystem writes. Runtime isolation
 * supplies access restrictions, while manifest violations prevent affected evidence being trusted.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "../meta/filesystem.ts";
import { dirname, join } from "../meta/path.ts";
import type { JsonValue } from "../meta/json-shape.ts";
import { sha256 } from "../meta/digest.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { isNumber, isRecord, isString } from "../meta/json-shape.ts";
import { runtimeProcess } from "../meta/process.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { readJsonFile } from "../meta/completed-json.ts";

export const RUN_MANIFEST_NAME = "run-manifest.json";

/**
 * Historical manifests may contain the retired live journal under this namespace; nothing in
 * `src` writes one now. Its recorded digest remains verifiable, but telemetry is never claim
 * evidence, so its violations stay separate from the blocking evidence violations.
 */
const TELEMETRY_PREFIX = "live/";

type EvidenceLogViolationCode =
  | "run-unrecorded"
  | "evidence-tampered"
  | "evidence-foreign"
  | "evidence-missing"
  | "evidence-torn"
  | "evidence-irregular"
  | "evidence-append-diverged";

export interface EvidenceLogViolation {
  code: EvidenceLogViolationCode;
  /** Posix path relative to the run dir. */
  path: string;
  detail: string;
}

interface Manifest {
  schemaVersion: "evidence-stage/v1";
  /** Relative POSIX path → sha256 calculated from the bytes supplied to the writer. */
  files: Record<string, string>;
  /** Historical append-mode telemetry. New writers do not produce it. */
  appends?: Record<string, { sha256: string; bytes: number }>;
}

const TMP_RE = /\.tmp-\d+$/;

export class EvidenceLog {
  private readonly written = new Map<string, string>();
  /** Set by the first `record()`. From then on every write republishes the manifest: the battery
   *  is published before the paid review, and a review file the manifest does not name would make
   *  the reader call the finished measurement foreign if the process died mid-review. */
  private recorded = false;

  constructor(readonly runDir: string) {}

  /** Atomic evidence write: serialize, temp + rename, record the write-time hash. */
  write(rel: string, value: JsonValue): string {
    const bytes = capturedJsonStringify(value, null, 2);
    const abs = join(this.runDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp-${runtimeProcess.pid}`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, abs);
    this.written.set(rel, sha256(bytes));
    if (this.recorded) this.publish();
    return abs;
  }

  /** Publish the write-time log as the run manifest. A second explicit record is the completed
   *  battery after the paid review. */
  record(): void {
    this.publish();
  }

  private publish(): void {
    const manifest: Manifest = {
      schemaVersion: "evidence-stage/v1",
      files: Object.fromEntries([...this.written.entries()].sort(([a], [b]) => compareCodeUnits(a, b))),
    };
    const abs = join(this.runDir, RUN_MANIFEST_NAME);
    const tmp = `${abs}.tmp-${runtimeProcess.pid}`;
    writeFileSync(tmp, capturedJsonStringify(manifest, null, 2));
    renameSync(tmp, abs);
    this.recorded = true;
  }
}

/**
 * Require every file in the run directory to match the writer's manifest byte for byte.
 * Without a readable manifest, return immediately because there is no recorded identity to check.
 */
export function verifyRunDir(runDir: string): EvidenceLogViolation[] {
  const manifest = readManifest(runDir);
  if (!manifest) {
    return [
      {
        code: "run-unrecorded",
        path: RUN_MANIFEST_NAME,
        detail:
          "run dir has no manifest declaring evidence-stage/v1 — no writer this reader understands owns these evidence, nothing in it is claimable evidence",
      },
    ];
  }
  const seen = new Set<string>();
  const violations = diskViolations(runDir, manifest, seen);
  for (const rel of Object.keys(manifest.files)) {
    if (!seen.has(rel)) {
      violations.push({
        code: "evidence-missing",
        path: rel,
        detail: "the owner's manifest names this evidence but it is gone from disk",
      });
    }
  }
  for (const rel of Object.keys(manifest.appends ?? {})) {
    if (rel.startsWith(TELEMETRY_PREFIX) && !seen.has(rel)) {
      seen.add(rel);
      violations.push({
        code: "evidence-missing",
        path: rel,
        detail: "the owner's append log names this file but it is gone from disk",
      });
    }
  }
  return violations;
}

/** What the run directory itself carries, recording in `seen` every file the manifest may claim. */
function diskViolations(runDir: string, manifest: Manifest, seen: Set<string>): EvidenceLogViolation[] {
  const violations: EvidenceLogViolation[] = [];
  for (const { rel, irregular } of walkFiles(runDir)) {
    if (irregular) {
      // The owner only ever writes regular files, so a symlink or special file under a run dir is
      // an unsupported entry rather than an unexpected one, and following it could read bytes
      // from outside the recorded directory and record them as the run's own.
      violations.push({
        code: "evidence-irregular",
        path: rel,
        detail:
          "not a regular file (symlink or special entry) — the evidence owner writes only regular files; reads do not follow it",
      });
      continue;
    }
    if (rel === RUN_MANIFEST_NAME) continue;
    if (TMP_RE.test(rel)) {
      violations.push({
        code: "evidence-torn",
        path: rel,
        detail:
          "leftover atomic-write temp file — an interrupted write; the named evidence is whatever the rename left, this remnant is not evidence",
      });
      continue;
    }
    seen.add(rel);
    // Historical append expectations are honoured only inside the telemetry namespace: a manifest
    // entry anywhere else cannot exempt a file from the unrecorded or changed-file checks, which
    // is what would otherwise let one forged row excuse a file from every digest comparison.
    const inTelemetry = rel.startsWith(TELEMETRY_PREFIX);
    const recordedAppend = inTelemetry ? manifest.appends?.[rel] : undefined;
    if (recordedAppend !== undefined) {
      const disk = readFileSync(join(runDir, rel));
      if (disk.length !== recordedAppend.bytes || sha256(disk) !== recordedAppend.sha256) {
        violations.push({
          code: "evidence-append-diverged",
          path: rel,
          detail: `append-mode file differs from the owner's recorded digest (${disk.length} bytes on disk, ${recordedAppend.bytes} written) — bytes were appended, truncated, or rewritten after recording`,
        });
      }
      continue;
    }
    const expected = manifest.files[rel];
    if (expected === undefined) {
      violations.push({
        code: "evidence-foreign",
        path: rel,
        detail:
          "file present in the run dir but absent from the owner's write log — written by something other than the eval runner/falsifier",
      });
    } else if (sha256(readFileSync(join(runDir, rel), "utf8")) !== expected) {
      violations.push({
        code: "evidence-tampered",
        path: rel,
        detail:
          "bytes differ from what the owner wrote — the evidence was modified after the write it attests",
      });
    }
  }
  return violations;
}

/** Check ownership, find the manifest entry, and read the attested bytes in one call. This prevents
 *  a caller from verifying a file and then reading different bytes after it changes. The returned
 *  bytes must match the recorded digest. Blocking violations use the campaign check's existing
 *  refusal text; telemetry-only violations do not invalidate the evidence.
 *
 *  `violations` lets a caller reading several files from the same runDir reuse a completed
 *  `verifyRunDir(runDir)` check, avoiding a full directory walk and hash for each file. Omit it
 *  when reading a single file. */
export function recordedEvidence(
  runDir: string,
  rel: string,
  violations: EvidenceLogViolation[] = verifyRunDir(runDir),
): { ok: true; sha256: string; bytes: string } | { ok: false; refusal: string } {
  const blocking = violations.filter((violation) => !violation.path.startsWith(TELEMETRY_PREFIX));
  if (blocking.length > 0) {
    return {
      ok: false,
      refusal: `run dir fails the ownership check: ${blocking.map((v) => `[${v.code}] ${v.path}`).join(", ")}`,
    };
  }
  const expected = readManifest(runDir)?.files[rel];
  if (expected === undefined) return { ok: false, refusal: `recorded manifest has no ${rel} entry` };
  let bytes: string;
  try {
    bytes = readFileSync(join(runDir, rel), "utf8");
  } catch (error) {
    return {
      ok: false,
      refusal: `${rel}: unreadable after the ownership check (${errorMessage(error)})`,
    };
  }
  if (sha256(bytes) !== expected) {
    return {
      ok: false,
      refusal: `${rel}: bytes changed between the ownership check and this read — refused as tampered`,
    };
  }
  return { ok: true, sha256: expected, bytes };
}

/** Accept only the manifest schema this reader understands, and only the rows it can read.
 *  Otherwise a plausible `files` map with a missing or unknown schemaVersion could be treated as
 *  evidence under rules the reader has never validated (2026-08-03 evidence-reader audit).
 *
 *  The parsed value is read from `JsonValue` rather than asserted into `Manifest`. The assertion
 *  used to run before the guard, which left every clause of the guard dead to the checker while it
 *  stayed the only protection at runtime, and it stopped short of the values: a `files` entry
 *  holding a number reached `sha256(bytes) !== expected` as a non-string and was reported as a
 *  changed file rather than as a manifest this reader cannot read. A manifest whose rows are not
 *  the digests and append records this reader compares is now `run-unrecorded`, which is the
 *  refusal the sentence above already promised. */
function readManifest(runDir: string): Manifest | null {
  const path = join(runDir, RUN_MANIFEST_NAME);
  if (!existsSync(path)) return null;
  let parsed: JsonValue;
  try {
    parsed = readJsonFile(path);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== "evidence-stage/v1") return null;
  const recorded = parsed.files;
  const appended = parsed.appends ?? {};
  if (!isRecord(recorded) || !isRecord(appended)) return null;
  const files: Record<string, string> = {};
  for (const [rel, digest] of Object.entries(recorded)) {
    if (!isString(digest)) return null;
    files[rel] = digest;
  }
  const appends: Record<string, { sha256: string; bytes: number }> = {};
  for (const [rel, row] of Object.entries(appended)) {
    if (!isRecord(row) || !isString(row.sha256) || !isNumber(row.bytes)) return null;
    appends[rel] = { sha256: row.sha256, bytes: row.bytes };
  }
  return { schemaVersion: "evidence-stage/v1", files, appends };
}

/** Walk with lstat semantics: symlinks are reported irregular, never followed or recursed. */
function walkFiles(root: string, prefix = ""): Array<{ rel: string; irregular: boolean }> {
  const out: Array<{ rel: string; irregular: boolean }> = [];
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walkFiles(join(root, entry.name), rel));
    else out.push({ rel, irregular: !entry.isFile() });
  }
  return out;
}

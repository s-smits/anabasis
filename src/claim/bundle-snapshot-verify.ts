/**
 * Identity verification of a bundle snapshot or candidate tree: the three hashes the fingerprint
 * committed to must be the hashes of the bytes about to execute. Split from bundle-snapshot.ts, which
 * keeps promotion and lookup; every failure here is a product integrity fact.
 */
import { existsSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { hashBundle } from "./bundle-hash.ts";
import { BATTERY_FILES, type FingerprintEvidence, batteryHash } from "./fingerprint.ts";

/** Executed-vs-fingerprinted drift, snapshot tampering, or a copy that failed integrity: always a product
 *  integrity fact, never an environment blocker. */
class BundleSnapshotIntegrityError extends Error {
  constructor(detail: string) {
    super(`EXECUTED_BUNDLE_DRIFT: ${detail}`);
    this.name = "BundleSnapshotIntegrityError";
  }
}

/**
 * The one owner of battery drift detection. The battery pair sits outside correctnessModelHash by design
 * (battery identity is its own commitment), so its bytes are hashed directly and compared to the fingerprinted
 * `taskSetHash`. `verifyTree` uses this while creating or reading the snapshot; conformance evidence uses it
 * on the LIVE slug tree, because it evaluates from the live `correctness-model/tasks.json` while
 * `ensureBundleSnapshot` on a rerun only rechecks the existing snapshot, never the live
 * file. `treeRoot` is the directory that contains `correctness-model/tasks.json`. A mismatch is a product
 * integrity fact, never an environment blocker.
 */
export function assertTaskSetMatchesFingerprint(
  treeRoot: string,
  fingerprintTaskSetHash: string | null,
  what: string,
): void {
  const taskSetHash = batteryHash(join(treeRoot, "correctness-model"));
  if ((taskSetHash ?? null) !== (fingerprintTaskSetHash ?? null)) {
    throw new BundleSnapshotIntegrityError(
      `${what} battery files hash ${String(taskSetHash).slice(0, 16)}, fingerprint says ${String(fingerprintTaskSetHash).slice(0, 16)} — task identity drifted`,
    );
  }
}

/** Re-hash a bundle snapshot (or candidate) tree and refuse on any identity mismatch. */
export function verifyTree(
  dir: string,
  fingerprint: Pick<FingerprintEvidence, "agentHash" | "correctnessModelHash" | "taskSetHash">,
  what: string,
): void {
  if (!existsSync(join(dir, "agent")) || !existsSync(join(dir, "correctness-model"))) {
    throw new BundleSnapshotIntegrityError(
      `${what} at ${dir} is missing its agent/ or correctness-model/ bundle`,
    );
  }
  const agent = hashBundle(join(dir, "agent"));
  const correctnessModel = hashBundle(join(dir, "correctness-model"), { excludeTop: [...BATTERY_FILES] });
  if (agent.hash !== fingerprint.agentHash) {
    throw new BundleSnapshotIntegrityError(
      `${what} agent bundle hashes ${agent.hash.slice(0, 16)}…, fingerprint says ${fingerprint.agentHash.slice(0, 16)}… — the executed code would not be the fingerprinted code`,
    );
  }
  if (correctnessModel.hash !== fingerprint.correctnessModelHash) {
    throw new BundleSnapshotIntegrityError(
      `${what} correctnessModel bundle hashes ${correctnessModel.hash.slice(0, 16)}…, fingerprint says ${fingerprint.correctnessModelHash.slice(0, 16)}…`,
    );
  }
  // The battery pair sits outside correctnessModelHash by design; the shared owner hashes it directly.
  assertTaskSetMatchesFingerprint(dir, fingerprint.taskSetHash, what);
}

/**
 * The immutable execution bundle snapshot: a battery executes a content-addressed, atomically
 * promoted, read-only copy of the slug tree. Its identity is re-verified when loaded, so
 * "executed = fingerprinted" follows from the import location rather than loop discipline.
 *
 * Layout: `<slugDir>/.bundle-snapshots/<agent16>-<correctnessModel16>-<tasks16>/{agent,correctnessModel}/...`.
 * This sits beside `.build/` and `runs/` and never enters the bundle hashes. Creation copies to a
 * temporary directory, checks the hashes, and renames it atomically. A repeated id is verified and reused.
 */
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "../meta/filesystem.ts";
import { basename, dirname, join } from "../meta/path.ts";
import { BATTERY_FILES, type FingerprintEvidence } from "./fingerprint.ts";
import {
  BundleSnapshotIntegrityError,
  assertTaskSetMatchesFingerprint,
  verifyTree,
} from "./bundle-snapshot-verify.ts";

export { BundleSnapshotIntegrityError, assertTaskSetMatchesFingerprint };
import { runtimeProcess } from "../meta/process.ts";
import { WORKSPACE_TOOL_TREE } from "../verify/wall-policy.ts";

export interface BundleSnapshot {
  /** Content-addressed snapshot id: `<agent16>-<correctnessModel16>-<tasks16|no-tasks>`. */
  id: string;
  /** Absolute snapshot root. Load `agent/tools.ts` and `correctness-model/*` here, never from the live slug tree. */
  dir: string;
  agentHash: string;
  correctnessModelHash: string;
  /** The scoring program's identity (`scoring-closure.ts`), carried so a battery record names the
   *  product it measured by what scored it rather than by every byte of the package. */
  scoringHash: string;
  taskSetHash: string | null;
  /** Realpath of the candidate workspace's `.toolchain`, or null. This machine-local path never
   *  enters a travelling digest. */
  toolTree: string | null;
}

export const BUNDLE_SNAPSHOT_DIRECTORY = ".bundle-snapshots";
export const EARLIER_BUNDLE_SNAPSHOT_DIRECTORY = ".sealed-bundles";

/** Resolve a tool tree from a workspace, adopted domain, or current/earlier snapshot. */
export function bundleSnapshotToolTree(dir: string): string | null {
  const parent = basename(dirname(dir));
  const workspace =
    parent === BUNDLE_SNAPSHOT_DIRECTORY || parent === EARLIER_BUNDLE_SNAPSHOT_DIRECTORY
      ? dirname(dirname(dir))
      : dir;
  try {
    return realpathSync.native(join(workspace, WORKSPACE_TOOL_TREE));
  } catch {
    return null;
  }
}

/** Link a candidate's tool tree into `workspace`, replacing whatever tree is there. A link and not
 *  a copy, because toolchain bytes sit outside the fingerprint: copying them would duplicate a
 *  domain toolchain at every carry without changing a single identity anything verifies.
 *
 *  Both carries of an accepted bundle go through this one function — the seeded authoring
 *  workspace in domain-repo.ts and the retained version in product-versions.ts — because a bundle
 *  that arrives without its tool tree is a bundle whose external checks have no instrument to run.
 *  The climb lost three rounds on 2026-09-02 to exactly that omission. */
export function linkWorkspaceToolTree(from: string, workspace: string): void {
  const tooling = bundleSnapshotToolTree(from);
  if (tooling === null || bundleSnapshotToolTree(workspace) === tooling) return;
  rmSync(join(workspace, WORKSPACE_TOOL_TREE), { recursive: true, force: true });
  symlinkSync(tooling, join(workspace, WORKSPACE_TOOL_TREE));
}

export function bundleSnapshotIdOf(
  fingerprint: Pick<FingerprintEvidence, "agentHash" | "correctnessModelHash" | "taskSetHash">,
): string {
  const tasks = fingerprint.taskSetHash === null ? "no-tasks" : fingerprint.taskSetHash.slice(0, 16);
  return `${fingerprint.agentHash.slice(0, 16)}-${fingerprint.correctnessModelHash.slice(0, 16)}-${tasks}`;
}

function bundleSnapshotDirOf(
  slugDir: string,
  fingerprint: FingerprintEvidence,
  directory = BUNDLE_SNAPSHOT_DIRECTORY,
): string {
  return join(slugDir, directory, bundleSnapshotIdOf(fingerprint));
}

function evidenceOf(fingerprint: FingerprintEvidence, dir: string): BundleSnapshot {
  return {
    id: bundleSnapshotIdOf(fingerprint),
    dir,
    agentHash: fingerprint.agentHash,
    correctnessModelHash: fingerprint.correctnessModelHash,
    scoringHash: fingerprint.scoringHash,
    taskSetHash: fingerprint.taskSetHash,
    toolTree: bundleSnapshotToolTree(dir),
  };
}

let promoteSeq = 0;

/**
 * Copy the current slug tree into its snapshot. Refuse drift, a copy that fails verification, or
 * a competing copy with different bytes; a concurrent identical snapshot is verified and reused.
 */
export function createBundleSnapshot(
  slugDir: string,
  fingerprint: FingerprintEvidence,
  storageRoot = slugDir,
): BundleSnapshot {
  verifyTree(slugDir, fingerprint, "slug tree (promote source)");
  const target = bundleSnapshotDirOf(storageRoot, fingerprint);
  if (existsSync(target)) {
    verifyTree(target, fingerprint, "existing bundle snapshot");
    return evidenceOf(fingerprint, target);
  }
  promoteSeq += 1;
  const tmp = join(storageRoot, BUNDLE_SNAPSHOT_DIRECTORY, `.tmp-${runtimeProcess.pid}-${promoteSeq}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  try {
    // Copy exactly the fingerprinted file lists (plus the separately-committed battery pair) — a stray
    // unhashed file in the slug tree never enters the bundle snapshot.
    const entries: Array<{ from: string; to: string }> = [
      ...fingerprint.agentFiles.map((f) => ({
        from: join(slugDir, "agent", f.path),
        to: join(tmp, "agent", f.path),
      })),
      ...fingerprint.correctnessModelFiles.map((f) => ({
        from: join(slugDir, "correctness-model", f.path),
        to: join(tmp, "correctness-model", f.path),
      })),
      ...(fingerprint.taskSetHash === null
        ? []
        : BATTERY_FILES.filter((name) => existsSync(join(slugDir, "correctness-model", name))).map(
            (name) => ({
              from: join(slugDir, "correctness-model", name),
              to: join(tmp, "correctness-model", name),
            }),
          )),
    ];
    for (const { from, to } of entries) {
      mkdirSync(dirname(to), { recursive: true });
      cpSync(from, to);
    }
    verifyTree(tmp, fingerprint, "promoted copy");
    for (const { to } of entries) chmodSync(to, 0o444);
    try {
      renameSync(tmp, target);
    } catch {
      // Another creator won the rename. Its snapshot has the same content address; check and reuse it.
      rmSync(tmp, { recursive: true, force: true });
      verifyTree(target, fingerprint, "existing bundle snapshot (concurrent creation)");
    }
    return evidenceOf(fingerprint, target);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Check the existing snapshot or create it from a fingerprint-identical slug tree. */
export function ensureBundleSnapshot(slugDir: string, fingerprint: FingerprintEvidence): BundleSnapshot {
  // The gates receive the promoted snapshot, not the live tree, so a snapshot arriving here is
  // reused where it stands. Nesting a second copy under <snapshot>/.bundle-snapshots would move
  // the bundle's parent away from the workspace whose `.toolchain` tool admission derives from,
  // and loop-3 (2026-08-23) refused every declared toolchain read root at the F2 census that way,
  // on submit and check alike.
  const parent = basename(dirname(slugDir));
  if (
    basename(slugDir) === bundleSnapshotIdOf(fingerprint) &&
    (parent === BUNDLE_SNAPSHOT_DIRECTORY || parent === EARLIER_BUNDLE_SNAPSHOT_DIRECTORY)
  ) {
    verifyTree(slugDir, fingerprint, "bundle snapshot");
    return evidenceOf(fingerprint, slugDir);
  }
  const target = bundleSnapshotDirOf(slugDir, fingerprint);
  if (existsSync(target)) {
    verifyTree(target, fingerprint, "bundle snapshot");
    return evidenceOf(fingerprint, target);
  }
  const earlier = bundleSnapshotDirOf(slugDir, fingerprint, EARLIER_BUNDLE_SNAPSHOT_DIRECTORY);
  if (existsSync(earlier)) {
    verifyTree(earlier, fingerprint, "earlier bundle snapshot");
    return evidenceOf(fingerprint, earlier);
  }
  return createBundleSnapshot(slugDir, fingerprint);
}

/**
 * Launch-time removal of this product's own leaked mkdtemp scratch from the OS temp root. A SIGKILL
 * skips exit-handler cleanup, and a crowded temp root stalls every fresh child that enumerates it.
 *
 * The launch path never deletes an unbounded tree itself. Each eligible top-level directory is
 * renamed into one private quarantine in the same temp root, and one detached `rm -rf` reclaims
 * the quarantine off the critical path. Only real directories with this product's prefixes, older
 * than STALE_AGE_MS and not a process-lifetime bundle, move. The scan checks its deadline between
 * entries and guards each metadata read and rename.
 */
import { lstatSync, mkdtempSync, opendirSync, renameSync, rmdirSync } from "./filesystem.ts";
import { tmpdir } from "./os.ts";
import { join } from "./path.ts";
import { TEMP_SCRATCH_PREFIXES } from "./safeguard.ts";

export const STALE_AGE_MS = 48 * 60 * 60 * 1000;
export const TEMP_SCRATCH_QUARANTINE_PREFIX = ".ana-stale-quarantine-";
const CLEAN_DEADLINE_MS = 20_000;

/** Worker bundles a controller keeps for its whole life (pi-built.ts,
 *  generated-tool-worker-process.ts). Their mtime never moves and a controller may outlive
 *  STALE_AGE_MS, so age does not prove them abandoned. */
const PROCESS_LIFETIME_PREFIXES = ["ana-pi-built-", "ana-generated-tools-"] as const;

interface TempScratchCleanReport {
  /** Entries removed from the temp root into a private quarantine directory. */
  readonly removed: number;
  /** Matching stale entries whose metadata read or rename failed; left in place. */
  readonly failed: number;
  /** True when the deadline stopped the walk before the directory was fully read. */
  readonly deadlineHit: boolean;
  /** Pid of the detached reclaimer removing the quarantine; null when nothing moved or it failed to start. */
  readonly reclaimerPid: number | null;
}

interface TempScratchCleanOptions {
  /** Skip the detached reclaimer and keep the quarantine on disk; tests read its contents. */
  readonly reclaim?: boolean;
}

/** Start one unreferenced `rm -rf` over the quarantine; on failure the quarantine stays. */
function startQuarantineReclaimer(quarantine: string): number | null {
  try {
    const child = Bun.spawn(["rm", "-rf", "--", quarantine], { stdio: ["ignore", "ignore", "ignore"] });
    child.unref();
    return child.pid;
  } catch {
    return null;
  }
}

export function cleanStaleTempRootScratch(
  root: string = tmpdir(),
  options: TempScratchCleanOptions = {},
): TempScratchCleanReport {
  const deadline = Date.now() + CLEAN_DEADLINE_MS;
  let removed = 0;
  let failed = 0;
  let deadlineHit = false;
  let quarantine: string | null = null;
  try {
    const handle = opendirSync(root);
    try {
      for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
        if (Date.now() >= deadline) {
          deadlineHit = true;
          break;
        }
        if (!TEMP_SCRATCH_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) continue;
        if (PROCESS_LIFETIME_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) continue;
        const path = join(root, entry.name);
        try {
          const metadata = lstatSync(path);
          if (!metadata.isDirectory() || Date.now() - metadata.mtimeMs < STALE_AGE_MS) continue;
          quarantine ??= mkdtempSync(join(root, TEMP_SCRATCH_QUARANTINE_PREFIX));
          renameSync(path, join(quarantine, entry.name));
          removed += 1;
        } catch {
          failed += 1;
        }
      }
    } finally {
      handle.closeSync();
    }
  } catch {
    // A temp root this process may not walk leaves nothing to clean, and never a launch failure.
  }
  let reclaimerPid: number | null = null;
  if (quarantine !== null && removed === 0) {
    try {
      rmdirSync(quarantine);
    } catch {
      // A raced or unwritable quarantine is still outside the product-prefix scan.
    }
  } else if (quarantine !== null && options.reclaim !== false) {
    reclaimerPid = startQuarantineReclaimer(quarantine);
  }
  return { removed, failed, deadlineHit, reclaimerPid };
}

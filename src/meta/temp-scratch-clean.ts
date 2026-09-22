/**
 * Launch-time removal of this product's own leaked mkdtemp scratch from the OS temp root. Measured
 * 2026-08-30/31: the per-user root held 171,290 entries, about 150,000 of them product scratch
 * directories from gates and campaigns whose exit-handler cleanup a SIGKILL skipped. Every fresh
 * child process then stalled enumerating that root.
 *
 * The launch path must not recursively delete an unbounded stale tree. It therefore moves each
 * eligible top-level directory into one fresh, private quarantine directory in the same temp root.
 * A same-filesystem rename removes the expensive top-level entry without walking its contents;
 * recursive disk reclamation runs in one detached `rm -rf` child over the quarantine, outside the
 * controller's critical path and its exit. Only real directories carrying this product's prefixes
 * and older than STALE_AGE_MS move, and the two process-lifetime bundles a running controller keeps
 * for its whole life are skipped by name (PROCESS_LIFETIME_PREFIXES), because a campaign may outlive
 * any age window. The scan checks its deadline between entries, and each metadata read or rename is
 * individually guarded.
 */
import { lstatSync, mkdtempSync, opendirSync, renameSync, rmdirSync } from "./filesystem.ts";
import { tmpdir } from "./os.ts";
import { join } from "./path.ts";
import { TEMP_SCRATCH_PREFIXES } from "./safeguard.ts";

export const STALE_AGE_MS = 48 * 60 * 60 * 1000;
export const TEMP_SCRATCH_QUARANTINE_PREFIX = ".ana-stale-quarantine-";
const CLEAN_DEADLINE_MS = 20_000;

/** Scratch created once per controller process and removed at its exit: the Pi Built worker
 *  bundle (pi-built.ts) and each generated-tool worker bundle (generated-tool-worker-process.ts).
 *  Their root mtime never moves after the bundle is written, while the controller that owns them
 *  may run past STALE_AGE_MS without a time cap. Another launch therefore cannot assume that
 *  age means these directories were abandoned. A SIGKILL may leave them for separate cleanup. */
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

/**
 * Start one detached `rm -rf` over the quarantine. The child is unreferenced so a controller exit
 * does not wait for it. If starting it fails, the quarantine remains for separate cleanup.
 */
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

/**
 * Runtime observations of conditions no existing evidence field records. A safeguard never changes
 * the decision it observes: it prints one line to stderr and, best-effort, appends it to
 * SAFEGUARDS_LOG.txt under the run's safeguards directory.
 *
 * It writes to stderr because stdout carries protocol data for truth checks and child workers.
 *
 * `bun run outcome -- --safeguards <campaignDir...>` joins receipts against the inventory; missing
 * evidence is inconclusive, never zero. The safeguards skill owns the lifecycle. Where an evidence
 * writer can record the condition, a field on that writer replaces the sensor.
 */
import { appendFileSync, mkdirSync, opendirSync } from "./filesystem.ts";
import { tmpdir } from "./os.ts";
import { join } from "./path.ts";

export const SAFEGUARDS_LOG_FILE = "SAFEGUARDS_LOG.txt";

/** Every live safeguard name with the date its emission entered source. The name is the log-line
 *  join key; a test pins this list equal to the names emitted from src/. */
export const SAFEGUARD_INVENTORY: ReadonlyArray<{ readonly name: string; readonly introduced: string }> = [
  { name: "21-tempdir-spawn-hazard", introduced: "2026-08-31" },
  { name: "31-diagnosis-packet-budget", introduced: "2026-09-05" },
  { name: "32-command-guard-unanswered", introduced: "2026-09-06" },
  { name: "33-preview-clear-submit-refused", introduced: "2026-09-06" },
  { name: "40-refused-submit-repeated-code", introduced: "2026-09-07" },
  { name: "45-case-grading-skipped", introduced: "2026-09-11" },
  { name: "48-judge-disagreement-at-former-block-threshold", introduced: "2026-09-14" },
  { name: "49-judge-passed-every-reviewed-case", introduced: "2026-09-14" },
  { name: "50-judge-advice-then-evaluator-only-repair", introduced: "2026-09-14" },
  { name: "52-rebuild-seed-tool-tree-unresolved", introduced: "2026-09-15" },
  { name: "53-rebuild-seed-copy-leftover", introduced: "2026-09-15" },
  { name: "54-rebuild-seed-tool-tree-copied", introduced: "2026-09-15" },
  { name: "55-rebuild-seed-venv-home-in-adopted-tree", introduced: "2026-09-15" },
  { name: "56-rebuild-workspace-resumed-dirty", introduced: "2026-09-15" },
];

/** The log location of one resolved controller run, passed explicitly rather than read from cwd. */
export interface SafeguardContext {
  readonly logDir: string;
}

/** Keep each call on one short, searchable line. */
const DETAIL_MAX_CHARS = 500;

const TEMP_SCAN_CAP = 5000;
const TEMP_SCRATCH_CEILING = 1000;

interface TempRootScratchScan {
  /** Entries read before the cap stopped the walk. */
  readonly scanned: number;
  /** Of those, entries named with one of this product's own mkdtemp prefixes. */
  readonly matched: number;
  /** True when the walk stopped at the cap, so the root holds at least TEMP_SCAN_CAP entries. */
  readonly capped: boolean;
}

/** Derive the log location from the controller's existing campaign and base-run identity. */
export function safeguardLogDir(campaignDir: string, runId: string): string {
  return join(campaignDir, "safeguards", runId);
}

export function createSafeguardContext(logDir: string): SafeguardContext {
  return { logDir };
}

/** A caller with no resolved run context gets the stderr line and writes no file. */
export function safeguardTriggered(name: string, detail: string, context?: SafeguardContext): void {
  const flat = detail.replace(/\s+/g, " ").trim().slice(0, DETAIL_MAX_CHARS);
  const line = `${new Date().toISOString()} | ${name} | ${flat}`;
  try {
    console.error(`[safeguard] ${line}`);
  } catch {
    // A replaced or closed stderr must not change the watched controller path.
  }
  if (context === undefined) return;
  try {
    mkdirSync(context.logDir, { recursive: true });
    appendFileSync(`${context.logDir}/${SAFEGUARDS_LOG_FILE}`, `${line}\n`);
  } catch {
    // Best-effort: an unwritable working directory must not turn an observation into a crash.
  }
}

/** The product's own mkdtemp prefixes, shared by this sensor and the launch-time cleaner. */
export const TEMP_SCRATCH_PREFIXES = ["ana-"] as const;

/**
 * Safeguard 21: leaked mkdtemp scratch in a large OS temp root stalls every fresh child spawn in
 * directory enumeration, which the run records only as a handshake or provider timeout.
 *
 * One bounded, throw-free walk: it streams the directory and stops at TEMP_SCAN_CAP entries, so the
 * sensor never becomes the enumeration it watches. A capped walk is itself the hazard, since the
 * stall cost is per entry. An unreadable or absent root reports what it counted.
 */
export function scanTempRootScratch(root: string): TempRootScratchScan {
  let scanned = 0;
  let matched = 0;
  let capped = false;
  try {
    const handle = opendirSync(root);
    try {
      for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
        scanned += 1;
        if (TEMP_SCRATCH_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) matched += 1;
        if (scanned >= TEMP_SCAN_CAP) {
          capped = true;
          break;
        }
      }
    } finally {
      handle.closeSync();
    }
  } catch {
    // A temp root this process may not walk is not an observation, and never a launch failure.
  }
  return { scanned, matched, capped };
}

export function tempRootScratchPressure(scan: TempRootScratchScan): boolean {
  return scan.capped || scan.matched >= TEMP_SCRATCH_CEILING;
}

/** Called once at controller launch. Log-and-print only; the launch proceeds unchanged. */
export function safeguardTempRootPressure(context?: SafeguardContext, root?: string): void {
  const target = root ?? tmpdir();
  const scan = scanTempRootScratch(target);
  if (!tempRootScratchPressure(scan)) return;
  safeguardTriggered(
    "21-tempdir-spawn-hazard",
    `controller launch: the OS temp root ${target} holds ${String(scan.matched)} ${TEMP_SCRATCH_PREFIXES.join("/")} scratch entries within its first ${String(scan.scanned)}${scan.capped ? " (walk stopped at the scan cap)" : ""}; ceiling ${String(TEMP_SCRATCH_CEILING)} matched, cap ${String(TEMP_SCAN_CAP)} scanned. Leaked mkdtemp scratch stalls every fresh child spawn in getdirentries64 and is recorded as a provider or handshake timeout`,
    context,
  );
}

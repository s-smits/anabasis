/**
 * Runtime observations of conditions that a whole-run review found and that no existing evidence
 * field recorded. A safeguard leaves the decision it observes exactly as it was: it prints one line
 * to stderr and appends the same line to SAFEGUARDS_LOG.txt under the run's safeguards directory,
 * so the condition has both a visible and a saved record tied to the resolved run even when the
 * battery evidence and the terminal reason have no field that describes it.
 *
 * Both halves of that are best-effort by contract. A safeguard that cannot write its log line must
 * not throw into the path it is watching, because the stderr print has already surfaced the
 * observation and a sensor that crashes a run has changed the thing it was meant to measure.
 *
 * The print goes to stderr rather than stdout because stdout carries protocol data: an installed
 * tool's stdout is the answer a truth check reads, and the generated-tool and Built Harness
 * children speak their protocols over it. Any module may call this helper, so a `console.log` here
 * would eventually corrupt the output a truth check or a protocol reader consumes.
 *
 * `bun run outcome -- --safeguards <campaignDir...>` joins the receipts against the inventory
 * below, and missing evidence reads as inconclusive rather than as zero firings; the safeguards
 * skill owns the rest of the lifecycle. The rule for retirement is the one that keeps this file
 * small: where an evidence writer can record the condition, a field on that writer replaces the
 * sensor, because a recorded field is read with one query while a log line has to be counted by
 * hand across symlinked campaign copies.
 */
import { appendFileSync, mkdirSync, opendirSync } from "./filesystem.ts";
import { tmpdir } from "./os.ts";
import { join } from "./path.ts";

export const SAFEGUARDS_LOG_FILE = "SAFEGUARDS_LOG.txt";

/** What `safeguardTriggered` puts in front of the same line on stderr, so a captured stderr can be
 *  read by the log parser once the prefix is stripped. */
export const SAFEGUARD_STDERR_PREFIX = "[safeguard] ";

/** The exact line shape `safeguardTriggered` writes: `<iso timestamp> | <name> | <detail>`. */
const LOG_LINE = /^(\d{4}-\d{2}-\d{2}T\S+) \| (\S+) \| /;

interface SafeguardFiring {
  readonly at: string;
  readonly name: string;
}

interface SafeguardLogReading {
  readonly firings: readonly SafeguardFiring[];
  /** Firings per name, in first-seen order. */
  readonly counts: ReadonlyMap<string, number>;
  /** Non-blank lines that did not match the writer's shape. They are counted rather than skipped,
   *  so a change to the writer shows up as malformed lines instead of as sensors that went quiet. */
  readonly malformed: number;
}

/**
 * Every live safeguard name with the date its emission entered source. The name is what joins a
 * log line back to its one emit site, and test/safeguard.test.ts pins this list equal to the names
 * literally emitted from `src/`, so a sensor cannot be added or removed without moving its row
 * here and the lifecycle report cannot drift away from what actually fires.
 *
 * The gaps in the numbering are retirements rather than accidents, and they are what the rule in
 * the header looks like in practice: a sensor goes when something that is read with one query
 * records the same thing. Safeguards 24 and 25 fired in their first live runs and became the
 * claim's recorded `blockingByCheck` and `executedByCheck` counts. Safeguards 42 to 47 went once epoch
 * review and Builder execution evidence recorded continuations, severity adjustments, citation
 * refusals and failed reviews as fields of their own, and 31 went when the diagnosis reading
 * recorded the issues its packet withheld as a count. The other reason a sensor goes is that it
 * turned out to be watching correct behaviour: 35 reported the diagnosis roster being cut to its
 * declared six-issue cap, which is the cap doing its job.
 */
export const SAFEGUARD_INVENTORY: ReadonlyArray<{ readonly name: string; readonly introduced: string }> = [
  { name: "21-tempdir-spawn-hazard", introduced: "2026-08-31" },
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

/** The log location of one resolved controller run. It is passed explicitly rather than derived
 *  from the process working directory, because fullrun runs work for several owners in one process
 *  and signal-close callbacks fire long after the cwd stopped identifying anyone; an explicit owner
 *  keeps every line attributable to the run that produced it. */
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

/** The log file itself, for readers that start from a campaign and a run id. */
export function safeguardLogFile(campaignDir: string, runId: string): string {
  return join(safeguardLogDir(campaignDir, runId), SAFEGUARDS_LOG_FILE);
}

/**
 * Read log text back through the one line shape the writer above produces. Only lines beginning
 * with `prefix` are read, with the prefix stripped: the empty default reads a SAFEGUARDS_LOG file
 * whole, and `SAFEGUARD_STDERR_PREFIX` picks the safeguard lines out of a captured stderr that
 * also carries everything else the process printed.
 */
export function parseSafeguardLog(text: string, prefix = ""): SafeguardLogReading {
  const firings: SafeguardFiring[] = [];
  const counts = new Map<string, number>();
  let malformed = 0;
  for (const raw of text.split("\n")) {
    if (raw.trim() === "" || !raw.startsWith(prefix)) continue;
    const match = LOG_LINE.exec(raw.slice(prefix.length));
    if (match?.[1] === undefined || match[2] === undefined) {
      malformed += 1;
      continue;
    }
    firings.push({ at: match[1], name: match[2] });
    counts.set(match[2], (counts.get(match[2]) ?? 0) + 1);
  }
  return { firings, counts, malformed };
}

export function createSafeguardContext(logDir: string): SafeguardContext {
  return { logDir };
}

/** A caller with no resolved run context gets the stderr line and writes no file. Taking an
 *  arbitrary directory instead would put durable receipts where no campaign reader ever looks,
 *  which is how an observation ends up recorded and still invisible. */
export function safeguardTriggered(name: string, detail: string, context?: SafeguardContext): void {
  const flat = detail.replace(/\s+/g, " ").trim().slice(0, DETAIL_MAX_CHARS);
  const line = `${new Date().toISOString()} | ${name} | ${flat}`;
  try {
    console.error(`${SAFEGUARD_STDERR_PREFIX}${line}`);
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

/** The product's own mkdtemp prefixes, exported so this sensor and the launch-time cleaner in
 *  temp-scratch-clean.ts read the same list: a sensor counting one prefix while the cleaner
 *  removed another would report pressure nothing was clearing. */
export const TEMP_SCRATCH_PREFIXES = ["ana-"] as const;

/**
 * Safeguard 21: the per-user OS temp root has held 171,290 entries, about 150,000 of them leaked
 * mkdtemp scratch directories from earlier gates and campaigns whose cleanup lives in exit handlers
 * that a SIGKILL never reaches. Every fresh child process then stalls inside a single directory
 * enumeration, so the codex app-server and the Pi Built worker die on their ready handshakes while
 * established processes carry on untouched and tens of gigabytes of disk stay free. The run records
 * those deaths as provider or protocol timeouts, with nothing in the evidence naming the directory
 * that caused them.
 *
 * The walk is bounded twice, because the sensor must never become the enumeration it watches: it
 * streams the directory rather than materialising its names, and it stops at TEMP_SCAN_CAP
 * entries. Stopping at the cap is itself a report of the hazard rather than a failure to measure
 * it, since the stall cost is per entry and not per match. An unreadable or absent root reports
 * what it counted, which for an absent root is nothing at all.
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

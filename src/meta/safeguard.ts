/**
 * Runtime observations for problems found in whole-run reviews that existing evidence did not
 * record. A safeguard leaves the decision unchanged. It appends a line to SAFEGUARDS_LOG.txt
 * under the run's safeguards directory and prints that line to stderr, identifying when the
 * observed condition occurred. This gives both a saved and a visible record associated with
 * the resolved run, even when the battery evidence or terminal reason has no field describing
 * that condition.
 *
 * Best-effort by contract: a safeguard that cannot write its log line must not throw into the
 * decision it observes — the stderr print has already surfaced it.
 *
 * Write to stderr because stdout carries protocol data: an installed tool's stdout is
 * the answer a truth check reads (src/verify/host.ts), and the generated-tool and Built-harness
 * children use it too. Since any module can call this helper, console.log could corrupt the
 * output consumed by a truth check or protocol reader. Logging an observation must not change
 * the result being observed.
 *
 * Lifecycle (operator decision 2026-09-07): retirement belongs to weekly review, with at least
 * two eligible opportunities and complete capture before quiet observations support removal.
 * `bun run outcome -- --safeguards <campaignDir...>` joins receipts against the inventory;
 * missing evidence is inconclusive, never zero. The safeguards skill owns the full contract.
 *
 * Use a safeguard when no existing evidence writer records the observation. When one does — a
 * terminal reason, an admission packet, a census file — a field on that writer replaces the sensor:
 * a recorded field is read with one query, while a log line is counted by hand across symlinked
 * campaign copies. 2026-09-02: the dropped deferred owner became `plan.dropped` on the admission
 * packet, unpublished-name screening rows became `advisory` in census.json, and the execution-
 * environment matcher went because the run terminal already records that message as its reason.
 */
import { appendFileSync, mkdirSync, opendirSync } from "./filesystem.ts";
import { tmpdir } from "./os.ts";
import { join } from "./path.ts";

export const SAFEGUARDS_LOG_FILE = "SAFEGUARDS_LOG.txt";

/** Every live safeguard name with the date its emission entered source. The name is the join key
 * for log lines and greppable to its one emit site; test/safeguard.test.ts pins this list equal to
 * the literals actually emitted from src/, so a removed or added safeguard must move its row. */
export const SAFEGUARD_INVENTORY: ReadonlyArray<{ readonly name: string; readonly introduced: string }> = [
  { name: "21-tempdir-spawn-hazard", introduced: "2026-08-31" },
  // 23 lives in src/truth/run-safeguards.ts, the last of the 2026-09-03 checklist sensors. 24 and
  // 25 fired in their first live runs (2026-09-04/05) and became the recorded `blockingByCheck`
  // and `executedByCheck` fields of the battery firing counts; 22 and 26 never fired across 94
  // campaign logs and were removed on 2026-09-06.
  // 27 to 30 watched a Builder-declared engine registry — an unreferenced tool tree, an unreached
  // spawning function, a read root outside the tree, a materialized file shadowing an installed
  // one. The registry is gone: a check names an installed tool and the host resolves it, so three
  // of those shapes cannot occur and the fourth is the unexecuted-grounding gate's.
  { name: "31-diagnosis-packet-budget", introduced: "2026-09-05" },
  // 32, 33 and 36 came from the 2026-09-06 simulation of PRs #519 to #573: each records a branch
  // found during review of the combined tree that no existing evidence field described.
  { name: "32-command-guard-unanswered", introduced: "2026-09-06" },
  { name: "33-preview-clear-submit-refused", introduced: "2026-09-06" },
  // 34 retired with memory curation on 2026-09-08; its definition remains in #605's parent.
  // 35 retired on 2026-09-17: it reported the diagnosis roster being cut to MAX_DIAGNOSED_ISSUES,
  // which is the declared six-issue cap working, not a defect; 31 still watches omission from the
  // roster the packet was actually given. Never fired in 54 campaign logs.
  // 36 retired on 2026-09-21 with the transport turn driver it watched: a prompt delivery that
  // failed after the caller's abort had already won the race. Every slot now runs pi's session,
  // which aborts its own prompt loop, so no delivery races an abort. Its last definition is
  // src/backends/turn-runtime.ts at 7a99ff2b0.
  // 38 retired with the directory-based refusal on 2026-09-08; its definition remains in #569.
  // 37 and 39 retired on 2026-09-17, both quiet in 54 campaign logs and both already owned. 37
  // re-verified the whole run directory at every second record() to re-time a tear the claim
  // reader refuses anyway; 39 logged a stall counter recovering, which the recorded per-iteration
  // decisions already show as measure, measure, rebuild. Removing them also removes the two
  // SafeguardContext parameters that existed only to reach them.
  // 40 watches one defect refused once per task (run51, run52).
  // 41 retired with the code-selected difficulty route on 2026-09-09. Its last definition is
  // next-move.ts at 0bc53c9f2; proposals now use the recorded admission/submit refusal instead.
  { name: "40-refused-submit-repeated-code", introduced: "2026-09-07" },
  // 42, 43 and 46 retired on 2026-09-15: epoch review evidence records them as `admission`
  // (continuations, severity adjustments, citation refusals). Their last definitions are
  // src/review/epoch-reviewer.ts at 2dd1c7fb6.
  // 44 and 47 retired on 2026-09-15: Builder execution evidence records `authoringReviews`, with
  // null advice for a failed review. Their last definitions are src/author/builder-tool-receipts.ts
  // at 2dd1c7fb6.
  { name: "45-case-grading-skipped", introduced: "2026-09-11" },
  // 48 to 50 replace the Main Judge control census removed on 2026-09-14 (src/analyse/judge-
  // safeguards.ts): the disagreement floor that used to block, a Judge that passes everything,
  // and an evaluation-only repair right after Judge advice.
  { name: "48-judge-disagreement-at-former-block-threshold", introduced: "2026-09-14" },
  { name: "49-judge-passed-every-reviewed-case", introduced: "2026-09-14" },
  { name: "50-judge-advice-then-evaluator-only-repair", introduced: "2026-09-14" },
  // 52-56 watch rebuild seeding from the adopted version (simulation on run 298967's adopted
  // tree, 2026-09-15): a tool-tree link that no longer resolves seeds a repair with only the
  // runtime link and no record; the copy branch that relocates uv launchers had no evidence
  // writer; a copied venv keeps its pyvenv.cfg home in the adopted tree; a partial copy from an
  // interrupted pass stays beside the tree; a resumed repair carries uncommitted edits.
  { name: "52-rebuild-seed-tool-tree-unresolved", introduced: "2026-09-15" },
  { name: "53-rebuild-seed-copy-leftover", introduced: "2026-09-15" },
  { name: "54-rebuild-seed-tool-tree-copied", introduced: "2026-09-15" },
  { name: "55-rebuild-seed-venv-home-in-adopted-tree", introduced: "2026-09-15" },
  { name: "56-rebuild-workspace-resumed-dirty", introduced: "2026-09-15" },
  // 51 retired on 2026-09-15 with the eight-name cap it watched: census findings now name every
  // example. Its definition remains in src/truth/run-safeguards.ts at 3f211a067.
  // evaluator-process-refusal retired on 2026-09-13: it had no run context, so Astra 0912's 20
  // firings reached stderr only, and the refusal kind is already the case's or control's typed
  // runtime non-result, which the battery record stores.
];

/** The diagnostic channel belongs to one resolved controller run, never to process cwd. Fullrun
 * passes it explicitly so same-process concurrency and signal-close callbacks retain the owner. */
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

/** A caller with no resolved run owner keeps the stderr line and writes no file. Accepting an
 * arbitrary directory here once let callers put durable receipts where no campaign reader looks. */
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

/**
 * Safeguard 21, measured 2026-08-30/31: the per-user OS temp root held 171,290 entries, about
 * 150,000 of them leaked mkdtemp scratch directories from earlier gates and campaigns whose
 * cleanup lives in exit handlers that a SIGKILL never reaches. Every fresh child process then
 * stalls inside one `__getdirentries64` call enumerating that directory (state U), so the codex
 * app-server and the Pi Built worker both died on their ready handshakes while established
 * processes were unaffected and 14-20 GB of disk stayed free. The run records those deaths as
 * provider or protocol timeouts and nothing names the directory.
 *
 * The scan is bounded twice: it streams the directory rather than materialising its names, and it
 * stops at TEMP_SCAN_CAP entries — the sensor must never become the enumeration it watches. A
 * capped walk is itself the hazard shape, because the stall cost is per entry, not per match.
 */
/** The product's own mkdtemp prefixes, shared with the launch-time cleaner in
 *  temp-scratch-clean.ts so the sensor and the remedy cannot drift apart. */
export const TEMP_SCRATCH_PREFIXES = ["ana-"] as const;
/** One bounded, throw-free walk of a directory. An unreadable or absent root reports what it
 *  counted, which for an absent root is nothing. */
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

// A caller with no run context gets the stderr line once and no file: production fullruns
// always pass their own context, so this only keeps the helper callable from a bare script.

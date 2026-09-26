#!/usr/bin/env bun

/**
 * One reader for the runs a campaign is watching, and the watch that speaks when one of them
 * deviates.
 *
 * Without `--state` it prints each named run's status: its controller state, its batteries case by
 * case, the cases still open against the harness's own solve wall, what the bundle declares, how
 * far the Builder's session has got, the climb decisions, and — once the run has closed — the
 * advisories a closure reads first. With `--state` the same reading becomes a watch pass compared
 * against the snapshot stored there: an attended pass prints every row it has, and `--every N`
 * loops unattended, holding info rows until a stop row and exiting 3 on the first one.
 *
 * Every figure comes from a production owner. The controller's own strict reader decides the
 * terminal and the lock, the case-record reader and classifier decide the batteries, the bundle
 * validator decides what a task file holds, and the execution-record reader decides the Builder's
 * counts. Where an owner refuses, the field is null and the refusal is printed beside it, so a
 * reading the owner would not stand behind never arrives as a zero.
 */
import { existsSync, readdirSync, readFileSync, statfsSync, statSync } from "#src/meta/filesystem.ts";
import { dirname, join } from "#src/meta/path.ts";
import { campaignRoot } from "#src/meta/campaign-root.ts";
import { isString, asRecord } from "#src/meta/json-shape.ts";
import { readJsonFileOrNull, writeJsonFile } from "#src/meta/completed-json.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { parseSafeguardLog, safeguardLogFile } from "#src/meta/safeguard.ts";
import { bareCustomToolName } from "#src/author/builder-custom-tool-call.ts";
import { isCandidateSubmit } from "#src/author/builder-execution.ts";
import { readEpochRecord } from "#src/author/campaign-epoch.ts";
import { loadValidatedBundle } from "#src/author/candidate-check.ts";
import {
  CASE_RECORD_FILE,
  type CaseOutcome,
  classifyCaseOutcome,
  outcomeTally,
  readCaseRecord,
} from "#src/claim/case-record.ts";
import { batteryRunDirs } from "#src/claim/trace-read.ts";
import { isControllerBatteryRunId } from "#src/run/controller-battery-record-policy.ts";
import type { ControllerAbortClause } from "#src/run/controller-stop-evidence.ts";
import type { Denominator } from "#src/run/controller-denominator.ts";
import { type LoopTerminalCode, loopTerminalCode } from "#src/run/loop-terminal.ts";
import { DEFAULT_HARNESS_SETTINGS, HarnessConfigError, harnessSettings } from "#src/truth/harness-config.ts";
import { readExecutionEvidenceDetails } from "#tools/outcome/builder-execution-facts.ts";
import { findRun } from "#tools/runs/discover.ts";
import {
  type DifficultyDecisions,
  lastRecordedWrite,
  readClaims,
  readDifficultyDecisions,
  readRunEvidence,
} from "#tools/runs/evidence.ts";
import { type CommandArgs, runCommand } from "../../main/cli.ts";
import { openRecordedRun } from "../../main/run.ts";
import { DEFAULT_DISK_MIN_GIB } from "../../launch-run/scripts/options.ts";
import { ledgerPath, ledgerView, PREDICTIONS_DIR } from "./prediction.ts";

const USAGE = `usage: campaign.ts --campaigns <repo>/campaigns --run <runId> [--run <runId>...] [--json]
       campaign.ts --campaigns <repo>/campaigns --run <runId>... --state <file.json>
         [--every <s> --max-seconds <s>] [--stall-minutes <m>] [--disk-min-gib <g>] [--completion-only]

Without --state: each run's status, and its closure advisories once it has closed.
With --state: one watch pass against the stored snapshot (every row, exit 0), or with --every an
unattended loop that holds info rows and exits 3 on the first stop row.`;

/** What a stop row asks the reader to do: patch one named owner, hold the bytes because no owner is
 *  named yet, or rebuild because the measurement itself failed rather than a detail inside it. */
type Move = "surgical" | "reserved" | "overhaul";

export interface Row {
  runId: string;
  level: "stop" | "info";
  act: Move | null;
  detail: string;
}

/** The move each controller ending implies. The compiler holds the keys to both owners' closed
 *  sets, so a code either one gains cannot read as a move nobody chose. A settled ending asks for
 *  nothing; the environment and the three abort clauses that are not loop codes name no product
 *  owner, so they reserve. */
export const TERMINAL_MOVES: Readonly<Record<LoopTerminalCode | ControllerAbortClause, Move | null>> = {
  completed: null,
  stopped: null,
  "operator-interrupted": null,
  "fixed-product-boundary": null,
  "build-failed": "surgical",
  "candidate-held": "surgical",
  "environment-blocked": "reserved",
  "budget-limited": "reserved",
  "signal-terminated": "reserved",
  "host-storage-exhausted": "reserved",
  "controller-unclassified": "reserved",
};

interface Session {
  rehearsals: number;
  submits: number;
  refusedInARow: number;
  sameFindingsInARow: number;
  checksWithoutAccept: number;
  minutes: number;
}

/** A Builder session working without getting closer to an accepted submit. Each limit sits one step
 *  above the worst a session that still reached acceptance recorded across the 40 truss epochs of
 *  2026-09-13..15; `builder-blocking-loop` keeps the survey beside the same table. */
export const BUILDER_LIMITS: ReadonlyArray<[keyof Session, number, string]> = [
  ["refusedInARow", 5, "submits refused in a row"],
  ["sameFindingsInARow", 2, "refused submits in a row returned the same findings"],
  ["checksWithoutAccept", 12, "correctness_check calls without an accepted submit"],
  ["minutes", 120, "Builder minutes without a submit"],
];
const ENVIRONMENT_LIMIT = 2;

interface Case {
  taskId: string;
  family: string;
  kind: CaseOutcome;
  why: string | null;
}

interface Battery {
  runId: string;
  passed: number;
  verified: number;
  unaccepted: number;
  nonResults: number;
  cases: Case[];
}

/** What the newest bundle declares, each count null when the validator refused its file. */
interface Bundle {
  lines: number;
  files: Record<string, [lines: number, writtenMs: number]>;
  tasks: number | null;
  families: number | null;
  checks: number | null;
  accepts: number | null;
  rejects: number | null;
  tools: number | null;
  presets: string[] | null;
  findings: string[];
}

interface Authoring {
  epoch: string;
  commits: number;
  /** Null exactly when `unreadable` names why: no execution record yet, or one the current reader
   *  refuses, which an older schema always is. */
  session: Session | null;
  unreadable: string | null;
  environmentInARow: number;
  environmentKind: string | null;
}

export interface RunStatus {
  runId: string;
  slug: string;
  source: string;
  dirty: boolean;
  controllerError: string | null;
  /** The controller still holds the lock, or its lock cannot be read; null once the strict
   *  reader refused the run. */
  live: boolean | null;
  terminal: {
    outcome: string;
    code: LoopTerminalCode | ControllerAbortClause | null;
    reason: string;
    denominator: Denominator;
  } | null;
  budget: { used: number; cap: number; review: number } | null;
  caseRecordError: string | null;
  batteries: Battery[];
  open: { count: number; oldestMinutes: number | null; wallMinutes: number };
  bundle: Bundle | null;
  authoring: Authoring | null;
  difficulty: DifficultyDecisions;
  claims: { total: number; ok: number; refusedClauses: string[] };
  promotions: { total: number; held: number; heldClauses: string[] };
  epochs: number;
  safeguards: { counts: Record<string, number>; malformed: number };
  predictions: { frozen: number; open: string[] };
  evidenceAgeMinutes: number | null;
  sessionAgeMinutes: number | null;
}

export interface StatusRoots {
  predictions?: string;
  tmpParent?: string;
}

export interface Advisory {
  code: string;
  level: "hold" | "advice";
  text: string;
}

interface BatteryRead {
  batteries: Battery[];
  error: string | null;
}

type Add = (level: Row["level"], detail: string, act?: Move | null) => void;

export interface WatchState {
  runs: Record<string, RunStatus>;
  pending: Row[];
  diskLow: boolean;
}

export interface PassOptions {
  attended: boolean;
  completionOnly: boolean;
  stallMinutes: number;
  freeGib: number | null;
  diskMinGib: number;
}

/** A run the pass could read, or the sentence saying why it could not. */
export type Reading = RunStatus | { refused: string };

interface PassResult {
  rows: Row[];
  allClosed: boolean;
}

const minutesSince = (now: number, ms: number): number => Math.max(0, Math.round((now - ms) / 60000));

function mtimeMs(path: string): number {
  return statSync(path, { throwIfNoEntry: false })?.mtimeMs ?? 0;
}

const directories = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? [join(dir, e.name)] : []))
    : [];

/** Newest mtime under `dir`, at most `depth` levels and 200 entries a level; null when absent. */
export function newestWriteMs(dir: string, depth = 2): number | null {
  if (!existsSync(dir)) return null;
  let newest = mtimeMs(dir);
  if (depth === 0) return newest;
  for (const entry of readdirSync(dir, { withFileTypes: true }).slice(0, 200)) {
    const path = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? (newestWriteMs(path, depth - 1) ?? 0) : mtimeMs(path));
  }
  return newest;
}

function readBatteries(campaign: string, runId: string): BatteryRead {
  const path = join(campaign, CASE_RECORD_FILE);
  if (!existsSync(path)) return { batteries: [], error: null };
  const byRun = new Map<string, Case[]>();
  try {
    for (const { row } of readCaseRecord(path)) {
      if (!isControllerBatteryRunId(runId, row.runId)) continue;
      const cases = byRun.get(row.runId) ?? [];
      cases.push({
        taskId: row.taskId,
        family: row.family,
        kind: classifyCaseOutcome(row),
        why: row.runtimeNonResultKind,
      });
      byRun.set(row.runId, cases);
    }
  } catch (error) {
    return { batteries: [], error: errorMessage(error) };
  }
  const batteries = [...byRun].map(([id, cases]) => ({
    runId: id,
    ...outcomeTally(cases.map((c) => c.kind)),
    cases,
  }));
  return { batteries, error: null };
}

/** Cases the battery opened and has not settled, against the wall its harness set itself. A Built
 *  solve writes nothing between its start and its verdict, so an open case under that wall is work,
 *  not a stall. Settled ids are keyed per battery, because task ids repeat across batteries. */
function openCases(campaign: string, runId: string, batteries: Battery[], now: number): RunStatus["open"] {
  let count = 0;
  let oldest: number | null = null;
  let wallMs = DEFAULT_HARNESS_SETTINGS.solveMs;
  for (const dir of batteryRunDirs(campaign, runId)) {
    try {
      wallMs = harnessSettings(join(dir, "..", "..")).solveMs;
    } catch (error) {
      if (!(error instanceof HarnessConfigError)) throw error;
    }
    const cases = join(dir, "cases");
    const settled = new Set(
      batteries.find((b) => b.runId === dir.split("/").at(-1))?.cases.map((c) => c.taskId),
    );
    for (const taskId of existsSync(cases) ? readdirSync(cases) : []) {
      if (settled.has(taskId)) continue;
      count += 1;
      oldest = Math.min(oldest ?? Number.POSITIVE_INFINITY, mtimeMs(join(cases, taskId)));
    }
  }
  return {
    count,
    oldestMinutes: oldest === null ? null : minutesSince(now, oldest),
    wallMinutes: wallMs / 60000,
  };
}

/** The newest version the gate froze for this run, else the live epoch workspace, read through the
 *  bundle validator so a task file holds exactly what the gate would count. */
function readBundle(campaign: string, slug: string, runId: string, epoch: string | null): Bundle | null {
  const versions = join(campaign, "versions");
  const round = (name: string): number => (name === runId ? 1 : Number(name.slice(runId.length + 2)));
  const newest = (existsSync(versions) ? readdirSync(versions) : [])
    .filter((name) => isControllerBatteryRunId(runId, name))
    .sort((a, b) => round(a) - round(b))
    .at(-1);
  const workspace = epoch === null ? null : join(campaign, epoch, "workspace");
  const dir = newest === undefined ? workspace : join(versions, newest);
  if (dir === null) return null;
  const files: Bundle["files"] = {};
  const walk = (at: string, prefix: string): void => {
    for (const entry of existsSync(at) ? readdirSync(at, { withFileTypes: true }) : []) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path, `${prefix}${entry.name}/`);
      else if (/\.(ts|mjs|js|json|md|yaml)$/.test(entry.name)) {
        const lines = readFileSync(path, "utf8")
          .split("\n")
          .filter((line) => line.trim() !== "").length;
        files[`${prefix}${entry.name}`] = [lines, Math.round(mtimeMs(path))];
      }
    }
  };
  walk(join(dir, "agent"), "agent/");
  walk(join(dir, "correctness-model"), "correctness-model/");
  // A workspace before its first authored file has nothing to count, and zeroes would read as a
  // measured empty bundle.
  if (Object.keys(files).length === 0) return null;
  const load = loadValidatedBundle(dir, { slug }, "rehearsal");
  const tasks = load.battery?.tasks ?? null;
  return {
    lines: Object.values(files).reduce((sum, [lines]) => sum + lines, 0),
    files,
    tasks: tasks?.length ?? null,
    families: tasks === null ? null : new Set(tasks.map((task) => task.family)).size,
    checks: load.brief?.truthChecks.length ?? null,
    accepts: load.corpus?.accept.length ?? null,
    rejects: load.corpus?.reject.length ?? null,
    tools: load.toolsSpec?.tools.length ?? null,
    presets: load.toolsSpec?.presets ?? null,
    findings: [...new Set(load.findings.map((finding) => finding.code))].sort(),
  };
}

/** The Builder's session in one epoch, from its own execution records. Counts restart at an
 *  accepted submit, and preview non-results restart at a preview that produced a result. */
function readAuthoring(campaign: string, epoch: string): Authoring {
  const epochDir = join(campaign, epoch);
  const reflog = join(epochDir, "workspace", ".git", "logs", "HEAD");
  const commits = existsSync(reflog)
    ? readFileSync(reflog, "utf8")
        .split("\n")
        .filter((l) => l.trim() !== "").length
    : 0;
  let environmentInARow = 0;
  let environmentKind: string | null = null;
  const trials = directories(join(epochDir, "trials"))
    .flatMap(directories)
    .sort((a, b) => mtimeMs(a) - mtimeMs(b));
  for (const trial of trials) {
    const nonResult = asRecord(readJsonFileOrNull(join(trial, "environment-non-result.json")));
    environmentInARow = nonResult === null ? 0 : environmentInARow + 1;
    // A census payload names its kind; a verifier execution record names its outcome instead.
    const kind = nonResult?.kind ?? nonResult?.outcome;
    if (nonResult !== null) environmentKind = isString(kind) ? kind : null;
  }
  const { records, unavailable } = readExecutionEvidenceDetails(epochDir);
  // A refused record is named; an epoch that has not checkpointed yet has no session and no refusal.
  const unreadable = unavailable.length > 0 ? unavailable.join("; ") : null;
  if (unreadable !== null || records.length === 0) {
    return { epoch, commits, session: null, unreadable, environmentInARow, environmentKind };
  }
  const submits = records.flatMap((record) => record.submits).filter(isCandidateSubmit);
  let [refusedInARow, sameFindingsInARow] = [0, 0];
  for (const submit of submits) {
    const refused = submit.outcome !== "accepted";
    const same = submit.repeatedFindings === true ? sameFindingsInARow + 1 : 1;
    sameFindingsInARow = refused ? same : 0;
    refusedInARow = refused ? refusedInARow + 1 : 0;
  }
  const rehearsals = records
    .flatMap((record) => Object.entries(record.toolCalls.byName))
    .reduce((sum, [name, count]) => sum + (bareCustomToolName(name) === "correctness_check" ? count : 0), 0);
  const session = {
    rehearsals,
    submits: submits.length,
    refusedInARow,
    sameFindingsInARow,
    checksWithoutAccept: submits.some((submit) => submit.outcome === "accepted") ? 0 : rehearsals,
    minutes: Math.round(records.reduce((sum, record) => sum + record.durationMs, 0) / 60000),
  };
  return { epoch, commits, session, unreadable: null, environmentInARow, environmentKind };
}

/** Newest write among the stores a working session moves while it records no campaign evidence:
 *  the battery's case directories and the Claude CLI stores under the run's private TMPDIR as the
 *  launcher sets it. The Builder's own prose capture is written with its execution record, which
 *  the evidence age already reads. These show activity, never completed work. */
function sessionWriteMs(campaign: string, runId: string, tmpParent: string): number | null {
  const tmp = join(tmpParent, `ana-${runId}-tmp`);
  const writes = [
    ...batteryRunDirs(campaign, runId).map((dir) => newestWriteMs(join(dir, "cases"))),
    ...(existsSync(tmp) ? readdirSync(tmp) : [])
      .filter((name) => name.startsWith("ana-claude-cli-"))
      .map((name) => newestWriteMs(join(tmp, name, "projects"))),
  ].filter((ms) => ms !== null);
  return writes.length === 0 ? null : Math.max(...writes);
}

function readPromotions(campaign: string): RunStatus["promotions"] {
  const dir = join(campaign, "promotions");
  const rows = (existsSync(dir) ? readdirSync(dir) : [])
    .filter((name) => name.endsWith(".json"))
    .map((name) => asRecord(readJsonFileOrNull(join(dir, name))));
  const held = rows.filter((row) => row?.decision === "held");
  const clauses = held
    .flatMap((row) => (Array.isArray(row?.clauses) ? row.clauses : []))
    .filter(isString)
    .map((clause) => clause.split(":")[0] ?? "");
  return { total: rows.length, held: held.length, heldClauses: [...new Set(clauses)].sort() };
}

/** One run's status, read from the repository whose campaign tree holds it. */
export function readStatus(
  repoRoot: string,
  runId: string,
  now = Date.now(),
  roots: StatusRoots = {},
): RunStatus {
  const locations = findRun(repoRoot, runId);
  const location = locations[0];
  if (location === undefined) {
    throw new Error(`no controller opening for ${runId} under ${campaignRoot(repoRoot)}`);
  }
  if (locations.length > 1) {
    throw new Error(`${runId} names a run in ${locations.length} campaigns`);
  }
  const { campaign, opening, source, controller, controllerError } = openRecordedRun(
    location.campaignDir,
    runId,
  );
  const epochRecord = readEpochRecord(campaign);
  const openingEpoch = asRecord(opening.epoch)?.key;
  const live =
    controller === null
      ? null
      : controller.state === "unfinished" &&
        (controller.holder === "held" || controller.holder === "unreadable");
  // A live round may have resumed an earlier epoch, which moves the record's pointer rather than the
  // opening's; a closed run is read in the epoch it opened on.
  const epoch =
    (live === true ? epochRecord?.current : null) ?? (isString(openingEpoch) ? openingEpoch : null);
  const { batteries, error } = readBatteries(campaign, runId);
  const recorded = controller?.state === "recorded" ? controller : null;
  const spend = recorded?.providerResourceBudget?.terminal ?? null;
  const claims = readClaims(location);
  const refused = claims.filter((claim) => claim.ok === false);
  const { counts, malformed } = existsSync(safeguardLogFile(campaign, runId))
    ? parseSafeguardLog(readFileSync(safeguardLogFile(campaign, runId), "utf8"))
    : { counts: new Map<string, number>(), malformed: 0 };
  const predictions = ledgerView(ledgerPath(runId, roots.predictions ?? PREDICTIONS_DIR));
  const written = lastRecordedWrite(readRunEvidence(location));
  const sessionMs = sessionWriteMs(campaign, runId, roots.tmpParent ?? "/private/var/tmp");
  return {
    runId,
    slug: location.slug,
    source: source.commit,
    dirty: source.dirty,
    controllerError,
    live,
    terminal:
      recorded === null
        ? null
        : {
            outcome: recorded.outcome,
            code: recorded.abortClause ?? loopTerminalCode(recorded.terminalReason),
            reason: recorded.terminalReason,
            denominator: recorded.denominator,
          },
    budget: spend === null ? null : { used: spend.used, cap: spend.cap, review: spend.byRole.review },
    caseRecordError: error,
    batteries,
    open: openCases(campaign, runId, batteries, now),
    bundle: readBundle(campaign, location.slug, runId, epoch),
    authoring: epoch === null ? null : readAuthoring(campaign, epoch),
    difficulty: readDifficultyDecisions(location),
    claims: {
      total: claims.length,
      ok: claims.filter((claim) => claim.ok === true).length,
      refusedClauses: [...new Set(refused.flatMap((claim) => claim.clauses))].sort(),
    },
    promotions: readPromotions(campaign),
    epochs: epochRecord?.epochs.length ?? 0,
    safeguards: { counts: Object.fromEntries(counts), malformed },
    predictions: {
      frozen: predictions.length,
      open: predictions.filter((row) => row.outcome === "open").map((row) => row.id),
    },
    evidenceAgeMinutes: written === null ? null : minutesSince(now, Date.parse(written.at)),
    sessionAgeMinutes: sessionMs === null ? null : minutesSince(now, sessionMs),
  };
}

/** What a closure reads before any prose. Open predictions hold at any point; the rest read the
 *  terminal the controller recorded and say nothing while the run is open. */
export function advisories(run: RunStatus): Advisory[] {
  const out: Advisory[] = [];
  const add = (code: string, level: Advisory["level"], text: string): number =>
    out.push({ code, level, text });
  const { open } = run.predictions;
  if (open.length > 0) {
    add(
      "predictions-open",
      "hold",
      `${open.length} frozen prediction(s) not yet adjudicated: ${open.join(", ")} — adjudicate each (prediction.ts adjudicate) before choosing the next move`,
    );
  }
  const denominator = run.terminal?.denominator ?? null;
  if (denominator?.state === "invalid") {
    add("denominators", "hold", `case denominator invalid: ${denominator.error}`);
  }
  if (denominator?.state === "recorded" && denominator.verified === 0 && denominator.total > 0) {
    add(
      "zero-verified",
      "advice",
      "zero verified cases: no capability rate or difficulty evidence; inspect unaccepted attempts and typed non-results before choosing the next move",
    );
  }
  if (run.terminal !== null && run.claims.total > 0 && run.claims.ok === 0) {
    add(
      "claims-refused",
      "advice",
      `all ${run.claims.total} claims refused; clauses: ${run.claims.refusedClauses.join(", ") || "unstated"}`,
    );
  }
  if (run.terminal !== null && run.promotions.held > 0) {
    add(
      "promotion-held",
      "advice",
      `${run.promotions.held} campaign promotion(s) held; clauses: ${run.promotions.heldClauses.join(", ") || "unstated"} — read each promotion's exact identity and clauses`,
    );
  }
  const budget = run.budget;
  if (budget !== null && budget.used > 0 && budget.review / budget.used > 0.4) {
    add(
      "review-share",
      "advice",
      `review consumed ${budget.review}/${budget.used} turns (${Math.round((100 * budget.review) / budget.used)}%): weigh what the review census changed before paying for it again`,
    );
  }
  return out;
}

const count = (value: number | null): string => (value === null ? "?" : String(value));

function terminalText(terminal: NonNullable<RunStatus["terminal"]>): string {
  return `${terminal.outcome}${terminal.outcome === "completed" || terminal.code === null ? "" : ` (${terminal.code})`}`;
}

function runState(run: RunStatus): string {
  if (run.terminal !== null) {
    return `closed ${terminalText(run.terminal)}`;
  }
  if (run.live === null) {
    return "controller evidence refused";
  }
  return run.live ? "live" : "open, no live controller";
}

/** One run's status as text. `files` adds the per-file table, which a pass over several runs would
 *  drown in. Every null prints as `?` beside the refusal that made it null. */
export function renderStatus(run: RunStatus, detail: "files" | "summary"): string {
  const state = runState(run);
  const spend = run.budget === null ? "" : `, used ${run.budget.used}/${run.budget.cap}`;
  const session = run.sessionAgeMinutes === null ? "" : `, session wrote ${run.sessionAgeMinutes} min ago`;
  const lines = [
    `${run.runId}  ${run.slug}  ${state}${spend}  source ${run.source.slice(0, 9)}${run.dirty ? " DIRTY" : ""}  evidence ${count(run.evidenceAgeMinutes)} min ago${session}`,
  ];
  if (run.controllerError !== null) {
    lines.push(`  controller evidence REFUSED: ${run.controllerError}`);
  }
  if (run.caseRecordError !== null) {
    lines.push(`  case record UNREADABLE: ${run.caseRecordError}`);
  }
  for (const b of run.batteries) {
    lines.push(
      `  ${b.runId}: ${b.passed}/${b.verified} verified pass, ${b.unaccepted} unaccepted, ${b.nonResults} non-result (${b.cases.length} rows${run.live === true ? ", partial" : ""})`,
    );
  }
  if (run.open.count > 0) {
    lines.push(
      `  ${run.open.count} case(s) open, oldest ${count(run.open.oldestMinutes)} of ${run.open.wallMinutes} min`,
    );
  }
  const bundle = run.bundle;
  if (bundle !== null) {
    lines.push(
      `  bundle ${bundle.lines} lines in ${Object.keys(bundle.files).length} files; ${count(bundle.tasks)} tasks in ${count(bundle.families)} families, ${count(bundle.checks)} checks, ${count(bundle.accepts)} accept and ${count(bundle.rejects)} reject controls, ${count(bundle.tools)} tools (presets ${bundle.presets === null ? "?" : bundle.presets.join(", ") || "none"})`,
    );
    if (bundle.findings.length > 0) {
      lines.push(`  bundle validator refused: ${bundle.findings.join(", ")}`);
    }
  }
  const authoring = run.authoring;
  if (authoring !== null) {
    const counts = authoring.session;
    lines.push(
      counts === null
        ? `  authoring ${authoring.commits} commits; rehearsals and submits unknown: ${authoring.unreadable ?? "no execution record yet"}`
        : `  authoring ${authoring.commits} commits: ${counts.rehearsals} rehearsal(s), ${counts.submits} submit attempt(s)`,
    );
  }
  for (const row of run.difficulty.rows) {
    lines.push(`  ${decisionText(row)}`);
  }
  if (run.difficulty.refused.length > 0) {
    lines.push(`  climb decisions refused: ${run.difficulty.refused.join(", ")}`);
  }
  const fired =
    Object.entries(run.safeguards.counts)
      .map(([name, n]) => `${name} x${n}`)
      .join(", ") || "none";
  lines.push(
    `  epochs ${run.epochs}  claims ${run.claims.ok}/${run.claims.total} ok  promotions ${run.promotions.total} (${run.promotions.held} held)  predictions ${run.predictions.open.length}/${run.predictions.frozen} open  safeguards ${fired}`,
  );
  const denominator = run.terminal?.denominator ?? null;
  if (run.terminal !== null) {
    lines.push(`  terminal: ${run.terminal.reason}`);
  }
  if (denominator?.state === "recorded") {
    lines.push(
      `  recorded denominator: verified ${denominator.verified}, unaccepted ${denominator.unaccepted}, non-results ${denominator.nonResults} (total ${denominator.total})`,
    );
  }
  for (const advisory of advisories(run)) {
    lines.push(`  [${advisory.level}] ${advisory.code}: ${advisory.text}`);
  }
  if (detail === "files" && bundle !== null) {
    for (const [path, [n]] of Object.entries(bundle.files).sort(([, [a]], [, [b]]) => b - a)) {
      lines.push(`    ${path.padEnd(42)}${String(n).padStart(6)} lines`);
    }
  }
  return lines.join("\n");
}

function decisionText(row: DifficultyDecisions["rows"][number]): string {
  const placement =
    row.placement === null ? "unplaced" : `${row.placement.passes}/${row.placement.n} ${row.placement.zone}`;
  const facts = [row.repeated && "repeated failures", row.conflict && "family conflict"];
  return [`battery ${row.runId}: ${placement}`, ...facts.filter((fact) => fact !== false)].join(", ");
}

function caseLine(battery: string, row: Case): string {
  const name = `${battery} ${row.taskId} (${row.family})`;
  if (row.kind === "pass" || row.kind === "fail") {
    return `${name}: verified ${row.kind}`;
  }
  if (row.kind === "unaccepted") {
    return `${name}: unaccepted, the agent produced no accepted submission`;
  }
  return `${name}: non-result${row.why === null ? "" : ` (${row.why})`}`;
}

function terminalMove(run: RunStatus): Move | null {
  const scored = run.batteries.filter((b) => b.verified + b.unaccepted > 0);
  if (scored.length > 0 && scored.every((b) => b.verified === 0)) {
    return "overhaul";
  }
  const code = run.terminal?.code ?? null;
  return code === null ? "reserved" : TERMINAL_MOVES[code];
}

const trailingNonResults = (cases: readonly Case[]): number => {
  const last = cases.findLastIndex((row) => row.kind !== "non-result");
  return cases.length - 1 - last;
};

/** Silence under the harness's own solve wall is a battery working, not a stall. */
const solving = (run: RunStatus): boolean =>
  run.open.count > 0 && run.open.oldestMinutes !== null && run.open.oldestMinutes < run.open.wallMinutes;

/** Stalled once campaign evidence and every sampled session store are both quiet past the
 *  threshold; a run with no store to sample counts as quiet. */
const stalled = (run: RunStatus, minutes: number): boolean =>
  (run.evidenceAgeMinutes ?? 0) >= minutes &&
  (run.sessionAgeMinutes === null || run.sessionAgeMinutes >= minutes);

function stallRows(previous: RunStatus | null, current: RunStatus, minutes: number, add: Add): void {
  if (current.live !== true) {
    if (current.live === false) {
      add("stop", "controller not alive and no terminal written", "reserved");
    }
    return;
  }
  if ((current.evidenceAgeMinutes ?? 0) < minutes || solving(current)) {
    return;
  }
  if (stalled(current, minutes)) {
    // A pass the solve wall silenced reported nothing, so it cannot stand in for a reported stall.
    if (previous !== null && stalled(previous, minutes) && !solving(previous)) {
      return;
    }
    const sampled =
      current.sessionAgeMinutes === null
        ? "no session store to sample"
        : `the session store last wrote ${current.sessionAgeMinutes} min ago`;
    add(
      "stop",
      `no new evidence for ${current.evidenceAgeMinutes} min and ${sampled} (stall threshold ${minutes}); read fullrun.log and the launchd state`,
      "reserved",
    );
  } else if (previous === null || (previous.evidenceAgeMinutes ?? 0) < minutes) {
    add(
      "info",
      `no new campaign evidence for ${current.evidenceAgeMinutes} min; the session store wrote ${current.sessionAgeMinutes} min ago, which shows activity but not completed work`,
    );
  }
}

/** Each Builder limit fires once per epoch, as it is crossed. */
function builderRows(previous: RunStatus | null, current: RunStatus, add: Add): void {
  const now = current.authoring;
  if (now === null) {
    return;
  }
  const before = previous?.authoring?.epoch === now.epoch ? previous.authoring : null;
  const where = `epoch ${now.epoch}`;
  if (now.unreadable !== null && before?.unreadable == null) {
    add(
      "stop",
      `Builder execution record refused, so its limits cannot be read: ${now.unreadable} (${where})`,
      "reserved",
    );
  }
  for (const [key, limit, text] of BUILDER_LIMITS) {
    const crossed = (a: Authoring | null): boolean =>
      (a?.session?.[key] ?? 0) >= limit && (key !== "minutes" || a?.session?.submits === 0);
    if (crossed(now) && !crossed(before)) {
      add("stop", `Builder blocked: ${now.session?.[key]} ${text} (${where}, limit ${limit})`, "surgical");
    }
  }
  if (now.environmentInARow >= ENVIRONMENT_LIMIT && (before?.environmentInARow ?? 0) < ENVIRONMENT_LIMIT) {
    add(
      "stop",
      `Builder blocked: ${now.environmentInARow} previews in a row ended as environment non-results (${now.environmentKind ?? "?"}) (${where}, limit ${ENVIRONMENT_LIMIT})`,
      "surgical",
    );
  }
}

/** Increments only: a first pass names each battery, and later passes name each case once. */
function batteryRows(previous: RunStatus | null, current: RunStatus, add: Add): void {
  for (const now of current.batteries) {
    const before = previous?.batteries.find((b) => b.runId === now.runId) ?? null;
    if (before === null) {
      add("info", `battery ${now.runId} started`);
    }
    if (previous !== null) {
      for (const row of now.cases.slice(before?.cases.length ?? 0)) add("info", caseLine(now.runId, row));
    }
    if (now.nonResults > (before?.nonResults ?? 0)) {
      add(
        "stop",
        `battery ${now.runId} non-results ${before?.nonResults ?? 0} -> ${now.nonResults}`,
        "reserved",
      );
    }
    // Rule 6 stops scheduling after five typed non-results in a row: the trailing run, not the total.
    const trailing = trailingNonResults(now.cases);
    if (trailing >= 5 && trailingNonResults(before?.cases ?? []) < 5) {
      add(
        "stop",
        `battery ${now.runId} ended ${trailing} cases in a row as typed non-results; stop scheduling and record the rest as provider non-results`,
        "overhaul",
      );
    }
  }
}

/** What moved in the bundle since the last pass. A first reading names nothing, because everything
 *  present then is older than the watch. */
function bundleRows(previous: RunStatus, current: RunStatus, add: Add): void {
  const [was, now] = [previous.authoring, current.authoring];
  if (was !== null && now !== null && now.commits > was.commits) {
    const session =
      now.session === null
        ? "execution record unreadable"
        : `${now.session.rehearsals} rehearsal(s), ${now.session.submits} submit attempt(s)`;
    add("info", `authoring ${was.commits} -> ${now.commits} commits: ${session}`);
  }
  for (const [path, [lines, ms]] of Object.entries(current.bundle?.files ?? {})) {
    const prior = previous.bundle?.files[path];
    if (prior?.[1] !== ms) {
      add("info", `wrote ${path}, ${lines} lines${prior === undefined ? " (new)" : ` (was ${prior[0]})`}`);
    }
  }
}

/** A settled climb decision's move. A repeated failure set or a family conflict names its own
 *  surgical move, a battery placed nowhere measured nothing and asks for an overhaul, and a
 *  too-hard zone reserves; the other zones are the band reading its own score. */
function decisionMove(row: DifficultyDecisions["rows"][number]): Move | null {
  if (row.repeated || row.conflict) return "surgical";
  if (row.placement === null) return "overhaul";
  return row.placement.zone === "too-hard" ? "reserved" : null;
}

/** Climb decisions as each lands; a first pass reads the newest alone. */
function climbRows(previous: RunStatus | null, current: RunStatus, add: Add): void {
  const refused = current.difficulty.refused.length;
  if (refused > 0 && refused !== (previous?.difficulty.refused.length ?? 0)) {
    add("info", `${refused} climb decision(s) recorded under a schema this reader does not open`);
  }
  const rows = current.difficulty.rows;
  for (const row of rows.slice(
    previous === null ? Math.max(rows.length - 1, 0) : previous.difficulty.rows.length,
  )) {
    const move = decisionMove(row);
    add(move === null ? "info" : "stop", decisionText(row), move);
  }
}

/** The rows between two readings of one run; `previous === null` is the first pass, where only
 *  absolute conditions fire because growth needs a baseline. */
export function deviations(previous: RunStatus | null, current: RunStatus, stallMinutes = 45): Row[] {
  const rows: Row[] = [];
  const add: Add = (level, detail, act = null) => rows.push({ runId: current.runId, level, act, detail });
  if (current.terminal !== null) {
    if (previous?.terminal == null) {
      add("stop", `terminal: ${terminalText(current.terminal)}`, terminalMove(current));
    }
    return rows;
  }
  if (current.controllerError !== null && previous?.controllerError == null) {
    add("stop", `controller evidence refused: ${current.controllerError}`, "reserved");
  }
  // The strict reader refused the whole record, so every battery count is absent, not zero.
  if (current.caseRecordError !== null && previous?.caseRecordError == null) {
    add("stop", `case record unreadable: ${current.caseRecordError}`, "reserved");
  }
  stallRows(previous, current, stallMinutes, add);
  builderRows(previous, current, add);
  batteryRows(previous, current, add);
  if (current.open.count !== (previous?.open.count ?? 0)) {
    add(
      "info",
      `${current.open.count} case(s) open, oldest ${count(current.open.oldestMinutes)} of ${current.open.wallMinutes} min`,
    );
  }
  if (previous !== null) {
    bundleRows(previous, current, add);
  }
  climbRows(previous, current, add);
  for (const [name, n] of Object.entries(current.safeguards.counts)) {
    const before = previous?.safeguards.counts[name] ?? 0;
    // A first firing is a lead to read; the same name firing again is progress, not news.
    if (n > before) {
      add(
        before === 0 ? "stop" : "info",
        `safeguard ${name} fired ${n - before} more time(s), ${n} total`,
        before === 0 ? "surgical" : null,
      );
    }
  }
  if (current.safeguards.malformed > (previous?.safeguards.malformed ?? 0)) {
    add("stop", `safeguard log has ${current.safeguards.malformed} malformed line(s)`, "surgical");
  }
  if (previous === null) {
    return rows;
  }
  const refused = current.claims.total - current.claims.ok - (previous.claims.total - previous.claims.ok);
  if (refused > 0) {
    add("stop", `${refused} claim(s) written without ok`, "surgical");
  }
  if (current.claims.ok > previous.claims.ok) {
    add("info", `claims ok ${previous.claims.ok} -> ${current.claims.ok}`);
  }
  if (current.promotions.total > previous.promotions.total) {
    add("info", `promotions ${previous.promotions.total} -> ${current.promotions.total}`);
  }
  if (current.epochs > previous.epochs) {
    add("info", `epoch ${previous.epochs} -> ${current.epochs}`);
  }
  return rows;
}

export function renderRows(rows: readonly Row[], now = new Date()): string {
  const at = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  return rows
    .map(
      (row) =>
        `${at} ${row.level.padEnd(4)} ${row.act === null ? "" : `[${row.act}] `}${row.runId}: ${row.detail}`,
    )
    .join("\n");
}

/**
 * One pass over every named run, each a status or the reason it could not be read. An unattended
 * pass holds info rows in `state.pending` until a stop row carries them out, so a quiet night prints
 * nothing; an attended one prints every row now. Free space under the floor is one `host` row,
 * fired again only after it recovered.
 */
export function watchPass(
  runs: ReadonlyMap<string, Reading>,
  state: WatchState,
  options: PassOptions,
): PassResult {
  const rows = options.completionOnly ? [] : [...state.pending];
  let closed = 0;
  for (const [runId, current] of runs) {
    if ("refused" in current) {
      if (!options.completionOnly) {
        rows.push({ runId, level: "stop", act: "reserved", detail: current.refused });
      }
      continue;
    }
    const previous = state.runs[runId] ?? null;
    if (options.completionOnly && current.terminal !== null && previous?.terminal == null) {
      rows.push({
        runId,
        level: "stop",
        act: terminalMove(current),
        detail: `terminal: ${terminalText(current.terminal)}; controller exited`,
      });
    } else if (!options.completionOnly) {
      rows.push(...deviations(previous, current, options.stallMinutes));
    }
    state.runs[runId] = current;
    if (current.terminal !== null) {
      closed += 1;
    }
  }
  if (!options.completionOnly && options.freeGib !== null) {
    const low = options.freeGib < options.diskMinGib;
    if (low && !state.diskLow) {
      rows.push({
        runId: "host",
        level: "stop",
        act: "reserved",
        detail: `free space ${options.freeGib} GiB on the campaigns volume is under ${options.diskMinGib} GiB; free space before any launch or gate`,
      });
    }
    state.diskLow = low;
  }
  const fire = options.attended ? rows.length > 0 : rows.some((row) => row.level === "stop");
  state.pending = fire ? [] : rows.filter((row) => row.level === "info");
  return { rows: fire ? rows : [], allClosed: closed === runs.size };
}

function readState(path: string): WatchState {
  const fresh: WatchState = { runs: {}, pending: [], diskLow: false };
  // This command is the state file's only writer, and a file it cannot parse starts fresh.
  try {
    return existsSync(path)
      ? { ...fresh, ...parseJsonAs<Partial<WatchState>>(readFileSync(path, "utf8")) }
      : fresh;
  } catch {
    return fresh;
  }
}

function freeGib(path: string): number | null {
  try {
    const stats = statfsSync(path);
    return Math.floor((stats.bavail * stats.bsize) / 2 ** 30);
  } catch {
    return null;
  }
}

/** A watched run, or the reason it could not be read. */
function reading(repoRoot: string, runId: string): Reading {
  try {
    return readStatus(repoRoot, runId);
  } catch (error) {
    return { refused: errorMessage(error) };
  }
}

async function watch(
  args: CommandArgs,
  repoRoot: string,
  runIds: readonly string[],
  statePath: string,
): Promise<number> {
  const started = Date.now();
  const every = args.int("every");
  const maxSeconds = args.int("max-seconds") ?? 6 * 3600;
  const completionOnly = args.flag("completion-only");
  const campaigns = campaignRoot(repoRoot);
  for (;;) {
    const state = readState(statePath);
    const runs = new Map(runIds.map((runId) => [runId, reading(repoRoot, runId)]));
    const pass = watchPass(runs, state, {
      attended: every === null,
      completionOnly,
      stallMinutes: args.int("stall-minutes") ?? 45,
      freeGib: completionOnly ? null : freeGib(campaigns),
      diskMinGib: args.int("disk-min-gib") ?? DEFAULT_DISK_MIN_GIB,
    });
    writeJsonFile(statePath, state);
    if (every === null && !completionOnly) {
      const read = [...runs.values()].filter((run): run is RunStatus => !("refused" in run));
      console.log(read.map((run) => renderStatus(run, "summary")).join("\n"));
    }
    if (pass.rows.length > 0) {
      console.log(renderRows(pass.rows));
      return every === null ? 0 : 3;
    }
    if (pass.allClosed) {
      if (!completionOnly) {
        console.log(`all watched runs closed: ${runIds.join(", ")}`);
      }
      return 0;
    }
    if (every === null || Date.now() - started >= maxSeconds * 1000) {
      if (every !== null && !completionOnly) {
        console.log(`quiet for ${maxSeconds} s: ${runIds.join(", ")} still open, nothing deviated`);
      }
      return 0;
    }
    await Bun.sleep(every * 1000);
  }
}

if (import.meta.main) {
  await runCommand(
    {
      name: "campaign.ts",
      usage: USAGE,
      options: {
        campaigns: "abs",
        run: "list",
        json: "flag",
        state: "abs",
        every: "int",
        "max-seconds": "int",
        "stall-minutes": "int",
        "disk-min-gib": "int",
        "completion-only": "flag",
      },
    },
    (args) => {
      const campaigns = args.required("campaigns");
      const repoRoot = dirname(campaigns);
      // Every reader resolves the campaigns tree from the repository root, so the root must be the
      // one `campaignRoot` names for its repository.
      if (campaignRoot(repoRoot) !== campaigns) {
        args.die("--campaigns must be <repository>/campaigns");
      }
      const runIds = args.list("run");
      if (runIds.length === 0) {
        args.die("--run <runId> names a run; repeat it for more");
      }
      const statePath = args.value("state");
      if (statePath !== null) {
        return watch(args, repoRoot, runIds, statePath);
      }
      if (args.int("every") !== null) {
        args.die("--every loops a watch, so it needs --state");
      }
      const statuses = runIds.map((runId) => readStatus(repoRoot, runId));
      if (args.flag("json")) {
        console.log(
          JSON.stringify(
            statuses.map((run) => ({ ...run, advisories: advisories(run) })),
            null,
            2,
          ),
        );
      } else {
        console.log(
          statuses.map((run) => renderStatus(run, statuses.length === 1 ? "files" : "summary")).join("\n\n"),
        );
      }
      return 0;
    },
  );
}

// Which of a harness's own declared budgets actually bound its solves. `agent/config.yaml` is the
// one file the Builder writes that the loop never inspects afterwards, and no other reader opens it:
// every case's spent time and turns are recorded, the walls they ran against are not. This joins the
// two, per battery, so "give the solver more room" is answered from the record rather than assumed.
//
//   bun wri.ts walls <target> [--battery <runId>] [--json]
//
// The reading that changes a decision is the negative one: a battery whose median case spends a
// tenth of the declared solve wall has no outcome explained by room. The positive reading names
// the case that ended on the wall, to the minute.
//
// A turn is one outer prompt carrying an unbounded internal tool loop, so a solver that finishes
// without being nudged records one turn however much work it did, and the turn count is the host's
// runaway guard rather than a wall the harness declares. This reader states tool calls and elapsed
// time instead.
//
// A product whose agent/config.yaml the current schema refuses — every one recorded before the
// 2026-10-07 consolidation — has its walls reported as unread rather than guessed.
//
// The shell's per-command timeout is the other declared wall, and the one a solve meets most. Its cut
// ends one command rather than the solve, so no case field records it: Pi's own line, "Command timed
// out after N seconds", is read from the bash error rows of the case's verified trace. A battery with
// a cut command no longer reads as one no wall reached.
//
// A case that reached no wall is reported by what the record says it did — the solve was accepted
// as a submission, or it ended without one. Reading both as one cut-solve label describes a case
// that simply finished as truncated. A case that passed on a wall is `submitted-at-wall`: the wall
// was reached and cost the verdict nothing, so it is neither a truncated solve nor room to add.
// Lane 22 reads this table.
import { existsSync } from "#src/meta/filesystem.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { campaignTraceRoots, readVerifiedTraceUnder } from "#src/claim/trace-read.ts";
import { measuredProductId, productVersionDir } from "#src/run/product-versions.ts";
import {
  CASE_RECORD_FILE,
  classifyCaseOutcome,
  readCaseRecord,
  type CaseRecordRow,
} from "#src/claim/case-record.ts";
import { CASE_RESULT_FILE } from "#src/correctness-bundle/battery-record.ts";
import {
  DEFAULT_HARNESS_SETTINGS,
  HARNESS_CONFIG_FILE,
  readableHarnessSettings,
  type HarnessSettings,
} from "#src/correctness-bundle/harness-config.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import { median } from "#src/meta/tally.ts";
import { WALL_BOUND_SHARE } from "#src/run/climb-history.ts";
import { readJsonAs } from "./run-overview.ts";

export const WALLS_SCHEMA = "wri-solve-walls/v2";
/** Below this, with no completed turn, the case spent no budget: the host stopped before the solve. */
export const UNSTARTED_MS = 30_000;
/** Pi's line for a command its timer killed (`vendor/pi-coding-agent/core/tools/bash.ts`), which a
 *  trace keeps in the result excerpt of the failed call. */
const SHELL_CUT = /Command timed out after \d+ seconds/;
/** The bounds that say a declared wall was reached, whatever the verdict. */
export const WALL_BOUNDS: ReadonlySet<string> = new Set(["time-bound", "submitted-at-wall"]);

/** The part of a recorded `case-result.json` this reader reads, as the solve host writes it. */
interface CaseResultFile {
  solver?: { completedTurns?: number | null; toolCalls?: number | null; errors?: unknown };
}

/** Turns, tool calls and solver errors one case result recorded. */
export interface SolverFacts {
  turns: number | null;
  toolCalls: number | null;
  errors: string[];
}

export type WallBound =
  | "unrecorded"
  | "submitted-at-wall"
  | "time-bound"
  | "unstarted"
  | "submitted"
  | "no-submit";

export interface BoundInput {
  elapsedMs: number | null;
  timeShare: number | null;
  turns: number | null;
  acceptedSubmit: boolean;
  passed: boolean;
}

export interface WallsInput {
  campaign: string;
  runId?: string | null;
}

/** The walls a battery ran under, where they came from and which a product moved off the defaults. */
interface WallsSource {
  source: string;
  /** Null when the current schema refuses the product's config. */
  settings: HarnessSettings | null;
  moved: { key: string; declared: number; seeded: number | undefined }[];
}

export type WallCase = ReturnType<typeof caseOf>;

export type WallBattery = ReturnType<typeof batteryOf>;

export type WallsReport = ReturnType<typeof buildWalls>;

const minutes = (ms: number): number => Math.round(ms / 600) / 100;

/** Every case row the campaign recorded, grouped by the battery that ran it, through the strict reader. */
function caseRows(campaign: string): Map<string, CaseRecordRow[]> {
  const byRun = new Map<string, CaseRecordRow[]>();
  for (const { row } of readCaseRecord(join(campaign, CASE_RECORD_FILE))) {
    const rows = byRun.get(row.runId) ?? [];
    rows.push(row);
    byRun.set(row.runId, rows);
  }
  return byRun;
}

/** Turns, tool calls and the solver errors the case result recorded, which the case-record row does
 *  not restate. The result is looked for under every trace root the campaign keeps — the default
 *  product, and each retained, candidate or promoted tree — because a battery's run directory sits
 *  under whichever tree measured it. An absent result leaves them null: the case ran, and this
 *  reader did not see its turns. The errors are carried verbatim so a case this reader calls
 *  time-bound from its elapsed share can quote the host's own sentence for it rather than resting
 *  on the share alone. */
function solverOf(roots: readonly string[], runId: string, taskId: string): SolverFacts {
  for (const root of roots) {
    const path = join(root, "runs", runId, "cases", taskId, CASE_RESULT_FILE);
    if (!existsSync(path)) continue;
    const solver = readJsonAs<CaseResultFile>(path).solver ?? {};
    const errors = Array.isArray(solver.errors) ? solver.errors.filter((value) => isString(value)) : [];
    return { turns: solver.completedTurns ?? null, toolCalls: solver.toolCalls ?? null, errors };
  }
  return { turns: null, toolCalls: null, errors: [] };
}

/** The walls the product this battery measured declared, and how each compares with the seeded
 *  default. Which product that was is the controller ledger's binding (`measuredProductId`), not
 *  a directory named after the battery: a task probe measures the retained version an earlier
 *  round published under its own id. A battery the ledger binds to no product reads the defaults
 *  and says so, and a bound product without a config reads them too, because the host applies them.
 *  The product is read where it lies, not through `readProductVersion`, which refuses a version
 *  another source recorded so that no project continues on it: a reader of old evidence must still
 *  read it, and 27 of 37 campaigns since 2026-09-26 carry the earlier schema. */
function wallsOf(campaign: string, runId: string): WallsSource {
  const [root, slug] = [dirname(dirname(campaign)), basename(campaign)];
  const id = measuredProductId(root, slug, runId);
  const product = id === null ? null : productVersionDir(root, slug, id);
  const settings = product === null ? DEFAULT_HARNESS_SETTINGS : readableHarnessSettings(product);
  if (settings === null) {
    return {
      source: "unread; the current schema refuses the measured product's agent/config.yaml",
      settings,
      moved: [],
    };
  }
  const defaults = new Map<string, number>(Object.entries(DEFAULT_HARNESS_SETTINGS));
  const moved = Object.entries(settings)
    .filter(([key, value]) => value !== defaults.get(key))
    .map(([key, value]) => ({ key, declared: value, seeded: defaults.get(key) }));
  const source =
    product === null
      ? "seeded defaults; the ledger binds this battery to no retained product"
      : existsSync(join(product, HARNESS_CONFIG_FILE))
        ? "the measured product's agent/config.yaml"
        : "seeded defaults; the measured product declares no agent/config.yaml";
  return { source, settings, moved };
}

/** Which budget the case ended on, and — where none bound it — what the record says the solve did.
 *  A case the host never got as far as solving spent neither, and reading it as a short solve puts a
 *  row that proves nothing about room beside one that does. `submitted` and `no-submit` read
 *  `acceptedSubmit`, the same recorded field the outcome is classified from. */
function boundOf({ elapsedMs, timeShare, turns, acceptedSubmit, passed }: BoundInput): WallBound {
  if (elapsedMs === null && turns === null) return "unrecorded";
  const atWall = timeShare !== null && timeShare >= WALL_BOUND_SHARE;
  if (atWall && passed) return "submitted-at-wall";
  if (atWall) return "time-bound";
  if (elapsedMs !== null && elapsedMs < UNSTARTED_MS && (turns === null || turns === 0)) return "unstarted";
  return acceptedSubmit ? "submitted" : "no-submit";
}

/** The bash calls the shell's timeout cut in this case's solve, or null when the case has no trace
 *  this reader can verify. */
function shellCutsOf(row: CaseRecordRow, campaign: string, roots: readonly string[]): number | null {
  const read = readVerifiedTraceUnder(row, campaign, roots);
  if (read.trace === null) return null;
  return read.trace.toolCalls.filter(
    (call) =>
      call.toolName === "bash" &&
      call.isError === true &&
      isString(call.resultExcerpt) &&
      SHELL_CUT.test(call.resultExcerpt),
  ).length;
}

function caseOf(
  row: CaseRecordRow,
  solver: SolverFacts,
  settings: HarnessSettings | null,
  shellCuts: number | null,
) {
  const started = isString(row.solverStartedAt) ? Date.parse(row.solverStartedAt) : null;
  const ended = isString(row.solverEndedAt) ? Date.parse(row.solverEndedAt) : null;
  const elapsedMs = started === null || ended === null ? null : ended - started;
  // The solve wall is a positive whole number of seconds, so the share always has a denominator.
  const timeShare =
    elapsedMs === null || settings === null ? null : Math.round((elapsedMs / settings.solveMs) * 1000) / 1000;
  const acceptedSubmit = row.acceptedSubmit;
  const outcome = classifyCaseOutcome(row);
  return {
    taskId: row.taskId,
    family: row.family,
    outcome,
    bound: boundOf({
      elapsedMs,
      timeShare,
      turns: solver.turns,
      acceptedSubmit,
      passed: outcome === "pass",
    }),
    elapsedMinutes: elapsedMs === null ? null : minutes(elapsedMs),
    timeShare,
    turns: solver.turns,
    toolCalls: solver.toolCalls,
    shellCuts,
    errors: solver.errors,
  };
}

function batteryOf(
  campaign: string,
  roots: readonly string[],
  runId: string,
  rows: readonly CaseRecordRow[],
) {
  const walls = wallsOf(campaign, runId);
  const cases = rows.map((row) =>
    caseOf(row, solverOf(roots, runId, row.taskId), walls.settings, shellCutsOf(row, campaign, roots)),
  );
  const cut = cases.filter((row) => (row.shellCuts ?? 0) > 0);
  const times = cases.flatMap((row) => (row.timeShare === null ? [] : [row.timeShare]));
  const calls = cases.flatMap((row) => (isNumber(row.toolCalls) ? [row.toolCalls] : []));
  const bounds: Partial<Record<WallBound, number>> = {};
  for (const row of cases) bounds[row.bound] = (bounds[row.bound] ?? 0) + 1;
  const outcomes: Partial<Record<WallCase["outcome"], number>> = {};
  for (const row of cases) outcomes[row.outcome] = (outcomes[row.outcome] ?? 0) + 1;
  return {
    runId,
    cases: cases.length,
    walls,
    bounds,
    outcomes,
    time: { median: median(times), max: times.length === 0 ? null : Math.max(...times) },
    // Tool calls, not turns: the calls are the work the turns carried.
    toolCalls: { median: median(calls), max: calls.length === 0 ? null : Math.max(...calls) },
    atWall: cases.filter((row) => WALL_BOUNDS.has(row.bound)),
    shellCut: cut,
    shellCuts: {
      calls: cut.reduce((sum, row) => sum + (row.shellCuts ?? 0), 0),
      cases: cut.length,
      unread: cases.filter((row) => row.shellCuts === null).length,
    },
    // `submitted-at-wall` already names the pass, so the truncating bound is the whole set.
    boundedWithoutPass: cases.flatMap((row) => (row.bound === "time-bound" ? [row.taskId] : [])),
    rows: cases,
  };
}

/** `runId` absent reads every battery. */
export function buildWalls({ campaign, runId = null }: WallsInput) {
  const byRun = caseRows(campaign);
  const selected = [...byRun.entries()].filter(([id]) => runId === null || id === runId);
  selected.sort(([a], [b]) => a.localeCompare(b));
  const roots = campaignTraceRoots(campaign);
  const batteries = selected.map(([id, rows]) => batteryOf(campaign, roots, id, rows));
  return {
    schema: WALLS_SCHEMA,
    campaign,
    runId,
    state: batteries.length === 0 ? "unavailable" : "recorded",
    reason: batteries.length === 0 ? "the campaign recorded no case row for this selector" : null,
    batteries,
    limits: [
      "Elapsed time is the case's wall clock, including provider latency and every queue it waited in, not model work.",
      "A turn is one outer prompt carrying an unbounded internal tool loop, so a solver that finishes without being nudged records one turn whatever it did inside it. Tool calls are that work, and the turn count is the host's runaway guard rather than a wall the harness declares.",
      "A case that passed at a wall is not a defect. A case that reached a wall without passing is the one reading that supports more room, and its verdict is a truncated solve rather than a settled capability failure.",
    ],
  };
}

function batteryLines(battery: WallBattery): string[] {
  const { settings, moved, source } = battery.walls;
  const pct = (value: number | null): string => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
  const lines = [
    `  ${battery.runId}: ${battery.cases} cases, ${Object.entries(battery.outcomes)
      .map(([kind, count]) => `${kind} ${count}`)
      .join(", ")}`,
    settings === null
      ? `      walls: ${source}`
      : `      walls: solve ${minutes(settings.solveMs)} min, shell ${settings.shellCommandSeconds} s per command (${source})`,
    `      ${moved.length === 0 ? "every wall is the seeded default" : `moved from the seeded default: ${moved.map((row) => `${row.key} ${row.seeded} to ${row.declared}`).join(", ")}`}`,
    `      time used: median ${pct(battery.time.median)} of the solve wall, max ${pct(battery.time.max)}   tool calls: median ${battery.toolCalls.median ?? "n/a"}, max ${battery.toolCalls.max ?? "n/a"}`,
    `      ${Object.entries(battery.bounds)
      .map(([kind, count]) => `${kind} ${count}`)
      .join(", ")}`,
  ];
  for (const row of battery.atWall) {
    const recorded =
      row.errors.length === 0
        ? "no solver error recorded"
        : row.errors.map((value) => `"${value}"`).join("; ");
    lines.push(
      `      at a wall: ${row.taskId} ${row.bound}, ${row.elapsedMinutes} min (${pct(row.timeShare)}), ${row.turns} turn(s), ${row.toolCalls ?? "n/a"} tool calls, ${row.outcome}, ${recorded}`,
    );
  }
  for (const row of battery.shellCut) {
    lines.push(`      shell wall cut: ${row.taskId} ${row.shellCuts} command(s), ${row.outcome}`);
  }
  const { calls, cases, unread } = battery.shellCuts;
  const untraced =
    unread === 0 ? "" : `, though ${unread} case(s) have no readable trace to show a shell cut`;
  if (battery.atWall.length === 0 && calls > 0) {
    lines.push(
      `      no case reached its solve wall, but the shell wall cut ${calls} command(s) in ${cases} case(s): room per command is not ruled out`,
    );
  } else if (battery.atWall.length === 0) {
    lines.push(
      `      no case reached a declared wall: this battery's outcomes are not explained by room${untraced}`,
    );
  } else if (battery.boundedWithoutPass.length === 0) {
    lines.push("      every case at a wall still passed: the wall cost this battery no verdict");
  } else {
    lines.push(
      `      ${battery.boundedWithoutPass.join(", ")} reached a wall without passing: that verdict rests on a truncated solve`,
    );
  }
  return lines;
}

export function renderWalls(report: WallsReport): string {
  if (report.state !== "recorded") return `${report.campaign}: ${report.reason}`;
  return [
    `${report.batteries.length} batteries in ${report.campaign}`,
    ...report.batteries.flatMap(batteryLines),
  ].join("\n");
}

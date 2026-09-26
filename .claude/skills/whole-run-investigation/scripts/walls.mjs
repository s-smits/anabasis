// Which of a harness's own declared budgets actually bound its solves. `agent/config.yaml` is the
// one file the Builder writes that the loop never inspects afterwards, and no other reader opens it:
// every case's spent time and turns are recorded, the walls they ran against are not. This joins the
// two, per battery, so "give the solver more room" is answered from the record rather than assumed.
//
//   bun wri.mjs walls <target> [--battery <runId>] [--json]
//
// The reading that changes a decision is the negative one: a battery whose median case spends a
// tenth of the declared solve wall has no outcome explained by room. The positive reading names
// the case that ended on the wall, to the minute.
//
// A turn is one outer prompt carrying an unbounded internal tool loop, so a solver that finishes
// without being nudged records one turn however much work it did: a battery can record one or two
// turns of twenty-four per case while running dozens of tool calls. A turn share is therefore not
// room the solver could have used, and this reader states tool calls and elapsed time instead. The
// turn wall still binds the case that reaches it, so `turn-bound` stays.
//
// A case that reached no wall is reported by what the record says it did — the solve was accepted
// as a submission, or it ended without one. Reading both as one cut-solve label describes a case
// that simply finished as truncated. A case that passed on a wall is `submitted-at-wall`: the wall
// was reached and cost the verdict nothing, so it is neither a truncated solve nor room to add.
// Lane 22 reads this table.
import { existsSync } from "#src/meta/filesystem.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { campaignTraceRoots } from "#src/claim/trace-read.ts";
import { measuredProductDir } from "#src/run/product-versions.ts";
import { classifyCaseOutcome, readCaseRecord } from "#src/claim/case-record.ts";
import {
  DEFAULT_HARNESS_SETTINGS,
  HARNESS_CONFIG_FILE,
  harnessSettings,
} from "#src/correctness-bundle/harness-config.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";

export const WALLS_SCHEMA = "wri-solve-walls/v2";
/** A share at or above this is read as the case ending on that wall rather than near it. A solve
 *  the host stops is recorded a moment after the wall, so an exact 1.0 is not the only binding. */
export const BOUND_SHARE = 0.95;
/** Below this, with no completed turn, the case spent no budget: the host stopped before the solve. */
export const UNSTARTED_MS = 30_000;
/** The bounds that say a declared wall was reached, whatever the verdict. */
export const WALL_BOUNDS = new Set(["time-bound", "turn-bound", "submitted-at-wall"]);

const share = (used, wall) => (wall > 0 ? Math.round((used / wall) * 1000) / 1000 : null);
const minutes = (ms) => Math.round(ms / 600) / 100;
const median = (values) =>
  values.length === 0 ? null : [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Every case row the campaign recorded, grouped by the battery that ran it, through the strict reader. */
function caseRows(campaign) {
  const byRun = new Map();
  for (const { row } of readCaseRecord(join(campaign, "case-record.jsonl"))) {
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
function solverOf(roots, runId, taskId) {
  for (const root of roots) {
    const path = join(root, "runs", runId, "cases", taskId, "case-result.json");
    if (!existsSync(path)) continue;
    const solver = readJsonFile(path).solver ?? {};
    const errors = Array.isArray(solver.errors) ? solver.errors.filter((value) => isString(value)) : [];
    return { turns: solver.completedTurns ?? null, toolCalls: solver.toolCalls ?? null, errors };
  }
  return { turns: null, toolCalls: null, errors: [] };
}

/** The walls the product this battery measured declared, and how each compares with the seeded
 *  default. Which product that was is the controller ledger's binding (`measuredProductDir`), not
 *  a directory named after the battery: a task probe measures the retained version an earlier
 *  round published under its own id. A battery the ledger binds to no product reads the defaults
 *  and says so, and a bound product without a config reads them too, because the host applies them. */
function wallsOf(campaign, runId) {
  const product = measuredProductDir(dirname(dirname(campaign)), basename(campaign), runId);
  const settings = product === null ? DEFAULT_HARNESS_SETTINGS : harnessSettings(product);
  const moved = Object.entries(settings)
    .filter(([key, value]) => value !== DEFAULT_HARNESS_SETTINGS[key])
    .map(([key, value]) => ({ key, declared: value, seeded: DEFAULT_HARNESS_SETTINGS[key] }));
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
function boundOf({ elapsedMs, timeShare, turnShare, turns, acceptedSubmit, passed }) {
  if (elapsedMs === null && turns === null) return "unrecorded";
  const atWall = (timeShare !== null && timeShare >= BOUND_SHARE) || (turnShare !== null && turnShare >= 1);
  if (atWall && passed) return "submitted-at-wall";
  if (timeShare !== null && timeShare >= BOUND_SHARE) return "time-bound";
  if (turnShare !== null && turnShare >= 1) return "turn-bound";
  if (elapsedMs !== null && elapsedMs < UNSTARTED_MS && (turns === null || turns === 0)) return "unstarted";
  return acceptedSubmit ? "submitted" : "no-submit";
}

function caseOf(row, solver, settings) {
  const started = isString(row.solverStartedAt) ? Date.parse(row.solverStartedAt) : null;
  const ended = isString(row.solverEndedAt) ? Date.parse(row.solverEndedAt) : null;
  const elapsedMs = started === null || ended === null ? null : ended - started;
  const timeShare = elapsedMs === null ? null : share(elapsedMs, settings.solveMs);
  const turnShare = solver.turns === null ? null : share(solver.turns, settings.maxTurns);
  const acceptedSubmit = row.acceptedSubmit;
  const outcome = classifyCaseOutcome(row);
  return {
    taskId: row.taskId,
    family: row.family,
    outcome,
    bound: boundOf({
      elapsedMs,
      timeShare,
      turnShare,
      turns: solver.turns,
      acceptedSubmit,
      passed: outcome === "pass",
    }),
    elapsedMinutes: elapsedMs === null ? null : minutes(elapsedMs),
    timeShare,
    turns: solver.turns,
    turnShare,
    toolCalls: solver.toolCalls,
    errors: solver.errors,
  };
}

function batteryOf(campaign, roots, runId, rows) {
  const walls = wallsOf(campaign, runId);
  const cases = rows.map((row) => caseOf(row, solverOf(roots, runId, row.taskId), walls.settings));
  const times = cases.flatMap((row) => (row.timeShare === null ? [] : [row.timeShare]));
  const calls = cases.flatMap((row) => (isNumber(row.toolCalls) ? [row.toolCalls] : []));
  const bounds = {};
  for (const row of cases) bounds[row.bound] = (bounds[row.bound] ?? 0) + 1;
  const outcomes = {};
  for (const row of cases) outcomes[row.outcome] = (outcomes[row.outcome] ?? 0) + 1;
  return {
    runId,
    cases: cases.length,
    walls,
    bounds,
    outcomes,
    time: { median: median(times), max: times.length === 0 ? null : Math.max(...times) },
    // Tool calls, not a turn share: the calls are the work the turns carried, and the turn wall is
    // read per case by `turn-bound` rather than by a median that one long turn leaves near zero.
    toolCalls: { median: median(calls), max: calls.length === 0 ? null : Math.max(...calls) },
    atWall: cases.filter((row) => WALL_BOUNDS.has(row.bound)),
    // `submitted-at-wall` already names the pass, so the two truncating bounds are the whole set.
    boundedWithoutPass: cases
      .filter((row) => row.bound === "time-bound" || row.bound === "turn-bound")
      .map((row) => row.taskId),
    rows: cases,
  };
}

/** @param {{ campaign: string, runId?: string | null }} named `runId` absent reads every battery. */
export function buildWalls({ campaign, runId = null }) {
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
      "A turn is one outer prompt carrying an unbounded internal tool loop, so a solver that finishes without being nudged records one turn whatever it did inside it. Tool calls are that work; a turn count below the wall is not room the solver could have used.",
      "A case that passed at a wall is not a defect. A case that reached a wall without passing is the one reading that supports more room, and its verdict is a truncated solve rather than a settled capability failure.",
    ],
  };
}

function batteryLines(battery) {
  const { settings, moved, source } = battery.walls;
  const pct = (value) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);
  const lines = [
    `  ${battery.runId}: ${battery.cases} cases, ${Object.entries(battery.outcomes)
      .map(([kind, count]) => `${kind} ${count}`)
      .join(", ")}`,
    `      walls: solve ${minutes(settings.solveMs)} min, ${settings.maxTurns} turns, shell ${settings.shellDefaultSeconds} s, concurrency ${settings.solveConcurrency} (${source})`,
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
      `      at a wall: ${row.taskId} ${row.bound}, ${row.elapsedMinutes} min (${pct(row.timeShare)}), ${row.turns} turn(s) of ${battery.walls.settings.maxTurns}, ${row.toolCalls ?? "n/a"} tool calls, ${row.outcome}, ${recorded}`,
    );
  }
  if (battery.atWall.length === 0) {
    lines.push("      no case reached a declared wall: this battery's outcomes are not explained by room");
  } else if (battery.boundedWithoutPass.length === 0) {
    lines.push("      every case at a wall still passed: the wall cost this battery no verdict");
  } else {
    lines.push(
      `      ${battery.boundedWithoutPass.join(", ")} reached a wall without passing: that verdict rests on a truncated solve`,
    );
  }
  return lines;
}

export function renderWalls(report) {
  if (report.state !== "recorded") return `${report.campaign}: ${report.reason}`;
  return [
    `${report.batteries.length} batteries in ${report.campaign}`,
    ...report.batteries.flatMap(batteryLines),
  ].join("\n");
}

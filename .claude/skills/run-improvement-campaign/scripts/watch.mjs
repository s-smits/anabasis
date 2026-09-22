#!/usr/bin/env bun

/**
 * Watch named runs and speak only on a deviation. Each pass reads the same recorded files
 * `status.mjs` reads, compares them with the snapshot stored at `--state`, and prints nothing
 * while a run merely progresses. It returns (exit 3) the moment something needs a reader: a
 * terminal, a controller that died without one, a non-result or safeguard count that grew, a
 * refused claim, a climb decision that says the ladder is stuck, a Builder session past a
 * `BUILDER_LIMITS` row, or evidence older than `--stall-minutes`. With `--every N` it
 * loops inside one process, so a background shell call costs no model turn until it returns;
 * exit 0 says every named run closed or `--max-seconds` elapsed with nothing to report.
 *
 * Every stop row carries the move it implies — `surgical`, `reserved` or `overhaul` — so a fired
 * watch hands over a choice rather than a word to interpret. It still touches no run: a stall row
 * names what it sampled (the Builder's controller-event transcripts and the Claude CLI stores under
 * the run's TMPDIR), the operator kills a controller, and free space under
 * `--disk-min-gib` on the campaigns volume is one `host` row shared by every watched run.
 */
import { existsSync, statfsSync } from "#src/meta/filesystem.ts";
import { isAbsolute } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { DEFAULT_DISK_MIN_GIB } from "../../launch-run/scripts/options.ts";
import { readCampaignsStatus } from "./status.mjs";
import { isNumber } from "#src/meta/json-shape.ts";
import { readJsonFile, writeJsonFile } from "#src/meta/completed-json.ts";

/** What a settled decision asks the reader to do, keyed by the action that names its own move
 *  whatever the band said, or by the zone `placeOnBand` recorded for the battery it placed. The
 *  three set-asides record a shape whose rate is not difficulty evidence and each names an owner
 *  to patch; `ease` and `repair-difficulty` are older spellings still in recorded campaigns.
 *
 *  Zones share the table because the action word does not survive a rename. `ease` was the only
 *  overshoot alarm here and the open stack stopped writing it: it spells all five zones `placed`
 *  and puts the reading in `placement.zone`. Keyed on the action alone, every `placed` row mapped
 *  to null, so a battery that overshot the band printed as ordinary progress — the same failure as
 *  the streak that had to stop counting `climb`. The four zones absent here are the mechanism
 *  reading its own score, which is news rather than a stop. */
const MOVES = {
  ease: "reserved",
  "repair-difficulty": "reserved",
  "too-hard": "reserved",
  "repeated-failure-set": "surgical",
  "family-conflict": "surgical",
  "no-difficulty-evidence": "overhaul",
};

/** Batteries in a row the band placed too easy, which prove the ladder moved and the demand did
 *  not. AGENTS.md records campaign 3fd52f9e-28 moving only its published magnitudes for four
 *  consecutive batteries; the third row fires before the fourth repeats it.
 *
 *  The count reads the recorded zone, not the action word. Keyed on `climb` it would have gone
 *  silent the moment the open stack renamed that action `placed` — the same shape as the failure of
 *  2026-09-18, where the alarm read a field its tree's producer did not write and reported nothing
 *  wrong. A zone is what the Wilson owner recorded, and no rename moves it. */
const CLIMBS_WITHOUT_LIMIT = 3;

/** A Builder session that keeps working without getting closer to an accepted submit. Each limit
 *  sits one step above the worst a session that still reached acceptance recorded in the 40 truss
 *  epochs of 2026-09-13..15: four refused submits in a row, one repeated findings set, eleven
 *  checks, one environment non-result. The two stalled sessions crossed them: 7d433e had two
 *  census-wall previews in a row, and -13 ran 129 minutes without a submit. */
export const BUILDER_LIMITS = [
  ["refusedInARow", 5, (b) => `Builder blocked: ${b.refusedInARow} submits refused in a row`],
  [
    "sameFindingsInARow",
    2,
    (b) => `Builder blocked: ${b.sameFindingsInARow} refused submits in a row returned the same findings`,
  ],
  [
    "checksWithoutAccept",
    12,
    (b) => `Builder blocked: ${b.checksWithoutAccept} correctness_check calls without an accepted submit`,
  ],
  [
    "environmentInARow",
    2,
    (b) =>
      `Builder blocked: ${b.environmentInARow} previews in a row ended as environment non-results (${b.environmentKind ?? "?"})`,
  ],
  [
    "minutes",
    120,
    (b) => `Builder blocked: ${b.minutes} Builder minutes without a submit`,
    (b) => b.submits === 0,
  ],
];

/** The move a terminal implies, so a fired watch hands over a choice and not just a word.
 *  `surgical` names one owner and the fix is a commit on its PR; `reserved` keeps the product
 *  bytes fixed because the evidence names no owner yet; `overhaul` says the measurement, not a
 *  detail inside it, is what failed. A battery that finished entirely unaccepted is AGENTS.md's
 *  `no-difficulty-evidence`: it carries no capability rate and no difficulty strike, so patching
 *  inside it would be patching against nothing. */
/** Keyed by the nine controller terminal codes. A code with no move is a settled ending that asks
 *  for nothing: `completed` answered its question, and `stopped`, `operator-interrupted` and
 *  `fixed-product-boundary` were decided outside the evidence. `environment-blocked` and
 *  `budget-limited` name the environment owner, so the product bytes stay fixed — rule 15 forbids
 *  reading a battery of typed non-results as a product result. A code outside the set, such as the
 *  `signal-terminated` a timed kill records, also reserves: a deliberate interruption names no
 *  owner. */
const TERMINAL_MOVES = {
  completed: null,
  stopped: null,
  "operator-interrupted": null,
  "fixed-product-boundary": null,
  "build-failed": "surgical",
  "candidate-held": "surgical",
  "measurement-stalled": "overhaul",
  "environment-blocked": "reserved",
  "budget-limited": "reserved",
};

/** The facts one pass keeps for one run; everything a later pass compares against. */
export function snapshotOf(run) {
  const batteries = {};
  for (const battery of run.batteries) {
    batteries[battery.runId] = {
      verified: battery.verified,
      passed: battery.passed,
      unaccepted: battery.unaccepted,
      nonResult: battery.nonResult,
      cases: battery.cases ?? [],
    };
  }
  const safeguards = Object.fromEntries(run.safeguards.names);
  const harness = run.harness ?? null;
  return {
    runId: run.runId,
    terminal:
      run.terminal === null
        ? null
        : `${run.terminal.outcome ?? "?"}${run.terminal.abortClause === null ? "" : ` (${run.terminal.abortClause})`}`,
    terminalCode: run.terminal === null ? null : terminalCode(run.terminal),
    alive: run.lockAlive === true,
    batteries,
    open: { count: run.open.count, oldest: run.open.oldestMinutes, wall: run.open.wallMinutes },
    claims: { total: run.claims.total, ok: run.claims.ok },
    promotions: run.promotions,
    epochs: run.epochs,
    safeguards,
    malformedSafeguards: run.safeguards.malformed,
    evidenceAgeMinutes: run.evidenceAgeMinutes,
    sessionWriteAgeMinutes: isNumber(run.sessionWriteAgeMinutes) ? run.sessionWriteAgeMinutes : null,
    builder: run.builder ?? null,
    difficulty: run.difficulty ?? [],
    harness:
      harness === null
        ? null
        : {
            commits: harness.commits,
            rehearsals: harness.rehearsals,
            submits: harness.submits,
            repairs: harness.repairs,
            files: Object.fromEntries(harness.files.map((file) => [file.path, [file.lines, file.ms]])),
          },
  };
}

/** How many rows at the end of a list match — the shape both the too-easy streak and the
 *  non-result stop read, since each watches its trailing run rather than its total. */
function trailingRun(rows, matches) {
  let run = 0;
  for (let index = rows.length - 1; index >= 0 && matches(rows[index]); index -= 1) run += 1;
  return run;
}

/** The controller's own climb decisions, one row each as they land. This is the half of the climb
 *  a score cannot show: 24 of 25 passing says the battery was easy, and only the decision says
 *  whether the next one asks for more. A first pass reads the newest decision alone, because the
 *  ladder's current position is where the reader is and the earlier steps are history. */
function difficultyDeltas(previous, current, add) {
  const start =
    previous === null ? Math.max(current.difficulty.length - 1, 0) : (previous.difficulty ?? []).length;
  for (const [index, row] of current.difficulty.entries()) {
    if (index < start) continue;
    const seen = current.difficulty.slice(0, index + 1);
    // The trailing rows the band read too easy, and the batteries behind them. `difficulty-decisions/`
    // names each file `<iteration>-<evidence digest>`, so one battery decided twice writes two rows —
    // which a `--run <runId>` continuation does, since the round counter restarts at 1 and decides
    // the same iteration id again against a longer history. Counted as rows, two readings of one
    // battery are two steps of a streak whose whole sentence is that the level moved. The claim is
    // about batteries, so the count is, and each battery names its score once.
    const run = seen.slice(seen.length - trailingRun(seen, (climb) => climb.zone === "too-easy"));
    const scored = new Map(run.map((climb) => [climb.battery, climb.placement]));
    const easy = scored.size;
    // A decision's move is its own action's, or the zone of the battery it placed; a row naming
    // neither is a kind this reader cannot place, which is worth a look.
    const move = MOVES[row.action] ?? (row.zone === null ? "reserved" : (MOVES[row.zone] ?? null));
    // The streak is the band's reading, so it fires on the recorded zone; a row whose action names
    // its own move keeps it rather than being swallowed by the count.
    if (move === null && row.zone === "too-easy" && easy >= CLIMBS_WITHOUT_LIMIT) {
      const scores = [...scored.values()].filter((text) => text !== null).join(", ");
      add(
        "stop",
        `battery ${row.battery}: ${easy} too-easy batteries in a row (${scores}); the level moved and no battery found the limit — change what the tasks demand, not their magnitudes`,
        "overhaul",
      );
    } else {
      // A set-aside places no battery on the band, so the action is the whole row.
      const read = [row.action, row.placement].filter((part) => part !== null).join(", ");
      add(move === null ? "info" : "stop", `battery ${row.battery}: ${read}`, move);
    }
  }
}

function caseLine(id, row) {
  const name = `${row.taskId ?? "?"}${row.family === null ? "" : ` (${row.family})`}`;
  if (row.kind === "verified") return `${id} ${name}: verified ${row.pass ? "pass" : "fail"}`;
  if (row.kind === "unaccepted") {
    return `${id} ${name}: unaccepted, the agent produced no accepted submission`;
  }
  return `${id} ${name}: non-result${row.why === null ? "" : ` (${row.why})`}`;
}

/** The cases this pass learned, one row each, never a restated total. A tick that reports
 *  "now 3/7 verified pass" says nothing a reader can act on; "mast-04 unaccepted" names a task to
 *  open. Five typed non-results in a row is the one battery condition that invalidates the
 *  measurement rather than naming an owner inside it. */
function batteryDeltas(previous, current, add) {
  for (const [id, now] of Object.entries(current.batteries)) {
    const before = previous?.batteries?.[id];
    if (before === undefined) add("info", `battery ${id} started`);
    // A first pass inherits cases it never watched. Naming them one by one would restate history as
    // news; the started row says where the reader is, and every later pass carries the increment.
    if (previous !== null) {
      for (const row of now.cases.slice(before?.cases?.length ?? 0)) add("info", caseLine(id, row));
    }
    if (now.nonResult > (before?.nonResult ?? 0)) {
      add("stop", `battery ${id} non-results ${before?.nonResult ?? 0} -> ${now.nonResult}`, "reserved");
    }
    // AGENTS.md rule 6 stops scheduling new cases after five typed non-results in a row, so the
    // trailing run, not the total, is the condition to watch.
    const nonResult = (row) => row.kind === "nonResult";
    const trailing = trailingRun(now.cases, nonResult);
    if (trailing >= 5 && trailingRun(before?.cases ?? [], nonResult) < 5) {
      add(
        "stop",
        `battery ${id} ended ${trailing} cases in a row as typed non-results; stop scheduling and record the rest as provider non-results`,
        "overhaul",
      );
    }
  }
}

function safeguardDeltas(previous, current, add) {
  for (const [name, count] of Object.entries(current.safeguards)) {
    const before = previous?.safeguards?.[name] ?? 0;
    // A safeguard's first line is a lead to read; the same name firing once per iteration
    // (27-toolchain-unreferenced on truss-run11, three lines in an hour) is progress, not news.
    if (count > before) {
      add(
        before === 0 ? "stop" : "info",
        `safeguard ${name} fired ${count - before} more time(s), ${count} total`,
        before === 0 ? "surgical" : null,
      );
    }
  }
  if (current.malformedSafeguards > (previous?.malformedSafeguards ?? 0)) {
    add("stop", `safeguard log has ${current.malformedSafeguards} malformed line(s)`, "surgical");
  }
}

/** Raise a possible stall only when the sampled session store is quiet too: a Builder authoring
 *  turn can record no campaign evidence for hours while its transcript grows at every tool call and
 *  a Claude CLI appends its own as it streams (run53 on 2026-09-03 was flagged twice at 45 minutes
 *  inside one working rebuild turn). `status.mjs` samples both stores. The row fires once, when
 *  both ages cross the threshold; a stale campaign with a writing session is one info row, and
 *  a run with no store to sample counts as quiet. This remains a lead: the current launch receipt
 *  may name a store outside the historical paths that status.mjs samples. */
function stalled(snapshot, stallMinutes) {
  return (
    snapshot.evidenceAgeMinutes >= stallMinutes &&
    (snapshot.sessionWriteAgeMinutes === null || snapshot.sessionWriteAgeMinutes >= stallMinutes)
  );
}

/** A battery mid-solve writes nothing until a case settles, so silence under the harness's own
 *  solve wall is work rather than a stall; past that wall the host stopped enforcing its own
 *  ceiling and the silence is worth a reader. */
function solving(snapshot) {
  const open = snapshot?.open ?? null;
  return open !== null && open.count > 0 && open.oldest !== null && open.oldest < open.wall;
}

function stallRow(previous, current, stallMinutes, add) {
  if (current.evidenceAgeMinutes < stallMinutes || solving(current)) return;
  if (stalled(current, stallMinutes)) {
    // A pass the solve wall silenced reported nothing, so it cannot stand in for a reported stall.
    if (previous !== null && stalled(previous, stallMinutes) && !solving(previous)) return;
    const sampled =
      current.sessionWriteAgeMinutes === null
        ? "no session store to sample"
        : `the session store last wrote ${current.sessionWriteAgeMinutes} min ago`;
    add(
      "stop",
      `no new evidence for ${current.evidenceAgeMinutes} min and ${sampled} (stall threshold ${stallMinutes}); read fullrun.log and the launchd state`,
      "reserved",
    );
  } else if (previous === null || previous.evidenceAgeMinutes < stallMinutes) {
    add(
      "info",
      `no new campaign evidence for ${current.evidenceAgeMinutes} min; the session store wrote ${current.sessionWriteAgeMinutes} min ago, which shows activity but not completed work`,
    );
  }
}

function builderRows(previous, current, add) {
  const now = current.builder;
  if (now === null) return;
  const before = previous?.builder?.epoch === now.epoch ? previous.builder : null;
  for (const [key, limit, detail, applies = () => true] of BUILDER_LIMITS) {
    const crossed = (b) => b !== null && applies(b) && b[key] >= limit;
    if (crossed(now) && !crossed(before)) {
      add("stop", `${detail(now)} (epoch ${now.epoch}, limit ${limit})`, "surgical");
    }
  }
}

function completed(snapshot) {
  return snapshot !== null && snapshot.terminal !== null && !snapshot.alive;
}

/** The controller's own terminal code, which is not `outcome`. `outcome` has two values and the
 *  code is one of nine: across the 62 terminals recorded by 2026-09-20, `completed` covers
 *  `operator-interrupted`, `build-failed`, `candidate-held` and `stopped`, and `aborted` covers
 *  `environment-blocked`, `budget-limited` and `signal-terminated`. `abortClause` carries the code
 *  when the run aborted; otherwise `terminalReason` opens with it. */
export function terminalCode(terminal) {
  if (typeof terminal.abortClause === "string" && terminal.abortClause.length > 0) {
    return terminal.abortClause;
  }
  const reason = typeof terminal.reason === "string" ? terminal.reason : "";
  const leading = reason.split(":")[0].trim();
  return leading.length > 0 ? leading : (terminal.outcome ?? null);
}

function terminalMove(snapshot) {
  const batteries = Object.values(snapshot.batteries);
  const scored = batteries.filter((battery) => battery.verified + battery.unaccepted > 0);
  if (scored.length > 0 && scored.every((battery) => battery.verified === 0)) return "overhaul";
  // A state file written before this reader existed carries no code; fall back to the rendered
  // outcome word so an old snapshot reserves rather than throwing.
  const code = snapshot.terminalCode ?? String(snapshot.terminal).split(" ")[0];
  return code in TERMINAL_MOVES ? TERMINAL_MOVES[code] : "reserved";
}

/** Deviations between two snapshots of one run. `previous === null` is the first pass: only
 *  absolute conditions fire, growth needs a baseline. */
/** The bundle files one tick actually moved. A frozen accepted bundle never moves, so this stays
 *  silent after adoption; during a long authoring turn it is the only visible sign of what the
 *  Builder is writing. A first reading names nothing, because everything present then is older than
 *  the watch rather than new. */
function harnessRows(previous, current, add) {
  const files = current.harness?.files ?? null;
  // A state file written before this reader existed carries no `harness` key at all, and every file
  // would read as new on the first pass after an upgrade. Absent is not the same as read-and-empty.
  if (files === null || previous === null || !("harness" in previous)) return;
  const before = previous.harness?.files ?? {};
  const counts = current.harness;
  const priorCounts = previous.harness ?? null;
  if (priorCounts !== null && counts.commits > priorCounts.commits) {
    add(
      "info",
      `authoring ${priorCounts.commits} -> ${counts.commits} commits: ${counts.rehearsals} rehearsal(s), ${counts.submits} submit attempt(s), ${counts.repairs} repair round(s)`,
    );
  }
  for (const [path, [lines, ms]] of Object.entries(files)) {
    const prior = before[path] ?? null;
    if (prior !== null && prior[1] === ms) continue;
    add("info", `wrote ${path}, ${lines} lines${prior === null ? " (new)" : ` (was ${prior[0]})`}`);
  }
}

export function deviations(previous, current, options = {}) {
  if (options.completionOnly) {
    return completed(current) && !completed(previous)
      ? [
          {
            runId: current.runId,
            level: "stop",
            act: terminalMove(current),
            detail: `terminal: ${current.terminal}; controller exited`,
          },
        ]
      : [];
  }
  const stallMinutes = options.stallMinutes ?? 45;
  const rows = [];
  /** @param {string | null} [act] the move this deviation reserves, when it names one */
  const add = (level, detail, act = null) => rows.push({ runId: current.runId, level, detail, act });
  if (current.terminal !== null) {
    if (previous === null || previous.terminal === null) {
      add("stop", `terminal: ${current.terminal}`, terminalMove(current));
    }
    return rows;
  }
  if (current.alive) {
    stallRow(previous, current, stallMinutes, add);
  } else {
    add("stop", "controller not alive and no terminal written", "reserved");
  }
  builderRows(previous, current, add);
  batteryDeltas(previous, current, add);
  if (current.open.count !== (previous?.open?.count ?? 0)) {
    add(
      "info",
      `${current.open.count} case(s) open, oldest ${current.open.oldest ?? "-"} of ${current.open.wall} min`,
    );
  }
  harnessRows(previous, current, add);
  difficultyDeltas(previous, current, add);
  safeguardDeltas(previous, current, add);
  if (previous !== null) {
    const refused = current.claims.total - previous.claims.total - (current.claims.ok - previous.claims.ok);
    if (refused > 0) add("stop", `${refused} claim(s) written without ok`, "surgical");
    if (current.claims.ok > previous.claims.ok) {
      add("info", `claims ok ${previous.claims.ok} -> ${current.claims.ok}`);
    }
    if (current.promotions > previous.promotions) {
      add("info", `promotions ${previous.promotions} -> ${current.promotions}`);
    }
    if (current.epochs > previous.epochs) add("info", `epoch ${previous.epochs} -> ${current.epochs}`);
  }
  return rows;
}

export function renderDeviations(rows, now = new Date()) {
  const record = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  return rows
    .map((row) => {
      const move = row.act === null || row.act === undefined ? "" : `[${row.act}] `;
      return `${record} ${row.level.padEnd(4)} ${move}${row.runId}: ${row.detail}`;
    })
    .join("\n");
}

/** One line of live counters for an attended tick. A deviation-only pass is right for an unattended
 *  watch and wrong for a reader who asked just now: silence then says "nothing changed" where the
 *  reader wanted "here is where it stands". */
export function tickLine(run) {
  const battery = run.batteries.at(-1) ?? null;
  const running = run.lockAlive === true ? "live" : "no controller lock";
  const parts = [run.runId, run.terminal === null ? running : `terminal ${run.terminal.outcome ?? "?"}`];
  if (run.open.count > 0) {
    parts.push(
      `${run.open.count} case(s) open, oldest ${run.open.oldestMinutes} of ${run.open.wallMinutes} min`,
    );
  }
  if (battery !== null) {
    parts.push(
      `${battery.runId}: ${battery.passed}/${battery.verified} verified pass, ${battery.unaccepted} unaccepted, ${battery.nonResult} non-result`,
    );
  }
  parts.push(`evidence ${run.evidenceAgeMinutes} min ago`);
  if (run.harness !== null) {
    parts.push(`${run.harness.commits} authoring commit(s), ${run.harness.lines} bundle lines`);
  }
  return parts.join(" · ");
}

function readState(path) {
  if (!existsSync(path)) return { runs: {}, pending: [] };
  try {
    const parsed = readJsonFile(path);
    return {
      runs: parsed.runs ?? {},
      pending: Array.isArray(parsed.pending) ? parsed.pending : [],
      diskLow: parsed.diskLow === true,
    };
  } catch {
    return { runs: {}, pending: [] };
  }
}

/** Free space on the campaigns volume is a host condition every watched run shares. On 2026-09-03
 *  the data volume reached 486 MiB free and run52 and run54 died on ENOSPC inside one hour with
 *  no row anywhere; a run tree with its toolchains takes about 10 GiB. The row fires once when
 *  free space falls under `diskMinGib` and again only after it has recovered above it. */
function diskRows(state, options) {
  const free = options.freeGib ?? null;
  const minimum = options.diskMinGib ?? DEFAULT_DISK_MIN_GIB;
  if (free === null) return [];
  const low = free < minimum;
  const rows =
    low && state.diskLow !== true
      ? [
          {
            runId: "host",
            level: "stop",
            act: "reserved",
            detail: `free space ${free} GiB on the campaigns volume is under ${minimum} GiB; free space before any launch or gate`,
          },
        ]
      : [];
  state.diskLow = low;
  return rows;
}

/** One pass: compare, store, and return the rows to print (empty while nothing deviates).
 *  Info rows accumulate in the state as `pending` and print with the next stop row, so a fired
 *  report carries the progress since the last one. */
export function watchPass(status, runIds, state, options = {}) {
  const rows = options.completionOnly ? [] : [...state.pending];
  const closed = [];
  const missing = [];
  for (const runId of runIds) {
    const run = status.runs.find((candidate) => candidate.runId === runId);
    if (run === undefined) {
      missing.push(runId);
      continue;
    }
    const current = snapshotOf(run);
    rows.push(...deviations(state.runs[runId] ?? null, current, options));
    state.runs[runId] = current;
    if (options.completionOnly ? completed(current) : current.terminal !== null) closed.push(runId);
  }
  if (!options.completionOnly) {
    for (const runId of missing) {
      rows.push({
        runId,
        level: "stop",
        act: "reserved",
        detail: "no controller opening under the campaigns root",
      });
    }
    rows.push(...diskRows(state, options));
  }
  // An unattended pass holds info rows until something stops it, so a quiet night prints nothing.
  // An attended tick has a reader waiting now, so every row it has goes out and nothing is held.
  const fire = options.attended === true ? rows.length > 0 : rows.some((row) => row.level === "stop");
  state.pending = fire ? [] : rows.filter((row) => row.level === "info");
  return {
    rows: fire ? rows : [],
    allClosed: closed.length + missing.length === runIds.length && missing.length === 0,
  };
}

function parseArgs(argv) {
  const values = {
    campaigns: /** @type {string | null} */ (null),
    /** @type {string[]} */ runs: [],
    state: /** @type {string | null} */ (null),
    stallMinutes: 45,
    every: /** @type {number | null} */ (null),
    maxSeconds: 6 * 3600,
    diskMinGib: DEFAULT_DISK_MIN_GIB,
    completionOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--completion-only") {
      values.completionOnly = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`missing value for ${key}`);
    index += 1;
    if (key === "--campaigns") values.campaigns = value;
    else if (key === "--runs") {
      values.runs = value
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
    } else if (key === "--state") values.state = value;
    else if (key === "--stall-minutes") values.stallMinutes = Number(value);
    else if (key === "--every") values.every = Number(value);
    else if (key === "--disk-min-gib") values.diskMinGib = Number(value);
    else if (key === "--max-seconds") values.maxSeconds = Number(value);
    else throw new Error(`unknown argument ${key}`);
  }
  for (const key of ["campaigns", "state"]) {
    if (!isAbsolute(values[key] ?? "")) throw new Error(`--${key} must be an absolute path`);
  }
  if (values.runs.length === 0) throw new Error("--runs <id,id> names the runs to watch");
  return values;
}

/** Free GiB on the volume holding `path`, rounded down; null when the host cannot say. */
function freeGib(path) {
  try {
    const stats = statfsSync(path);
    return Math.floor((stats.bavail * stats.bsize) / 2 ** 30);
  } catch {
    return null;
  }
}

async function main(values) {
  const started = Date.now();
  for (;;) {
    const state = readState(values.state);
    const attended = values.every === null;
    const status = readCampaignsStatus(values.campaigns);
    const pass = watchPass(status, values.runs, state, {
      attended,
      completionOnly: values.completionOnly,
      stallMinutes: values.stallMinutes,
      freeGib: values.completionOnly ? null : freeGib(values.campaigns),
      diskMinGib: values.diskMinGib,
    });
    writeJsonFile(values.state, state);
    if (attended && !values.completionOnly) {
      for (const run of status.runs.filter((row) => values.runs.includes(row.runId))) {
        console.log(tickLine(run));
      }
    }
    if (pass.rows.length > 0) {
      console.log(renderDeviations(pass.rows));
      return attended ? 0 : 3;
    }
    if (pass.allClosed) {
      if (!values.completionOnly) console.log(`all watched runs closed: ${values.runs.join(", ")}`);
      return 0;
    }
    if (values.every === null || Date.now() - started >= values.maxSeconds * 1000) {
      if (values.every !== null && !values.completionOnly) {
        console.log(
          `quiet for ${values.maxSeconds} s: ${values.runs.join(", ")} still open, nothing deviated`,
        );
      }
      return 0;
    }
    await Bun.sleep(values.every * 1000);
  }
}

if (import.meta.main) {
  let values;
  try {
    values = parseArgs(runtimeProcess.argv.slice(2));
  } catch (error) {
    console.error(String(error.message));
    runtimeProcess.exit(2);
  }
  runtimeProcess.exit(await main(values));
}

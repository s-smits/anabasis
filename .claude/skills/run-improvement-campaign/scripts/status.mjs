#!/usr/bin/env bun

/**
 * One view over every campaign under a `campaigns/` root, grouped by the source commit each run
 * opened on. It reads only recorded files the controller writes (`controller/<run>/opening.json`
 * and `terminal.json`, `case-record.jsonl`, `.controller.lock`, `claims/`, `promotions/`,
 * `difficulty-decisions/`, `safeguards/<run>/SAFEGUARDS_LOG.txt`, `notes/predictions/<run>.jsonl`,
 * `versions/<version>/` for the frozen bundle and the cases its battery has open) and samples
 * process/session activity.
 * The counts are diagnostic rather than a denominator. `caseKind` below calls a row a non-result
 * whenever both verdict fields are null, without requiring the typed cause the validated outcome
 * reader requires, so read a capability rate from that reader and not from here. A battery whose
 * run has no terminal and a live controller lock is printed with ", partial" beside its row count,
 * because the remaining cases have not been written yet. It answers the question a fleet of
 * campaigns raises and no single file does: which run opened on which commit, which one a live
 * controller still holds, and which one has a battery open.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { join } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { CONTROLLER_LOCK_FILE } from "#src/run/campaign-lock.ts";
import { isControllerBatteryRunId } from "#src/run/controller-battery-record-policy.ts";
import { PREDICTIONS_DIR, ledgerPath, ledgerView } from "./prediction.mjs";
import { isBoolean, isNumber, isString } from "#src/meta/json-shape.ts";
import { readJsonFileOrNull } from "#src/meta/completed-json.ts";

/** The controller opening, whose presence is what makes a directory a recorded run. */
const OPENING = "opening.json";

/** Bundle directories the Builder authored, as `submit` froze them. `.toolchain`, `node_modules`
 *  and `.bundle-snapshots` hold installed and archived bytes the Builder did not write. */
const BUNDLE_DIRS = ["agent", "correctness-model"];

/** Named callables in one authored file: a `function` declaration, a named arrow and a class or
 *  object method. It counts what the Builder wrote, not what runs; a closure inside a function is
 *  one line of its owner, as `tools/loc/source-policy.ts` also reads it. */
const FUNCTION_PATTERNS = [
  /\bfunction\s+[A-Za-z_$]/g,
  /\b(?:const|let)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?\([^)]*\)\s*(?::[^=]+)?=>/g,
  /^\s{2,}(?:async\s+)?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*(?::[^{]+)?\{/gm,
];

/** The wall the harness set on one solve when `agent/config.yaml` says nothing (rule 14). */
const DEFAULT_SOLVE_MINUTES = 120;

function mtimeMs(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/** Legacy status classification. Two null verdicts count as a non-result here even without a
 * typed cause; this shortcut is not the current product's capability-denominator authority. */
export function caseKind(row) {
  if (row.runtimeNonResult !== null && row.runtimeNonResult !== undefined) return "nonResult";
  if (row.truthOk === null && row.pass === null) return "nonResult";
  if (row.acceptedSubmit === true && isBoolean(row.truthOk)) return "verified";
  return "unaccepted";
}

/** Battery counts from `case-record.jsonl`, keyed by the battery run id each row names. */
export function batteryCounts(caseRecordText) {
  const batteries = new Map();
  for (const line of caseRecordText.split("\n")) {
    if (line.trim().length === 0) continue;
    let row;
    try {
      row = capturedJsonParse(line);
    } catch {
      continue;
    }
    const record = row?.row ?? row;
    if (!isString(record?.runId)) continue;
    const counts = batteries.get(record.runId) ?? {
      runId: record.runId,
      verified: 0,
      passed: 0,
      unaccepted: 0,
      nonResult: 0,
      cases: [],
    };
    const kind = caseKind(record);
    counts[kind] += 1;
    if (kind === "verified" && record.truthOk === true) counts.passed += 1;
    // The ordered cases are what a live reader needs: a watch pass reports the ones it has not
    // seen instead of restating a total that says nothing new.
    counts.cases.push({
      taskId: isString(record.taskId) ? record.taskId : null,
      family: isString(record.family) ? record.family : null,
      kind,
      pass: record.truthOk === true,
      why: record.runtimeNonResultKind ?? record.runtimeNonResult?.kind ?? null,
    });
    batteries.set(record.runId, counts);
  }
  return [...batteries.values()];
}

export function processAlive(pid) {
  if (!isNumber(pid) || !Number.isInteger(pid) || pid <= 0) return false;
  return Bun.spawnSync(["ps", "-p", String(pid), "-o", "pid="]).exitCode === 0;
}

/** Fired safeguard names with counts from one run's log; a malformed line counts under `malformed`. */
export function safeguardCounts(logText) {
  const names = new Map();
  let malformed = 0;
  for (const line of logText.split("\n")) {
    if (line.trim().length === 0) continue;
    const name = line.split(" | ")[1];
    if (name === undefined || name.length === 0) {
      malformed += 1;
      continue;
    }
    names.set(name, (names.get(name) ?? 0) + 1);
  }
  return { names: [...names.entries()].sort(([a], [b]) => a.localeCompare(b)), malformed };
}

function readClaims(campaignDir) {
  const dir = join(campaignDir, "claims");
  if (!existsSync(dir)) return { total: 0, ok: 0 };
  let total = 0;
  let ok = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    total += 1;
    if (readJsonFileOrNull(join(dir, name))?.claim?.ok === true) ok += 1;
  }
  return { total, ok };
}

function countJsonFiles(dir) {
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".json")).length : 0;
}

function newestEvidenceMs(campaignDir, runDir) {
  let newest = Math.max(
    mtimeMs(join(campaignDir, "case-record.jsonl")),
    mtimeMs(join(runDir, "terminal.json")),
    mtimeMs(join(runDir, OPENING)),
  );
  for (const name of readdirSync(campaignDir)) {
    if (!name.startsWith("epoch-")) continue;
    const epochDir = join(campaignDir, name);
    for (const file of readdirSync(epochDir)) {
      if (file.startsWith("builder-execution")) newest = Math.max(newest, mtimeMs(join(epochDir, file)));
      // Task-only authoring settles iterations without writing a Builder execution record.
      // Read the controller's numbered receipts, never author-writable workspace files.
      if (/^\d+-/.test(file)) newest = Math.max(newest, mtimeMs(join(epochDir, file, "iteration.json")));
    }
  }
  return newest;
}

/** The live Builder session's gate history in the newest epoch, from its checkpointed execution
 *  records and preview trials. Counts restart at an accepted submit, and non-results restart at
 *  a preview that produced a result. */
export function readBuilderSession(campaignDir) {
  const epochs = readdirSync(campaignDir)
    .filter((name) => name.startsWith("epoch-"))
    .map((name) => join(campaignDir, name));
  const epochDir = epochs.sort((a, b) => mtimeMs(a) - mtimeMs(b)).at(-1);
  if (epochDir === undefined) return null;
  const records = readdirSync(epochDir)
    .filter((file) => /^builder-execution.*\.json$/.test(file))
    .map((file) => readJsonFileOrNull(join(epochDir, file)))
    .filter((record) => record !== null);
  const submits = records
    .flatMap((record) => (Array.isArray(record.submits) ? record.submits : []))
    .sort((a, b) => (a.atMs ?? 0) - (b.atMs ?? 0));
  let refusedInARow = 0;
  let sameFindingsInARow = 0;
  let digest = null;
  for (const submit of submits) {
    if (submit.outcome === "accepted") [refusedInARow, sameFindingsInARow, digest] = [0, 0, null];
    else {
      refusedInARow += 1;
      sameFindingsInARow =
        isString(submit.findingsDigest) && submit.findingsDigest === digest ? sameFindingsInARow + 1 : 1;
      digest = submit.findingsDigest ?? null;
    }
  }
  const byName = (record, name) => {
    const count = record.toolCalls?.byName?.[name] ?? record.toolCalls?.byName?.[`mcp__harness__${name}`];
    return isNumber(count) ? count : 0;
  };
  // Summed over a number[] so the accumulator is a number rather than the records' JsonValue.
  const total = (/** @type {number[]} */ values) => values.reduce((sum, value) => sum + value, 0);
  const checks = total(records.map((record) => byName(record, "correctness_check")));
  const trialsDir = join(epochDir, "trials");
  const trials = existsSync(trialsDir)
    ? readdirSync(trialsDir)
        .map((name) => join(trialsDir, name))
        .sort((a, b) => mtimeMs(a) - mtimeMs(b))
    : [];
  let environmentInARow = 0;
  let environmentKind = null;
  for (const trial of trials) {
    const nonResult = readJsonFileOrNull(join(trial, "environment-non-result.json"));
    environmentInARow = nonResult === null ? 0 : environmentInARow + 1;
    if (nonResult !== null) environmentKind = nonResult.kind ?? null;
  }
  return {
    epoch: epochDir.split("/").at(-1),
    submits: submits.length,
    refusedInARow,
    sameFindingsInARow,
    checksWithoutAccept: submits.some((submit) => submit.outcome === "accepted") ? 0 : checks,
    environmentInARow,
    environmentKind,
    minutes: Math.round(
      total(records.map((record) => (isNumber(record.durationMs) ? record.durationMs : 0))) / 60000,
    ),
  };
}

/** The run's private TMPDIR as the launch procedure sets it. A Claude-transport session — the
 *  Builder, a review slot or the Built worker — runs the official CLI under a private config
 *  directory there (`ana-claude-cli-<id>/projects/<slug>/<session>.jsonl`), and the CLI appends to that
 *  transcript while it streams, so a long silent turn still moves it. A launcher with another temp
 *  root leaves only the Builder's own transcript to sample. */
export function runTmpRoot(runId, tmpParent = "/private/var/tmp") {
  return join(tmpParent, `ana-${runId}-tmp`);
}

/** Newest write among the Claude CLI config directories under a run's TMPDIR; null without one. */
function claudeCliWriteMs(tmpRoot) {
  if (!existsSync(tmpRoot)) return null;
  const writes = readdirSync(tmpRoot)
    .filter((name) => name.startsWith("ana-claude-cli-"))
    .map((name) => newestWriteMs(join(tmpRoot, name, "projects"), 2))
    .filter((value) => value !== null);
  return writes.length === 0 ? null : Math.max(...writes);
}

/** Newest write among the Builder's controller-event transcripts, one per session in its epoch
 *  directory, which open with the session and grow at every prompt, tool start, tool end and turn
 *  result; null before the first. */
function builderTranscriptWriteMs(campaignDir) {
  const writes = readdirSync(campaignDir)
    .filter((name) => name.startsWith("epoch-"))
    .flatMap((epoch) =>
      readdirSync(join(campaignDir, epoch))
        .filter((name) => name.startsWith("builder-events-") && name.endsWith(".jsonl"))
        .map((name) => mtimeMs(join(campaignDir, epoch, name))),
    );
  return writes.length === 0 ? null : Math.max(...writes);
}

/** Newest mtime under `dir`, walking at most `depth` levels and `limit` entries per directory;
 *  a tool tree can hold thousands of files. Null when `dir` does not exist. */
export function newestWriteMs(dir, depth = 3, limit = 200) {
  if (!existsSync(dir)) return null;
  let newest = mtimeMs(dir);
  if (depth === 0) return newest;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true }).slice(0, limit);
  } catch {
    return newest;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    newest = Math.max(
      newest,
      entry.isDirectory() ? (newestWriteMs(path, depth - 1, limit) ?? 0) : mtimeMs(path),
    );
  }
  return newest;
}

/** Battery run directories this run owns, under the retained version and the historical
 *  `domains/<slug>/runs`, each proved by its `backends.json` to carry the opening's source and
 *  slots. Both roots are read because a run whose cases land under a retained version looks
 *  entirely idle to a reader watching only `domains/<slug>/runs`, and the watcher then stops a
 *  working battery as stalled. */
function batteryRunDirs(campaignDir, runId) {
  const opening = readJsonFileOrNull(join(campaignDir, "controller", runId, OPENING));
  if (!isString(opening?.source?.commit) || opening.source.dirty !== false) return [];
  const slug = campaignDir.split("/").at(-1);
  const versionsDir = join(campaignDir, "versions");
  const runsDirs = [
    join(campaignDir, "..", "..", "domains", slug, "runs"),
    ...(existsSync(versionsDir)
      ? readdirSync(versionsDir).map((version) => join(versionsDir, version, "runs"))
      : []),
  ];
  const dirs = [];
  for (const [runsDir, name] of runsDirs
    .filter((dir) => existsSync(dir))
    .flatMap((dir) => readdirSync(dir).map((child) => [dir, child]))) {
    const dir = join(runsDir, name);
    const backends = readJsonFileOrNull(join(dir, "backends.json"));
    if (
      !isControllerBatteryRunId(runId, name) ||
      backends?.slug !== slug ||
      backends.source?.commit !== opening.source.commit ||
      backends.source.dirty !== false ||
      ["builder", "built", "review"].some(
        (side) => slotLabel(backends[side]) !== slotLabel(opening.modelSlots?.[side]),
      )
    ) {
      continue;
    }
    dirs.push(dir);
  }
  return dirs;
}

/** A battery can reach real Built cases while the campaign ledger still holds no rows, so these
 * writes indicate session activity only; they never supply case outcomes or a denominator. */
function builtSessionWriteMs(campaignDir, runId) {
  let newest = null;
  for (const dir of batteryRunDirs(campaignDir, runId)) {
    const written = newestWriteMs(join(dir, "cases"), 2);
    if (written !== null) newest = Math.max(newest ?? 0, written);
  }
  return newest;
}

function bundleFiles(dir, prefix = "") {
  const rows = [];
  for (const entry of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) rows.push(...bundleFiles(path, `${prefix}${entry.name}/`));
    else if (/\.(ts|mjs|js|json|md|yaml)$/.test(entry.name)) {
      const text = readFileSync(path, "utf8");
      const functions = FUNCTION_PATTERNS.reduce(
        (total, pattern) => total + (text.match(pattern)?.length ?? 0),
        0,
      );
      rows.push({
        path: `${prefix}${entry.name}`,
        lines: text.split("\n").filter((line) => line.trim().length > 0).length,
        functions,
        ms: Math.round(mtimeMs(path)),
      });
    }
  }
  return rows;
}

/** What the authoring workspace's Git log records. The Builder never commits; the host commits at
 *  tool boundaries, so the log counts rehearsals (`correctness_check`), submit attempts including
 *  refused ones, and repair rounds. A settling epoch holds a handful of each, so a count in the
 *  dozens is a session that kept rehearsing and repairing without ever settling. */
function authoringCommits(campaignDir, epochKey) {
  const log = epochKey === null ? null : join(campaignDir, epochKey, "workspace", ".git", "logs", "HEAD");
  if (log === null || !existsSync(log)) return { commits: 0, rehearsals: 0, submits: 0, repairs: 0 };
  const lines = readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0);
  const count = (mark) => lines.filter((line) => line.includes(mark)).length;
  return {
    commits: lines.length,
    rehearsals: count("correctness_check"),
    submits: count("submit:"),
    repairs: count("(repair "),
  };
}

/** What the Builder actually produced, per authored file: the frozen version once the gate accepted
 *  it, and the live epoch workspace before that, so a long authoring turn is readable while it runs
 *  rather than only after it lands. Each row carries its write time, which is what lets a tick name
 *  the files that actually moved. Size is not quality — a long evaluator with two checks is weaker
 *  than a short one with six — so the table carries the declared counts beside the lines.
 *  @param {string | null} [epochKey] the live epoch to read while the gate has frozen no version */
export function harnessMetrics(campaignDir, runId, epochKey = null) {
  const frozen = join(campaignDir, "versions", runId);
  const versionDir = existsSync(frozen)
    ? frozen
    : epochKey === null
      ? null
      : join(campaignDir, epochKey, "workspace");
  if (versionDir === null || !existsSync(versionDir)) return null;
  const files = BUNDLE_DIRS.flatMap((name) => bundleFiles(join(versionDir, name), `${name}/`)).sort(
    (a, b) => b.lines - a.lines,
  );
  // A workspace before its first authored file has nothing to report, and a row of zeroes reads as a
  // measured empty bundle rather than as a session that has not written yet.
  if (files.length === 0) return null;
  const tasks = readJsonFileOrNull(join(versionDir, "correctness-model", "tasks.json"));
  const controls = readJsonFileOrNull(join(versionDir, "correctness-model", "controls.json"));
  const spec = readJsonFileOrNull(join(versionDir, "agent", "tools-spec.json"));
  const brief = readJsonFileOrNull(join(versionDir, "correctness-model", "brief.json"));
  const list = Array.isArray(tasks) ? tasks : (tasks?.tasks ?? []);
  return {
    ...authoringCommits(campaignDir, epochKey),
    files,
    lines: files.reduce((total, file) => total + file.lines, 0),
    functions: files.reduce((total, file) => total + file.functions, 0),
    tasks: list.length,
    families: new Set(list.map((task) => task.family)).size,
    checks: (brief?.truthChecks ?? []).length,
    accepts: (controls?.accept ?? []).length,
    rejects: (controls?.reject ?? []).length,
    tools: (spec?.tools ?? []).length,
    presets: spec?.presets ?? [],
  };
}

/** Cases the battery opened and has not settled, with the oldest one's age and the wall that
 *  bounds it. A Built solve writes nothing between its start and its verdict, so an open case is
 *  the only recorded sign the battery is working — every write-mtime sample stays frozen at the
 *  moment the cases started, however long they run. Past `solve_minutes` the silence is no longer
 *  honest and the stall row is right to fire.
 *
 *  `settled` is keyed by battery run id, not flattened across the run: task ids repeat from one
 *  battery to the next, so a flat set let a task settled in battery 1 hide the same task still open
 *  in battery 2, and the battery then read as idle while it was working. */
export function openCases(campaignDir, runId, now, settled) {
  let count = 0;
  let oldestMs = null;
  let wallMinutes = DEFAULT_SOLVE_MINUTES;
  for (const dir of batteryRunDirs(campaignDir, runId)) {
    const config = join(dir, "..", "..", "agent", "config.yaml");
    const declared = Number(
      /^\s*solve_minutes:\s*(\d+)/m.exec(existsSync(config) ? readFileSync(config, "utf8") : "")?.[1],
    );
    if (Number.isFinite(declared) && declared > 0) wallMinutes = declared;
    const casesDir = join(dir, "cases");
    if (!existsSync(casesDir)) continue;
    // A battery run directory is named for its own run id, which is the key `settled` carries.
    const settledHere = settled.get(dir.split("/").at(-1)) ?? new Set();
    for (const taskId of readdirSync(casesDir)) {
      if (settledHere.has(taskId)) continue;
      count += 1;
      oldestMs = Math.min(oldestMs ?? Number.POSITIVE_INFINITY, mtimeMs(join(casesDir, taskId)));
    }
  }
  // A case cannot be older than the clock; a directory written this millisecond reads as 0.
  return {
    count,
    oldestMinutes: oldestMs === null ? null : Math.max(0, Math.round((now - oldestMs) / 60000)),
    wallMinutes,
  };
}

/** Newest write across source-bound Built cases, the Builder's transcripts and the Claude CLI's
 *  session stores; null if none exist. */
export function sessionWriteMs(campaignDir, runId, roots) {
  const present = [
    builtSessionWriteMs(campaignDir, runId),
    builderTranscriptWriteMs(campaignDir),
    claudeCliWriteMs(runTmpRoot(runId, roots.tmpParent)),
  ].filter((value) => value !== null);
  return present.length === 0 ? null : Math.max(...present);
}

function slotLabel(slot) {
  if (slot === null || typeof slot !== "object") return "?";
  return `${slot.kind ?? "?"}/${slot.model ?? "?"}/${slot.reasoningEffort ?? "?"}`;
}

/** The controller's own climb decisions for this run, in iteration order: the `ClimbAction` it
 *  chose and how the band placed the battery it settled. A score alone cannot show this half of
 *  the climb, and three too-easy batteries in a row say the ladder moved while the demand did not.
 *
 *  `difficulty-decisions/` names each file `<iteration>-<evidence digest>`, so it holds one record
 *  per decision rather than one per battery. A `--run <runId>` continuation restarts the round
 *  counter at 1 and decides the same iteration id again against a longer history, landing a second
 *  record beside the first; both rows then carry that battery and the iteration sort leaves their
 *  order to the directory. Nothing recorded says which reading is current — the filename binds a
 *  content digest, not a time — so a reader that counts batteries must count them by id. */
export function difficultyDecisions(campaignDir, runId) {
  const dir = join(campaignDir, "difficulty-decisions");
  if (!existsSync(dir)) return [];
  const rows = [];
  for (const name of readdirSync(dir)) {
    const record = name.endsWith(".json") ? readJsonFileOrNull(join(dir, name)) : null;
    if (!isString(record?.runId) || !isControllerBatteryRunId(runId, record.runId)) continue;
    const difficulty = record.difficulty ?? {};
    const decision = difficulty.decision ?? {};
    // How the band read the battery this decision settled, as the Wilson owner placed it. A record
    // written before `placement` (schema v2) says only which action it chose.
    const placement = decision.placement ?? null;
    rows.push({
      battery: record.runId,
      action: isString(decision.action) ? decision.action : "?",
      placement: placement === null ? null : `${placement.passes}/${placement.n} ${placement.zone}`,
      // The zone beside the sentence, because the alarm counts too-easy batteries and the action
      // word has been renamed more than once while the zone has not.
      zone: placement?.zone ?? null,
    });
  }
  // The battery id carries the iteration (`-i02`); the round, not the directory listing, is the order.
  const round = (battery) => Number(battery.split("-i").at(-1)) || 1;
  return rows.sort((a, b) => round(a.battery) - round(b.battery));
}

/** The status of one controller run inside one campaign directory. */
export function readRunStatus(campaignDir, runId, now = Date.now(), roots = {}) {
  const { tmpParent = "/private/var/tmp", predictions: predictionsDir = PREDICTIONS_DIR } = roots;
  const runDir = join(campaignDir, "controller", runId);
  const sessionMs = sessionWriteMs(campaignDir, runId, { tmpParent });
  const opening = readJsonFileOrNull(join(runDir, OPENING));
  const terminal = readJsonFileOrNull(join(runDir, "terminal.json"));
  const lock = readJsonFileOrNull(join(campaignDir, CONTROLLER_LOCK_FILE));
  const caseRecord = join(campaignDir, "case-record.jsonl");
  const batteries = batteryCounts(existsSync(caseRecord) ? readFileSync(caseRecord, "utf8") : "").filter(
    (battery) => isControllerBatteryRunId(runId, battery.runId),
  );
  const safeguardLog = join(campaignDir, "safeguards", runId, "SAFEGUARDS_LOG.txt");
  const predictions = ledgerView(ledgerPath(runId, predictionsDir));
  const slots = opening?.modelSlots ?? null;
  return {
    runId,
    slug: opening?.modelSlots?.slug ?? campaignDir.split("/").at(-1),
    source: isString(opening?.source?.commit) ? opening.source.commit : null,
    dirty: opening?.source?.dirty ?? null,
    slots:
      slots === null
        ? null
        : {
            builder: slotLabel(slots.builder),
            built: slotLabel(slots.built),
            review: slotLabel(slots.review),
          },
    cap: terminal?.providerResourceBudget?.cap ?? opening?.providerResourceBudget?.cap ?? null,
    used: terminal?.providerResourceBudget?.used ?? null,
    terminal:
      terminal === null
        ? null
        : {
            outcome: terminal.outcome ?? null,
            abortClause: terminal.abortClause ?? null,
            reason: terminal.terminalReason ?? null,
            denominator: terminal.denominator ?? null,
          },
    lockPid: isNumber(lock?.pid) ? lock.pid : null,
    lockAlive: isNumber(lock?.pid) ? processAlive(lock.pid) : false,
    batteries,
    open: openCases(
      campaignDir,
      runId,
      now,
      new Map(batteries.map((battery) => [battery.runId, new Set(battery.cases.map((row) => row.taskId))])),
    ),
    difficulty: difficultyDecisions(campaignDir, runId),
    harness: harnessMetrics(campaignDir, runId, opening?.epoch?.key ?? null),
    epochs: readdirSync(campaignDir).filter((name) => name.startsWith("epoch-")).length,
    claims: readClaims(campaignDir),
    promotions: countJsonFiles(join(campaignDir, "promotions")),
    safeguards: existsSync(safeguardLog)
      ? safeguardCounts(readFileSync(safeguardLog, "utf8"))
      : { names: [], malformed: 0 },
    predictions: {
      frozen: predictions.length,
      open: predictions.filter((row) => row.outcome === "open").length,
    },
    evidenceAgeMinutes: Math.round((now - newestEvidenceMs(campaignDir, runDir)) / 60000),
    sessionWriteAgeMinutes: sessionMs === null ? null : Math.round((now - sessionMs) / 60000),
    builder: readBuilderSession(campaignDir),
  };
}

/** Every run under a campaigns root, newest opening first, grouped by source commit. */
export function readCampaignsStatus(campaignsRoot, now = Date.now(), roots = {}) {
  const runs = [];
  if (!existsSync(campaignsRoot)) return { groups: [], runs };
  for (const slug of readdirSync(campaignsRoot).sort()) {
    const controller = join(campaignsRoot, slug, "controller");
    if (!existsSync(controller)) continue;
    for (const runId of readdirSync(controller)) {
      if (!existsSync(join(controller, runId, OPENING))) continue;
      runs.push({
        ...readRunStatus(join(campaignsRoot, slug), runId, now, roots),
        openedAtMs: mtimeMs(join(controller, runId, OPENING)),
      });
    }
  }
  runs.sort((a, b) => b.openedAtMs - a.openedAtMs);
  const groups = new Map();
  for (const run of runs) {
    const key = run.source ?? "source-unresolved";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(run);
  }
  return { groups: [...groups.entries()].map(([source, members]) => ({ source, runs: members })), runs };
}

function runState(run) {
  if (run.terminal !== null) {
    return `closed ${run.terminal.outcome ?? "?"}${run.terminal.abortClause === null ? "" : ` (${run.terminal.abortClause})`}`;
  }
  if (run.lockAlive) return `live pid ${run.lockPid}`;
  return `open, no live controller${run.lockPid === null ? "" : ` (lock pid ${run.lockPid} dead)`}`;
}

function batteryLine(battery, live) {
  const total = battery.verified + battery.unaccepted + battery.nonResult;
  return `${battery.runId}: ${battery.passed}/${battery.verified} verified pass, ${battery.unaccepted} unaccepted, ${battery.nonResult} non-result (${total} rows${live ? ", partial" : ""})`;
}

/** What the accepted bundle is made of. The summary always prints; the per-file table prints when
 *  one run was named, because a whole campaigns root would drown in it. Lines are nonblank lines
 *  and functions are named callables, so the table shows what the Builder wrote rather than how
 *  good it is: read the declared counts beside it. */
function harnessLines(harness, withTable) {
  const lines = [
    `    harness ${harness.lines} lines, ${harness.functions} functions, ${harness.files.length} files; ${harness.tasks} tasks in ${harness.families} families, ${harness.checks} checks, ${harness.accepts} accept and ${harness.rejects} reject controls, ${harness.tools} tools (presets ${harness.presets.join(", ") || "none"})`,
    `    authoring ${harness.commits} commits: ${harness.rehearsals} rehearsal(s), ${harness.submits} submit attempt(s), ${harness.repairs} repair round(s)`,
  ];
  if (!withTable) return lines;
  for (const file of harness.files) {
    lines.push(
      `      ${file.path.padEnd(42)}${String(file.lines).padStart(6)} lines${file.functions === 0 ? "" : `  ${file.functions} functions`}`,
    );
  }
  return lines;
}

export function renderStatus(status) {
  const lines = [];
  for (const group of status.groups) {
    lines.push(
      `source ${group.source.slice(0, 9)} (${group.runs.length} run${group.runs.length === 1 ? "" : "s"})`,
    );
    for (const run of group.runs) {
      const live = run.terminal === null && run.lockAlive;
      const used = run.used === null ? "" : `, used ${run.used}/${run.cap ?? "?"}`;
      const session =
        run.sessionWriteAgeMinutes === null ? "" : `, session wrote ${run.sessionWriteAgeMinutes} min ago`;
      lines.push(
        `  ${run.runId}  ${run.slug}  ${runState(run)}${used}  evidence ${run.evidenceAgeMinutes} min ago${session}${run.dirty === true ? "  DIRTY SOURCE" : ""}`,
      );
      if (run.slots !== null) {
        lines.push(
          `    slots builder ${run.slots.builder}  built ${run.slots.built}  review ${run.slots.review}`,
        );
      }
      for (const battery of run.batteries) lines.push(`    ${batteryLine(battery, live)}`);
      if (live && run.open.count > 0) {
        lines.push(
          `    ${run.open.count} case(s) open, oldest ${run.open.oldestMinutes} of ${run.open.wallMinutes} min`,
        );
      }
      if (run.harness !== null) lines.push(...harnessLines(run.harness, status.runs.length === 1));
      if (isNumber(run.terminal?.denominator?.total)) {
        const d = run.terminal.denominator;
        lines.push(
          `    recorded denominator: verified ${d.verified}, unaccepted ${d.unaccepted}, non-results ${d.nonResults} (total ${d.total})`,
        );
      }
      const fired = run.safeguards.names.map(([name, count]) => `${name} x${count}`).join(", ");
      lines.push(
        `    campaign epochs ${run.epochs}  campaign claims ${run.claims.ok}/${run.claims.total} ok  promotion records ${run.promotions}  predictions ${run.predictions.open}/${run.predictions.frozen} open  safeguards ${fired.length === 0 ? "none" : fired}`,
      );
      if (run.terminal?.reason) lines.push(`    terminal: ${run.terminal.reason}`);
    }
  }
  if (lines.length === 0) lines.push("no campaign with a controller opening found");
  return lines.join("\n");
}

/**
 * The command line this script and `close-advisories.mjs` take: `--json`, `--run <runId>` and the
 * required `--<name> <value>`, where `missing` is the error when it is absent. A malformed line
 * prints its error and exits 2.
 */
export function campaignCommandLine(name, missing) {
  try {
    const argv = runtimeProcess.argv.slice(2);
    /** @type {Record<string, string | null> & { run: string | null, json: boolean }} */
    const values = { [name]: null, run: null, json: false };
    for (let index = 0; index < argv.length; index += 1) {
      const key = argv[index];
      if (key === "--json") {
        values.json = true;
        continue;
      }
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`missing value for ${key}`);
      index += 1;
      if (key === `--${name}`) values[name] = value;
      else if (key === "--run") values.run = value;
      else throw new Error(`unknown argument ${key}`);
    }
    if (values[name] === null) throw new Error(missing);
    return values;
  } catch (error) {
    console.error(String(error.message));
    return runtimeProcess.exit(2);
  }
}

if (import.meta.main) {
  const values = campaignCommandLine("campaigns", "--campaigns <absolute campaigns root> is required");
  const status = readCampaignsStatus(values.campaigns);
  if (values.run !== null) {
    status.runs = status.runs.filter((run) => run.runId === values.run);
    status.groups = status.groups
      .map((group) => ({ ...group, runs: group.runs.filter((run) => run.runId === values.run) }))
      .filter((group) => group.runs.length > 0);
  }
  console.log(values.json ? JSON.stringify(status, null, 2) : renderStatus(status));
  runtimeProcess.exit(0);
}

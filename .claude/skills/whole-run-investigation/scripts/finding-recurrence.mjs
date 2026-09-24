// Angle 25 (finding recurrence and closure across reviews), deterministic part. Reads the current
// run's archive beside the earlier archives of the same lane and says, per angle, whether the
// recorded finding state recurs, cleared, is new, or was dropped without a verdict.
// This does not establish same-defect identity or separate reassigned angle numbers; inspect those joins. States and
// run ids only: the archive's reason text is protected operator research and never crosses.
//
// Ordering: an archive carries no clock, so the lane order comes from the run id (a
// `YYYYMMDDTHHMMSSZ` or `YYYYMMDDTHHMMSSmmmZ` stamp, else a `-MMDD` suffix with an optional `runNN` tiebreak). An
// archive whose run id orders nowhere is listed as unordered and takes no part in the comparison.
import { existsSync, readdirSync, statSync } from "#src/meta/filesystem.ts";
import { join } from "#src/meta/path.ts";
import { CommandFailure, runCommand } from "#skills/main/cli.ts";
import { emitReport } from "#skills/main/output.ts";
import { isString } from "#src/meta/json-shape.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";

const FINDING_STATES = new Set(["fail", "risk"]);
const VERDICT_STATES = new Set(["fail", "risk", "pass"]);
const TRIGGER_STREAK = 3;

function ordinal(count) {
  const rest = count % 100;
  const suffix = rest >= 11 && rest <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[count % 10] ?? "th");
  return `${count}${suffix}`;
}

function readArchive(path) {
  const file = statSync(path).isDirectory() ? join(path, "review.json") : path;
  const value = readJsonFile(file);
  const angleStates = Array.isArray(value.angleStates) ? value.angleStates : null;
  const runId = isString(value.identity?.runId) ? value.identity.runId : null;
  const sourceRevision = isString(value.identity?.sourceRevision) ? value.identity.sourceRevision : null;
  return { path: file, runId, sourceRevision, angleStates, order: runId === null ? null : orderKey(runId) };
}

export function laneKey(runId) {
  return runId
    .split("-")
    .filter((token) => !/\d|^[0-9a-f]{6,}$/.test(token))
    .join("-");
}

export function orderKey(runId) {
  const stamp = /(\d{8})T(\d{6}(?:\d{3})?)Z/.exec(runId);
  if (stamp) return `${stamp[1]}T${stamp[2].padEnd(9, "0")}`;
  // A date-only id such as truss-opus-20260912-0400 carries the clock after the date; without
  // this branch the -MMDD fallback below read 0400 as a month and day.
  const dated = /(\d{8})-(\d{2})(\d{2})[a-z]?$/.exec(runId);
  if (dated) return `${dated[1]}T${dated[2]}${dated[3]}00000`;
  const suffix = /-(\d{2})(\d{2})[a-z]?$/.exec(runId);
  if (!suffix) return null;
  const run = /run(\d+)/.exec(runId);
  return `2026${suffix[1]}${suffix[2]}T000000000-${String(run ? Number(run[1]) : 0).padStart(4, "0")}`;
}

/** Every archive under `archivesRoot` with angle states, grouped by lane key. */
export function laneArchives(archivesRoot, key) {
  const rows = [];
  for (const entry of readdirSync(archivesRoot).sort()) {
    const file = join(archivesRoot, entry, "review.json");
    if (!existsSync(file)) continue;
    const archive = readArchive(file);
    if (archive.angleStates === null || archive.runId === null) continue;
    if (laneKey(archive.runId) === key) rows.push(archive);
  }
  return rows;
}

function stateOf(archive, angle) {
  const row = archive.angleStates.find((candidate) => candidate.angle === angle);
  return row
    ? { state: String(row.state ?? "absent"), session: isString(row.session) ? row.session : null }
    : { state: "absent", session: null };
}

function classify(current, history) {
  const now = FINDING_STATES.has(current.state);
  const latest = history[0];
  const latestFinding = latest !== undefined && FINDING_STATES.has(latest.state);
  let streak = 0;
  for (const row of history) {
    if (!FINDING_STATES.has(row.state)) break;
    streak++;
  }
  const everFound = history.some((row) => FINDING_STATES.has(row.state));
  if (now && latestFinding) return { classification: "recurring", streak: streak + 1 };
  if (now) return { classification: everFound ? "re-emerged" : "new", streak: 1 };
  if (latestFinding && current.state === "pass") return { classification: "cleared", streak: 0 };
  if (latestFinding && !VERDICT_STATES.has(current.state)) {
    return { classification: "dropped-unreviewed", streak: 0 };
  }
  return { classification: "quiet", streak: 0 };
}

/** Compares the current archive with earlier archives of its lane, oldest first in `previous`. */
export function compareArchives(current, previous) {
  const ordered = previous
    .filter((archive) => archive.order !== null)
    .sort((a, b) => a.order.localeCompare(b.order));
  const unordered = previous.filter((archive) => archive.order === null).map((archive) => archive.path);
  const before =
    current.order === null ? ordered : ordered.filter((archive) => archive.order < current.order);
  const newestFirst = [...before].toReversed();
  const numbers = [...new Set(current.angleStates.map((row) => row.angle))].sort((a, b) => a - b);
  const angles = numbers.map((angle) => {
    const now = stateOf(current, angle);
    const history = newestFirst.map((archive) => ({
      runId: archive.runId,
      sourceRevision: archive.sourceRevision,
      ...stateOf(archive, angle),
    }));
    const { classification, streak } = classify(now, history);
    const latest = history[0] ?? null;
    const sourceChanged =
      latest === null || latest.sourceRevision === null || current.sourceRevision === null
        ? null
        : latest.sourceRevision !== current.sourceRevision;
    const lifetimeFindings =
      history.filter((row) => FINDING_STATES.has(row.state)).length + (FINDING_STATES.has(now.state) ? 1 : 0);
    return {
      angle,
      current: now,
      previous: history,
      classification,
      streak,
      lifetimeFindings,
      sourceChanged,
    };
  });
  const triggers = [];
  for (const row of angles) {
    const runs = [current.runId, ...row.previous.slice(0, row.streak - 1).map((entry) => entry.runId)].join(
      ", ",
    );
    if (row.classification === "recurring" && row.streak >= TRIGGER_STREAK) {
      triggers.push(
        `RECURRING FINDING (angle 25 trigger): angle ${row.angle} reads ${row.current.state} for the ${ordinal(row.streak)} consecutive review (${runs})`,
      );
    }
    if (row.classification === "cleared" && row.sourceChanged === false) {
      triggers.push(
        `CLEARED WITHOUT SOURCE CHANGE (angle 25 trigger): angle ${row.angle} read ${row.previous[0].state} on ${row.previous[0].runId} and pass now on the same source`,
      );
    }
    if (row.classification === "dropped-unreviewed") {
      triggers.push(
        `FINDING DROPPED UNREVIEWED: angle ${row.angle} read ${row.previous[0].state} on ${row.previous[0].runId} and ${row.current.state} now`,
      );
    }
  }
  return {
    schema: "wri-finding-recurrence/v1",
    current: { path: current.path, runId: current.runId, sourceRevision: current.sourceRevision },
    previous: before.map((archive) => ({
      path: archive.path,
      runId: archive.runId,
      sourceRevision: archive.sourceRevision,
    })),
    unordered,
    angles,
    triggers,
  };
}

export function renderRecurrence(report) {
  const lines = [
    `finding recurrence: ${report.current.runId ?? "unknown run"} against ${report.previous.length} earlier archive(s) of its lane`,
  ];
  if (report.previous.length === 0) {
    lines.push(
      "no earlier ordered archive in this lane — recurrence unobservable; angle 25 reads no-opportunity",
    );
  }
  for (const path of report.unordered) {
    lines.push(`unordered archive skipped (run id carries no stamp): ${path}`);
  }
  const counts = {};
  for (const row of report.angles) counts[row.classification] = (counts[row.classification] ?? 0) + 1;
  lines.push(
    `angles: ${Object.entries(counts)
      .map(([key, value]) => `${key} ${value}`)
      .join(" · ")}`,
  );
  for (const row of report.angles) {
    if (row.classification === "quiet") continue;
    const trail = row.previous
      .slice(0, 5)
      .map((entry) => entry.state)
      .join(" ← ");
    const source =
      row.sourceChanged === null ? "source unknown" : row.sourceChanged ? "source changed" : "same source";
    lines.push(
      `  angle ${String(row.angle).padStart(2)}: ${row.classification.padEnd(18)} now ${row.current.state.padEnd(12)} before ${trail || "(none)"} · findings ${row.lifetimeFindings}/${row.previous.length + 1} · ${source}`,
    );
  }
  for (const trigger of report.triggers) lines.push(trigger);
  if (report.triggers.length === 0 && report.previous.length > 0) lines.push("angle 25: no trigger");
  return `${lines.join("\n")}\n`;
}

function recurrence(args) {
  const current = readArchive(args.required("current"));
  if (current.angleStates === null || current.runId === null) {
    throw new CommandFailure(`${current.path} carries no angleStates or run id`, 2);
  }
  const key = args.value("lane") ?? laneKey(current.runId);
  const previous = laneArchives(args.required("archives"), key).filter(
    (archive) => archive.path !== current.path && archive.runId !== current.runId,
  );
  const report = compareArchives(current, previous);
  emitReport(report, { json: args.flag("json"), out: args.value("out"), render: renderRecurrence });
}

if (import.meta.main) {
  await runCommand(
    {
      name: "finding-recurrence",
      usage:
        "usage: finding-recurrence.mjs --current <abs archive> --archives <abs dir> [--lane <key>] [--out <abs file>] [--json]",
      options: { current: "abs", archives: "abs", lane: "text", out: "abs", json: "flag" },
    },
    recurrence,
  );
}

/**
 * Rendering for the runs listing and for one run in depth.
 *
 * Two rules hold the layout together. Every cell is either a recorded fact or the word `unknown`:
 * a blank cell and a zero both read as "nothing happened", which is exactly the confusion an
 * unknown provider-turn counter or an unreadable case record must not create. And `show` names
 * paths instead of printing their contents, so reading one run stays a screen rather than a
 * megabyte of prompts.
 */
import { BUILDER_EXECUTION_EVIDENCE_FILE } from "../../src/author/builder-execution.ts";
import { homedir } from "../../src/meta/os.ts";
import { join } from "../../src/meta/path.ts";
import { controllerDenominator } from "../../src/run/controller-denominator.ts";
import type { CaseCounts, DifficultyDecisions, Observation, RunEvidence } from "./evidence.ts";
import { DIFFICULTY_DECISION_SCHEMA } from "../../src/run/difficulty-decision.ts";
import { readClaims, readDifficultyDecisions, observabilityPath } from "./evidence.ts";
import type { RunDetail, RunRow } from "./rows.ts";

const HOME = homedir();

const LIST_HEADER = [
  "RUN",
  "DOMAIN",
  "PROJECT",
  "STATE",
  "ELAPSED",
  "POSITION",
  "LAST WRITE",
  "CASES",
  "TURNS",
  "PID",
  "WORKTREE",
];

/** Home-relative paths, so the worktree column fits beside the rest of the row. */
export function shortPath(path: string): string {
  return path === HOME || path.startsWith(`${HOME}/`) ? `~${path.slice(HOME.length)}` : path;
}

/** A duration in the largest two units that carry information. */
export function duration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "unknown";
  const seconds = Math.max(0, Math.round(ms / 1000));
  const parts: Array<[number, string]> = [
    [Math.floor(seconds / 86400), "d"],
    [Math.floor((seconds % 86400) / 3600), "h"],
    [Math.floor((seconds % 3600) / 60), "m"],
    [seconds % 60, "s"],
  ];
  const shown: string[] = [];
  for (const [value, unit] of parts) {
    if (value === 0 && shown.length === 0) continue;
    shown.push(`${value}${unit}`);
    if (shown.length === 2) break;
  }
  return shown.length === 0 ? "0s" : shown.join(" ");
}

function truncate(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

function cases(counts: CaseCounts): string {
  if (counts.unreadable !== null) return "unreadable";
  if (counts.tally === null) return "unknown";
  const { verified, unaccepted, nonResults } = counts.tally;
  return `${verified}v ${unaccepted}u ${nonResults}n`;
}

function turns(row: RunRow): string {
  const cap = row.cap === null ? "?" : String(row.cap);
  return `${row.turnsUsedKnown ? row.turnsUsed : "unknown"}/${cap}`;
}

function table(header: readonly string[], rows: readonly string[][]): string[] {
  const widths = header.map((cell, index) => {
    let width = cell.length;
    for (const row of rows) width = Math.max(width, (row[index] ?? "").length);
    return width;
  });
  const line = (cells: readonly string[]) =>
    cells
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd();
  return [line(header), ...rows.map(line)];
}

/** The listing: every run this machine recorded, open ones first. */
export function renderList(rows: readonly RunRow[]): string {
  if (rows.length === 0) return "no recorded runs in this checkout's campaign tree";
  const cells = rows.map((row) => [
    row.runId,
    truncate(row.domain, 30),
    row.project,
    row.liveness.state,
    duration(row.elapsedMs),
    truncate(row.position, 26),
    row.lastWrite === null ? "unknown" : `${duration(row.gapMs)} ago, ${row.lastWrite.source}`,
    cases(row.cases),
    turns(row),
    row.liveness.pid === null ? "-" : String(row.liveness.pid),
    row.worktree === null ? "-" : shortPath(row.worktree),
  ]);
  const lines = table(LIST_HEADER, cells);
  for (const row of rows) {
    if (row.damaged.length > 0) lines.push(`  ${row.runId}: ${row.damaged.join("; ")}`);
    if (row.cases.unreadable !== null) {
      lines.push(`  ${row.runId}: case record unreadable — ${row.cases.unreadable}`);
    }
  }
  const open = rows.filter((row) => row.liveness.state !== "closed");
  lines.push("");
  for (const row of open) lines.push(`${row.runId}: ${row.liveness.detail}`);
  lines.push(
    `${open.length} open, ${rows.length - open.length} closed shown. "runs show <runId>" for one in depth.`,
  );
  return lines.join("\n");
}

function slotLines(evidence: RunEvidence): string[] {
  const lines: string[] = [];
  for (const slot of evidence.opening?.slots ?? []) {
    lines.push(
      `  ${slot.role.padEnd(8)} ${slot.enabled ? "" : "disabled "}${slot.kind ?? "?"}/${slot.model ?? "?"} at ${slot.effort ?? "?"}`,
    );
  }
  return lines;
}

function authoringLines(evidence: RunEvidence): string[] {
  const authoring = evidence.authoring;
  if (authoring === null) return [];
  return [
    "",
    "Authoring",
    `  builder-execution written ${authoring.writtenAt}, ${authoring.turns ?? "unknown"} settled turns`,
    `  ${join(evidence.location.campaignDir, evidence.opening?.epochKey ?? "", BUILDER_EXECUTION_EVIDENCE_FILE)}`,
  ];
}

/**
 * What the batteries above were decided under, and which of this run's records were left out of
 * them. One frame revision covers every row, because a run is one controller process and
 * `FRAME_REVISION` is computed once at import — so this names the sentences about the band that
 * the Builder actually read, rather than comparing revisions that cannot differ here. The refusal
 * line is the other half: a battery absent from the table because its record predates the current
 * schema reads exactly like a battery that never ran, so the count and the versions are printed.
 */
function climbConditionLines(decisions: DifficultyDecisions): string[] {
  const lines: string[] = [];
  const frame = decisions.rows[0]?.frame;
  if (frame !== undefined) lines.push(`  Climb wording: ${frame.slice(0, 12)}`);
  if (decisions.refused.length > 0) {
    const versions = [...new Set(decisions.refused)].sort().join(", ");
    lines.push(
      `  Climb records refused: ${decisions.refused.length} (${versions}) — not ${DIFFICULTY_DECISION_SCHEMA},`,
      "  so their action words were chosen by code this reader cannot account for.",
    );
  }
  return lines;
}

function batteryLines(detail: RunDetail): string[] {
  const claims = readClaims(detail.evidence.location);
  const decisions = readDifficultyDecisions(detail.evidence.location);
  const counts = new Map(detail.row.cases.batteries.map((battery) => [battery.runId, battery.tally]));
  const ordered = claims.map((claim) => claim.runId);
  for (const battery of detail.row.cases.batteries) {
    if (!ordered.includes(battery.runId)) ordered.push(battery.runId);
  }
  if (ordered.length === 0) return ["", "Batteries: none recorded"];
  const rows = ordered.map((runId) => {
    const tally = counts.get(runId);
    const claim = claims.find((row) => row.runId === runId);
    const decision = decisions.rows.find((row) => row.runId === runId);
    return [
      runId,
      claim?.createdAt ?? "no claim",
      tally === undefined
        ? "no cases"
        : `${tally.passed}/${tally.verified} verified, ${tally.unaccepted}u ${tally.nonResults}n`,
      decision === undefined
        ? "-"
        : [
            decision.placement?.zone ?? "unplaced",
            ...(decision.repeated ? ["repeated failures"] : []),
            ...(decision.conflict ? ["family conflict"] : []),
          ].join(", "),
      truncate(decision?.rationale ?? "", 62),
    ];
  });
  return [
    "",
    "Batteries (ordered by claim createdAt)",
    ...table(["BATTERY", "CLAIMED", "PASSED", "CLIMB", "RATIONALE"], rows).map((line) => `  ${line}`),
    ...climbConditionLines(decisions),
  ];
}

function terminalLines(evidence: RunEvidence): string[] {
  const terminal = evidence.terminal;
  if (terminal === null) return [];
  // Only the run asked about reads its case rows; the listing never pays for them.
  const denominator = controllerDenominator(evidence.location.campaignDir, terminal.measured);
  return [
    "",
    "Terminal",
    `  ${terminal.outcome ?? "?"}${terminal.abortClause === null ? "" : ` (${terminal.abortClause})`} at ${terminal.writtenAt ?? "?"}`,
    ...(terminal.terminalReason === null ? [] : [`  ${terminal.terminalReason}`]),
    ...(denominator.state === "recorded"
      ? [
          `  denominator: ${denominator.total} cases — ${denominator.verified} verified, ${denominator.unaccepted} unaccepted, ${denominator.nonResults} non-result`,
        ]
      : [
          `  denominator: ${denominator.state === "absent" ? "no battery measured" : "case record unreadable"}`,
        ]),
    `  provider turns: ${terminal.turnsUsed ?? "unknown"}${terminal.byRole.length === 0 ? "" : ` (${terminal.byRole.map((role) => `${role.role} ${role.turns}`).join(", ")})`}`,
  ];
}

function recentObservations(evidence: RunEvidence, observations: readonly Observation[]): string[] {
  if (observations.length === 0) return [];
  const tail = observations.slice(-6);
  return [
    "",
    `Recent observations (${observations.length} recorded, last 6)`,
    ...tail.map(
      (row) =>
        `  ${row.at}  ${row.phase ?? "-"}  ${row.type ?? "-"}${row.state === null ? "" : ` ${row.state}`}${row.subjectId === null ? "" : ` ${row.subjectId}`}`,
    ),
    `  ${observabilityPath(evidence.location.campaignDir, evidence.location.runId)}`,
  ];
}

/** One run in depth. Paths are named; nothing large is printed. */
export function renderShow(detail: RunDetail, observations: readonly Observation[]): string {
  const { row, evidence } = detail;
  const opening = evidence.opening;
  const lines = [
    `${row.runId}  ${row.liveness.state}  ${row.liveness.detail}`,
    `  project ${row.slug}`,
    `  started ${row.startedAt ?? "unknown"}, elapsed ${duration(row.elapsedMs)}`,
    `  last recorded write ${row.lastWrite?.at ?? "unknown"} (${duration(row.gapMs)} ago, ${row.lastWrite?.source ?? "-"})`,
    `  position ${row.position}`,
    `  cases ${cases(row.cases)}, provider turns ${turns(row)}`,
    "",
    "Opening",
    `  source ${opening?.commit ?? "unknown"}${opening?.dirty === true ? " (dirty)" : ""}`,
    `  sourceDigest ${opening?.sourceDigest ?? "unknown"}`,
    `  epoch ${opening?.epochKey ?? "unknown"}`,
    ...slotLines(evidence),
  ];
  if (detail.launch !== null) {
    lines.push("", "Launch receipt");
    lines.push(
      `  preset ${detail.launch.preset ?? "?"}, condition ${detail.launch.condition ?? "?"}, budget ${detail.launch.budget ?? "?"}`,
    );
    lines.push(`  worktree ${shortPath(detail.launch.dir)}`);
    if (detail.launch.log !== null) lines.push(`  log ${shortPath(detail.launch.log)}`);
    if (detail.launch.service !== null) lines.push(`  service ${detail.launch.service}`);
  }
  lines.push(...authoringLines(evidence), ...batteryLines(detail), ...terminalLines(evidence));
  lines.push(...recentObservations(evidence, observations));
  if (evidence.damaged.length > 0) {
    lines.push("", "Damaged evidence", ...evidence.damaged.map((reason) => `  ${reason}`));
  }
  return lines.join("\n");
}

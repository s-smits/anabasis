#!/usr/bin/env bun
// The shared instructions every open lane prompt of an investigation carries, and the run overview
// each run's lanes read beside them.
//
// `wri.ts start` renders a preset template (`references/shared-instructions.template.md`, or the
// one `--preset` names) into `<investigation>/shared-instructions.md`, filling `{runTable}` with one
// row per run and leaving the authored sections as marked blanks. The primary edits any section of
// that file; `readSharedInstructions` drops its `<!-- -->` comments and refuses it while any `##`
// section is left blank, so an unfilled orientation never reaches a lane. Every open prompt then
// carries the result whole, and the composer refuses a group that lost it.
//
// The run overview is recorded bytes, not authored: `renderRunOverview` states the snapshot, the
// terminal, its denominator, the budget, the versions and every trigger the digest and the
// in-process lanes raised, and the `overview` lane writes it beside `overview.json` as
// `run-overview.md`, which build-manifest renders as `## Run overview`.

import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import type { JsonValue } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import {
  type DigestTrigger,
  type EvolutionFacts,
  jsonText,
  jsonTruthy,
  OVERVIEW_SCHEMA,
  type ScanFinding,
  type TerminalReading,
  type TimelineStall,
  type ViewStates,
} from "./run-overview.ts";

/** The editable shared instructions `wri.ts start` writes into the investigation directory. */
export const SHARED_INSTRUCTIONS_FILE = "shared-instructions.md";
/** The recorded run overview the `overview` lane writes into each run's review directory. */
export const RUN_OVERVIEW_FILE = "run-overview.md";
const REFERENCES = join(dirname(import.meta.dir), "references");
const PRESET_SUFFIX = ".template.md";
/** The preset `start` renders when `--preset` names none. */
const DEFAULT_PRESET = "shared-instructions";
const COMMENT = /<!--[\s\S]*?-->/g;

/** The overview as this reader meets it: built in-process, or read back from `overview.json`. */
export interface OverviewReading {
  schema?: string;
  runId?: string | null;
  snapshot?: { complete?: boolean; capturedAt?: string | null; views?: ViewStates };
  terminal?: TerminalReading;
  evolution?: EvolutionFacts;
  digestTriggers?: readonly DigestTrigger[];
  scanFindings?: readonly ScanFinding[] | null;
  timelineStalls?: readonly TimelineStall[] | null;
}

/** One run as the shared instructions' run table names it. */
export interface RunRow {
  runId: string;
  tier: string;
  campaign: string;
  review: string;
  commit: string;
  checkout: string;
  terminal: string;
  batteries: number;
  cases: string;
}

function code(value: JsonValue | undefined): string {
  return `\`${value === undefined ? value : jsonText(value)}\``;
}

function terminalLines(terminal: TerminalReading): string[] {
  if (terminal.state !== "recorded") return [`- Terminal: unavailable (${terminal.reason}).`];
  const d = terminal.denominator ?? null;
  const b = terminal.providerBudget ?? null;
  const denominator =
    d === null
      ? ""
      : d.state === "invalid"
        ? `- Recorded denominator: INVALID — ${String(d.error)}.`
        : `- Recorded denominator (${d.state ?? "state unknown"}): ${d.total ?? "?"} total = ${d.verified ?? "?"} verified + ${d.unaccepted ?? "?"} unaccepted + ${d.nonResults ?? "?"} non-results.`;
  const budget =
    b === null
      ? ""
      : `- Provider resource budget: ${b.used} of ${b.cap} turns used (${Object.entries(b.byRole)
          .map(([role, used]) => `${role} ${used}`)
          .join(", ")}).`;
  return [
    `- Terminal: ${code(terminal.outcome ?? "unknown")}${(terminal.abortClause ?? "") ? `, abort clause ${code(terminal.abortClause)}` : ""}; reason: ${terminal.reason ?? "none recorded"}.`,
    denominator,
    // The recorded epoch is the one the run opened in; a run that rebuilt ended in a later one.
    `- Controller iterations: ${terminal.iterations ?? "?"}; last iteration ${code(terminal.lastIteration ?? "unknown")}; opened in epoch ${code(terminal.epoch ?? "unknown")}.`,
    budget,
  ];
}

function evolutionLines(evolution: EvolutionFacts): string[] {
  if (evolution.state !== "recorded") return ["- Harness evolution view: unavailable."];
  const recordedFamilies = evolution.taskSet.families;
  const families = jsonTruthy(recordedFamilies)
    ? Object.entries(recordedFamilies)
        .map(([name, count]: [string, JsonValue]) => `${name} ${jsonText(count)}`)
        .join(", ")
    : "unknown";
  const latest = evolution.latestCheckpoint;
  return [
    `- Harness versions: ${jsonText(evolution.savedVersions ?? "?")} saved, ${jsonText(evolution.measuredBatteries ?? "?")} measured batteries, ${jsonText(evolution.epochs ?? "?")} epochs; current bundle ${code(evolution.currentBundle ?? "unknown")}.`,
    `- Latest checkpoint: ordinal ${jsonText(latest.ordinal ?? "?")}, outcome ${code(latest.outcome ?? "unknown")}; product ${jsonText(evolution.product.files ?? "?")} files, ${jsonText(evolution.product.nonBlankLines ?? "?")} nonblank lines.`,
    `- Task set: ${jsonText(evolution.taskSet.tasks ?? "?")} tasks; families ${families}.`,
  ];
}

function triggerLines(triggers: readonly DigestTrigger[]): string[] {
  if (triggers.length === 0) return ["- Digest and lane trigger rows: none."];
  return [
    "- Digest and lane trigger rows by trigger (row count; first examples):",
    ...triggers.map((trigger) => {
      const examples = trigger.examples.map((example) =>
        example.startsWith(trigger.name) ? example.slice(trigger.name.length).replace(/^:?\s*/, "") : example,
      );
      return `  - ${trigger.name} [${trigger.rows} rows]: ${examples.join(" | ")}`;
    }),
  ];
}

function scanLines(scan: readonly ScanFinding[] | null | undefined): string[] {
  if (scan === null || scan === undefined) return ["- Deterministic scan: view unavailable."];
  if (scan.length === 0) return ["- Deterministic scan: no findings."];
  return [
    "- Deterministic scan findings (the scan reports and never gates — a warning is a question):",
    ...scan.map(
      (finding) =>
        `  - ${code(finding.rule ?? "?")}${jsonTruthy(finding.battery) ? ` [${jsonText(finding.battery)}]` : ""}: ${jsonText(finding.statement ?? "")}`,
    ),
  ];
}

/** The run's recorded facts, one line each, from its overview and the triggers its in-process lanes
 *  raised: what every open lane of this run reads as `## Run overview`. */
export function renderRunOverview(
  overview: OverviewReading | null | undefined,
  lanes: readonly DigestTrigger[] = [],
): string {
  if (overview?.schema !== OVERVIEW_SCHEMA) throw new Error(`overview schema must be ${OVERVIEW_SCHEMA}`);
  const views = overview.snapshot?.views ?? { ok: [], failed: [], unsupported: [] };
  const stalls = overview.timelineStalls ?? [];
  return [
    `- Snapshot ${overview.snapshot?.complete === true ? "complete" : "INCOMPLETE"} at ${code(overview.snapshot?.capturedAt ?? "unknown")}: ${views.ok.length} views ok` +
      `${views.failed.length > 0 ? `, failed: ${views.failed.map(code).join(", ")}` : ""}${views.unsupported.length > 0 ? `, unsupported: ${views.unsupported.map(code).join(", ")}` : ""}.`,
    ...terminalLines(overview.terminal ?? { state: "unavailable", reason: "no terminal facts" }),
    ...evolutionLines(overview.evolution ?? { state: "unavailable" }),
    ...triggerLines([...(overview.digestTriggers ?? []), ...lanes]),
    ...scanLines(overview.scanFindings),
    stalls.length > 0
      ? `- Longest recorded gaps: ${stalls.map((row) => `${String(row.minutes)} min in ${code(row.phase ?? "no phase")} after ${code(row.after ?? "?")}`).join(", ")}. Elapsed time, not a diagnosis.`
      : "",
  ]
    .filter((line) => line.trim() !== "")
    .join("\n");
}

/** The preset a name or a path selects: an existing file, else `references/<name>.template.md`. */
export function presetPath(name: string | null): string {
  if (name !== null && existsSync(name)) return name;
  const path = join(REFERENCES, `${name ?? DEFAULT_PRESET}${PRESET_SUFFIX}`);
  if (!existsSync(path)) {
    throw new Error(`no preset ${name}: name a template file, or one of references/*${PRESET_SUFFIX}`);
  }
  return path;
}

/** The run table, one row per run, in the order the runs were named. */
function runTable(rows: readonly RunRow[]): string {
  return [
    "| run | tier | campaign | review | source | read source in | terminal | batteries | cases |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| \`${row.runId}\` | ${row.tier} | \`${row.campaign}\` | \`${row.review}\` | \`${row.commit}\` | \`${row.checkout}\` | ${row.terminal} | ${row.batteries} | ${row.cases} |`,
    ),
  ].join("\n");
}

/** The preset with its run table filled in; every other line stays as the preset wrote it. */
export function renderPreset(preset: string, rows: readonly RunRow[]): string {
  return readFileSync(preset, "utf8").replaceAll("{runTable}", runTable(rows));
}

/** The shared instructions as every open lane reads them: the file without its comments. A `##`
 *  section left with nothing but a comment is an authored blank the primary has not filled, and
 *  refuses, so delete a section's heading to drop it on purpose. */
export function readSharedInstructions(path: string): string {
  if (!existsSync(path)) throw new Error(`no ${path}; \`wri.ts start\` writes it`);
  const text = readFileSync(path, "utf8")
    .replaceAll(COMMENT, "")
    .replaceAll(/[ \t]+$/gm, "")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
  const empty = text
    .split(/^(?=## )/m)
    .filter((section) => section.startsWith("## ") && section.slice(section.indexOf("\n") + 1).trim() === "")
    .map((section) => (section.split("\n")[0] ?? "").trim());
  if (text === "" || empty.length > 0) {
    throw new Error(
      `${path}: fill or delete the blank section(s) ${empty.join(", ") || "(the file is empty)"} before building lane prompts`,
    );
  }
  return text;
}

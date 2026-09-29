#!/usr/bin/env bun
// The editable shared-instructions config every review lane reads. `buildSharedInstructions`
// turns the run overview (recorded bytes) into `shared-instructions.json`: a `template` of lines
// carrying `{placeholder}` tokens and a `values` map filled from the overview. The primary may
// edit any value, add a value and reference it from the template, reorder or drop template lines,
// or fill the two authored values `orientation` and `movedVariable`, all before `launch`.
// `renderSharedInstructions` substitutes the tokens; a token without a value refuses the render
// and a line whose value is empty is dropped, so an unfilled authored field leaves no trace.
//
//   bun shared-instructions.ts --overview <absolute overview.json> [--out <absolute file>]

import { asRecord, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { isAbsolute } from "#src/meta/path.ts";
import {
  type DigestTrigger,
  type EvolutionFacts,
  jsonText,
  jsonTruthy,
  OVERVIEW_SCHEMA,
  readJsonAs,
  type ScanFinding,
  type TerminalReading,
  type TimelineStall,
  type ViewStates,
} from "./run-overview.ts";

const SHARED_SCHEMA = "wri-shared-instructions/v1";
const AUTHORED_VALUES = ["orientation", "movedVariable"] as const;
const TOKEN = /\{([A-Za-z][A-Za-z0-9_]*)\}/g;

/** The default template: one recorded-fact line per placeholder, in reading order. */
const DEFAULT_TEMPLATE = [
  "{snapshot}",
  "{terminal}",
  "{denominator}",
  "{iterations}",
  "{budget}",
  "{versions}",
  "{checkpoint}",
  "{taskSet}",
  "{triggers}",
  "{scan}",
  "{timeline}",
];

const GUIDE = [
  "Every lane reads the rendered `template` as `## Run overview`. Each `{name}` token is replaced by",
  "`values.name`; a token without a value refuses the launch and a line whose value is empty is",
  "dropped. Edit values, add your own value and token, reorder or remove template lines. The two",
  "authored values `orientation` (rendered as `## Orientation`) and `movedVariable` (rendered as",
  "`## The moved variable and prior state`) are empty until the primary fills them.",
].join(" ");

/** The overview as this reader meets it: built in-process, or read back from an edited file. */
export interface OverviewReading {
  schema?: string;
  runId?: string | null;
  snapshot?: { complete?: boolean; capturedAt?: string | null; views?: ViewStates };
  terminal?: TerminalReading;
  evolution?: EvolutionFacts;
  digestTriggers?: readonly DigestTrigger[];
  scanFindings?: readonly ScanFinding[] | null;
  timelineStalls?: readonly TimelineStall[] | null;
  orientation?: JsonValue;
  movedVariable?: JsonValue;
}

/** `shared-instructions.json` as this reader meets it. */
export interface SharedInstructions {
  schema?: string;
  template?: readonly JsonValue[];
  values?: JsonValue;
}

function code(value: JsonValue | undefined): string {
  return `\`${value === undefined ? value : jsonText(value)}\``;
}

function terminalValues(terminal: TerminalReading) {
  if (terminal.state !== "recorded") {
    return {
      terminal: `- Terminal: unavailable (${terminal.reason}).`,
      denominator: "",
      iterations: "",
      budget: "",
    };
  }
  const d = terminal.denominator ?? null;
  const b = terminal.providerBudget ?? null;
  const budget =
    b === null
      ? ""
      : `- Provider resource budget: ${b.used} of ${b.cap} turns used (${Object.entries(b.byRole)
          .map(([role, used]) => `${role} ${used}`)
          .join(", ")}).`;
  return {
    terminal: `- Terminal: ${code(terminal.outcome ?? "unknown")}${(terminal.abortClause ?? "") ? `, abort clause ${code(terminal.abortClause)}` : ""}; reason: ${terminal.reason ?? "none recorded"}.`,
    denominator:
      d === null
        ? ""
        : d.state === "invalid"
          ? `- Recorded denominator: INVALID — ${String(d.error)}.`
          : `- Recorded denominator (${d.state ?? "state unknown"}): ${d.total ?? "?"} total = ${d.verified ?? "?"} verified + ${d.unaccepted ?? "?"} unaccepted + ${d.nonResults ?? "?"} non-results.`,
    iterations: `- Controller iterations: ${terminal.iterations ?? "?"}; last iteration ${code(terminal.lastIteration ?? "unknown")}; epoch ${code(terminal.epoch ?? "unknown")}.`,
    budget,
  };
}

function evolutionValues(evolution: EvolutionFacts) {
  if (evolution.state !== "recorded") {
    return { versions: "- Harness evolution view: unavailable.", checkpoint: "", taskSet: "" };
  }
  const recordedFamilies = evolution.taskSet.families;
  const families = jsonTruthy(recordedFamilies)
    ? Object.entries(recordedFamilies)
        .map(([name, count]: [string, JsonValue]) => `${name} ${jsonText(count)}`)
        .join(", ")
    : "unknown";
  const latest = evolution.latestCheckpoint;
  return {
    versions: `- Harness versions: ${jsonText(evolution.savedVersions ?? "?")} saved, ${jsonText(evolution.measuredBatteries ?? "?")} measured batteries, ${jsonText(evolution.epochs ?? "?")} epochs; current bundle ${code(evolution.currentBundle ?? "unknown")}.`,
    checkpoint: `- Latest checkpoint: ordinal ${jsonText(latest.ordinal ?? "?")}, outcome ${code(latest.outcome ?? "unknown")}; product ${jsonText(evolution.product.files ?? "?")} files, ${jsonText(evolution.product.nonBlankLines ?? "?")} nonblank lines.`,
    taskSet: `- Task set: ${jsonText(evolution.taskSet.tasks ?? "?")} tasks; families ${families}.`,
  };
}

function triggerValue(triggers: readonly DigestTrigger[]): string {
  if (triggers.length === 0) return "- Digest trigger rows: none.";
  const lines = ["- Digest trigger rows by trigger (row count over all batteries; first examples):"];
  for (const trigger of triggers) {
    const examples = trigger.examples.map((example) =>
      example.startsWith(trigger.name) ? example.slice(trigger.name.length).replace(/^:?\s*/, "") : example,
    );
    lines.push(`  - ${trigger.name} [${trigger.rows} rows]: ${examples.join(" | ")}`);
  }
  return lines.join("\n");
}

function scanValue(scan: readonly ScanFinding[] | null | undefined): string {
  if (scan === null || scan === undefined) return "- Deterministic scan: view unavailable.";
  if (scan.length === 0) return "- Deterministic scan: no findings.";
  const lines = [
    "- Deterministic scan findings (the scan reports and never gates — a warning is a question):",
  ];
  for (const finding of scan) {
    lines.push(
      `  - ${code(finding.rule ?? "?")}${jsonTruthy(finding.battery) ? ` [${jsonText(finding.battery)}]` : ""}: ${jsonText(finding.statement ?? "")}`,
    );
  }
  return lines.join("\n");
}

/** Every placeholder value derived from the overview, plus the empty authored values. */
function overviewValues(overview: OverviewReading | null | undefined) {
  if (overview?.schema !== OVERVIEW_SCHEMA) throw new Error(`overview schema must be ${OVERVIEW_SCHEMA}`);
  const views = overview.snapshot?.views ?? { ok: [], failed: [], unsupported: [] };
  return {
    snapshot:
      `- Snapshot ${overview.snapshot?.complete === true ? "complete" : "INCOMPLETE"} at ${code(overview.snapshot?.capturedAt ?? "unknown")}: ${views.ok.length} views ok` +
      `${views.failed.length > 0 ? `, failed: ${views.failed.map(code).join(", ")}` : ""}${views.unsupported.length > 0 ? `, unsupported: ${views.unsupported.map(code).join(", ")}` : ""}.`,
    ...terminalValues(overview.terminal ?? { state: "unavailable", reason: "no terminal facts" }),
    ...evolutionValues(overview.evolution ?? { state: "unavailable" }),
    triggers: triggerValue(overview.digestTriggers ?? []),
    scan: scanValue(overview.scanFindings),
    timeline:
      Array.isArray(overview.timelineStalls) && overview.timelineStalls.length > 0
        ? `- Longest recorded gaps: ${overview.timelineStalls.map((row) => `${String(row.minutes)} min in ${code(row.phase ?? "no phase")} after ${code(row.after ?? "?")}`).join(", ")}. Elapsed time, not a diagnosis.`
        : "",
    orientation: isString(overview.orientation) ? overview.orientation : "",
    movedVariable: isString(overview.movedVariable) ? overview.movedVariable : "",
  };
}

export function buildSharedInstructions(overview: OverviewReading) {
  return {
    schema: SHARED_SCHEMA,
    runId: overview.runId ?? null,
    generatedAt: new Date().toISOString(),
    guide: GUIDE,
    template: [...DEFAULT_TEMPLATE],
    values: overviewValues(overview),
  };
}

/** Substitute every `{token}` in the template; refuse unknown tokens, drop lines left empty. */
export function renderSharedInstructions(config: SharedInstructions | null | undefined): string {
  if (config?.schema !== SHARED_SCHEMA) {
    throw new Error(`shared instructions schema must be ${SHARED_SCHEMA}`);
  }
  const values = asRecord(config.values) ?? {};
  const lines: string[] = [];
  for (const line of config.template ?? []) {
    const rendered = jsonText(line).replace(TOKEN, (_, name: string) => {
      const value = values[name];
      if (!isString(value)) throw new Error(`shared instructions token {${name}} has no string value`);
      return value.trim();
    });
    if (rendered.trim()) lines.push(rendered);
  }
  return lines.join("\n");
}

/** The two authored values, trimmed, empty when the primary left them. */
export function sharedAuthoredText(
  config: SharedInstructions | null,
): Record<(typeof AUTHORED_VALUES)[number], string> {
  const text = { orientation: "", movedVariable: "" };
  const values = asRecord(config?.values);
  for (const name of AUTHORED_VALUES) {
    const value = values?.[name];
    text[name] = isString(value) ? value.trim() : "";
  }
  return text;
}

export function readSharedInstructions(path: string): SharedInstructions {
  if (!isAbsolute(path)) throw new Error("--shared-instructions must be an absolute path");
  const config = readJsonAs<SharedInstructions | null>(path);
  if (!asRecord(config) || config?.schema !== SHARED_SCHEMA) {
    throw new Error(`${path} is not a ${SHARED_SCHEMA} file`);
  }
  renderSharedInstructions(config);
  return config;
}

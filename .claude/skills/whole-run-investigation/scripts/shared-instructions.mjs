#!/usr/bin/env bun
// The editable shared-instructions config every review lane reads. `buildSharedInstructions`
// turns the run overview (recorded bytes) into `shared-instructions.json`: a `template` of lines
// carrying `{placeholder}` tokens and a `values` map filled from the overview. The primary may
// edit any value, add a value and reference it from the template, reorder or drop template lines,
// or fill the two authored values `orientation` and `movedVariable`, all before `launch`.
// `renderSharedInstructions` substitutes the tokens; a token without a value refuses the render
// and a line whose value is empty is dropped, so an unfilled authored field leaves no trace.
//
//   bun shared-instructions.mjs --overview <absolute overview.json> [--out <absolute file>]

import { asRecord, isString } from "#src/meta/json-shape.ts";
import { isAbsolute } from "#src/meta/path.ts";
import { OVERVIEW_SCHEMA } from "./run-overview.mjs";
import { readJsonFile } from "#src/meta/completed-json.ts";

const SHARED_SCHEMA = "wri-shared-instructions/v1";
const AUTHORED_VALUES = ["orientation", "movedVariable"];
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

function code(value) {
  return `\`${value}\``;
}

function terminalValues(terminal) {
  if (terminal.state !== "recorded") {
    return {
      terminal: `- Terminal: unavailable (${terminal.reason}).`,
      denominator: "",
      iterations: "",
      budget: "",
    };
  }
  const d = terminal.denominator;
  const b = terminal.providerBudget;
  const budget =
    b === null
      ? ""
      : `- Provider resource budget: ${b.used} of ${b.cap} turns used (${Object.entries(b.byRole)
          .map(([role, used]) => `${role} ${used}`)
          .join(", ")}).`;
  return {
    terminal: `- Terminal: ${code(terminal.outcome ?? "unknown")}${terminal.abortClause ? `, abort clause ${code(terminal.abortClause)}` : ""}; reason: ${terminal.reason ?? "none recorded"}.`,
    denominator:
      d === null
        ? ""
        : d.state === "invalid"
          ? `- Recorded denominator: INVALID — ${d.error}.`
          : `- Recorded denominator (${d.state ?? "state unknown"}): ${d.total ?? "?"} total = ${d.verified ?? "?"} verified + ${d.unaccepted ?? "?"} unaccepted + ${d.nonResults ?? "?"} non-results.`,
    iterations: `- Controller iterations: ${terminal.iterations ?? "?"}; last iteration ${code(terminal.lastIteration ?? "unknown")}; epoch ${code(terminal.epoch ?? "unknown")}.`,
    budget,
  };
}

function evolutionValues(evolution) {
  if (evolution.state !== "recorded") {
    return { versions: "- Harness evolution view: unavailable.", checkpoint: "", taskSet: "" };
  }
  const families = evolution.taskSet.families
    ? Object.entries(evolution.taskSet.families)
        .map(([name, count]) => `${name} ${count}`)
        .join(", ")
    : "unknown";
  const latest = evolution.latestCheckpoint;
  return {
    versions: `- Harness versions: ${evolution.savedVersions ?? "?"} saved, ${evolution.measuredBatteries ?? "?"} measured batteries, ${evolution.epochs ?? "?"} epochs; current bundle ${code(evolution.currentBundle ?? "unknown")}.`,
    checkpoint: `- Latest checkpoint: ordinal ${latest.ordinal ?? "?"}, outcome ${code(latest.outcome ?? "unknown")}; product ${evolution.product.files ?? "?"} files, ${evolution.product.nonBlankLines ?? "?"} nonblank lines.`,
    taskSet: `- Task set: ${evolution.taskSet.tasks ?? "?"} tasks; families ${families}.`,
  };
}

function triggerValue(triggers) {
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

function scanValue(scan) {
  if (scan === null || scan === undefined) return "- Deterministic scan: view unavailable.";
  if (scan.length === 0) return "- Deterministic scan: no findings.";
  const lines = [
    "- Deterministic scan findings (the scan reports and never gates — a warning is a question):",
  ];
  for (const finding of scan) {
    lines.push(
      `  - ${code(finding.rule ?? "?")}${finding.battery ? ` [${finding.battery}]` : ""}: ${finding.statement ?? ""}`,
    );
  }
  return lines.join("\n");
}

/** Every placeholder value derived from the overview, plus the empty authored values. */
function overviewValues(overview) {
  if (overview?.schema !== OVERVIEW_SCHEMA) throw new Error(`overview schema must be ${OVERVIEW_SCHEMA}`);
  const views = overview.snapshot?.views ?? { ok: [], failed: [], unsupported: [] };
  return {
    snapshot:
      `- Snapshot ${overview.snapshot?.complete ? "complete" : "INCOMPLETE"} at ${code(overview.snapshot?.capturedAt ?? "unknown")}: ${views.ok.length} views ok` +
      `${views.failed.length > 0 ? `, failed: ${views.failed.map(code).join(", ")}` : ""}${views.unsupported.length > 0 ? `, unsupported: ${views.unsupported.map(code).join(", ")}` : ""}.`,
    ...terminalValues(overview.terminal ?? { state: "unavailable", reason: "no terminal facts" }),
    ...evolutionValues(overview.evolution ?? { state: "unavailable" }),
    triggers: triggerValue(overview.digestTriggers ?? []),
    scan: scanValue(overview.scanFindings),
    timeline:
      Array.isArray(overview.timelineStalls) && overview.timelineStalls.length > 0
        ? `- Longest recorded gaps: ${overview.timelineStalls.map((row) => `${row.minutes} min in ${code(row.phase ?? "no phase")} after ${code(row.after ?? "?")}`).join(", ")}. Elapsed time, not a diagnosis.`
        : "",
    orientation: isString(overview.orientation) ? overview.orientation : "",
    movedVariable: isString(overview.movedVariable) ? overview.movedVariable : "",
  };
}

export function buildSharedInstructions(overview) {
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
export function renderSharedInstructions(config) {
  if (config?.schema !== SHARED_SCHEMA) {
    throw new Error(`shared instructions schema must be ${SHARED_SCHEMA}`);
  }
  const values = asRecord(config.values) ?? {};
  const lines = [];
  for (const line of config.template ?? []) {
    const rendered = String(line).replace(TOKEN, (_, name) => {
      if (!isString(values[name])) throw new Error(`shared instructions token {${name}} has no string value`);
      return values[name].trim();
    });
    if (rendered.trim()) lines.push(rendered);
  }
  return lines.join("\n");
}

/** The two authored values, trimmed, empty when the primary left them. */
export function sharedAuthoredText(config) {
  const text = {};
  for (const name of AUTHORED_VALUES) {
    text[name] = isString(config?.values?.[name]) ? config.values[name].trim() : "";
  }
  return text;
}

export function readSharedInstructions(path) {
  if (!isAbsolute(path)) throw new Error("--shared-instructions must be an absolute path");
  const config = readJsonFile(path);
  if (!asRecord(config) || config.schema !== SHARED_SCHEMA) {
    throw new Error(`${path} is not a ${SHARED_SCHEMA} file`);
  }
  renderSharedInstructions(config);
  return config;
}

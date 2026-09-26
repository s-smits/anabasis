import { keyIfDefined } from "../meta/optional-key.ts";
import { BUILT_STANDARD_TOOL_NAMES } from "../solve/built-starter.ts";
import { TOOL_TEXT_LIMITS } from "../solve/define-tool.ts";
/** Domain tool contract. The starter owns inspect, preview, and submit; models own domain tools. */
import { type ContractFinding, type ValidationResult, fieldFinding } from "./brief.ts";
import {
  BUILT_PRESET_IDS,
  type BuiltPresetId,
  isBuiltPresetId,
  presetOwningTool,
  presetToolNames,
} from "./built-presets.ts";
import { DATA_READER_TOOL } from "./data-session.ts";
import { PUBLIC_RESOURCES_TOOL } from "./public-resources.ts";
import { isRecord, isString, type JsonObject } from "../meta/json-shape.ts";

/** The system adds these names itself, so generated tools cannot use them. */
const RESERVED_CONTROLLER_TOOL_NAMES: ReadonlySet<string> = new Set([PUBLIC_RESOURCES_TOOL]);

export type ToolKind = "reader" | "writer" | "artifact-writer" | "advisor";

export type ToolSpec = {
  name: string;
  kind: ToolKind;
  description: string;
  /** One argument object the tool's parameters accept, for conformance to call it with when the
   *  probe cannot derive one from a pattern or exclusive bound. */
  conformanceArguments?: JsonObject;
};

export interface ToolsSpec {
  presets: BuiltPresetId[];
  tools: ToolSpec[];
  /** Reason per declined default preset. It is read for recorded bundles, where it is the only
   *  record of why a preset is absent, but it does not excuse the absence: a fresh candidate must
   *  select `files` or `shell`, or its solver has no shell at all (candidate-check, operator
   *  decision). */
  declined?: Record<string, string>;
}

const TOOL_KINDS: ReadonlySet<string> = new Set(["reader", "writer", "artifact-writer", "advisor"]);
/** A row the controller removed from a model-authored spec, with the reason it was removed. */
interface StrippedToolRow {
  tool: ToolSpec;
  code: "tools-reserved-controller-name";
  detail: string;
}

/** Remove exact controller-owned names. Other ownership conflicts remain validator findings. */
interface NormalizeToolsSpecResult {
  value: unknown;
  stripped: StrippedToolRow[];
}

function isDeclinedReasons(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((reason) => isString(reason) && reason.trim() !== "");
}

function toolsFieldFindings(value: unknown): ContractFinding[] {
  if (!isRecord(value) || !Array.isArray(value.presets) || !Array.isArray(value.tools)) {
    return [fieldFinding("$", '{"presets": [...], "tools": [...]} with a tools array', value)];
  }
  const findings: ContractFinding[] = [];
  if (value.presets.some((preset) => !isString(preset))) {
    findings.push(fieldFinding("presets", "an array of preset id strings", value.presets));
  }
  if (value.declined !== undefined && !isDeclinedReasons(value.declined)) {
    findings.push(
      fieldFinding("declined", "an object of preset id to a non-empty reason string", value.declined),
    );
  }
  /* SAFETY: the shape check above returned findings unless `tools` is an array, and each row is checked for its own shape below. */ (
    value.tools as unknown[]
  ).forEach((tool, i) => {
    const keys = isRecord(tool) ? Object.keys(tool) : [];
    const unknownKeys = keys.filter(
      (key) => !["name", "kind", "description", "conformanceArguments"].includes(key),
    );
    if (
      !isRecord(tool) ||
      !isString(tool.name) ||
      tool.name.trim() === "" ||
      tool.name.length > TOOL_TEXT_LIMITS.name ||
      !isString(tool.kind) ||
      !TOOL_KINDS.has(tool.kind) ||
      !isString(tool.description) ||
      tool.description.length > TOOL_TEXT_LIMITS.description ||
      (tool.conformanceArguments !== undefined && !isRecord(tool.conformanceArguments)) ||
      unknownKeys.length > 0
    ) {
      findings.push(
        fieldFinding(
          `tools[${i}]`,
          '{"name": string, "kind": "reader"|"writer"|"artifact-writer"|"advisor", "description": string, "conformanceArguments"?: object}',
          tool,
        ),
      );
    }
  });
  return findings;
}

export function normalizeToolsSpec(value: unknown): NormalizeToolsSpecResult {
  if (toolsFieldFindings(value).length > 0) return { value, stripped: [] };
  const spec =
    /* SAFETY: the check above returned when `toolsFieldFindings(value).length > 0`. */ value as ToolsSpec;
  const stripped: StrippedToolRow[] = [];
  const kept = spec.tools.flatMap((tool) => {
    if (RESERVED_CONTROLLER_TOOL_NAMES.has(tool.name)) {
      stripped.push({
        tool,
        code: "tools-reserved-controller-name",
        detail: `the system adds "${tool.name}" itself, so it removed the generated copy`,
      });
      return [];
    }
    const { name, kind, description, conformanceArguments } = tool;
    return [
      conformanceArguments === undefined
        ? { name, kind, description }
        : { name, kind, description, conformanceArguments },
    ];
  });
  const normalized: ToolsSpec = {
    presets: spec.presets,
    tools: kept,
    ...keyIfDefined("declined", spec.declined),
  };
  return { value: normalized, stripped };
}

/**
 * Sorted names expected in the Built Harness: declared domain tools, selected presets, the
 * public-resource reader when resources exist, and standard starter tools. Conformance compares
 * this list with the actual registration. Authoring preview uses the same calculation so the
 * Builder can inspect the expected roster before submitting and repair differences against
 * the same contract the gate will check.
 */
export function expectedBuiltToolNames(spec: ToolsSpec, options: { publicResources: boolean }): string[] {
  return [
    ...spec.tools.map((tool) => tool.name),
    ...presetToolNames(spec.presets),
    ...(options.publicResources ? [PUBLIC_RESOURCES_TOOL] : []),
    ...BUILT_STANDARD_TOOL_NAMES,
  ].sort();
}

/** The preset list is well formed and something prepares the answer. */
function presetFindings(spec: ToolsSpec): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const unknown = spec.presets.filter(
    (preset, i) => !isBuiltPresetId(preset) || spec.presets.indexOf(preset) !== i,
  );
  if (unknown.length > 0) {
    findings.push({
      code: "tools-preset-unknown",
      path: "presets",
      detail: `select each preset once from ${BUILT_PRESET_IDS.join(", ")}; unknown or repeated: ${unknown.join(", ")}`,
    });
  }
  if (spec.presets.includes("files") && spec.presets.includes("shell")) {
    findings.push({
      code: "tools-shell-preset-overlap",
      path: "presets",
      detail:
        'the "files" preset already carries the shell; select "files" for a file-shaped answer or "shell" beside an artifact-writer, not both',
    });
  }
  if (!spec.presets.includes("files") && !spec.tools.some((tool) => tool.kind === "artifact-writer")) {
    findings.push({
      code: "tools-artifact-writer-missing",
      path: "tools",
      detail:
        'add an artifact-writer or select the "files" preset; submit accepts only an answer prepared by an artifact-writer',
    });
  }
  return findings;
}

/** Why a generated tool name is not the author's to use, or `null` when it is. Each reason names
 *  who already holds the name, since that is what the author has to change. */
function reservedName(
  name: string,
  owningPreset: string | undefined,
  listing: "listed-twice" | "first-listing",
): string | null {
  if (listing === "listed-twice") return `"${name}" is listed twice`;
  if (BUILT_STANDARD_TOOL_NAMES.some((known) => known === name)) {
    return `${name} is inherited from the Built Harness starter`;
  }
  if (RESERVED_CONTROLLER_TOOL_NAMES.has(name)) {
    return `the system adds ${name}; remove it from the generated tool list`;
  }
  if (owningPreset !== undefined || name === DATA_READER_TOOL) {
    return `${name} belongs to the "${owningPreset ?? "public-data"}" preset and must not be listed or implemented by generated code`;
  }
  return null;
}

export function validateToolsSpec(value: unknown): ValidationResult {
  const fieldFindings = toolsFieldFindings(value);
  if (fieldFindings.length > 0) return { ok: false, findings: fieldFindings };
  const spec =
    /* SAFETY: `toolsFieldFindings` returned nothing, which is the only proof of this shape. */ value as ToolsSpec;
  const findings = presetFindings(spec);
  const names = new Set<string>();
  spec.tools.forEach((tool, i) => {
    const owningPreset = presetOwningTool(spec.presets, tool.name);
    const reserved = reservedName(
      tool.name,
      owningPreset,
      names.has(tool.name) ? "listed-twice" : "first-listing",
    );
    if (reserved !== null) {
      findings.push({ code: "tools-name-taken", path: `tools[${i}].name`, detail: reserved });
    }
    names.add(tool.name);
  });
  return { ok: findings.length === 0, findings };
}

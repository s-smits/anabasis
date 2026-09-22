/**
 * Checks the reference witnesses F2 already produced for two representation defects:
 *
 *  - `transcribes`: an artifact root equal to the public input or one of its fields on every
 *    task, so filling it measures retyping rather than domain skill;
 *  - `absence-sentinel`: a reference answer spelling "does not apply" (such as "n/a") on every
 *    task, which a check would then enforce as a spelling. A value the public schema declares in
 *    a closed set at that path is exempt.
 *
 * Both are pure comparisons over witnesses in hand and block adoption. Findings name only the
 * Builder's schema and public projection: no task id, check id, hidden expectation or verifier
 * text.
 */
import { plainRecord } from "../meta/json-evidence.ts";
import { canonicalJson, compareCodeUnits } from "../meta/stable-json.ts";
import { type ContractFinding, finding } from "../truth/brief.ts";
import { REFERENCE_SOLVE_ENTRY_SOLVE } from "../truth/evaluator-process-bundle.ts";
import { isObject, isString, type JsonValue } from "../meta/json-shape.ts";
import type { PublicArtifactSchema, PublicArtifactSchemaNode } from "../solve/public-artifact-schema.ts";

/** One reference witness paired with the public task the agent solving it would have seen. */
export interface Witness {
  taskId: string;
  artifact: unknown;
  /** From a validated `BuildTask` publicInput or recorded JSON evidence. */
  publicInput: JsonValue;
}

/** Answers that state "this does not apply" instead of deciding something. "na" and "nil" are
 *  omitted because they are real values in some domains. */
const ABSENCE = new Set(["", "-", "n/a", "none", "null", "not applicable"]);

export interface Observation {
  kind: "transcribes" | "absence-sentinel";
  taskId: string;
  /** Artifact root (transcribes) or dotted path of the offending value (absence-sentinel). */
  path: string;
  /** The public field copied, or the absence spelling used. */
  note: string;
}

/** Union alternatives flattened into concrete nodes. */
function alternatives(nodes: readonly PublicArtifactSchemaNode[]): PublicArtifactSchemaNode[] {
  return nodes.flatMap((node) => (node.kind === "union" ? alternatives(node.anyOf) : [node]));
}

/** The schema nodes describing one child: the property at `key`, a map's value, or an array item
 *  when `key` is null. An undescribed child yields nothing. */
function schemaChildren(
  nodes: readonly PublicArtifactSchemaNode[],
  key: string | null,
): PublicArtifactSchemaNode[] {
  return alternatives(nodes).flatMap((node) => {
    if (key === null) return node.kind === "array" ? [node.items] : [];
    if (node.kind === "map") return [node.values];
    if (node.kind !== "object") return [];
    const child = node.properties[key];
    return child === undefined ? [] : [child];
  });
}

/** Whether the schema declares this value in a closed set at this path. Every node describing the
 *  path must be closed, since an open alternative still admits undeclared spellings. An absent
 *  schema exempts nothing. */
function declaredClosedValue(nodes: readonly PublicArtifactSchemaNode[], value: string): boolean {
  const candidates = alternatives(nodes);
  if (candidates.length === 0) return false;
  let listed = false;
  for (const node of candidates) {
    if (node.kind !== "closed") return false;
    if (node.values.some((allowed) => allowed === value)) listed = true;
  }
  return listed;
}

/** Every string leaf that spells absence, keyed by dotted path with array indices collapsed to
 *  `[]`; one array element is enough to record the path. The schema descends alongside the value. */
function absenceLeaves(
  value: JsonValue,
  nodes: readonly PublicArtifactSchemaNode[],
  path = "",
  into = new Map<string, string>(),
): Map<string, string> {
  if (isString(value)) {
    if (ABSENCE.has(value.trim().toLowerCase()) && !declaredClosedValue(nodes, value)) into.set(path, value);
  } else if (Array.isArray(value)) {
    const items = schemaChildren(nodes, null);
    for (const item of value) absenceLeaves(item, items, `${path}[]`, into);
  } else if (isObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      absenceLeaves(child, schemaChildren(nodes, key), path === "" ? key : `${path}.${key}`, into);
    }
  }
  return into;
}

/** A comparison key that ignores row order at the top level only, so a reordered copy is still a
 *  copy while nested arrays (edges, coordinates, routes) stay ordered values. A requested answer
 *  that is a pure reordering of a public list therefore matches as a copy. */
function copyKey(value: JsonValue): string {
  if (!Array.isArray(value)) return canonicalJson(value);
  return `[${value
    .map((item) => canonicalJson(item))
    .sort()
    .join(",")}]`;
}

/** What one witness says about its own schema. Only the absence rule reads `schema`. */
export function observe(witness: Witness, schema?: PublicArtifactSchema | null): Observation[] {
  const { taskId } = witness;
  const artifact = plainRecord(witness.artifact);
  if (artifact === null) return [];
  const found: Observation[] = [];
  // The public values a root could be copied from: the whole input or any of its fields.
  const sources = [{ path: "publicInput", key: copyKey(witness.publicInput) }];
  for (const [field, value] of Object.entries(plainRecord(witness.publicInput) ?? {})) {
    sources.push({ path: `publicInput.${field}`, key: copyKey(value) });
  }
  for (const [root, value] of Object.entries(artifact)) {
    // Ignore empty arrays and objects when looking for copied collections.
    const bulky = Array.isArray(value) ? value.length > 0 : isObject(value) && Object.keys(value).length > 0;
    if (!bulky) continue;
    const key = copyKey(value);
    const from = sources.find((source) => source.key === key);
    if (from) found.push({ kind: "transcribes", taskId, path: root, note: from.path });
  }
  const rootNodes = schema === undefined || schema === null ? [] : [schema.root];
  for (const [path, note] of absenceLeaves(artifact, rootNodes)) {
    found.push({ kind: "absence-sentinel", taskId, path, note });
  }
  return found;
}

/** The finding sentence per kind; both point at the same brief field. */
const DETAIL = {
  transcribes: (o, n) =>
    `the reference solve fills artifact root "${o.path}" with the value of ${o.note} — identical up to row order — on all ${n} authored tasks, so the agent must retype data the task already hands it before any check reading that root can pass, and those bytes measure transcription instead of domain skill; derive the root, fold it into a root that decides something, or drop it and read public input directly`,
  "absence-sentinel": (o, n) =>
    `the reference answer at ${o.path} is "${o.note}" on all ${n} authored tasks — a spelling of "does not apply" rather than a decision, and one of several an agent could reasonably choose; any check enforcing it evaluates the spelling instead of the property it is named after, so model absence structurally (omit the field, allow null, split the row type, or declare the value in that field's allowedValues so the schema names the state)`,
} satisfies Record<Observation["kind"], (o: Observation, n: number) => string>;

const CODE = {
  transcribes: "ARTIFACT_ROOT_TRANSCRIBES_PUBLIC_INPUT",
  "absence-sentinel": "REFERENCE_ANSWER_SPELLS_ABSENCE",
} satisfies Record<Observation["kind"], string>;

/** Reports a property only when it holds on every witness; on some tasks only it is task shape. */
export function censusRepresentation(witnesses: readonly Witness[], schema?: PublicArtifactSchema | null) {
  const perProperty = new Map<string, Observation[]>();
  for (const witness of witnesses) {
    for (const observation of observe(witness, schema)) {
      // A root copied from different sources on different tasks is choosing a source, not copying.
      const key =
        observation.kind === "transcribes"
          ? `${observation.kind} ${observation.path} ${observation.note}`
          : `${observation.kind} ${observation.path}`;
      const hits = perProperty.get(key) ?? [];
      hits.push(observation);
      perProperty.set(key, hits);
    }
  }
  const observations: Observation[] = [];
  const findings: ContractFinding[] = [];
  for (const [, hits] of [...perProperty].sort(([a], [b]) => compareCodeUnits(a, b))) {
    const first = hits[0];
    if (first === undefined || witnesses.length === 0 || hits.length !== witnesses.length) continue;
    observations.push(...hits);
    findings.push(
      finding(
        CODE[first.kind],
        `correctness-model/brief.json#artifactSchema.${first.path}`,
        DETAIL[first.kind](first, witnesses.length),
      ),
    );
  }
  return { observations, findings };
}

/** The finding codes that refuse adoption. */
export const BLOCKING_CODES = new Set([CODE["absence-sentinel"], CODE.transcribes]);

/**
 * Detects a reference root that stays byte-identical across differing public inputs, typically a
 * solve reading fields the tasks do not carry. Both sides are the Builder's own facts, so the
 * finding names no task id, check id or hidden expectation. Unlike copy detection, an empty value
 * counts here. These findings are diagnosis beside an already blocking result, not blocking codes.
 */
export function inputInsensitivity(witnesses: readonly Witness[]): ContractFinding[] {
  if (witnesses.length < 2) return [];
  const distinctInputs = new Set(witnesses.map((w) => canonicalJson(w.publicInput))).size;
  if (distinctInputs < 2) return []; // constant output under constant input proves nothing
  const first = plainRecord(witnesses[0]?.artifact);
  if (first === null) return [];
  const findings: ContractFinding[] = [];
  for (const root of Object.keys(first).sort()) {
    const values = witnesses.map((w) => {
      const record = plainRecord(w.artifact);
      return record !== null && root in record ? canonicalJson(record[root]) : null;
    });
    if (values.includes(null) || new Set(values).size !== 1) continue;
    findings.push(
      finding(
        "REFERENCE_SOLVE_IGNORES_PUBLIC_INPUT",
        REFERENCE_SOLVE_ENTRY_SOLVE,
        `the reference solve returned one byte-identical value at artifact root "${root}" across all ${witnesses.length} failed reference solves, while those tasks carry ${distinctInputs} distinct public inputs — a root derived without reading the authored task; execute correctness-model/reference/index.ts#solve over the public inputs in correctness-model/tasks.json yourself and compare the field names solve reads against the fields the tasks actually carry`,
      ),
    );
  }
  return findings;
}

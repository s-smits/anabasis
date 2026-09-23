/**
 * Checks the reference witnesses F2 already produced for two representation defects. F2 asks
 * whether the tasks can be solved at all; these two comparisons ask something F2 never does,
 * namely whether solving them measures anything:
 *
 *  - `transcribes`: an artifact root equal to the public input or one of its fields on every
 *    task, so filling it measures retyping rather than domain skill;
 *  - `absence-sentinel`: a reference answer spelling "does not apply" (such as "n/a") on every
 *    task, which a check would then enforce as a spelling. A value the public schema declares in
 *    a closed set at that path is exempt.
 *
 * The second is why this module exists: a bundle can pass F2 on every task and then measure zero
 * with every submit accepted, because the reference answer writes `"n/a"` where the agent wrote
 * `""` and the check demands that exact spelling. A whole measured campaign turns on how one
 * absence is spelled.
 *
 * Both are pure comparisons over witnesses already in hand, so neither costs an execution, and
 * both block adoption. Findings describe the Builder's own artifact schema and public task
 * projection and nothing else: no task id, no check id, no hidden expectation, no verifier text.
 *
 * A high pass rate is not a refutation of a copying finding, which is why `transcribes` blocks
 * rather than advises. A root copied from public input on every reference witness can carry a
 * battery to a perfect score precisely because retyping the task is what made it easy, so the
 * score and the finding agree rather than contradicting each other. A false positive costs the
 * Builder one revision of its representation.
 *
 * A domain that genuinely needs "none" as an answer declares it in that field's allowedValues, and
 * the absence rule exempts a value the schema names at that exact path (`declaredClosedValue`
 * below). Nothing here reads a written vocabulary deviation with an expiry, so the declared closed
 * values are the only exemption this code enforces.
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
  /** Assembled from a validated `BuildTask` publicInput or from recorded JSON evidence, so the
   *  witness states that here rather than making each reader assert it. */
  publicInput: JsonValue;
}

/** Answers that state "this does not apply" instead of deciding something. The list is kept short
 *  and unambiguous on purpose: "na" and "nil" are omitted because they are real values in some
 *  domains — sodium, a null literal — and a census that blocks adoption may not guess. */
const ABSENCE = new Set(["", "-", "n/a", "none", "null", "not applicable"]);

export interface Observation {
  kind: "transcribes" | "absence-sentinel";
  taskId: string;
  /** Artifact root (transcribes) or dotted path of the offending value (absence-sentinel). */
  path: string;
  /** The public field copied, or the absence spelling used. */
  note: string;
}

/** Union alternatives flattened once, so every candidate the two helpers below read is concrete. */
function alternatives(nodes: readonly PublicArtifactSchemaNode[]): PublicArtifactSchemaNode[] {
  return nodes.flatMap((node) => (node.kind === "union" ? alternatives(node.anyOf) : [node]));
}

/** The public-schema nodes describing one child of the nodes above: the property at `key`, the
 *  value of a data-keyed map, or an array item when `key` is null. An undescribed child yields
 *  nothing, so a path the schema does not reach is simply left unexempted. */
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

/** Whether the public artifact schema declares this exact value as a member of a closed value set
 *  at this exact path — a state the schema names, not a spelling the answer invented. A field whose
 *  allowedValues are ["none", "flat", "reactive"] compiles to a closed node, and without this the
 *  census would refuse a candidate for writing its own declared "none". The exemption is
 *  deliberately narrow, so every node describing the path must be closed: a closed set beside a
 *  plain string, or beside null, still admits an undeclared spelling of the same absence, which is
 *  the defect this rule guards. An absent schema exempts nothing. */
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
 *  `[]`. One sibling is enough to record the path, because a check that evaluates the spelling
 *  still fires on the rows that use it and siblings deciding something do not clear those rows.
 *  The public schema descends alongside the value so a declared closed state is recognised at its
 *  own path. */
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

/** A copy is still a copy after one sort: an artifact holding the copied rows in another order is
 *  retyping just the same, and one such witness would otherwise silence the every-witness aggregate
 *  below. So copy detection ignores order at the compared collection itself — its rows sorted by
 *  their canonical JSON — and nowhere deeper, because a nested array is an ordered value (a
 *  directed edge, a coordinate pair, a route) and an artifact that reverses each one has
 *  transformed the data rather than retyped it. canonicalJson stays the only serializer. The known
 *  cost is a domain whose requested answer is a pure reordering of a public list: its reference
 *  root matches as a copy, and the finding's own remedy — fold the ordering into a root that also
 *  decides something — is the one-pass recovery. */
function copyKey(value: JsonValue): string {
  if (!Array.isArray(value)) return canonicalJson(value);
  return `[${value
    .map((item) => canonicalJson(item))
    .sort()
    .join(",")}]`;
}

/** What one witness says about its own schema. The compiled public artifact schema is optional
 *  because only the absence rule reads it; without it that rule exempts nothing. */
export function observe(witness: Witness, schema?: PublicArtifactSchema | null): Observation[] {
  const { taskId } = witness;
  const artifact = plainRecord(witness.artifact);
  if (artifact === null) return [];
  const found: Observation[] = [];
  // The public values a root could be copied from — the whole input, or any of its fields — each
  // keyed once, so neither key order nor row order is read as a difference and no side is walked
  // twice.
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

/** Both kinds point at the same brief field, so only the sentence they carry varies by kind. */
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

/**
 * Report a property only when it holds on every witness: one task whose data happens to need an
 * absence, or whose selection happens to be the whole catalog, is that task's shape; all of them
 * is the schema's.
 */
export function censusRepresentation(witnesses: readonly Witness[], schema?: PublicArtifactSchema | null) {
  const perProperty = new Map<string, Observation[]>();
  for (const witness of witnesses) {
    for (const observation of observe(witness, schema)) {
      // A transcribes property is one root copied from the same source: a root that copies
      // publicInput.left on one task and publicInput.right on another is choosing which public
      // collection applies, and the detail sentence naming a single source would be false of it.
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

/** The kinds that refuse adoption. Split out here so the gate never re-decides severity by hand. */
export const BLOCKING_CODES = new Set([CODE["absence-sentinel"], CODE.transcribes]);

/**
 * Detect a reference root that stays constant across different public inputs. The pattern this
 * catches is a reference solve reading publicInput fields the authored tasks do not carry, so it
 * derives one byte-identical value for every task and F2 refuses all of them. The aggregate count
 * alone tells the Builder only that the solve is wrong everywhere, and a rebuild can fail
 * identically; this observation names a concrete pattern the model can go and investigate.
 *
 * Both compared sides are the Builder's own facts — its solve's outputs, its authored public
 * inputs — so the finding may describe their relationship. It carries no task id, check id,
 * verifier output or hidden expectation.
 *
 * The empty-proves-nothing rule (`bulky` above) inverts here on purpose. For copying, empty
 * matching empty is no evidence; for responsiveness, a derived root that stays empty while every
 * input differs is exactly the signal, and an empty plan is the usual shape of the defect. A root
 * that is legitimately constant still yields a true observation with its denominators stated, and
 * the model judges whether that constancy was intended. These findings carry no severity of their
 * own: they accompany an already blocking census result as diagnosis, and BLOCKING_CODES is
 * unchanged.
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

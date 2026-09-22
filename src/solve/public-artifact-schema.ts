export { publicArtifactSchemaFindings } from "./public-artifact-validate.ts";
import { hashJsonBytes, parseJsonAs, capturedJsonStringify } from "../meta/json-runtime.ts";
import { applyFileMapFields } from "./file-map.ts";
import { childPath, validateNode } from "./public-artifact-validate.ts";
import {
  isBoolean,
  isNumber,
  isRecord,
  isString,
  typeName,
  type JsonObject,
  type JsonValue,
  jsonKind,
} from "../meta/json-shape.ts";

const PUBLIC_ARTIFACT_SCHEMA_VERSION = "public-artifact-schema/v4" as const;

type PublicArtifactScalar = string | number | boolean;

/** The part of an artifact field needed to compile its public schema; local, so solve code needs no
 *  truth import. */
export interface PublicArtifactFieldInput {
  name: string;
  /** Scalar values accepted for this field. Submission reports any other value before verification. */
  allowedValues?: readonly PublicArtifactScalar[];
  /** Open file map: safe relative POSIX paths to text contents; control filenames stay examples. */
  fileMap?: true;
  /** Dotted paths under this field whose objects are data-keyed maps; see ArtifactField. */
  openMapPaths?: readonly string[];
}

export type PublicArtifactSchemaNode =
  | { kind: "any-json" }
  | { kind: "null" }
  | { kind: "boolean" }
  | { kind: "number" }
  | { kind: "string" }
  | { kind: "file-map" }
  | { kind: "map"; values: PublicArtifactSchemaNode }
  | { kind: "closed"; values: [PublicArtifactScalar, ...PublicArtifactScalar[]] }
  | {
      kind: "union";
      anyOf: [PublicArtifactSchemaNode, PublicArtifactSchemaNode, ...PublicArtifactSchemaNode[]];
    }
  | { kind: "array"; items: PublicArtifactSchemaNode }
  | {
      kind: "object";
      properties: Record<string, PublicArtifactSchemaNode>;
      required: string[];
      additionalProperties: false;
    };

export interface PublicArtifactSchema {
  schema: typeof PUBLIC_ARTIFACT_SCHEMA_VERSION;
  root: Extract<PublicArtifactSchemaNode, { kind: "object" }>;
  sha256: string;
}

export interface PublicArtifactSchemaIssue {
  path: string;
  expected: string;
  actual: string;
}

interface MapDeclarations {
  paths: ReadonlySet<string>;
  used: Set<string>;
}

function kindOf(value: JsonValue) {
  const kind = jsonKind(value);
  if (kind === null) throw new Error(`public artifact schema cannot represent ${typeName(value)}`);
  return kind;
}

function sameKeys(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

/** A node carries exactly its declared keys and nothing else. */
function assertNodeKeys(node: JsonObject, keys: readonly string[], message: string): void {
  if (!sameKeys(Object.keys(node).sort(), keys)) throw new Error(message);
}

/** Builds a flat union in canonical order; nested unions are flattened, because
 *  `validatePublicArtifactSchema` refuses them. */
function unionNode(nodes: PublicArtifactSchemaNode[]): PublicArtifactSchemaNode {
  const flat = nodes.flatMap((node) => (node.kind === "union" ? node.anyOf : [node]));
  const anyOf = [...flat].sort((left, right) => {
    const leftKey = capturedJsonStringify(left);
    const rightKey = capturedJsonStringify(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return {
    kind: "union",
    anyOf:
      /* SAFETY: the two callers reach this only with more than one alternative — distinct kinds, or more than one record signature group. */ anyOf as [
        PublicArtifactSchemaNode,
        PublicArtifactSchemaNode,
        ...PublicArtifactSchemaNode[],
      ],
  };
}

function compileNode(
  values: readonly JsonValue[],
  path: string,
  maps: MapDeclarations,
): PublicArtifactSchemaNode {
  if (values.length === 0) return { kind: "any-json" };
  const kinds = [...new Set(values.map(kindOf))];
  if (kinds.length !== 1) {
    return unionNode(
      kinds.map((kind) =>
        compileNode(
          values.filter((value) => kindOf(value) === kind),
          path,
          maps,
        ),
      ),
    );
  }
  const kind = kinds[0];
  if (kind === "number" && values.some((value) => !Number.isFinite(value))) {
    throw new Error(`public artifact schema contains a non-finite number at ${path}`);
  }
  if (kind === "number") return { kind };
  if (kind === "null" || kind === "boolean" || kind === "string") return { kind };
  if (kind === "array") {
    const items = values.flat();
    return { kind, items: compileNode(items, `${path}[]`, maps) };
  }

  const records = /* SAFETY: the check above returned when `values.length === 0`. */ values as Array<
    Record<string, JsonValue>
  >;
  // Maps keyed by task data must be declared (ArtifactField.openMapPaths): differing key sets alone
  // cannot tell a map from an object with optional fields. A declared map permits any key and checks
  // each value's shape; other objects keep the exact key sets of the accepted examples.
  if (maps.paths.has(path)) {
    maps.used.add(path);
    const children = records.flatMap((record) => Object.values(record));
    return { kind: "map", values: compileNode(children, `${path}.*`, maps) };
  }
  const groups = new Map<string, Array<Record<string, JsonValue>>>();
  for (const record of records) {
    const signature = capturedJsonStringify(Object.keys(record).sort());
    const group = groups.get(signature);
    if (group === undefined) groups.set(signature, [record]);
    else group.push(record);
  }
  if (groups.size > 1) {
    return unionNode([...groups.values()].map((group) => compileNode(group, path, maps)));
  }
  const keys = Object.keys(records[0] ?? {}).sort();
  const properties = Object.fromEntries(
    keys.map((key) => [
      key,
      compileNode(
        records.map(
          (record) =>
            /* SAFETY: every record in this signature group has the key being compiled. */ record[
              key
            ] as JsonValue,
        ),
        `${path}.${key}`,
        maps,
      ),
    ]),
  );
  return { kind: "object", properties, required: keys, additionalProperties: false };
}

function isPublicScalar(value: JsonValue): value is PublicArtifactScalar {
  return isString(value) || isBoolean(value) || (isNumber(value) && Number.isFinite(value));
}

function schemaHash(root: PublicArtifactSchema["root"]): string {
  return hashJsonBytes({ schema: PUBLIC_ARTIFACT_SCHEMA_VERSION, root });
}

export function compilePublicArtifactSchema(
  declaredFields: readonly PublicArtifactFieldInput[],
  /** Accept artifacts already validated by the controller; not re-parsed, so the hash stays stable. */
  canonicalAcceptArtifacts: readonly JsonValue[],
): PublicArtifactSchema {
  const roots = declaredFields.map((field) => field.name).sort();
  if (
    roots.length === 0 ||
    roots.some((root) => root.trim() === "") ||
    new Set(roots).size !== roots.length
  ) {
    throw new Error("public artifact schema requires a non-empty unique set of non-blank root names");
  }
  if (canonicalAcceptArtifacts.length === 0) {
    throw new Error("public artifact schema requires at least one controller-validated accept artifact");
  }
  const accepted = canonicalAcceptArtifacts;
  for (const [index, artifact] of accepted.entries()) {
    if (!isRecord(artifact)) {
      throw new Error(`public artifact schema accept[${index}] must be an object`);
    }
    const actual = Object.keys(artifact).sort();
    if (!sameKeys(roots, actual)) {
      throw new Error(
        `public artifact schema accept[${index}] roots [${actual.join(", ")}] do not equal declared roots [${roots.join(", ")}]`,
      );
    }
  }
  const maps: MapDeclarations = {
    paths: new Set(
      declaredFields.flatMap((field) =>
        (field.openMapPaths ?? []).map((entry) =>
          entry === "$" ? `$.${field.name}` : `$.${field.name}.${entry}`,
        ),
      ),
    ),
    used: new Set(),
  };
  const root = compileNode(accepted, "$", maps);
  if (root.kind !== "object") throw new Error("public artifact schema root must be an object");
  for (const declared of maps.paths) {
    if (!maps.used.has(declared)) {
      throw new Error(
        `public artifact schema declares open map ${declared}, but no accepted example carries an object there`,
      );
    }
  }
  applyFileMapFields(declaredFields, root.properties);
  // Declared values take priority over values inferred from accepted examples. Every accepted
  // example must use a declared value, otherwise the brief and controls disagree.
  for (const field of declaredFields) {
    const values = field.allowedValues;
    if (values === undefined) continue;
    for (const [index, artifact] of accepted.entries()) {
      const value = /* SAFETY: the accept corpus walk above threw unless every example is an object. */ (
        artifact as Record<string, JsonValue>
      )[field.name];
      if (!values.some((allowed) => allowed === value)) {
        throw new Error(
          `public artifact schema accept[${index}].${field.name} is ${capturedJsonStringify(value)}, outside the declared allowedValues`,
        );
      }
    }
    root.properties[field.name] = {
      kind: "closed",
      values:
        /* SAFETY: the brief validator refuses an empty `allowedValues`, and the undefined case continued above. */ [
          ...values,
        ] as [PublicArtifactScalar, ...PublicArtifactScalar[]],
    };
  }
  // Field declarations add constraints after inference, so check every accepted example against
  // the final schema as well (e.g. a file map whose control uses an unsafe path).
  for (const [index, artifact] of accepted.entries()) {
    const issue = validateNode(root, artifact, "$")[0];
    if (issue !== undefined) {
      throw new Error(
        `public artifact schema accept[${index}] violates the declared schema at ${issue.path}: expected ${issue.expected}, got ${issue.actual}`,
      );
    }
  }
  return { schema: PUBLIC_ARTIFACT_SCHEMA_VERSION, root, sha256: schemaHash(root) };
}

/** A union's alternatives are checked as a set before the walk descends: at least two, none
 *  nested or open, distinct and in canonical order. */
function assertUnionNode(
  node: JsonObject,
  path: string,
): asserts node is JsonObject & { anyOf: JsonValue[] } {
  assertNodeKeys(node, ["anyOf", "kind"], `public artifact schema union node ${path} is malformed`);
  if (
    !Array.isArray(node.anyOf) ||
    node.anyOf.length < 2 ||
    node.anyOf.some(
      (alternative) =>
        !isRecord(alternative) ||
        !isString(alternative.kind) ||
        alternative.kind === "union" ||
        alternative.kind === "any-json",
    )
  ) {
    throw new Error(`public artifact schema union node ${path} is malformed`);
  }
  const keys = node.anyOf.map((alternative) =>
    capturedJsonStringify(
      /* SAFETY: the check above threw unless every alternative carries one of the declared node kinds. */ alternative as PublicArtifactSchemaNode,
    ),
  );
  if (new Set(keys).size !== keys.length || !sameKeys(keys, [...keys].sort())) {
    throw new Error(`public artifact schema union node ${path} is not canonical`);
  }
}

/** An object node requires every declared property and permits no additional properties. */
function assertObjectNode(
  node: JsonObject,
  path: string,
): asserts node is JsonObject & { properties: JsonObject; required: string[] } {
  assertNodeKeys(
    node,
    ["additionalProperties", "kind", "properties", "required"],
    `public artifact schema object node ${path} is malformed`,
  );
  if (
    node.kind !== "object" ||
    !isRecord(node.properties) ||
    !Array.isArray(node.required) ||
    node.additionalProperties !== false ||
    !node.required.every((key) => isString(key)) ||
    !sameKeys([...node.required].sort(), Object.keys(node.properties).sort())
  ) {
    throw new Error(`public artifact schema object node ${path} is malformed`);
  }
}

export function validatePublicArtifactSchema(schema: PublicArtifactSchema): PublicArtifactSchema {
  if (
    !isRecord(schema) ||
    !sameKeys(Object.keys(schema).sort(), ["root", "schema", "sha256"]) ||
    schema.schema !== PUBLIC_ARTIFACT_SCHEMA_VERSION ||
    !isRecord(schema.root) ||
    schema.root.kind !== "object" ||
    !isString(schema.sha256) ||
    schema.sha256 !== schemaHash(schema.root)
  ) {
    throw new Error("public artifact schema is malformed or its sha256 does not match its canonical bytes");
  }
  const cloned = parseJsonAs<PublicArtifactSchema>(capturedJsonStringify(schema));
  const walk = (node: JsonValue | undefined, path: string): void => {
    if (!isRecord(node) || !isString(node.kind)) {
      throw new Error(`public artifact schema node ${path} is malformed`);
    }
    if (["any-json", "null", "boolean", "number", "string", "file-map"].includes(node.kind)) {
      assertNodeKeys(node, ["kind"], `public artifact schema node ${path} is malformed`);
      return;
    }
    if (node.kind === "closed") {
      assertNodeKeys(node, ["kind", "values"], `public artifact schema closed entry at ${path} is malformed`);
      if (!Array.isArray(node.values) || node.values.length === 0 || !node.values.every(isPublicScalar)) {
        throw new Error(`public artifact schema closed entry at ${path} is malformed`);
      }
      return;
    }
    if (node.kind === "union") {
      assertUnionNode(node, path);
      for (const [index, alternative] of node.anyOf.entries()) walk(alternative, `${path}.anyOf[${index}]`);
      return;
    }
    if (node.kind === "array") {
      assertNodeKeys(node, ["items", "kind"], `public artifact schema node ${path} is malformed`);
      walk(node.items, `${path}.items`);
      return;
    }
    if (node.kind === "map") {
      assertNodeKeys(node, ["kind", "values"], `public artifact schema node ${path} is malformed`);
      walk(node.values, `${path}.values`);
      return;
    }
    assertObjectNode(node, path);
    for (const [key, child] of Object.entries(node.properties)) walk(child, childPath(path, key));
  };
  walk(cloned.root, "$");
  return cloned;
}

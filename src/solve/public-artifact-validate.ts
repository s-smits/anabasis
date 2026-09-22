/** Validating one artifact value against a compiled public schema. The schema compiler and
 *  the schema's own shape check stay in public-artifact-schema.ts; this file owns the walk over
 *  submitted bytes and the issue rows it reports. */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { FILE_MAP_EXPECTED, fileMapIssues } from "./file-map.ts";
import { isBoolean, isNumber, isRecord, isString, typeName } from "../meta/json-shape.ts";
import { preparedArtifactJson } from "./draft-store.ts";
import type {
  PublicArtifactSchema,
  PublicArtifactSchemaIssue,
  PublicArtifactSchemaNode,
} from "./public-artifact-schema.ts";
import { errorMessage } from "../meta/runtime-values.ts";

/** The three primitive kinds and the predicate each accepts. */
const PRIMITIVE_CHECKS = { boolean: isBoolean, number: isNumber, string: isString };

/** The kind name an issue row reports for a submitted value; mirrors the compiled node kinds. */
function actualKind(value: unknown): string {
  if (isNumber(value) && !Number.isFinite(value)) return "non-finite number";
  return typeName(value);
}

export function childPath(path: string, key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? `${path}.${key}` : `${path}[${capturedJsonStringify(key)}]`;
}

function expected(node: PublicArtifactSchemaNode): string {
  if (node.kind === "any-json") return "a finite JSON value";
  if (node.kind === "file-map") return FILE_MAP_EXPECTED;
  if (node.kind === "map") return `a map whose values are each ${expected(node.values)}`;
  if (node.kind === "closed") {
    return `one of ${node.values.map((value) => capturedJsonStringify(value)).join(", ")}`;
  }
  if (node.kind === "union") return `one of (${node.anyOf.map(expected).join(" | ")})`;
  if (node.kind === "array") return "array";
  if (node.kind === "object") return `object with exactly {${Object.keys(node.properties).join(", ")}}`;
  return node.kind;
}

/** The single issue every branch reports when a value is not the kind its node declared. */
function mismatch(node: PublicArtifactSchemaNode, value: unknown, path: string): PublicArtifactSchemaIssue[] {
  return [{ path, expected: expected(node), actual: actualKind(value) }];
}

export function validateNode(
  node: PublicArtifactSchemaNode,
  value: unknown,
  path: string,
): PublicArtifactSchemaIssue[] {
  if (isNumber(value) && !Number.isFinite(value)) {
    return [{ path, expected: expected(node), actual: "non-finite number" }];
  }
  if (node.kind === "any-json") {
    if (Array.isArray(value)) {
      return value.flatMap((item, index) => validateNode(node, item, `${path}[${index}]`));
    }
    if (isRecord(value)) {
      return Object.entries(value).flatMap(([key, item]) => validateNode(node, item, childPath(path, key)));
    }
    return [];
  }
  if (node.kind === "null") {
    return value === null ? [] : [{ path, expected: "null", actual: actualKind(value) }];
  }
  if (node.kind === "file-map") {
    if (!isRecord(value)) return [{ path, expected: FILE_MAP_EXPECTED, actual: actualKind(value) }];
    return fileMapIssues(value, path, childPath);
  }
  if (node.kind === "map") {
    if (!isRecord(value)) return mismatch(node, value, path);
    return Object.entries(value).flatMap(([key, item]) =>
      validateNode(node.values, item, childPath(path, key)),
    );
  }
  if (node.kind === "closed") {
    if (node.values.some((allowed) => allowed === value)) return [];
    return mismatch(node, value, path);
  }
  if (node.kind === "union") {
    if (node.anyOf.some((alternative) => validateNode(alternative, value, path).length === 0)) return [];
    return mismatch(node, value, path);
  }
  if (node.kind === "array") {
    if (!Array.isArray(value)) return [{ path, expected: "array", actual: actualKind(value) }];
    return value.flatMap((item, index) => validateNode(node.items, item, `${path}[${index}]`));
  }
  if (node.kind === "object") return objectIssues(node, value, path);
  return PRIMITIVE_CHECKS[node.kind](value) ? [] : [{ path, expected: node.kind, actual: actualKind(value) }];
}

/** Every required key present, no undeclared key, and each declared value valid in turn. */
function objectIssues(
  node: Extract<PublicArtifactSchemaNode, { kind: "object" }>,
  value: unknown,
  path: string,
): PublicArtifactSchemaIssue[] {
  if (!isRecord(value)) return mismatch(node, value, path);
  const issues: PublicArtifactSchemaIssue[] = [];
  const keys = Object.keys(value);
  for (const key of node.required) {
    if (!Object.hasOwn(value, key)) {
      const requiredNode = node.properties[key];
      issues.push({
        path: childPath(path, key),
        expected: requiredNode ? expected(requiredNode) : "a schema-declared value",
        actual: "missing",
      });
    }
  }
  for (const key of keys) {
    const property = Object.hasOwn(node.properties, key) ? node.properties[key] : undefined;
    if (property === undefined) {
      issues.push({
        path: childPath(path, key),
        expected: "no undeclared field",
        actual: actualKind(value[key]),
      });
    } else {
      issues.push(...validateNode(property, value[key], childPath(path, key)));
    }
  }
  return issues;
}

export function publicArtifactSchemaFindings(
  schema: PublicArtifactSchema,
  artifact: unknown,
): PublicArtifactSchemaIssue[] {
  const issues = validateNode(schema.root, artifact, "$");
  if (issues.length > 0) return issues;
  try {
    preparedArtifactJson(artifact);
    return [];
  } catch (cause) {
    return [
      { path: "$", expected: "a JSON answer within the public byte limit", actual: errorMessage(cause) },
    ];
  }
}

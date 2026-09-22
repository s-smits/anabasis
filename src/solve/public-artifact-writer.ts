import { type TSchema, Type } from "typebox";
import type { JsonValue } from "../meta/json-shape.ts";
import { FILE_MAP_MAX_ENTRIES, FILE_MAP_MAX_PATH_CHARS } from "./file-map.ts";
import {
  type PublicArtifactSchema,
  type PublicArtifactSchemaNode,
  publicArtifactSchemaFindings,
} from "./public-artifact-schema.ts";

/** JSON-Schema spelling of the exact safe-path relation, except for the file/directory prefix
 *  join (for example `a` beside `a/b`). `publicArtifactWriterArgumentProblem` applies the complete
 *  public validator before DraftStore changes, so that join cannot pass through the approximation. */
const SAFE_FILE_PATH_PATTERN =
  `^(?!/)(?!\\.{1,2}(?:/|$))(?![\\s\\S]*/\\.{1,2}(?:/|$))(?![\\s\\S]*//)` +
  `(?![\\s\\S]*/$)(?![\\s\\S]*[\\\\\\u0000])[\\s\\S]{1,${String(FILE_MAP_MAX_PATH_CHARS)}}$`;

function schemaUnion(schemas: [TSchema, ...TSchema[]]): TSchema {
  return schemas.length === 1 ? schemas[0] : Type.Union(schemas);
}

function writerNode(node: PublicArtifactSchemaNode): TSchema {
  if (node.kind === "any-json") return Type.Unknown();
  if (node.kind === "null") return Type.Null();
  if (node.kind === "boolean") return Type.Boolean();
  if (node.kind === "number") return Type.Number();
  if (node.kind === "string") return Type.String();
  if (node.kind === "file-map") {
    return Type.Record(Type.String({ pattern: SAFE_FILE_PATH_PATTERN }), Type.String(), {
      additionalProperties: false,
      maxProperties: FILE_MAP_MAX_ENTRIES,
    });
  }
  if (node.kind === "map") {
    return Type.Record(Type.String(), writerNode(node.values), { additionalProperties: false });
  }
  if (node.kind === "closed") {
    const [first, ...rest] = node.values;
    return schemaUnion([Type.Literal(first), ...rest.map((value) => Type.Literal(value))]);
  }
  if (node.kind === "union") {
    const [first, second, ...rest] = node.anyOf;
    return schemaUnion([writerNode(first), writerNode(second), ...rest.map(writerNode)]);
  }
  if (node.kind === "array") return Type.Array(writerNode(node.items));
  return Type.Object(
    Object.fromEntries(Object.entries(node.properties).map(([name, child]) => [name, writerNode(child)])),
    { additionalProperties: false },
  );
}

/** The model-visible structured writer contract. It is derived from the same compiled schema that
 *  submit enforces, so a generated tool can no longer narrow numbers/strings or widen object and
 *  file-map keys behind a second hand-written schema. */
export function publicArtifactWriterParameters(schema: PublicArtifactSchema): TSchema {
  // The controller compiled and recorded this schema before the canonical worker frame was built.
  // Canonical framing sorts object keys, while the schema's existing hash deliberately commits to
  // compile-time insertion order, so re-running the storage validator in the child would reject
  // the same schema solely because its wire representation is canonical. The child consumes the
  // already authenticated root and the parent retains the original hash for binding evidence.
  return writerNode(schema.root);
}

/** Exact public validation at the DraftStore mutation boundary. Provider-side JSON Schema catches
 *  ordinary mistakes; this check also owns relations JSON Schema cannot state, such as a file key
 *  being both a file and a parent directory. */
export function publicArtifactWriterArgumentProblem(
  schema: PublicArtifactSchema,
  artifact: JsonValue,
): string | null {
  const [first] = publicArtifactSchemaFindings(schema, artifact);
  return first === undefined ? null : `${first.path}: expected ${first.expected}; received ${first.actual}`;
}

/**
 * The tools a generated harness declares: a host tool spec plus the DraftStore its run writes into.
 *
 * Two things separate a draft tool from an ordinary one. Its result is framed for the worker
 * protocol, so text past the evidence ceiling stays a refusal rather than being shortened — the
 * generated harness's own contract is what conformance measures, and quietly trimming its output
 * would hide an authoring defect instead of reporting it. And its declared parameters are
 * rewritten before the pinned validator sees them, because `Type.Union([Type.Number(),
 * Type.Null()])` is how a nullable value is spelled and null, zero and a real number must all
 * survive it exactly: a null coerced to 0, or a 0 read as absent, is a different artifact.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import type { AgentTool, AgentToolResult, AgentToolUpdateCallback } from "@earendil-works/pi-agent-core";
import { type Static, type TSchema, validateToolArguments } from "@earendil-works/pi-ai";
import { Value } from "typebox/value";
import { type DefineToolSpec, type Evidence, evidenceResult, toolDefinition } from "./define-tool.ts";
import type { DraftStore } from "./draft-store.ts";
import { isObject, isRecord, isString, type OpenRecord } from "../meta/json-shape.ts";

const DRAFT_TOOL = Symbol.for("anabasis/draft-tool/v1");

/** `defineDraftTool` sets this marker and `isDraftTool` checks it, which is how `createDomainHarness`
 *  in built-starter.ts can refuse a tool built any other way: only a tool that went through
 *  `defineDraftTool` takes a DraftStore as an argument and validates against its declared schema
 *  first. The optional property describes the shape that check inspects; an ordinary object without
 *  the marker does not qualify as a draft tool. */
interface DraftToolBrand {
  readonly [DRAFT_TOOL]?: true;
}

const ANNOTATION_KEYS = new Set([
  "$comment",
  "default",
  "deprecated",
  "description",
  "examples",
  "readOnly",
  "title",
  "writeOnly",
]);
const NUMERIC_KEYS = new Set([
  ...ANNOTATION_KEYS,
  "exclusiveMaximum",
  "exclusiveMinimum",
  "maximum",
  "minimum",
  "multipleOf",
  "type",
]);
const SCHEMA_ARRAY_KEYS = ["allOf", "anyOf", "oneOf", "prefixItems"] as const;
const SCHEMA_MAP_KEYS = ["dependentSchemas", "patternProperties", "properties"] as const;
const SCHEMA_SINGLE_KEYS = [
  "additionalProperties",
  "contains",
  "else",
  "if",
  "items",
  "not",
  "propertyNames",
  "then",
] as const;

export interface DraftTool<P extends TSchema = TSchema, D = unknown>
  extends Omit<AgentTool<P, D>, "execute"> {
  execute(
    callId: string,
    params: Static<P>,
    draft: DraftStore,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<D>,
  ): Promise<AgentToolResult<D>>;
}

interface DefineDraftToolSpec<P extends TSchema, D> extends Omit<DefineToolSpec<P, D>, "run"> {
  run: (params: Static<P>, draft: DraftStore, signal?: AbortSignal) => Evidence<D> | Promise<Evidence<D>>;
}

/** The rewrite below reads a TypeBox schema by keyword through `OpenRecord`. TSchema declares no
 *  string index even though its keywords are enumerable, and its values stay `unknown` because
 *  TypeBox schemas are not parsed JSON. Each rewrite therefore checks the fields it uses before
 *  reading them, and hands the result back through TSchema. */
const isSchema = (value: unknown): value is OpenRecord => isRecord(value);

function piAcceptsNull(schema: OpenRecord): boolean {
  try {
    validateToolArguments(
      // SAFETY: the probe is a closed object JSON Schema assembled directly below; Pi reads no
      // fields outside this declared shape.
      {
        name: "nullable-schema-probe",
        description: "Internal schema probe.",
        parameters: {
          type: "object",
          properties: { value: schema },
          required: ["value"],
          additionalProperties: false,
        },
      },
      // SAFETY: this private construction probe supplies the exact name and one declared value.
      { name: "nullable-schema-probe", arguments: { value: null } } as never,
    );
    return true;
  } catch {
    return false;
  }
}

function exactNullableNumeric(schema: OpenRecord): OpenRecord | null {
  const variants = schema.anyOf;
  if (!Array.isArray(variants) || variants.length !== 2 || !variants.every(isSchema)) return null;
  const numeric = variants.find((candidate) => candidate.type === "number" || candidate.type === "integer");
  const nullable = variants.find((candidate) => candidate.type === "null");
  if (numeric === undefined || nullable === undefined) return null;
  if (Object.keys(numeric).some((key) => !NUMERIC_KEYS.has(key))) return null;
  if (Object.keys(nullable).some((key) => key !== "type" && !ANNOTATION_KEYS.has(key))) return null;
  const { anyOf: _union, ...wrapper } = schema;
  if (Object.keys(wrapper).some((key) => !ANNOTATION_KEYS.has(key))) return null;
  const { type: numericType, ...numericRules } = numeric;
  // The `find` above accepted only `"number"` or `"integer"`, so this is always true; it is stated
  // for the compiler, which cannot follow a predicate through `Array.prototype.find`.
  if (!isString(numericType)) return null;
  const { type: _nullType, ...nullRules } = nullable;
  const conflicts = Object.keys(wrapper).some(
    (key) =>
      (key in numericRules &&
        capturedJsonStringify(wrapper[key]) !== capturedJsonStringify(numericRules[key])) ||
      (key in nullRules && capturedJsonStringify(wrapper[key]) !== capturedJsonStringify(nullRules[key])),
  );
  if (conflicts) return null;
  const branchConflicts = Object.keys(numericRules).some(
    (key) =>
      key in nullRules && capturedJsonStringify(numericRules[key]) !== capturedJsonStringify(nullRules[key]),
  );
  if (branchConflicts) return null;
  const direct = {
    ...numericRules,
    ...nullRules,
    ...wrapper,
    type: [numericType, "null"],
  } satisfies OpenRecord;
  return piAcceptsNull(direct) ? direct : null;
}

function mapSchemaChildren(schema: OpenRecord, visit: (child: OpenRecord) => OpenRecord): OpenRecord {
  let next = schema;
  const replace = (key: string, value: OpenRecord | OpenRecord[] | Record<string, OpenRecord>): void => {
    if (value !== schema[key]) next = { ...next, [key]: value };
  };
  for (const key of SCHEMA_SINGLE_KEYS) {
    const child = schema[key];
    if (isSchema(child)) replace(key, visit(child));
    else if (key === "items" && Array.isArray(child) && child.every(isSchema)) replace(key, child.map(visit));
  }
  for (const key of SCHEMA_ARRAY_KEYS) {
    const children = schema[key];
    if (Array.isArray(children) && children.every(isSchema)) replace(key, children.map(visit));
  }
  for (const key of SCHEMA_MAP_KEYS) {
    const children = schema[key];
    if (!isSchema(children)) continue;
    replace(
      key,
      Object.fromEntries(
        Object.entries(children).map(([name, child]) => [name, isSchema(child) ? visit(child) : child]),
      ),
    );
  }
  return next;
}

/** Pi tries each `anyOf` branch after coercion. For an exact numeric/null union that turns null into
 *  zero when number is first, and zero into null when null is first, so the union's own spelling
 *  decides which value is lost. Its type-array path checks exact JSON types before coercion, so Pi
 *  is handed that equivalent spelling instead — `exactNullableNumeric` rewrites only a union it has
 *  proved is exactly number-or-null with no conflicting keywords, and `piAcceptsNull` confirms the
 *  pinned validator accepts the rewrite before it is adopted. The draft wrapper below still
 *  validates the received value against the author's original schema, so the rewrite widens nothing.
 *  `test/draft-tool-nullable-arguments.test.ts` holds both union orders against the pinned
 *  validator. */
function piSafeDraftParameters<P extends TSchema>(schema: P): P {
  const visit = (value: OpenRecord): OpenRecord => {
    const next = mapSchemaChildren(value, visit);
    return exactNullableNumeric(next) ?? next;
  };
  // SAFETY: every TypeBox schema is a JSON-Schema object; TSchema deliberately omits a string
  // index signature even though the declared schema keywords are enumerable at runtime.
  const safeSchema = visit(schema as OpenRecord);
  // SAFETY: the only rewrite is JSON-Schema-equivalent number|null syntax; the original schema
  // remains the authoritative validation immediately before the draft write.
  return safeSchema as P;
}

export function defineDraftTool<P extends TSchema, D = unknown>(
  spec: DefineDraftToolSpec<P, NoInfer<D>>,
): DraftTool<P, D> {
  const tool = toolDefinition(
    { ...spec, parameters: piSafeDraftParameters(spec.parameters) },
    async (
      _callId: string,
      params: Static<P>,
      draft: DraftStore,
      signal?: AbortSignal,
    ): Promise<AgentToolResult<D>> => {
      // `Static<P>` is erased at runtime, and the worker protocol declares a tool call's arguments
      // as an open record of unknown values and dispatches them to `execute` without consulting the
      // tool's own schema, so nothing ahead of this line has checked them. The declared schema is
      // enforced here, before any draft write, and the thrown error crosses the worker boundary as
      // an ordinary model-visible tool error the solver can act on.
      if (!Value.Check(spec.parameters, params)) {
        const [first] = Value.Errors(spec.parameters, params);
        throw new Error(
          `tool "${spec.name}" arguments do not match its declared parameter schema${
            first === undefined ? "" : ` (${first.instancePath || "$"}: ${first.message})`
          }`,
        );
      }
      return evidenceResult(await spec.run(params, draft, signal));
    },
  );
  Object.defineProperty(tool, DRAFT_TOOL, { value: true });
  return tool;
}

export const isDraftTool = (value: unknown): value is DraftTool =>
  // SAFETY: `isObject` establishes a non-null object, and reading an absent optional marker
  // returns undefined.
  isObject(value) && (value as DraftToolBrand)[DRAFT_TOOL] === true;

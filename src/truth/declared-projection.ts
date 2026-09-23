/**
 * Recursive declared-key allowlist for the one review surface that carries a controller-built
 * object to a model: the Main Judge's public context.
 *
 * Every depth is checked, not just the top level. `sanitizeForEvaluator` normalizes text but does
 * not check whether each key is declared, so an undeclared field planted inside a declared object —
 * `domain.toolContract.tools[0].<planted>` — reaches the Judge prompt intact. The isolation
 * contract excludes verifier output, private source, repair advice, reference artifacts and
 * per-task failure locations from this model context, so a top-level-only allowlist leaves a nested
 * path by which all of that can reach the model.
 *
 * The declarations below follow the public fields in judge-contract.ts and case-record.ts.
 * A declaration that omits a field still promised by those types loses data, which the owning
 * tests check. Only declared keys survive at each depth, and array elements are checked in turn.
 * Values with the wrong declared kind are also dropped: allowing an object in a string field
 * would provide another route for undeclared nested data, even though the outer key was valid.
 * These declarations limit disclosure; they do not replace validation of the full source types.
 *
 * Two kinds pass any value through. `opaque` is a field the contract itself declares `unknown`
 * (`artifactSchema`, `publicInput`, a submitted artifact, a solve trace): those are model-authored
 * or task-authored content without a fixed key set. `null` passes everywhere because nullability
 * varies across the source types and a null value contains no nested or textual data to disclose.
 *
 * The projection is order-preserving and, for well-formed input, byte-identical: the Judge prompt
 * embeds `trustedJsonStringify(publicContext, null, 2)`, so a reordered key would move the
 * model-visible bytes and the recorded prompt digest.
 */
import { isBoolean, isNumber, isObject, isString } from "../meta/json-shape.ts";

/** One declared field. `{ of }` is an array of that element declaration; `{ fields }` an object
 *  whose listed keys are the complete admitted set; `{ values }` a record whose public keys are
 *  data and whose values all share one declared shape. */
type DeclaredField =
  | "opaque"
  | "string"
  | "number"
  | "boolean"
  | { readonly of: DeclaredField }
  | { readonly values: DeclaredField }
  | { readonly fields: Readonly<Record<string, DeclaredField>> };

const PUBLIC_RESOURCE: DeclaredField = {
  fields: { name: "string", content: "opaque", digest: "string" },
};

const RUN_CONDITION: DeclaredField = {
  fields: { variant: "string", advisorsRemoved: { of: "string" }, toolInterfaceHash: "string" },
};

/** `JudgePublicDomain` in judge-contract.ts — the public card the Judge census receives. */
const JUDGE_PUBLIC_DOMAIN: DeclaredField = {
  fields: {
    slug: "string",
    domain: "string",
    publicRequest: "string",
    artifactSchema: "opaque",
    publicResources: { of: PUBLIC_RESOURCE },
    toolContract: {
      fields: {
        presets: { of: "string" },
        tools: { of: { fields: { name: "string", kind: "string", description: "string" } } },
        availableToolNames: { of: "string" },
      },
    },
    runtimeFacts: {
      fields: {
        capabilities: { of: "string" },
        maxSubmitAttempts: "number",
        condition: RUN_CONDITION,
      },
    },
  },
};

/** `JudgePublicTask` — `publicInput` is opaque task bytes; the rules carry no check id. */
const JUDGE_PUBLIC_TASK: DeclaredField = {
  fields: {
    taskId: "string",
    family: "string",
    publicInput: "opaque",
    publicValidityRules: {
      of: { fields: { assertion: "string", publicInputPaths: { of: "string" } } },
    },
  },
};

/** The run-relative file the battery writes this context to, and the tag it carries. */
export const JUDGE_PUBLIC_CONTEXT_FILE = "judge/public-context.json";
export const JUDGE_PUBLIC_CONTEXT_SCHEMA = "judge-public-context/v1";

/** The complete model-visible context of one Judge subject. */
export const JUDGE_PUBLIC_CONTEXT_DECLARATION: DeclaredField = {
  fields: { domain: JUDGE_PUBLIC_DOMAIN, publicTask: JUDGE_PUBLIC_TASK },
};

/**
 * Drop everything the declaration does not name. `undefined` is the drop signal: an absent key
 * stays absent instead of appearing as an explicit null, which keeps the serialized bytes
 * identical to the ones a well-formed input already produced.
 *
 * The object case iterates the input's own keys so surviving keys retain their original order.
 * For a well-formed object this preserves the serialized bytes.
 */
function project(value: unknown, declared: DeclaredField): unknown {
  // Null contains no nested or textual data, and `opaque` explicitly permits arbitrary content.
  // Both pass through unchanged; typed fields below still require their declared kind.
  if (value === null || declared === "opaque") return value;
  if (declared === "string") return isString(value) ? value : undefined;
  if (declared === "number") return isNumber(value) ? value : undefined;
  if (declared === "boolean") return isBoolean(value) ? value : undefined;
  if (!isObject(value)) return undefined;
  if ("of" in declared) return Array.isArray(value) ? projectArray(value, declared.of) : undefined;
  if (Array.isArray(value)) return undefined;
  const kept = new Map<string, unknown>();
  for (const [key, item] of Object.entries(value)) {
    // Own-property lookup only: an inherited name such as `toString` is not a declared field.
    const field =
      "values" in declared
        ? declared.values
        : Object.prototype.hasOwnProperty.call(declared.fields, key)
          ? declared.fields[key]
          : undefined;
    if (field === undefined) continue;
    const projected = project(item, field);
    if (projected !== undefined) kept.set(key, projected);
  }
  // Object.fromEntries defines own properties. Even a declared "__proto__" key cannot invoke
  // the prototype setter, matching the sanitizer's protection when it writes an object.
  return Object.fromEntries(kept);
}

/** A dropped element leaves the array rather than becoming a hole: an element that contradicts its
 *  declaration was never part of the contract, and a null placeholder would read as one. */
function projectArray(items: readonly unknown[], element: DeclaredField): unknown[] {
  const kept: unknown[] = [];
  for (const item of items) {
    const projected = project(item, element);
    if (projected !== undefined) kept.push(projected);
  }
  return kept;
}

/**
 * The one entry point: the caller's own value with every undeclared field, at every depth,
 * removed. The declaration is derived from the caller's type, so the projection is an identity on
 * every value that type actually admits.
 */
export function projectDeclared<T>(value: T, declaration: DeclaredField): T {
  // SAFETY: every declared key keeps its declared kind and its position. Only undeclared keys and
  // values contradicting a declared kind are dropped, and neither is a value `T` names.
  return project(value, declaration) as T;
}

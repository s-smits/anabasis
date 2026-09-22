import { sha256 } from "./digest.ts";
import { capturedJsonStringify as stringify, capturedStructuredClone as clone } from "./json-runtime.ts";
import { isBoolean, isNumber, isObject, isString, type JsonValue } from "./json-shape.ts";

const objectPrototype = Object.prototype;
const arrayPrototype = Array.prototype;
const arrayFrom = Array.from;
const { isArray } = Array;
const objectEntries = Object.entries;
const objectValues = Object.values;
const prototypeOf = Object.getPrototypeOf;

interface CanonicalJsonCopyResult {
  value: unknown;
  bytes: string;
}

/** Deterministic UTF-16 code-unit order. Locale collation must not shape persisted identities. */
export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Sorted-key JSON text, the one encoder behind every recorded identity and evidence digest. Keys
 * sort by UTF-16 code unit so identity is independent of locale; before 2026-08-05 the evidence
 * copy used `localeCompare`, allowing the host's collation to affect a recorded digest.
 *
 * The two encodings differ only in `undefined`. Identity (`"omit"`) drops undefined object
 * properties and writes any other undefined as null, so adding an optional field and leaving it
 * unset preserves the digest; campaign epoch keys and candidate handoffs rely on this. Evidence
 * (`"keep"`) writes `undefined` literally, so a truth check can tell an unresolved path from a
 * path holding null.
 */
function encodeSorted(value: unknown, undefinedValues: "omit" | "keep"): string {
  if (isArray(value)) return `[${arrayFrom(value, (item) => encodeSorted(item, undefinedValues)).join(",")}]`;
  if (isObject(value)) {
    const entries = objectEntries(
      /* SAFETY: reached only when `isObject(value)`. */ value as Record<string, JsonValue>,
    )
      .filter(([, child]) => undefinedValues === "keep" || child !== undefined)
      .sort(([a], [b]) => compareCodeUnits(a, b));
    return `{${entries.map(([key, child]) => `${stringify(key)}:${encodeSorted(child, undefinedValues)}`).join(",")}}`;
  }
  return stringify(value) ?? (undefinedValues === "keep" ? "undefined" : "null");
}

/** Deterministic evidence encoding shared by comparison sessions and truth checks: a missing value
 *  stays distinct from null. It validates nothing; `stableJson` is the identity encoding that does. */
export function canonicalJson(value: unknown): string {
  return encodeSorted(value, "keep");
}

function isPlainFiniteJson(
  value: unknown,
  undefinedValues: "allowed" | "rejected",
  seen = new Set<object>(),
): boolean {
  if (value === undefined) return undefinedValues === "allowed";
  if (value === null || isString(value) || isBoolean(value)) return true;
  if (isNumber(value)) return Number.isFinite(value);
  if (!isObject(value) || seen.has(value)) return false;
  seen.add(value);
  const valid = isArray(value)
    ? arrayFrom(value).every((item) => isPlainFiniteJson(item, undefinedValues, seen))
    : prototypeOf(value) === objectPrototype &&
      objectValues(
        /* SAFETY: the check above returned when `value === undefined`. */ value as Record<string, JsonValue>,
      ).every((item) => isPlainFiniteJson(item, undefinedValues, seen));
  seen.delete(value);
  return valid;
}

/** Stable bytes for JSON-shaped values. Optional object fields may be undefined and are omitted. */
export function stableJson(value: unknown): string {
  if (!isPlainFiniteJson(value, "allowed")) throw new Error("value is not stable finite JSON");
  return encodeSorted(value, "omit");
}

/** Semantic equality for JSON-shaped values; object insertion order is irrelevant. */
export function sameJsonValue(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

export function canonicalJsonCopy(value: unknown): CanonicalJsonCopyResult {
  const copy = clone(value);
  if ("toJSON" in objectPrototype || "toJSON" in arrayPrototype) {
    throw new Error("shared JSON intrinsic changed");
  }
  if (!isPlainFiniteJson(copy, "rejected")) throw new Error("value is not plain finite JSON");
  return {
    value: copy,
    bytes: encodeSorted(copy, "omit"),
  };
}

/** Stable content identity for in-memory JSON values; object key order does not shape the hash. */
export function hashJsonValue(value: unknown): string {
  return sha256(stableJson(value));
}

/** Validate values received from vendor objects or untyped readers before recording them.
 *  Reject non-JSON values explicitly: JSON.stringify would silently omit a function or symbol
 *  from object properties, changing what the snapshot records. */
export function requireJsonValue(value: unknown): JsonValue {
  if (!isPlainFiniteJson(value, "rejected")) throw new Error("value is not plain finite JSON");
  return /* SAFETY: isPlainFiniteJson just admitted the complete finite JSON closure. */ value as JsonValue;
}

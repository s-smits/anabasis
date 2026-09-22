/** Re-read and digest the repository's frozen policy file; consumers select their own rows. */
import { readFileSync } from "../meta/filesystem.ts";
import { sha256 } from "../meta/digest.ts";
import { canonicalJson } from "../meta/stable-json.ts";
import { type JsonValue, asRecord, isNumber, isRecord } from "../meta/json-shape.ts";

/** Repository-root name of the frozen policy file; callers join it to their own root. */
export const FROZEN_MANIFEST_PATH = "thresholds.frozen.yaml";

interface FrozenManifest {
  digest: string;
  raw: Record<string, JsonValue>;
}

/** A bound parses an untrusted manifest value: the typed value, or null when malformed. It refuses
 *  what would disable a stop or fail selector construction, such as an infinite round count, a
 *  negative rate or an inverted band. */
type Bound<T> = (v: JsonValue | undefined) => T | null;

interface FieldSpec<T> {
  /** The yaml field name, when it differs from the output key. */
  from?: string;
  bound: Bound<T>;
  fallback: T;
}

export function loadFrozenManifest(path = FROZEN_MANIFEST_PATH): FrozenManifest {
  const bytes = readFileSync(path);
  // A manifest that is not a mapping becomes an empty policy, so readers use their defaults.
  const raw = asRecord(Bun.YAML.parse(bytes.toString("utf8"))) ?? {};
  // The digest covers the parsed policy, so comments, whitespace and key order leave the
  // identity, and with it climb evidence admission, unchanged.
  return { digest: `sha256:${sha256(canonicalJson(raw))}`, raw };
}

/** Reads one policy row, returning {} for a missing file or absent row so callers use their
 *  declared defaults and a manifest never blocks a run. */
export function frozenRow(key: string, path?: string): Record<string, JsonValue> {
  try {
    const row = loadFrozenManifest(path).raw[key];
    /* SAFETY: a row that is not a record reads as the empty row, so every field falls back to the
     *  caller's declared default rather than to a value this reader invented. */
    return isRecord(row) ? row : {};
  } catch {
    return {};
  }
}

export const posInt: Bound<number> = (v) => (isNumber(v) && Number.isSafeInteger(v) && v >= 1 ? v : null);

export const band01: Bound<[number, number]> = (v) => {
  if (!Array.isArray(v)) return null;
  const lo = v[0];
  const hi = v[1];
  return isNumber(lo) && isNumber(hi) && lo >= 0 && hi <= 1 && lo < hi ? [lo, hi] : null;
};

/** Declares a frozen row's schema once; the returned reader applies yaml overrides field-wise under
 *  each field's bound. A missing or malformed field takes the declared fallback. */
export function policyRow<R extends Record<string, JsonValue>>(
  key: string,
  schema: { [K in keyof R]: FieldSpec<R[K]> },
): (manifestPath?: string) => R {
  return (manifestPath?: string): R => {
    const raw = frozenRow(key, manifestPath);
    const out =
      /* SAFETY: the record is filled field by field from the schema's own keys in the loop below, and every field takes a bound value or its declared fallback. */ {} as R;
    for (const field of /* SAFETY: the schema is a mapped type over `R`, so its own keys are exactly the string keys of `R`. */ Object.keys(
      schema,
    ) as Array<keyof R & string>) {
      const spec = schema[field];
      out[field] = spec.bound(raw[spec.from ?? field]) ?? spec.fallback;
    }
    return out;
  };
}

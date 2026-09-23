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
 *  what would disable a stop or fail selector construction — an infinite round count, a negative
 *  rate, an inverted band. */
type Bound<T> = (v: JsonValue | undefined) => T | null;

interface FieldSpec<T> {
  /** The yaml field name, when it differs from the output key. */
  from?: string;
  bound: Bound<T>;
  fallback: T;
}

export function loadFrozenManifest(path = FROZEN_MANIFEST_PATH): FrozenManifest {
  const bytes = readFileSync(path);
  // `Bun.YAML.parse` returns `unknown`, so the manifest is narrowed here rather than assigned
  // through the `any` the previous reader took on trust. A manifest that is not a mapping — a
  // sequence, a bare scalar or an empty file — becomes an empty policy, and `frozenRow` returns
  // an empty row for a missing file, so threshold readers fall back to their declared defaults.
  const raw = asRecord(Bun.YAML.parse(bytes.toString("utf8"))) ?? {};
  // The digest covers the parsed policy, not the file bytes. Thresholds are part of the frozen
  // condition, so a recorded battery whose digest differs is excluded from climb evidence
  // (`climb-battery-admission.ts`). Under a byte digest a comment edit anywhere in the file would
  // exclude every battery recorded before it although no threshold moved. Comments, whitespace and
  // key order leave the identity alone.
  return { digest: `sha256:${sha256(canonicalJson(raw))}`, raw };
}

/** Read one policy row, returning {} for a missing file or absent row so callers use their
 *  declared defaults. This follows the decision to keep difficulty-policy reads from blocking a
 *  run; threshold readers share the same fallback behaviour here. */
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

/** Declare a frozen row's schema once; the returned reader applies yaml overrides field-wise under
 *  each field's bound. A missing or malformed field takes the declared fallback, so a manifest
 *  cannot block a run (operator direction). */
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

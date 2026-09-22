/**
 * Normalize untrusted Judge input: remove hidden control characters and bound text, depth
 * and nodes with visible truncation markers. Rules carry a version in recorded evidence;
 * they do not prove resistance to instructions embedded in the content.
 */

import { isObject, isString } from "../meta/json-shape.ts";

export const SANITIZER_VERSION = "judge-sanitizer/v3";

// One request budget preserves ordinary source files. The old 4,000-character leaf cap
// cut a firmware sketch the Judge needed to read, while 20,000 short leaves could send
// megabytes. Keys and values share this limit; exhausted containers collapse once.
const MAX_TEXT_LENGTH = 64_000;
const MAX_DEPTH = 64;
const MAX_NODES = 20000;
const TRUNCATION_MARKER = "…[sanitizer: truncated]";

/** Code-point ranges stripped from every string: C0 (minus \n\t), C1, zero-width and bidi
 *  override/isolate characters, and BOM. Kept as numeric ranges rather than a regex so the module
 *  carries no literal control characters. */
const STRIP_RANGES: readonly (readonly [number, number])[] = [
  [0x00, 0x08],
  [0x0b, 0x0c],
  [0x0e, 0x1f],
  [0x7f, 0x9f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];

interface SanitizedInput {
  value: unknown;
  version: string;
  /** True when any rule fired — recorded so a modified input is a visible fact. */
  modified: boolean;
  /** Named actions, deduplicated: "stripped-control-characters", "truncated-text",
   *  "truncated-depth", "truncated-nodes", "renamed-colliding-key". */
  actions: string[];
}

function stripControlChars(value: string): string {
  let out = "";
  for (const ch of value) {
    const cp = ch.codePointAt(0) ?? 0;
    if (!STRIP_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi)) out += ch;
  }
  return out;
}

export function sanitizeForEvaluator(input: unknown): SanitizedInput {
  const actions = new Set<string>();
  let nodes = 0;
  let textLeft = MAX_TEXT_LENGTH;
  const exhausted = () => {
    if (nodes >= MAX_NODES) actions.add("truncated-nodes");
    if (textLeft === 0) actions.add("truncated-text");
    return nodes >= MAX_NODES || textLeft === 0;
  };
  const walk = (value: unknown, depth: number) => {
    nodes += 1;
    if (nodes > MAX_NODES) {
      actions.add("truncated-nodes");
      return TRUNCATION_MARKER;
    }
    if (isString(value)) {
      let out = value;
      const stripped = stripControlChars(out);
      if (stripped !== out) {
        actions.add("stripped-control-characters");
        out = stripped;
      }
      const kept = Math.min(out.length, textLeft);
      textLeft -= kept;
      if (kept < out.length) {
        actions.add("truncated-text");
        out = out.slice(0, kept) + TRUNCATION_MARKER;
      }
      return out;
    }
    if (!isObject(value)) return value;
    if (depth >= MAX_DEPTH) {
      actions.add("truncated-depth");
      return TRUNCATION_MARKER;
    }
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      for (const item of value) {
        // Once the budget is spent, replace the rest of the container with one marker,
        // never one marker per remaining element (a million-element array must not become a
        // million markers; the cap exists to bound output, not merely to blank content).
        if (exhausted()) {
          out.push(TRUNCATION_MARKER);
          break;
        }
        out.push(walk(item, depth + 1));
      }
      return out;
    }
    // `Object.fromEntries` defines own properties, so a model-authored "__proto__" key stays an
    // entry in the Judge's input; `out[key] = v` would call the Object.prototype setter instead
    // and drop it. Keys that collide once sanitized (two keys differing only in stripped
    // characters) are renamed with the marker, so both values stay visible.
    const entries: [string, unknown][] = [];
    const taken = new Set<string>();
    const freeKey = (key: string): string => {
      let target = key;
      while (taken.has(target)) {
        actions.add("renamed-colliding-key");
        target = `${target}${TRUNCATION_MARKER}`;
      }
      taken.add(target);
      return target;
    };
    for (const [key, item] of Object.entries(value)) {
      if (exhausted()) {
        entries.push([freeKey(TRUNCATION_MARKER), TRUNCATION_MARKER]);
        break;
      }
      const cleanKey = walk(key, depth + 1);
      entries.push([freeKey(isString(cleanKey) ? cleanKey : key), walk(item, depth + 1)]);
    }
    return Object.fromEntries(entries);
  };
  const value = walk(input, 0);
  return {
    value,
    version: SANITIZER_VERSION,
    modified: actions.size > 0,
    actions: [...actions].sort(),
  };
}

import { capturedJsonParse } from "../meta/json-runtime.ts";
import { isObject, isString, type JsonValue, typeName } from "../meta/json-shape.ts";

/** The one word a leaf value is recorded as. An empty string is its own category because a
 *  draft that wrote one is the shape this summary exists to make visible. */
function leafCategory(value: JsonValue): string {
  if (!isString(value)) return typeName(value);
  return value.trim() === "" ? "empty-string" : "string";
}

/** A bounded shape summary of a draft artifact for the F2 finding: paths and value categories,
 *  at most twelve parts, never the values themselves. */
export function boundedDraftSummary(artifactJson: string | null): string {
  if (artifactJson === null) return "no-bytes";
  let parsed: JsonValue;
  try {
    parsed = capturedJsonParse(artifactJson);
  } catch {
    return "unparseable";
  }
  const parts: string[] = [];
  const walk = (value: JsonValue, path: string): void => {
    if (parts.length >= 12) return;
    if (Array.isArray(value)) {
      parts.push(`${path}:array(${value.length})`);
      const first = value[0];
      if (first !== undefined) walk(first, `${path}[0]`);
      return;
    }
    if (isObject(value)) {
      for (const [key, child] of Object.entries(value)) {
        walk(child, path === "$" ? `$.${key}` : `${path}.${key}`);
      }
      return;
    }
    const category = leafCategory(value);
    parts.push(`${path}:${category}`);
  };
  walk(parsed, "$");
  return parts.join(",");
}

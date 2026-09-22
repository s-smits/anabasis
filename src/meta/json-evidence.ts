import { asRecord, isRecord, type JsonObject } from "./json-shape.ts";

/** Resolve the closed JSON-path grammar shared by authoring checks and truth predicates. */
interface ResolveJsonPathResult {
  found: boolean;
  value: unknown;
}

/** Split the rooted path once; a partial match is never a different valid path. */
export function jsonPathTokens(path: string): string[] | null {
  const tokens = path.match(/^\$|\.[A-Za-z_][A-Za-z0-9_-]*|\[(?:0|[1-9]\d*)\]/g);
  return tokens?.[0] === "$" && tokens.join("") === path ? tokens.slice(1) : null;
}

export function resolveJsonPath(root: unknown, path: string): ResolveJsonPathResult {
  const tokens = jsonPathTokens(path);
  if (tokens === null) return { found: false, value: undefined };
  let value = root;
  for (const token of tokens) {
    if (token.startsWith("[") && Array.isArray(value) && Object.hasOwn(value, token.slice(1, -1))) {
      value = value[Number(token.slice(1, -1))];
    } else if (token.startsWith(".") && isRecord(value) && Object.hasOwn(value, token.slice(1))) {
      value = value[token.slice(1)];
    } else return { found: false, value: undefined };
  }
  return { found: true, value };
}

/** `asRecord`, narrowed to an object with the plain-object prototype: class instances and
 *  prototype-less records are not plain records. */
export function plainRecord(value: unknown): JsonObject | null {
  const record = asRecord(value);
  return record !== null && Object.getPrototypeOf(record) === Object.prototype ? record : null;
}

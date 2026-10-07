import { asRecord, isRecord, type JsonObject } from "./json-shape.ts";

/** Resolve the closed JSON-path grammar shared by authoring checks and truth predicates. */
interface ResolveJsonPathResult {
  found: boolean;
  value: unknown;
}

/** Split the rooted path once; a partial match is never a different valid path. A quoted key,
 *  `['main.cpp']` or `["main.cpp"]`, is the plain step it names, returned as `.main.cpp`: a file
 *  map's keys hold dots, so without it no declared path could name one file, and a check had to
 *  declare the whole map. Tokens are compared whole, so the dot inside that step splits nothing. */
export function jsonPathTokens(path: string): string[] | null {
  const tokens = path.match(/^\$|\.[A-Za-z_][A-Za-z0-9_-]*|\[(?:0|[1-9]\d*)\]|\[(?:'[^'\\]+'|"[^"\\]+")\]/g);
  if (tokens?.[0] !== "$" || tokens.join("") !== path) return null;
  return tokens.slice(1).map((token) => (/^\[['"]/.test(token) ? `.${token.slice(2, -2)}` : token));
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

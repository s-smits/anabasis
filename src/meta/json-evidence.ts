import { isRecord, type JsonValue } from "./json-shape.ts";

interface ResolveJsonPathResult {
  found: boolean;
  value: JsonValue | undefined;
}

const JSON_PATH_TOKEN = /^\$|\.[A-Za-z_][A-Za-z0-9_-]*|\[(?:0|[1-9]\d*)\]|\[(?:'[^'\\]+'|"[^"\\]+")\]/g;
const QUOTED_STEP = /^\[['"]/;

export function jsonPathTokens(path: string): string[] | null {
  const tokens = path.match(JSON_PATH_TOKEN);
  if (tokens?.[0] !== "$" || tokens.join("") !== path) return null;
  return tokens.slice(1).map((token) => (QUOTED_STEP.test(token) ? `.${token.slice(2, -2)}` : token));
}

export function resolveJsonPath(root: JsonValue, path: string): ResolveJsonPathResult {
  const tokens = jsonPathTokens(path);
  if (tokens === null) return { found: false, value: undefined };
  let value: JsonValue | undefined = root;
  for (const token of tokens) {
    if (token.startsWith("[") && Array.isArray(value) && Object.hasOwn(value, token.slice(1, -1))) {
      value = value[Number(token.slice(1, -1))];
    } else if (token.startsWith(".") && isRecord(value) && Object.hasOwn(value, token.slice(1))) {
      value = value[token.slice(1)];
    } else return { found: false, value: undefined };
  }
  return { found: true, value };
}

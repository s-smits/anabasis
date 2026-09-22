/** Shared parsing of pasted OAuth responses: raw code, full redirect URL, or `code#state` pair. */
import { keyIfNotNull } from "../../meta/optional-key.ts";
type ParsedAuthorization = {
  code?: string;
  state?: string;
};

export function parseAuthorizationInput(input: string): ParsedAuthorization {
  const value = input.trim();
  if (!value) return {};

  try {
    const url = new URL(value);
    const parsed: ParsedAuthorization = {
      ...keyIfNotNull("code", url.searchParams.get("code")),
      ...keyIfNotNull("state", url.searchParams.get("state")),
    };
    return parsed;
  } catch {
    // not a URL
  }

  if (value.includes("#")) {
    const [rawCode, rawState] = value.split("#", 2);
    const parsed: ParsedAuthorization = {};
    if (rawCode !== undefined && rawCode !== "") parsed.code = rawCode;
    if (rawState !== undefined && rawState !== "") parsed.state = rawState;
    return parsed;
  }

  if (value.includes("code=")) {
    const params = new URLSearchParams(value);
    const parsed: ParsedAuthorization = {
      ...keyIfNotNull("code", params.get("code")),
      ...keyIfNotNull("state", params.get("state")),
    };
    return parsed;
  }

  return { code: value };
}

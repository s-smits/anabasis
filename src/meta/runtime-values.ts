import { isString } from "./json-shape.ts";
import { runtimeProcess } from "./process.ts";

export type RuntimePlatform = typeof runtimeProcess.platform;

export type RuntimeSignal = NonNullable<Bun.Subprocess["signalCode"]>;

/** The `code` of a caught cause, when it carries one as a string. The parameter is the rule-exempt
 *  `cause`: this helper exists only at catch boundaries over values the language types `unknown`. */
export function errorCode(cause: unknown): string | undefined {
  return cause instanceof Error && "code" in cause && isString(cause.code) ? cause.code : undefined;
}

/** The operator text of a caught cause: an Error's message, otherwise the value spelled out. */
export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** A caught cause as an Error, for the callers that must keep a stack or a `cause` chain rather
 *  than only its text. An Error passes through, so the original stack survives. */
export function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(errorMessage(cause));
}

declare global {
  interface ObjectConstructor {
    /** A record with no prototype, for keys a model authored: on a plain `{}`, `out["__proto__"]`
     *  reads Object.prototype and a write to it no-ops through the inherited setter, so a tally
     *  keyed by check id would silently drop exactly that id. The library types it `any`; an object
     *  with no prototype and no own properties is an empty record, which the declared type of the
     *  variable it initialises then widens. */
    create(o: null): Record<never, never>;
  }
}

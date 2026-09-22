import { isString } from "./json-shape.ts";
import { runtimeProcess } from "./process.ts";

export type RuntimePlatform = typeof runtimeProcess.platform;

export type RuntimeSignal = NonNullable<Bun.Subprocess["signalCode"]>;

/** The `code` of a caught cause, when it carries one as a string. */
export function errorCode(cause: unknown): string | undefined {
  return cause instanceof Error && "code" in cause && isString(cause.code) ? cause.code : undefined;
}

/** The operator text of a caught cause: an Error's message, otherwise the value spelled out. */
export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** A caught cause as an Error; an Error passes through, so its stack survives. */
export function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(errorMessage(cause));
}

declare global {
  interface ObjectConstructor {
    /** A record with no prototype, for model-authored keys: on a plain `{}` a `__proto__` key
     *  would be silently dropped. Typed as an empty record rather than the library's `any`. */
    create(o: null): Record<never, never>;
  }
}

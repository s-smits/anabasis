import { isString } from "./json-shape.ts";
import type { runtimeProcess } from "./process.ts";

export type RuntimePlatform = typeof runtimeProcess.platform;

export type RuntimeSignal = NonNullable<Bun.Subprocess["signalCode"]>;

export function errorCode(cause: unknown): string | undefined {
  return cause instanceof Error && "code" in cause && isString(cause.code) ? cause.code : undefined;
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function asError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(errorMessage(cause));
}

declare global {
  interface ObjectConstructor {
    // oxlint-disable-next-line typescript/method-signature-style -- an overload merged into the library's `ObjectConstructor`, which a property would redeclare
    create(o: null): Record<never, never>;
  }
}

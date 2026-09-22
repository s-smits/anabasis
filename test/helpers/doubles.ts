import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentSession } from "../../src/backends/backend-types.ts";
import type { HostSession, PiTool } from "../../src/backends/pi-session.ts";
import { type JsonValue, isString } from "../../src/meta/json-shape.ts";

/** A hand-written roster tool: its name and execute, and any of the label, description and schema
 *  a real tool carries when the case reads one. Its result is whatever JSON the case returns. */
type ToolDoubleSpec = Pick<AgentTool, "name"> &
  Partial<Pick<AgentTool, "label" | "description" | "parameters">> & {
    execute: (toolCallId: string, args: never, signal?: AbortSignal) => Promise<JsonValue>;
  };

/** The session id every scripted host session reports, which a transcript names. */
export const SCRIPTED_SESSION_ID = "pi-scripted-session";

/**
 * A stand-in for a production contract the test does not construct.
 *
 * Tests drive injected interfaces — `build`, `drive`, `analyse`, a generated tool's `execute` — whose
 * contracts are large controller records. A test that asserts on three of their fields used to
 * write `as never`, which bypasses the check by asserting an impossible type. `double(...)`
 * states what the fixture intends — the value carries the fields the code
 * under test reads on this path, and the rest of the contract is deliberately absent.
 *
 * It lives in test/ and has no production caller. Production code must never receive a partial
 * record it did not build, which is the difference between a double and a defect.
 */
// The parameter is `unknown` because a double stands in for any contract; a narrower source type
// cannot be asserted to an unconstrained `T` in one step, and a chained assertion is banned.
// The one parameter this rule cannot ask to prove anything: a double stands in for every
// contract, so a narrower source type could not reach an unconstrained `T`.
export function double<T>(value: unknown): T {
  // SAFETY: test-only. The value is written in the test beside the assertions that read it, so a
  // field the code under test needs and the double omits fails that test at the read.
  return value as T;
}

/**
 * A recorded JSON value the test reads as text.
 *
 * `String(value)` renders an object as `[object Object]`, so an assertion built on it passes on
 * the wrong recorded shape as readily as the right one — and a `toContain` over `[object Object]`
 * fails with no sign of why. This refuses at the read and names what it got instead.
 */
export function text(value: unknown): string {
  if (!isString(value)) throw new Error(`expected text, got ${JSON.stringify(value)}`);
  return value;
}

/**
 * Read a value the driven path always supplies but the type leaves optional.
 *
 * A test that knows the controller passes `adoptDir` on every build call used to write
 * `options?.adoptDir as string`, which asserts the absence away. This throws instead, naming the
 * value at the read rather than letting an absence surface later as `undefined`.
 */
export function required<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`${what} is absent`);
  return value;
}

/**
 * The error a promise rejected with, so a test can assert on it without annotating a callback
 * parameter the promise contract leaves open. A fulfilled promise and a non-`Error` rejection are
 * both fixture faults, and each fails here rather than at the assertion below the call.
 */
export async function rejectionOf(work: Promise<unknown>): Promise<Error> {
  try {
    await work;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`expected an Error rejection, got ${String(error)}`, { cause: error });
  }
  throw new Error("expected a rejection, but the promise settled");
}

/** A roster tool double. The fields the case leaves out take plain values nothing asserts on. */
export function toolDouble(spec: ToolDoubleSpec): PiTool {
  return double<PiTool>({ label: spec.name, description: "", parameters: { type: "object" }, ...spec });
}

/**
 * The scripted host session a test opens, of which only `runTurn` ever differs.
 *
 * Seventy-five sites wrote the same members out by hand, in four spellings, and the ones besides
 * `runTurn` never varied: the backend name the evidence records, an empty dispose and a
 * configure nothing reads. Pass `onDispose` or `onConfigure` in the few cases that count one.
 */
export function scriptedSession(
  runTurn: AgentSession["runTurn"],
  onDispose: () => void | Promise<void> = () => {},
  onConfigure: HostSession["configure"] = () => {},
): HostSession {
  return {
    backend: "claude",
    sessionId: SCRIPTED_SESSION_ID,
    runTurn,
    configure: onConfigure,
    dispose: async () => {
      await onDispose();
    },
  };
}

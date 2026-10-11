/**
 * A solve's trace as its readers page it: every tool call by number, and any one call whole. The
 * Diagnoser and the Builder read this one view and nothing wider. It is built from the solver's own
 * events (`solve.call`); a verdict's checks and the Referee's reasons share the log and never enter.
 */
import type { LogEvent } from "../kernel/log.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { isString, type JsonObject } from "../meta/json-shape.ts";

/** One read of a call's result: the Referee's window on a check program, a third as wide, since a
 *  reader pages several calls where it reads one program. */
const READ_WINDOW = 4_000;
/** diagnosis-reader.ts:46-60, the excerpt's cap, kept for a call's arguments. */
const ARGUMENTS_CHARS = 1_200;

export const stringOf = (value: unknown) => (isString(value) ? value : "");
export const solveOf = (events: readonly LogEvent[], solve: string) =>
  events.filter((event) => event.data.solve === solve);
export const callsOf = (events: readonly LogEvent[]) =>
  events.flatMap((event) => (event.kind === "solve.call" ? [event.data] : []));
export const turnsOf = (events: readonly LogEvent[]) =>
  events.flatMap((event) => (event.kind === "solve.turn" ? [event.data] : []));
/** What a solver last said in words: the text of its last turn that held any. */
export const closingOf = (events: readonly LogEvent[]) =>
  turnsOf(events)
    .map((turn) => stringOf(turn.text))
    .findLast((said) => said !== "");

/** Every call of a solve: its number, its tool and whether it failed. */
export function callList(calls: readonly JsonObject[]): string {
  return (
    calls
      .map(
        (call, index) =>
          `${String(index + 1)} ${stringOf(call.tool)}${call.isError === true ? " failed" : ""}`,
      )
      .join("\n") || "no tool call recorded"
  );
}

/** Call `number` whole: its arguments and up to 4000 characters of its result starting at `from`. */
export function callText(calls: readonly JsonObject[], number: number, from: number): string {
  const call = calls[Math.floor(number) - 1];
  if (call === undefined) throw new Error(`the solve recorded ${String(calls.length)} tool calls`);
  const said = stringOf(call.text);
  const start = Math.floor(from);
  const window = said.slice(start, start + READ_WINDOW);
  const rest = said.length - start - window.length;
  return [
    `call ${String(Math.floor(number))} ${call.isError === true ? "failed" : "completed"} ${stringOf(call.tool)}`,
    `arguments: ${capturedJsonStringify(call.args ?? null).slice(0, ARGUMENTS_CHARS)}`,
    `result: ${window || "(no result recorded)"}${rest > 0 ? `\n[${String(rest)} more characters from ${String(start + window.length)}]` : ""}`,
  ].join("\n");
}

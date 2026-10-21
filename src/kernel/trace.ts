/**
 * A model's trace as the log holds it, and as its readers page it: every turn, tool call and
 * compaction of a solve or of a session, each under its seat's prefix (`solve.turn`, `build.call`,
 * `exam.compacted`), as `traceSink` and `loopCompaction` write them (`src/solve/run.ts`).
 *
 * Until 21 October nine readers took these events apart for themselves: the dollars of a session
 * that never ended, the last turn of a solve, the Builder's `read_trace`, the campaign page's
 * turns, calls and call counts, the pulse's failed turns and the whole-run reader's lanes. Each
 * spelled the kinds, the field that names whose a trace is and the price of a usage again, and two
 * of them read a solve's calls from its last start, a guard that held nothing: no solve id in the
 * 76 logs of that day was started twice. Here an event is read once into a typed record.
 *
 * The Builder reads a practice solve's calls through `callList` and `callText` and nothing wider;
 * a verdict's checks and the Referee's reasons share the log and never enter a trace.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import {
  asRecord,
  isBoolean,
  isNumber,
  isString,
  type JsonObject,
  type JsonValue,
} from "../meta/json-shape.ts";
import type { LogEvent } from "./log.ts";

/** Each seat whose trace the log holds, in the order a stopped run's open sessions are ended
 *  (`unfinished`, `src/kernel/reports.ts`). `repair` is a seat a log of before 11 October holds
 *  (`7f0add79:docs/simplify.md`). */
export const SEATS = ["build", "exam", "draft", "repair", "solve"] as const;
export type Seat = (typeof SEATS)[number];

/** Where an event of a trace stands, and whose it is. */
interface Mark {
  readonly index: number;
  readonly at: string;
  readonly seat: Seat;
  readonly id: string;
}

/** One model turn: what it said in words, why it stopped, and its price where the usage holds one. */
export interface Turn extends Mark {
  readonly part: "turn";
  readonly turn: number | null;
  readonly text: string;
  readonly stopReason: string | null;
  readonly error: string | null;
  readonly usage: JsonObject | null;
  readonly billed: number | null;
}

/** One tool call: its tool, its arguments, its result's text and how long it ran. */
export interface Call extends Mark {
  readonly part: "call";
  readonly turn: number | null;
  readonly tool: string;
  readonly args: JsonValue;
  readonly isError: boolean;
  readonly text: string;
  readonly ms: number | null;
}

/** One compaction, and what its summaries were billed. */
export interface Compaction extends Mark {
  readonly part: "compacted";
  readonly billed: number;
}

export type Traced = Turn | Call | Compaction;

/** One read of a call's result: the Referee's window on a check program, a third as wide, since a
 *  reader pages several calls where it reads one program. */
const READ_WINDOW = 4_000;
/** The cap on a call's arguments as a reader pages them (v1's diagnosis-reader.ts:46-60). */
const ARGUMENTS_CHARS = 1_200;

/** The field that names whose a seat's trace is. */
export const whose = (seat: Seat) => (seat === "solve" ? "solve" : "session");

/** The kind seat `seat` logs part `part` under. */
export const traceKind = (seat: Seat, part: Traced["part"]) => `${seat}.${part}` as const;

/** The backend's price of one usage, `cost.total`, or null where it holds none. */
function costOf(usage: JsonValue | undefined): number | null {
  const total = asRecord(asRecord(usage)?.cost)?.total;
  return isNumber(total) ? total : null;
}

const textOf = (value: JsonValue | undefined) => (isString(value) ? value : "");
const orNull = <T>(value: JsonValue | undefined, is: (value: unknown) => value is T) =>
  is(value) ? value : null;

/** Event `event`, at `index` in its log, read as a part of a trace; null for any other event. */
export function traced({ kind, at, data }: LogEvent, index: number): Traced | null {
  const [prefix, part] = kind.split(".");
  const seat = SEATS.find((each) => each === prefix);
  if (seat === undefined) return null;
  const mark = { index, at, seat, id: textOf(data[whose(seat)]) };
  if (part === "turn") {
    const { usage, turn, text, stopReason, error } = data;
    return {
      ...mark,
      part,
      turn: orNull(turn, isNumber),
      text: textOf(text),
      stopReason: orNull(stopReason, isString),
      error: orNull(error, isString),
      usage: asRecord(usage),
      billed: costOf(usage),
    };
  }
  if (part === "call") {
    const { turn, tool, args, isError, text, ms } = data;
    const call = { turn: orNull(turn, isNumber), tool: textOf(tool), args: args ?? null };
    return {
      ...mark,
      part,
      ...call,
      isError: isBoolean(isError) && isError,
      text: textOf(text),
      ms: orNull(ms, isNumber),
    };
  }
  if (part !== "compacted") return null;
  const usages = Array.isArray(data.usages) ? data.usages : [];
  return { ...mark, part, billed: usages.reduce<number>((sum, usage) => sum + (costOf(usage) ?? 0), 0) };
}

/** Every part of every trace in `events`, in the order logged. */
export function tracesIn(events: readonly LogEvent[]): Traced[] {
  return events.flatMap((event, index) => {
    const found = traced(event, index);
    return found === null ? [] : [found];
  });
}

/** The turns and the calls of seat `seat`'s solve or session `id`, in the order logged. */
export function traceOf(events: readonly LogEvent[], seat: Seat, id: string) {
  const own = tracesIn(events).filter((each) => each.seat === seat && each.id === id);
  return {
    turns: own.filter((each): each is Turn => each.part === "turn"),
    calls: own.filter((each): each is Call => each.part === "call"),
  };
}

/** What a solver last said in words: the text of its last turn that held any. */
export const closingOf = (turns: readonly Turn[]) =>
  turns.map(({ text }) => text).findLast((said) => said !== "");

/** Every call of a solve: its number, its tool and whether it failed. */
export function callList(calls: readonly Call[]): string {
  return (
    calls
      .map((call, index) => `${String(index + 1)} ${call.tool}${call.isError ? " failed" : ""}`)
      .join("\n") || "no tool call recorded"
  );
}

/** Call `number` whole: its arguments and up to 4000 characters of its result starting at `from`. */
export function callText(calls: readonly Call[], number: number, from: number): string {
  const call = calls[Math.floor(number) - 1];
  if (call === undefined) throw new Error(`the solve recorded ${String(calls.length)} tool calls`);
  const start = Math.floor(from);
  const window = call.text.slice(start, start + READ_WINDOW);
  const rest = call.text.length - start - window.length;
  return [
    `call ${String(Math.floor(number))} ${call.isError ? "failed" : "completed"} ${call.tool}`,
    `arguments: ${capturedJsonStringify(call.args).slice(0, ARGUMENTS_CHARS)}`,
    `result: ${window || "(no result recorded)"}${rest > 0 ? `\n[${String(rest)} more characters from ${String(start + window.length)}]` : ""}`,
  ].join("\n");
}

/**
 * A model's trace as the log holds it, and as its readers page it: every turn, tool call and
 * compaction of a solve or of a session, each under its seat's prefix (`solve.turn`, `build.call`,
 * `exam.compacted`), as `traceSink` and `sit` write them (`src/agent/session.ts`).
 *
 * Until 21 October nine readers took these events apart for themselves: the dollars of a session
 * that never ended, the last turn of a solve, the Builder's `read_trace`, the campaign page's
 * turns, calls and call counts, the pulse's failed turns and the whole-run reader's lanes. Each
 * spelled the kinds, the field that names whose a trace is and the price of a usage again, and two
 * of them read a solve's calls from its last start, a guard that held nothing: no solve id in the
 * 76 logs of that day was started twice. Here an event is read once into a typed record.
 *
 * The Builder reads a practice solve's calls through `callList` and `callText` and nothing wider;
 * a verdict's checks and the Referee's reasons share the log and never enter a practice trace.
 * Until 27 October the list named each call's tool alone and a call was read in windows of 4,000
 * characters. Over the 297 Builder sessions on record (8 to 26 October), 955 single-call reads
 * opened a median of 2 calls a solve, 893 of them bash calls the list showed only as "bash", and
 * 139 reads were cut at the window while 9 paged on. The list now shows each call's arguments and
 * size, and a call comes back whole: the seat tool's own cap spills a longer one to a file.
 * The same records bill completed and unfinished sessions. `costLine` checks that bill against the
 * backend's own totals on the endings that carry one.
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
import { plural } from "../meta/text.ts";
import type { LogEvent } from "./log.ts";

/** Each seat whose trace the log holds, in the order a stopped run's open sessions are ended
 *  (`unfinished`, `src/kernel/reports.ts`). `repair` is a seat a log of before 11 October holds
 *  (`7f0add79:docs/simplify.md`). */
export const SEATS = ["build", "exam", "draft", "repair", "referee", "solve"] as const;
export type Seat = (typeof SEATS)[number];

/** A session or a solve that began and has no end on record: what kind of start and its id, the
 *  dollars its turns and compactions metered, its turns, and when it began and wrote its last
 *  event (`unfinished`). Whose a solve is, is `ownersOf`'s to say. */
interface Unfinished {
  readonly of: (typeof METERED)[number]["of"];
  readonly id: JsonValue | undefined;
  dollars: number;
  turns: number;
  readonly began: string;
  last: string;
}

/** Whose a solve is (`ownersOf`): the session or comparison, and whether its start names it. */
interface Owner {
  readonly by: string | undefined;
  readonly asked: boolean;
}

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
  /** The model the provider says answered, where it said. */
  readonly model: string | null;
}

/** One tool call: its tool, its arguments, its result's text and how long it ran. */
export interface Call extends Mark {
  readonly part: "call";
  /** The provider's id for the call, which a log of before 21 October does not hold. */
  readonly callId: string | null;
  readonly turn: number | null;
  readonly tool: string;
  readonly args: JsonValue;
  readonly isError: boolean;
  readonly text: string;
  readonly ms: number | null;
}

/** One compaction, and what its summaries were billed. */
interface Compaction extends Mark {
  readonly part: "compacted";
  readonly billed: number;
}

export type Traced = Turn | Call | Compaction;

/** What a call list shows of a call's arguments: about one terminal line. */
const ARGUMENT_HEAD = 100;

const BUILD_FINISHED = "build.finished";

/** The field that names whose a seat's trace is. A Referee's reading is named by its reader's id,
 *  which its `referee.finding` carries too, so the finding ends it (`unfinished`) while the field
 *  `session` stays the Builder's or the Examiner's whose solve was ruled (`ownedBy`). */
const WHOSE = {
  build: "session",
  exam: "session",
  draft: "session",
  repair: "session",
  referee: "reader",
  solve: "solve",
} as const satisfies Record<Seat, string>;
export const whose = (seat: Seat) => WHOSE[seat];

/** Each kind of start whose turns and compactions are billed where no end is on record, with the
 *  field that names the session or the solve in all four events: a Builder's session, an
 *  Examiner's three kinds and a solve attempt. No session opens `repair.*` since 13 October; a log
 *  of before is billed whole. */
const METERED = SEATS.map((of) => ({ of, id: whose(of) }));
/** The events that carry what their own model turns were billed, in a `billed` field: the end of
 *  each of those, and a reviewer's reading. */
export const BILLED: ReadonlySet<string> = new Set([
  ...METERED.map(({ of }) => `${of}.finished`),
  "referee.finding",
  "diagnosis.recorded",
]);

/** The kind seat `seat` logs part `part` under. */
export const traceKind = (seat: Seat, part: Traced["part"]) => `${seat}.${part}` as const;

/** The host's price of one usage, `cost.total`, or null where it holds none. */
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
    const { usage, turn, text, stopReason, error, responseModel } = data;
    return {
      ...mark,
      part,
      turn: orNull(turn, isNumber),
      text: textOf(text),
      stopReason: orNull(stopReason, isString),
      error: orNull(error, isString),
      usage: asRecord(usage),
      billed: costOf(usage),
      model: orNull(responseModel, isString),
    };
  }
  if (part === "call") {
    const { toolCallId, turn, tool, args, isError, text, ms } = data;
    const call = {
      callId: orNull(toolCallId, isString),
      turn: orNull(turn, isNumber),
      tool: textOf(tool),
      args: args ?? null,
    };
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

/** How long a call ran and how long its result is. */
function callSize(call: Call): string {
  const took = call.ms === null ? "" : `, ${(call.ms / 1000).toFixed(1)} s`;
  return `(${plural(call.text.length, "character")}${took})`;
}

/** Every call of a solve: its number, its tool, whether it failed, its size, and its arguments on
 *  one line, a shell call's as the command it ran. */
export function callList(calls: readonly Call[]): string {
  return (
    calls
      .map((call, index) => {
        const command = asRecord(call.args)?.command;
        const said = (isString(command) ? command : capturedJsonStringify(call.args))
          .replaceAll(/\s+/g, " ")
          .trim();
        const line = said.length > ARGUMENT_HEAD ? `${said.slice(0, ARGUMENT_HEAD)}...` : said;
        return `${String(index + 1)} ${call.tool}${call.isError ? " failed" : ""} ${callSize(call)}: ${line}`;
      })
      .join("\n") || "no tool call recorded"
  );
}

/** Call `number` whole: its arguments and its result as the trace keeps them. */
export function callText(calls: readonly Call[], number: number): string {
  const call = calls[Math.floor(number) - 1];
  if (call === undefined) throw new Error(`the solve recorded ${String(calls.length)} tool calls`);
  return [
    `call ${String(Math.floor(number))} ${call.isError ? "failed" : "completed"} ${call.tool} ${callSize(call)}`,
    `arguments: ${capturedJsonStringify(call.args)}`,
    `result: ${call.text || "(no result recorded)"}`,
  ].join("\n");
}

/**
 * The billed dollars a log holds for comparison `id`: every attempt of a solve whose start names
 * it, every reviewer's reading of such a solve, and, where a Builder session ran under the same id
 * (a round), everything billed from that session's start to its end. In a round that is the
 * session's own turns, its practice solves and their reviewers; in a campaign its Builder leads it
 * is also every move the session made. The session's own cap reads its own part (`billedParts`,
 * `halted` in `src/builder/session.ts`). What another comparison or session billed since
 * is not this one's, so a comparison gone on from its log after others ran is held to its own
 * spend. A solve of the comparison with no end on record, killed or still running, is counted by
 * what its turns and compactions have metered so far (`unfinished`); a solve still running is held
 * besides at a cap's reserve, which is what its sum may come to (`src/campaign/round.ts`). A live
 * Builder's turns are counted as they are metered, then replaced by its final sum.
 */
export function billedFor(events: readonly LogEvent[], id: string): number {
  const { span, comparison } = billedSplit(events, id);
  return span + comparison;
}

/** Every billed dollar a log holds, whoever billed it: what a campaign's total budget is held
 *  against (`7f0add79:docs/plan.md`, row F49). A start the log holds no end of was killed before it could
 *  sum its turns, and is billed by what it metered (`unfinished`). */
export function billedAll(events: readonly LogEvent[]): number {
  const summed = events.reduce(
    (sum, { kind, data }) => (BILLED.has(kind) && isNumber(data.billed) ? sum + data.billed : sum),
    0,
  );
  return unfinished(events).reduce((sum, { dollars }) => sum + dollars, summed);
}

/** The backend's own query totals beside the host's bill on the same ending records, the check
 *  that the meter prices what the backend charged. An ending without a total, and a session or a
 *  solve that never ended, are left out of both sides. Recode's three campaigns of October read
 *  backend totals 46 to 54% over the bill while every turn was priced at the requested model, and
 *  buffer's 0.6 to 1.9%, whose turns the requested model served. */
export function costLine(events: readonly LogEvent[]): string {
  let [records, covered, backend, billed] = [0, 0, 0, 0];
  for (const { kind, data } of events) {
    if (!BILLED.has(kind) || !isNumber(data.billed)) continue;
    records += 1;
    if (!isNumber(data.reportedCost)) continue;
    covered += 1;
    backend += data.reportedCost;
    billed += data.billed;
  }
  const off =
    billed > 0 ? ` (${backend >= billed ? "+" : ""}${((backend / billed - 1) * 100).toFixed(1)}%)` : "";
  return `backend $${backend.toFixed(2)} on ${String(covered)} of ${String(records)} ending records, calculated $${billed.toFixed(2)} on the same${off}`;
}

/**
 * The billed dollars of the stretch from event `from` to event `to` (the log's end where none):
 * what the log had billed by `to` less what it had by `from`. A sum over the slice alone billed a
 * session open across its start at its whole sum where it ended, and nothing of one still open at
 * its end: on 14 October recode-151's epoch b-4 read $6.87 where it billed $0.04, the Builder's
 * conversation of three epochs ending inside it.
 */
export function billedBetween(events: readonly LogEvent[], from: number, to = events.length): number {
  return billedAll(events.slice(0, to)) - billedAll(events.slice(0, from));
}

/**
 * Every session and solve that began and never ended on record, with the dollars it metered: the
 * run was killed from outside, so no `finished` event summed them, and the cap and the total read 0
 * for what was spent. A turn's `usage.cost.total` is the host's price of that turn at the model that
 * served it, retried attempts included, and the sum over a session's or a solve's turns is what its
 * end carries as `billed`: equal to five decimals on every session and solve of one campaign of 10
 * October; a Builder session of another, killed at its seventh turn the same day, had metered 0.12
 * dollars that nothing summed. A
 * compaction of pi's loop is billed in the end's sum too, and its summary's price is on its
 * `*.compacted` event (`sit`, `src/agent/session.ts`); a stop and a pause read it too (`tools/runs`).
 */
export function unfinished(events: readonly LogEvent[]): Unfinished[] {
  return METERED.flatMap(({ of, id }) => {
    const ended = new Set(
      events.flatMap(({ kind, data }) =>
        kind === `${of}.finished` || (of === "referee" && kind === "referee.finding") ? [data[id]] : [],
      ),
    );
    const open = new Map<JsonValue | undefined, Unfinished>();
    for (const [index, event] of events.entries()) {
      const { at, kind, data } = event;
      if (
        (kind === `${of}.started` || (of === "referee" && kind === "referee.turn" && !open.has(data[id]))) &&
        !ended.has(data[id])
      ) {
        open.set(data[id], {
          of,
          id: data[id],
          dollars: 0,
          turns: 0,
          began: at,
          last: at,
        });
      }
      const found = open.get(data[id]);
      if (found === undefined) continue;
      found.last = at;
      const part = traced(event, index);
      if (part?.seat !== of || part.part === "call") continue;
      found.dollars += part.billed ?? 0;
      found.turns += part.part === "turn" ? 1 : 0;
    }
    return [...open.values()];
  });
}

/** The Builder's and the Examiner's sessions that began and never ended on record, with what each
 *  billed, its turns and its seconds to its last event: a run of the campaign command stopped from
 *  outside left them, and the next run ends them as killed (`endCut`, `tools/d2/harness-builder.ts`). */
export function cutSessions(events: readonly LogEvent[]) {
  return unfinished(events).flatMap(({ of, id, dollars, turns, began, last }) =>
    (of === "build" || of === "exam") && isString(id)
      ? [{ of, session: id, turns, billed: dollars, seconds: (Date.parse(last) - Date.parse(began)) / 1000 }]
      : [],
  );
}

/**
 * Whose each solve of a log is, by the solve's id: the comparison or Examiner session its start
 * names (`asked`), or else the Builder session open where it started, since a practice solve names
 * nothing and only a Builder makes one. In a campaign its Builder leads, an Examiner session runs
 * beside the Builder's practice, and until 19 October an open one was billed that practice too.
 */
function ownersOf(events: readonly LogEvent[]): Map<string, Owner> {
  const owners = new Map<string, Owner>();
  let open: string | undefined;
  for (const { kind, data } of events) {
    if (kind === "build.started" && isString(data.session)) open = data.session;
    else if (kind === BUILD_FINISHED && data.session === open) open = undefined;
    else if (kind === "solve.started" && isString(data.solve)) {
      const asked = isString(data.comparison);
      owners.set(data.solve, { by: isString(data.comparison) ? data.comparison : open, asked });
    }
  }
  return owners;
}

/**
 * Whether an event is session `id`'s own: not another session's, nor one of a solve that is
 * another's (`ownersOf`). A Builder session's own are its turns, its practice solves and their
 * reviewers; an Examiner session's include the solves it asked for to try a draft task, which name
 * it. In a campaign its Builder leads, the comparisons and the Examiner's sessions run inside the
 * Builder's span, and are theirs.
 */
export function ownedBy(events: readonly LogEvent[], id: string, owners = ownersOf(events)) {
  return ({ data }: LogEvent) => {
    const solve = isString(data.solve) ? owners.get(data.solve) : undefined;
    return !(isString(data.session) && data.session !== id) && (solve === undefined || solve.by === id);
  };
}

/**
 * The same sum in its two parts: what the Builder session under `id` billed of its own
 * (`ownedBy`), and what the comparison under it did. A reader of a round tells them apart
 * (`src/campaign/handover.ts`). A solve with no end on record whose start names the comparison is in
 * the second part (`unfinished`). Until 19 October the first part was everything billed in the
 * session's span, which in a campaign its Builder leads is every move it made, counted again on the
 * moves' own lines: on 19 October buffer-fresh-opus's view put $123.34 on b-4, whose own turns and
 * practice billed $2.65, and its steps summed to $362.92 where the log had billed $199.48.
 */
export function billedParts(events: readonly LogEvent[], id: string) {
  const { session, comparison } = billedSplit(events, id);
  return { session, comparison };
}

/** `billedParts`, with `span`: everything billed from the session's start to its end, whoever
 *  billed it, which a round's comparison holds to its cap (`billedFor`). */
function billedSplit(events: readonly LogEvent[], id: string) {
  const owners = ownersOf(events);
  const mine = ownedBy(events, id, owners);
  const asked = (solve: JsonValue | undefined) => {
    const owner = isString(solve) ? owners.get(solve) : undefined;
    return owner?.asked === true && owner.by === id;
  };
  const at = (kind: string) => events.findIndex((event) => event.kind === kind && event.data.session === id);
  const [opened, closed] = [at("build.started"), at(BUILD_FINISHED)];
  const billed = { session: 0, span: 0, comparison: 0 };
  for (const [index, event] of events.entries()) {
    const { kind, data } = event;
    if (!BILLED.has(kind) || !isNumber(data.billed)) continue;
    const inSession = opened !== -1 && index >= opened && (closed === -1 || index <= closed);
    if (inSession) {
      billed.span += data.billed;
      if (mine(event)) billed.session += data.billed;
    } else if (asked(data.solve)) billed.comparison += data.billed;
  }
  // A start with no end: the session's own turns are in its span; a solve of the comparison is in
  // the comparison's part, and a practice solve of the session in the session's alone, so a killed
  // Builder closed on its turns (`endCut`, `tools/d2/harness-builder.ts`) keeps the practice it was
  // killed in, and its cap reads what it read before.
  for (const { of, id: which, dollars } of unfinished(events)) {
    if (of === "build" && which === id) {
      billed.span += dollars;
      billed.session += dollars;
    } else if (asked(which)) billed.comparison += dollars;
    else if (of === "solve" && isString(which) && owners.get(which)?.by === id) billed.session += dollars;
  }
  return billed;
}

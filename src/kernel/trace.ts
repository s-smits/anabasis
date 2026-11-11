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
 * The same records bill completed and unfinished sessions (`billedAll`, `src/kernel/meter.ts`).
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
import { proposalsOf } from "./history.ts";
import type { LogEvent } from "./log.ts";
import { admissionsOf } from "./task.ts";

/** Each seat whose trace the log holds, in the order a stopped run's open sessions are ended
 *  (`unfinished`, `src/kernel/reports.ts`). */
export const SEATS = ["build", "exam", "draft", "referee", "solve"] as const;
export type Seat = (typeof SEATS)[number];

/** The turns of one session or solve that one model other than its seat's answered (`degradations`). */
export interface Degradation {
  readonly seat: Seat;
  readonly id: string;
  readonly asked: string;
  readonly served: string;
  readonly turns: number;
  readonly first: string;
  readonly last: string;
}

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
  referee: "reader",
  solve: "solve",
} as const satisfies Record<Seat, string>;
export const whose = (seat: Seat) => WHOSE[seat];

/** Each kind of start whose turns and compactions are billed where no end is on record, with the
 *  field that names the session or the solve in all four events: a Builder's session, an
 *  Examiner's two kinds, a Referee's reading and a solve attempt. */
export const METERED = SEATS.map((of) => ({ of, id: whose(of) }));
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

/** The model each session or solve's start asked for, as `provider/model`, by its id; the Referee's
 *  turns have no start, so none is named for them. */
export function askedOf(events: readonly LogEvent[]): Map<string, string> {
  const asked = new Map<string, string>();
  for (const { kind, data } of events) {
    const seat = SEATS.find((each) => kind === `${each}.started`);
    const id = seat === undefined ? undefined : data[whose(seat)];
    if (isString(id) && isString(data.model)) asked.set(id, data.model);
  }
  return asked;
}

/** The turns from `from` on that another model answered than their seat asked for, one row a
 *  session or solve and model served. Every seat's start names the model asked for, as
 *  `provider/model`; the Referee's turns have no start, so they go unread. A dated snapshot reads as
 *  its model's, after an exact match, so a seat that asks for a snapshot is not read as served
 *  another. Seats that asked for claude-opus-5-5 were answered by another model on 7,542 recorded
 *  turns from 20 to 31 October, in seven recode campaigns and two buffer ones: as claude-opus-5 on
 *  all but 24, which claude-opus-4-8 answered. Read by the pulse for each look's
 *  new turns, by the gather for the record it keeps in `data/runs/degradations/` and by the
 *  investigation. */
export function degradations(events: readonly LogEvent[], from = 0): Degradation[] {
  const asked = askedOf(events);
  const rows = new Map<string, Degradation>();
  for (const each of tracesIn(events.slice(from))) {
    const seat = each.part === "turn" ? asked.get(each.id) : undefined;
    if (each.part !== "turn" || each.model === null || seat === undefined) continue;
    const wanted = seat.slice(seat.indexOf("/") + 1);
    if (each.model === wanted || each.model.replace(/-\d{8}$/u, "") === wanted) continue;
    const key = `${each.id}\u0000${each.model}`;
    const was = rows.get(key);
    rows.set(key, {
      seat: each.seat,
      id: each.id,
      asked: seat,
      served: each.model,
      turns: (was?.turns ?? 0) + 1,
      first: was?.first ?? each.at,
      last: each.at,
    });
  }
  return [...rows.values()];
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
 * Every session and solve that began and never ended on record, with the dollars it metered: the
 * run was killed from outside, so no `finished` event summed them, and the cap and the total read 0
 * for what was spent. A turn's `usage.cost.total` is the host's price of that turn at the model that
 * served it, retried attempts included, and the sum over a session's or a solve's turns is what its
 * end carries as `billed`: equal to five decimals on every session and solve of one campaign of 10
 * October; a Builder session of another, killed at its seventh turn the same day, had metered 0.12
 * dollars that nothing summed. A compaction of pi's loop is billed in the end's sum too, and its
 * summary's price is on its `*.compacted` event (`sit`, `src/agent/session.ts`); a stop and a pause
 * read it too (`tools/runs`). It reads the log twice for every seat at once, the ends and then the
 * rest; until 1 November each seat read it twice of its own, which made it most of what the billing
 * folds cost on a long log.
 */
export function unfinished(events: readonly LogEvent[]): Unfinished[] {
  const seats = METERED.map(({ of, id }) => ({
    of,
    id,
    starts: `${of}.started`,
    ends: of === "referee" ? "referee.finding" : `${of}.finished`,
    ended: new Set<JsonValue | undefined>(),
    open: new Map<JsonValue | undefined, Unfinished>(),
  }));
  for (const { kind, data } of events) {
    for (const { id, ends, ended } of seats) if (kind === ends) ended.add(data[id]);
  }
  for (const [index, event] of events.entries()) {
    const { at, kind, data } = event;
    let part: ReturnType<typeof traced> | undefined;
    for (const { of, id, starts, ended, open } of seats) {
      const which = data[id];
      if (
        (kind === starts || (of === "referee" && kind === "referee.turn" && !open.has(which))) &&
        !ended.has(which)
      ) {
        open.set(which, { of, id: which, dollars: 0, turns: 0, began: at, last: at });
      }
      const found = open.get(which);
      if (found === undefined) continue;
      found.last = at;
      part = part === undefined ? traced(event, index) : part;
      if (part?.seat !== of || part.part === "call") continue;
      found.dollars += part.billed ?? 0;
      found.turns += part.part === "turn" ? 1 : 0;
    }
  }
  return seats.flatMap(({ open }) => [...open.values()]);
}

/** Open Builder and Examiner sessions, including drafts, with their recorded spend and duration.
 *  The next run ends these sessions as killed (`endCut`, `tools/d2/harness-builder.ts`), with what
 *  their live counters held where the log can show it (`cutCounts`). */
export function cutSessions(events: readonly LogEvent[]) {
  return unfinished(events).flatMap(({ of, id, dollars, turns, began, last }) =>
    (of === "build" || of === "exam" || of === "draft") && isString(id)
      ? [
          {
            of,
            session: id,
            turns,
            billed: dollars,
            seconds: (Date.parse(last) - Date.parse(began)) / 1000,
            ...cutCounts(events, of, id),
          },
        ]
      : [],
  );
}

/**
 * What a cut session's live counters held, as its ending would have written them. A draft counts
 * each completed `draft_exam` (`desk.tries`, `src/examiner/draft.ts`), and one more where solves
 * naming the session started after the last: a draft with no fault is measured inside its call,
 * which logs nothing until it returns, so a cut there left the put counted live and absent from the
 * calls. On 28 October buffer-fresh-gpt-stackedPR489's d-1 was cut with 9 such solves
 * and no completed call, and read 0 drafts, which `drafting` (`src/campaign/decide.ts`) passes over.
 * An Examiner session holds out and refuses what the task admissions of its proposals decided
 * (`desk.held`, `src/examiner/write.ts`): until 29 October its killed ending held none, so
 * `cutShort` (`src/campaign/ground.ts`) read main0_5_1's x-2, which held a task, as having moved
 * nothing, and the Builder was told it held out 0 tasks.
 */
function cutCounts(events: readonly LogEvent[], of: "build" | "exam" | "draft", id: string) {
  if (of === "draft") {
    const own = events.flatMap(({ kind, data }, at) =>
      data.session === id && kind === "draft.call" && data.tool === "draft_exam" ? [{ at, data }] : [],
    );
    const after = own.at(-1)?.at ?? -1;
    const measuring = events.some(
      ({ kind, data }, at) => at > after && kind === "solve.started" && data.comparison === id,
    );
    return { tries: own.filter(({ data }) => data.isError !== true).length + (measuring ? 1 : 0) };
  }
  if (of === "build") return {};
  const proposed = proposalsOf(events).flatMap(({ session, version }) => (session === id ? [version] : []));
  const gates = admissionsOf(events);
  return {
    proposed: proposed.length,
    held: proposed.filter((version) => gates.get(version) === true),
    refused: proposed.filter((version) => gates.get(version) === false),
  };
}

/**
 * Whose each solve of a log is, by the solve's id: the comparison or Examiner session its start
 * names (`asked`), or else the Builder session open where it started, since a practice solve names
 * nothing and only a Builder makes one. In a campaign its Builder leads, an Examiner session runs
 * beside the Builder's practice, and until 19 October an open one was billed that practice too.
 */
export function ownersOf(events: readonly LogEvent[]): Map<string, Owner> {
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

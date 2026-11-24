/**
 * A model's trace as the log holds it, and as its readers page it: every turn, tool call and
 * compaction of a solve or of a session, each under its seat's prefix (`solve.turn`, `build.call`,
 * `exam.compacted`), as `traceSink` and `sit` write them (`src/agent/session.ts`).
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { plural } from "../meta/text.ts";
import { proposalsOf } from "./history.ts";
import { type EventKind, eventsOf, type LogEvent } from "./log.ts";
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
  readonly of: Seat;
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
  /** The provider's id for the call, which the oldest logs do not hold. */
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
const OWNER_KINDS: readonly EventKind[] = [
  "build.started",
  BUILD_FINISHED,
  "solve.started",
  "referee.finding",
];

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
const SEAT_ENDS: Readonly<Record<Seat, readonly EventKind[]>> = {
  build: ["build.finished"],
  exam: ["exam.finished"],
  draft: ["draft.finished"],
  referee: ["referee.finding", "referee.draft"],
  solve: ["solve.finished"],
};
export const whose = (seat: Seat) => WHOSE[seat];

/** The kind seat `seat` logs part `part` under. */
export const traceKind = (seat: Seat, part: Traced["part"]) => `${seat}.${part}` as const;

const TRACE_KINDS = new Map<string, readonly [Seat, Traced["part"], string]>(
  SEATS.flatMap((seat) =>
    (["turn", "call", "compacted"] as const).map((part) => [`${seat}.${part}`, [seat, part, whose(seat)]]),
  ),
);
const SEAT_START = new Map<EventKind, Seat>(
  SEATS.map((s): [EventKind, Seat] => [s === "referee" ? "referee.turn" : `${s}.started`, s]),
);
const START_KINDS: readonly EventKind[] = [...SEAT_START.keys()].filter((kind) => kind !== "referee.turn");
const TURN_KINDS: readonly EventKind[] = SEATS.filter((s) => s !== "referee").map((s) =>
  traceKind(s, "turn"),
);

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
  const matched = TRACE_KINDS.get(kind);
  if (matched === undefined) return null;
  const [seat, part, field] = matched;
  const mark = { index, at, seat, id: textOf(data[field]) };
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
    return {
      ...mark,
      part,
      callId: orNull(toolCallId, isString),
      turn: orNull(turn, isNumber),
      tool: textOf(tool),
      args: args ?? null,
      isError: isError === true,
      text: textOf(text),
      ms: orNull(ms, isNumber),
    };
  }
  const usages = Array.isArray(data.usages) ? data.usages : [];
  return { ...mark, part, billed: usages.reduce<number>((sum, usage) => sum + (costOf(usage) ?? 0), 0) };
}

/** The model (`provider/model`) each session or solve's start asked for, by its id. */
export function askedOf(events: readonly LogEvent[]): Map<string, string> {
  const asked = new Map<string, string>();
  for (const {
    event: { kind, data },
  } of eventsOf(events, START_KINDS)) {
    const seat = SEAT_START.get(kind);
    const id = seat === undefined ? undefined : data[whose(seat)];
    if (isString(id) && isString(data.model)) asked.set(id, data.model);
  }
  return asked;
}

/** The turns from `from` on that another model answered than their seat asked for, one row a
 *  session or solve and model served. Every seat's start names the model asked for, as
 *  `provider/model`; the Referee's turns have no start, so they go unread. A dated snapshot reads as
 *  its model's, after an exact match, so a seat that asks for a snapshot is not read as served
 *  another, as a backend may answer a request with an older model. Read by the pulse for each look's
 *  new turns, by the gather for the record it keeps in `data/runs/degradations/` and by the
 *  investigation. */
export function degradations(events: readonly LogEvent[], from = 0): Degradation[] {
  const asked = askedOf(events);
  const rows = new Map<string, Degradation>();
  for (const { index, event } of eventsOf(events, TURN_KINDS)) {
    if (index < from) continue;
    const each = traced(event, index);
    if (each?.part !== "turn" || each.model === null) continue;
    const seat = asked.get(each.id);
    if (seat === undefined) continue;
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
  const out: Traced[] = [];
  for (const [index, event] of events.entries()) {
    const found = traced(event, index);
    if (found !== null) out.push(found);
  }
  return out;
}

/** The tool calls of seat `seat` among `traces`, in their order. */
export const callsOf = (traces: readonly Traced[], seat: Seat): Call[] =>
  traces.filter((each): each is Call => each.part === "call" && each.seat === seat);

/** The turns and the calls of seat `seat`'s solve or session `id`, in the order logged. */
export function traceOf(events: readonly LogEvent[], seat: Seat, id: string) {
  const turns: Turn[] = [];
  const calls: Call[] = [];
  const field = whose(seat);
  for (const { index, event } of eventsOf(events, [traceKind(seat, "turn"), traceKind(seat, "call")])) {
    if (event.data[field] !== id) continue;
    const found = traced(event, index);
    if (found?.part === "turn") turns.push(found);
    else if (found?.part === "call") calls.push(found);
  }
  return { turns, calls };
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
 * end carries as `billed`, equal to five decimals where both are on record, so a session killed
 * before its end is billed what it metered rather than nothing. A compaction of pi's loop is billed
 * in the end's sum too, and its
 * summary's price is on its `*.compacted` event (`sit`, `src/agent/session.ts`); a stop and a pause
 * read it too (`tools/runs`). It reads the log twice for every seat at once, the ends and then the
 * rest, rather than twice for each seat, which would be most of what the billing folds cost on a
 * long log.
 */
function openSeats(events: readonly LogEvent[], last: number) {
  let from = last + 1;
  const active = SEATS.flatMap((of) => {
    const id = WHOSE[of];
    const ended = new Set<JsonValue | undefined>();
    for (const kind of SEAT_ENDS[of]) {
      for (const { index, event } of eventsOf(events, kind)) {
        if (index > last) break;
        ended.add(event.data[id]);
      }
    }
    const startKind: EventKind = of === "referee" ? "referee.turn" : `${of}.started`;
    const first = eventsOf(events, startKind).find(
      ({ index, event }) => index <= last && !ended.has(event.data[id]),
    );
    if (first === undefined) return [];
    if (first.index < from) from = first.index;
    return [{ of, id, ended, open: new Map<JsonValue | undefined, Unfinished>() }];
  });
  return { active, from };
}

export function unfinished(events: readonly LogEvent[], upTo = events.length - 1): Unfinished[] {
  const last = Math.min(upTo, events.length - 1);
  if (last < 0) return [];
  const { active, from } = openSeats(events, last);
  if (active.length === 0) return [];
  for (let index = from; index <= last; index += 1) {
    const event = events[index];
    if (event === undefined) continue;
    const { at, kind, data } = event;
    for (const { of, id, ended, open } of active) {
      const which = data[id];
      if (SEAT_START.get(kind) === of && !ended.has(which) && (of !== "referee" || !open.has(which))) {
        open.set(which, { of, id: which, dollars: 0, turns: 0, began: at, last: at });
      }
      const found = open.get(which);
      if (found === undefined) continue;
      found.last = at;
      const part = TRACE_KINDS.has(kind) ? traced(event, index) : null;
      if (part?.seat !== of || part.part === "call") continue;
      found.dollars += part.billed ?? 0;
      if (part.part === "turn") found.turns += 1;
    }
  }
  return active.flatMap(({ open }) => [...open.values()]);
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
 * calls, and a drafting session cut with such solves and no completed call would read 0 drafts,
 * which `drafting` (`src/campaign/decide.ts`) passes over. An Examiner session holds out and
 * refuses what the task admissions of its proposals decided (`desk.held`, `src/examiner/write.ts`),
 * counted here for a killed ending too, so `cutShort` (`src/campaign/ground.ts`) does not read a
 * session that held a task as having moved nothing and tell the Builder it held out 0 tasks.
 */
function cutCounts(events: readonly LogEvent[], of: "build" | "exam" | "draft", id: string) {
  if (of === "draft") {
    const own = eventsOf(events, "draft.call").filter(
      ({ event: { data } }) => data.session === id && data.tool === "draft_exam",
    );
    const after = own.at(-1)?.index ?? -1;
    const measuring = eventsOf(events, "solve.started").some(
      ({ index, event: { data } }) => index > after && data.comparison === id,
    );
    return { tries: own.filter(({ event: { data } }) => data.isError !== true).length + (measuring ? 1 : 0) };
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
 * beside the Builder's practice, and is not billed that practice.
 * A Referee's reading is its solve's owner's, under its reader's id: its turns and calls name the
 * reader alone, and only its finding names the solve.
 */
export function ownersOf(events: readonly LogEvent[]): Map<string, Owner> {
  const owners = new Map<string, Owner>();
  let open: string | undefined;
  for (const { event } of eventsOf(events, OWNER_KINDS)) {
    const { kind, data } = event;
    if (kind === "build.started" && isString(data.session)) open = data.session;
    else if (kind === BUILD_FINISHED && data.session === open) open = undefined;
    else if (kind === "solve.started" && isString(data.solve)) {
      const asked = isString(data.comparison);
      owners.set(data.solve, { by: isString(data.comparison) ? data.comparison : open, asked });
    } else if (kind === "referee.finding" && isString(data.reader) && isString(data.solve)) {
      const owner = owners.get(data.solve);
      if (owner !== undefined) owners.set(data.reader, owner);
    }
  }
  return owners;
}

/**
 * Whether an event is session `id`'s own: not another session's, nor one of a solve that is
 * another's (`ownersOf`). A Builder session's own are its turns, its practice solves and their
 * reviewers; an Examiner session's include the solves it asked for to try a draft task, which name
 * it. In a campaign its Builder leads, the comparisons and the Examiner's sessions run inside the
 * Builder's span, and are theirs, with the Referee's readings of a comparison's solves, so an open
 * Builder is not billed for them. A reading with no finding yet names no solve anywhere, and stays
 * the open session's until it has one.
 */
export function ownedBy(events: readonly LogEvent[], id: string, owners = ownersOf(events)) {
  return ({ data }: LogEvent) => {
    const of = isString(data.solve) ? data.solve : data.reader;
    const solve = isString(of) ? owners.get(of) : undefined;
    return !(isString(data.session) && data.session !== id) && (solve === undefined || solve.by === id);
  };
}

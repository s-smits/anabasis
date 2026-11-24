/**
 * What move 7 reads its rows from: a campaign's plan, and its log read once (`groundOf`).
 */
import { type EventKind, eventsOf, type LogEvent } from "../kernel/log.ts";
import { INTERRUPTED, lastReports, latestBuilt, referenceOf } from "../kernel/reports.ts";
import { isNumber, isString, type JsonObject } from "../meta/json-shape.ts";
import { refusals, supplyOf, type Wanted } from "./admission.ts";

/** What a campaign was set to run by: what move 7 reads beside the log. */
export interface Plan {
  /** The improvement patience (`stopRule`) and supply patience (`roomless`, `decide.ts`):
   *  moves without a gain and readings that left nothing to gain before it ends (`PATIENCE`). */
  readonly patience: number;
  /** Whether the campaign's pack holds a task its log does not. */
  readonly unprepared: boolean;
  /** The practice tasks the campaign is brought to (`--practice`, `tools/d2/prepare.ts`); null
   *  where the caller holds no count, and nothing is released for one. */
  readonly practice: number | null;
  /** The size a comparison is asked for at, as its admission reads it. */
  readonly wanted: Pick<Wanted, "target" | "level" | "solves">;
  /** The operator's reason to go on past the stop rule, or null. */
  readonly pastStop: string | null;
  /** Whether the campaign opened from a prompt: its exam is then drafted, and no pack holds it. */
  readonly prompted: boolean;
  /** The checks the operator's command admits by name (`--admit`). */
  readonly admits: readonly string[];
  /** The dollars left of the campaign's total and the reserve one solve is held at; null for a
   *  campaign with no total, as a rehearsal's, whose seats are paid nothing. */
  readonly left: { readonly dollars: number; readonly reserve: number } | null;
  /** The promotions after which the campaign ends on the operator's word (`--promotions`); null
   *  for no cap. */
  readonly promotions: number | null;
}

/** One comparison as move 7 reads it: where it began, its two harnesses, and its last report with
 *  where it first reported, both null while it has not. */
interface Compared {
  readonly id: string;
  readonly at: number;
  readonly old: string;
  readonly fresh: string;
  readonly report: JsonObject | null;
  readonly reported: number | null;
}

/** A comparison that reported. */
type Reported = Compared & { readonly report: JsonObject; readonly reported: number };

const SESSION_FINISHED_KINDS: readonly EventKind[] = ["build.finished", "exam.finished", "draft.finished"];
const SESSION_TURN_KINDS: readonly EventKind[] = ["build.turn", "exam.turn", "draft.turn"];

/** Every comparison of a log that began, in the order they began; one whose start is on record
 *  twice stands where it last began. An old ladder's readings are no comparison of the table's
 *  (`lastReports`, `src/kernel/reports.ts`). */
export function comparisonsOf(events: readonly LogEvent[]): Compared[] {
  const reports = new Map(lastReports(events).map((report) => [report.session, report]));
  const begun = new Map<string, Compared>();
  for (const { index: at, event } of eventsOf(events, "comparison.started")) {
    const { session, old, fresh, ladder } = event.data;
    if (!isString(session) || !isString(old) || !isString(fresh) || ladder === true) continue;
    const last = reports.get(session);
    begun.set(session, {
      id: session,
      at,
      old,
      fresh,
      report: last?.data ?? null,
      reported: last?.index ?? null,
    });
  }
  return [...begun.values()].toSorted((one, other) => one.at - other.at);
}

/** A session's ending, whatever its seat: each writes `<seat>.finished` with its id, which a
 *  solve's does not name. Reading every seat's ending keeps a crashed draft, or any other seat,
 *  inside the crash rule. */
export const sessionEnded = ({ kind, data }: LogEvent) =>
  kind.endsWith(".finished") && isString(data.session);

/** Whether a session's ending holds tasks it held out: `exam.finished.held` is written whatever
 *  `ended` says. */
export const heldOut = (data: JsonObject) => Array.isArray(data.held) && data.held.length > 0;

/** A session's ending that moved nothing: the provider crashed it or a stop killed it, and it held
 *  out no task. The table's want of room passes it over (`roomless`), and so does the count of
 *  conversations that made no move (`idleOf`). */
export const cutShort = (event: LogEvent) =>
  sessionEnded(event) && INTERRUPTED.has(event.data.ended) && !heldOut(event.data);

/** The sessions in a row, to the log's end and since the campaign last ended, that the provider
 *  failed before they held out a task or changed a harness, with the last one's crash. The table
 *  ends a campaign on its environment after `CRASHES_IN_A_ROW` of them (`decide.ts`) instead of
 *  `no-room`, and the count starts again after that ending. */
export function crashedRun(events: readonly LogEvent[]) {
  const endedAt = eventsOf(events, "campaign.ended").at(-1)?.index ?? -1;
  const waitedAt =
    eventsOf(events, "campaign.waited").findLast(({ event: { data } }) => data.for === "provider")?.index ??
    -1;
  const since = Math.max(endedAt, waitedAt);
  const ended = SESSION_FINISHED_KINDS.flatMap((kind) =>
    eventsOf(events, kind).filter(({ index, event }) => index > since && sessionEnded(event)),
  );
  const crashed = new Set(
    ended.flatMap(({ event: { data } }) => (data.ended === "crashed" ? [data.session] : [])),
  );
  if (crashed.size === 0) return { count: 0, crash: null };
  ended.sort((a, b) => a.index - b.index);
  const firstTurn = new Map<string, number>();
  for (const {
    index,
    event: { data },
  } of SESSION_TURN_KINDS.flatMap((kind) => eventsOf(events, kind))) {
    if (index <= since || !isString(data.session) || isString(data.error) || crashed.has(data.session)) {
      continue;
    }
    const prev = firstTurn.get(data.session);
    if (prev === undefined || index < prev) firstTurn.set(data.session, index);
  }
  const back = Math.max(since, ...firstTurn.values());
  const sessions = ended
    .flatMap(({ index, event }) => (index > back && event.data.ended !== "stopped" ? [event] : []))
    .toReversed();
  const kept = new Set(
    eventsOf(events, "build.checkpoint").flatMap(({ index, event: { data } }) =>
      index > since ? [data.session] : [],
    ),
  );
  const moved = (data: JsonObject) =>
    heldOut(data) ||
    (isNumber(data.tries) && data.tries > 0) ||
    (data.changed === true && (data.ended !== "crashed" || kept.has(data.session)));
  const whole = sessions.findIndex(({ data }) => data.ended !== "crashed" || moved(data));
  const [last] = sessions;
  return {
    count: whole === -1 ? sessions.length : whole,
    crash: last?.data.ended === "crashed" && isString(last.data.crash) ? last.data.crash : null,
  };
}

/** What comparison admission is asked for the plan's next comparison: its size, under what is left
 *  of the campaign's total. */
export const askedOf = (plan: Plan) => ({
  ...plan.wanted,
  cap: plan.left,
  pastStop: plan.pastStop ?? undefined,
});

/**
 * What the table's rows are read from, for a log and its plan: the supply folded once, the codes
 * comparison admission would refuse the next comparison with, the comparisons, the harnesses in question, and
 * the pair's last reading.
 */
export function groundOf(events: readonly LogEvent[], plan: Plan) {
  const supply = supplyOf(events);
  const all = comparisonsOf(events);
  const reports = all.filter((each): each is Reported => each.report !== null && each.reported !== null);
  const reference = referenceOf(events);
  const starter = reports.map(({ report }) => report.starter).find(isString) ?? null;
  const latest = latestBuilt(events);
  const waiting = latest === reference ? null : latest;
  const last = reports.at(-1);
  // With no harness waiting, the reading in question is a starter comparison's, the starter against the
  // reference, where that is the last comparison made: it says whether the tasks leave the
  // reference room before a Builder session is paid for.
  const starterComparison =
    last?.fresh === starter && last.old === reference && starter !== reference ? last : undefined;
  const pair = reports.findLast(({ fresh, old }) => fresh === waiting && old === reference);
  const read = waiting === null ? starterComparison : pair;
  return {
    events,
    plan,
    supply,
    /** The codes comparison admission would refuse the next comparison with (`refusals`). */
    refused: new Set<string>(refusals(supply, askedOf(plan)).map(({ code }) => code)),
    /** Every comparison in the order it began, and those of them that reported. */
    all,
    reports,
    /** The reference harness, null before any comparison or promotion has named it. */
    reference,
    /** The Starter Built Harness, as the reports name it; null before any comparison reported. */
    starter,
    latest,
    /** The harness a session left that is not the reference, which waits to be read against it. */
    waiting,
    /** The last reading of the pair in question: the waiting harness's against the reference, or
     *  with none waiting a starter comparison's; null where the pair has none. */
    read: read === undefined ? null : { ...read, starterComparison: waiting === null },
  };
}

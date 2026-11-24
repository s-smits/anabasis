/**
 * A word the operator leaves for a campaign that runs, as the campaign's log holds it
 * (`campaign.word`, written by `tools/d2/word.ts` and `tools/runs/manage.ts`).
 */
import type { LogEvent } from "../kernel/log.ts";
import { lastReports, referenceOf } from "../kernel/reports.ts";
import { SEATS, traceKind } from "../kernel/trace.ts";
import { isNumber, isString } from "../meta/json-shape.ts";
import { epochsOf, starterIn } from "./climb.ts";

/** The word `runs pause` leaves to let the campaign's open solves finish or hold at an armed
 *  boundary: no further solve or campaign action starts once it holds (`paused`, read by `queued`,
 *  `tools/d2/host.ts`, and `runAction`, `tools/d2/campaign-actions.ts`). No move reads it. */
export const PAUSE = "pause";

/** The events a pause waits for one more of, by the word that names it: `next` is the smallest step
 *  a run completes, a finished solve or a recorded tool call of any seat, and `compacted` a
 *  compaction of any seat's conversation. Words joined by `|` wait for the first of their events. */
const PAUSE_AFTER = {
  next: ["solve.finished", "build.call", "draft.call", "exam.call", "referee.call", "solve.call"],
  compacted: SEATS.map((seat) => traceKind(seat, "compacted")),
  reported: ["comparison.reported"],
  promoted: ["harness.promoted"],
  examined: ["exam.finished"],
  finished: ["build.finished"],
} as const;

/** How long a reached boundary pause holds new actions/solves before expiring if `runs pause` died. */
export const PAUSE_STOP_WINDOW_MS = 180_000;

/** The words a move answers, each by the event that acts on it: a stop by the campaign's ending,
 *  other tasks by the Examiner session's move and a total by the opening it changes. With `PAUSE`
 *  they are every kind `tools/d2/word.ts` and `runs pause` write. A pause is answered by its time
 *  instead (`paused`), and a kind outside both, such as the `cause` an older log may hold, is read
 *  as a word no move answers. */
export const ANSWERED = ["stop", "tasks", "budget"] as const;
export type Answered = (typeof ANSWERED)[number];

/** A word the operator left for the campaign that a move answers, by its place in the log. */
export interface Word {
  readonly at: number;
  readonly word: Answered;
  readonly why: string;
  /** The total budget a `budget` word names, in dollars. */
  readonly dollars: number | null;
}

/** The kinds of event the words `after` names, refused where one names none or joins `next`. */
export function pauseKindsOf(after: string): readonly string[] {
  const words = after.split("|");
  const isWord = (word: string): word is keyof typeof PAUSE_AFTER => Object.hasOwn(PAUSE_AFTER, word);
  if (!words.every(isWord) || (words.length > 1 && words.includes("next"))) {
    throw new Error(`--after takes ${Object.keys(PAUSE_AFTER).join(", ")}, or several but next joined by |`);
  }
  return words.flatMap((word) => PAUSE_AFTER[word]);
}

/** How many events of `kinds` `events` holds. */
export const pauseCountOf = (events: readonly LogEvent[], kinds: readonly string[]): number =>
  events.filter(({ kind }) => kinds.includes(kind)).length;

/** Whether a comparison against the current reference has reported a step whose promotion is not yet on record. */
export function unpromotedStep(events: readonly LogEvent[]): boolean {
  const reports = lastReports(events);
  const reference = referenceOf(events);
  if (reference === null) return false;
  const starter = starterIn(events) ?? reports.map(({ data }) => data.starter).find(isString) ?? null;
  const since = epochsOf(events).at(-1)?.from ?? 0;
  return reports.some(
    ({ index, data }) =>
      index >= since &&
      data.old === reference &&
      isString(data.fresh) &&
      data.fresh !== reference &&
      data.fresh !== starter &&
      data.reading === "step",
  );
}

/** Whether `events` has crossed the armed boundary `(after, base)`, including waiting out an
 *  unpromoted step or unread promotion against the starter when `after === "reported"`. */
export function pausePointReached(events: readonly LogEvent[], after: string, base: number): boolean {
  if (pauseCountOf(events, pauseKindsOf(after)) <= base) return false;
  if (after !== "reported") return true;
  if (unpromotedStep(events)) return false;
  const last = epochsOf(events).at(-1);
  return !(last?.starter_tally === null && last.reference !== "starter");
}

/** Timestamp (ms) when `event` at `index` became active in `events`, or null if its armed boundary
 *  has not yet been crossed. Unparameterized or `next` pauses activate at `event.at`. For bounded
 *  pauses, scans backward over events that can change `pausePointReached` to find the start of the
 *  current contiguous reached suffix so pre-promotion arming latches onto starter confirmation. */
function pauseReachedAt(events: readonly LogEvent[], event: LogEvent, index: number): number | null {
  const { after, base } = event.data;
  if (!isString(after) || after === "next" || !isNumber(base)) return Date.parse(event.at);
  let kinds: readonly string[];
  try {
    kinds = pauseKindsOf(after);
  } catch {
    return Date.parse(event.at);
  }
  if (!pausePointReached(events, after, base)) return null;
  let reachedAt = event.at;
  for (let i = events.length - 1; i > index; i -= 1) {
    const step = events[i];
    if (step === undefined) continue;
    const affects = kinds.includes(step.kind) || (after === "reported" && step.kind === "harness.promoted");
    if (!affects) continue;
    if (!pausePointReached(events.slice(0, i), after, base)) {
      reachedAt = step.at;
      break;
    }
  }
  return Date.parse(reachedAt);
}

/** How long `runs pause --after next` lets the open solves of a campaign whose solves run
 *  `wallSeconds` finish: their limit and a minute to end and be recorded. */
export const pauseWaitMs = (wallSeconds: number): number => wallSeconds * 1000 + 60_000;

/** The newest pause word left since `since` whose boundary (if any) has been reached, or null. */
function latestReachedPause(events: readonly LogEvent[], since: number) {
  for (let i = events.length - 1; i >= since; i -= 1) {
    const event = events[i];
    if (event?.kind !== "campaign.word" || event.data.word !== PAUSE) continue;
    const reached = pauseReachedAt(events, event, i);
    const bounded = isString(event.data.after) && event.data.after !== "next" && isNumber(event.data.base);
    if (reached !== null) return { event, reached, bounded };
  }
  return null;
}

/** The newest active pause left since `since`, where the reading process began, as an older one was
 *  for a process that is gone, an armed boundary pause whose point has not landed is not yet active,
 *  and an abandoned bounded pause whose window expired while events kept landing no longer stands. */
export function pauseSince(events: readonly LogEvent[], since: number): LogEvent | undefined {
  const found = latestReachedPause(events, since);
  if (found === null) return undefined;
  const lastAt = Date.parse(events.at(-1)?.at ?? "");
  return found.bounded && Number.isFinite(lastAt) && lastAt - found.reached >= PAUSE_STOP_WINDOW_MS
    ? undefined
    : found.event;
}

/**
 * Whether a pause holds a campaign's solves or new moves at `now`: one was left since the reading
 * process began (`pauseSince`), its boundary (if any) has been reached, and its hold window has not
 * elapsed so `runs pause`'s stop comes first without deadlocking if the pause process died.
 */
export function paused(
  events: readonly LogEvent[],
  since: number,
  now: number,
  wallSeconds: number,
): boolean {
  const found = latestReachedPause(events, since);
  if (found === null) return false;
  const windowMs = found.bounded ? PAUSE_STOP_WINDOW_MS : pauseWaitMs(wallSeconds) + 60_000;
  return now - found.reached < windowMs;
}

/**
 * The words the operator left that a move answers and none has yet, oldest first. The event that
 * acts on a word names it by its place in the log (`answers`), which is what makes it heard once:
 * a campaign stopped on a word goes on when its command is run again.
 */
export function pendingWords(events: readonly LogEvent[]): Word[] {
  const heard = new Set(
    events.flatMap(({ data }) => (Array.isArray(data.answers) ? data.answers.filter(isNumber) : [])),
  );
  return events.flatMap(({ kind, data }, at) => {
    const word = ANSWERED.find((each) => kind === "campaign.word" && each === data.word);
    return word === undefined || heard.has(at)
      ? []
      : [
          {
            at,
            word,
            why: isString(data.why) ? data.why : "",
            dollars: isNumber(data.dollars) ? data.dollars : null,
          },
        ];
  });
}

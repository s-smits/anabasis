import { CALL_KINDS, type EventKind, eventsOf, type LogEvent } from "../kernel/log.ts";
import { lastReports, referenceOf } from "../kernel/reports.ts";
import { SEATS, traceKind } from "../kernel/trace.ts";
import { isNumber, isString } from "../meta/json-shape.ts";
import { epochsOf, starterIn } from "./climb.ts";

export const PAUSE = "pause";

const PAUSE_AFTER = {
  next: ["solve.finished", ...CALL_KINDS],
  compacted: SEATS.map((seat) => traceKind(seat, "compacted")),
  reported: ["comparison.reported"],
  promoted: ["harness.promoted"],
  examined: ["exam.finished"],
  finished: ["build.finished"],
} as const satisfies Record<string, readonly EventKind[]>;

const ANSWER_KINDS: readonly EventKind[] = ["campaign.ended", "campaign.move", "campaign.opened"];

export const PAUSE_STOP_WINDOW_MS = 180_000;

export const ANSWERED = ["stop", "tasks", "budget"] as const;
export type Answered = (typeof ANSWERED)[number];

export interface ControlSignal {
  readonly at: number;
  readonly word: Answered;
  readonly why: string;
  readonly dollars: number | null;
}

export function pauseKindsOf(after: string): readonly EventKind[] {
  const words = after.split("|");
  const isWord = (word: string): word is keyof typeof PAUSE_AFTER => Object.hasOwn(PAUSE_AFTER, word);
  if (!words.every(isWord) || (words.length > 1 && words.includes("next"))) {
    throw new Error(`--after takes ${Object.keys(PAUSE_AFTER).join(", ")}, or several but next joined by |`);
  }
  return [...new Set(words.flatMap((word) => PAUSE_AFTER[word]))];
}

export const pauseCountOf = (events: readonly LogEvent[], kinds: readonly EventKind[]): number =>
  kinds.reduce((sum, kind) => sum + eventsOf(events, kind).length, 0);

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

export function pausePointReached(events: readonly LogEvent[], after: string, base: number): boolean {
  if (pauseCountOf(events, pauseKindsOf(after)) <= base) return false;
  if (after !== "reported") return true;
  if (unpromotedStep(events)) return false;
  const last = epochsOf(events).at(-1);
  return !(last?.starter_tally === null && last.reference !== "starter");
}

function pauseReachedAt(
  events: readonly LogEvent[],
  event: LogEvent,
  index: number,
): { readonly reached: number; readonly bounded: boolean } | null {
  const { after, base } = event.data;
  if (!isString(after) || after === "next" || !isNumber(base)) {
    return { reached: Date.parse(event.at), bounded: false };
  }
  let kinds: readonly EventKind[];
  try {
    kinds = pauseKindsOf(after);
  } catch {
    return { reached: Date.parse(event.at), bounded: true };
  }
  if (!pausePointReached(events, after, base)) return null;
  let reachedAt = event.at;
  const affectKinds: readonly EventKind[] = after === "reported" ? [...kinds, "harness.promoted"] : kinds;
  for (const step of eventsOf(events, affectKinds).toReversed()) {
    if (step.index <= index) break;
    if (!pausePointReached(events.slice(0, step.index), after, base)) {
      reachedAt = step.event.at;
      break;
    }
  }
  return { reached: Date.parse(reachedAt), bounded: true };
}

export const pauseWaitMs = (wallSeconds: number): number => wallSeconds * 1000 + 60_000;

function latestReachedPause(events: readonly LogEvent[], since: number) {
  for (const { event, index } of eventsOf(events, "campaign.word").toReversed()) {
    if (index < since) break;
    if (event.data.word !== PAUSE) continue;
    const hit = pauseReachedAt(events, event, index);
    if (hit !== null) return { event, ...hit };
  }
  return null;
}

export const boundedPause = (events: readonly LogEvent[], since: number): boolean =>
  latestReachedPause(events, since)?.bounded === true &&
  !pendingSignals(events).some(({ word }) => word === "stop");

export const pauseSince = (events: readonly LogEvent[], since: number): LogEvent | undefined =>
  latestReachedPause(events, since)?.event;

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

export function pendingSignals(events: readonly LogEvent[]): ControlSignal[] {
  const words = eventsOf(events, "campaign.word").flatMap(({ index: at, event: { data } }) => {
    const word = ANSWERED.find((each) => each === data.word);
    return word === undefined
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
  if (words.length === 0) return [];
  const heard = new Set(
    ANSWER_KINDS.flatMap((kind) =>
      eventsOf(events, kind).flatMap(({ event: { data } }) =>
        Array.isArray(data.answers) ? data.answers.filter(isNumber) : [],
      ),
    ),
  );
  return words.filter(({ at }) => !heard.has(at));
}

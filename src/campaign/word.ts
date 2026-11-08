/**
 * A word the operator leaves for a campaign that runs, as the campaign's log holds it
 * (`campaign.word`, written by `tools/d2/word.ts`).
 *
 * A word steers a campaign without stopping the command that runs it (`7f0add79:docs/plan.md`, row F50).
 * It is left while a move runs and read at the next move's boundary, by the table for a stop and
 * for other tasks (`decide.ts`) and by the campaign's command for the budget
 * (`tools/d2/harness-builder.ts`). It changes the move after it and nothing in the one that was
 * running, since a comparison's terms are fixed before its first solve; `PAUSE` holds that move's
 * further solves and changes no term. No seat reads a word or its reason.
 */
import type { LogEvent } from "../kernel/log.ts";
import { isNumber, isString } from "../meta/json-shape.ts";

/** The word `runs pause` leaves to let the campaign's open solves finish: the solve queue starts no
 *  other while it holds (`paused`, read by `queued`, `tools/d2/host.ts`). No move reads it. */
export const PAUSE = "pause";

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

/** How long `runs pause --after next` lets the open solves of a campaign whose solves run
 *  `wallSeconds` finish: their limit and a minute to end and be recorded. */
export const pauseWaitMs = (wallSeconds: number): number => wallSeconds * 1000 + 60_000;

/**
 * Whether a pause holds a campaign's solves at `now`: one was left at or after `since`, the place
 * in the log the reading process began at, since one left before was for the process it stopped;
 * and less than its wait and a minute have passed, so `runs pause`'s stop comes first. Nothing
 * else answers a pause, so one that died before its stop would otherwise hold the campaign for good
 * (landing review, 7 November 2026).
 */
export function paused(
  events: readonly LogEvent[],
  since: number,
  now: number,
  wallSeconds: number,
): boolean {
  return events.some(
    ({ at, kind, data }, place) =>
      place >= since &&
      kind === "campaign.word" &&
      data.word === PAUSE &&
      now - Date.parse(at) < pauseWaitMs(wallSeconds) + 60_000,
  );
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

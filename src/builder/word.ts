/**
 * A word the operator leaves for a campaign that runs, as the campaign's log holds it
 * (`campaign.word`, written by `tools/d2/word.ts`).
 *
 * Until 2026-10-09 the operator could steer a campaign only by running a command, which meant
 * stopping the one that ran (`docs/plan.md`, row F50). A word is left while a move runs and read
 * at the next move's boundary, by the table for a stop and for other tasks (`decide.ts`) and by
 * the campaign's command for the budget (`tools/d2/harness-builder.ts`). It changes the move
 * after it and nothing in the one that was running, since a comparison's terms are fixed before
 * its first solve. No seat reads a word or its reason.
 */
import type { LogEvent } from "../kernel/log.ts";
import { isNumber, isString } from "../meta/json-shape.ts";

/** A word the operator left for the campaign, by its place in the log. */
export interface Word {
  readonly at: number;
  readonly word: string;
  readonly why: string;
  /** The total budget a `budget` word names, in dollars. */
  readonly dollars: number | null;
}

/**
 * The words the operator left that no event has acted on yet, oldest first. The event that acts
 * on a word names it by its place in the log (`answers`), which is what makes it heard once: a
 * campaign stopped on a word goes on when its command is run again.
 */
export function pendingWords(events: readonly LogEvent[]): Word[] {
  const heard = new Set(
    events.flatMap(({ data }) => (Array.isArray(data.answers) ? data.answers.filter(isNumber) : [])),
  );
  return events.flatMap(({ kind, data }, at) =>
    kind === "campaign.word" && isString(data.word) && !heard.has(at)
      ? [
          {
            at,
            word: data.word,
            why: isString(data.why) ? data.why : "",
            dollars: isNumber(data.dollars) ? data.dollars : null,
          },
        ]
      : [],
  );
}

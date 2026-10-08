/**
 * Limits as a log holds them, and when one set leaves a solve more room than another.
 *
 * A campaign's limits are part of its solver's setting (`condition.ts`), so they may be raised
 * between rounds, and a verdict that rests on a limit is then a verdict about the limits it was
 * measured under. One verdict does: `wall-bound`, a task whose only screening fails ended at the
 * wall (`task.ts`). It says the solver ran out of time, under that wall, and nothing of what the
 * solver does with more.
 *
 * `roomier` is the one rule for when such a verdict no longer holds, and it is conservative on
 * purpose. A solve ends `wall-ended` at `wallSeconds` and at nothing else: the turn cap ends it
 * `no-answer`, and a full disk or a shell timeout fails a command inside it (`src/solve/run.ts`).
 * So only a longer wall answers the verdict, and more turns alone do not. The other limits may not
 * tighten beside it. With fewer turns, a shorter shell or a smaller disk, a solve that used to run
 * to the wall may stop earlier for another reason, and the task would return to be admitted on a
 * fail the tighter limit made. More solves at once slow every solve through the load they put on
 * one another, so a longer wall under higher concurrency is not known to be more time. A change of
 * model, effort or host code alone returns nothing either: it is another solver, whose standing
 * restarts by construction (`ladder.ts`), but a task's state is the campaign's and no solver's, and
 * the one lever this names is the wall.
 *
 * It lives apart from `condition.ts` because the task fold reads it, and the log, which
 * `condition.ts` writes through, folds the task states on every append.
 */
import { asRecord, isNumber, type JsonValue } from "../meta/json-shape.ts";
import type { Limits } from "./condition.ts";

/** The limits a log event holds under `value`, or null where it holds none whole. */
export function limitsIn(value: JsonValue | undefined): Limits | null {
  const held = asRecord(value);
  if (held === null) return null;
  const { wallSeconds, turns, shellDefaultSeconds, shellMaxSeconds, concurrency, diskBytes } = held;
  return isNumber(wallSeconds) &&
    isNumber(turns) &&
    isNumber(shellDefaultSeconds) &&
    isNumber(shellMaxSeconds) &&
    isNumber(concurrency) &&
    isNumber(diskBytes)
    ? { wallSeconds, turns, shellDefaultSeconds, shellMaxSeconds, concurrency, diskBytes }
    : null;
}

/** Whether `now` leaves a solve more time than `then` did and no less of anything else: a longer
 *  wall, no fewer turns, no shorter shell, no smaller disk, and no more solves at once. */
export function roomier(now: Limits, then: Limits): boolean {
  return (
    now.wallSeconds > then.wallSeconds &&
    now.turns >= then.turns &&
    now.shellDefaultSeconds >= then.shellDefaultSeconds &&
    now.shellMaxSeconds >= then.shellMaxSeconds &&
    now.diskBytes >= then.diskBytes &&
    now.concurrency <= then.concurrency
  );
}

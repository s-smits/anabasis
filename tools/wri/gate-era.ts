/**
 * An earlier log's gate readings, for the readers that study them (`climb.ts`, `live-seat.ts`).
 */
import { conditionsOf } from "#src/kernel/condition.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { examinerSessions, solvesIn, verdictsOf } from "#src/kernel/solves.ts";
import { objectiveOf } from "#src/kernel/verify.ts";
import { asRecord, isNumber, isString, type JsonObject } from "#src/meta/json-shape.ts";

/** At most three room solves per draft, as an older gate ran them under `try_task`. */
const TRIED = 3;

/** One valid answer of the reference at a task admission. */
interface RoomAnswer {
  readonly turns: number | null;
  readonly seconds: number | null;
  readonly measure: number | null;
}

/** Whether a gate read its draft. An older one refused on fewer than the reference harness's
 *  `TRIED` readings, cut by a limit or never begun for want of the reserve, refused a draft it did not
 *  read, which may be proposed again. A gate that read all three, held its draft, or
 *  refused the package on its shape check, stands, as every gate written now does. */
export function measuredGate(data: JsonObject): boolean {
  const solves = asRecord(data.reference)?.solves;
  return !(
    data.outcome === "refused" &&
    ((isNumber(solves) && solves < TRIED) ||
      (isString(data.reason) && data.reason.endsWith("so it is not measured")))
  );
}

/** Each valid answer the reference harness gave at a task admission after event `from`, by draft version:
 *  the Examiner's solves under `try_task` in older logs, which no comparison counts, with the solver's own turns
 *  each took and the objective the verifier measured of it, null where the log holds none. Read
 *  from a promotion on, they are the new reference's alone, since a reading of comparisons only
 *  tells an Examiner nothing of how few turns its answered drafts took after a promotion. */
export function gateAnswers(events: readonly LogEvent[], from: number): Map<string, RoomAnswer[]> {
  const sessions = examinerSessions(events);
  const conditions = conditionsOf(events);
  const verdicts = verdictsOf(events);
  const answers = new Map<string, RoomAnswer[]>();
  for (const { id, started, start, ending, end, condition } of solvesIn(events)) {
    const version = conditions.get(condition)?.task;
    if (started <= from || !sessions.has(start.comparison) || version === undefined) continue;
    if (ending?.outcome !== "pass") continue;
    answers.set(version, [
      ...(answers.get(version) ?? []),
      {
        turns: isNumber(end?.turns) ? end.turns : null,
        seconds: isNumber(end?.seconds) ? end.seconds : null,
        measure: objectiveOf(verdicts.get(id)?.checker),
      },
    ]);
  }
  return answers;
}

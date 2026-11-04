/**
 * An earlier log's gate readings, for the readers that study them (`climb.ts`, `live-seat.ts`).
 *
 * Until 1 November a gate put each draft to the reference harness's room solves under `try_task`
 * before holding it; since then it reads the package alone (`src/examiner/write.ts`), and a writing
 * session is told none of these readings (4 November). They stay readable here, out of production,
 * since an archived log still holds them.
 */
import { conditionsOf } from "#src/kernel/condition.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { examinerSessions, solvesIn, verdictsOf } from "#src/kernel/solves.ts";
import { asRecord, isNumber, isString, type JsonObject } from "#src/meta/json-shape.ts";

/** At most three room solves per draft, as a gate ran them under `try_task` until 1 November. */
const TRIED = 3;

/** One valid answer of the reference at a task admission. */
interface RoomAnswer {
  readonly turns: number | null;
  readonly seconds: number | null;
  readonly measure: number | null;
}

/** Whether a gate read its draft. Until 1 November one refused on fewer than the reference harness's
 *  `TRIED` readings, cut by a limit or never begun for want of the reserve, refused a draft it did not
 *  read, which may be proposed again (14 October). A gate that read all three, held its draft, or
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
 *  the Examiner's solves under `try_task` until 1 November, which no comparison counts, with the solver's own turns
 *  each took and the objective the verifier measured of it, null where the log holds none. Read
 *  from a promotion on, they are the new reference's alone. Until 16 October an Examiner was told
 *  the turns of comparisons only, and after a promotion its drafts stood in none: main0_5_1's
 *  answered drafts took a median of 4 of the 16 turns, recode-151's 3, and neither was told. */
export function gateAnswers(events: readonly LogEvent[], from: number): Map<string, RoomAnswer[]> {
  const sessions = examinerSessions(events);
  const conditions = conditionsOf(events);
  const verdicts = verdictsOf(events);
  const answers = new Map<string, RoomAnswer[]>();
  for (const { id, started, start, ending, end, condition } of solvesIn(events)) {
    const version = conditions.get(condition)?.task;
    if (started <= from || !sessions.has(start.comparison) || version === undefined) continue;
    if (ending?.outcome !== "pass") continue;
    const checker = verdicts.get(id)?.checker;
    const measure = checker?.kind === "pass" ? (checker.objective ?? null) : null;
    answers.set(version, [
      ...(answers.get(version) ?? []),
      {
        turns: isNumber(end?.turns) ? end.turns : null,
        seconds: isNumber(end?.seconds) ? end.seconds : null,
        measure,
      },
    ]);
  }
  return answers;
}

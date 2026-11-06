/**
 * Whether a harness repeats itself, one row a comparison: on the tasks a side passed in every solve,
 * on how many its solves handed in the same answer, byte for byte.
 *
 *   bun tools/wri/answers.ts <log>
 *
 * A valid answer says a task was answered and nothing of how. Until 5 November no reader looked at two
 * answers together, so a harness whose program prints one answer and a solver that works one out anew
 * read alike. Over the 241 recorded comparisons with at least 6 such tasks a side, the new
 * harness repeated itself more than the reference in 169, less in 34 and as often in 38; in the 28 logs
 * holding both a step and another reading, the gap (new less reference) stood higher at the steps in 23,
 * lower in 4 and level in 1, which a domain cannot carry since each log is its own control. It is a
 * lead and decides nothing: a repeat can be a harness that closed a task's search or one that no longer searches, and
 * the objective reads the same either way (`ANSWER FROM A PROGRAM`, lane 15, says how it was reached).
 *
 * New on 5 November: no script of v1 or before compared answers. The nearest, `harness-task-facts.mjs`
 * of the fourth repository, compared public inputs. An answer may hold what a task hides, so this
 * prints counts only, and compares digests it never keeps.
 */
import { type LogEvent, read } from "#src/kernel/log.ts";
import { lastReports, pairsReported } from "#src/kernel/reports.ts";
import { type Judged, verdictsOf } from "#src/kernel/solves.ts";
import { isString } from "#src/meta/json-shape.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { NO_TRACES, printRows } from "./folds.ts";

interface Repeats {
  same: number;
  of: number;
}

/** One side's solves of one task, as digests, where each was valid and two or more handed one in. */
function allValid(
  solves: readonly string[] | undefined,
  valid: readonly boolean[],
  verdicts: ReadonlyMap<string, Judged>,
): string[] | null {
  const held = (solves ?? []).flatMap((solve) => {
    const answer = verdicts.get(solve)?.answer;
    return answer === undefined ? [] : [hashJsonValue(answer)];
  });
  return held.length >= 2 && held.length === valid.length && valid.every(Boolean) ? held : null;
}

const count = ({ same, of }: Repeats) => `${String(same)} of ${String(of)}`;

function tick(into: Repeats, digests: readonly string[] | null): void {
  if (digests === null) return;
  into.of += 1;
  if (new Set(digests).size === 1) into.same += 1;
}

/** One line a comparison that tallied a task, and one where none did. */
export function answerRows(events: readonly LogEvent[]): string[] {
  const verdicts = verdictsOf(events);
  const rows = lastReports(events).flatMap((report) => {
    const fresh: Repeats = { same: 0, of: 0 };
    const old: Repeats = { same: 0, of: 0 };
    const across: Repeats = { same: 0, of: 0 };
    for (const pair of pairsReported(events, report)) {
      const newer = allValid(pair.solves?.fresh, pair.fresh, verdicts);
      const older = allValid(pair.solves?.old, pair.old, verdicts);
      tick(fresh, newer);
      tick(old, older);
      tick(across, newer === null || older === null ? null : [...newer, ...older]);
    }
    if (fresh.of === 0 && old.of === 0) return [];
    const reading = isString(report.data.reading) ? report.data.reading : "unread";
    return [
      `${report.session} ${reading}: one answer repeated on ${count(fresh)} tasks the new harness passed in every solve, ${count(old)} under the reference; both sides gave one answer on ${count(across)}`,
    ];
  });
  return rows.length === 0 ? ["answers: no comparison tallied a task two sides passed"] : rows;
}

if (import.meta.main) printRows("answers", (log) => answerRows(read(log, NO_TRACES)));

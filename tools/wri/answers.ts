/**
 * Whether a harness repeats itself, one row a comparison: on the tasks a side passed in every solve,
 * on how many its solves handed in the same answer, byte for byte.
 *
 *   bun tools/wri/wri.ts reader answers --log <log>
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
 *
 * Under an objective each row also says on how many tasks a side's solves gave one measure, exactly
 * and within the floor (`gapAgainst`, `compare.ts`), since an answer can differ in bytes where the
 * measure the comparison reads does not. On 6 November a harness of v5's read 0 on the whole answer
 * and 10 of 22 on the measure, so its 2 solves a task were fewer than 2 draws, and only a hand count
 * said so.
 */
import { gapAgainst, type Paired } from "#src/kernel/compare.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { lastReports, pairsReported } from "#src/kernel/reports.ts";
import { type Judged, verdictsOf } from "#src/kernel/solves.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";

interface Repeats {
  same: number;
  of: number;
}

/** A side's tasks with a measure on every solve: how many repeat one exactly, and within the floor. */
interface Measured {
  exact: number;
  near: number;
  of: number;
}

/** How close two measures stand to read as one, past a float's own noise. */
const EXACTLY = 1e-6;

function tickMeasures(into: Measured, pair: Paired, side: "old" | "fresh"): void {
  const measures = pair.objective?.[side].filter(isNumber) ?? [];
  if (measures.length < 2 || measures.length !== pair[side].length) return;
  into.of += 1;
  if (Math.max(...measures) - Math.min(...measures) <= EXACTLY) into.exact += 1;
  if (!gapAgainst(pair, side, [])) into.near += 1;
}

const measuredCount = ({ exact, near, of }: Measured) =>
  `exactly on ${String(exact)} of ${String(of)} and within the floor on ${String(near)} of ${String(of)}`;

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
    const freshMeasured: Measured = { exact: 0, near: 0, of: 0 };
    const oldMeasured: Measured = { exact: 0, near: 0, of: 0 };
    for (const pair of pairsReported(events, report)) {
      tickMeasures(freshMeasured, pair, "fresh");
      tickMeasures(oldMeasured, pair, "old");
      const newer = allValid(pair.solves?.fresh, pair.fresh, verdicts);
      const older = allValid(pair.solves?.old, pair.old, verdicts);
      tick(fresh, newer);
      tick(old, older);
      tick(across, newer === null || older === null ? null : [...newer, ...older]);
    }
    if (fresh.of === 0 && old.of === 0) return [];
    const reading = isString(report.data.reading) ? report.data.reading : "unread";
    const objective =
      freshMeasured.of === 0 && oldMeasured.of === 0
        ? ""
        : `; the objective repeated ${measuredCount(freshMeasured)} under the new harness, ${measuredCount(oldMeasured)} under the reference`;
    return [
      `${report.session} ${reading}: one answer repeated on ${count(fresh)} tasks the new harness passed in every solve, ${count(old)} under the reference; both sides gave one answer on ${count(across)}${objective}`,
    ];
  });
  return rows.length === 0 ? ["answers: no comparison tallied a task two sides passed"] : rows;
}

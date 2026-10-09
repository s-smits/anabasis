/**
 * What the campaign's log holds of the sessions before this one, as a session is told it at its
 * opening: every failed practice solve, and each comparison's tally.
 *
 * A session opens a new conversation, and until 2026-10-09 it opened knowing one thing of the
 * past: each practice task's record under the harness it starts from. The plan keeps one
 * conversation for a campaign (`docs/plan.md`, Phase 5) and names what stands in for it when the
 * conversation is lost: the Builder's notes, the list of failed practice solves, and each
 * comparison's result in aggregate. The notes are v1's (`memory.ts`). The two lists are read
 * here, from the log, and v1 has no counterpart to copy: its Builder wrote the exam, was shown
 * passing traces only, and scored itself.
 *
 * - The fails are every failed practice solve of the campaign on a task this session may still
 *   practise on, in the order they ended. The list only grows: nothing is summarised or dropped,
 *   and `read_trace` opens each (`src/builder/tools.ts`). v1 folded its fails into at most six
 *   issues, and a genuine fail led to a harness change about once in six chances. A fail the
 *   Referee ruled a check defect is left out, since it does not count and is not the Builder's to
 *   build around. The host marks each: repaired once the task has passed twice running under a
 *   later harness, failing again once it has failed under one, and open otherwise.
 * - A comparison is told as its tally and its reading. It names no task: a held-out task is never
 *   shown, and which of them were won is a way to it. That is a few bits a comparison, which the
 *   plan accepts while comparisons are few.
 */
import type { LogEvent } from "../kernel/log.ts";
import { lastReports } from "../kernel/reports.ts";
import { ended, passed, type Ran, ranUnder } from "../kernel/solves.ts";
import { asRecord, isNumber, isString } from "../meta/json-shape.ts";

/** Passes running under a later harness that mark a fail repaired: one solve is weak evidence. */
const REPAIRED_AFTER = 2;
/** A comparison's reading as a Builder is told it. A reading that tallied nothing has none. */
const READ = new Map([
  ["step", "a step"],
  ["no-step", "no step"],
  ["below-starter", "no step: it did not hold against the starting harness of the campaign"],
  ["starter-unread", "a step, not yet read against the starting harness of the campaign"],
]);

/** A harness as a Builder is shown one: the head of its digest. */
export const shortDigest = (digest: string): string => digest.slice(0, 8);

/** Where a failed solve stands now, by the task's later solves under the last other harness to
 *  solve it. */
function standing(fail: Ran & { finished: number }, later: readonly (Ran & { finished: number })[]): string {
  const since = later.filter(
    (solve) => solve.under.task === fail.under.task && solve.finished > fail.finished,
  );
  const last = since.findLast((solve) => solve.under.harness !== fail.under.harness)?.under.harness;
  if (last === undefined) return "open";
  const under = since.flatMap((solve) => (solve.under.harness === last ? [passed(solve)] : []));
  if (under.includes(false)) return `failing again under harness ${shortDigest(last)}`;
  return under.length >= REPAIRED_AFTER
    ? `repaired under harness ${shortDigest(last)}`
    : `open: passed once under harness ${shortDigest(last)}`;
}

/**
 * Every failed practice solve of the campaign on one of `tasks`, a line each, oldest first: the
 * solve's id, its task, the harness it ran under, how it ended, where it stands now and what the
 * Diagnoser read of it. `tasks` maps a task version to the id a Builder knows it by.
 */
export function failsTold(events: readonly LogEvent[], tasks: ReadonlyMap<string, string>): string[] {
  const practice = ended(
    ranUnder(events).filter(
      ({ under, start }) => under.side === "test" && tasks.has(under.task) && start.comparison === undefined,
    ),
  ).filter((solve) => passed(solve) !== null);
  const last = (kind: string, solve: string) =>
    events.findLast((event) => event.kind === kind && event.data.solve === solve)?.data;
  return practice.flatMap((solve) => {
    if (passed(solve) !== false || last("referee.finding", solve.id)?.ruling === "check-defect") return [];
    const kind = solve.ending?.kind;
    const read = last("diagnosis.recorded", solve.id);
    const { owner, confidence, cause } = read ?? {};
    const diagnosis =
      isString(owner) && isString(confidence) && isString(cause)
        ? ` Diagnosis (owner ${owner}, confidence ${confidence}): ${cause}`
        : read === undefined
          ? ""
          : " The Diagnoser abstained.";
    return [
      `- ${solve.id}, ${tasks.get(solve.under.task) ?? ""}, harness ${shortDigest(solve.under.harness)}: fail${isString(kind) ? ` (${kind})` : ""}; ${standing(solve, practice)}.${diagnosis}`,
    ];
  });
}

/**
 * Every comparison of the campaign that tallied a task, a line each, oldest first: the harness
 * that was measured, the tally and the reading. No task is named and no count but the tally's.
 */
export function comparisonsTold(events: readonly LogEvent[]): string[] {
  return lastReports(events).flatMap(({ data }) => {
    const tally = asRecord(data.scored);
    const reading = READ.get(isString(data.reading) ? data.reading : "");
    if (tally === null || reading === undefined || !isString(data.fresh)) return [];
    const { wins, losses, ties } = tally;
    if (!isNumber(wins) || !isNumber(losses) || !isNumber(ties)) return [];
    return [
      `- Harness ${shortDigest(data.fresh)} against the reference harness: ${String(wins)} won, ${String(losses)} lost, ${String(ties)} tied, which reads ${reading}.`,
    ];
  });
}

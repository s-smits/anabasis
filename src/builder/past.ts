/**
 * What a session is told of the campaign before it, at its opening: every failed practice solve
 * on a task it may practise on, and each comparison's tally.
 *
 * A session opens a new conversation. The plan keeps one conversation for a campaign
 * (`docs/plan.md`, Phase 5) and names what stands in for it when the conversation is lost: the
 * Builder's notes (`memory.ts`), the list of failed practice solves, and each comparison's result
 * in aggregate.
 *
 * Nothing is read from the log here. The two lists are the campaign's one reading
 * (`campaignOf`, `handover.ts`) through the Builder's filter, so that what a Builder is told and
 * what the operator's view prints are the same rows. Until 2026-10-09 this file folded the log
 * for itself, which is how v1's four readers of one test set began.
 *
 * The filter is what the wall allows (`AGENTS.md`, section 1):
 *
 * - A fail is told whole, with its standing, where its task is one of the session's practice
 *   tasks. The list only grows: nothing is summarised or dropped, and
 *   `read_trace` opens each (`tools.ts`). v1 folded its fails into at most six issues, and a
 *   genuine fail led to a harness change about once in six chances.
 * - A comparison is told as its tally and its reading, and only once it has tallied a task. It
 *   names no task, no share of valid answers, no ruling and no cost: a held-out task is never
 *   shown, and which of them were won is a way to it. That is a few bits a comparison, which the
 *   plan accepts while comparisons are few. The line says how many tasks the tally is over, which
 *   is the tally's own sum. It names the two harnesses, and the turns each solve was held to
 *   where they were limited: since 2026-10-09 a campaign's reference changes at a promotion and
 *   its budget by a rule, and a list that said "the reference harness" of each line set tallies
 *   against two references and under two limits side by side as if they were one series. On
 *   that day one campaign's five comparisons were two against the starter and three against its
 *   first harness, the last of them under five turns. Both are the build side's own facts: a
 *   harness the Builder made or started from, and a limit its practice solves are told too. Until 2026-10-09 it gave the three counts with no unit, and the first
 *   live Builder to be told one (Sonnet 5.5 at high, told "0 won, 0 lost, 5 tied") wrote in its
 *   note that its harness had tied "on all 5 comparisons so far", of which the log held one.
 */
import { plural } from "../meta/text.ts";
import type { Handover, PracticeFail } from "./handover.ts";

/** A comparison's reading as a Builder is told it. A reading that tallied nothing has none. The
 *  last two are readings a comparison made until 2026-10-11, which a log of before holds. */
const READ = new Map([
  ["step", "a step"],
  ["no-step", "no step"],
  ["regressed", "no step: it lost more than it won on tasks earlier comparisons had used up"],
  ["narrow", "no step yet: every task it won or lost was of one kind"],
  ["below-starter", "no step: it did not hold against the starting harness of the campaign"],
  ["starter-unread", "a step, not yet read against the starting harness of the campaign"],
]);

/** A harness as a Builder is shown one: the head of its digest. */
export const shortDigest = (digest: string): string => digest.slice(0, 8);

/** Where a fail stands, in a Builder's words. */
function stands({ standing, under }: PracticeFail): string {
  if (standing === "open" || under === null) return "open";
  const harness = `under harness ${shortDigest(under)}`;
  if (standing === "passed-once") return `open: passed once ${harness}`;
  return standing === "repaired" ? `repaired ${harness}` : `failing again ${harness}`;
}

/**
 * The campaign's failed practice solves on one of `tasks`, a line each, oldest first: the solve's
 * id, its task, the harness it ran under, how it ended and where it stands now. `tasks` maps a
 * task version to the id a Builder knows it by. Until 11 October the line ended with a
 * Diagnoser's reading of the fail; 20 of 20 named the solver (`docs/simplify.md`, E1).
 */
export function failsTold(fails: readonly PracticeFail[], tasks: ReadonlyMap<string, string>): string[] {
  return fails.flatMap((fail) => {
    const task = tasks.get(fail.task);
    if (task === undefined) return [];
    return [
      `- ${fail.solve}, ${task}, harness ${shortDigest(fail.harness)}: fail${fail.kind === null ? "" : ` (${fail.kind})`}; ${stands(fail)}.`,
    ];
  });
}

/**
 * Every comparison of the campaign that tallied a task, a line each, oldest first: the harness
 * that was measured, the tally with the number of tasks it is over, and the reading. No task is
 * named and no count but the tally's.
 */
export function comparisonsTold(steps: readonly Handover[]): string[] {
  return steps.flatMap((step) => {
    const reading = step.step === "comparison" ? READ.get(step.reading ?? "") : undefined;
    if (step.step !== "comparison" || step.tally === null || reading === undefined) return [];
    const { wins, losses, ties } = step.tally;
    const held =
      step.modelTurns === null
        ? ""
        : `, each solve held to ${plural(step.modelTurns, "turn")} of the solver's`;
    return [
      `- Harness ${shortDigest(step.fresh)} against harness ${shortDigest(step.old)}, one comparison over ${plural(wins + losses + ties, "task")}${held}: ${String(wins)} won, ${String(losses)} lost, ${String(ties)} tied, which reads ${reading}.`,
    ];
  });
}

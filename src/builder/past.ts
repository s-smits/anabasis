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
 * - A fail is told whole, with its standing and the Diagnoser's reading, where its task is one of
 *   the session's practice tasks. The list only grows: nothing is summarised or dropped, and
 *   `read_trace` opens each (`tools.ts`). v1 folded its fails into at most six issues, and a
 *   genuine fail led to a harness change about once in six chances.
 * - A comparison is told as its tally and its reading, and only once it has tallied a task. It
 *   names no task, no share of valid answers, no ruling and no cost: a held-out task is never
 *   shown, and which of them were won is a way to it. That is a few bits a comparison, which the
 *   plan accepts while comparisons are few.
 */
import type { Handover, PracticeFail } from "./handover.ts";

/** A comparison's reading as a Builder is told it. A reading that tallied nothing has none. */
const READ = new Map([
  ["step", "a step"],
  ["no-step", "no step"],
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
 * id, its task, the harness it ran under, how it ended, where it stands now and what the Diagnoser
 * read of it. `tasks` maps a task version to the id a Builder knows it by.
 */
export function failsTold(fails: readonly PracticeFail[], tasks: ReadonlyMap<string, string>): string[] {
  return fails.flatMap((fail) => {
    const task = tasks.get(fail.task);
    if (task === undefined) return [];
    const { diagnosis: read } = fail;
    const diagnosis =
      read === null
        ? ""
        : read === "abstained"
          ? " The Diagnoser abstained."
          : ` Diagnosis (owner ${read.owner}, confidence ${read.confidence}): ${read.cause}`;
    return [
      `- ${fail.solve}, ${task}, harness ${shortDigest(fail.harness)}: fail${fail.kind === null ? "" : ` (${fail.kind})`}; ${stands(fail)}.${diagnosis}`,
    ];
  });
}

/**
 * Every comparison of the campaign that tallied a task, a line each, oldest first: the harness
 * that was measured, the tally and the reading. No task is named and no count but the tally's.
 */
export function comparisonsTold(steps: readonly Handover[]): string[] {
  return steps.flatMap((step) => {
    const reading = step.step === "comparison" ? READ.get(step.reading ?? "") : undefined;
    if (step.step !== "comparison" || step.tally === null || reading === undefined) return [];
    const { wins, losses, ties } = step.tally;
    return [
      `- Harness ${shortDigest(step.fresh)} against the reference harness: ${String(wins)} won, ${String(losses)} lost, ${String(ties)} tied, which reads ${reading}.`,
    ];
  });
}

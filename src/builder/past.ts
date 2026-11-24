/**
 * Builder-visible history projections (`failsTold`, `comparisonsTold`), filtered from the single
 * campaign fold (`campaignOf`, `src/campaign/handover.ts`) in accordance with the evaluation wall
 * (`AGENTS.md` section 1): every failed practice solve on released tasks, and aggregate tallies
 * and readings for comparisons that tallied at least one task (naming no held-out task).
 */
import { plural } from "../meta/text.ts";
import type { Campaign, Handover, PracticeFail } from "../campaign/handover.ts";
import { short } from "../campaign/move.ts";
import type { Built } from "./session.ts";

/** A comparison's reading as a Builder is told it. A reading that tallied nothing has none. The
 *  last two are readings only the oldest logs hold. */
const READ = new Map([
  ["step", "a step"],
  ["no-step", "no step"],
  ["regressed", "no step: it lost more than it won on tasks earlier comparisons had used up"],
  ["narrow", "no step yet: every task it won or lost was of one kind"],
  ["below-starter", "no step: it did not hold against the starting harness of the campaign"],
  ["starter-unread", "a step, not yet read against the starting harness of the campaign"],
]);

/** How a Builder session ended, in a Builder's words (`endedBy`, `session.ts`). */
const ENDED = new Map<string, string>(
  Object.entries({
    finished: "ended at its finish",
    wall: "ended at its time limit",
    turns: "ended at its turn limit",
    crashed: "crashed: its conversation was lost to a provider or host error",
    // A stop and a pause end a session so (`endCut`, `tools/d2/harness-builder.ts`).
    killed: "was cut when the run stopped, so only its notes and the harness above remain",
    stopped: "was stopped as the campaign's run ended",
  } satisfies Record<Built["ended"], string>),
);

/** Where a fail stands, in a Builder's words. */
function stands({ standing, under }: PracticeFail): string {
  if (standing === "open" || under === null) return "open";
  const harness = `under harness ${short(under)}`;
  if (standing === "passed-once") return `open: passed once ${harness}`;
  return standing === "repaired" ? `repaired ${harness}` : `failing again ${harness}`;
}

/**
 * The campaign's failed practice solves on one of `tasks`, a line each, oldest first: the solve's
 * id, its task, the harness it ran under, how it ended and where it stands now. `tasks` maps a
 * task version to the id a Builder knows it by.
 */
export function failsTold(fails: readonly PracticeFail[], tasks: ReadonlyMap<string, string>): string[] {
  return fails.flatMap((fail) => {
    const task = tasks.get(fail.task);
    if (task === undefined) return [];
    return [
      `- ${fail.solve}, ${task}, harness ${short(fail.harness)}: fail${fail.kind === null ? "" : ` (${fail.kind})`}; ${stands(fail)}.`,
    ];
  });
}

/**
 * Every comparison of the campaign that tallied a task, a line each, oldest first: the harness
 * that was measured, the tally with the number of tasks it is over, the reading, and how many of
 * those tasks validity differed on where the report's pairs can be read. No task is named.
 */
export function comparisonsTold(steps: readonly Handover[]): string[] {
  return steps.flatMap((step) => {
    const reading = step.step === "comparison" ? READ.get(step.reading ?? "") : undefined;
    if (step.step !== "comparison" || step.tally === null || reading === undefined) return [];
    const { wins, losses, ties } = step.tally;
    const tasks = plural(wins + losses + ties, "task");
    const held =
      step.modelTurns === null
        ? ""
        : `, each solve held to ${plural(step.modelTurns, "turn")} of the solver's`;
    const validity =
      step.validity === null
        ? ""
        : ` Validity differed on ${step.validity === 0 ? "none" : String(step.validity)} of the ${tasks}.`;
    return [
      `- Harness ${short(step.fresh)} against harness ${short(step.old)}, one comparison over ${tasks}${held}: ${String(wins)} won, ${String(losses)} lost, ${String(ties)} tied, which reads ${reading}.${validity}`,
    ];
  });
}

/**
 * Where the harness session `id` starts from came from, and how the Builder session before it
 * ended, since a session told the digest alone can start from the starter after a crash and find
 * out only by listing harness/ that its guide is gone.
 */
export function startTold({ steps, reference }: Campaign, digest: string, id: string): string {
  const builders = steps.flatMap((step) => (step.step === "builder" && step.id !== id ? [step] : []));
  const left = builders.findLast(({ harness, changed }) => changed && harness === digest);
  const named = digest === reference ? ", now the reference harness" : "";
  const origin =
    left === undefined
      ? named ||
        ", which no Builder session of this campaign left: the Starter Built Harness unless the operator named another"
      : `, which session ${left.id} left${named}`;
  const otherRef =
    reference === null || reference === digest
      ? ""
      : ` The reference harness is harness ${short(reference)}.`;
  const last = builders.at(-1);
  const ended = last?.ended == null ? "has no ending on record" : (ENDED.get(last.ended) ?? last.ended);
  const kept =
    last !== undefined && last.unfinished !== null && last.unfinished !== digest
      ? ` Its unfinished tree is in kept/${short(last.unfinished)}/.`
      : "";
  return `You start from harness ${short(digest)}${origin}.${otherRef}${last === undefined ? "" : ` The last Builder session, ${last.id}, ${ended}.${kept}`}`;
}

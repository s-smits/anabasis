import { plural } from "../meta/text.ts";
import type { Campaign, Handover, PracticeFail } from "../campaign/summary.ts";
import { short } from "../campaign/move.ts";
import type { Built } from "./session.ts";

const READ = new Map([
  ["step", "a step"],
  ["no-step", "no step"],
  ["regressed", "no step: it lost more than it won on tasks earlier comparisons had used up"],
  ["narrow", "no step yet: every task it won or lost was of one kind"],
  ["below-starter", "no step: it did not hold against the starting harness of the campaign"],
  ["starter-unread", "a step, not yet read against the starting harness of the campaign"],
]);

const ENDED = new Map<string, string>(
  Object.entries({
    finished: "ended at its finish",
    wall: "ended at its time limit",
    turns: "ended at its turn limit",
    crashed: "crashed: its conversation was lost to a provider or host error",
    killed: "was cut when the run stopped, so only its notes and the harness above remain",
    stopped: "was stopped as the campaign's run ended",
  } satisfies Record<Built["ended"], string>),
);

function stands(fail: PracticeFail): string {
  if (fail.standing === "open") return "open";
  const harness = `under harness ${short(fail.under)}`;
  if (fail.standing === "passed-once") return `open: passed once ${harness}`;
  return fail.standing === "repaired" ? `repaired ${harness}` : `failing again ${harness}`;
}

export function formatPracticeFailures(
  fails: readonly PracticeFail[],
  tasks: ReadonlyMap<string, string>,
): string[] {
  return fails.flatMap((fail) => {
    const task = tasks.get(fail.task);
    if (task === undefined) return [];
    return [
      `- ${fail.solve}, ${task}, harness ${short(fail.harness)}: fail${fail.kind === null ? "" : ` (${fail.kind})`}; ${stands(fail)}.`,
    ];
  });
}

export function formatComparisonHistory(steps: readonly Handover[]): string[] {
  return steps.flatMap((step) => {
    if (step.step !== "comparison" || step.tally === null) return [];
    const reading = READ.get(step.reading ?? "");
    if (reading === undefined) return [];
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
    const pace =
      step.means === null
        ? ""
        : ` Mean solve: $${step.means.fresh.billed.toFixed(2)} / ${step.means.fresh.turns.toFixed(1)} turns vs reference $${step.means.old.billed.toFixed(2)} / ${step.means.old.turns.toFixed(1)} turns.`;
    return [
      `- Harness ${short(step.fresh)} against harness ${short(step.old)}, one comparison over ${tasks}${held}: ${String(wins)} won, ${String(losses)} lost, ${String(ties)} tied, which reads ${reading}.${validity}${pace}`,
    ];
  });
}

export function formatSessionStart({ steps, reference }: Campaign, digest: string, id: string): string {
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

/**
 * Which rulings are withheld from both tiers, so that a person's label is made blind (the brief of
 * 11 October, section 8: a label made beside the ruling measures nothing).
 *
 * A solve's ruling is withheld where a label of its rejection is still to come: its task waits for
 * a label as possibly infeasible (`poolOf`, as the supply counts it), or the rejection set
 * its task aside in a comparison nobody has settled (`toLabel`). And it is withheld where its
 * comparison has not reported: until the report lands nothing has said which rejections set a task
 * aside, so nothing has said what a person will be asked to label (review of 11 October).
 *
 * A comparison's rulings by kind are withheld while any one of its rulings is: only a ruling that is
 * not `earned` sets a task aside, so the kinds beside the outcome split would give a withheld ruling
 * away. The page is then told how many rejections were ruled and no kind (`Rulings`). For the same
 * reason the whole-run reader's "SET ASIDE BY SIDE" trigger of such a comparison is left out in
 * both tiers: it counts the rejections that set a task aside under each harness, which names the
 * side of a ruling that is not `earned`; and so are the two triggers that count over every ruling
 * of the log, while any ruling is withheld. A rejection
 * that could merely be labelled one day with `settle.ts --all` is not withheld: with no label on
 * record that would hide every ruling for good, and whether it should is the operator's question.
 */
import { reported, toLabel } from "../../../../src/builder/comparison.ts";
import type { Handover } from "../../../../src/builder/handover.ts";
import { isString } from "../../../../src/meta/json-shape.ts";
import type { Trigger } from "../../../../tools/wri/folds.ts";
import type { Rulings, Withheld } from "../models.ts";
import { awaitingIn, type Log, once, ranIn, reportsIn, solvedIn } from "./folds.ts";

/** The reader's triggers that count over every ruling of the log, a withheld one included: how many
 *  were ruled `earned` with no probe, and how many a replay moved (`tools/wri/read.ts`). */
const OVER_EVERY_RULING: ReadonlySet<string> = new Set([
  "EARNED WITHOUT A PROBE",
  "REPLAY MOVED THE VERDICT",
]);

/** The rejections a person is still to label in a comparison nobody has settled (`toLabel`). */
const unsettledIn = once((log) => {
  const waiting = new Set<string>();
  for (const { session } of reportsIn(log)) {
    if (reported(log.events, session)?.settled !== null) continue;
    for (const solve of toLabel(log.events, session).aside) waiting.add(solve);
  }
  return waiting;
});

/** The solves of comparisons that have not reported, by id. */
const unreportedIn = once((log) => {
  const reports = new Set(reportsIn(log).map(({ session }) => session));
  return new Set(
    [...solvedIn(log).values()].flatMap(({ id, start }) =>
      isString(start.comparison) && !reports.has(start.comparison) ? [id] : [],
    ),
  );
});

/** Why the ruling of solve `solve`, of task version `task`, is held back from both tiers; null
 *  where it is not. */
export function rulingWithheld(log: Log, solve: string, task: string): Withheld {
  if (unreportedIn(log).has(solve)) return "report";
  return awaitingIn(log).has(task) || unsettledIn(log).has(solve) ? "label" : null;
}

/** The rejections a person is still to label in comparisons nobody has settled, counted. */
export const unsettledCount = (log: Log): number => unsettledIn(log).size;

/** Whether any ruling of comparison `id` is withheld: it has not reported, or one of its
 *  rejections' rulings is. */
function anyWithheld(log: Log, id: string): boolean {
  if (reported(log.events, id) === null) return true;
  return ranIn(log).some(
    ({ id: solve, start, ending, under }) =>
      start.comparison === id &&
      ending?.outcome === "fail" &&
      ending.kind === "rejected" &&
      rulingWithheld(log, solve, under.task) !== null,
  );
}

/** A comparison's rulings as the page may see them: by kind while none is withheld, and how many
 *  were ruled otherwise. */
export function rulingsOf(log: Log, step: Extract<Handover, { readonly step: "comparison" }>): Rulings {
  const { rulings: kinds } = step;
  return anyWithheld(log, step.id)
    ? { withheld: true, ruled: kinds.earned + kinds["check-defect"] + kinds.unclear }
    : { withheld: false, kinds };
}

/** Whether any ruling of the log is withheld. */
const someWithheld = once((log) =>
  ranIn(log).some(
    ({ id, ending, under }) =>
      ending?.outcome === "fail" &&
      ending.kind === "rejected" &&
      rulingWithheld(log, id, under.task) !== null,
  ),
);

/** Whether the whole-run reader's trigger may be shown in either tier as far as the rulings go.
 *  Not the count of set-aside rejections by side of a comparison whose rulings are withheld: its
 *  detail opens with the comparison's id (`tools/wri/read.ts`). And not a count over every ruling
 *  of the log while any ruling is withheld, since beside the kinds of the comparisons that are
 *  shown it narrows the withheld ones down. */
export function triggerKeepsRulings(log: Log, { name, detail }: Pick<Trigger, "name" | "detail">): boolean {
  if (OVER_EVERY_RULING.has(name)) return !someWithheld(log);
  if (name !== "SET ASIDE BY SIDE") return true;
  const [id = ""] = detail.split(": ");
  return !anyWithheld(log, id);
}

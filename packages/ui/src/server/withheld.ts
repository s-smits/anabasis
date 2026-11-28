/**
 * Which rulings are withheld from both tiers, so a person's label is made blind. A ruling is
 * withheld where a label of its rejection is still to come (its task waits as possibly infeasible,
 * `poolOf`, or it set its task aside in an unsettled comparison, `toLabel`), and where its
 * comparison has not reported, since nothing has yet said what a person will be asked to label.
 * While any is, the comparison's rulings by kind are too, since only a ruling that is not `earned`
 * sets a task aside (`Rulings`). A rejection that could merely be labelled one day is not withheld,
 * or every ruling would hide for good.
 */
import { toLabel } from "../../../../src/campaign/comparison.ts";
import type { Handover } from "../../../../src/campaign/summary.ts";
import { rejected } from "../../../../src/kernel/solves.ts";
import { isString } from "../../../../src/meta/json-shape.ts";
import type { Rulings, Withheld } from "../models.ts";
import { awaitingIn, type Log, once, ranIn, reportsIn, solvedIn } from "./folds.ts";

const reportedIdsIn = once((log) => new Set(reportsIn(log).map(({ session }) => session)));

/** The rejections a person is still to label in a comparison nobody has settled (`toLabel`). */
const unsettledIn = once((log) => {
  const waiting = new Set<string>();
  for (const { session, data } of reportsIn(log)) {
    if ((data.settled ?? null) !== null) continue;
    for (const solve of toLabel(log.events, session).aside) waiting.add(solve);
  }
  return waiting;
});

const unreportedIn = once((log) => {
  const reports = reportedIdsIn(log);
  return new Set(
    [...solvedIn(log).values()].flatMap(({ id, start }) =>
      isString(start.comparison) && !reports.has(start.comparison) ? [id] : [],
    ),
  );
});

const withheldComparisonsIn = once((log) => {
  const held = new Set<string>();
  const [unreported, awaiting, unsettled] = [unreportedIn(log), awaitingIn(log), unsettledIn(log)];
  for (const { id: solve, start, ending, under } of ranIn(log)) {
    const id = start.comparison;
    if (!isString(id) || held.has(id) || !rejected(ending)) continue;
    if (unreported.has(solve) || awaiting.has(under.task) || unsettled.has(solve)) held.add(id);
  }
  return held;
});

/** Why the ruling of solve `solve`, of task version `task`, is held back from both tiers; null
 *  where it is not. */
export function rulingWithheld(log: Log, solve: string, task: string): Withheld {
  if (unreportedIn(log).has(solve)) return "report";
  return awaitingIn(log).has(task) || unsettledIn(log).has(solve) ? "label" : null;
}

export const unsettledCount = (log: Log): number => unsettledIn(log).size;

export function rulingsOf(log: Log, step: Extract<Handover, { readonly step: "comparison" }>): Rulings {
  const { rulings: kinds } = step;
  return !reportedIdsIn(log).has(step.id) || withheldComparisonsIn(log).has(step.id)
    ? { withheld: true, ruled: kinds["solver-fail"] + kinds["check-defect"] + kinds.unclear }
    : { withheld: false, kinds };
}

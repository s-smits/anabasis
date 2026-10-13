/**
 * `GET /api/solve?key=&id=`: one solve (`solvesIn`, `ranUnder`). Its trace in the default tier only
 * where its task was a practice task when it started and no comparison asked for it
 * (`practiceRan`); its verdict (`verdictsOf`) and its ruling in the exam tier only, and the ruling
 * in neither while it is withheld (`rulingWithheld`, `withheld.ts`).
 */
import { refusedBy } from "../../../../src/kernel/solves.ts";
import { taskSets } from "../../../../src/kernel/task.ts";
import { isNumber, isString } from "../../../../src/meta/json-shape.ts";
import { keyIfDefined } from "../../../../src/meta/optional-key.ts";
import type { Query, SolveDetail } from "../models.ts";
import { type Reading, Unanswerable } from "./context.ts";
import { practiceIn, solvedIn, verdictsIn } from "./folds.ts";
import { campaignAt } from "./logs.ts";
import { examTier, rulingOf, solveRow, solveTrace } from "./trace.ts";
import { rulingWithheld } from "./withheld.ts";

export function solveAnswer(reading: Reading, query: Query<"solve">): SolveDetail {
  const { log, issues } = campaignAt(reading, query.key);
  const solve = solvedIn(log).get(query.id);
  if (solve === undefined) throw new Unanswerable(404, `no solve ${query.id} in this campaign`);
  const { tier } = reading;
  const row = solveRow(log, solve, tier);
  // The task sets as they stood when the solve started: the fold over the log up to its start.
  const then = taskSets(log.events.slice(0, solve.started));
  const practised = then.released.includes(row.task) && practiceIn(log).has(solve.id);
  const exam = examTier(tier);
  const judged = verdictsIn(log).get(solve.id);
  const withheld = rulingWithheld(log, solve.id, row.task);
  const [load] = Array.isArray(solve.start.load) ? solve.start.load : [];
  const verdict =
    judged === undefined
      ? null
      : {
          kind: judged.kind,
          answer: judged.answer ?? null,
          fault: judged.fault,
          refusedBy: [...refusedBy(judged)],
        };
  return {
    tier,
    issues,
    solve: row,
    heldOut: then.held.includes(row.task),
    withheld: row.ending?.outcome === "fail" && row.ending.kind === "rejected" ? withheld : null,
    model: isString(solve.start.model) ? solve.start.model : null,
    effort: isString(solve.start.effort) ? solve.start.effort : null,
    load: isNumber(load) ? load : null,
    ...keyIfDefined("trace", exam || practised ? solveTrace(log, solve.id) : undefined),
    ...keyIfDefined("verdict", exam ? verdict : undefined),
    ...keyIfDefined("ruling", exam && withheld === null ? rulingOf(log, solve.id) : undefined),
  };
}

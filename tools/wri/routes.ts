/**
 * How a side's passes got there, one row a comparison: the median calls a pass, and how many orders of
 * tools its passes took.
 *
 *   bun tools/wri/wri.ts reader routes --log <log>
 *
 * `TOOLS CALLED` counts tools over a harness's solves, and `ANSWER FROM A PROGRAM` opens on a won task
 * reached quickly, so nothing sets a side's passes beside the other's. New on 5 November: no script of v1
 * or before read a solve's calls as a route. Over the largest copy of each of the 237 recorded campaigns,
 * within the 28 logs holding a step and another reading with at least 12 passes a side, the new harness's
 * median calls stood further under the reference's at the steps in 21, less far in 4 and level in 3. The
 * median gap was 3 calls over 168 comparisons that read a step and 1 over 114 others. One log's comparisons
 * are not independent, so each log counts once. It is a lead and decides nothing: fewer calls can be a
 * program that closed a search or a solver that stopped looking.
 */
import type { JsonValue } from "#src/meta/json-shape.ts";
import { median } from "#src/meta/tally.ts";
import { type Index, type Solve, text } from "./folds.ts";

function sideOf(scoring: readonly Solve[], harness: JsonValue | undefined): string {
  const passes = scoring.filter((solve) => solve.harness === harness && solve.outcome === "pass");
  const middle = median(passes.map(({ calls }) => calls.length));
  if (middle === null) return "no pass";
  const routes = new Set(passes.map(({ calls }) => calls.join(" "))).size;
  return `${String(middle)} calls, ${String(routes)} routes in ${String(passes.length)} passes`;
}

/** Each comparison's row, and one line where none holds a solve. Only passes: a miss's calls end early. */
export function routeRows(index: Index): string[] {
  const rows = index.compared.flatMap(({ session, own, scoring }) =>
    scoring.length === 0
      ? []
      : [
          `${session} ${text(own.reading) || "unread"}: new ${sideOf(scoring, own.fresh)}; reference ${sideOf(scoring, own.old)}`,
        ],
  );
  return rows.length === 0 ? ["routes: no comparison holds a solve"] : rows;
}

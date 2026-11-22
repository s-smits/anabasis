/**
 * How a side's passes got there, one row a comparison: the median calls a pass, and how many orders of
 * tools its passes took.
 *
 *   bun tools/wri/wri.ts reader routes --log <log>
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

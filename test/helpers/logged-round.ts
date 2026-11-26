// A comparison's solves as a round logs them, for readers that take each task's outcomes from the
// solves and not the report's counts (`supplyOf`, through `pairsReported`).
import { type Condition, conditionId, settingId } from "../../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../../src/kernel/log.ts";
import type { JsonObject } from "../../src/meta/json-shape.ts";
import { requireJsonValue } from "../../src/meta/stable-json.ts";

type Limits = Condition["limits"];
const LIMITS: Limits = {
  wallSeconds: 7200,
  turns: 24,
  shellDefaultSeconds: 300,
  shellMaxSeconds: 900,
  concurrency: 4,
};
const event = (kind: EventKind, data: JsonObject): LogEvent => ({
  at: "2026-10-09T00:00:00.000Z",
  kind,
  data,
});

export const conditionOf = (task: string, harness: string, more: Partial<Limits> = {}): Condition => ({
  contract: "c1",
  harness,
  task,
  model: "p/m",
  effort: "high",
  prices: { "p/m": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  runtime: {},
  compaction: "off",
  solverTools: harness,
  verifierTools: "t1",
  sandbox: "p1",
  limits: { ...LIMITS, ...more },
  host: "h",
  side: "test",
});

let solveCount = 0;
/**
 * The solves of comparison `session` as `outcomes` spells them ("PF FF": the old valid in its first
 * solve of two, the new in neither), with its report's terms.
 */
export function roundSolves(
  session: string,
  [old, fresh]: readonly [string, string],
  outcomes: Readonly<Record<string, string>>,
  more: Partial<Limits> = {},
) {
  const valid = { old: [0, 0, 0], fresh: [0, 0, 0] };
  const events = Object.entries(outcomes).flatMap(([task, spelled]) =>
    ([old, fresh] as const).flatMap((harness, at) => {
      const own = (spelled.split(" ")[at] ?? "").split("").map((letter) => letter === "P");
      const census = valid[at === 0 ? "old" : "fresh"];
      const answered = own.filter(Boolean).length;
      census[answered] = (census[answered] ?? 0) + 1;
      const condition = conditionOf(task, harness, more);
      const id = conditionId(condition);
      return [
        event("condition.recorded", { id, condition: requireJsonValue(condition) }),
        ...own.flatMap((passed) => {
          solveCount += 1;
          const solve = `s-${String(solveCount)}`;
          const ending = passed ? { outcome: "pass" } : { outcome: "fail", kind: "rejected" };
          return [
            event("solve.started", { solve, condition: id, comparison: session }),
            event("solve.finished", { solve, ending }),
          ];
        }),
      ];
    }),
  );
  const terms = {
    setting: settingId(conditionOf("any", "any", more)),
    solves: 2,
    versions: Object.keys(outcomes),
    valid: { ...valid, informative: { old: valid.old[1] ?? 0, fresh: valid.fresh[1] ?? 0 } },
  };
  return { events, terms };
}

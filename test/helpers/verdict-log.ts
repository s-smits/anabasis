// One invented campaign's verdicts, rulings and checker readings, for the readers of rejections and
// checks (`test/wri-rejections.test.ts`, `test/wri-checks.test.ts`). Each solve is placed where a
// naive join of the log goes wrong: two readings before the frozen one and one after it, a refusal
// by two checks, a refused verdict on a crashed solve, an Examiner rehearsal, a practice rejection,
// two findings of one solve, and a person's label over a ruling.
import { conditionId } from "../../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../../src/kernel/log.ts";
import type { JsonObject } from "../../src/meta/json-shape.ts";
import { keyIfDefined } from "../../src/meta/optional-key.ts";
import { requireJsonValue } from "../../src/meta/stable-json.ts";
import { conditionOf } from "./logged-round.ts";

const REJECTED = { outcome: "fail", kind: "rejected" };
const event = (kind: EventKind, data: JsonObject): LogEvent => ({
  at: "2026-11-10T00:00:00.000Z",
  kind,
  data,
});

/** One solve of `task` under `harness`, ended as `ending`, with a verdict refused by `blocking`. */
function solve(
  id: string,
  {
    task = "v-1",
    harness = "h-new",
    comparison,
    ending,
    blocking = [],
  }: {
    task?: string;
    harness?: string;
    comparison?: string;
    ending: JsonObject;
    blocking?: readonly string[];
  },
): LogEvent[] {
  const condition = conditionOf(task, harness);
  const cid = conditionId(condition);
  return [
    event("condition.recorded", { id: cid, condition: requireJsonValue(condition) }),
    event("solve.started", {
      solve: id,
      condition: cid,
      ...keyIfDefined("comparison", comparison),
    }),
    event("verdict", {
      solve: id,
      task,
      ...(blocking.length === 0 ? { kind: "pass" } : { kind: "fail", blocking: [...blocking] }),
    }),
    event("solve.finished", { solve: id, ending }),
  ];
}

export function verdictCampaign(): LogEvent[] {
  return [
    event("exam.started", { session: "x-1" }),
    event("checker.read", { checks: "p-old", rows: [{ id: "c-a", named: 1, caught: 1 }] }),
    // Judged under the earlier program: counted apart from the frozen one's rows.
    ...solve("e-0", { comparison: "x-1", ending: REJECTED, blocking: ["c-a"] }),
    event("checker.read", {
      checks: "p-new",
      rows: [
        { id: "c-a", named: 2, caught: 2, instrument: "pinned" },
        { id: "c-b", named: 1, caught: 0, instrument: "authored", passed: 3, refused: 1 },
      ],
      controls: 4,
      doNothing: { tasks: 2, rejected: 1 },
    }),
    event("contract.frozen", { contract: "k-1", checks: "p-new" }),
    event("comparison.started", { session: "g-1", fresh: "h-new", old: "h-ref" }),
    // Refused by two checks: counted under each.
    ...solve("s-1", { comparison: "g-1", ending: REJECTED, blocking: ["c-a", "c-b"] }),
    ...solve("s-2", { comparison: "g-1", harness: "h-ref", ending: REJECTED, blocking: ["c-a"] }),
    // Refused, then crashed: no rejection.
    ...solve("s-3", {
      comparison: "g-1",
      ending: { outcome: "non-result", kind: "sandbox-crash" },
      blocking: ["c-b"],
    }),
    ...solve("e-1", { task: "try-1", comparison: "x-1", ending: REJECTED, blocking: ["c-a"] }),
    ...solve("p-1", { ending: REJECTED, blocking: ["c-b"] }),
    event("referee.finding", { solve: "s-1", ruling: "earned", probes: [], turns: 3 }),
    event("referee.finding", {
      solve: "s-1",
      ruling: "check-defect",
      check: "c-b",
      probes: [1],
      probeRows: [
        { id: 1, changes: [{ path: "$.x", value: "2" }], moved: ["c-b"] },
        { id: 2, changes: [], moved: [] },
      ],
    }),
    event("referee.finding", { solve: "s-2", ruling: "check-defect", probes: [1], turns: 2 }),
    event("comparison.reported", { session: "g-1", settled: { labels: { "s-2": "earned" } } }),
    // A later reading at another program: the rows stay the frozen one's.
    event("checker.read", { checks: "p-late", rows: [{ id: "c-z", named: 1, caught: 1 }] }),
  ];
}

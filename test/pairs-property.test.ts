// The pairs a comparison reads from its log (`pairsOf`), over seeded random logs against the
// generator's own record. The generator writes every way a solve can fail to count (another comparison
// or setting, a stronger solver, a non-result, no ending, a mismatched or third harness) and finishes
// solves out of order. The rule: the first `solves` a side started that count; a task short of them is
// short; a disputed task is out on both sides; the reference against itself splits into mirrored halves
// whose count carries over tasks.
import { describe, expect, it } from "bun:test";
import { pairsOf } from "../src/kernel/compare.ts";
import { conditionId, settingId } from "../src/kernel/condition.ts";
import type { EventKind, LogEvent } from "../src/kernel/log.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { conditionOf } from "./helpers/logged-round.ts";

interface Planned {
  readonly id: string;
  readonly task: string;
  readonly harness: string;
  readonly comparison: string | null;
  readonly host: string;
  readonly side: "test" | "strong";
  readonly outcome: "pass" | "fail" | "flagged" | "non-result" | "open";
  readonly opened: "unsaid" | "same" | "other";
  readonly billed: number | null;
  readonly objective: number | null;
}

interface Read {
  readonly old: string;
  readonly fresh: string;
  readonly halves?: "mirrored";
  readonly objective?: { readonly direction: "higher" };
}

const TASKS = ["v0", "v1", "v2"];
const COMPARISON = "c-1";
const SETTING = settingId(conditionOf("v0", "old"));
const COUNTED = new Set(["pass", "fail", "flagged"]);
const ENDINGS: Record<Exclude<Planned["outcome"], "open">, JsonObject> = {
  pass: { outcome: "pass" },
  fail: { outcome: "fail", kind: "rejected" },
  flagged: { outcome: "flagged" },
  "non-result": { outcome: "non-result", kind: "provider" },
};
const READS: readonly Read[] = [
  { old: "old", fresh: "new" },
  { old: "starter", fresh: "new" },
  { old: "old", fresh: "new", halves: "mirrored" },
  { old: "old", fresh: "old", halves: "mirrored" },
  { old: "old", fresh: "new", objective: { direction: "higher" } },
];

const event = (kind: EventKind, data: JsonObject): LogEvent => ({
  at: "2026-10-09T00:00:00.000Z",
  kind,
  data,
});

/** A small seeded generator (a linear congruential one), so every log can be made again from its seed. */
function generator(seed: number) {
  let state = seed;
  const next = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
  const pick = <T>(list: readonly [T, ...T[]]): T => list[Math.floor(next() * list.length)] ?? list[0];
  return { next, pick };
}

function logOf(seed: number) {
  const { next, pick } = generator(seed);
  const planned = Array.from(
    { length: Math.floor(next() * 15) },
    (_, at): Planned => ({
      id: `s-${String(at)}`,
      task: pick(["v0", "v1", "v2"]),
      harness: pick(["old", "old", "new", "new", "starter"]),
      comparison: pick([COMPARISON, COMPARISON, COMPARISON, "c-0", null]),
      host: pick(["h", "h", "h", "h2"]),
      side: pick(["test", "test", "test", "strong"]),
      outcome: pick(["pass", "fail", "pass", "fail", "flagged", "non-result", "open"]),
      opened: pick(["unsaid", "unsaid", "same", "other"]),
      billed: next() < 0.5 ? Math.round(next() * 100) / 10 : null,
      objective: next() < 0.6 ? Math.floor(next() * 20) : null,
    }),
  );
  const disputed = new Set(TASKS.filter(() => next() < 0.2));
  const finish = (solve: Planned): LogEvent[] => {
    if (solve.outcome === "open") return [];
    return [
      event("solve.finished", {
        solve: solve.id,
        ending: ENDINGS[solve.outcome],
        ...keyIfDefined(
          "harness",
          { unsaid: undefined, same: solve.harness, other: "elsewhere" }[solve.opened],
        ),
        ...keyIfDefined("billed", solve.billed ?? undefined),
      }),
      ...(solve.outcome === "pass" && solve.objective !== null
        ? [event("verdict", { solve: solve.id, kind: "pass", objective: solve.objective })]
        : []),
    ];
  };
  const events = TASKS.flatMap((version) => [
    event("task.proposed", { version }),
    event("task.gate", { version, gate: 1, outcome: "passed" }),
  ]);
  const running: Planned[] = [];
  const finishOne = () => {
    const [solve] = running.splice(Math.floor(next() * running.length), 1);
    if (solve !== undefined) events.push(...finish(solve));
  };
  for (const solve of planned) {
    const condition = { ...conditionOf(solve.task, solve.harness), host: solve.host, side: solve.side };
    const id = conditionId(condition);
    events.push(
      event("condition.recorded", { id, condition: requireJsonValue(condition) }),
      event("solve.started", {
        solve: solve.id,
        condition: id,
        ...keyIfDefined("comparison", solve.comparison ?? undefined),
      }),
    );
    running.push(solve);
    while (running.length > 0 && next() < 0.5) finishOne();
  }
  while (running.length > 0) finishOne();
  events.push(...[...disputed].map((version) => event("task.state", { version, state: "disputed" })));
  return { events, planned, disputed };
}

/** The pairs the rule gives on the plan, written from `pairsOf`'s statement and not from its code. */
function expectedOf(planned: readonly Planned[], disputed: ReadonlySet<string>, read: Read, solves: number) {
  const counted = planned.filter(
    (solve) =>
      solve.side === "test" &&
      solve.comparison === COMPARISON &&
      solve.host === "h" &&
      COUNTED.has(solve.outcome) &&
      solve.opened !== "other",
  );
  const short: string[] = [];
  const pairs = TASKS.flatMap((task, place) => {
    if (disputed.has(task)) return [];
    const of = (harness: string) =>
      counted.filter((solve) => solve.task === task && solve.harness === harness);
    // The first and last of every four against the two between, the count carrying on over tasks.
    const offset = read.old === read.fresh ? place * 2 * solves : 0;
    const outer = (at: number) => read.halves === undefined || [0, 3].includes((offset + at) % 4);
    const reference = of(read.old);
    const before = reference.filter((_, at) => outer(at));
    const after = read.old === read.fresh ? reference.filter((_, at) => !outer(at)) : of(read.fresh);
    if (before.length < solves || after.length < solves) {
      short.push(task);
      return [];
    }
    const side = <T>(field: (solve: Planned) => T) => ({
      old: before.slice(0, solves).map(field),
      fresh: after.slice(0, solves).map(field),
    });
    return [
      {
        task,
        ...side((solve) => solve.outcome === "pass"),
        solves: side((solve) => solve.id),
        used: side((solve) => ({ billed: solve.billed })),
        ...keyIfDefined(
          "objective",
          read.objective && {
            ...read.objective,
            ...side((solve) => (solve.outcome === "pass" ? solve.objective : null)),
          },
        ),
      },
    ];
  });
  return { pairs, short, disputed: TASKS.filter((task) => disputed.has(task)) };
}

describe("the pairs a comparison reads from its log", () => {
  it("are the first solves each side started of those that count, over 300 seeded logs and every way of reading them", () => {
    const seen = { pairs: 0, short: 0, disputed: 0, reordered: 0 };
    for (let seed = 1; seed <= 300; seed += 1) {
      const { events, planned, disputed } = logOf(seed);
      for (const read of READS) {
        for (const solves of [1, 2]) {
          const sides = { ...read, setting: SETTING, comparison: COMPARISON };
          const found = pairsOf(events, TASKS, sides, solves);
          expect(found).toEqual(expectedOf(planned, disputed, read, solves));
          seen.pairs += found.pairs.length;
          seen.short += found.short.length;
          seen.disputed += found.disputed.length;
        }
      }
      const finished = events.filter((one) => one.kind === "solve.finished").map((one) => one.data.solve);
      const started = planned.filter((one) => finished.includes(one.id)).map((one) => one.id);
      if (finished.some((id, at) => id !== started[at])) seen.reordered += 1;
    }
    // The logs reach every branch the rule names; a generator that stopped doing so would pass empty.
    for (const count of Object.values(seen)) expect(count).toBeGreaterThan(50);
  });

  it("refuses a task that is not held out, and a harness set against itself without halves", () => {
    const held = [
      event("task.proposed", { version: "v1" }),
      event("task.gate", { version: "v1", gate: 1, outcome: "passed" }),
    ];
    const sides = { old: "old", fresh: "new", setting: SETTING, comparison: COMPARISON };
    for (const [events, version, against, reason] of [
      [[...held, event("task.state", { version: "v1", state: "released" })], "v1", sides, /v1 is released/],
      [[...held, event("task.state", { version: "v1", state: "refused" })], "v1", sides, /v1 is refused/],
      [[event("task.proposed", { version: "v2" })], "v2", sides, /v2 has not passed its gate/],
      [held, "v9", sides, /v9 is not proposed/],
      [held, "v1", { ...sides, fresh: "old" }, /both sides are old/],
    ] as const) {
      expect(() => pairsOf(events, [version], against, 1)).toThrow(reason);
    }
  });
});

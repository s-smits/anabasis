// Calculated accounting and backend query totals cover different sets of work. Reconciliation
// matches terminal records, keeps unreported work unknown and leaves caps and scores unchanged.
import { describe, expect, it } from "bun:test";
import { compared, fixedIn } from "../src/campaign/comparison.ts";
import { affords } from "../src/campaign/opening.ts";
import { type Condition, conditionId, settingId } from "../src/kernel/condition.ts";
import { append, type EventKind, type LogEvent } from "../src/kernel/log.ts";
import { billedAll, billedFor, costAccounts } from "../src/kernel/trace.ts";
import { mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";

const event = (kind: EventKind, data: JsonObject): LogEvent => ({
  at: "2026-10-25T00:00:00Z",
  kind,
  data,
});
const closed = () => [
  event("solve.started", { solve: "s-1", comparison: "g-1" }),
  event("solve.turn", { solve: "s-1", usage: { cost: { total: 90 } } }),
  event("solve.compacted", { solve: "s-1", usages: [{ cost: { total: 3.9648096 } }] }),
  event("solve.finished", { solve: "s-1", billed: 93.9648096, reportedCost: 136.81746535 }),
  event("comparison.reported", { session: "g-1", billed: 900, reportedCost: 999 }),
];
const condition = (task: string, harness: string): Condition => ({
  contract: "c",
  harness,
  task,
  model: "faux/solver",
  effort: "medium",
  prices: { "faux/solver": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  runtime: {},
  compaction: "off",
  solverTools: harness,
  verifierTools: "v",
  sandbox: "wall",
  limits: { wallSeconds: 600, turns: 12, shellDefaultSeconds: 30, shellMaxSeconds: 60, concurrency: 1 },
  host: "host",
  side: "test",
});

describe("cost accounts over recorded work", () => {
  it("matches backend totals to closed calculated costs without comparison aggregates", () => {
    const account = costAccounts(closed());
    expect(account.calculated).toBe(93.9648096);
    expect(account.closed).toEqual({ count: 1, calculated: 93.9648096 });
    expect(account.backend.count).toBe(1);
    expect(account.backend.subtotal).toBe(136.81746535);
    expect(account.backend.calculated).toBe(93.9648096);
    expect(account.backend.residual).toBeCloseTo(42.85265575, 10);
    expect(account.missing).toEqual({ count: 0, calculated: 0 });
    expect(account.open).toEqual({ count: 0, calculated: 0 });
  });

  it("replaces open turns and compactions with their terminal bill exactly once", () => {
    const events = [
      ...closed(),
      event("build.started", { session: "b-1" }),
      event("build.turn", { session: "b-1", usage: { cost: { total: 2 } } }),
      event("build.compacted", { session: "b-1", usages: [{ cost: { total: 0.5 } }] }),
    ];
    const open = costAccounts(events);
    expect(open.calculated).toBeCloseTo(96.4648096, 10);
    expect(open.open).toEqual({ count: 1, calculated: 2.5 });
    expect(open.backend).toEqual(costAccounts(closed()).backend);
    events.push(event("build.finished", { session: "b-1", billed: 2.5, reportedCost: 3 }));
    const ended = costAccounts(events);
    expect(ended.calculated).toBe(open.calculated);
    expect(ended.open).toEqual({ count: 0, calculated: 0 });
    expect(ended.closed.count).toBe(2);
    expect(ended.backend.count).toBe(2);
    expect(ended.backend.subtotal).toBeCloseTo(139.81746535, 10);
    expect(ended.backend.residual).toBeCloseTo(43.35265575, 10);
  });

  it("keeps absent and null backend costs unknown while a genuine zero is covered", () => {
    for (const extra of [{}, { reportedCost: null }]) {
      const missing = [event("exam.finished", { session: "x-1", billed: 4, ...extra })];
      expect(costAccounts(missing)).toMatchObject({
        calculated: 4,
        missing: { count: 1, calculated: 4 },
        backend: { count: 0, subtotal: null, calculated: 0, residual: null },
      });
      const partial = costAccounts([...closed(), ...missing]);
      expect(partial.closed.count).toBe(2);
      expect(partial.missing).toEqual({ count: 1, calculated: 4 });
      expect(partial.backend).toEqual(costAccounts(closed()).backend);
    }
    expect(
      costAccounts([event("draft.finished", { session: "d", billed: 4, reportedCost: 0 })]).backend,
    ).toEqual({ count: 1, subtotal: 0, calculated: 4, residual: -4 });
    expect(costAccounts([]).backend.subtotal).toBeNull();
  });

  it("leaves calculated cap admission and a complete scored comparison unchanged by backend totals", () => {
    const tasks = ["t1", "t2", "t3", "t4"];
    const events = [
      event("campaign.opened", { budget: { dollars: 100, reserve: 10 } }),
      event("comparison.started", {
        session: "g",
        old: "old",
        fresh: "fresh",
        starter: "old",
        setting: settingId(condition("any", "any")),
        solves: 1,
        level: 0.1,
        tasks,
      }),
    ];
    for (const task of tasks) {
      events.push(
        event("task.proposed", { version: task, taskId: task }),
        event("task.gate", { version: task, gate: 1, outcome: "passed" }),
      );
      for (const harness of ["old", "fresh"]) {
        const ran = condition(task, harness);
        const solve = `${task}-${harness}`;
        events.push(
          event("condition.recorded", { id: conditionId(ran), condition: requireJsonValue(ran) }),
          event("solve.started", { solve, comparison: "g", condition: conditionId(ran) }),
          event("solve.turn", { solve, usage: { cost: { total: 1.5 } } }),
          event("solve.compacted", { solve, usages: [{ cost: { total: 0.5 } }] }),
          event("solve.finished", {
            solve,
            billed: 2,
            reportedCost: 3,
            ending: harness === "fresh" ? { outcome: "pass" } : { outcome: "fail", kind: "no-answer" },
          }),
        );
      }
    }
    const changed = events.map((each) =>
      each.kind === "solve.finished" ? { ...each, data: { ...each.data, reportedCost: 1_000_000 } } : each,
    );
    const fixed = fixedIn(events, "g");
    if (fixed === null) throw new Error("fixture has no comparison terms");
    const original = compared(events, fixed, new Map());
    expect(original).toMatchObject({ reading: "step", scored: { wins: 4, losses: 0, ties: 0 } });
    expect(compared(changed, fixed, new Map())).toEqual(original);
    expect(billedAll(changed)).toBe(billedAll(events));
    expect(billedFor(changed, "g")).toBe(billedFor(events, "g"));
    expect(costAccounts(changed).calculated).toBe(16);
    const root = mkdtempSync(join(tmpdir(), "cost-accounts-"));
    try {
      for (const [name, log] of [
        ["original", events],
        ["changed", changed],
      ] as const) {
        const file = join(root, name);
        for (const each of log) append(file, each.kind, each.data);
        expect(affords(file, 8)).toBe(true);
        expect(affords(file, 9)).toBe(false);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

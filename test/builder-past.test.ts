// What a Builder session is told of the sessions before it, folded from a campaign's log: every
// failed practice solve with where it stands now, each comparison's tally and reading with no task
// named, and what a practice solve used of its limits.
import { afterAll, describe, expect, it } from "bun:test";
import { comparisonsTold, failsTold } from "../src/builder/past.ts";
import { usedText } from "../src/builder/tools.ts";
import { type Condition, recordCondition } from "../src/kernel/condition.ts";
import { append, type EventKind, read } from "../src/kernel/log.ts";
import { mkdtempSync, realpathSync, rmSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

const LIMITS = {
  wallSeconds: 480,
  turns: 24,
  shellDefaultSeconds: 120,
  shellMaxSeconds: 240,
  concurrency: 4,
  diskBytes: 1,
};
const [HA, HB, HC] = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
const TASKS = new Map([
  ["v1", "t-1"],
  ["v2", "t-2"],
]);
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-builder-past-")));
let logs = 0;

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A log to which solves are added as the runner logs them. */
function campaign() {
  const log = join(scratch, `log-${String(logs++)}.jsonl`);
  const record = (kind: EventKind, data: JsonObject) => append(log, kind, data);
  let solves = 0;
  const solved = (
    task: string,
    harness: string | undefined,
    outcome: "pass" | "fail",
    comparison?: string,
  ) => {
    const condition: Condition = {
      contract: "c1",
      harness: harness ?? HA,
      task,
      model: "faux/solver",
      effort: "medium",
      prices: { "faux/solver": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
      runtime: {},
      compaction: "off",
      solverTools: "s1",
      verifierTools: "t1",
      sandbox: "p1",
      limits: LIMITS,
      host: "h1",
      side: "test",
    };
    solves += 1;
    const solve = `s-${String(solves)}`;
    record("solve.started", {
      solve,
      condition: recordCondition(log, condition),
      limits: LIMITS,
      ...keyIfDefined("comparison", comparison),
    });
    record("solve.finished", {
      solve,
      ending: outcome === "pass" ? { outcome } : { outcome, kind: "rejected" },
      turns: 14,
      seconds: 222.4,
    });
    return solve;
  };
  return { log, record, solved, events: () => read(log) };
}

describe("the failed practice solves a session is told", () => {
  it("are every fail on its tasks, oldest first, each with where it stands now", () => {
    const c = campaign();
    const open = c.solved("v1", HA, "fail");
    c.record("diagnosis.recorded", {
      solve: open,
      owner: "solver",
      confidence: "low",
      cause: "It searched at random.",
    });
    // A pass is no entry, and neither is a fail of another task, of a held-out task's comparison,
    // or one the Referee ruled a check defect.
    c.solved("v2", HA, "pass");
    c.solved("v9", HA, "fail");
    c.solved("v1", HA, "fail", "g1");
    const defect = c.solved("v2", HA, "fail");
    c.record("referee.finding", { solve: defect, ruling: "check-defect" });
    expect(failsTold(c.events(), TASKS)).toEqual([
      `- ${open}, t-1, harness aaaaaaaa: fail (rejected); open. Diagnosis (owner solver, confidence low): It searched at random.`,
    ]);
    // One pass under a later harness is weak evidence, and a second makes it repaired.
    c.solved("v1", HB, "pass");
    expect(failsTold(c.events(), TASKS)[0]).toContain("; open: passed once under harness bbbbbbbb.");
    c.solved("v1", HB, "pass");
    expect(failsTold(c.events(), TASKS)[0]).toContain("; repaired under harness bbbbbbbb.");
    // A fail under a harness later still is its own entry, and marks the first as failing again.
    const again = c.solved("v1", HC, "fail");
    c.record("diagnosis.recorded", { solve: again, abstain: "no contrast" });
    const told = failsTold(c.events(), TASKS);
    expect(told).toHaveLength(2);
    expect(told[0]).toContain("; failing again under harness cccccccc.");
    expect(told[1]).toBe(
      `- ${again}, t-1, harness cccccccc: fail (rejected); open. The Diagnoser abstained.`,
    );
    // A later pass under the fail's own harness says nothing of a repair: the same bytes flip.
    c.solved("v1", HC, "pass");
    c.solved("v1", HC, "pass");
    expect(failsTold(c.events(), TASKS)[1]).toContain("; open.");
  });
});

describe("the comparisons a session is told", () => {
  it("are each one's tally and reading, with no task and no other count", () => {
    const c = campaign();
    const report = (session: string, reading: string, scored: JsonObject | null) =>
      c.record("comparison.reported", {
        session,
        old: HA,
        fresh: HB,
        reading,
        scored,
        versions: ["v7", "v8"],
        aside: ["v9"],
      });
    report("b-1", "step", { wins: 5, losses: 0, ties: 2, p: 0.031 });
    report("g-1", "not-scored", null);
    report("g-2", "no-step", { wins: 1, losses: 1, ties: 5, p: 0.75 });
    report("g-3", "below-starter", { wins: 4, losses: 0, ties: 3, p: 0.06 });
    const told = comparisonsTold(c.events());
    expect(told).toEqual([
      "- Harness bbbbbbbb against the reference harness: 5 won, 0 lost, 2 tied, which reads a step.",
      "- Harness bbbbbbbb against the reference harness: 1 won, 1 lost, 5 tied, which reads no step.",
      "- Harness bbbbbbbb against the reference harness: 4 won, 0 lost, 3 tied, which reads no step: it did not hold against the starting harness of the campaign.",
    ]);
    expect(told.join("\n")).not.toMatch(/v7|v8|v9|0\.031/);
    // A settling writes a comparison's report once more, and the comparison is told once, as settled.
    report("b-1", "no-step", { wins: 3, losses: 1, ties: 3, p: 0.31 });
    expect(comparisonsTold(c.events())[0]).toContain("3 won, 1 lost, 3 tied, which reads no step.");
    expect(comparisonsTold(c.events())).toHaveLength(3);
  });
});

describe("what a practice solve used", () => {
  it("is its time of its limit and the model's turns, and nothing for a solve the log has no end of", () => {
    const c = campaign();
    const solve = c.solved("v1", HA, "pass");
    expect(usedText(c.events(), solve)).toBe(" It took 3:42 of 8:00 and 14 model turns.");
    expect(usedText(c.events(), "s-none")).toBe("");
  });
});

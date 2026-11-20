import { describe, expect, it } from "bun:test";
import { checkTrial, unruledIn } from "#skills/compare-systems/scripts/trial.ts";
import { conditionId, settingId } from "#src/kernel/condition.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { requireJsonValue } from "#src/meta/stable-json.ts";
import { join } from "#src/meta/path.ts";
import { capturedExecPath } from "#src/meta/process.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";
import { conditionOf } from "./helpers/logged-round.ts";

const condition = conditionOf("task", "reference");
const expected = { ...condition, name: "baseline" };
const record = (value: typeof condition): LogEvent => ({
  at: "",
  kind: "condition.recorded",
  data: { id: conditionId(value), condition: requireJsonValue(value) },
});

describe("a comparison system's trial log", () => {
  it("refuses unusable terms before opening the seed", () => {
    const script = join(import.meta.dir, "../.claude/skills/compare-systems/scripts/systems.ts");
    for (const [flag, value] of [
      ["--tasks", "-1"],
      ["--solves", "0"],
      ["--level", "1"],
      ["--cap", "Infinity"],
    ] as const) {
      const call = runSync([
        capturedExecPath,
        script,
        "--seed",
        "missing",
        "--baseline",
        "a=p/m:high@starter",
        "--candidate",
        "b=p/m:high@promoted",
        "--reviewer",
        "p/m",
        `${flag}=${value}`,
      ]);
      expect(call.exitCode).toBe(2);
      expect(decodeOutput(call.stderr)).toContain(flag);
    }
  });
  it("reads a historical trial under its recorded identity and resumes only under its original setting", () => {
    const records = [record(condition), record({ ...condition, task: "next" })];
    checkTrial(records, expected);
    checkTrial(records, expected, settingId(condition));
    for (const changed of [{ harness: "another" }, { effort: "low" }, { model: "other" }]) {
      expect(() => checkTrial(records, { ...expected, ...changed })).toThrow("another harness or setting");
    }
    const later = { ...condition, host: "later code" };
    expect(() => checkTrial(records, expected, settingId(later))).toThrow("another harness or setting");
    expect(() => checkTrial([...records, record(later)], expected)).toThrow("another harness or setting");
  });

  it("retries a cut ruling until the rejection has a ruling or a hand label", () => {
    const events: LogEvent[] = [
      record(condition),
      { at: "", kind: "solve.started", data: { solve: "s", condition: conditionId(condition) } },
      { at: "", kind: "solve.finished", data: { solve: "s", ending: { outcome: "fail", kind: "rejected" } } },
      { at: "", kind: "referee.finding", data: { solve: "s", ruling: null } },
    ];
    expect(unruledIn(events).map(({ id }) => id)).toEqual(["s"]);
    expect(
      unruledIn([...events, { at: "", kind: "referee.finding", data: { solve: "s", ruling: "unclear" } }]),
    ).toEqual([]);
    expect(
      unruledIn([
        ...events,
        { at: "", kind: "comparison.reported", data: { session: "g", settled: { labels: { s: "earned" } } } },
      ]),
    ).toEqual([]);
  });
});

/**
 * The round plan's one owner: the strict reader a shell edit meets, the evidence the controller
 * keeps about it with the advice and compact view that evidence earns, and the declared-move
 * question admission asks after a battery that found no limit (whose refusal is owned by the
 * admission cases in experiment-freeze.test.ts).
 */
import { afterAll, describe, expect, it } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import {
  type ExperimentPlan,
  type LastBattery,
  PlanEvidence,
  captureExperimentSubmission,
  currentPlan,
  lastBatteryOf,
  parseExperimentSubmission,
  predictionScore,
  repeatedMoveDetail,
} from "../src/author/experiment-plan.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { brief } from "./helpers/starter-contracts.ts";

const PLAN: ExperimentPlan = {
  schema: "experiment-plan/v2",
  scope: "tasks",
  gap: "No battery yet makes the solver search the worst case.",
  change: "Hide the governing load case inside a continuous range.",
  expectedResult: "Fewer verified passes on the searched family.",
  target: { comparator: "at-most", verifiedPasses: 1 },
  families: [
    { family: "span", level: "frontier", move: "The worst case lies in a range the solver must search." },
    { family: "joint", level: "hard", move: "Every degraded state the same answer must clear." },
  ],
  predictions: [
    { taskId: "t1", pass: 0.1 },
    { taskId: "t2", pass: 0.5 },
  ],
};

const CONTRADICTED_T1 = "Advice: rehearsal verdicts contradict 1 prediction(s): t1 predicted 0.1 and passed.";
const staleAdvice = (taskIds: string) =>
  `Advice: rehearsed only at bytes that have since changed, so counted towards neither the target nor the predictions: ${taskIds}.`;

/** The plan with one field removed, as `jq 'del(.field)'` would leave it. */
const without = (field: keyof ExperimentPlan): JsonValue =>
  Object.fromEntries(Object.entries(PLAN).filter(([key]) => key !== field));

/** A workspace holding `plan` as EXPERIMENT.json, or none. */
function workspace(plan?: JsonValue): string {
  const dir = scratchDir("ana-experiment-plan-");
  if (plan !== undefined) writeFileSync(join(dir, "EXPERIMENT.json"), JSON.stringify(plan));
  return dir;
}

const pass = (taskId: string) => ({
  taskId,
  family: "span",
  verdict: "pass" as const,
  wallMinutes: 120,
  minutes: 12,
  toolCalls: 9,
  costUsd: 0.4,
});

const task = (taskId: string, limit: number) => ({
  taskId,
  family: "span",
  publicInput: { limit },
  hidden: [],
});

/** Gives `dir` the two-bundle layout holding t1 and t2 at `limit`, and an agent guide saying `guide`. */
function bundle(dir: string, limit: number, guide = "Solve it."): void {
  mkdirSync(join(dir, "agent"), { recursive: true });
  mkdirSync(join(dir, "correctness-model"), { recursive: true });
  writeFileSync(join(dir, "agent", "BUILT_AGENTS.md"), guide);
  writeFileSync(
    join(dir, "correctness-model", "tasks.json"),
    JSON.stringify([task("t1", limit), task("t2", limit)]),
  );
}

/** Installs `.toolchain/bin/grader` in `dir`, a script exiting with `status`. */
function grader(dir: string, status: number): void {
  const tool = join(dir, ".toolchain", "bin", "grader");
  mkdirSync(join(dir, ".toolchain", "bin"), { recursive: true });
  writeFileSync(tool, `#!/bin/sh\nexit ${String(status)}\n`);
  chmodSync(tool, 0o755);
}

/** A workspace holding PLAN beside a bundle whose tasks load, so its rehearsals can count. */
function planned(): string {
  const dir = workspace(PLAN);
  bundle(dir, 10);
  return dir;
}

afterAll(cleanupScratch);

describe("the plan reader", () => {
  it("reads a valid hand edit and binds it by digest", () => {
    const dir = workspace();
    writeFileSync(join(dir, "EXPERIMENT.json"), `${JSON.stringify(PLAN, null, 2)}\n`);
    expect(captureExperimentSubmission(dir)).toEqual({
      ok: true,
      experiment: { ...PLAN, digest: hashJsonValue(PLAN) },
    });
    expect(parseExperimentSubmission({ ...PLAN, digest: hashJsonValue(PLAN) })).not.toBeNull();
    expect(parseExperimentSubmission({ ...PLAN, digest: "tampered" })).toBeNull();
  });

  // A jq filter such as `del(.predictions)` or `.families = {}` leaves valid JSON that is no longer
  // the plan; the superseded shape without schema is refused by the name of what replaced it.
  it.each<[string, JsonValue, string, RegExp]>([
    ["deleted predictions", without("predictions"), "experiment-proposal-shape", /"predictions"/],
    ["families as an object", { ...PLAN, families: {} }, "experiment-proposal-shape", /"families"/],
    ["no families", { ...PLAN, families: [] }, "experiment-proposal-shape", /add no other/],
    [
      "a probability above one",
      { ...PLAN, predictions: [{ taskId: "t1", pass: 1.5 }] },
      "experiment-proposal-shape",
      /from 0 to 1/,
    ],
    [
      "a family twice",
      { ...PLAN, families: [...PLAN.families.slice(0, 1), ...PLAN.families.slice(0, 1)] },
      "experiment-proposal-shape",
      /once/,
    ],
    [
      "the superseded shape",
      { scope: "tasks", gap: "g", change: "c", expectedResult: "r", target: PLAN.target },
      "experiment-plan-schema",
      /names no schema, and this controller reads experiment-plan\/v2 alone/,
    ],
    [
      "an older schema",
      { ...PLAN, schema: "experiment-plan/v1" },
      "experiment-plan-schema",
      /declares schema "experiment-plan\/v1"/,
    ],
  ])("refuses a shell edit leaving %s", (_title, value, code, detail) => {
    const captured = captureExperimentSubmission(workspace(value));
    expect(captured.ok ? [] : captured.findings.map((row) => [row.code, row.detail])).toEqual([
      [code, expect.stringMatching(detail)],
    ]);
  });

  it("refuses an unreadable file by its read code", () => {
    const dir = workspace();
    writeFileSync(join(dir, "EXPERIMENT.json"), "{ not json");
    const captured = captureExperimentSubmission(dir);
    expect(captured.ok ? [] : captured.findings.map((row) => row.code)).toEqual(["experiment-proposal-read"]);
  });

  // The authoring reviewer reads the workspace mid-round, where the plan may be unwritten or half
  // edited. It is shown the plan the controller would capture, and nothing when there is none.
  it("returns the plan as it reads now, and null for one that is absent or refused", () => {
    expect(currentPlan(workspace())).toBeNull();
    expect(currentPlan(workspace(without("predictions")))).toBeNull();
    expect(currentPlan(workspace(PLAN))).toEqual({ ...PLAN, digest: hashJsonValue(PLAN) });
  });
});

describe("the plan evidence", () => {
  it("advises when rehearsals contradict a prediction or already pass the at-most target", () => {
    const contradicted = new PlanEvidence(planned(), null);
    expect(contradicted.record(pass("t1"))).toEqual([CONTRADICTED_T1]);
    expect(contradicted.record(pass("t2"))[0]).toBe(
      "Advice: rehearsals already passed 2 distinct task(s) (t1, t2) against a target of at most 1 verified passes.",
    );
    // A target the rehearsals meet and a prediction the verdict does not contradict advise nothing.
    expect(new PlanEvidence(planned(), null).record(pass("t2"))).toEqual([]);
    // Without a readable plan there is nothing to advise against.
    expect(new PlanEvidence(workspace(), null).record(pass("t1"))).toEqual([]);
  });

  // Run 371f8f round 2 declared at most 5 of 7 against an aim of 2 to 3, and only the readout after
  // its battery said so. The advice says it while the plan can still change.
  it("advises when the target lies above the aim of the battery as it stands", () => {
    const seven = (verifiedPasses: number) => {
      const dir = workspace({ ...PLAN, target: { comparator: "at-most", verifiedPasses } });
      bundle(dir, 10);
      const ids = ["t1", "t2", "t3", "t4", "t5", "t6", "t7"];
      writeFileSync(
        join(dir, "correctness-model", "tasks.json"),
        JSON.stringify(ids.map((id) => task(id, 10))),
      );
      return new PlanEvidence(dir, null).advice();
    };
    expect(seven(5)).toEqual([
      "Advice: the target, at-most 5 verified passes, lies above the aim of 2 to 3 of 7, so a battery meeting it would find no limit.",
    ]);
    expect(seven(3)).toEqual([]);
  });

  it("scores predictions against verdicts, and nothing when no prediction was scored", () => {
    const verdicts = new Map([
      ["t1", false],
      ["t2", true],
    ]);
    expect(predictionScore(PLAN.predictions, verdicts)).toEqual({
      scored: 2,
      brier: 0.13,
      expected: 0.6,
      observed: 1,
    });
    expect(predictionScore(PLAN.predictions, new Map([["t9", true]]))).toBeNull();
  });

  it("writes the evidence file outside the workspace and renders one compact view", () => {
    const dir = planned();
    mkdirSync(join(dir, "starter-pack"));
    writeFileSync(
      join(dir, "starter-pack", "difficulty-ladder.md"),
      "- **hard** — all of that.\n- **frontier** — hard, with the set\n  no longer handed over.\n\nNext.\n",
    );
    writeFileSync(
      join(dir, "MEMORY.md"),
      "# Memory\n\n## Risk\n<!-- One line. -->\nThe span family may still be one call.\n",
    );
    const rehearsals = join(workspace(), "rehearsals");
    // An earlier round's evidence keeps its file; this round claims the next free name.
    mkdirSync(rehearsals);
    writeFileSync(join(rehearsals, "experiment-evidence.json"), "{}");
    const evidence = new PlanEvidence(dir, rehearsals);
    expect(evidence.record({ ...pass("t1"), minutes: 30, toolCalls: 12, costUsd: null })).toEqual([
      CONTRADICTED_T1,
    ]);
    expect(JSON.parse(readFileSync(join(rehearsals, "experiment-evidence-2.json"), "utf8"))).toMatchObject({
      schema: "experiment-evidence/v2",
      planDigest: hashJsonValue(PLAN),
      predictionScore: { scored: 1, brier: 0.81, expected: 0.1, observed: 1 },
    });
    expect(readFileSync(join(rehearsals, "experiment-evidence.json"), "utf8")).toBe("{}");
    expect(existsSync(join(dir, "experiment-evidence.json"))).toBe(false);
    expect(evidence.view().split("\n")).toEqual([
      "Round plan (experiment-plan/v2, tasks scope): target at-most 1 verified passes; 2 task prediction(s) summing to 0.6 expected passes.",
      "Families: span at frontier — The worst case lies in a range the solver must search.; joint at hard — Every degraded state the same answer must clear..",
      CONTRADICTED_T1,
      "Rehearsals this round: t1 (span) pass in 30 of 120 solve minutes (25%), 12 tool calls, cost unreported.",
      "Ladder frontier row: - **frontier** — hard, with the set no longer handed over.",
      "MEMORY.md risk: The span family may still be one call.",
      "Full files: EXPERIMENT.json, MEMORY.md and starter-pack/difficulty-ladder.md; the context tool searches them with the round's history and traces.",
    ]);
  });

  // A tightened task is a different question from the one its earlier rehearsal answered, so that
  // verdict stops counting and is named instead of silently calibrating what would be submitted.
  it("counts a rehearsal at the task's current bytes and names one at earlier bytes as stale", () => {
    const dir = planned();
    const evidence = new PlanEvidence(dir, null);
    expect(evidence.record(pass("t1"))).toEqual([CONTRADICTED_T1]);

    bundle(dir, 4, "Solve it within the tighter limit.");
    expect(evidence.advice()).toEqual([staleAdvice("t1")]);
    expect(evidence.view().split("\n")).toContain(staleAdvice("t1"));
    expect(evidence.record(pass("t2"))).toEqual([staleAdvice("t1")]);

    // Tasks that do not load leave the current bytes unknown rather than changed: nothing counts,
    // not even a rehearsal recorded while they were unreadable, and no task is called stale.
    writeFileSync(join(dir, "correctness-model", "tasks.json"), "{ not json");
    const unknown =
      "Advice: the current bundle or its tasks do not load, so no rehearsal counts towards the target or the predictions until they do.";
    expect(evidence.record(pass("t1"))).toEqual([unknown]);
    expect(evidence.view().split("\n")).toContain(unknown);

    // Back at the first bytes, the first t1 verdict counts again and t2's stays stale.
    bundle(dir, 10);
    expect(evidence.advice()).toEqual([CONTRADICTED_T1, staleAdvice("t2")]);
  });

  // The identity covers what grades the solve and not only what the solver reads: neither the
  // task's hidden operand nor an installed tool the brief requires is in the public projection or
  // the bundle fingerprint.
  it.each<[string, (dir: string) => void, (dir: string) => void]>([
    [
      "a hidden operand",
      () => undefined,
      (dir) =>
        writeFileSync(
          join(dir, "correctness-model", "tasks.json"),
          JSON.stringify([{ ...task("t1", 10), hidden: [{ checkId: "c", operand: 3 }] }, task("t2", 10)]),
        ),
    ],
    [
      "an installed tool",
      (dir) => {
        const declared = brief("## The worked domain");
        const [first] = declared.truthChecks;
        if (first !== undefined) first.execution.requiredToolIds = ["grader"];
        writeFileSync(join(dir, "correctness-model", "brief.json"), JSON.stringify(declared));
        grader(dir, 0);
      },
      (dir) => grader(dir, 1),
    ],
  ])("stops counting a rehearsal once only %s moved", (_title, arrange, change) => {
    const dir = planned();
    arrange(dir);
    const evidence = new PlanEvidence(dir, null);
    expect(evidence.record(pass("t1"))).toEqual([CONTRADICTED_T1]);
    change(dir);
    expect(evidence.advice()).toEqual([staleAdvice("t1")]);
  });

  it("bounds a long quoted line in the view and marks what it left out", () => {
    const dir = workspace(PLAN);
    writeFileSync(join(dir, "MEMORY.md"), `# Memory\n\n## Risk\n${"r".repeat(400)}\n`);
    expect(new PlanEvidence(dir, null).view()).toContain(
      `MEMORY.md risk: ${"r".repeat(320)} […80 bytes omitted]\n`,
    );
  });

  it("names a refused or missing plan in the view instead of reading it", () => {
    expect(new PlanEvidence(workspace(), null).view()).toStartWith(
      "Round plan: EXPERIMENT.json is not written yet.",
    );
    expect(new PlanEvidence(workspace(without("schema")), null).view()).toStartWith(
      "Round plan: EXPERIMENT.json is refused — EXPERIMENT.json names no schema",
    );
  });
});

describe("the declared-move question", () => {
  const lastPlan = { ...PLAN, target: { comparator: "at-most" as const, verifiedPasses: 3 }, digest: "d" };
  const noLimit: LastBattery = { noLimit: true, passed: 5, verified: 5, plan: lastPlan };
  // Only the published magnitudes changed: the families declare the moves they declared before.
  const retuned: ExperimentPlan = {
    ...PLAN,
    change: "Longer spans and heavier loads.",
    target: { comparator: "at-most", verifiedPasses: 2 },
  };

  it("fires on a climb after a battery that found no limit when every family repeats its move", () => {
    expect(repeatedMoveDetail(noLimit, retuned)).toStartWith(
      "The last battery passed 5 of 5 verified cases and found no limit",
    );
  });

  it.each<[string, LastBattery | undefined, ExperimentPlan]>([
    [
      "a changed move",
      noLimit,
      {
        ...retuned,
        families: retuned.families.map((row, index) =>
          index === 0 ? { ...row, move: "An earlier step forecloses a later one." } : row,
        ),
      },
    ],
    [
      "a new family",
      noLimit,
      { ...retuned, families: [...PLAN.families, { family: "sequence", level: "frontier", move: "x" }] },
    ],
    ["no climb", noLimit, { ...retuned, target: { comparator: "at-least", verifiedPasses: 5 } }],
    ["a battery with a limit", { ...noLimit, noLimit: false }, retuned],
    ["no last plan", { ...noLimit, plan: null }, retuned],
    ["no last battery", undefined, retuned],
  ])("stays silent on %s", (_title, last, plan) => {
    expect(repeatedMoveDetail(last, plan)).toBeNull();
  });

  it("reads the newest standing battery off the readout rows", () => {
    const row = { claimRefusal: null, zone: "on-aim", passed: 4, verified: 4, experiment: null };
    expect(lastBatteryOf([row])).toEqual({ noLimit: true, passed: 4, verified: 4, plan: null });
    expect(lastBatteryOf([{ ...row, passed: 2 }])).toMatchObject({ noLimit: false });
    expect(lastBatteryOf([{ ...row, passed: 2, zone: "over-aim" }])).toMatchObject({ noLimit: true });
    expect(lastBatteryOf([{ ...row, claimRefusal: "refused", passed: null }])).toBeUndefined();
  });
});

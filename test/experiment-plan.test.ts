/**
 * The round plan's one owner: the strict reader a shell edit meets, the evidence file the
 * controller writes, the advice and the compact view, and the declared-move question admission
 * asks after a battery that found no limit.
 */
import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
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
  planAdvice,
  predictionScore,
  renderPlanView,
  repeatedMoveDetail,
} from "../src/author/experiment-plan.ts";

const scratch: string[] = [];

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

/** The plan with one field removed, as `jq 'del(.field)'` would leave it. */
const without = (field: keyof ExperimentPlan): JsonValue =>
  Object.fromEntries(Object.entries(PLAN).filter(([key]) => key !== field));

const write = (dir: string, value: JsonValue) =>
  writeFileSync(join(dir, "EXPERIMENT.json"), JSON.stringify(value));

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "ana-experiment-plan-"));
  scratch.push(dir);
  return dir;
}

describe("the plan reader", () => {
  it("reads a valid hand edit and binds it by digest", () => {
    const dir = workspace();
    writeFileSync(join(dir, "EXPERIMENT.json"), `${JSON.stringify(PLAN, null, 2)}\n`);
    const captured = captureExperimentSubmission(dir);
    expect(captured).toEqual({ ok: true, experiment: { ...PLAN, digest: hashJsonValue(PLAN) } });
    expect(parseExperimentSubmission({ ...PLAN, digest: hashJsonValue(PLAN) })).not.toBeNull();
    expect(parseExperimentSubmission({ ...PLAN, digest: "tampered" })).toBeNull();
  });

  // A jq filter such as `del(.predictions)` or `.families = {}` leaves valid JSON that is no longer
  // the plan; the superseded shape without schema is refused by the name of what replaced it.
  it("refuses a shell edit that breaks the schema, and the superseded shape by name", () => {
    const dir = workspace();
    const cases: Array<[JsonValue, string, RegExp]> = [
      [without("predictions"), "experiment-proposal-shape", /"predictions"/],
      [{ ...PLAN, families: {} }, "experiment-proposal-shape", /"families"/],
      [{ ...PLAN, families: [] }, "experiment-proposal-shape", /add no other/],
      [{ ...PLAN, predictions: [{ taskId: "t1", pass: 1.5 }] }, "experiment-proposal-shape", /from 0 to 1/],
      [
        { ...PLAN, families: [...PLAN.families.slice(0, 1), ...PLAN.families.slice(0, 1)] },
        "experiment-proposal-shape",
        /once/,
      ],
      [
        { scope: "tasks", gap: "g", change: "c", expectedResult: "r", target: PLAN.target },
        "experiment-plan-schema",
        /names no schema, and this controller reads experiment-plan\/v2 alone/,
      ],
      [
        { ...PLAN, schema: "experiment-plan/v1" },
        "experiment-plan-schema",
        /declares schema "experiment-plan\/v1"/,
      ],
    ];
    for (const [value, code, detail] of cases) {
      write(dir, value);
      const captured = captureExperimentSubmission(dir);
      expect(captured.ok).toBe(false);
      if (captured.ok) continue;
      expect(captured.findings.map((row) => row.code)).toEqual([code]);
      expect(captured.findings[0]?.detail).toMatch(detail);
    }
    writeFileSync(join(dir, "EXPERIMENT.json"), "{ not json");
    const unreadable = captureExperimentSubmission(dir);
    expect(unreadable.ok ? [] : unreadable.findings.map((row) => row.code)).toEqual([
      "experiment-proposal-read",
    ]);
  });
});

describe("the plan as it reads now", () => {
  // The authoring reviewer reads the workspace mid-round, where the plan may be unwritten or half
  // edited. It is shown the plan the controller would capture, and nothing when there is none.
  it("returns the captured plan, and null for one that is absent or refused", () => {
    const dir = workspace();
    expect(currentPlan(dir)).toBeNull();
    write(dir, without("predictions"));
    expect(currentPlan(dir)).toBeNull();
    write(dir, PLAN);
    expect(currentPlan(dir)).toEqual({ ...PLAN, digest: hashJsonValue(PLAN) });
  });
});

describe("the plan evidence", () => {
  it("scores predictions against verdicts and advises when rehearsals contradict the plan", () => {
    const passT1 = { taskId: "t1", family: "span", verdict: "pass" as const, wallMinutes: 120 };
    const passT2 = { ...passT1, taskId: "t2" };
    const effort = { minutes: 12, toolCalls: 9, costUsd: 0.4 };
    expect(planAdvice(PLAN, [{ ...passT1, ...effort }])).toEqual([
      "Advice: rehearsal verdicts contradict 1 prediction(s): t1 predicted 0.1 and passed.",
    ]);
    expect(
      planAdvice(PLAN, [
        { ...passT1, ...effort },
        { ...passT2, ...effort },
      ])[0],
    ).toBe(
      "Advice: rehearsals already passed 2 distinct task(s) (t1, t2) against a target of at most 1 verified passes.",
    );
    // A target met by the rehearsals and a prediction the verdict does not contradict advise nothing.
    expect(planAdvice(PLAN, [{ ...passT2, ...effort }])).toEqual([]);
    expect(
      predictionScore(
        PLAN.predictions,
        new Map([
          ["t1", false],
          ["t2", true],
        ]),
      ),
    ).toEqual({ scored: 2, brier: 0.13, expected: 0.6, observed: 1 });
    expect(predictionScore(PLAN.predictions, new Map([["t9", true]]))).toBeNull();
  });

  it("writes the evidence file outside the workspace and renders one compact view", () => {
    const dir = workspace();
    write(dir, PLAN);
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
    const evidencePath = join(rehearsals, "experiment-evidence-2.json");
    const evidence = new PlanEvidence(dir, rehearsals);
    const advice = evidence.record({
      taskId: "t1",
      family: "span",
      verdict: "pass",
      wallMinutes: 120,
      minutes: 30,
      toolCalls: 12,
      costUsd: null,
    });
    expect(advice).toEqual([
      "Advice: rehearsal verdicts contradict 1 prediction(s): t1 predicted 0.1 and passed.",
    ]);
    const recorded = JSON.parse(readFileSync(evidencePath, "utf8"));
    expect(recorded).toMatchObject({
      schema: "experiment-evidence/v1",
      planDigest: hashJsonValue(PLAN),
      predictionScore: { scored: 1, brier: 0.81, expected: 0.1, observed: 1 },
    });
    expect(readFileSync(join(rehearsals, "experiment-evidence.json"), "utf8")).toBe("{}");
    expect(existsSync(join(dir, "experiment-evidence.json"))).toBe(false);
    expect(evidence.view()).toBe(renderPlanView(dir, evidence.list()));
    expect(renderPlanView(dir, evidence.list()).split("\n")).toEqual([
      "Round plan (experiment-plan/v2, tasks scope): target at-most 1 verified passes; 2 task prediction(s) summing to 0.6 expected passes.",
      "Families: span at frontier — The worst case lies in a range the solver must search.; joint at hard — Every degraded state the same answer must clear..",
      "Advice: rehearsal verdicts contradict 1 prediction(s): t1 predicted 0.1 and passed.",
      "Rehearsals this round: t1 (span) pass in 30 of 120 solve minutes (25%), 12 tool calls, cost unreported.",
      "Ladder frontier row: - **frontier** — hard, with the set no longer handed over.",
      "MEMORY.md risk: The span family may still be one call.",
      "Full files: EXPERIMENT.json, MEMORY.md and starter-pack/difficulty-ladder.md; the context tool searches them with the round's history and traces.",
    ]);
  });

  it("names a refused or missing plan in the view instead of reading it", () => {
    const dir = workspace();
    expect(renderPlanView(dir, [])).toStartWith("Round plan: EXPERIMENT.json is not written yet.");
    write(dir, without("schema"));
    expect(renderPlanView(dir, [])).toStartWith(
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
    expect(repeatedMoveDetail(noLimit, retuned)).toMatch(
      /^The last battery passed 5 of 5 verified cases and found no limit, .* This compares the declared moves, not semantic difficulty/,
    );
  });

  it("stays silent on a changed move, a new family, no climb, a battery with a limit, or no last plan", () => {
    const moved = {
      ...retuned,
      families: retuned.families.map((row, index) =>
        index === 0 ? { ...row, move: "An earlier step forecloses a later one." } : row,
      ),
    };
    const added = {
      ...retuned,
      families: [...PLAN.families, { family: "sequence", level: "frontier" as const, move: "x" }],
    };
    expect(repeatedMoveDetail(noLimit, moved)).toBeNull();
    expect(repeatedMoveDetail(noLimit, added)).toBeNull();
    expect(
      repeatedMoveDetail(noLimit, { ...retuned, target: { comparator: "at-least", verifiedPasses: 5 } }),
    ).toBeNull();
    expect(repeatedMoveDetail({ ...noLimit, noLimit: false }, retuned)).toBeNull();
    expect(repeatedMoveDetail({ ...noLimit, plan: null }, retuned)).toBeNull();
    expect(repeatedMoveDetail(undefined, retuned)).toBeNull();
  });

  it("reads the newest standing battery off the readout rows", () => {
    const row = { claimRefusal: null, zone: "on-aim", passed: 4, verified: 4, experiment: null };
    expect(lastBatteryOf([row])).toEqual({ noLimit: true, passed: 4, verified: 4, plan: null });
    expect(lastBatteryOf([{ ...row, passed: 2 }])).toMatchObject({ noLimit: false });
    expect(lastBatteryOf([{ ...row, passed: 2, zone: "over-aim" }])).toMatchObject({ noLimit: true });
    expect(lastBatteryOf([{ ...row, claimRefusal: "refused", passed: null }])).toBeUndefined();
  });
});

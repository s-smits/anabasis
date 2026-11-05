/**
 * What a review's reading prints of a rubric-graded benchmark: each grain side by side, every split
 * both ways, and a sealed half that stays out of sight and out of every pool until it is unsealed.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { armOf, levelLines, sealOf } from "../studies/harness2/levels.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { capturedJsonStringify } from "../src/meta/json-runtime.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";

const SECRET = "a rubric sentence no ledger may hold";
const label = { a: "built", b: "bare" };
const TASKS = ["g/task1", "g/task2", "g/task3", "h/task1"];
const root = mkdtempSync(join(tmpdir(), "ana-comparison-review-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** One grading: each rubric as [weight, score, criteria passed, criteria]. */
function grade(arm: string, task: string, rubrics: readonly (readonly [number, number, number, number])[]) {
  const [group, name] = task.split("/");
  const folder = join(root, String(group), String(name), "eval_result", `eval_${arm}__${group}__${name}`);
  mkdirSync(folder, { recursive: true });
  const record = {
    total_score: rubrics.reduce((sum, [, score]) => sum + score, 0),
    max_score: rubrics.reduce((sum, [weight]) => sum + weight, 0),
    rubrics: rubrics.map(([weight, score, passed, criteria], index) => ({
      index,
      weight,
      rubric: SECRET,
      result: {
        score,
        passed: score === weight,
        criteria_passed: passed,
        criteria_count: criteria,
        overall_reasoning: SECRET,
      },
    })),
  };
  writeFileSync(join(folder, `x_${arm}_judge.json`), capturedJsonStringify(record) ?? "");
}

grade("built", "g/task1", [
  [10, 0, 3, 4],
  [8, 8, 2, 2],
]);
grade("bare", "g/task1", [
  [10, 10, 4, 4],
  [8, 8, 2, 2],
]);
grade("built", "g/task2", [[6, 6, 3, 3]]);
grade("bare", "g/task2", [[6, 0, 1, 3]]);
grade("built", "g/task3", [[4, 4, 1, 1]]);
grade("bare", "g/task3", [[4, 4, 1, 1]]);
grade("built", "h/task1", [[20, 0, 0, 5]]);
grade("bare", "h/task1", [[20, 0, 4, 5]]);
grade("built", "h/task2", [[2, 2, 1, 1]]);

const a = armOf(root, "built");
const b = armOf(root, "bare");
const read = (salt: string | null, unseal = false) => levelLines({ label, a, b, salt, unseal }).join("\n");

describe("the open reading", () => {
  it("reads every grain from the gradings and names a task short on one side", () => {
    const told = read(null);
    expect(told).toContain("left out as short on one side: h/task2");
    expect(told).toContain("points: 18 v 22 of 48");
    expect(told).toContain("criteria: 9 v 12 of 15");
    expect(told).toContain("rubrics one criterion short of scoring: 1 v 1");
  });

  it("lists a split rubric won by either side, under one count of each", () => {
    const told = read(null);
    expect(told).toContain("rubrics split: 2 of 5; built won 1 for 6 points, bare won 1 for 10 points");
    expect(told).toContain("g/task1 rubric 0 weight 10");
    expect(told).toContain("g/task2 rubric 0 weight 6");
    expect(told).not.toContain("h/task1 rubric");
  });

  it("reads each measure both ways by the comparison's test", () => {
    const line = read(null)
      .split("\n")
      .find((each) => each.startsWith("points by task"));
    expect(line).toContain("built above on 1, bare above on 1, tied on 2");
    expect(line).toContain("p built above");
    expect(line).toContain("p bare above");
  });

  it("prints no rubric's text and no grader's reasons", () => {
    expect(read(null)).not.toContain(SECRET);
    expect(read("salt", true)).not.toContain(SECRET);
  });

  it("refuses a task graded twice instead of choosing one", () => {
    const folder = join(root, "g", "task3", "eval_result", "eval_built__g__task3");
    writeFileSync(join(folder, "again_judge.json"), capturedJsonStringify({}) ?? "");
    expect(() => armOf(root, "built")).toThrow("gradings");
    rmSync(join(folder, "again_judge.json"));
  });

  it("refuses a grading with a field missing instead of reading it as nothing", () => {
    const folder = join(root, "torn", "task1", "eval_result", "eval_built__torn__task1");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "x_judge.json"), capturedJsonStringify({ max_score: 10 }) ?? "");
    expect(() => armOf(root, "built")).toThrow("total_score");
    rmSync(join(root, "torn"), { recursive: true });
  });
});

describe("the seal", () => {
  it("splits one set in half, the same whatever order it came in", () => {
    const { open, sealed } = sealOf(TASKS, "c0mm1t");
    expect(open).toHaveLength(2);
    expect(sealed).toHaveLength(2);
    expect([...open, ...sealed].toSorted()).toStrictEqual(TASKS);
    expect(sealOf(TASKS.toReversed(), "c0mm1t")).toStrictEqual({ open, sealed });
  });

  it("moves with the salt, so a split follows from the ledger's first version", () => {
    const splits = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h"].map((salt) => sealOf(TASKS, salt).sealed.join(",")),
    );
    expect(splits.size).toBeGreaterThan(1);
  });

  it("prints a sealed task by name alone, and no pooled total carries it", () => {
    const { sealed } = sealOf(TASKS, "c0mm1t");
    const told = read("c0mm1t");
    expect(told).toContain("sealed by c0mm1t");
    for (const task of sealed) {
      expect(told).not.toContain(`${task}: points`);
      expect(told).not.toContain(`${task} rubric`);
    }
    expect(told).toContain("2 tasks, built v bare");
    expect(told).not.toContain("4 tasks, built v bare");
  });

  it("unseals as a block of its own and never pools the two halves", () => {
    const { sealed } = sealOf(TASKS, "c0mm1t");
    const told = read("c0mm1t", true);
    const [open, rest] = told.split("sealed half, read once, not pooled");
    for (const task of sealed) {
      expect(open).not.toContain(`${task}: points`);
      expect(rest).toContain(`${task}: points`);
    }
    expect(told).not.toContain("4 tasks, built v bare");
  });
});

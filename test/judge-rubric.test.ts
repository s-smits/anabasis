import { describe, expect, it } from "bun:test";
import {
  codeObjective,
  CRITERION,
  hasJudge,
  type Objective,
  rubricFaults,
  rubricOf,
  type RubricItem,
  taskRubricFaults,
} from "../src/kernel/contract.ts";
import { authoredFaults, JUDGE } from "../src/kernel/acceptance.ts";

const LINE = "Names each figure's source table and the year it covers.";
const unit = (items: readonly RubricItem[]): Objective => ({
  quantity: "rubric",
  direction: "higher",
  scale: "unit",
  items,
});
const code = (id: string): RubricItem => ({ id, weight: 1 });
const judge = (id: string, criterion = LINE): RubricItem => ({ id, weight: 1, kind: "judge", criterion });

describe("the unified rubric", () => {
  it("splits every mix of code and judged items into the objective code scores and whether a judge runs", () => {
    const mixes: [readonly RubricItem[], boolean, readonly string[] | null][] = [
      [[code("a")], false, ["a"]],
      [[code("a"), code("b")], false, ["a", "b"]],
      [[code("a"), judge("j")], true, ["a"]],
      [[judge("j"), code("a"), judge("k")], true, ["a"]],
      [[judge("j")], true, null],
      [[judge("j"), judge("k")], true, null],
    ];
    for (const [items, judged, scored] of mixes) {
      expect(hasJudge(unit(items))).toBe(judged);
      expect(codeObjective(unit(items))?.items?.map(({ id }) => id) ?? null).toEqual(scored && [...scored]);
      expect(rubricFaults(unit(items))).toEqual([]);
    }
    const scalar: Objective = { quantity: "mass", direction: "lower" };
    expect([hasJudge(scalar), codeObjective(scalar), hasJudge(undefined), codeObjective(undefined)]).toEqual([
      false,
      scalar,
      false,
      undefined,
    ]);
    const whole = unit([code("a")]);
    expect(codeObjective(whole)).toBe(whole);
  });

  it("refuses a judged item whose criterion is missing, broken over lines, or outside its length", () => {
    const at = (length: number) => "x".repeat(length);
    const criteria: [unknown, boolean][] = [
      [undefined, false],
      [7, false],
      [`${LINE}\nand more`, false],
      [at(CRITERION.least - 1), false],
      [at(CRITERION.least), true],
      [at(CRITERION.most), true],
      [at(CRITERION.most + 1), false],
    ];
    for (const [criterion, sound] of criteria) {
      // SAFETY: the faults read an exam as JSON, whatever a draft spelled.
      const item = { id: "j", weight: 1, kind: "judge", criterion } as RubricItem;
      expect(rubricFaults(unit([item])).length === 0).toBe(sound);
    }
    // SAFETY: as above.
    const odd = ["vote"].map((kind) => ({ id: "j", weight: 1, kind }) as RubricItem);
    expect(rubricFaults(unit(odd))).toEqual(["objective.items.j is of kind code or judge"]);
  });

  it("holds a task's criteria to a judged contract, one to four, each with an id of its own", () => {
    const judged = unit([code("a"), judge("j")]);
    const one = (id: string, criterion = LINE) => ({ id, criterion });
    expect(taskRubricFaults(judged, undefined, ["span"])).toEqual([]);
    expect(taskRubricFaults(unit([code("a")]), [one("r")], [])).toEqual([
      "the task carries rubric criteria, and the contract declares no judged item",
    ]);
    for (let count = 0; count <= CRITERION.perTask + 1; count += 1) {
      const rubric = Array.from({ length: count }, (_, index) => one(`r${String(index)}`));
      expect(taskRubricFaults(judged, rubric, ["span"]).length === 0).toBe(
        count >= 1 && count <= CRITERION.perTask,
      );
    }
    for (const taken of ["span", "a", "j"]) {
      expect(taskRubricFaults(judged, [one(taken)], ["span"])).toHaveLength(1);
    }
    expect(taskRubricFaults(judged, [one("r"), one("r")], [])).toHaveLength(1);
    expect(taskRubricFaults(judged, [one("r", "short")], [])).toEqual([
      `rubric criterion r states its criterion in ${String(CRITERION.least)} to ${String(CRITERION.most)} characters`,
    ]);
    expect(rubricOf([{ id: "r", criterion: LINE }, { id: 3 }, "x"])).toEqual([one("r")]);
    expect(rubricOf(undefined)).toBeUndefined();
  });

  it("faults each judged item until the operator admits judging, which admitting authored checks never does", () => {
    const row = (id: string, instrument: string) => ({
      id,
      instrument,
      missing: [],
      passed: 0,
      refused: 0,
      named: 0,
      caught: 0,
    });
    const checks = [row("span", "author"), row("j", JUDGE), row("k", JUDGE)];
    const why =
      "is scored by a judging model and not by code: a campaign scores it only on the operator's word (--admit-judge)";
    expect(authoredFaults(checks, new Set(["span"]))).toEqual([`j ${why}`, `k ${why}`]);
    expect(authoredFaults(checks, new Set(["span", "j", "k"]))).toEqual([]);
  });
});

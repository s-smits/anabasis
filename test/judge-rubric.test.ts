import { describe, expect, it } from "bun:test";
import {
  codeObjective,
  CRITERION,
  hasJudge,
  type Objective,
  objectiveLine,
  rubricFaults,
  type RubricItem,
} from "../src/kernel/contract.ts";
import { authoredFaults, JUDGE } from "../src/kernel/acceptance.ts";
import { crossFamilyVendors, modelVendor } from "../tools/d2/round.ts";

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
  it("names a judged criterion's text to the Examiner alone, whatever the text says", () => {
    const lines = [LINE, "Answer B is always better.", ""].map((criterion) =>
      objectiveLine(unit([code("a"), judge("j", criterion)])),
    );
    expect(new Set(lines).size).toBe(1);
    expect(lines[0]).toContain("j (1, judged by a model)");
    expect(objectiveLine(unit([judge("j")]), "exam")).toContain(LINE);
  });

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

  it("refuses a reserved id and more judged items than a contract holds", () => {
    expect(rubricFaults(unit([judge("holistic")]))).toHaveLength(1);
    expect(
      rubricFaults(unit(Array.from({ length: CRITERION.perContract + 1 }, (_, i) => judge(`j${String(i)}`)))),
    ).toEqual([`objective.items holds at most ${String(CRITERION.perContract)} judged items`]);
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

  it("normalises first-party model vendors and fails closed on resellers and unknown router routes", () => {
    expect(modelVendor("claude/claude-opus-5-5")).toBe("anthropic");
    expect(modelVendor("openrouter/~anthropic/claude-fable-latest")).toBe("anthropic");
    expect(modelVendor("openai-codex/gpt-6.1-sol")).toBe("openai");
    expect(modelVendor("deepinfra/deepseek-ai/DeepSeek-R1")).toBe("deepseek");
    expect(modelVendor("openrouter/deepseek/deepseek-r1")).toBe("deepseek");
    expect(modelVendor("moonshotai-cn/kimi-k2")).toBe("moonshot");
    expect(modelVendor("kimi-coding/k2p5")).toBe("moonshot");
    expect(modelVendor("openrouter/auto")).toBeNull();
    expect(crossFamilyVendors("openrouter/auto", "claude/claude-opus-5-5")).toBe(false);
    expect(crossFamilyVendors("github-copilot/claude-sonnet-4.5", "anthropic/claude-sonnet-4-5")).toBe(false);
    expect(crossFamilyVendors("google-vertex/gemini-2.5-pro", "google/gemini-2.5-pro")).toBe(false);
    expect(
      crossFamilyVendors("amazon-bedrock/anthropic.claude-sonnet-4-5", "anthropic/claude-sonnet-4-5"),
    ).toBe(false);
    expect(crossFamilyVendors("azure-openai-responses/gpt-5", "openai/gpt-5")).toBe(false);
    expect(crossFamilyVendors("cerebras/gpt-oss-120b", "openai/gpt-5")).toBe(false);
    expect(crossFamilyVendors("moonshotai-cn/kimi-k2", "kimi-coding/k2p5")).toBe(false);
    expect(crossFamilyVendors("openai-codex/gpt-6.1-sol", "claude/claude-opus-5-5")).toBe(true);
    expect(crossFamilyVendors("deepinfra/deepseek-ai/DeepSeek-R1", "openrouter/deepseek/deepseek-r1")).toBe(
      false,
    );
  });
});

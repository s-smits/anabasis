/**
 * The Examiner's difficulty ladder: one scale with lane 34's, shown to both of the Examiner's
 * modes, and drawn from no field a campaign examines, since an example from an exam in use would
 * hand its author a task shape to copy (the operator, 31 October).
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "../src/meta/filesystem.ts";
import { drafting } from "../src/examiner/draft.ts";
import { FIELDS, GRADES, LADDER, REACH } from "../src/examiner/ladder.ts";
import { systemPrompt } from "../src/examiner/prompt.ts";
import { ROOM } from "../src/kernel/compare.ts";

/** A drafting session's system prompt. */
const DRAFTING = drafting(
  {
    limits: { wallSeconds: 60, turns: 1, puts: 1 },
    id: "d-1",
    log: "/nowhere/log.jsonl",
    prompt: "a domain",
    budget: { modelTurns: null, minutes: 30, solves: 2 },
    reading: async () => [],
  },
  async (action) => await action(),
).system;

/** The domains campaigns examined by 4 November, and the field beside each, by the words that name
 *  them: buffer formulation, business records, statistical work products, trusses, ESP32 pin maps,
 *  C memory safety and event seating, and structural frames, chemistry, circuit hardware and
 *  timetabling beside them. On the operator's word of 31 October seating replaced codon recoding,
 *  which left with its neighbour molecular biology. Statistics joined on 4 November, so that the
 *  drafting prompt, rebuilt that day after the jobstat exams, holds no word of that field. */
const EXAMINED =
  /buffer|ledger|invoice|reconcil|statist|regress|cohort|survey|codebook|truss|beam|column|esp32|gpio|pin map|microcontroller|kernel|memory.safety|overflow|double.free|C11|chemi|reaction|circuit|impedance|seating|guest|timetabl|roster/i;

describe("the Examiner's ladder", () => {
  it("grades on lane 34's reach scale, word for word", () => {
    const lanes = readFileSync(".claude/skills/whole-run-investigation/references/lanes.md", "utf8");
    for (const grade of GRADES) expect(lanes).toContain(`- ${grade}`);
  });

  it("names no field a campaign examines, in the ladder or in the drafting prompt", () => {
    for (const text of [LADDER, REACH, DRAFTING]) expect(EXAMINED.exec(text)).toBeNull();
  });

  it("reaches grade 7 in each of its fields", () => {
    const fields = LADDER.split("\n\n").filter((part) => part.includes(":\n- 1:"));
    expect(fields).toHaveLength(3);
    for (const field of fields) expect(field).toContain("\n- 7: ");
  });

  it("is shown whole to a writing session, and as its scale and solver to a drafting one", () => {
    expect(systemPrompt("in-home")).toContain(LADDER);
    expect(systemPrompt("unseen")).toContain(LADDER);
    expect(DRAFTING).toContain(REACH);
    for (const { rungs } of FIELDS) for (const rung of rungs) expect(DRAFTING).not.toContain(rung);
  });

  it("tells a drafting session the floor two valid answers are compared at, and the export that measures them", () => {
    expect(DRAFTING).toContain(`${String(ROOM * 100)}%`);
    expect(DRAFTING).toContain("`objective`");
  });
});

/**
 * The Examiner's difficulty ladder: one scale with lane 34's, shown to both of the Examiner's
 * modes, and drawn from no field a campaign examines, since an example from an exam in use would
 * hand its author a task shape to copy (the operator, 31 October).
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "../src/meta/filesystem.ts";
import { drafting } from "../src/examiner/draft.ts";
import { GRADES, LADDER } from "../src/examiner/ladder.ts";
import { systemPrompt } from "../src/examiner/prompt.ts";

/** The domains campaigns examined by 31 October, and the field beside each, by the words that name
 *  them: buffer formulation, business records, trusses, ESP32 pin maps, C memory safety and event
 *  seating, and structural frames, chemistry, circuit hardware and timetabling beside them. On the
 *  operator's word of 31 October seating replaced codon recoding, which left with its neighbour
 *  molecular biology. */
const EXAMINED =
  /buffer|ledger|invoice|reconcil|truss|beam|column|esp32|gpio|pin map|microcontroller|kernel|memory.safety|overflow|double.free|C11|chemi|reaction|circuit|impedance|seating|guest|timetabl|roster/i;

describe("the Examiner's ladder", () => {
  it("grades on lane 34's reach scale, word for word", () => {
    const lanes = readFileSync(".claude/skills/whole-run-investigation/references/lanes.md", "utf8");
    for (const grade of GRADES) expect(lanes).toContain(`- ${grade}`);
  });

  it("names no field a campaign examines", () => {
    expect(EXAMINED.exec(LADDER)).toBeNull();
  });

  it("reaches grade 7 in each of its fields", () => {
    const fields = LADDER.split("\n\n").filter((part) => part.includes(":\n- 1:"));
    expect(fields).toHaveLength(3);
    for (const field of fields) expect(field).toContain("\n- 7: ");
  });

  it("is shown to a writing session and to a drafting one", () => {
    expect(systemPrompt(3, "in-home")).toContain(LADDER);
    expect(systemPrompt(undefined, "unseen")).toContain(LADDER);
    const session = drafting(
      {
        limits: { wallSeconds: 60, turns: 1, puts: 1 },
        id: "d-1",
        log: "/nowhere/log.jsonl",
        prompt: "a domain",
        reading: async () => [],
      },
      new AbortController().signal,
    );
    expect(session.system).toContain(LADDER);
  });
});

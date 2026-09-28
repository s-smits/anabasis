/**
 * The round plan's one owner: the lenient reader of `EXPERIMENT.json`, the advice it earns, and the
 * two scores that read it against the bytes the round changed and the battery that measured them.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import {
  NO_PLAN,
  type RecordedPlan,
  aimAdvice,
  capturePlan,
  familyAdvice,
  planScoreLine,
  statedRange,
} from "../src/author/experiment-plan.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const TEMPLATE = /^EXPERIMENT\.json fields, each optional: \{"gap":string/;

afterAll(cleanupScratch);

/** A workspace holding `bytes` as EXPERIMENT.json, or none. */
function workspace(bytes?: string): string {
  const dir = scratchDir("ana-experiment-plan-");
  if (bytes !== undefined) writeFileSync(join(dir, "EXPERIMENT.json"), bytes);
  return dir;
}

describe("capturePlan", () => {
  it("reads every field that reads, ignores an unknown one, and digests only what it read", () => {
    const body = {
      gap: " The last battery found no limit. ",
      change: "Hide the governing load case inside a range.",
      families: ["span", "joint", "span"],
      expectedPasses: { atLeast: 3, atMost: 8 },
    };
    const read = { ...body, gap: "The last battery found no limit.", families: ["span", "joint"] };
    const captured = capturePlan(
      workspace(JSON.stringify({ ...body, schema: "experiment-plan/v3", level: "hard" })),
    );
    expect(captured).toEqual({ plan: { ...read, digest: hashJsonValue(read) }, advice: [] });
    // A reworded unknown field is not part of the plan, so it cannot make the plan new.
    expect(capturePlan(workspace(JSON.stringify(body))).plan?.digest).toBe(captured.plan?.digest);
  });

  it("takes an empty object as a plan that states nothing, with no advice", () => {
    expect(capturePlan(workspace("{}"))).toEqual({ plan: { digest: hashJsonValue({}) }, advice: [] });
  });

  it("names each field that did not read in one line, and keeps the rest of the plan", () => {
    const captured = capturePlan(
      workspace(
        JSON.stringify({
          gap: 3,
          change: "Tighten.",
          families: ["span", ""],
          expectedPasses: { atLeast: 5, atMost: 2 },
        }),
      ),
    );
    expect(captured.plan).toEqual({ change: "Tighten.", digest: hashJsonValue({ change: "Tighten." }) });
    expect(captured.advice[0]).toBe(
      "Advice: EXPERIMENT.json fields not read: gap (a non-empty string); families (a list of family names); " +
        "expectedPasses (whole counts, atLeast no more than atMost). The rest of the plan stands.",
    );
    expect(captured.advice[1]).toMatch(TEMPLATE);
    const notAnObject = capturePlan(workspace(JSON.stringify({ expectedPasses: 4 })));
    expect(notAnObject.advice[0]).toContain("expectedPasses (an object)");
    // A range needs one bound at least, and a bound is a whole count.
    const unbounded = capturePlan(workspace(JSON.stringify({ expectedPasses: { atLeast: 1.5 } })));
    expect(unbounded.plan).toEqual({ digest: hashJsonValue({}) });
  });

  it("advises on a missing plan and on bytes that are not a plan object, and records neither", () => {
    const missing = capturePlan(workspace());
    expect(missing.plan).toBeNull();
    expect(missing.advice[0]).toBe("Advice: no EXPERIMENT.json yet.");
    expect(missing.advice[1]).toMatch(TEMPLATE);
    for (const bytes of ["{", "[]", '"plan"', JSON.stringify({ gap: "x".repeat(16_384) })]) {
      const unread = capturePlan(workspace(bytes));
      expect(unread.plan).toBeNull();
      expect(unread.advice).toEqual([
        "Advice: EXPERIMENT.json is not a JSON object under 16,384 bytes, so it is not read.",
        expect.stringMatching(TEMPLATE),
      ]);
    }
  });
});

describe("the plan's scores", () => {
  const plan = (fields: Omit<RecordedPlan, "digest">): RecordedPlan => ({
    ...fields,
    digest: hashJsonValue(fields),
  });
  const both = plan({ families: ["span"], expectedPasses: { atLeast: 5, atMost: 8 } });

  it("says nothing while the declared families match, and names each side of a miss", () => {
    expect(familyAdvice(both, ["span"])).toEqual([]);
    expect(familyAdvice(both, null)).toEqual([]);
    expect(familyAdvice({}, ["span"])).toEqual([]);
    expect(familyAdvice(plan({ families: ["span", "joint"] }), ["span", "deck"])).toEqual([
      "Advice: the plan names span, joint as changed and the public tasks changed from the adopted product in " +
        "span, deck: missed, joint named but unchanged and deck changed but not named.",
    ]);
    // A plan that names no family has changed none, so any changed family is a miss.
    expect(familyAdvice(plan({ families: [] }), ["span"])).toEqual([
      "Advice: the plan names none as changed and the public tasks changed from the adopted product in span: " +
        "missed, span changed but not named.",
    ]);
  });

  it("reads the pass range against the battery as met, below or above", () => {
    const range = plan({ expectedPasses: { atLeast: 5, atMost: 8 } });
    const line = (passed: number) => planScoreLine({ plan: range, changedFamilies: null }, passed);
    expect(line(5)).toBe("the plan expects 5–8 verified passes and the battery holds 5: met");
    expect(line(4)).toBe("the plan expects 5–8 verified passes and the battery holds 4: missed, below");
    expect(line(9)).toBe("the plan expects 5–8 verified passes and the battery holds 9: missed, above");
    const one = plan({ expectedPasses: { atMost: 1 } });
    expect(planScoreLine({ plan: one, changedFamilies: null }, 0)).toBe(
      "the plan expects at most 1 verified pass and the battery holds 0: met",
    );
  });

  it("joins both scores, and states nothing it has nothing to read against", () => {
    expect(planScoreLine({ plan: both, changedFamilies: ["span"] }, 6)).toBe(
      "the plan names span as changed and the public tasks changed from the adopted product in span: met; " +
        "the plan expects 5–8 verified passes and the battery holds 6: met",
    );
    // Before a battery, only the family score can be read.
    expect(planScoreLine({ plan: both, changedFamilies: ["span"] }, null)).toBe(
      "the plan names span as changed and the public tasks changed from the adopted product in span: met",
    );
    expect(planScoreLine({ plan: both, changedFamilies: null }, null)).toBeNull();
    expect(
      planScoreLine({ plan: plan({ gap: "No limit found." }), changedFamilies: ["span"] }, 6),
    ).toBeNull();
    expect(planScoreLine(NO_PLAN, 6)).toBeNull();
  });

  it("words a range by the bounds it states", () => {
    expect(statedRange({ atLeast: 3 })).toBe("at least 3");
    expect(statedRange({ atMost: 5 })).toBe("at most 5");
    expect(statedRange({ atLeast: 3, atMost: 5 })).toBe("3–5");
  });
});

describe("the plan's range against the aim", () => {
  const band = [0.2, 0.5] as const;
  const sizes = [5, 10] as const;
  const advise = (expectedPasses: { atLeast?: number; atMost?: number }, size: number) =>
    aimAdvice({ expectedPasses }, size, sizes, band);

  it("says where a range wholly off the aim sits, in the singular and the plural", () => {
    expect(advise({ atLeast: 4, atMost: 6 }, 6)).toEqual([
      "Advice: the plan expects 4–6 verified passes, wholly above the aim of 2 to 3 passing for a 6-task battery.",
    ]);
    expect(advise({ atLeast: 4 }, 6)).toEqual([
      "Advice: the plan expects at least 4 verified passes, wholly above the aim of 2 to 3 passing for a 6-task battery.",
    ]);
    expect(advise({ atMost: 1 }, 6)).toEqual([
      "Advice: the plan expects at most 1 verified pass, wholly below the aim of 2 to 3 passing for a 6-task battery.",
    ]);
    expect(advise({ atLeast: 0, atMost: 1 }, 10)).toEqual([
      "Advice: the plan expects 0–1 verified passes, wholly below the aim of 2 to 5 passing for a 10-task battery.",
    ]);
  });

  it("says nothing of a range that reaches the aim, of no range, or of a size the round does not take", () => {
    // A range that shares one count with the aim is not off it, whichever side the rest lies on.
    expect(advise({ atLeast: 2, atMost: 4 }, 6)).toEqual([]);
    expect(advise({ atMost: 5 }, 6)).toEqual([]);
    expect(advise({ atLeast: 3 }, 6)).toEqual([]);
    expect(advise({ atMost: 2 }, 6)).toEqual([]);
    expect(aimAdvice({ gap: "No limit found." }, 6, sizes, band)).toEqual([]);
    // A draft of a size the round refuses has no aim to be read against, and neither has a band too
    // narrow to hold a whole count at this size.
    expect(advise({ atLeast: 4, atMost: 6 }, 4)).toEqual([]);
    expect(advise({ atLeast: 4, atMost: 6 }, 11)).toEqual([]);
    expect(aimAdvice({ expectedPasses: { atLeast: 4 } }, 6, sizes, [0.2, 0.25])).toEqual([]);
  });
});

/**
 * Submit's hold: a call the controller answers before counting it. However many times it holds,
 * nothing reaches the gate, no attempt joins the record and no strike is counted, so a held
 * Builder cannot end its round as stalled by resubmitting.
 */
import { describe, expect, it } from "bun:test";
import { BuilderExecutionRecorder } from "../src/author/builder-execution.ts";
import { BuilderAuthorFeedback } from "../src/builder/author-feedback.ts";
import { type BuilderSubmitOutcome, type SubmitHold, makeSubmitTool } from "../src/gate/submit-tool.ts";

const REFUSED: BuilderSubmitOutcome = { ok: false, stage: "gates", findings: [], commit: "c0ffee" };

function submitWith(holds: (SubmitHold | null)[]) {
  const state = {
    accepted: null,
    attempts: 0,
    lastRefusal: [],
    activeTurn: 1,
    terminal: false,
    submitBound: false,
  };
  const recorder = new BuilderExecutionRecorder();
  let gateCalls = 0;
  const tool = makeSubmitTool({
    submit: () => {
      gateCalls += 1;
      return REFUSED;
    },
    hold: async () => holds.shift() ?? null,
    state,
    recorder,
    feedback: new BuilderAuthorFeedback(),
  });
  return { tool, state, recorder, gateCalls: () => gateCalls };
}

const run = async (tool: ReturnType<typeof submitWith>["tool"]) => {
  const result = await tool.execute("call", {});
  const [part] = result.content;
  return { text: part?.type === "text" ? part.text : "", details: result.details };
};

describe("submit's hold", () => {
  it("answers each held call with its reason and counts no attempt, then judges the call it releases", async () => {
    const hold: SubmitHold = {
      text: "Nothing was submitted. A review finished with findings you have not read.",
      reason: "review-unread",
    };
    const { tool, state, recorder, gateCalls } = submitWith([hold, hold]);
    for (const _ of [1, 2]) {
      const held = await run(tool);
      expect(held.text).toBe(hold.text);
      expect(held.details).toEqual({ receipt: { outcome: "blocked", reason: "review-unread" } });
    }
    expect(state.attempts).toBe(0);
    expect(gateCalls()).toBe(0);
    // With nothing to hold, the same call reaches the gate and is recorded as the first attempt.
    expect((await run(tool)).text).toStartWith("Submit 1 was refused at gates");
    expect(state.attempts).toBe(1);
    expect(gateCalls()).toBe(1);
    // Each held call returned a review's findings, so each is a review the record counts; the released
    // call returned none.
    const reviews = recorder.finish("turn-bound").authoringReviews;
    expect(reviews.map(({ turn, tool: name, adviceChars }) => [turn, name, adviceChars])).toEqual([
      [1, "submit", hold.text.length],
      [1, "submit", hold.text.length],
    ]);
  });
});

/**
 * Submit's hold: a call the controller answers before counting it. However many times it holds,
 * nothing reaches the gate, no attempt joins the record and no strike is counted, so a held
 * Builder cannot end its round as stalled by resubmitting.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { BuilderExecutionRecorder } from "../src/author/builder-execution.ts";
import { SCRATCHPAD_FILE } from "../src/author/builder-memory.ts";
import { BuilderAuthorFeedback } from "../src/builder/author-feedback.ts";
import { type BuilderSubmitOutcome, makeSubmitTool } from "../src/gate/submit-tool.ts";
import { writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

const REFUSED: BuilderSubmitOutcome = { ok: false, stage: "gates", findings: [], commit: "c0ffee" };

afterAll(cleanupScratch);

function submitWith(holds: (string | null)[], workspace = scratchDir("ana-submit-hold-")) {
  const state = {
    accepted: null,
    attempts: 0,
    lastRefusal: [],
    activeTurn: 1,
    terminal: false,
    handedBack: false,
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
    workspace,
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
  it("answers each held call with the unread review and counts no attempt, then judges the call it releases", async () => {
    const hold = "Nothing was submitted. A review finished with a blocking finding you have not read.";
    const { tool, state, recorder, gateCalls } = submitWith([hold, hold]);
    for (const _ of [1, 2]) {
      const held = await run(tool);
      expect(held.text).toBe(hold);
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
      [1, "submit", hold.length],
      [1, "submit", hold.length],
    ]);
  });

  // A one-turn round ends at its accepted submit, so a next-turn notice about notes over their limit
  // was never read by a Builder that wrote its plan and then submitted, as the round prompt asks.
  it("answers a submit made while the notes are over their limit with that notice, and judges the next", async () => {
    const workspace = scratchDir("ana-submit-notes-");
    writeFileSync(join(workspace, SCRATCHPAD_FILE), `# Next experiment\n\n${"x".repeat(2_060)}\n`);
    const { tool, state, gateCalls } = submitWith([], workspace);
    const held = await run(tool);
    expect(held.text).toBe(
      `Nothing was submitted. ${SCRATCHPAD_FILE} is 2080 bytes, over its 2000-byte limit: the next round reads its head and tail and drops the middle, so shorten it now. Then submit again.`,
    );
    expect(held.details).toEqual({ receipt: { outcome: "blocked", reason: "notes-over-cap" } });
    expect([state.attempts, gateCalls()]).toEqual([0, 0]);
    writeFileSync(join(workspace, SCRATCHPAD_FILE), "# Next experiment\n\nshorter\n");
    expect((await run(tool)).text).toStartWith("Submit 1 was refused at gates");
    expect([state.attempts, gateCalls()]).toEqual([1, 1]);
  });
});

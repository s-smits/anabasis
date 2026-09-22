import { describe, expect, it } from "bun:test";
import { runModelAttempt } from "../src/author/build-agent.ts";
import { segmentActor } from "../.claude/skills/system-path-simulation/scripts/segment-actor.mts";
import { mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { BuilderExecutionRecorder } from "../src/author/builder-execution.ts";
import {
  completedSegment,
  idleContinuation,
  runSegmentLoop,
} from "../.claude/skills/system-path-simulation/scripts/segment-loop.mts";
const FIRST_ANSWER = "first answer";

function step(role, prompt, turns = 1) {
  return { call: { role, prompt, steeringTypes: ["start-prompt"] }, turns };
}

function trailRow(toolCalls = { read: 1 }, status = "completed") {
  return { step: "builder", turn: 1, status, ms: 1, toolCalls, failedToolCalls: {} };
}

function actor(responses, trail) {
  const calls = [];
  return {
    calls,
    async agent(call) {
      calls.push(call);
      const response = responses.shift();
      if (response === undefined) throw new Error("test actor ran out of responses");
      if (response.error !== undefined) throw response.error;
      trail.push(response.row ?? trailRow());
      return response.text;
    },
  };
}

function input(steps, responses, overrides = {}) {
  const trail = [];
  const primary = actor([...responses], trail);
  return {
    primary,
    trail,
    value: {
      steps,
      maxTurns: 15,
      continuation: "continue exactly",
      primary: (gate) => ({ agent: (call) => runModelAttempt(gate, "builder", () => primary.agent(call)) }),
      trail,
      workspace: "/scratch/workspace",
      campaignDir: "/scratch/campaign",
      handover: null,
      classifyError: () => "script-or-setup-fault",
      now: () => 100,
      ...overrides,
    },
  };
}

describe("segment turn and budget loop", () => {
  it("completes one step and preserves its start call", async () => {
    const fixture = input([step("builder", "start")], [{ text: "answer" }]);
    const output = await runSegmentLoop(fixture.value);
    expect(output).toMatchObject({
      spent: 1,
      stopped: null,
      results: [{ role: "builder", turnsSpent: 1, outcome: "completed", text: "answer" }],
    });
    expect(fixture.primary.calls).toEqual([
      { role: "builder", prompt: "start", steeringTypes: ["start-prompt"] },
    ]);
    expect(completedSegment(fixture.value.steps, output)).toBe(true);
  });

  it("uses the declared continuation with continuation steering identity", async () => {
    const fixture = input(
      [step("builder", "start", 2)],
      [{ text: "working" }, { text: "finished", row: trailRow({ write: 1 }) }],
    );
    const output = await runSegmentLoop(fixture.value);
    expect(output.results[0]).toMatchObject({ turnsSpent: 2, outcome: "completed", text: "finished" });
    expect(fixture.primary.calls[1]).toEqual({
      role: "builder",
      prompt: "continue exactly",
      steeringTypes: ["continuation"],
    });
  });

  it("settles after the first idle continuation", async () => {
    const notes = [];
    const fixture = input(
      [step("builder", "start", 5)],
      [{ text: "working" }, { text: "already complete", row: trailRow({}) }, { text: "must not run" }],
      { note: (line) => notes.push(line) },
    );
    const output = await runSegmentLoop(fixture.value);
    expect(output.results[0]).toMatchObject({ turnsSpent: 2, outcome: "step-settled" });
    expect(output.spent).toBe(2);
    expect(fixture.primary.calls).toHaveLength(2);
    expect(notes.some((line) => line.includes("settled on turn 2"))).toBe(true);
  });

  it("does not settle while a continuation still calls a tool", async () => {
    const fixture = input(
      [step("builder", "start", 3)],
      [
        { text: "one" },
        { text: "two", row: trailRow({ read: 1 }) },
        { text: "three", row: trailRow({ write: 1 }) },
      ],
    );
    const output = await runSegmentLoop(fixture.value);
    expect(output.results[0]).toMatchObject({ turnsSpent: 3, outcome: "completed", text: "three" });
  });

  it("does not settle when the continuation attempted a failed tool call", async () => {
    const fixture = input(
      [step("builder", "start", 3)],
      [
        { text: "one" },
        { text: "two", row: { ...trailRow({}), failedToolCalls: { write: 1 } } },
        { text: "three", row: trailRow({ write: 1 }) },
      ],
    );
    const output = await runSegmentLoop(fixture.value);
    expect(output.results[0]).toMatchObject({ turnsSpent: 3, outcome: "completed", text: "three" });
  });

  it("does not reuse a stale trace row to settle a later continuation", async () => {
    const trail = [trailRow({})];
    const calls = [];
    const primary = {
      async agent(call) {
        calls.push(call);
        return calls.length === 1 ? "one" : calls.length === 2 ? "two" : "three";
      },
    };
    const output = await runSegmentLoop({
      steps: [step("builder", "start", 3)],
      maxTurns: 15,
      continuation: "continue exactly",
      primary: (gate) => ({ agent: (call) => runModelAttempt(gate, "builder", () => primary.agent(call)) }),
      trail,
      workspace: "/scratch/workspace",
      campaignDir: "/scratch/campaign",
      handover: null,
      classifyError: () => "script-or-setup-fault",
      now: () => 100,
    });
    expect(output.results[0]).toMatchObject({ turnsSpent: 3, outcome: "completed", text: "three" });
  });

  it("stops inside one step when the global budget is reached", async () => {
    const fixture = input([step("builder", "start", 3)], [{ text: "one" }], { maxTurns: 1 });
    const output = await runSegmentLoop(fixture.value);
    expect(output).toMatchObject({ spent: 1, stopped: "turn-budget-reached" });
    expect(output.results[0]).toMatchObject({ turnsSpent: 1, outcome: "completed" });
    expect(completedSegment(fixture.value.steps, output)).toBe(false);
  });

  it("shares one budget across stage boundaries", async () => {
    const fixture = input(
      [step("brief", "first"), step("builder", "second", 2)],
      [{ text: FIRST_ANSWER }, { text: "second answer" }],
      { maxTurns: 2 },
    );
    const output = await runSegmentLoop(fixture.value);
    expect(output.spent).toBe(2);
    expect(output.stopped).toBe("turn-budget-reached");
    expect(output.results.map((row) => row.turnsSpent)).toEqual([1, 1]);
  });

  it("completes when the exact budget ends with the final stage", async () => {
    const steps = [step("brief", "first"), step("builder", "second")];
    const fixture = input(steps, [{ text: FIRST_ANSWER }, { text: "second answer" }], { maxTurns: 2 });
    const output = await runSegmentLoop(fixture.value);
    expect(output).toMatchObject({ spent: 2, stopped: null });
    expect(completedSegment(steps, output)).toBe(true);
  });

  it("does not open a later stage after the budget is spent", async () => {
    const fixture = input([step("brief", "first"), step("builder", "second")], [{ text: FIRST_ANSWER }], {
      maxTurns: 1,
    });
    const output = await runSegmentLoop(fixture.value);
    expect(output.results).toHaveLength(1);
    expect(fixture.primary.calls).toHaveLength(1);
    expect(output.stopped).toBe("turn-budget-reached");
  });

  it.each([
    { stepTurns: 1, maxTurns: 6, attempts: 1, stopped: "step-budget-reached" },
    { stepTurns: 2, maxTurns: 1, attempts: 1, stopped: "turn-budget-reached" },
    { stepTurns: 2, maxTurns: 2, attempts: 2, stopped: null },
  ])(
    "charges internal retries at the real backend boundary: %j",
    async ({ stepTurns, maxTurns, attempts, stopped }) => {
      let calls = 0;
      let primary;
      const workspace = mkdtempSync(join(tmpdir(), "ana-segment-turn-"));
      const waits = [];
      const recorder = new BuilderExecutionRecorder();
      const session = {
        backend: "claude",
        async runTurn() {
          calls += 1;
          return calls === 1
            ? {
                status: "aborted",
                errorMessages: ["transient disconnect"],
                toolCalls: { total: 12, failed: 0, byName: { Bash: 12 }, failedByName: {} },
              }
            : { status: "completed", assistantText: "recovered" };
        },
        abort() {},
        async dispose() {},
      };
      const fixture = input([step("builder", "repair", stepTurns)], [], {
        maxTurns,
        primary: (attemptGate) => {
          primary = segmentActor({
            open: async () => session,
            workspace,
            maxTurns,
            attemptGate,
            recorder,
            waitMs: async (ms) => {
              waits.push(ms);
            },
          });
          return primary;
        },
      });
      try {
        const output = await runSegmentLoop(fixture.value);
        expect(output).toMatchObject({ spent: attempts, stopped });
        expect(output.results[0]).toMatchObject({ turnsSpent: attempts, outcome: stopped ?? "completed" });
        expect(calls).toBe(attempts);
        expect(waits).toEqual(attempts === 1 ? [] : [120_000]);
        expect(recorder.finish("test").turns).toBe(attempts);
      } finally {
        await primary?.dispose();
        rmSync(workspace, { recursive: true, force: true });
      }
    },
  );
});

describe("segment handover", () => {
  it("stops before stage two when the controller refuses", async () => {
    const fixture = input([step("brief", "first"), step("builder", "second")], [{ text: FIRST_ANSWER }], {
      handover: () => ({ ok: false, reason: "selector held" }),
    });
    const output = await runSegmentLoop(fixture.value);
    expect(output.stopped).toBe("handover-refused");
    expect(output.handovers).toEqual([
      { afterStep: 0, ok: false, reason: "selector held", wroteNextPrompt: false },
    ]);
    expect(fixture.primary.calls).toHaveLength(1);
  });

  it("replaces the next prompt with the controller-produced transition", async () => {
    const fixture = input(
      [step("brief", "operator first"), step("builder", "operator second")],
      [{ text: FIRST_ANSWER }, { text: "second answer" }],
      { handover: () => ({ ok: true, reason: "selected B", nextPrompt: "You were in A. Now B." }) },
    );
    const output = await runSegmentLoop(fixture.value);
    expect(output.handovers[0]).toMatchObject({ ok: true, wroteNextPrompt: true });
    expect(fixture.primary.calls[1].prompt).toBe("You were in A. Now B.");
  });

  it("keeps the operator prompt when the handover returns no replacement", async () => {
    const fixture = input(
      [step("brief", "first"), step("builder", "operator second")],
      [{ text: FIRST_ANSWER }, { text: "second answer" }],
      { handover: () => ({ ok: true, reason: "through" }) },
    );
    await runSegmentLoop(fixture.value);
    expect(fixture.primary.calls[1].prompt).toBe("operator second");
  });

  it("passes the exact completed stage and trail to the handover", async () => {
    let context;
    const fixture = input(
      [step("brief", "first"), step("builder", "second")],
      [{ text: FIRST_ANSWER }, { text: "second answer" }],
      {
        handover: (value) => {
          context = value;
          return { ok: true, reason: "through" };
        },
      },
    );
    await runSegmentLoop(fixture.value);
    expect(context).toMatchObject({
      index: 0,
      role: "brief",
      text: FIRST_ANSWER,
      turnsSpent: 1,
      workspace: "/scratch/workspace",
      campaignDir: "/scratch/campaign",
    });
    expect(context.trail).toBe(fixture.trail);
  });

  it("runs no handover after the last stage", async () => {
    let calls = 0;
    const fixture = input([step("builder", "only")], [{ text: "answer" }], {
      handover: () => {
        calls += 1;
        return { ok: true, reason: "unused" };
      },
    });
    await runSegmentLoop(fixture.value);
    expect(calls).toBe(0);
  });

  it.each([
    null,
    {},
    { ok: "yes", reason: "through" },
    { ok: true, reason: "" },
    { ok: true, reason: "through", nextPrompt: 7 },
    { ok: true, reason: "through", nextPrompt: "  " },
    { ok: true, reason: "through", extra: "unbound" },
  ])("refuses malformed handover verdict %#", async (verdict) => {
    const fixture = input([step("brief", "first"), step("builder", "second")], [{ text: FIRST_ANSWER }], {
      handover: () => verdict,
    });
    const output = await runSegmentLoop(fixture.value);
    expect(output.stopped).toBe("handover-fault");
    expect(output.handovers[0]).toMatchObject({
      ok: false,
      wroteNextPrompt: false,
      reason: "script-or-setup-fault — handover 0 returned an invalid verdict",
    });
  });

  it("records a handover exception as a script fault", async () => {
    const fixture = input([step("brief", "first"), step("builder", "second")], [{ text: FIRST_ANSWER }], {
      handover: () => {
        throw new Error("selector setup broke");
      },
    });
    const output = await runSegmentLoop(fixture.value);
    expect(output.stopped).toBe("handover-fault");
    expect(output.handovers[0].reason).toBe("script-or-setup-fault — selector setup broke");
  });
});

describe("segment error classification and completion", () => {
  it("records a script/setup fault separately", async () => {
    const fixture = input([step("builder", "start")], [{ error: new Error("bad fixture") }]);
    const output = await runSegmentLoop(fixture.value);
    expect(output).toMatchObject({ spent: 1, stopped: null });
    expect(output.results[0]).toMatchObject({
      turnsSpent: 1,
      outcome: "script-or-setup-fault",
      detail: "bad fixture",
    });
    expect(completedSegment(fixture.value.steps, output)).toBe(false);
  });

  it("records an injected typed provider failure as a non-result", async () => {
    const typed = new Error("provider unavailable");
    const fixture = input([step("builder", "start")], [{ error: typed }], {
      classifyError: (error) => (error === typed ? "non-result" : "script-or-setup-fault"),
    });
    const output = await runSegmentLoop(fixture.value);
    expect(output.results[0]).toMatchObject({ outcome: "non-result", detail: "provider unavailable" });
  });

  it("includes a failed backend attempt in the stage's turn count", async () => {
    const fixture = input(
      [step("builder", "start", 3)],
      [{ text: "working" }, { error: new Error("continuation broke") }],
    );
    const output = await runSegmentLoop(fixture.value);
    expect(output.spent).toBe(2);
    expect(output.results[0]).toMatchObject({ turnsSpent: 2, outcome: "script-or-setup-fault" });
  });

  it("does not call beforeTurn after a terminal error", async () => {
    const turns = [];
    const fixture = input(
      [step("brief", "first"), step("builder", "second")],
      [{ error: new Error("stop") }],
      { beforeTurn: (role) => turns.push(role) },
    );
    await runSegmentLoop(fixture.value);
    expect(turns).toEqual(["brief"]);
  });

  it("requires every declared step for completed evidence", () => {
    const steps = [step("brief", "first"), step("builder", "second")];
    expect(
      completedSegment(steps, {
        results: [{ role: "brief", ms: 1, turnsSpent: 1, outcome: "completed", text: "done" }],
        handovers: [],
        spent: 1,
        stopped: null,
      }),
    ).toBe(false);
  });

  it("rejects a stopped segment even when every step has a completed row", () => {
    const steps = [step("builder", "only")];
    expect(
      completedSegment(steps, {
        results: [{ role: "builder", ms: 1, turnsSpent: 1, outcome: "completed", text: "done" }],
        handovers: [],
        spent: 1,
        stopped: "turn-budget-reached",
      }),
    ).toBe(false);
  });

  it("requires completed rows to match the declared step order", () => {
    const steps = [step("brief", "first"), step("builder", "second")];
    expect(
      completedSegment(steps, {
        results: [
          { role: "builder", ms: 1, turnsSpent: 1, outcome: "completed", text: "wrong first role" },
          { role: "brief", ms: 1, turnsSpent: 1, outcome: "completed", text: "wrong second role" },
        ],
        handovers: [],
        spent: 2,
        stopped: null,
      }),
    ).toBe(false);
  });

  it("recognises only a completed tool-free row as idle", () => {
    expect(idleContinuation(trailRow({}))).toBe(true);
    expect(idleContinuation(trailRow({ read: 1 }))).toBe(false);
    expect(idleContinuation({ ...trailRow({}), failedToolCalls: { write: 1 } })).toBe(false);
    expect(idleContinuation(trailRow({}, "failed"))).toBe(false);
    expect(idleContinuation(undefined)).toBe(false);
  });
});

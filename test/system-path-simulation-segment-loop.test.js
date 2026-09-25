import { describe, expect, it } from "bun:test";
import { runModelAttempt } from "../src/author/build-agent.ts";
import { segmentActor } from "../.claude/skills/system-path-simulation/scripts/segment-actor.mts";
import { mkdtempSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { BuilderExecutionRecorder } from "../src/author/builder-execution.ts";
import {
  completedSegment,
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
      // `row: null` is a turn that wrote no trace row.
      if (response.row !== null) trail.push(response.row ?? trailRow());
      return response.text;
    },
  };
}

function input(steps, responses, overrides = {}, trail = []) {
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

  // A continuation settles its step only when that turn itself wrote a completed, tool-free row.
  it.each([
    {
      name: "settles after a tool-free completed continuation",
      rows: [undefined, trailRow({})],
      settles: true,
    },
    { name: "keeps going after a continuation that called a tool", rows: [undefined, trailRow({ read: 1 })] },
    {
      name: "keeps going after a continuation with a failed tool call",
      rows: [undefined, { ...trailRow({}), failedToolCalls: { write: 1 } }],
    },
    { name: "keeps going after a continuation whose turn failed", rows: [undefined, trailRow({}, "failed")] },
    {
      name: "keeps going when the continuation wrote no row beside a stale idle one",
      rows: [null, null, null],
      stale: [trailRow({})],
    },
  ])("$name", async ({ rows, settles = false, stale = [] }) => {
    const notes = [];
    const [first, second, third = trailRow({ write: 1 })] = rows;
    const fixture = input(
      [step("builder", "start", 3)],
      [
        { text: "one", row: first },
        { text: "two", row: second },
        { text: "three", row: third },
      ],
      { note: (line) => notes.push(line) },
      [...stale],
    );
    const output = await runSegmentLoop(fixture.value);
    if (settles) {
      expect(output.results[0]).toMatchObject({ turnsSpent: 2, outcome: "step-settled" });
      expect(output.spent).toBe(2);
      expect(fixture.primary.calls).toHaveLength(2);
      expect(notes.some((line) => line.includes("settled on turn 2"))).toBe(true);
    } else {
      expect(output.results[0]).toMatchObject({ turnsSpent: 3, outcome: "completed", text: "three" });
    }
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

  it.each([
    [
      "replaces it with the controller-produced transition",
      { ok: true, reason: "selected B", nextPrompt: "You were in A. Now B." },
      "You were in A. Now B.",
    ],
    [
      "keeps the operator prompt when the verdict carries none",
      { ok: true, reason: "through" },
      "operator second",
    ],
  ])("given a passing handover, the next prompt %s", async (_name, verdict, expected) => {
    const fixture = input(
      [step("brief", "operator first"), step("builder", "operator second")],
      [{ text: FIRST_ANSWER }, { text: "second answer" }],
      { handover: () => verdict },
    );
    const output = await runSegmentLoop(fixture.value);
    expect(output.handovers[0]).toMatchObject({ ok: true, wroteNextPrompt: "nextPrompt" in verdict });
    expect(fixture.primary.calls[1].prompt).toBe(expected);
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
  it.each([
    [
      "an unclassified error as a script or setup fault",
      () => "script-or-setup-fault",
      "script-or-setup-fault",
    ],
    ["a typed provider failure as a non-result", () => "non-result", "non-result"],
  ])("records %s, and the segment as incomplete", async (_name, classifyError, outcome) => {
    const fixture = input([step("builder", "start")], [{ error: new Error("provider unavailable") }], {
      classifyError,
    });
    const output = await runSegmentLoop(fixture.value);
    expect(output).toMatchObject({ spent: 1, stopped: null });
    expect(output.results[0]).toMatchObject({ turnsSpent: 1, outcome, detail: "provider unavailable" });
    expect(completedSegment(fixture.value.steps, output)).toBe(false);
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

  const done = (role) => ({ role, ms: 1, turnsSpent: 1, outcome: "completed", text: "done" });
  it.each([
    ["a declared step has no row", [done("brief")], null],
    [
      "the segment stopped although every step completed",
      [done("brief"), done("builder")],
      "turn-budget-reached",
    ],
    ["completed rows run out of the declared order", [done("builder"), done("brief")], null],
  ])("withholds completed evidence when %s", (_name, results, stopped) => {
    const steps = [step("brief", "first"), step("builder", "second")];
    expect(completedSegment(steps, { results, handovers: [], spent: results.length, stopped })).toBe(false);
  });
});

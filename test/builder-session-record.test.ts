/**
 * The execution record a session leaves: the checkpoints written while it is still running, and the
 * one settled record naming its turns, its tool split, its spend and every submission it made.
 *
 * A session that is killed mid-turn keeps whatever reached disk, so most of these cases are about
 * what is durable before the turn that produced it has ended.
 */
import { describe, expect, it } from "bun:test";

import type { BuilderExecutionEvidence } from "../src/author/builder-execution.ts";
import { runBuilderSession } from "../src/author/builder-session.ts";
import { BUILDER_TRANSCRIPT_POINTER_FILE } from "../src/builder/session-transcript.ts";
import { mkdtempSync, readFileSync, readdirSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { SCRIPTED_SESSION_ID, required, scriptedSession, toolDouble } from "./helpers/doubles.ts";
import {
  ACCEPTED,
  INPUT,
  REFUSED,
  type TurnScript,
  deps,
  scriptedOpener,
  toolNamed,
} from "./helpers/builder-session-script.ts";

describe("the Builder execution record", () => {
  it("checkpoints an in-flight execution record at every turn and submission", async () => {
    const outcomes = [REFUSED, ACCEPTED];
    const { open } = scriptedOpener([
      () => undefined, // turn 1: authoring, no submit yet
      async (submit) => {
        await submit.execute("t1", {});
        return undefined;
      },
      async (submit) => {
        await submit.execute("t2", {});
        return undefined;
      },
    ]);
    const checkpoints: BuilderExecutionEvidence[] = [];
    let settled: BuilderExecutionEvidence | undefined;
    await runBuilderSession(INPUT, {
      ...deps(open, () => required(outcomes.shift(), "the next scripted record outcome")),
      onCheckpoint: (evidence) => checkpoints.push(evidence),
      onExecution: (evidence) => {
        settled = evidence;
      },
    });
    // Three turn checkpoints and two submit checkpoints, in event order.
    expect(checkpoints).toHaveLength(5);
    expect(checkpoints.every((c) => c.outcome === "in-flight")).toBe(true);
    // The submit checkpoint lands while its turn is still running: the refusal reaches disk
    // before the turn settles, so a kill mid-turn keeps every completed submission.
    expect(checkpoints[1]?.submits).toHaveLength(1);
    expect(checkpoints[1]?.turns).toBe(1);
    expect(settled?.outcome).toBe("recorded");
    expect(settled?.submits).toHaveLength(2);
  });

  it("checkpoints liveness inside a turn from the first tool call, at most once per interval", async () => {
    // An Opus run on 2026-08-22: two hours into one turn under a 24-hour wall, the only sign of life
    // was file mtimes. Three tool calls inside one turn now write one in-flight checkpoint
    // (the interval keeps the next two off disk) carrying the latest tool time.
    const open = async () =>
      scriptedSession(async ({ onEvent }) => {
        for (const toolName of ["Read", "Bash", "Edit"]) onEvent?.({ type: "tool_started", toolName });
        return { status: "completed", assistantText: "worked" };
      });
    const checkpoints: BuilderExecutionEvidence[] = [];
    await runBuilderSession(
      { ...INPUT, maxTurns: 1 },
      { ...deps(open, () => ACCEPTED), onCheckpoint: (evidence) => checkpoints.push(evidence) },
    );
    // One liveness checkpoint inside the turn, then the turn's own.
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0]).toMatchObject({ outcome: "in-flight", turns: 0 });
    expect(checkpoints[0]?.firstToolMs).toEqual(expect.any(Number));
    expect(checkpoints[1]).toMatchObject({ outcome: "in-flight", turns: 1 });
  });

  it("checkpoints after every hosted tool return inside one turn that never ends", async () => {
    // An Opus run on 2026-08-23: one Claude turn open for eleven hours, twelve correctness_check
    // calls, no submit, and no execution record on disk until the turn ended.
    const checkTool = toolDouble({
      name: "correctness_check",
      description: "check",
      async execute() {
        return { content: [{ type: "text", text: "refused" }] };
      },
    });
    const seen: number[] = [];
    const { open } = scriptedOpener([
      async (_submit, tools) => {
        const check = required(toolNamed(tools, "correctness_check"), "the hosted check tool");
        for (const id of ["c1", "c2", "c3"]) {
          await check.execute(id, {});
          seen.push(checkpoints.length);
        }
        return undefined;
      },
      async (submit) => {
        await submit.execute("t1", {});
        return undefined;
      },
    ]);
    const checkpoints: BuilderExecutionEvidence[] = [];
    await runBuilderSession(INPUT, {
      ...deps(open, () => ACCEPTED, [checkTool]),
      onCheckpoint: (evidence) => checkpoints.push(evidence),
    });
    // One checkpoint per hosted call, written while the turn is still open.
    expect(seen).toEqual([1, 2, 3]);
    expect(checkpoints[2]?.customCalls).toHaveLength(3);
    expect(checkpoints[2]?.turns).toBe(0);
  });

  // The pr179 run failed on a provider limit after 121.8 minutes of authoring; the transcript
  // carried usage on every assistant row while the execution record held null throughout. The
  // spend a provider reports on a failed turn must still reach the execution record.
  it("a failed turn's provider usage still reaches the execution record", async () => {
    const usage = { inputTokens: 7, outputTokens: 3, totalTokens: 10, costUsd: 0.01 };
    const open = async () =>
      scriptedSession(async ({ onEvent }) => {
        onEvent?.({ type: "turn_failed", errorMessage: "provider 429", usage });
        return { status: "failed", errorMessages: ["provider 429"], assistantText: "" };
      });
    let evidence: BuilderExecutionEvidence | undefined;
    await expect(
      runBuilderSession(INPUT, { ...deps(open, () => ACCEPTED), onExecution: (e) => (evidence = e) }),
    ).rejects.toThrow(/turn failed/);
    // Each of the four attempts (the turn plus its three retries) reported the same spend.
    expect(evidence?.usage).toMatchObject({
      inputTokens: 28,
      outputTokens: 12,
      costUsd: 0.04,
      reportedTurns: 4,
    });
  });

  it("settles one execution record: turn tally, tool split, and the repeated submissions", async () => {
    const completed: BuilderExecutionEvidence[] = [];
    const { open } = scriptedOpener([
      async (submit) => {
        await submit.execute("t1", {});
        return {
          toolCalls: {
            byName: { Read: 3, context: 1, submit: 1 },
            failedByName: { Read: 1 },
            failed: 1,
            total: 5,
          },
        };
      },
      async (submit) => {
        await submit.execute("t2", {});
        return { toolCalls: { byName: { Edit: 2, submit: 1 }, failedByName: {}, failed: 0, total: 3 } };
      },
    ]);
    await runBuilderSession(
      { ...INPUT, maxTurns: 3 },
      { ...deps(open, () => REFUSED), onExecution: (evidence) => completed.push(evidence) },
    );
    const evidence = completed[0];
    expect(completed).toHaveLength(1);
    expect(evidence).toMatchObject({
      schema: "builder-execution/v5",
      backend: "claude",
      turns: 3,
      outcome: "turn-bound",
      repeatedFindingSubmits: 1,
      unchangedTreeSubmits: 1,
    });
    // custom counts the controller's own roster; everything else the turn reported is the
    // backend's native workspace contract, which no path-record row sees.
    expect(evidence?.toolCalls).toMatchObject({ total: 8, failed: 1, custom: 3, native: 5 });
    expect(evidence?.toolCalls.byName).toEqual({ Read: 3, context: 1, submit: 2, Edit: 2 });
    // The one failed call, by name: an aggregate says how much the session fought, a name says with what.
    expect(evidence?.failedByName).toEqual({ Read: 1 });
    expect(evidence?.submits.map((s) => s.ordinal)).toEqual([1, 2]);
    expect(evidence?.submits[0]).toMatchObject({
      repeatedFindings: null,
      findingsDelta: null,
      workspaceChanged: null,
    });
    expect(evidence?.submits[1]).toMatchObject({
      repeatedFindings: true,
      findingsDelta: { carried: 1, resolved: 0, introduced: 0 },
      workspaceChanged: false,
    });
    expect(evidence?.submits[1]?.findingCodes).toEqual(["missing-bundle-file"]);
    // Nothing reported spend, so every field stays unknown instead of reading as a free session.
    expect(evidence?.usage).toEqual({
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      reportedTurns: 0,
      estimatedTurns: 0,
    });
  });

  it("records ordered safe custom-tool intent without arguments or result text", async () => {
    const completed: BuilderExecutionEvidence[] = [];
    const inspectTool = toolDouble({
      name: "harness_inspect",
      description: "inspect",
      async execute() {
        return {
          content: [{ type: "text", text: "private-result-text" }],
          details: { receipt: { outcome: "clear", findings: 0, resultDigest: "safe-result-digest" } },
        };
      },
    });
    const trialTool = toolDouble({
      name: "harness_trial",
      description: "trial",
      async execute() {
        throw new Error("private-trial-error");
      },
    });
    const { open } = scriptedOpener([
      async (submit, tools) => {
        const inspect = required(toolNamed(tools, "harness_inspect"), "the inspect tool");
        const trial = required(toolNamed(tools, "harness_trial"), "the trial tool");
        await inspect.execute("inspect-1", { action: "task", taskId: "public-task-7" });
        await trial.execute("trial-1", { taskId: "public-task-7" }).catch(() => undefined);
        await submit.execute("submit-1", {});
        return {
          toolCalls: {
            byName: { harness_inspect: 1, harness_trial: 1, submit: 1 },
            failedByName: { harness_trial: 1 },
            failed: 1,
            total: 3,
          },
        };
      },
    ]);
    await runBuilderSession(INPUT, {
      ...deps(open, () => ACCEPTED, [inspectTool, trialTool]),
      onExecution: (evidence) => completed.push(evidence),
    });
    expect(completed[0]?.customCalls).toMatchObject([
      {
        sequence: 1,
        turn: 1,
        tool: "harness_inspect",
        action: "task",
        target: { taskId: "public-task-7" },
        dispatchOutcome: "returned",
        semantic: { outcome: "clear", findings: 0, resultDigest: "safe-result-digest" },
      },
      {
        sequence: 2,
        turn: 1,
        tool: "harness_trial",
        action: "run",
        target: { taskId: "public-task-7" },
        dispatchOutcome: "threw",
      },
      {
        sequence: 3,
        turn: 1,
        tool: "submit",
        action: "submit",
        target: {},
        dispatchOutcome: "returned",
      },
    ]);
    expect(completed[0]?.customCallsOmitted).toBe(0);
    const serialised = JSON.stringify(completed[0]);
    for (const refused of ["do-not-record", "private-result-text", "private-trial-error"]) {
      expect(serialised).not.toContain(refused);
    }
  });

  // Run 53: the Claude backend reports roster tools as `mcp__harness__<name>`; the recorder
  // matched only bare names and recorded custom 0 of 63 while the trace held 11 roster calls.
  it("counts a prefixed roster tool as custom, not native", async () => {
    const completed: BuilderExecutionEvidence[] = [];
    const { open } = scriptedOpener([
      async (submit) => {
        await submit.execute("t1", {});
        return {
          toolCalls: {
            byName: { mcp__harness__context: 4, mcp__harness__submit: 1, Read: 6 },
            failedByName: {},
            failed: 0,
            total: 11,
          },
        };
      },
    ]);
    await runBuilderSession(
      { ...INPUT, maxTurns: 1 },
      { ...deps(open, () => REFUSED), onExecution: (evidence) => completed.push(evidence) },
    );
    expect(completed[0]?.toolCalls).toMatchObject({ total: 11, custom: 5, native: 6 });
  });

  it("settles the execution record even when the turn loop throws", async () => {
    const completed: BuilderExecutionEvidence[] = [];
    const failing: TurnScript = () => ({ status: "failed", errorMessages: ["boom"] });
    const { open } = scriptedOpener([failing, failing, failing, failing]);
    await expect(
      runBuilderSession(INPUT, {
        ...deps(open, () => ACCEPTED),
        onExecution: (evidence) => completed.push(evidence),
      }),
    ).rejects.toThrow(/turn failed/);
    // One authoring turn, four provider attempts: the retries are folded as the turns they were.
    expect(completed[0]).toMatchObject({ outcome: "turn-non-result", turns: 4, submits: [] });
  });

  it("names the transcript as the session opens, once, before its first turn throws", async () => {
    const transcriptDir = mkdtempSync(join(tmpdir(), "ana-session-pointer-"));
    const failing: TurnScript = () => ({ status: "failed", errorMessages: ["boom"] });
    const { open } = scriptedOpener([failing, failing, failing, failing]);
    await expect(runBuilderSession(INPUT, { ...deps(open, () => REFUSED), transcriptDir })).rejects.toThrow(
      /turn failed/,
    );
    // One pointer for the one session, written before any turn attested an identity.
    expect(readdirSync(transcriptDir).filter((name) => name.startsWith("builder-transcript"))).toEqual([
      BUILDER_TRANSCRIPT_POINTER_FILE,
    ]);
    const pointer = JSON.parse(readFileSync(join(transcriptDir, BUILDER_TRANSCRIPT_POINTER_FILE), "utf8"));
    expect(pointer).toMatchObject({ sessionId: SCRIPTED_SESSION_ID, transport: "claude", warnings: [] });
    expect(readFileSync(pointer.path, "utf8")).toContain('"kind":"prompt"');
  });
});

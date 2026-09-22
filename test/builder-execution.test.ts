import { describe, expect, it } from "bun:test";
import { BuilderExecutionRecorder, isCandidateSubmit } from "../src/author/builder-execution.ts";
import { turnEventRecorder } from "../src/author/builder-turn-loop.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import { isCurrentExecutionRecord } from "../tools/outcome/builder-execution-current.ts";

const commit = (letter: string) => letter.repeat(40);

describe("builder execution submission events", () => {
  it("retains a captured proposal on refusal and rejects a changed digest through the strict reader", () => {
    const recorder = new BuilderExecutionRecorder(Date.now());
    const proposal = {
      scope: "product" as const,
      target: { comparator: "at-least" as const, verifiedPasses: 0 },
      gap: "Public gap",
      change: "Proposed repair",
      expectedResult: "Next measured result",
    };
    recorder.recordSubmit({
      turn: 1,
      outcome: "refused",
      stage: "bundle",
      commit: commit("a"),
      findings: [],
      terminal: false,
      experimentProposal: { ...proposal, digest: hashJsonValue(proposal) },
    });
    const evidence = recorder.finish("turn-bound");
    expect(isCurrentExecutionRecord(evidence)).toBe(true);
    expect(evidence.submits[0]?.experimentProposal).toEqual({ ...proposal, digest: hashJsonValue(proposal) });
    const altered = structuredClone(evidence);
    altered.submits[0]!.experimentProposal!.gap = "A different proposal";
    expect(isCurrentExecutionRecord(altered)).toBe(false);
    delete altered.submits[0]!.experimentProposal;
    expect(isCurrentExecutionRecord(altered)).toBe(true);
  });

  it("records the host workshop action identity from the closed tool receipt", () => {
    const recorder = new BuilderExecutionRecorder(Date.now());
    const sequence = recorder.customToolStarted("verifier_workshop", { action: "run" });
    recorder.customToolFinished(sequence, "returned", {
      details: {
        receipt: {
          outcome: "completed",
          resultDigest: "result-digest",
          workshopSequence: 7,
        },
      },
    });

    expect(recorder.finish("turn-bound").customCalls[0]).toMatchObject({
      sequence: 1,
      semantic: {
        outcome: "completed",
        resultDigest: "result-digest",
        workshopSequence: 7,
      },
    });
  });

  it("keeps a controller terminal in the raw rows but excludes it from candidate trees", () => {
    const recorder = new BuilderExecutionRecorder(Date.now());
    recorder.recordSubmit({
      kind: "candidate",
      turn: 1,
      outcome: "refused",
      stage: "bundle",
      commit: commit("a"),
      findings: [],
      terminal: false,
    });
    recorder.recordSubmit({
      kind: "candidate",
      turn: 2,
      outcome: "refused",
      stage: "gates",
      commit: commit("b"),
      findings: [],
      terminal: false,
    });
    recorder.recordSubmit({
      kind: "controller-terminal",
      turn: 3,
      outcome: "refused",
      stage: "gates",
      commit: "budget-limited",
      findings: [],
      terminal: true,
    });

    const evidence = recorder.finish("terminal-refusal");
    expect(evidence.schema).toBe("builder-execution/v5");
    expect(evidence.submits).toHaveLength(3);
    expect(evidence.submits.map((row) => row.kind)).toEqual([
      "candidate",
      "candidate",
      "controller-terminal",
    ]);
    expect(evidence.submits.at(-1)).toMatchObject({ commit: "budget-limited", terminal: true });
    expect(evidence.uniqueCandidateTrees).toBe(2);
    expect(evidence.firstSubmitMs).not.toBeNull();
  });

  it("counts a real candidate that happens to terminate, while kind helpers stay schema-blind", () => {
    expect(isCandidateSubmit({ kind: "candidate" })).toBe(true);
    expect(isCandidateSubmit({ kind: "controller-terminal" })).toBe(false);

    const recorder = new BuilderExecutionRecorder(Date.now());
    recorder.recordSubmit({
      kind: "candidate",
      turn: 1,
      outcome: "refused",
      stage: "gates",
      commit: commit("c"),
      findings: [],
      terminal: true,
    });
    const evidence = recorder.finish("terminal-refusal");
    expect(evidence.uniqueCandidateTrees).toBe(1);
    expect(evidence.submits[0]).toMatchObject({ kind: "candidate", terminal: true, commit: commit("c") });
  });

  it("does not let a controller terminal become the next candidate's predecessor", () => {
    const recorder = new BuilderExecutionRecorder(Date.now());
    recorder.recordSubmit({
      kind: "candidate",
      turn: 1,
      outcome: "refused",
      stage: "bundle",
      commit: commit("a"),
      findings: [],
      terminal: false,
    });
    recorder.recordSubmit({
      kind: "controller-terminal",
      turn: 2,
      outcome: "refused",
      stage: "gates",
      commit: "budget-limited",
      findings: [],
      terminal: true,
    });
    recorder.recordSubmit({
      kind: "candidate",
      turn: 3,
      outcome: "refused",
      stage: "bundle",
      commit: commit("b"),
      findings: [],
      terminal: false,
    });

    const rows = recorder.finish("turn-bound").submits;
    expect(rows[1]).toMatchObject({
      kind: "controller-terminal",
      repeatedFindings: null,
      findingsDelta: null,
      workspaceChanged: null,
      treeFirstSubmittedAsAttempt: null,
    });
    expect(rows[2]).toMatchObject({
      kind: "candidate",
      workspaceChanged: true,
      findingsDelta: { carried: 0, resolved: 0, introduced: 0 },
      treeFirstSubmittedAsAttempt: null,
    });
  });
});

describe("builder execution tool tallies", () => {
  const started = (toolName: string, toolCallId: string) =>
    ({ type: "tool_started", toolName, toolCallId }) as const;

  it("lets the settled turn tally own the turn it closes, without counting its events twice", () => {
    const recorder = new BuilderExecutionRecorder(Date.now());
    recorder.turnToolEvent(started("edit_code", "call-1"));
    recorder.turnToolEvent({
      type: "tool_ended",
      toolName: "edit_code",
      toolCallId: "call-1",
      isError: false,
    });
    recorder.turnCompleted({
      status: "completed",
      toolCalls: { total: 1, failed: 0, byName: { edit_code: 1 }, failedByName: {} },
    });

    const evidence = recorder.finish("recorded");
    expect(evidence.turns).toBe(1);
    expect(evidence.toolCalls).toMatchObject({ total: 1, failed: 0, byName: { edit_code: 1 } });
    expect(evidence.partialTurn).toBeNull();
    expect(evidence.firstToolMs).not.toBeNull();
  });

  it("records the running turn's calls when the host kills the session before the turn returns", () => {
    // Run w41-opus: a SIGTERM inside the first turn recorded turns 0, toolCalls.total 0 and an
    // empty byName for a session that had made 24 controller-hosted calls over 5m31s. The events
    // were all observed; only the fold waited for a turn that never came back.
    const recorder = new BuilderExecutionRecorder(Date.now());
    for (let call = 1; call <= 24; call += 1) {
      recorder.turnToolEvent(started("mcp__harness__write", `call-${call}`));
      recorder.turnToolEvent({
        type: "tool_ended",
        toolName: "mcp__harness__write",
        toolCallId: `call-${call}`,
        isError: false,
      });
    }

    const evidence = recorder.finish("in-flight");
    expect(evidence.turns).toBe(0);
    expect(evidence.toolCalls).toMatchObject({
      total: 24,
      failed: 0,
      custom: 24,
      native: 0,
      byName: { mcp__harness__write: 24 },
    });
    expect(evidence.partialTurn).toMatchObject({ turn: 1, toolCalls: { total: 24, failed: 0 } });
  });

  it("keeps a mid-turn snapshot fixed while the turn that follows it still runs", () => {
    const recorder = new BuilderExecutionRecorder(Date.now());
    recorder.turnToolEvent(started("bash", "call-1"));
    const snapshot = recorder.finish("in-flight");
    recorder.turnToolEvent(started("bash", "call-2"));

    expect(snapshot.toolCalls.total).toBe(1);
    expect(snapshot.partialTurn?.toolCalls.byName).toEqual({ bash: 1 });
    expect(recorder.finish("in-flight").toolCalls.total).toBe(2);
  });

  it("folds the observed events when a transport settles a turn with no tally of its own", () => {
    const recorder = new BuilderExecutionRecorder(Date.now());
    recorder.turnToolEvent(started("bash", "call-1"));
    recorder.turnCompleted({ status: "completed" });

    const evidence = recorder.finish("recorded");
    expect(evidence.turns).toBe(1);
    expect(evidence.toolCalls).toMatchObject({ total: 1, byName: { bash: 1 } });
    expect(evidence.partialTurn).toBeNull();
  });
});

describe("builder execution failed-call identity", () => {
  const failure = (toolCallId: string) =>
    ({ type: "tool_ended", toolName: "commandExecution", toolCallId, isError: true }) as const;
  const failureWith = (toolCallId: string, resultPreview: string) =>
    ({ ...failure(toolCallId), resultPreview }) as const;

  it("names each failed call, its request and what came back", () => {
    // Runs w23 K4 and sol-329 recorded "28 failed commandExecution" and 19 of 19
    // failures with no per-call identity, so the record could not say what the session was fighting.
    const recorder = new BuilderExecutionRecorder(Date.now());
    recorder.turnToolEvent({
      type: "tool_started",
      toolName: "commandExecution",
      toolCallId: "call-1",
      args: { command: "bun test correctness-model/checker.test.ts" },
    });
    recorder.turnToolEvent(failureWith("call-1", "error: module not found"));

    const rows = recorder.finish("in-flight").failedCalls ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ordinal: 1,
      turn: 1,
      tool: "commandExecution",
      error: "error: module not found",
    });
    expect(rows[0]?.request).toContain("bun test correctness-model/checker.test.ts");
    expect(rows[0]?.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(rows[0]?.atMs).toBeGreaterThanOrEqual(0);
  });

  it("bounds the rows, redacts credential-shaped text and leaves an absent field null", () => {
    const recorder = new BuilderExecutionRecorder(Date.now());
    recorder.turnToolEvent({
      type: "tool_started",
      toolName: "commandExecution",
      toolCallId: "secret",
      args: { command: `curl -H "authorization: Bearer sk-live-${"9".repeat(40)}" https://x/y` },
    });
    recorder.turnToolEvent(failureWith("secret", "x".repeat(4000)));
    for (let call = 0; call < 60; call += 1) recorder.turnToolEvent(failure(`call-${call}`));

    const evidence = recorder.finish("turn-non-result");
    const rows = evidence.failedCalls ?? [];
    expect(rows).toHaveLength(50);
    expect(evidence.failedCallsOmitted).toBe(11);
    expect(rows.at(-1)?.ordinal).toBe(50);
    // The row bound never touches the aggregate counts: all 61 failures stay exact.
    expect(evidence.toolCalls.failed).toBe(61);
    expect(evidence.failedByName).toEqual({ commandExecution: 61 });
    expect(JSON.stringify(evidence)).not.toContain("sk-live-");
    expect(rows[0]?.request).toContain("[redacted]");
    expect(rows[0]?.error?.length).toBe(200);
    // A transport that carried no arguments and no result text says so instead of recording "".
    expect(rows[1]).toMatchObject({ request: null, error: null });
  });
});

describe("builder execution turn event sink", () => {
  it("carries both tool edges from the persistent session's sink into the record", () => {
    // The campaign's own sink is the path run w41-opus ran on: it forwarded the start edge
    // for the first-call timestamp only, so a checkpoint mid-turn had nothing to record.
    const recorder = new BuilderExecutionRecorder(Date.now());
    let checkpoints = 0;
    const sink = turnEventRecorder(recorder, () => {
      checkpoints += 1;
    });
    sink({ type: "tool_started", toolName: "bash", toolCallId: "call-1", args: { command: "bun run gate" } });
    sink({
      type: "tool_ended",
      toolName: "bash",
      toolCallId: "call-1",
      isError: true,
      resultPreview: "exit 1",
    });

    const evidence = recorder.finish("in-flight");
    expect(evidence.toolCalls).toMatchObject({ total: 1, failed: 1, byName: { bash: 1 } });
    expect(evidence.failedCalls?.[0]).toMatchObject({ tool: "bash", error: "exit 1" });
    expect(evidence.failedCalls?.[0]?.request).toContain("bun run gate");
    // One liveness checkpoint per minute, whichever edge arrives first.
    expect(checkpoints).toBe(1);
  });

  // The positive case and its two hostile neighbours. A turn the provider settled itself carries
  // its own account; an aborted turn and a failed turn carry whatever the transport had in flight,
  // which for the Claude SDK is a sum of frames whose usage it documents as not final. Run
  // 17f9de read four such epochs as 36.5M input tokens and no cost.
  it("separates the turns whose usage the provider settled from the turns that were estimated", () => {
    const usage = { inputTokens: 100, outputTokens: 20, totalTokens: 120, costUsd: 0.5 };
    const settled = new BuilderExecutionRecorder(Date.now());
    turnEventRecorder(settled, () => {})({ type: "turn_ended", stopReason: "end_turn", usage });
    expect(settled.finish("in-flight").usage).toMatchObject({ reportedTurns: 1, estimatedTurns: 0 });

    const interrupted = new BuilderExecutionRecorder(Date.now());
    const sink = turnEventRecorder(interrupted, () => {});
    sink({ type: "turn_ended", stopReason: "aborted", usage });
    sink({ type: "turn_failed", errorMessage: "transport closed", usage });
    const evidence = interrupted.finish("in-flight");
    // The counts still sum: an estimate beats nothing, and the qualifier says what it is worth.
    expect(evidence.usage).toMatchObject({
      inputTokens: 200,
      costUsd: 1,
      reportedTurns: 2,
      estimatedTurns: 2,
    });
    expect(isCurrentExecutionRecord(evidence)).toBe(true);

    // A record without the estimate, or one claiming more estimates than reported turns, is refused.
    const { estimatedTurns: _, ...unstatedUsage } = evidence.usage;
    expect(isCurrentExecutionRecord({ ...evidence, usage: unstatedUsage })).toBe(false);
    const impossible = structuredClone(evidence);
    impossible.usage.estimatedTurns = 3;
    expect(isCurrentExecutionRecord(impossible)).toBe(false);
  });
});

it("bounds custom-tool receipts while aggregate counting remains a separate exact owner", () => {
  const recorder = new BuilderExecutionRecorder(0);
  for (let call = 0; call < 514; call += 1) {
    const sequence = recorder.customToolStarted("context", { action: "search", query: `private-${call}` });
    recorder.customToolFinished(sequence, "returned");
  }
  const evidence = recorder.finish("recorded");
  expect(evidence.customCalls).toHaveLength(512);
  expect(evidence.customCallsOmitted).toBe(2);
  expect(JSON.stringify(evidence)).not.toContain("private-");
});

it("records only closed custom-tool actions", () => {
  const recorder = new BuilderExecutionRecorder();
  const sequence = recorder.customToolStarted("context", {
    action: "private-action-text",
    query: "private-query-text",
  });
  recorder.customToolFinished(sequence, "returned");
  const evidence = recorder.finish("recorded");
  expect(evidence.customCalls[0]?.action).toBe("unknown");
  expect(JSON.stringify(evidence)).not.toContain("private-");
  for (const action of ["coverage", "history"]) {
    const next = recorder.customToolStarted("harness_inspect", { action });
    recorder.customToolFinished(next, "returned");
  }
  expect(
    recorder
      .finish("recorded")
      .customCalls.slice(1)
      .map((call) => call.action),
  ).toEqual(["coverage", "history"]);
});

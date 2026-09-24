/**
 * The Builder execution record as the recorder builds it and the strict reader admits it.
 *
 * The record is the only durable account of what an authoring session did, so two things have to
 * hold. The recorder must fold every observed event into rows whose aggregates stay exact even
 * when the session is killed mid-turn, and must never carry an argument, a result text or a
 * credential. The validator `isCurrentExecutionRecord` must admit exactly what the writer can
 * produce, which is why the admitted cases go through the real recorder and the refused cases
 * mutate one field of an admitted record.
 */
import { afterAll, describe, expect, it } from "bun:test";

import { writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { sha256 } from "../src/meta/digest.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import {
  type BuilderExecutionEvidence,
  BuilderExecutionRecorder,
  isCandidateSubmit,
  submitProjection,
} from "../src/author/builder-execution.ts";
import { turnEventRecorder } from "../src/author/builder-turn-loop.ts";
import { isCurrentExecutionRecord } from "../tools/outcome/builder-execution-current.ts";
import { PLAN_FIELDS } from "./helpers/experiment-plan.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { executionRecord } from "./helpers/session-execution-record.ts";

afterAll(cleanupScratch);

const commit = (letter: string) => letter.repeat(40);
const refusedSubmit = { outcome: "refused" as const, findings: [], terminal: false };
const started = (toolName: string, toolCallId: string) =>
  ({ type: "tool_started", toolName, toolCallId }) as const;
const ended = (toolName: string, toolCallId: string, isError = false) =>
  ({ type: "tool_ended", toolName, toolCallId, isError }) as const;

describe("the submission rows", () => {
  it("retains a captured proposal on refusal, and the reader refuses one whose digest no longer matches", () => {
    const recorder = new BuilderExecutionRecorder(Date.now());
    const proposal = {
      scope: "product" as const,
      target: { comparator: "at-least" as const, verifiedPasses: 0 },
      gap: "Public gap",
      change: "Proposed repair",
      ...PLAN_FIELDS,
      expectedResult: "Next measured result",
    };
    recorder.recordSubmit({
      ...refusedSubmit,
      turn: 1,
      stage: "bundle",
      commit: commit("a"),
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

  // The controller writes its own stop as a submit row; it stays in the raw rows but is never a
  // candidate tree and never the predecessor the next candidate compares itself against.
  it("keeps a controller terminal in the raw rows and out of every candidate comparison", () => {
    expect([
      isCandidateSubmit({ kind: "candidate" }),
      isCandidateSubmit({ kind: "controller-terminal" }),
    ]).toEqual([true, false]);
    const recorder = new BuilderExecutionRecorder(Date.now());
    recorder.recordSubmit({
      ...refusedSubmit,
      kind: "candidate",
      turn: 1,
      stage: "bundle",
      commit: commit("a"),
    });
    recorder.recordSubmit({
      ...refusedSubmit,
      kind: "controller-terminal",
      turn: 2,
      stage: "gates",
      commit: "budget-limited",
      terminal: true,
    });
    recorder.recordSubmit({
      ...refusedSubmit,
      kind: "candidate",
      turn: 3,
      stage: "bundle",
      commit: commit("b"),
    });
    // A real candidate that happens to be terminal is still a candidate.
    recorder.recordSubmit({
      ...refusedSubmit,
      kind: "candidate",
      turn: 4,
      stage: "gates",
      commit: commit("c"),
      terminal: true,
    });

    const evidence = recorder.finish("terminal-refusal");
    expect(evidence.schema).toBe("builder-execution/v6");
    expect(evidence.submits.map((row) => row.kind)).toEqual([
      "candidate",
      "controller-terminal",
      "candidate",
      "candidate",
    ]);
    expect(evidence.submits[1]).toMatchObject({
      commit: "budget-limited",
      terminal: true,
      repeatedFindings: null,
      findingsDelta: null,
      workspaceChanged: null,
      treeFirstSubmittedAsAttempt: null,
    });
    expect(evidence.submits[2]).toMatchObject({
      workspaceChanged: true,
      findingsDelta: { carried: 0, resolved: 0, introduced: 0 },
      treeFirstSubmittedAsAttempt: null,
    });
    expect(evidence.submits[3]).toMatchObject({ kind: "candidate", terminal: true });
    expect(submitProjection(evidence.submits).uniqueCandidateTrees).toBe(3);
    expect(submitProjection(evidence.submits).firstSubmitMs).not.toBeNull();
  });

  // An accepted submit records the task-quality advisories beside the acceptance, so the reader
  // must admit a non-empty finding list on an accepted row; hand-rolled records on both sides hid
  // that the reader once dropped every such session as an invalid shape.
  it("admits the advisories the accepted row records, and refuses a digest on an accepted row", () => {
    const recorder = new BuilderExecutionRecorder(Date.now() - 1_000);
    recorder.recordSubmit({
      ...refusedSubmit,
      turn: 1,
      stage: "validation",
      commit: "a1b2c3d",
      findings: [
        { code: "tasks-self-reported-expectation", path: "tasks", detail: "d", owner: "task-curriculum" },
      ],
    });
    const accepted = recorder.recordSubmit({
      turn: 2,
      outcome: "accepted",
      stage: null,
      commit: "e4f5a6b",
      findings: [
        {
          code: "tasks-multiplicity-unobservable",
          path: "tasks",
          detail: "the bounded search cannot enumerate an externally decided task",
          owner: "task-curriculum",
        },
      ],
      terminal: false,
    });
    expect(accepted.findingCodes).toEqual(["tasks-multiplicity-unobservable"]);
    expect(accepted.findingsDigest).toBeNull();
    const record = recorder.finish("recorded");
    expect(isCurrentExecutionRecord(structuredClone(record))).toBe(true);
    // The null digest is what marks the acceptance; a digest there is not a shape the writer produces.
    const forged = structuredClone(record);
    forged.submits[1]!.findingsDigest = "0".repeat(64);
    expect(isCurrentExecutionRecord(forged)).toBe(false);
  });
});

describe("the tool tallies", () => {
  // The settled tally owns the turn it closes; without one, the observed events are folded instead.
  it.each([
    ["the transport's own tally", { total: 1, failed: 0, byName: { bash: 1 }, failedByName: {} }],
    ["no tally at all", undefined],
  ])("counts a settled turn once from %s", (_, toolCalls) => {
    const recorder = new BuilderExecutionRecorder(Date.now());
    recorder.turnToolEvent(started("bash", "call-1"));
    recorder.turnToolEvent(ended("bash", "call-1"));
    recorder.turnCompleted(
      toolCalls === undefined ? { status: "completed" } : { status: "completed", toolCalls },
    );
    const evidence = recorder.finish("recorded");
    expect(evidence.turns).toBe(1);
    expect(evidence.toolCalls).toMatchObject({ total: 1, failed: 0, byName: { bash: 1 } });
    expect(evidence.partialTurn).toBeNull();
    expect(evidence.firstToolMs).not.toBeNull();
  });

  // A kill inside the first turn must not read as a session that made no calls; the Claude backend
  // names roster tools `mcp__harness__<name>`, and those are custom, not native.
  it("records the running turn's calls when the session is killed before the turn returns", () => {
    const recorder = new BuilderExecutionRecorder(Date.now());
    for (let call = 1; call <= 24; call += 1) {
      recorder.turnToolEvent(started("mcp__harness__write", `call-${call}`));
      recorder.turnToolEvent(ended("mcp__harness__write", `call-${call}`));
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

  it("carries both tool edges from the persistent session's sink, with one liveness checkpoint", () => {
    const recorder = new BuilderExecutionRecorder(Date.now());
    let checkpoints = 0;
    const sink = turnEventRecorder(recorder, () => {
      checkpoints += 1;
    });
    sink({ type: "tool_started", toolName: "bash", toolCallId: "call-1", args: { command: "bun run gate" } });
    sink({ ...ended("bash", "call-1", true), resultPreview: "exit 1" });
    const evidence = recorder.finish("in-flight");
    expect(evidence.toolCalls).toMatchObject({ total: 1, failed: 1, byName: { bash: 1 } });
    expect(evidence.failedCalls?.[0]).toMatchObject({ tool: "bash", error: "exit 1" });
    expect(evidence.failedCalls?.[0]?.request).toContain("bun run gate");
    // One liveness checkpoint per minute, whichever edge arrives first.
    expect(checkpoints).toBe(1);
  });
});

describe("the failed-call rows", () => {
  it("names each failed call, its request and what came back", () => {
    const recorder = new BuilderExecutionRecorder(Date.now());
    recorder.turnToolEvent({
      ...started("commandExecution", "call-1"),
      args: { command: "bun test correctness-model/checker.test.ts" },
    });
    recorder.turnToolEvent({
      ...ended("commandExecution", "call-1", true),
      resultPreview: "error: module not found",
    });
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
      ...started("commandExecution", "secret"),
      args: { command: `curl -H "authorization: Bearer sk-live-${"9".repeat(40)}" https://x/y` },
    });
    recorder.turnToolEvent({ ...ended("commandExecution", "secret", true), resultPreview: "x".repeat(4000) });
    for (let call = 0; call < 60; call += 1) {
      recorder.turnToolEvent(ended("commandExecution", `call-${call}`, true));
    }
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

describe("the custom-tool receipts", () => {
  it("records the semantic fields of a closed receipt, and the reader refuses a non-string finding code", () => {
    const recorder = new BuilderExecutionRecorder(Date.now());
    const workshop = recorder.customToolStarted("verifier_workshop", { action: "run" });
    recorder.customToolFinished(workshop, "returned", {
      details: { receipt: { outcome: "completed", resultDigest: "result-digest", workshopSequence: 7 } },
    });
    const preview = recorder.customToolStarted("correctness_check", {});
    recorder.customToolFinished(preview, "returned", {
      details: {
        receipt: {
          outcome: "findings",
          stage: "gates",
          findings: 2,
          findingCodes: ["gate-environment", "tasks-hidden-operand-unexpected"],
        },
      },
    });
    const evidence = recorder.finish("turn-bound");
    expect(evidence.customCalls.map((call) => call.semantic)).toMatchObject([
      { outcome: "completed", resultDigest: "result-digest", workshopSequence: 7 },
      { findingCodes: ["gate-environment", "tasks-hidden-operand-unexpected"] },
    ]);
    expect(isCurrentExecutionRecord(evidence)).toBe(true);
    const altered = JSON.parse(JSON.stringify(evidence));
    altered.customCalls[1].semantic.findingCodes = [7];
    expect(isCurrentExecutionRecord(altered)).toBe(false);
  });

  it("bounds the receipts at 512 while the aggregate count stays exact, and never records the query", () => {
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

  // A context call records its depth, defaulting to cited, and never the question; a depth outside
  // the closed set records as unknown.
  it("records only closed custom-tool actions", () => {
    const recorder = new BuilderExecutionRecorder();
    for (const args of [
      { depth: "private-depth-text", question: "private-question-text" },
      { question: "private-question-text" },
    ]) {
      recorder.customToolFinished(recorder.customToolStarted("context", args), "returned");
    }
    for (const action of ["coverage", "feedback"]) {
      recorder.customToolFinished(recorder.customToolStarted("harness_inspect", { action }), "returned");
    }
    const evidence = recorder.finish("recorded");
    expect(evidence.customCalls.map((call) => call.action)).toEqual([
      "unknown",
      "cited",
      "coverage",
      "feedback",
    ]);
    expect(JSON.stringify(evidence)).not.toContain("private-");
  });
});

describe("the usage account", () => {
  // A turn the provider settled carries its own account; an aborted or failed turn carries whatever
  // the transport had in flight, which is not final. The counts still sum, and the qualifier says
  // what they are worth.
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
    expect(evidence.usage).toMatchObject({
      inputTokens: 200,
      costUsd: 1,
      reportedTurns: 2,
      estimatedTurns: 2,
    });
    expect(isCurrentExecutionRecord(evidence)).toBe(true);

    // A record without the estimate, or claiming more estimates than reported turns, is refused.
    const { estimatedTurns: _, ...unstatedUsage } = evidence.usage;
    expect(isCurrentExecutionRecord({ ...evidence, usage: unstatedUsage })).toBe(false);
    const impossible = structuredClone(evidence);
    impossible.usage.estimatedTurns = 3;
    expect(isCurrentExecutionRecord(impossible)).toBe(false);
  });
});

describe("the handover a round leaves in its workspace", () => {
  it("digests each handover file as it stands when the record is written, and null for a missing one", () => {
    const workspace = scratchDir("handovers-");
    writeFileSync(join(workspace, "EXPERIMENT.json"), '{"gap":"one"}');
    writeFileSync(join(workspace, "MEMORY.md"), "# notes\n");
    const recorder = new BuilderExecutionRecorder(Date.now());
    recorder.handoversIn(workspace);
    const checkpoint = recorder.finish("in-flight");
    writeFileSync(join(workspace, "MEMORY.md"), "# notes\nThe round learned one thing.\n");
    const settled = recorder.finish("recorded");
    expect(checkpoint.handovers).toEqual({
      "EXPERIMENT.json": sha256('{"gap":"one"}'),
      "MEMORY.md": sha256("# notes\n"),
      "SCRATCHPAD.md": null,
    });
    expect(settled.handovers?.["MEMORY.md"]).toBe(sha256("# notes\nThe round learned one thing.\n"));
    expect(isCurrentExecutionRecord(settled)).toBe(true);

    const bare = new BuilderExecutionRecorder(Date.now()).finish("recorded");
    expect("handovers" in bare).toBe(false);
    expect(isCurrentExecutionRecord(bare)).toBe(true);
  });

  it.each([
    ["a non-digest value", { "EXPERIMENT.json": "not-a-digest", "MEMORY.md": null, "SCRATCHPAD.md": null }],
    ["a missing file key", { "EXPERIMENT.json": null, "MEMORY.md": null }],
    [
      "an extra file key",
      { "EXPERIMENT.json": null, "MEMORY.md": null, "SCRATCHPAD.md": null, "NOTES.md": null },
    ],
  ])("refuses a handover map with %s", (_, handovers) => {
    const bare = new BuilderExecutionRecorder(Date.now()).finish("recorded");
    expect(isCurrentExecutionRecord({ ...bare, handovers })).toBe(false);
  });
});

/** The aggregate contract the reader holds every record to: totals agree with their per-name
 *  rows, the custom/native split agrees with the names, and receipts keep the writer's order. */
describe("the aggregate integrity the reader enforces", () => {
  const base = () =>
    executionRecord({ turns: 1, toolCalls: { byName: { Read: 2, Bash: 1 } }, failedByName: { Bash: 1 } });
  const receipt = (sequence: number) => ({
    sequence,
    turn: 1,
    tool: "harness_inspect",
    action: "readiness",
    target: {},
    startedAtMs: 0,
    durationMs: 1,
    dispatchOutcome: "returned" as const,
  });
  const withReceipts = (record: BuilderExecutionEvidence, sequences: number[]) => {
    record.toolCalls = {
      total: 5,
      failed: 1,
      byName: { Read: 2, Bash: 1, harness_inspect: 2 },
      custom: 2,
      native: 3,
    };
    record.customCalls = sequences.map(receipt);
  };

  it.each([
    ["a writer-consistent record", () => {}],
    [
      "receipts in the writer's 1..n order",
      (record: BuilderExecutionEvidence) => withReceipts(record, [1, 2]),
    ],
  ])("admits %s", (_, mutate) => {
    const record = base();
    mutate(record);
    expect(isCurrentExecutionRecord(record)).toBe(true);
  });

  it.each([
    [
      "a total above its per-name rows",
      (record: BuilderExecutionEvidence) => void (record.toolCalls.total += 1),
    ],
    [
      "a failed count below its per-name rows",
      (record: BuilderExecutionEvidence) => void (record.toolCalls.failed = 0),
    ],
    [
      "a failed call the all-call map never recorded",
      (record: BuilderExecutionEvidence) => {
        record.toolCalls.failed = 2;
        record.failedByName = { Bash: 2 };
      },
    ],
    [
      "a custom/native split that contradicts the names",
      (record: BuilderExecutionEvidence) => void (record.toolCalls.byName = { harness_inspect: 2, Bash: 1 }),
    ],
    ["receipts out of order", (record: BuilderExecutionEvidence) => withReceipts(record, [2, 1])],
    ["receipts with a gap", (record: BuilderExecutionEvidence) => withReceipts(record, [1, 3])],
    [
      "a running partial turn whose tally disagrees with itself",
      (record: BuilderExecutionEvidence) =>
        void (record.partialTurn = {
          turn: 2,
          toolCalls: { total: 2, failed: 0, byName: { Read: 1 }, failedByName: {} },
        }),
    ],
  ])("refuses %s", (_, mutate) => {
    const record = base();
    mutate(record);
    expect(isCurrentExecutionRecord(record)).toBe(false);
  });
});

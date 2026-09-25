import type { JsonValue } from "../src/meta/json-shape.ts";
import { mkdtempSync, readFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { describe, expect, it } from "bun:test";
import {
  observeBuilderTurn,
  observeSolveCase,
  observeSolverTurn,
} from "../src/observe/model-turn-observer.ts";
import {
  createRunObserver,
  observeAnalysisResult,
  observePromotion,
  startFullRunObservation,
} from "../src/observe/run-observer.ts";
import { sessionJudge } from "../src/truth/judge.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { double, scriptedSession, text } from "./helpers/doubles.ts";
import { builtBatteryRuntime } from "../src/run/built-agent-runtime.ts";

function rows(root: string, runId = "run-01"): Array<Record<string, JsonValue>> {
  return readFileSync(join(root, "campaigns", "demo", "observability", `${runId}.jsonl`), "utf8")
    .trim()
    .split("\n")
    .map((line) => parseJsonAs<Record<string, JsonValue>>(line));
}

/** Find rows whose parent id is absent from the same run's emitted events. */
function orphans(emitted: Array<Record<string, JsonValue>>): string[] {
  const ids = new Set(emitted.map((row) => text(row.id)));
  return emitted
    .values()
    .filter((row) => row.parentId != null && !ids.has(text(row.parentId)))
    .map((row) => `${text(row.id)} → ${text(row.parentId)}`)
    .toArray();
}

describe("run observer", () => {
  it("shares one append owner across interleaved controller and Built child events", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-observer-shared-"));
    const observer = createRunObserver(root, "demo", "run-01");
    const phase = observer.phase({ phase: "measure-on", state: "started", summary: "battery" });
    const child = observer.child(phase);
    const runtime = builtBatteryRuntime(null, child);
    expect(runtime.observer).toBe(child);
    observer.phase({ phase: "build", state: "completed", summary: "controller event" });
    runtime.observer.prompt({ contract: "built", role: "solver", prompt: "solve" });
    observer.phase({ phase: "measure-on", state: "completed", summary: "battery settled" });
    createRunObserver(root, "demo", "run-01").phase({
      phase: "analyse",
      state: "started",
      summary: "reopened",
    });
    const emitted = rows(root);
    expect(emitted.map((row) => row.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(new Set(emitted.map((row) => row.id)).size).toBe(5);
    expect(emitted[2]?.parentId).toBe(phase);
    expect(orphans(emitted)).toEqual([]);
  });
  it("appends exact model-visible prompts and typed steering without becoming a decision input", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-observer-"));
    const observer = createRunObserver(root, "demo", "run-01");
    const promptId = observer.prompt({
      contract: "built",
      role: "built-solver",
      prompt: "finish the task",
      phase: "measure-on",
      turn: 2,
      subjectId: "task-1",
      steeringTypes: ["runtime-nudge"],
    });
    observer.child(promptId).steering({
      authority: "deterministic",
      owner: "built-solver",
      claim: "finish the task",
    });
    observer.phase({ phase: "measure-on", state: "failed", summary: "version with advisers aborted" });

    expect(rows(root)).toMatchObject([
      {
        schema: "ana-observation/v2",
        id: "run-01:1",
        seq: 1,
        parentId: null,
        kind: "generation",
        level: "default",
        type: "prompt-ingested",
        prompt: "finish the task",
        chars: 15,
        subjectId: "task-1",
      },
      {
        id: "run-01:2",
        seq: 2,
        parentId: "run-01:1",
        kind: "event",
        level: "default",
        type: "steering-ingested",
        authority: "deterministic",
      },
      {
        id: "run-01:3",
        seq: 3,
        parentId: null,
        kind: "span",
        level: "error",
        type: "phase-transition",
        phase: "measure-on",
        state: "failed",
      },
    ]);
    expect(rows(root)[0]?.promptDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("tallies each completed turn's tool calls with failures raised to a warning", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-observer-turn-tools-"));
    const observer = createRunObserver(root, "demo", "run-01");
    observer.turnTools({ turn: 1, toolCalls: 4, failed: 0, failedByName: {} });
    observer.turnTools({ turn: 2, toolCalls: 6, failed: 3, failedByName: { Bash: 3 } });
    expect(rows(root)).toMatchObject([
      { type: "turn-tools-tallied", kind: "event", level: "default", turn: 1, toolCalls: 4, failed: 0 },
      {
        type: "turn-tools-tallied",
        kind: "event",
        level: "warning",
        turn: 2,
        toolCalls: 6,
        failed: 3,
        failedByName: { Bash: 3 },
      },
    ]);
  });

  it("continues sequence numbers across a same-run relaunch", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-observer-relaunch-"));
    createRunObserver(root, "demo", "run-01").phase({
      phase: "input",
      state: "completed",
      summary: "input admitted",
    });
    createRunObserver(root, "demo", "run-01").phase({
      phase: "build",
      state: "started",
      summary: "build started",
    });
    expect(rows(root).map((row) => row.seq)).toEqual([1, 2]);
  });

  it("records each iteration outcome and finding digest so readers can identify repeated failures", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-observer-iteration-"));
    const observer = createRunObserver(root, "demo", "run-01");
    observer.iteration({
      ordinal: 11,
      outcome: "gates-blocked",
      focusOwner: "correctness-model",
      findingsHash: "abc123",
    });
    observer.iteration({ ordinal: 12, outcome: "fingerprinted", focusOwner: null, findingsHash: null });
    const emitted = rows(root);
    expect(emitted.map((row) => [row.type, row.level, row.ordinal, row.focusOwner])).toEqual([
      ["iteration-settled", "warning", 11, "correctness-model"],
      ["iteration-settled", "default", 12, null],
    ]);
    // The finding digest lets a reader count consecutive occurrences of the same findings.
    expect(emitted.map((row) => row.findingsHash)).toEqual(["abc123", null]);
  });

  it("refuses event data that tries to replace the controller envelope", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-observer-envelope-"));
    const observer = createRunObserver(root, "demo", "run-01");
    expect(() =>
      observer.phase(
        double<Parameters<typeof observer.phase>[0]>({
          phase: "input",
          state: "completed",
          summary: "falsified envelope",
          schema: "falsified",
        }),
      ),
    ).toThrow(/cannot replace schema/);

    observer.phase({ phase: "input", state: "completed", summary: "real event" });
    expect(rows(root)[0]).toMatchObject({ schema: "ana-observation/v2", id: "run-01:1", seq: 1 });
  });

  it("is invoked for shared Builder, Built Harness and Judge turns", async () => {
    const root = mkdtempSync(join(tmpdir(), "ana-observer-boundaries-"));
    const observer = createRunObserver(root, "demo", "run-boundaries");

    const solveCase = observeSolveCase(observer, { taskId: "task-1", phase: "measure-on" });
    for (let turn = 1; turn <= 2; turn += 1) {
      observeSolverTurn(solveCase, {
        prompt: turn === 1 ? "solve task-1" : "repair and submit",
        turn,
        taskId: "task-1",
        phase: "measure-on",
        nudge: "repair and submit",
      });
    }

    for (let turn = 1; turn <= 2; turn += 1) {
      observeBuilderTurn(observer, {
        prompt: turn === 1 ? "build the harness" : "continue and submit",
        turn,
      });
    }

    const judge = sessionJudge({
      observer,
      openSession: async (tool) =>
        scriptedSession(async () => {
          await tool.execute("call-1", double({ verdict: "pass", rationale: "public artifact is coherent" }));
          return { status: "completed" };
        }),
    });
    await judge(
      {
        publicContext: {
          domain: {
            slug: "demo",
            domain: "Demo",
            publicRequest: "build a demo",
            artifactSchema: {},
            publicResources: [],
            toolContract: null,
            runtimeFacts: {
              capabilities: [],
              maxSubmitAttempts: 1,
              condition: { variant: "shipping", advisorsRemoved: [], toolInterfaceHash: null },
            },
          },
          publicTask: { taskId: "task-1", family: "demo", publicInput: {} },
        },
        submittedArtifact: { value: 1 },
      },
      { subjectId: "case-1", subjectKind: "battery-case" },
    );

    const emitted = rows(root, "run-boundaries");
    expect(
      emitted
        .filter((row) => row.type === "prompt-ingested")
        .map((row) => [row.contract, row.role, row.subjectId ?? null, row.steeringTypes]),
    ).toEqual([
      ["built", "built-solver", "task-1", ["start-prompt"]],
      ["built", "built-solver", "task-1", ["runtime-nudge", "follow-up"]],
      ["builder", "builder", null, ["start-prompt"]],
      ["builder", "builder", null, ["runtime-nudge", "follow-up"]],
      ["judge-census", "battery-case", "case-1", ["start-prompt"]],
    ]);
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "steering-ingested",
          authority: "deterministic",
          claim: expect.any(String),
        }),
        expect.objectContaining({
          type: "hook-activated",
          hookType: "follow-up",
          label: "unsettled Builder follow-up",
          triggerDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          renderedDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
        expect.objectContaining({
          type: "hook-activated",
          hookType: "follow-up",
          label: "unaccepted-submit follow-up",
          triggerDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          renderedDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]),
    );

    // Solve activity nests: one case span, both turns under it, and the second turn's nudge and
    // hook under that turn — the run reads as a tree instead of a flat list correlated by hand.
    const caseSpan = emitted.find((row) => row.type === "phase-transition" && row.phase === "measure-on");
    expect(caseSpan).toMatchObject({ kind: "span", subjectId: "task-1", parentId: null });
    const turns = emitted.filter((row) => row.role === "built-solver");
    expect(turns.map((row) => row.parentId)).toEqual([caseSpan?.id, caseSpan?.id]);
    const builtEvents = emitted.filter(
      (row) => row.kind === "event" && [turns[0]?.id, turns[1]?.id].includes(row.parentId),
    );
    expect(builtEvents.map((row) => row.parentId)).toEqual([turns[1]?.id, turns[1]?.id]);
    expect(orphans(emitted)).toEqual([]);
  });

  it("reconstructs one tree from a full-run stream with no orphan parent", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-observer-tree-"));
    const observer = startFullRunObservation(root, "demo", "run-tree", "build me a harness");
    observeAnalysisResult(observer, "demo", "run-tree", {
      judges: {
        findings: [{ claim: "controls are thin", evidence: "census.json", proposedOwner: "controls" }],
        exit: { kind: "advisory" },
      },
      admission: {
        admitted: [{ claim: "controls are thin", evidence: "census.json", proposedOwner: "controls" }],
        feedback: [],
      },
    });
    observePromotion(observer, "demo", "run-tree", "held");

    const emitted = rows(root, "run-tree");
    expect(orphans(emitted)).toEqual([]);
    // Every row reaches the run root by following parentId, so the forest is one tree.
    const byId = new Map(emitted.map((row) => [text(row.id), row]));
    for (const row of emitted) {
      let cursor: Record<string, JsonValue> | undefined = row;
      let hops = 0;
      while (cursor?.parentId != null && hops <= emitted.length) {
        cursor = byId.get(text(cursor.parentId));
        hops += 1;
      }
      expect(cursor?.parentId, `${text(row.id)} does not reach the run root`).toBeNull();
    }
    // The admitted finding is a child of the admission span. Its normal steering event uses
    // the default level; the old warning level came from a hardcoded status.
    const admission = emitted.find((row) => row.phase === "admission");
    expect(
      emitted.find((row) => row.type === "steering-ingested" && row.authority === "model-hypothesis"),
    ).toMatchObject({ parentId: admission?.id, level: "default" });
  });

  it("refuses observation path traversal before creating a file", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-observer-path-"));
    expect(() => createRunObserver(root, "../escape", "run-01")).toThrow(/safe observation path/);
    expect(() => createRunObserver(root, "demo", "../escape")).toThrow(/safe observation path/);
  });
});

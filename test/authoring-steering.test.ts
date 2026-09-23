/**
 * What the controller tells a Builder round about its own progress, and what it writes down about
 * the round afterwards. The two halves look unrelated and are the same problem twice: a session
 * cannot see its own position, so the controller has to state it, and a reader after the fact
 * cannot see the session at all, so the controller has to record it.
 *
 * The steering half is bounded by what the Builder may act on. The opening states the round's turn
 * limit and the continuation restates the unchanged request beside the round's facts — which turn,
 * how long, how many submits, how the last one ended — because pi compacts the conversation and the
 * opening turn is the oldest part of it, so a long-running session can genuinely no longer know
 * what it was asked for. Urgency is stated the same way: after eight turns or two hours without a
 * submit it asks for authoring, and after a refusal it asks for a batched repair instead. The
 * elapsed-time clause is not redundant with the turn count, because a Claude session runs the whole
 * round as one assistant turn and would otherwise never reach turn eight. Throughout, the text is
 * scope-neutral — it never names a file that a task-fixed round is not allowed to edit, which is
 * why the opening is asserted not to contain `tasks.json`.
 *
 * The transcript half is about a record that has to survive the thing it records. Events arrive
 * before the session identity does, so the transcript buffers rather than dropping what came first,
 * and it settles a pointer carrying the file's SHA-256 so a later reader can tell the recorded
 * bytes from bytes that were edited afterwards. Given no output directory it stays inert instead of
 * failing, because a missing transcript must not be able to end a round that was otherwise working.
 */
import { mkdtempSync, readFileSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { type BuilderSessionDeps, runBuilderSession } from "../src/author/builder-session.ts";
import { continuePrompt, unchangedAuthoringNote } from "../src/author/builder-continuation.ts";
import {
  ControllerEventTranscript,
  type BuilderTranscriptPointerV2,
} from "../src/builder/session-transcript.ts";
import type { AgentTurnResult, RunTurnOptions } from "../src/backends/backend-types.ts";
import type { HostSession } from "../src/backends/pi-session.ts";
import type { RuntimeModelIdentity } from "../src/claim/runtime-model-identity.ts";

const roots: string[] = [];
const IDENTITY: RuntimeModelIdentity = {
  schema: "runtime-model-identity/v2",
  agentRuntime: { id: "pi-agent-core", version: "1", sessionId: "sess-1" },
  provider: { id: "openrouter", model: "m", resultId: null, nativeSessionId: null },
};

interface SubmitTool {
  name?: string;
  execute(toolCallId: string, args: Record<string, never>): Promise<{ content: Array<{ text: string }> }>;
}

type TurnScript = ((submit: SubmitTool) => Promise<void> | undefined) | undefined;

/** A scripted transport like builder-session.test's, reduced to prompts plus submit calls. */
interface ScriptedSession {
  open: BuilderSessionDeps["open"];
  opened: { prompts: string[] };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "ana-steer-"));
  roots.push(root);
  return root;
}

const INPUT = (workspace: string, maxTurns: number) => ({
  slug: "steering",
  kickoff: "Build the thing.",
  workspace,
  maxTurns,
});

function scripted(turns: TurnScript[]): ScriptedSession {
  const opened = { prompts: new Array<string>() };
  const open: BuilderSessionDeps["open"] = async (tools, systemPrompt) => {
    void systemPrompt;
    let turn = 0;
    const session: HostSession = {
      backend: "openrouter",
      async runTurn(options: RunTurnOptions) {
        const { prompt } = options;
        opened.prompts.push(prompt);
        const script = turns[turn++];
        // The backend's tally counts the submit calls the script made, which the stall rule reads.
        let calls = 0;
        if (script !== undefined) {
          // SAFETY: runBuilderSession mounts the hosted submit tool into this roster, so every
          // entry answers to the AgentTool shape this cast reads.
          const candidates = tools.map((tool) => tool as SubmitTool);
          const submit = required(candidates.find((tool) => tool.name === "submit"));
          const counted: SubmitTool = {
            execute: async (id, args) => {
              calls += 1;
              return submit.execute(id, args);
            },
          };
          await script(counted);
        }
        const toolCalls = { total: calls, failed: 0, byName: {}, failedByName: {} };
        return turn === 1
          ? ({
              status: "completed",
              assistantText: "ok",
              runtimeIdentity: IDENTITY,
              toolCalls,
            } satisfies AgentTurnResult)
          : ({ status: "completed", assistantText: "ok", toolCalls } satisfies AgentTurnResult);
      },
      configure() {},
      sessionId: "pi-test",
      dispose: async () => {},
    };
    return session;
  };
  return { open, opened } satisfies ScriptedSession;
}

function required<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("missing");
  return value;
}

const NO_SUBMIT = () => undefined;

describe("turn-budget steering", () => {
  // The sixteen-call author-first interrupt ended on 2026-09-14; the unchanged fact stays as one line.
  it("names unchanged owned files as a fact, and says nothing once they moved", () => {
    expect(unchangedAuthoringNote("unchanged", ["agent", "correctness-model"])).toContain(
      "nothing under agent or correctness-model has changed since this round opened",
    );
    expect(unchangedAuthoringNote("changed", ["agent"])).toBe("");
  });

  it("states the session limit in the opening prompt", async () => {
    const { open, opened } = scripted([undefined, undefined]);
    await runBuilderSession(INPUT(tempRoot(), 8), { open, tools: [], submit: NO_SUBMIT_THROWER });
    expect(opened.prompts[0]).toContain("Round limit: 8 assistant turns");
    expect(opened.prompts[0]).toContain(
      "submit once you are confident that a clear preview and your own checks are sufficient evidence",
    );
    // Scope-neutral: the opening text never names a file a task-fixed repair may not edit.
    expect(opened.prompts[0]).not.toContain("tasks.json");
  });

  const goal = (extra: Partial<Parameters<typeof continuePrompt>[0]>) =>
    continuePrompt({
      kickoff: "Build the thing.",
      attempts: 0,
      activeTurn: 1,
      maxTurns: undefined,
      elapsedMs: 0,
      ...extra,
    });

  it("restates the request and the round's facts at every boundary, as a Codex goal does", () => {
    const text = goal({ activeTurn: 3, attempts: 1, maxTurns: 12, elapsedMs: 5_400_000 });
    expect(text).toContain("The user's request, unchanged:\nBuild the thing.");
    expect(text).toContain(
      "This round so far: turn 3, 90 minutes, 1 submit, the last one refused. 9 of 12 turns remain.",
    );
    expect(text).toContain("only a submit the gate accepts completes it");
    // An uncapped round states no remaining turns, and a caller without a clock states no minutes.
    const uncapped = goal({ activeTurn: 2 });
    expect(uncapped).toContain("This round so far: turn 2, no submit yet.");
    expect(uncapped).not.toContain("turns remain");
  });

  it("asks for authoring after eight turns or two hours without a submit, and for a batched repair after one", () => {
    expect(goal({ activeTurn: 8 })).toContain("move to authoring now");
    expect(goal({ activeTurn: 7 })).not.toContain("move to authoring now");
    // A Claude session runs as one assistant turn, so elapsed time asks as well; under the two-hour
    // bash install allowance the turn count decides alone.
    expect(goal({ activeTurn: 1, elapsedMs: 7_200_000 })).toContain("move to authoring now");
    expect(goal({ activeTurn: 1, elapsedMs: 7_199_000 })).not.toContain("move to authoring now");
    const repair = goal({ attempts: 1, activeTurn: 30, elapsedMs: 36_000_000 });
    expect(repair).toContain("Fix what the last refusal named, and batch the fixes");
    expect(repair).not.toContain("move to authoring now");
  });

  it("ends the round as no-progress after three turns in a row without a successful tool call", async () => {
    const scripts: TurnScript[] = [async (submit) => void (await submit.execute("t1", {}))];
    for (let i = 0; i < 9; i += 1) scripts.push(NO_SUBMIT);
    const { open, opened } = scripted(scripts);
    const outcome = await runBuilderSession(INPUT(tempRoot(), 12), { open, tools: [], submit: REFUSER });
    expect(outcome).toMatchObject({ ok: false, terminal: true, terminalClause: "no-progress", turns: 4 });
    // The refused submit succeeded as a call, so turn 1 made progress; turns 2 to 4 made none.
    expect(opened.prompts).toHaveLength(4);
    expect(opened.prompts[1]).toContain("batch the fixes");
    expect(opened.prompts[1]).toContain("3 turns in a row without a successful tool call end the round");
  });
});

const NO_SUBMIT_THROWER = (): never => {
  throw new Error("not scripted");
};

const REFUSER: BuilderSessionDeps["submit"] = () => ({
  ok: false as const,
  stage: "bundle" as const,
  findings: [{ code: "missing-bundle-file", path: "correctness-model/tasks.json", detail: "absent" }],
  commit: "d".repeat(40),
  attempts: {},
});

describe("the controller-event transcript", () => {
  it("buffers until opened, then settles a v2 pointer with the file sha", () => {
    const dir = tempRoot();
    const transcript = new ControllerEventTranscript("sess-1", "openrouter", dir, "/tmp/ws");
    transcript.prompt(1, "first prompt");
    transcript.open(dir); // identity arrives after turn 1
    transcript.prompt(2, "second prompt");
    transcript.toolStarted(2, "bash", { command: "bun test" });
    transcript.toolEnded(2, "bash", "returned");
    transcript.turnResult(2, "completed");
    transcript.settle();

    const pointerPath = join(dir, "builder-transcript.json");
    // SAFETY: settle wrote this file from the typed pointer above; the parse restores that shape.
    const pointer = JSON.parse(readFileSync(pointerPath, "utf8")) as BuilderTranscriptPointerV2;
    expect(pointer.schema).toBe("builder-transcript-pointer/v2");
    expect(pointer.source).toBe("controller-events");
    expect(pointer.path).toBe(join(dir, "builder-events-sess-1.jsonl"));
    expect(pointer.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pointer.settledAt).not.toBeNull();
    expect(pointer.warnings).toEqual([]);
    // SAFETY: every record line was written by push() from the typed record union.
    const lines = readFileSync(pointer.path, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { sessionId: string; kind: string; turn: number });
    expect(lines[0]).toMatchObject({ sessionId: "sess-1", kind: "prompt", turn: 1 });
    expect(lines.at(-1)).toMatchObject({ kind: "turn_result", status: "completed" });
  });

  it("is inert when no directory is given", () => {
    const transcript = new ControllerEventTranscript("sess-2", "openrouter", undefined, "/tmp/ws");
    transcript.prompt(1, "lost");
    transcript.open(tempRoot());
    transcript.settle();
  });
});

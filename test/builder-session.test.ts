/**
 * One Builder round is one `runBuilderSession` call, and what it promises is observable from the
 * outcome it returns, the results its hosted tools hand the model and the session it leaves behind.
 * This file owns the loop: how many turns a round spends, what bounds each one, what a submit
 * verdict does to the turn in flight, what a failure leaves, and when the run's one conversation
 * keeps the session for the next round. What the prompts say is `builder-session-prompts.test.ts`;
 * the execution record is `builder-session-record.test.ts`.
 */
import { describe, expect, it } from "bun:test";

import { BuildAgentTurnNonResult } from "../src/author/build-agent.ts";
import { BuilderConversation, type OpenSession } from "../src/author/builder-conversation.ts";
import { submitProjection } from "../src/author/builder-execution.ts";
import { BUILDER_WORKSPACE_CARD, runBuilderSession } from "../src/author/builder-session.ts";
import { BUILDER_TURN_SETTLE_MS } from "../src/author/builder-turn-loop.ts";
import type { CandidateCheckOutcome } from "../src/author/candidate-check.ts";
import type { HostSession, PiTool } from "../src/backends/pi-session.ts";
import { builderSessionCapMs } from "../src/run/builder-backend.ts";
import { required, scriptedSession, toolDouble } from "./helpers/doubles.ts";
import {
  ACCEPTED,
  INPUT,
  REFUSED,
  type TurnScript,
  deps,
  recordSink,
  scriptedOpener,
  submitsOnce,
  toolNamed,
} from "./helpers/builder-session-script.ts";

const text = (result: { content: Array<{ text: string }> }) => result.content[0]?.text ?? "";
const refusedAt = (commit: string): CandidateCheckOutcome => ({ ...REFUSED, commit: commit.repeat(40) });

describe("one round's turn loop", () => {
  it("runs until the candidate is accepted, handing each refusal back to the model", async () => {
    const outcomes = [REFUSED, ACCEPTED];
    const texts: string[] = [];
    const submitting: TurnScript = async (submit) => {
      texts.push(text(await submit.execute(`t${texts.length}`, {})));
      return undefined;
    };
    const { open, opened } = scriptedOpener([() => undefined, submitting, submitting]);
    const marker = toolDouble({ name: "read", execute: async () => ({ content: [] }) });
    const outcome = await runBuilderSession(
      INPUT,
      deps(open, () => required(outcomes.shift(), "the next scripted outcome"), [marker]),
    );
    expect(outcome).toMatchObject({
      ok: true,
      turns: 3,
      validationAttempts: 2,
      findings: [],
      terminal: false,
    });
    expect(outcome.fingerprint).toBe(ACCEPTED.fingerprint);
    expect(texts[0]).toContain("refused at bundle");
    expect(texts[0]).toContain("missing-bundle-file correctness-model/tasks.json");
    expect(texts[1]).toMatch(/accepted/i);
    expect(opened.tools[0]).toMatchObject({ name: "read" });
    expect(toolNamed(opened.tools, "submit")?.name).toBe("submit");
    expect(opened.systemPrompt.startsWith("You are the Builder.")).toBe(true);
    expect(opened.systemPrompt).toContain(BUILDER_WORKSPACE_CARD);
    expect(opened.systemPrompt).toContain("Withhold hidden expectations");
    // The refusal-batching duty belongs to the submit-boundary continuation, not the framing.
    expect(opened.systemPrompt).not.toContain("repair group");
    expect([opened.disposed, opened.prompts.length]).toEqual([1, 3]);
    expect(opened.prompts[2]).toContain("Fix what the last refusal named, and batch the fixes");
  });

  // A changed tree with the same diagnosis is repair in progress, and a byte-identical resubmit is
  // counted by the controller's unchanged-candidate owner; neither is an in-session strike.
  it.each([
    ["the same diagnosis on changed trees", ["1", "2", "3", "4"], 0],
    ["alternating diagnoses on changed trees", ["1", "2", "3", "4", "5"], 0],
    ["one tree resubmitted unchanged", ["1", "1", "1", "1"], 3],
  ])("keeps the round open through %s and ends it only at acceptance", async (_, commits, unchanged) => {
    const verdicts = [...commits.map(refusedAt), ACCEPTED];
    const returns: Array<{ text: string; terminate: boolean }> = [];
    let lateWrites = 0;
    const write = toolDouble({
      name: "write",
      execute: async () => {
        lateWrites += 1;
        return { content: [] };
      },
    });
    const turn: TurnScript = async (submit, tools) => {
      const result = await submit.execute("submit", {});
      returns.push({ text: text(result), terminate: result.terminate === true });
      // A write in the same turn as the accepted submit never reaches the workspace.
      if (returns.length === commits.length + 1) {
        await required(toolNamed(tools, "write"), "write").execute("w", {});
      }
      return undefined;
    };
    const { open, opened } = scriptedOpener(verdicts.map(() => turn));
    const sink = recordSink();
    const outcome = await runBuilderSession(
      { ...INPUT, maxTurns: verdicts.length + 2 },
      { ...deps(open, () => required(verdicts.shift(), "the next verdict"), [write]), ...sink },
    );
    expect(outcome).toMatchObject({ ok: true, terminal: false, validationAttempts: commits.length + 1 });
    expect(returns.map((row) => row.terminate)).toEqual([...commits.map(() => false), true]);
    for (const row of returns) {
      expect(row.text).not.toContain("strike");
      expect(row.text).not.toContain("This refusal is final");
    }
    const evidence = required(sink.settled[0], "the settled record");
    expect(evidence.outcome).toBe("recorded");
    expect(evidence.submits.map((row) => row.terminal)).toEqual([...commits.map(() => false), false]);
    expect(submitProjection(evidence.submits).unchangedTreeSubmits).toBe(unchanged);
    expect([lateWrites, opened.disposed]).toEqual([0, 1]);
  });

  it("lets probe-only turns run to the turn bound without a strike or a stall clause", async () => {
    const probeOnly: TurnScript = () => ({
      toolCalls: { byName: { Bash: 40 }, failedByName: {}, failed: 0, total: 40 },
    });
    const { open, opened } = scriptedOpener([probeOnly, probeOnly, probeOnly]);
    const outcome = await runBuilderSession(
      { ...INPUT, maxTurns: 3 },
      deps(open, () => ACCEPTED),
    );
    expect(outcome).toMatchObject({
      ok: false,
      turns: 3,
      validationAttempts: 0,
      terminal: false,
      terminalClause: null,
      findings: [],
    });
    expect(opened.prompts).toHaveLength(3);
    expect(opened.prompts[2]).toContain("This round so far: turn 2, no submit yet. 1 of 3 turns remain.");
  });

  it("runs one controller submission when a transport dispatches two submits together, and tells the second to wait", async () => {
    let submissions = 0;
    const texts: string[] = [];
    const { open } = scriptedOpener([
      async (submit) => {
        const results = await Promise.all([submit.execute("s1", {}), submit.execute("s2", {})]);
        texts.push(...results.map(text));
        return undefined;
      },
    ]);
    const outcome = await runBuilderSession(
      INPUT,
      deps(open, async () => {
        submissions += 1;
        await Bun.sleep(5);
        return ACCEPTED;
      }),
    );
    expect(outcome).toMatchObject({ ok: true, validationAttempts: 1 });
    expect(submissions).toBe(1);
    expect(texts[0]).not.toContain("Do not call submit again");
    expect(texts[1]).toContain("Do not call submit again until it returns");
  });

  it("spends one turn on a max_tokens stop and nothing else", async () => {
    const { open } = scriptedOpener([() => ({ stopReason: "max_tokens" }), submitsOnce]);
    const outcome = await runBuilderSession(
      INPUT,
      deps(open, () => ACCEPTED),
    );
    expect(outcome).toMatchObject({ ok: true, turns: 2, validationAttempts: 1 });
  });

  it("stops at the turn bound with the last refusal's findings and still disposes the session", async () => {
    const { open, opened } = scriptedOpener([submitsOnce, () => undefined]);
    const outcome = await runBuilderSession(
      { ...INPUT, maxTurns: 2 },
      deps(open, () => REFUSED),
    );
    expect(outcome).toMatchObject({
      ok: false,
      turns: 2,
      validationAttempts: 1,
      fingerprint: null,
      terminal: false,
    });
    expect(outcome.findings).toEqual(REFUSED.findings);
    expect(opened.disposed).toBe(1);
  });

  it("ends the round at a terminal refusal and closes every later hosted call in that turn", async () => {
    let refusal = { text: "", terminate: false };
    let after = "";
    let inspected = 0;
    const inspect = toolDouble({
      name: "harness_inspect",
      execute: async () => {
        inspected += 1;
        return { content: [{ type: "text", text: "ran" }] };
      },
    });
    const { open, opened } = scriptedOpener([
      async (submit, tools) => {
        const result = await submit.execute("submit", {});
        refusal = { text: text(result), terminate: result.terminate === true };
        const tool = required(toolNamed(tools, "harness_inspect"), "the inspect tool");
        after = text(await tool.execute("after-terminal", { action: "readiness" }));
        return undefined;
      },
      () => undefined,
    ]);
    const sink = recordSink();
    const outcome = await runBuilderSession(INPUT, {
      ...deps(open, () => ({ ...REFUSED, terminal: true }), [inspect]),
      ...sink,
    });
    expect(outcome).toMatchObject({ ok: false, turns: 1, validationAttempts: 1, terminal: true });
    expect(refusal.text).toContain("This refusal is final; no further submit is possible.");
    expect(refusal.text).toContain("- group");
    expect(refusal.text).not.toContain('Use harness_inspect {"action":"feedback"}');
    // `terminate` ends the pi prompt at this turn's boundary.
    expect(refusal.terminate).toBe(true);
    expect(inspected).toBe(0);
    expect(after).toContain('"status":"terminal-closed"');
    expect(sink.settled[0]?.customCalls.at(-1)?.semantic).toEqual({
      outcome: "terminal-closed",
      reason: "terminal-refusal",
    });
    expect([opened.prompts.length, opened.disposed]).toEqual([1, 1]);
  });

  it.each([
    ["no session cap", undefined, BUILDER_TURN_SETTLE_MS],
    ["a five-second session cap", 5_000, 5_000],
  ])("bounds each turn under %s", async (_, turnTimeoutMs, ceiling) => {
    const seen: Array<number | undefined> = [];
    const open = async () =>
      scriptedSession(async ({ turnTimeoutMs: bound }) => {
        seen.push(bound);
        return { status: "completed", assistantText: "worked" };
      });
    const sessionDeps = deps(open, () => ACCEPTED);
    if (turnTimeoutMs !== undefined) sessionDeps.turnTimeoutMs = turnTimeoutMs;
    await runBuilderSession({ ...INPUT, maxTurns: 1 }, sessionDeps);
    // Left unset, the session's own one-hour default would end an hour-long authoring turn.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBeGreaterThan(0);
    expect(seen[0]).toBeLessThanOrEqual(ceiling);
    if (turnTimeoutMs === undefined) expect(seen[0]).toBe(BUILDER_TURN_SETTLE_MS);
  });
});

describe("what a failed round leaves", () => {
  it("throws a failed turn to the outer classifier after its retries, disposing the session and keeping the spend", async () => {
    const usage = { inputTokens: 7, outputTokens: 3, totalTokens: 10, costUsd: 0.01 };
    const failing: TurnScript = (_submit, _tools, emit) => {
      emit({ type: "turn_failed", errorMessage: "boom", usage });
      return { status: "failed", errorMessages: ["boom"] };
    };
    // The first attempt plus the three retries a no-output failure is given.
    const { open, opened } = scriptedOpener([failing, failing, failing, failing]);
    const sink = recordSink();
    await expect(runBuilderSession(INPUT, { ...deps(open, () => ACCEPTED), ...sink })).rejects.toThrow(
      /turn failed \(role builder\).*boom/,
    );
    expect(opened.disposed).toBe(1);
    expect(sink.settled[0]).toMatchObject({
      outcome: "turn-non-result",
      turns: 4,
      submits: [],
      usage: { inputTokens: 28, outputTokens: 12, costUsd: 0.04, reportedTurns: 4 },
    });
  });

  it.each([
    [
      "disposal alone",
      { status: "completed" as const, assistantText: "worked" },
      { kind: "evidence-unavailable", phase: "session-dispose" },
    ],
    // The model's own failure is the one the caller needs, so the disposal error never replaces it.
    [
      "the turn and then disposal",
      { status: "failed" as const, errorMessages: ["model failed first"] },
      { kind: "turn-non-result", errorMessages: ["model failed first"] },
    ],
  ])("writes one typed unavailable record when %s throws", async (_, result, refusal) => {
    const sink = recordSink();
    const open = async () =>
      scriptedSession(
        async () => result,
        async () => {
          throw new Error("dispose broke");
        },
      );
    await expect(
      runBuilderSession({ ...INPUT, maxTurns: 1 }, { ...deps(open, () => ACCEPTED), ...sink }),
    ).rejects.toMatchObject(refusal);
    expect(sink.settled).toHaveLength(1);
    expect(sink.settled[0]).toMatchObject({ outcome: "evidence-unavailable" });
  });

  // A provider limit while the session opens is an environment non-result, never a Builder verdict.
  it("classifies a provider limit while opening the session as a turn non-result", async () => {
    const refusing = async (): Promise<HostSession> => {
      throw new Error("api_error status 429: session limit resets 1:30am");
    };
    const refusal = runBuilderSession(
      INPUT,
      deps(refusing, () => ACCEPTED),
    );
    await expect(refusal).rejects.toBeInstanceOf(BuildAgentTurnNonResult);
    await expect(refusal).rejects.toMatchObject({
      kind: "turn-non-result",
      errorMessages: [expect.stringContaining("status 429")],
    });
  });
});

describe("a round the Builder conversation keeps", () => {
  const idle: TurnScript = () => ({ toolCalls: { byName: {}, failedByName: {}, failed: 0, total: 0 } });
  const failedOnly: TurnScript = () => ({
    toolCalls: { byName: { Bash: 2 }, failedByName: { Bash: 2 }, failed: 2, total: 2 },
  });

  it("ends an uncapped round as no-progress after three turns without a successful call, and keeps the session", async () => {
    const { open, opened } = scriptedOpener([idle, failedOnly, idle, submitsOnce]);
    const conversation = new BuilderConversation();
    const first = await runBuilderSession(INPUT, { ...deps(open, () => ACCEPTED), conversation });
    expect(first).toMatchObject({ ok: false, turns: 3, terminal: true, terminalClause: "no-progress" });
    expect(opened.disposed).toBe(0);

    await runBuilderSession(INPUT, { ...deps(open, () => ACCEPTED), conversation });
    expect(opened.configured).toHaveLength(1);
    expect(opened.prompts[3]).toStartWith(
      "A new round opens in this conversation. The last round ended after 3 turns in a row without a successful tool call.",
    );
    await conversation.close();
  });

  it("resets the no-progress count on a turn with one successful call among failures", async () => {
    const mixed: TurnScript = () => ({
      toolCalls: { byName: { Bash: 3 }, failedByName: { Bash: 2 }, failed: 2, total: 3 },
    });
    const { open } = scriptedOpener([idle, idle, mixed, idle, idle]);
    const outcome = await runBuilderSession(
      { ...INPUT, maxTurns: 5 },
      deps(open, () => ACCEPTED),
    );
    expect(outcome).toMatchObject({ turns: 5, terminal: false, terminalClause: null });
  });

  it("keeps the session through a turn the provider failed after its retries", async () => {
    const fail: TurnScript = () => ({ status: "failed", errorMessages: ["api_error status 500"] });
    const { open, opened } = scriptedOpener([fail, fail, fail, fail, submitsOnce]);
    const conversation = new BuilderConversation();
    await expect(
      runBuilderSession(INPUT, { ...deps(open, () => ACCEPTED), conversation }),
    ).rejects.toBeInstanceOf(BuildAgentTurnNonResult);
    expect(opened.disposed).toBe(0);

    await runBuilderSession(INPUT, { ...deps(open, () => ACCEPTED), conversation });
    expect(opened.configured).toHaveLength(1);
    expect(opened.prompts[4]).toContain(
      "The last round ended when a model turn failed on the provider's side",
    );
    await conversation.close();
    expect(opened.disposed).toBe(1);
  });
});

/**
 * The conversation's own lifecycle. A round that settles leaves its session open for the next to
 * configure; everything else is giving that session up cleanly, because a session held after its
 * round is a conversation the next round would inherit without meaning to.
 */
describe("BuilderConversation", () => {
  function recordingOpener(failDispose = false) {
    const opened: Array<{ tools: readonly PiTool[]; systemPrompt: string }> = [];
    const configured: Array<{ session: number; tools: readonly PiTool[]; systemPrompt: string }> = [];
    const disposed: number[] = [];
    const open: OpenSession = async (tools, systemPrompt) => {
      opened.push({ tools, systemPrompt });
      const ordinal = opened.length - 1;
      return scriptedSession(
        async () => ({ status: "completed", assistantText: "worked" }),
        () => {
          disposed.push(ordinal);
          if (failDispose) throw new Error("dispose failed");
        },
        (next, framing) => configured.push({ session: ordinal, tools: next, systemPrompt: framing }),
      );
    };
    return { open, opened, configured, disposed };
  }
  const tool = (name: string) => toolDouble({ name, execute: async () => ({ content: [] }) });
  const FIRST = [tool("read")];
  const SECOND = [tool("read"), tool("submit")];

  it("opens on the first round's roster and continues a kept session by configuring it", async () => {
    const recorded = recordingOpener();
    const conversation = new BuilderConversation();
    const first = await conversation.begin(FIRST, "first framing", "/runs/one", recorded.open);
    expect(recorded.opened).toEqual([{ tools: FIRST, systemPrompt: "first framing" }]);
    expect([first.openedIn, first.previous]).toEqual(["/runs/one", null]);
    await first.end("accepted");

    const second = await conversation.begin(SECOND, "second framing", "/runs/two", recorded.open);
    expect(second.session).toBe(first.session);
    expect(recorded.configured).toEqual([{ session: 0, tools: SECOND, systemPrompt: "second framing" }]);
    expect(second.openedIn).toBe("/runs/one");
    expect(second.previous).toEqual({ workspace: "/runs/one", ending: "accepted" });
    await second.end("turn-bound");

    const third = await conversation.begin(FIRST, "third framing", "/runs/three", recorded.open);
    expect(third.session).toBe(first.session);
    expect(third.previous).toEqual({ workspace: "/runs/two", ending: "turn-bound" });
    expect([recorded.opened.length, recorded.disposed]).toEqual([1, []]);
  });

  it("disposes a round ended without an ending, so the next round opens a fresh session", async () => {
    const recorded = recordingOpener();
    const conversation = new BuilderConversation();
    const first = await conversation.begin(FIRST, "first framing", "/runs/one", recorded.open);
    await first.end(null);
    expect(recorded.disposed).toEqual([0]);

    const second = await conversation.begin(SECOND, "second framing", "/runs/two", recorded.open);
    expect(recorded.opened).toHaveLength(2);
    expect(second.session).not.toBe(first.session);
    expect([second.openedIn, second.previous]).toEqual(["/runs/two", null]);
    expect(recorded.configured).toEqual([]);
  });

  it("disposes the waiting session at close, and a later round opens its own", async () => {
    const recorded = recordingOpener();
    const conversation = new BuilderConversation();
    const round = await conversation.begin(FIRST, "framing", "/runs/one", recorded.open);
    await round.end("terminal-refusal");
    await conversation.close();
    expect(recorded.disposed).toEqual([0]);

    const later = await conversation.begin(FIRST, "framing", "/runs/two", recorded.open);
    expect(later.session).not.toBe(round.session);
    expect(later.previous).toBeNull();
  });

  it("disposes a round still in flight at close when that round ends, whatever its ending", async () => {
    const recorded = recordingOpener();
    const conversation = new BuilderConversation();
    const round = await conversation.begin(FIRST, "framing", "/runs/one", recorded.open);
    await conversation.close();
    expect(recorded.disposed).toEqual([]);

    await round.end("accepted");
    expect(recorded.disposed).toEqual([0]);
    const next = await conversation.begin(SECOND, "framing", "/runs/two", recorded.open);
    expect(next.session).not.toBe(round.session);
    expect(recorded.configured).toEqual([]);
  });

  it("closes without throwing when disposing the waiting session fails", async () => {
    const recorded = recordingOpener(true);
    const conversation = new BuilderConversation();
    await (await conversation.begin(FIRST, "framing", "/runs/one", recorded.open)).end("accepted");
    await conversation.close();
    expect(recorded.disposed).toEqual([0]);
  });
});

describe("the Builder session wall-clock cap", () => {
  // There is no default wall; an explicit option wins over the environment.
  it.each([
    [undefined, {}, undefined],
    [120_000, { HARNESS_BUILDER_SESSION_CAP_MS: "7200000" }, 120_000],
    [undefined, { HARNESS_BUILDER_SESSION_CAP_MS: "7200000" }, 7_200_000],
  ])("reads option %p over environment %p as %p", (option, env, expected) => {
    expect(builderSessionCapMs(option, env)).toBe(expected);
  });

  // A typo that quietly meant no wall would only show itself in a session that had already run too long.
  it.each(["0", "-1", "1.5", "soon", ""])("refuses the malformed environment value %p", (raw) => {
    expect(() => builderSessionCapMs(undefined, { HARNESS_BUILDER_SESSION_CAP_MS: raw })).toThrow(
      /HARNESS_BUILDER_SESSION_CAP_MS must be a positive integer/,
    );
  });
});

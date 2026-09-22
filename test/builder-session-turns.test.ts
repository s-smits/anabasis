/**
 * The Builder session driver's loop (src/author/builder-session.ts): how many turns it spends, what
 * bounds each one, what a submit verdict does to the turn in flight, and what is left behind when a
 * turn or the session's own disposal fails.
 */
import { describe, expect, it } from "bun:test";

import { mkdirSync, mkdtempSync, writeFileSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { BuildAgentTurnNonResult } from "../src/author/build-agent.ts";
import type { BuilderExecutionEvidence } from "../src/author/builder-execution.ts";
import { BUILDER_TURN_SETTLE_MS } from "../src/author/builder-turn-loop.ts";
import { BUILDER_WORKSPACE_CARD, runBuilderSession } from "../src/author/builder-session.ts";
import { BuilderConversation } from "../src/author/builder-conversation.ts";
import { required, scriptedSession, toolDouble } from "./helpers/doubles.ts";
import {
  ACCEPTED,
  FINGERPRINT,
  INPUT,
  REFUSED,
  type TurnScript,
  deps,
  scriptedOpener,
  toolNamed,
} from "./helpers/builder-session-script.ts";

describe("the builder-session turn loop", () => {
  it("lets probe-only turns run to the turn bound without a strike or a stall clause", async () => {
    // Operator decision 2026-09-14: no probe budget or no-submit strike ends reconnaissance. A
    // successful probe is progress under the stall rule, so only the turn bound ends these turns.
    const workspace = mkdtempSync(join(tmpdir(), "ana-probe-only-"));
    mkdirSync(join(workspace, "agent"));
    mkdirSync(join(workspace, "correctness-model"));
    const probeOnly: TurnScript = (_submit, _tools, emit) => {
      for (let index = 0; index < 40; index += 1) {
        emit({ type: "tool_ended", toolName: "Bash", isError: false });
      }
      return {
        status: "completed",
        assistantText: "probed the toolchain",
        toolCalls: { byName: { Bash: 40 }, failedByName: {}, failed: 0, total: 40 },
      };
    };
    const { open, opened } = scriptedOpener([probeOnly, probeOnly, probeOnly]);

    const outcome = await runBuilderSession(
      { ...INPUT, workspace, maxTurns: 3 },
      deps(open, () => ACCEPTED),
    );

    expect(outcome).toMatchObject({
      ok: false,
      turns: 3,
      validationAttempts: 0,
      terminal: false,
      findings: [],
    });
    const { prompts } = opened;
    expect(prompts).toHaveLength(3);
    expect(prompts.join("\n")).not.toContain("Author now");
    expect(prompts.join("\n")).not.toContain("author-first");
    expect(prompts[2]).toContain("This round so far: turn 2, no submit yet. 1 of 3 turns remain.");
  });

  it("tells a submit called during an in-flight submit to wait for that call's verdict", async () => {
    // esp32-sol-20260908T214013792Z-23a1bc: five submit calls inside one running submit.
    const texts: string[] = [];
    const { open } = scriptedOpener([
      async (submit) => {
        const [first, second] = await Promise.all([submit.execute("s1", {}), submit.execute("s2", {})]);
        texts.push(first.content[0]?.text ?? "", second.content[0]?.text ?? "");
        return undefined;
      },
    ]);
    await runBuilderSession(
      { ...INPUT, maxTurns: 2 },
      deps(open, async () => {
        await Bun.sleep(5);
        return ACCEPTED;
      }),
    );
    expect(texts[1]).toContain("Do not call submit again until it returns");
    expect(texts[0]).not.toContain("Do not call submit again");
  });

  it("bounds each turn at the twenty-four-hour wedge backstop when no session cap is set", async () => {
    const capsSeen: Array<number | undefined> = [];
    const open = async () =>
      scriptedSession(async (opts) => {
        capsSeen.push(opts.turnTimeoutMs);
        return { status: "completed", assistantText: "worked" };
      });
    await runBuilderSession(
      { ...INPUT, maxTurns: 1 },
      deps(open, () => ACCEPTED),
    );
    // Absent turnTimeoutMs would fall to the session's one-hour default cap and end
    // an hour-long authoring turn as a typed non-result.
    expect(capsSeen).toEqual([BUILDER_TURN_SETTLE_MS]);
    capsSeen.length = 0;
    await runBuilderSession(
      { ...INPUT, maxTurns: 1 },
      { ...deps(open, () => ACCEPTED), turnTimeoutMs: 5_000 },
    );
    expect(capsSeen).toHaveLength(1);
    expect(capsSeen[0]).toBeGreaterThan(0);
    expect(capsSeen[0]).toBeLessThanOrEqual(5_000);
  });

  it("leaves a probe phase alone once it writes an owned file", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "ana-probe-write-"));
    mkdirSync(join(workspace, "agent"));
    mkdirSync(join(workspace, "correctness-model"));
    const { open, opened } = scriptedOpener([
      (_submit, _tools, emit) => {
        writeFileSync(join(workspace, "agent/tools.ts"), "export const ready = true;\n");
        for (let index = 0; index < 20; index += 1) {
          emit({ type: "tool_ended", toolName: "Bash", isError: false });
        }
        return undefined;
      },
      async (submit) => {
        await submit.execute("submit", {});
        return undefined;
      },
    ]);

    const outcome = await runBuilderSession(
      { ...INPUT, workspace },
      deps(open, () => ACCEPTED),
    );

    expect(outcome).toMatchObject({ ok: true, turns: 2 });
    expect(opened.prompts).toHaveLength(2);
    expect(opened.prompts[1]).toContain("Continue towards this round's goal");
    expect(opened.prompts[1]).not.toContain("has changed since this round opened");
  });

  it("runs one session until the candidate is accepted and returns failed checks to the model", async () => {
    const outcomes = [REFUSED, ACCEPTED];
    const texts: string[] = [];
    const { open, opened } = scriptedOpener([
      () => undefined, // turn 1: authoring, no submit yet
      async (submit) => {
        texts.push((await submit.execute("t1", {})).content[0]?.text ?? "");
        return undefined;
      },
      async (submit) => {
        texts.push((await submit.execute("t2", {})).content[0]?.text ?? "");
        return undefined;
      },
    ]);
    const marker = toolDouble({
      name: "read",
      async execute() {
        return { content: [{ type: "text", text: "unused" }] };
      },
    });
    const outcome = await runBuilderSession(
      INPUT,
      deps(open, () => required(outcomes.shift(), "the next scripted record outcome"), [marker]),
    );
    expect(outcome).toMatchObject({
      ok: true,
      turns: 3,
      validationAttempts: 2,
      findings: [],
      terminal: false,
    });
    expect(outcome.fingerprint).toBe(FINGERPRINT);
    expect(texts[0]).toContain("refused at bundle");
    expect(texts[0]).toContain("missing-bundle-file correctness-model/tasks.json");
    expect(texts[1]).toMatch(/accepted/i);
    expect(opened.tools[0]).toMatchObject({ name: marker.name });
    expect(toolNamed(opened.tools, "submit")?.name).toBe("submit");
    expect(opened.systemPrompt.startsWith("You are the Builder.")).toBe(true);
    expect(opened.systemPrompt).toContain(BUILDER_WORKSPACE_CARD);
    expect(opened.systemPrompt).toContain("Withhold hidden expectations");
    // The loop, the gate sequence and the refusal codes belong to STARTER.md; the batching duty to
    // the submit-boundary continuation below (tenet 14, one duty one owner).
    expect(opened.systemPrompt).not.toContain("repair group");
    expect([opened.disposed, opened.prompts.length]).toEqual([1, 3]);
    expect(opened.prompts[0]).toContain(INPUT.kickoff);
    expect(opened.prompts[0]).toContain("Read STARTER.md and the file tree");
    expect(opened.prompts[0]).not.toContain("MEMORY.md");
    expect(opened.prompts[1]).toContain("Continue towards this round's goal");
    expect(opened.prompts[2]).toContain("Fix what the last refusal named, and batch the fixes");
  });

  it("runs one controller submission when a transport dispatches duplicate submit calls together", async () => {
    let submissions = 0;
    const { open } = scriptedOpener([
      async (submit) => {
        await Promise.all([submit.execute("t1", {}), submit.execute("t2", {})]);
        return undefined;
      },
    ]);
    const outcome = await runBuilderSession(
      INPUT,
      deps(open, () => {
        submissions += 1;
        return ACCEPTED;
      }),
    );
    expect(outcome).toMatchObject({ ok: true, validationAttempts: 1 });
    expect(submissions).toBe(1);
  });

  it("a max_tokens turn costs a turn and nothing else — the deliverable is files plus submit", async () => {
    const { open } = scriptedOpener([
      () => ({ stopReason: "max_tokens" }),
      async (submit) => {
        await submit.execute("t1", {});
        return undefined;
      },
    ]);
    const outcome = await runBuilderSession(
      INPUT,
      deps(open, () => ACCEPTED),
    );
    expect(outcome).toMatchObject({ ok: true, turns: 2, validationAttempts: 1 });
  });

  it("stops at the turn bound with the last refusal's findings; the session is still disposed", async () => {
    const { open, opened } = scriptedOpener([
      async (submit) => {
        await submit.execute("t1", {});
        return undefined;
      },
      () => undefined,
    ]);
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
    expect(outcome.findings).toEqual(REFUSED.ok === false ? REFUSED.findings : []);
    expect(opened.disposed).toBe(1);
  });

  it("ends the round at a terminal refusal instead of spending repair turns", async () => {
    let refusal = "";
    let terminate: boolean | undefined;
    const { open, opened } = scriptedOpener([
      async (submit) => {
        const result = await submit.execute("t1", {});
        refusal = result.content[0]?.text ?? "";
        terminate = result.terminate;
        return undefined;
      },
      () => undefined,
    ]);
    const outcome = await runBuilderSession(
      INPUT,
      deps(open, () => ({ ...REFUSED, terminal: true })),
    );
    expect(outcome).toMatchObject({ ok: false, turns: 1, validationAttempts: 1, terminal: true });
    expect(refusal).toContain("This refusal is final; no further submit is possible.");
    expect(refusal).not.toContain('Use harness_inspect {"action":"feedback"}');
    expect(refusal).toContain("- group");
    // The result carries `terminate`, which ends the pi prompt at this turn's boundary.
    expect(terminate).toBe(true);
    expect(opened.prompts).toEqual([expect.any(String)]);
    expect(opened.disposed).toBe(1);
  });

  it("returns terminal-closed without executing a later custom call from the same provider turn", async () => {
    let executed = 0;
    let after = "";
    const marker = toolDouble({
      name: "harness_inspect",
      description: "marker",
      async execute() {
        executed += 1;
        return { content: [{ type: "text", text: "ran" }] };
      },
    });
    const completed: BuilderExecutionEvidence[] = [];
    const { open } = scriptedOpener([
      async (submit, tools) => {
        await submit.execute("submit", {});
        const inspect = required(toolNamed(tools, "harness_inspect"), "the inspect tool");
        after = (await inspect.execute("after-terminal", { action: "readiness" })).content[0]?.text ?? "";
        return undefined;
      },
    ]);
    await runBuilderSession(INPUT, {
      ...deps(open, () => ({ ...REFUSED, terminal: true }), [marker]),
      onExecution: (evidence) => completed.push(evidence),
    });
    expect(executed).toBe(0);
    expect(after).toContain('"status":"terminal-closed"');
    expect(completed[0]?.customCalls.at(-1)?.semantic).toEqual({
      outcome: "terminal-closed",
      reason: "terminal-refusal",
    });
  });

  it("writes one typed unavailable record when session disposal throws", async () => {
    const completed: BuilderExecutionEvidence[] = [];
    const open = async () =>
      scriptedSession(
        async () => {
          return { status: "completed", assistantText: "worked" };
        },
        async () => {
          throw new Error("dispose broke");
        },
      );
    await expect(
      runBuilderSession(
        { ...INPUT, maxTurns: 1 },
        {
          ...deps(open, () => ACCEPTED),
          onExecution: (evidence) => completed.push(evidence),
        },
      ),
    ).rejects.toMatchObject({ kind: "evidence-unavailable", phase: "session-dispose" });
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      outcome: "evidence-unavailable",
      lifecycle: { kind: "evidence-unavailable", phase: "session-dispose" },
      turns: 1,
    });
  });

  it("keeps the model error when both the turn and disposal fail", async () => {
    const completed: BuilderExecutionEvidence[] = [];
    const open = async () =>
      scriptedSession(
        async () => {
          return { status: "failed", errorMessages: ["model failed first"] };
        },
        async () => {
          throw new Error("dispose broke second");
        },
      );
    await expect(
      runBuilderSession(
        { ...INPUT, maxTurns: 1 },
        {
          ...deps(open, () => ACCEPTED),
          onExecution: (evidence) => completed.push(evidence),
        },
      ),
    ).rejects.toThrow(/model failed first/);
    expect(completed[0]).toMatchObject({ outcome: "evidence-unavailable" });
  });

  it("a failed probe-heavy turn still throws for the outer classifier and disposes the session", async () => {
    const probeThenFail: TurnScript = (_submit, _tools, emit) => {
      for (let index = 0; index < 20; index += 1) {
        emit({ type: "tool_ended", toolName: "Bash", isError: false });
      }
      return { status: "failed", errorMessages: ["boom"] };
    };
    // The first attempt plus the three retries a no-output failure is given.
    const { open, opened } = scriptedOpener([probeThenFail, probeThenFail, probeThenFail, probeThenFail]);
    await expect(
      runBuilderSession(
        INPUT,
        deps(open, () => ACCEPTED),
      ),
    ).rejects.toThrow(/turn failed \(role builder\).*boom/);
    expect(opened.disposed).toBe(1);
  });

  // A provider limit while the session opens is an environment non-result, never a Builder verdict.
  it("classifies a provider limit while opening the session as a turn non-result", async () => {
    await expect(
      runBuilderSession(
        INPUT,
        deps(
          async () => {
            throw new Error("api_error status 429: session limit resets 1:30am");
          },
          () => ACCEPTED,
        ),
      ),
    ).rejects.toBeInstanceOf(BuildAgentTurnNonResult);
  });
});

describe("a round the Builder conversation keeps", () => {
  const idle: TurnScript = () => ({ toolCalls: { byName: {}, failedByName: {}, failed: 0, total: 0 } });
  const failedOnly: TurnScript = () => ({
    toolCalls: { byName: { Bash: 2 }, failedByName: { Bash: 2 }, failed: 2, total: 2 },
  });
  const submits: TurnScript = async (submit) => {
    await submit.execute("submit", {});
    return undefined;
  };

  it("ends an uncapped round as no-progress after three turns without a successful call, and keeps the session", async () => {
    // Codex blocks a goal on three turns with no tool call or only failed commands; one count covers both.
    const { open, opened } = scriptedOpener([idle, failedOnly, idle, submits]);
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

  it("resets the count on a turn with one successful call among failures", async () => {
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

  it("keeps the session through a turn the provider failed after its retries, as a Codex goal survives one", async () => {
    const fail: TurnScript = () => ({ status: "failed", errorMessages: ["api_error status 500"] });
    const { open, opened } = scriptedOpener([fail, fail, fail, fail, submits]);
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

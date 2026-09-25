/**
 * The evidence one Builder round leaves: the execution record it checkpoints while it runs, the one
 * record it settles, and the session evidence the entry gate writes before any provider sees a tool.
 *
 * A session killed mid-turn keeps whatever reached disk, so the checkpoint cases are about what is
 * durable before the turn that produced it has ended. The settled cases are about what one record
 * says the round spent and submitted, and what it refuses to carry.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { toToolDeclaration } from "@earendil-works/pi-ai";

import { mkdtempSync, readFileSync, rmSync } from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { submitProjection } from "../src/author/builder-execution.ts";
import { runBuilderSession } from "../src/author/builder-session.ts";
import type { PathRecord } from "../src/builder/candidate-isolation-runtime.ts";
import type { CandidateAccessPolicy } from "../src/builder/candidate-isolation.ts";
import { writeBuilderSessionEvidence } from "../src/builder/session-evidence.ts";
import { builderShellWall } from "../src/run/builder-backend.ts";
import { double, required, scriptedSession, toolDouble } from "./helpers/doubles.ts";
import {
  ACCEPTED,
  INPUT,
  REFUSED,
  deps,
  recordSink,
  scriptedOpener,
  submitsOnce,
  toolNamed,
} from "./helpers/builder-session-script.ts";

describe("the checkpoints a running round writes", () => {
  it("checkpoints the opening prompt, every turn and every submission, the submission before its turn settles", async () => {
    const outcomes = [REFUSED, ACCEPTED];
    const { open } = scriptedOpener([() => undefined, submitsOnce, submitsOnce]);
    const sink = recordSink();
    await runBuilderSession(INPUT, {
      ...deps(open, () => required(outcomes.shift(), "the next scripted outcome")),
      ...sink,
    });
    // The opening checkpoint, three turn checkpoints and two submit checkpoints, in event order.
    expect(sink.checkpoints.map((c) => c.outcome)).toEqual(Array(6).fill("in-flight"));
    // A kill inside the first turn still leaves a record naming the prompt it was given.
    expect(sink.checkpoints[0]).toMatchObject({ turns: 0 });
    expect(sink.checkpoints[0]?.prose?.map((row) => [row.kind, row.turn])).toEqual([["prompt", 1]]);
    // The refusal reaches disk while its turn is still running.
    expect(sink.checkpoints[2]).toMatchObject({ turns: 1, submits: [{ ordinal: 1 }] });
    expect(sink.settled).toMatchObject([{ outcome: "recorded", submits: [{ ordinal: 1 }, { ordinal: 2 }] }]);
  });

  it("checkpoints liveness inside a turn from the first tool call, at most once per interval", async () => {
    const open = async () =>
      scriptedSession(async ({ onEvent }) => {
        for (const toolName of ["Read", "Bash", "Edit"]) onEvent?.({ type: "tool_started", toolName });
        return { status: "completed", assistantText: "worked" };
      });
    const sink = recordSink();
    await runBuilderSession({ ...INPUT, maxTurns: 1 }, { ...deps(open, () => ACCEPTED), ...sink });
    // The opening checkpoint, one liveness checkpoint inside the turn, then the turn's own.
    expect(sink.checkpoints).toHaveLength(3);
    expect(sink.checkpoints[1]).toMatchObject({
      outcome: "in-flight",
      turns: 0,
      firstToolMs: expect.any(Number),
    });
    expect(sink.checkpoints[2]).toMatchObject({ outcome: "in-flight", turns: 1 });
  });

  it("checkpoints after every hosted tool return inside a turn that has not ended", async () => {
    const checkTool = toolDouble({
      name: "correctness_check",
      description: "check",
      execute: async () => ({ content: [{ type: "text", text: "refused" }] }),
    });
    const sink = recordSink();
    const seen: number[] = [];
    const { open } = scriptedOpener([
      async (_submit, tools) => {
        const check = required(toolNamed(tools, "correctness_check"), "the hosted check tool");
        for (const id of ["c1", "c2", "c3"]) {
          await check.execute(id, {});
          seen.push(sink.checkpoints.length);
        }
        return undefined;
      },
      submitsOnce,
    ]);
    await runBuilderSession(INPUT, { ...deps(open, () => ACCEPTED, [checkTool]), ...sink });
    expect(seen).toEqual([2, 3, 4]);
    expect(sink.checkpoints[3]?.customCalls).toHaveLength(3);
    expect(sink.checkpoints[3]?.turns).toBe(0);
  });
});

describe("the record a round settles", () => {
  it("settles one record: turn tally, tool split, the repeated submissions and unknown spend", async () => {
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
    const sink = recordSink();
    await runBuilderSession({ ...INPUT, maxTurns: 3 }, { ...deps(open, () => REFUSED), ...sink });
    expect(sink.settled).toHaveLength(1);
    const evidence = required(sink.settled[0], "the settled record");
    expect(evidence).toMatchObject({
      schema: "builder-execution/v6",
      backend: "claude",
      turns: 3,
      outcome: "turn-bound",
    });
    expect(submitProjection(evidence.submits)).toMatchObject({
      repeatedFindingSubmits: 1,
      unchangedTreeSubmits: 1,
    });
    // custom counts the controller's own roster; the rest is the backend's native workspace contract.
    expect(evidence.toolCalls).toMatchObject({ total: 8, failed: 1, custom: 3, native: 5 });
    expect(evidence.toolCalls.byName).toEqual({ Read: 3, context: 1, submit: 2, Edit: 2 });
    expect(evidence.failedByName).toEqual({ Read: 1 });
    expect(evidence.submits).toMatchObject([
      { ordinal: 1, repeatedFindings: null, findingsDelta: null, workspaceChanged: null },
      {
        ordinal: 2,
        repeatedFindings: true,
        findingsDelta: { carried: 1, resolved: 0, introduced: 0 },
        workspaceChanged: false,
        findingCodes: ["missing-bundle-file"],
      },
    ]);
    // Nothing reported spend, so every field stays unknown instead of reading as a free session.
    expect(evidence.usage).toEqual({
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      reportedTurns: 0,
      estimatedTurns: 0,
    });
  });

  it("records ordered safe custom-tool intent without arguments or result text", async () => {
    const inspectTool = toolDouble({
      name: "harness_inspect",
      description: "inspect",
      execute: async () => ({
        content: [{ type: "text", text: "private-result-text" }],
        details: { receipt: { outcome: "clear", findings: 0, resultDigest: "safe-result-digest" } },
      }),
    });
    const trialTool = toolDouble({
      name: "harness_trial",
      description: "trial",
      execute: async () => {
        throw new Error("private-trial-error");
      },
    });
    const { open } = scriptedOpener([
      async (submit, tools) => {
        await required(toolNamed(tools, "harness_inspect"), "inspect").execute("inspect-1", {
          action: "task",
          taskId: "public-task-7",
          note: "do-not-record",
        });
        await required(toolNamed(tools, "harness_trial"), "trial")
          .execute("trial-1", { taskId: "public-task-7" })
          .catch(() => undefined);
        await submit.execute("submit-1", {});
        return undefined;
      },
    ]);
    const sink = recordSink();
    await runBuilderSession(INPUT, { ...deps(open, () => ACCEPTED, [inspectTool, trialTool]), ...sink });
    const evidence = required(sink.settled[0], "the settled record");
    expect(evidence.customCalls).toMatchObject([
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
      { sequence: 3, turn: 1, tool: "submit", action: "submit", target: {}, dispatchOutcome: "returned" },
    ]);
    expect(evidence.customCallsOmitted).toBe(0);
    const serialised = JSON.stringify(evidence);
    for (const leaked of ["do-not-record", "private-result-text", "private-trial-error"]) {
      expect(serialised).not.toContain(leaked);
    }
  });

  it("records each turn's prompt and compactions, with the compaction's own summary, beside the Builder's words", async () => {
    const { open } = scriptedOpener([
      () => ({
        status: "completed",
        assistantText: "reading",
        compactions: [
          { tokensBefore: 90_000, compacted: true },
          { tokensBefore: 80_000, compacted: true, summary: "Summary: the checks pass." },
        ],
      }),
      submitsOnce,
    ]);
    const sink = recordSink();
    await runBuilderSession(INPUT, { ...deps(open, () => ACCEPTED), ...sink });
    const prose = required(sink.settled[0]?.prose, "the settled prose");
    expect(prose.slice(0, 5).map((row) => [row.kind, row.turn])).toEqual([
      ["prompt", 1],
      ["message", 1],
      ["compaction", 1],
      ["compaction", 1],
      ["prompt", 2],
    ]);
    // The accepting turn ends the round, so the continuation composed after it was never sent.
    expect(prose.filter((row) => row.kind === "prompt").map((row) => row.turn)).toEqual([1, 2]);
    expect(prose.slice(2, 4).map((row) => row.text)).toEqual([
      "tokensBefore=90000 compacted=true",
      "tokensBefore=80000 compacted=true\n\nSummary: the checks pass.",
    ]);
  });
});

describe("the Builder entry gate evidence", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const epoch = () => {
    const dir = mkdtempSync(join(tmpdir(), "ana-builder-session-"));
    dirs.push(dir);
    return dir;
  };
  const written = (dir: string) => JSON.parse(readFileSync(join(dir, "builder-session.json"), "utf8"));
  const NAMES = [
    "read",
    "grep",
    "find",
    "ls",
    "edit",
    "write",
    "bash",
    "context",
    "correctness_check",
    "harness_inspect",
    "harness_reset",
    "harness_trial",
    "public_source",
    "verifier_workshop",
    "submit",
  ];

  /** The session evidence input, with the declarations the provider receives projected exactly as
   *  the production recorder projects them unless `exposed` says otherwise. */
  function input(
    epochDir: string,
    roster = NAMES,
    exposed?: (tool: { name: string; description: string }) => string,
  ) {
    const tools = roster.map((name) => ({
      name,
      description: `tool ${name}`,
      parameters: { type: "object" },
    }));
    return {
      epochDir,
      tools,
      policy: double<CandidateAccessPolicy>({ digest: "a".repeat(64), network: "deny" }),
      capabilityPolicies: {},
      record: double<PathRecord>({ sessionId: "builder-primary" }),
      framing: "builder",
      contract: {
        backend: "claude" as const,
        backendExposed: tools.map((tool) =>
          toToolDeclaration({ ...tool, description: exposed?.(tool) ?? tool.description }),
        ),
      },
    };
  }

  it("records equality from catalogue through registration to backend exposure", () => {
    const dir = epoch();
    const evidence = writeBuilderSessionEvidence(input(dir));
    expect(evidence.schema).toBe("builder-session-evidence/v4");
    expect(evidence.contract?.catalogued).toEqual(evidence.contract?.backendExposed);
    expect(evidence.contract?.registered).toEqual(evidence.contract?.backendExposed);
    expect(evidence.contract?.registeredSchemaDigest).toBe(evidence.contract?.backendExposedSchemaDigest);
    expect(written(dir).contract.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  // An unregistered tool never reaches a provider, and a missing submit is a session with no way out.
  it.each([
    [
      "a roster missing submit",
      NAMES.slice(0, -1),
      undefined,
      /registered=[^ ]*,read,verifier_workshop,write backend-exposed=/,
    ],
    [
      "a roster carrying a tool outside the catalogue",
      [...NAMES, "unregistered"],
      undefined,
      /registered=[^ ]*,unregistered,/,
    ],
    [
      "a backend declaration whose meaning changed",
      NAMES,
      (tool: { name: string; description: string }) =>
        tool.name === "submit" ? "changed meaning" : tool.description,
      /registered tool descriptions or schemas differ from the claude backend contract/,
    ],
  ])("refuses %s", (_, roster, exposed, refusal) => {
    const dir = epoch();
    expect(() => writeBuilderSessionEvidence(input(dir, roster, exposed))).toThrow(/^Builder entry gate: /);
    expect(() => writeBuilderSessionEvidence(input(dir, roster, exposed))).toThrow(refusal);
  });

  it("names every walled path with its verb, and records no wall where no backend was built", () => {
    const dir = epoch();
    const workspace = join(dir, "workspace");
    const wall = builderShellWall("claude", workspace, { allow: ["/opt/deps"] });
    expect(wall.execution).toBe("host-tools");
    expect(wall.hostAccess[workspace]).toBe("write");
    expect(Object.values(wall.hostAccess)).toContain("deny");
    expect(wall.readGrant).toEqual(["/opt/deps"]);
    // The digest separates two walls that differ only in the read closure.
    expect(builderShellWall("claude", workspace, { allow: [] }).digest).not.toBe(wall.digest);
    writeBuilderSessionEvidence({ ...input(dir), shellWall: wall });
    expect(written(dir).shellWall).toEqual(wall);
    // A composition probe builds no backend and records no wall rather than an empty one.
    writeBuilderSessionEvidence(input(dir));
    expect(Object.hasOwn(written(dir), "shellWall")).toBe(false);
  });
});

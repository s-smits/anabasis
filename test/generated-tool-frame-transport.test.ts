// The transport between the controller and one confined generated-tool worker.
//
// Every Built tool call crosses it: the parent writes a JSONL frame on the child's stdin, the
// child answers with a frame signed under a per-worker secret and a counter that only counts up.
// The controller trusts a child frame exactly as far as this file's checks do, so each check is
// exercised here from both sides — a frame the transport must carry, and the nearest frame it
// must refuse.
//
// Nothing here starts a process. The reader and writer are pure over bytes, which is what makes
// their absence from the suite a gap rather than a cost.

import { describe, expect, it } from "bun:test";
import { Type } from "typebox";

import {
  BUILT_FILE_MAX_CHARS,
  GENERATED_TOOL_FRAME_MAX_BYTES,
  GENERATED_TOOL_PROTOCOL,
  type GeneratedToolChildMessage,
  type GeneratedToolParentMessage,
  GeneratedToolWorkerNonResult,
  generatedToolInterface,
  parseGeneratedToolParentFrame,
  serializeGeneratedToolParentFrame,
  signGeneratedToolFrame,
  trySignGeneratedToolFrame,
  verifyGeneratedToolFrame,
} from "../src/solve/generated-tool-worker-protocol.ts";
import type { BuiltStarterCheckpoint, BuiltStarterRegistration } from "../src/solve/built-starter.ts";
import { ARTIFACT_JSON_MAX_BYTES } from "../src/solve/draft-store.ts";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { PublicArtifactSchema } from "../src/solve/public-artifact-schema.ts";

const SECRET = "a".repeat(64);
const OTHER_SECRET = "b".repeat(64);
const DIGEST = "0".repeat(64);

const ARTIFACT_SCHEMA: PublicArtifactSchema = {
  schema: "public-artifact-schema/v4",
  root: { kind: "object", properties: {}, required: [], additionalProperties: false },
  sha256: DIGEST,
};

/** Each field a test replaces. The three widened ones carry values the schema must refuse. */
type ReadyOverrides = {
  registration?: BuiltStarterRegistration;
  checkpoint?: BuiltStarterCheckpoint;
  execWall?: string;
  probe?: Record<keyof typeof PROBE, { status: string; code: string }>;
};

function checkpoint(overrides: Partial<BuiltStarterCheckpoint> = {}): BuiltStarterCheckpoint {
  return {
    schema: "built-starter-checkpoint/v2",
    turn: 1,
    draftSeq: 0,
    draftDigest: DIGEST,
    fileMapDigest: DIGEST,
    artifactWriterNames: [],
    materialization: { state: "absent" },
    ...overrides,
  };
}

function registration(overrides: Partial<BuiltStarterRegistration> = {}): BuiltStarterRegistration {
  return {
    schema: "built-starter-registration/v2",
    tools: [{ name: "read_task", owner: "controller", authority: "reader" }],
    artifactWriterNames: [],
    ...overrides,
  };
}

const PROVED = { status: "proved", code: "EACCES" } as const;
const PROBE = {
  outsideReadRefused: PROVED,
  outsideWriteRefused: PROVED,
  credentialEnvironmentAbsent: PROVED,
  networkRefused: PROVED,
  subprocessRefused: PROVED,
  runtimeReExecRefused: PROVED,
};

function ready(overrides: ReadyOverrides = {}): GeneratedToolChildMessage {
  // SAFETY: the fields below are the `ready` arm of GeneratedToolChildMessage; a test that
  // overrides one into an invalid value is asking the transport to refuse the frame.
  return {
    type: "ready",
    pid: 4242,
    workerInstanceId: "worker-1",
    bundleDigest: DIGEST,
    tools: [],
    registration: registration(),
    checkpoint: checkpoint(),
    probe: PROBE,
    execWall: "landlock",
    ...overrides,
  } as GeneratedToolChildMessage;
}

function toolResult(text: string): GeneratedToolChildMessage {
  return {
    type: "tool_result",
    requestId: "r1",
    result: { content: [{ type: "text", text }], details: null },
    checkpoint: checkpoint(),
  };
}

/** Sign a payload and read it straight back, which is the only path the controller uses. */
function roundTrip(payload: GeneratedToolChildMessage, counter = 1): GeneratedToolChildMessage {
  return verifyGeneratedToolFrame(signGeneratedToolFrame(SECRET, counter, payload), SECRET, counter);
}

function refusal(read: () => void): GeneratedToolWorkerNonResult {
  try {
    read();
  } catch (error) {
    if (error instanceof GeneratedToolWorkerNonResult) return error;
    throw error;
  }
  throw new Error("expected the transport to refuse this frame");
}

describe("a child frame the controller can trust", () => {
  it("carries a tool result back under its own counter", () => {
    const carried = roundTrip(toolResult("42 kg"), 7);
    expect(carried.type).toBe("tool_result");
    if (carried.type !== "tool_result") return;
    const first = carried.result.content[0];
    expect(first?.type === "text" ? first.text : null).toBe("42 kg");
  });

  it("refuses the same frame replayed at the next counter", () => {
    const frame = signGeneratedToolFrame(SECRET, 3, toolResult("ok"));
    expect(refusal(() => verifyGeneratedToolFrame(frame, SECRET, 4)).kind).toBe("protocol");
  });

  it("refuses a frame signed under another worker's secret", () => {
    const frame = signGeneratedToolFrame(OTHER_SECRET, 1, toolResult("ok"));
    expect(refusal(() => verifyGeneratedToolFrame(frame, SECRET, 1)).message).toContain("attestation");
  });

  it("refuses a payload edited after signing, even by one character", () => {
    const frame = signGeneratedToolFrame(SECRET, 1, toolResult("42 kg"));
    const edited = frame.replace("42 kg", "43 kg");
    expect(edited).not.toBe(frame);
    expect(refusal(() => verifyGeneratedToolFrame(edited, SECRET, 1)).message).toContain("attestation");
  });

  it("refuses the same fields in another order, so the signed bytes are the only reading", () => {
    const frame = signGeneratedToolFrame(SECRET, 1, toolResult("ok"));
    const attestation = /"attestation":"([0-9a-f]{64})"/.exec(frame)?.[1] ?? "";
    const payload = /"payload":(\{.*\}),"schema"/.exec(frame)?.[1] ?? "";
    expect(attestation).not.toBe("");
    const reordered = `{"schema":"generated-tool-worker-frame/v2","counter":1,"payload":${payload},"attestation":"${attestation}"}`;
    expect(refusal(() => verifyGeneratedToolFrame(reordered, SECRET, 1)).message).toContain("canonical");
  });

  it("refuses bytes that are not JSON at all", () => {
    expect(refusal(() => verifyGeneratedToolFrame("not json", SECRET, 1)).message).toContain("malformed");
  });

  it("refuses a frame missing its attestation rather than reading the payload", () => {
    // Attestation sorts first, so dropping it leaves the canonical spelling of the other three:
    // the reader has to reach the frame's shape, not stop at its bytes.
    const unsigned = signGeneratedToolFrame(SECRET, 1, toolResult("ok")).replace(
      /^\{"attestation":"[0-9a-f]{64}",/,
      "{",
    );
    expect(refusal(() => verifyGeneratedToolFrame(unsigned, SECRET, 1)).message).toContain("identity");
  });

  it("refuses a line past the frame ceiling before parsing it", () => {
    const oversized = `"${"x".repeat(GENERATED_TOOL_FRAME_MAX_BYTES)}"`;
    expect(refusal(() => verifyGeneratedToolFrame(oversized, SECRET, 1)).message).toContain("byte limit");
  });
});

describe("a payload the transport cannot carry", () => {
  it("reports no frame rather than a truncated one", () => {
    const huge = toolResult("x".repeat(GENERATED_TOOL_FRAME_MAX_BYTES));
    expect(trySignGeneratedToolFrame(SECRET, 1, huge)).toBeNull();
  });

  it("reports no frame for a value JSON has no spelling for", () => {
    const notFinite = toolResult("ok");
    // SAFETY: the transport's job is to refuse this, so the test has to construct it.
    (notFinite as { result: { details: unknown } }).result.details = Number.POSITIVE_INFINITY;
    expect(trySignGeneratedToolFrame(SECRET, 1, notFinite)).toBeNull();
  });

  it("substitutes a protocol non-result the controller can still verify", () => {
    const huge = toolResult("x".repeat(GENERATED_TOOL_FRAME_MAX_BYTES));
    const carried = roundTrip(huge, 5);
    expect(carried.type).toBe("non_result");
    if (carried.type !== "non_result") return;
    expect(carried.kind).toBe("protocol");
  });

  it("binds the substituted frame to the counter it replaced", () => {
    const huge = toolResult("x".repeat(GENERATED_TOOL_FRAME_MAX_BYTES));
    const frame = signGeneratedToolFrame(SECRET, 5, huge);
    expect(refusal(() => verifyGeneratedToolFrame(frame, SECRET, 6)).kind).toBe("protocol");
  });

  it("separates an unusable identity from an unusable payload: the signer throws", () => {
    expect(() => trySignGeneratedToolFrame("short", 1, toolResult("ok"))).toThrow("invalid identity");
    expect(() => trySignGeneratedToolFrame(SECRET, 0, toolResult("ok"))).toThrow("invalid identity");
  });
});

describe("what a ready frame has to agree with", () => {
  const writer = (name: string) => ({
    name,
    owner: "domain" as const,
    authority: "artifact-writer" as const,
  });

  it("carries a registration whose writers are the names it declares", () => {
    const consistent = registration({
      tools: [writer("submit_truss"), { name: "read_task", owner: "controller", authority: "reader" }],
      artifactWriterNames: ["submit_truss"],
    });
    expect(roundTrip(ready({ registration: consistent })).type).toBe("ready");
  });

  it.each<[string, ReadyOverrides]>([
    [
      "an artifact writer the declared names leave out",
      { registration: registration({ tools: [writer("submit_truss")], artifactWriterNames: [] }) },
    ],
    [
      "a declared name no registered tool answers to",
      { registration: registration({ artifactWriterNames: ["submit_truss"] }) },
    ],
    [
      "two tools registered under one name",
      {
        registration: registration({
          tools: [
            { name: "read_task", owner: "controller", authority: "reader" },
            { name: "read_task", owner: "domain", authority: "reader" },
          ],
        }),
      },
    ],
    [
      "writer names out of order, so one registration has one spelling",
      {
        registration: registration({
          tools: [writer("write_b"), writer("write_a")],
          artifactWriterNames: ["write_b", "write_a"],
        }),
      },
    ],
    ["a worker that reports no execution wall", { execWall: "none" }],
    [
      "a probe outcome that is neither proved, violated nor a non-result",
      { probe: { ...PROBE, networkRefused: { status: "skipped", code: "n/a" } } },
    ],
  ])("refuses %s", (_case, overrides) => {
    expect(refusal(() => roundTrip(ready(overrides))).message).toContain("payload is invalid");
  });
});

describe("what a checkpoint has to agree with", () => {
  const carry = (value: BuiltStarterCheckpoint) => () =>
    roundTrip({ type: "materialization_result", requestId: "r1", checkpoint: value });

  const record = (sourceSeq: number) => ({
    artifactJson: "{}",
    artifactDigest: DIGEST,
    sourceSeq,
    writerName: "submit_truss",
    callId: "c1",
  });

  it.each([
    [
      "a current materialization written at the draft the checkpoint reports",
      4,
      { state: "current", record: record(4) },
    ],
    [
      "a stale materialization the draft has moved past",
      6,
      { state: "stale", record: record(4), currentSeq: 6 },
    ],
  ] as const)("carries %s", (_case, draftSeq, materialization) => {
    const value = checkpoint({ draftSeq, materialization });
    expect(carry(value)()).toEqual({ type: "materialization_result", requestId: "r1", checkpoint: value });
  });

  it.each([
    [
      "a current materialization written at another draft",
      checkpoint({ draftSeq: 5, materialization: { state: "current", record: record(4) } }),
    ],
    [
      "a stale materialization that is not actually behind",
      checkpoint({ draftSeq: 4, materialization: { state: "stale", record: record(4), currentSeq: 4 } }),
    ],
    [
      "an artifact past the recorded answer's own byte limit",
      checkpoint({
        materialization: {
          state: "current",
          record: { ...record(0), artifactJson: "x".repeat(ARTIFACT_JSON_MAX_BYTES + 1) },
        },
      }),
    ],
    ["a turn number below the first turn", checkpoint({ turn: 0 })],
  ])("refuses %s", (_case, value) => {
    expect(refusal(carry(value)).message).toContain("payload is invalid");
  });
});

describe("the file map a command hands back", () => {
  const files = (value: Record<string, string>) => () =>
    roundTrip({ type: "files_result", requestId: "r1", files: value, checkpoint: checkpoint() });

  it("carries the paths a public artifact would accept", () => {
    const carried = files({ "answer/truss.json": "{}", "notes.txt": "x" })();
    expect(carried.type).toBe("files_result");
  });

  it.each([
    ["a path that climbs out of the draft", { "../escape.txt": "x" }],
    ["an absolute path", { "/etc/passwd": "x" }],
    ["one file past the transport's per-file ceiling", { "big.txt": "x".repeat(BUILT_FILE_MAX_CHARS + 1) }],
  ])("refuses %s", (_case, value) => {
    expect(refusal(files(value)).message).toContain("payload is invalid");
  });
});

describe("a parent frame the child can trust", () => {
  const execute: GeneratedToolParentMessage = {
    type: "execute",
    requestId: "r1",
    callId: "c1",
    name: "solve_truss",
    arguments: { span: 12 },
  };

  it("round-trips one tool call and ends its line", () => {
    const line = serializeGeneratedToolParentFrame(execute);
    expect(line.endsWith("\n")).toBe(true);
    expect(parseGeneratedToolParentFrame(line.trimEnd())).toEqual(execute);
  });

  it("round-trips the start frame that opens the worker", () => {
    const start: GeneratedToolParentMessage = {
      type: "start",
      protocol: GENERATED_TOOL_PROTOCOL,
      task: { taskId: "t1", family: "spans", publicInput: { span: 12 } },
      presets: [],
      domainToolAuthorities: [],
      publishedMargins: [],
      publicArtifactSchema: ARTIFACT_SCHEMA,
      workerInstanceId: "worker-1",
      bundleDigest: DIGEST,
      deniedReadPath: "/private/denied",
      deniedWritePath: "/private/denied",
      networkProbePort: 8080,
      protocolSecret: SECRET,
    };
    expect(parseGeneratedToolParentFrame(serializeGeneratedToolParentFrame(start).trimEnd())).toEqual(start);
  });

  it.each([
    [
      "the same fields in another order",
      JSON.stringify({ type: "materialization", requestId: "r1" }),
      "not canonical",
    ],
    [
      "a field the message does not carry, even beside a valid one",
      JSON.stringify({ note: "hello", requestId: "r1", type: "materialization" }),
      "invalid frame",
    ],
    ["bytes that are not JSON", "{", "malformed JSONL"],
    ["a message type the protocol does not name", JSON.stringify({ type: "shutdown" }), "invalid frame"],
    [
      "a start frame from another protocol version",
      JSON.stringify({ protocol: "generated-tool-worker/v2", type: "start" }),
      "invalid frame",
    ],
    [
      "an applied file map with an unsafe path",
      JSON.stringify({ files: { "../out.txt": "x" }, requestId: "r1", type: "apply_files" }),
      "invalid frame",
    ],
    [
      "a line past the ceiling, before parsing it",
      `"${"x".repeat(GENERATED_TOOL_FRAME_MAX_BYTES)}"`,
      "byte limit",
    ],
  ])("refuses %s", (_case, line, message) => {
    expect(() => parseGeneratedToolParentFrame(line)).toThrow(message);
  });

  it("refuses to write a frame past the ceiling rather than truncating it", () => {
    const huge: GeneratedToolParentMessage = {
      type: "apply_files",
      requestId: "r1",
      files: { "a.txt": "x".repeat(GENERATED_TOOL_FRAME_MAX_BYTES) },
    };
    expect(refusal(() => serializeGeneratedToolParentFrame(huge)).kind).toBe("protocol");
  });
});

describe("the tool interface the child publishes", () => {
  const base: AgentTool = {
    name: "solve_truss",
    label: "Solve truss",
    description: "Solve one truss",
    parameters: Type.Object({}),
    execute: () => Promise.resolve({ content: [], details: null }),
  };

  it("publishes the five fields the parent registers and nothing it holds besides", () => {
    const held: AgentTool & { secret: string } = {
      ...base,
      executionMode: "sequential",
      secret: "must not cross",
    };
    const published = generatedToolInterface(held);
    expect(Object.keys(published).sort()).toEqual([
      "description",
      "executionMode",
      "label",
      "name",
      "parameters",
    ]);
  });

  it("leaves out an execution mode the tool did not state", () => {
    expect("executionMode" in generatedToolInterface(base)).toBe(false);
  });
});

describe("how a transport failure reaches the evidence", () => {
  it("keeps an ordinary failure to its kind and message", () => {
    expect(new GeneratedToolWorkerNonResult("runtime", "child exited").nonResult()).toEqual({
      kind: "runtime",
      message: "child exited",
    });
  });

  it("names a controller timeout, so a wait is not read as a child fault", () => {
    expect(new GeneratedToolWorkerNonResult("protocol", "no ready frame", true).nonResult()).toEqual({
      kind: "protocol",
      message: "no ready frame",
      deadline: true,
    });
  });
});

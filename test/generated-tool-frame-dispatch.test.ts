// What one confined worker does with the next line on its stdin, decided before it acts.
//
// The worker's own module cannot be imported: its top level freezes Number, locks the JSON
// globals and opens stdin, which is right for a confined child and fatal for a test process.
// That is why the decision lives here, as a function over a line and the phase the session has
// reached, and why it can be held to its rules without starting anything.
//
// The rule these cases exist for is the one that separates a protocol violation from a host
// non-result: a worker that names the wrong cause sends the controller after the wrong owner.

import { describe, expect, it } from "bun:test";
import { type SessionPhase, decideParentFrame } from "../src/solve/generated-tool-frame-dispatch.ts";
import {
  GENERATED_TOOL_PROTOCOL,
  type GeneratedToolParentMessage,
  type GeneratedToolStart,
  serializeGeneratedToolParentFrame,
} from "../src/solve/generated-tool-worker-protocol.ts";

const DIGEST = "0".repeat(64);

const START: GeneratedToolStart = {
  type: "start",
  protocol: GENERATED_TOOL_PROTOCOL,
  task: { taskId: "span-a", family: "spans", publicInput: { span: 12 } },
  presets: ["files"],
  domainToolAuthorities: [{ name: "read_task", authority: "reader" }],
  publishedMargins: [],
  publicArtifactSchema: {
    schema: "public-artifact-schema/v4",
    root: { kind: "object", properties: {}, required: [], additionalProperties: false },
    sha256: DIGEST,
  },
  workerInstanceId: "worker-1",
  bundleDigest: DIGEST,
  deniedReadPath: "/private/tmp/denied-read",
  deniedWritePath: "/private/tmp/denied-write",
  networkProbePort: 51_234,
  protocolSecret: "a".repeat(64),
};

/** One line as it arrives on stdin: the parent's frame without its terminator. */
function line(message: GeneratedToolParentMessage): string {
  return serializeGeneratedToolParentFrame(message).trimEnd();
}

function refusalOf(text: string, phase: SessionPhase) {
  const decision = decideParentFrame(text, phase);
  if (decision.act !== "refuse") throw new Error(`expected a refusal, got ${decision.act}`);
  return decision;
}

describe("the line a session is ready for", () => {
  it("starts on a start frame, and hands back the message it will start from", () => {
    const decision = decideParentFrame(line(START), "new");
    expect(decision.act).toBe("start");
    if (decision.act !== "start") return;
    expect(decision.message.workerInstanceId).toBe("worker-1");
    expect(decision.message.protocolSecret).toBe("a".repeat(64));
  });

  it("handles a request once the toolset exists", () => {
    const execute: GeneratedToolParentMessage = {
      type: "execute",
      requestId: "r1",
      callId: "c1",
      name: "read_task",
      arguments: {},
    };
    const decision = decideParentFrame(line(execute), "ready");
    expect(decision.act).toBe("handle");
    if (decision.act !== "handle") return;
    expect(decision.message.type).toBe("execute");
  });

  it("handles a close the same way, so shutdown is not a special case", () => {
    expect(decideParentFrame(line({ type: "close" }), "ready").act).toBe("handle");
  });
});

describe("a request the session is not ready for", () => {
  it("refuses a request before any start frame, and says that is what happened", () => {
    const refusal = refusalOf(line({ type: "materialization", requestId: "r1" }), "new");
    expect(refusal.error).toContain("before start");
    expect(refusal.error).not.toContain("malformed");
  });

  it("refuses a request that arrives while the walls are still going up", () => {
    // Between the start frame and the ready frame the worker is installing its execution
    // wall, running the boundary probes and loading candidate code. A request here is the
    // parent's protocol error, not a malformed line and not a runtime fault.
    const refusal = refusalOf(line({ type: "files", requestId: "r1" }), "starting");
    expect(refusal.error).toContain("before start");
    expect(refusal.kind).toBe("protocol");
  });

  it.each<SessionPhase>(["starting", "ready"])("refuses a second start once the session is %s", (phase) => {
    expect(refusalOf(line(START), phase).error).toContain("initialized twice");
  });
});

describe("a line the protocol cannot read", () => {
  it.each([
    ["bytes that are not JSON as malformed", "{", "malformed JSONL"],
    // The canonical spelling orders keys, so this is the right fields in the wrong order.
    ["a non-canonical spelling as that", `{"type":"materialization","requestId":"r1"}`, "not canonical"],
    ["a message type the protocol does not have as an invalid frame", `{"type":"shutdown"}`, "invalid frame"],
    ["a line past the frame ceiling without parsing it", `"${"x".repeat(4 * 1024 * 1024)}"`, "byte limit"],
  ])("names %s", (_case, text, message) => {
    const refusal = refusalOf(text, "ready");
    expect(refusal.error).toContain(message);
    if (message !== "malformed JSONL") expect(refusal.error).not.toContain("malformed");
  });

  it.each([
    // The version is a literal in the frame schema, so a mismatch fails to match the start arm
    // at all: both ends read it from one constant, and a frame that disagrees is another build.
    ["protocol version is not this one", [GENERATED_TOOL_PROTOCOL, "generated-tool-worker/v2"]],
    ["secret is not a digest", [`"${"a".repeat(64)}"`, `"hunter2"`]],
  ] as const)("refuses a start frame whose %s", (_case, [from, to]) => {
    expect(refusalOf(line(START).replace(from, to), "new").error).toContain("invalid frame");
  });
});

describe("what every refusal has in common", () => {
  const bad: [string, SessionPhase][] = [
    ["{", "ready"],
    [`{"type":"shutdown"}`, "ready"],
    [line({ type: "close" }), "new"],
    [line(START), "ready"],
  ];

  it("calls each one a protocol fault, since each is a rule of the pipe", () => {
    for (const [text, phase] of bad) expect(refusalOf(text, phase).kind).toBe("protocol");
  });

  it("never throws, because a throw at the line reader has nowhere to be reported", () => {
    for (const [text, phase] of bad) expect(() => decideParentFrame(text, phase)).not.toThrow();
  });
});

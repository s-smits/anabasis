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

  it("refuses a second start while the first is still starting", () => {
    expect(refusalOf(line(START), "starting").error).toContain("initialized twice");
  });

  it("refuses a second start after the toolset exists", () => {
    expect(refusalOf(line(START), "ready").error).toContain("initialized twice");
  });
});

describe("a line the protocol cannot read", () => {
  it("names bytes that are not JSON as malformed", () => {
    expect(refusalOf("{", "ready").error).toContain("malformed JSONL");
  });

  it("names a non-canonical spelling as that, not as malformed", () => {
    const canonical = line({ type: "materialization", requestId: "r1" });
    const reordered = `{"type":"materialization","requestId":"r1"}`;
    expect(canonical).not.toBe(reordered);
    const refusal = refusalOf(reordered, "ready");
    expect(refusal.error).toContain("not canonical");
    expect(refusal.error).not.toContain("malformed");
  });

  it("names a message type the protocol does not have as an invalid frame", () => {
    const refusal = refusalOf(`{"type":"shutdown"}`, "ready");
    expect(refusal.error).toContain("invalid frame");
    expect(refusal.error).not.toContain("malformed");
  });

  it("refuses a start frame whose protocol version is not this one", () => {
    // The version is a literal in the frame schema, so a mismatch fails to match the start
    // arm at all. The worker needs no second check of its own: both ends read the version
    // from one constant, and a frame that disagrees came from a different build.
    const stale = line(START).replace(GENERATED_TOOL_PROTOCOL, "generated-tool-worker/v2");
    expect(refusalOf(stale, "new").error).toContain("invalid frame");
  });

  it("refuses a start frame whose secret is not a digest", () => {
    const weak = line(START).replace(`"${"a".repeat(64)}"`, `"hunter2"`);
    expect(refusalOf(weak, "new").error).toContain("invalid frame");
  });

  it("refuses a line past the frame ceiling without parsing it", () => {
    const oversized = `"${"x".repeat(4 * 1024 * 1024)}"`;
    expect(refusalOf(oversized, "ready").error).toContain("byte limit");
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

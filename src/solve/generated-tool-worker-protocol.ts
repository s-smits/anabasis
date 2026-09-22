import type { JsonValue } from "../meta/json-shape.ts";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { capturedJsonParse as nativeParse } from "../meta/json-runtime.ts";
import { canonicalJsonCopy as trustedJson } from "../meta/stable-json.ts";
import { BUILT_PRESET_IDS, type BuiltPresetId } from "../truth/built-presets.ts";
import type { PublicTask } from "../truth/task-split.ts";
import type {
  BuiltStarterCheckpoint,
  BuiltStarterNonResult,
  BuiltStarterRegistration,
  DomainToolAuthority,
  GeneratedToolBoundaryProbe,
} from "./built-starter.ts";
import { TOOL_TEXT_LIMITS } from "./define-tool.ts";
import { ARTIFACT_JSON_MAX_BYTES, type ArtifactMaterialization } from "./draft-store.ts";
import { FILE_MAP_MAX_ENTRIES, pathProblem } from "./file-map.ts";
import type { PublishedMargin } from "./published-margin.ts";
import type { PublicArtifactSchema } from "./public-artifact-schema.ts";
import type { GeneratedTaskAccess } from "./task-access-trace.ts";
import { keyIfDefined, keyIfTruthy } from "../meta/optional-key.ts";
import type { ExecWallMechanism } from "./generated-tool-exec-wall.ts";

export const GENERATED_TOOL_PROTOCOL = "generated-tool-worker/v3" as const;
const GENERATED_TOOL_FRAME = "generated-tool-worker-frame/v2" as const;
/** A checkpoint carries the prepared answer as a JSON string; escaping can double its bytes. */
export const GENERATED_TOOL_FRAME_MAX_BYTES = 2 * ARTIFACT_JSON_MAX_BYTES + 512 * 1024;
type InterfaceField = "name" | "label" | "description" | "parameters" | "executionMode";
type GeneratedToolInterface = Pick<AgentTool, InterfaceField>;

export interface GeneratedToolStart {
  type: "start";
  protocol: typeof GENERATED_TOOL_PROTOCOL;
  task: PublicTask<unknown>;
  presets: BuiltPresetId[];
  domainToolAuthorities: DomainToolAuthority[];
  /** The complete published comparisons the prepared answer is measured against in the child. */
  publishedMargins: PublishedMargin[];
  publicArtifactSchema: PublicArtifactSchema;
  workerInstanceId: string;
  bundleDigest: string;
  deniedReadPath: string;
  deniedWritePath: string;
  /** Controller-owned loopback listener. A confined worker must be unable to reach it. */
  networkProbePort: number;
  traceTaskAccess?: boolean;
  protocolSecret: string;
}

export type GeneratedToolParentMessage =
  | GeneratedToolStart
  | {
      type: "execute";
      requestId: string;
      callId: string;
      name: string;
      arguments: Record<string, JsonValue>;
    }
  | { type: "materialization"; requestId: string }
  // The shell's file exchange. The parent initiates it, so it never needs to answer a child
  // request while awaiting the tool call that runs the command.
  | { type: "files"; requestId: string }
  | { type: "apply_files"; requestId: string; files: Record<string, string> }
  | { type: "close" };

export type GeneratedToolChildMessage =
  | {
      type: "ready";
      pid: number;
      workerInstanceId: string;
      bundleDigest: string;
      tools: GeneratedToolInterface[];
      registration: BuiltStarterRegistration;
      checkpoint: BuiltStarterCheckpoint;
      probe: GeneratedToolBoundaryProbe;
      /** Process-execution restriction: Landlock on Linux, Seatbelt plus a runtime namespace
       *  lock on macOS. Without it the worker ends before sending this frame. */
      execWall: ExecWallMechanism;
      taskAccess?: GeneratedTaskAccess;
    }
  | {
      type: "tool_result";
      requestId: string;
      result: AgentToolResult<unknown>;
      checkpoint: BuiltStarterCheckpoint;
      taskAccess?: GeneratedTaskAccess;
    }
  | {
      type: "materialization_result";
      requestId: string;
      checkpoint: BuiltStarterCheckpoint;
    }
  | {
      type: "files_result";
      requestId: string;
      files: Record<string, string>;
      checkpoint: BuiltStarterCheckpoint;
    }
  | { type: "apply_files_result"; requestId: string; checkpoint: BuiltStarterCheckpoint }
  | {
      type: "request_error";
      requestId: string;
      error: string;
      checkpoint: BuiltStarterCheckpoint;
      taskAccess?: GeneratedTaskAccess;
    }
  | {
      /** Sent after isolation is installed and probed, before candidate code loads. A stall
       *  before it belongs to the environment; a stall after it is the candidate's. */
      type: "wall_ready";
      workerInstanceId: string;
    }
  | { type: "non_result"; kind: "runtime" | "protocol" | "sandbox"; error: string };

/** One file's ceiling on this transport; the whole map is also bounded by the answer's byte limit. */
export const BUILT_FILE_MAX_CHARS = 256 * 1024;
const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const valueCheck = Value.Check.bind(Value);

export function generatedToolInterface(tool: AgentTool): GeneratedToolInterface {
  const { name, label, description, parameters, executionMode } = tool;
  return { name, label, description, parameters, ...keyIfDefined("executionMode", executionMode) };
}

const strict = <T extends Parameters<typeof Type.Object>[0]>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
const text = (maxLength = 8_000, minLength = 0) => Type.String({ minLength, maxLength });
const digest = Type.String({ pattern: "^[0-9a-f]{64}$" });
const integer = (minimum = 0) => Type.Integer({ minimum, maximum: Number.MAX_SAFE_INTEGER });
const names = Type.Array(text(TOOL_TEXT_LIMITS.name, 1), { maxItems: 128 });
const materializationRecord = strict({
  artifactJson: text(ARTIFACT_JSON_MAX_BYTES),
  artifactDigest: digest,
  sourceSeq: integer(),
  writerName: text(TOOL_TEXT_LIMITS.name, 1),
  callId: text(256, 1),
});
const materializationSchema = Type.Union([
  strict({ state: Type.Literal("absent") }),
  strict({ state: Type.Literal("current"), record: materializationRecord }),
  strict({ state: Type.Literal("stale"), record: materializationRecord, currentSeq: integer() }),
]);
const checkpointSchema = strict({
  schema: Type.Literal("built-starter-checkpoint/v2"),
  turn: integer(1),
  draftSeq: integer(),
  draftDigest: digest,
  fileMapDigest: digest,
  artifactWriterNames: names,
  materialization: materializationSchema,
});
const registrationSchema = strict({
  schema: Type.Literal("built-starter-registration/v2"),
  tools: Type.Array(
    strict({
      name: text(TOOL_TEXT_LIMITS.name, 1),
      owner: Type.Union(["domain", "controller", "preset", "starter"].map((value) => Type.Literal(value))),
      authority: Type.Union(
        ["reader", "writer", "artifact-writer", "advisor", "submission"].map((value) => Type.Literal(value)),
      ),
    }),
    { maxItems: 128 },
  ),
  artifactWriterNames: names,
});
const toolInterface = Type.Array(
  strict({
    name: text(TOOL_TEXT_LIMITS.name),
    label: text(TOOL_TEXT_LIMITS.label),
    description: text(TOOL_TEXT_LIMITS.description),
    parameters: Type.Unknown(),
    executionMode: Type.Optional(Type.Union([Type.Literal("parallel"), Type.Literal("sequential")])),
  }),
  { maxItems: 128 },
);
// A proved outcome names its refusal code; a violated or non-result outcome names its detail.
const probeOutcome = Type.Union([
  strict({ status: Type.Literal("proved"), code: Type.String({ minLength: 1 }) }),
  strict({ status: Type.Literal("violated"), detail: Type.String({ minLength: 1 }) }),
  strict({ status: Type.Literal("non-result"), detail: Type.String({ minLength: 1 }) }),
]);
const probe = strict({
  outsideReadRefused: probeOutcome,
  outsideWriteRefused: probeOutcome,
  credentialEnvironmentAbsent: probeOutcome,
  networkRefused: probeOutcome,
  subprocessRefused: probeOutcome,
  runtimeReExecRefused: probeOutcome,
});
const taskAccess = strict({
  events: Type.Array(text(8_000, 1), { maxItems: 4_096 }),
  opaqueCopies: integer(),
  truncated: Type.Boolean(),
});
const result = strict({
  content: Type.Array(strict({ type: Type.Literal("text"), text: text(TOOL_TEXT_LIMITS.evidence) }), {
    maxItems: 32,
  }),
  details: Type.Unknown(),
});
const fileMap = Type.Record(Type.String(), text(BUILT_FILE_MAX_CHARS));

/** Shape, count and path safety. `pathProblem` is the artifact's own key rule, so a command cannot
 *  return a path the artifact would refuse. */
function validFileMap(value: JsonValue): value is Record<string, string> {
  if (!valueCheck(fileMap, value)) return false;
  const keys = Object.keys(value);
  return keys.length <= FILE_MAP_MAX_ENTRIES && keys.every((key) => pathProblem(key) === null);
}
const childMessage = Type.Union([
  strict({
    type: Type.Literal("non_result"),
    kind: Type.Union([Type.Literal("runtime"), Type.Literal("protocol"), Type.Literal("sandbox")]),
    error: text(),
  }),
  strict({
    type: Type.Literal("request_error"),
    requestId: text(128),
    error: text(),
    checkpoint: Type.Unknown(),
    taskAccess: Type.Optional(taskAccess),
  }),
  strict({
    type: Type.Literal("wall_ready"),
    workerInstanceId: text(128),
  }),
  strict({
    type: Type.Literal("ready"),
    pid: integer(1),
    workerInstanceId: text(128),
    bundleDigest: digest,
    tools: toolInterface,
    registration: Type.Unknown(),
    checkpoint: Type.Unknown(),
    probe,
    execWall: Type.Union([Type.Literal("landlock"), Type.Literal("seatbelt-and-runtime-lock")]),
    taskAccess: Type.Optional(taskAccess),
  }),
  strict({
    type: Type.Literal("tool_result"),
    requestId: text(128),
    result,
    checkpoint: Type.Unknown(),
    taskAccess: Type.Optional(taskAccess),
  }),
  strict({
    type: Type.Literal("materialization_result"),
    requestId: text(128),
    checkpoint: Type.Unknown(),
  }),
  strict({
    type: Type.Literal("files_result"),
    requestId: text(128),
    files: fileMap,
    checkpoint: Type.Unknown(),
  }),
  strict({
    type: Type.Literal("apply_files_result"),
    requestId: text(128),
    checkpoint: Type.Unknown(),
  }),
]);
const parentMessage = Type.Union([
  strict({
    type: Type.Literal("start"),
    protocol: Type.Literal(GENERATED_TOOL_PROTOCOL),
    task: Type.Unknown(),
    presets: Type.Array(Type.Union(BUILT_PRESET_IDS.map((value) => Type.Literal(value))), {
      maxItems: BUILT_PRESET_IDS.length,
    }),
    domainToolAuthorities: Type.Array(
      strict({
        name: text(128, 1),
        authority: Type.Union(
          ["reader", "writer", "artifact-writer", "advisor"].map((value) => Type.Literal(value)),
        ),
      }),
      { maxItems: 128 },
    ),
    publishedMargins: Type.Array(
      strict({
        label: text(256, 1),
        artifactPath: text(512, 1),
        publicInputPath: text(512, 1),
        direction: Type.Union([Type.Literal("atMost"), Type.Literal("atLeast")]),
        families: Type.Union([Type.Array(text(256, 1), { maxItems: 256 }), Type.Null()]),
      }),
      { maxItems: 256 },
    ),
    publicArtifactSchema: Type.Unknown(),
    workerInstanceId: text(128, 1),
    bundleDigest: digest,
    deniedReadPath: text(8_000, 1),
    deniedWritePath: text(8_000, 1),
    networkProbePort: Type.Integer({ minimum: 1, maximum: 65_535 }),
    traceTaskAccess: Type.Optional(Type.Boolean()),
    protocolSecret: digest,
  }),
  strict({
    type: Type.Literal("execute"),
    requestId: text(128, 1),
    callId: text(256, 1),
    name: text(128, 1),
    arguments: Type.Record(Type.String(), Type.Unknown()),
  }),
  strict({ type: Type.Literal("materialization"), requestId: text(128, 1) }),
  strict({ type: Type.Literal("files"), requestId: text(128, 1) }),
  strict({ type: Type.Literal("apply_files"), requestId: text(128, 1), files: fileMap }),
  strict({ type: Type.Literal("close") }),
]);

function sortedNames(value: string[]): boolean {
  return value.every((name, index) => index === 0 || String(value[index - 1]) < name);
}

function validMaterialization(value: JsonValue | ArtifactMaterialization): value is ArtifactMaterialization {
  if (!valueCheck(materializationSchema, value)) return false;
  // SAFETY: the line above returned unless `value` matched materializationSchema.
  const admitted = value;
  return (
    (admitted.state === "absent" || utf8Bytes(admitted.record.artifactJson) <= ARTIFACT_JSON_MAX_BYTES) &&
    (admitted.state !== "stale" || admitted.currentSeq > admitted.record.sourceSeq)
  );
}

function validCheckpoint(value: BuiltStarterCheckpoint): value is BuiltStarterCheckpoint {
  if (!valueCheck(checkpointSchema, value)) return false;
  // SAFETY: the line above returned unless `value` matched checkpointSchema.
  const admitted = value;
  if (!sortedNames(admitted.artifactWriterNames) || !validMaterialization(admitted.materialization)) {
    return false;
  }
  const { materialization } = admitted;
  return (
    materialization.state === "absent" ||
    (materialization.state === "current"
      ? materialization.record.sourceSeq === admitted.draftSeq
      : materialization.record.sourceSeq < admitted.draftSeq &&
        materialization.currentSeq === admitted.draftSeq)
  );
}

function validRegistration(value: BuiltStarterRegistration): value is BuiltStarterRegistration {
  if (!valueCheck(registrationSchema, value)) return false;
  // SAFETY: the line above returned unless `value` matched registrationSchema.
  const admitted = value as BuiltStarterRegistration;
  if (!sortedNames(admitted.artifactWriterNames)) return false;
  const seen = new Set<string>();
  for (const row of admitted.tools) {
    if (seen.has(row.name)) return false;
    seen.add(row.name);
  }
  const actual = admitted.tools
    .filter(({ authority }) => authority === "artifact-writer")
    .map(({ name }) => name)
    .sort();
  const expected = admitted.artifactWriterNames;
  return actual.length === expected.length && actual.every((name, index) => name === expected[index]);
}

function validChildMessage(value: JsonValue): value is JsonValue & GeneratedToolChildMessage {
  if (!valueCheck(childMessage, value)) return false;
  // SAFETY: the line above returned unless `value` matched the childMessage schema.
  const message = value as GeneratedToolChildMessage;
  // Every checkpoint gets the same rules; two arms add a rule their schema cannot state.
  if ("checkpoint" in message && !validCheckpoint(message.checkpoint)) return false;
  if (message.type === "ready") return validRegistration(message.registration);
  if (message.type === "files_result") return validFileMap(message.files);
  return true;
}

function validParentMessage(value: JsonValue): value is JsonValue & GeneratedToolParentMessage {
  if (!valueCheck(parentMessage, value)) return false;
  // SAFETY: the line above returned unless `value` matched the parentMessage schema.
  const message = value as GeneratedToolParentMessage;
  return message.type !== "apply_files" || validFileMap(message.files);
}

export class GeneratedToolWorkerNonResult extends Error {
  constructor(
    readonly kind: BuiltStarterNonResult["kind"],
    message: string,
    /** Set when the controller's wait timed out instead of the child reporting a fault. */
    readonly deadline = false,
  ) {
    super(message);
    this.name = "GeneratedToolWorkerNonResult";
  }

  /** The evidence shape of this failure; `deadline` appears only after a controller timeout. */
  nonResult(): BuiltStarterNonResult {
    return { kind: this.kind, message: this.message, ...keyIfTruthy("deadline", this.deadline) };
  }
}

/* ── the transport ───────────────────────────────────────────────────────────
 * A frame is one JSONL line in canonical spelling, so a signature over the bytes and a
 * check over the fields describe the same frame. Child frames are signed with the start
 * secret and an increasing counter; parent frames are not, since the child trusts its stdin. */

/** Every inbound line must fit the frame ceiling, parse as JSON and be the canonical spelling of
 *  what it parsed to. A value outside JSON, such as `1e400`, makes canonicalisation throw, which
 *  counts as non-canonical. */
function readCanonicalLine(line: string, subject: string, fault: (message: string) => Error): JsonValue {
  if (utf8Bytes(line) > GENERATED_TOOL_FRAME_MAX_BYTES) {
    throw fault(`generated-tool worker ${subject} exceeded byte limit`);
  }
  let parsed: JsonValue;
  try {
    parsed = nativeParse(line);
  } catch {
    throw fault(`generated-tool worker ${subject} is malformed JSONL`);
  }
  let canonical: string | null;
  try {
    canonical = trustedJson(parsed).bytes;
  } catch {
    canonical = null;
  }
  if (canonical !== line) throw fault(`generated-tool worker ${subject} is not canonical`);
  return parsed;
}

function frameBody(counter: number, payload: JsonValue | GeneratedToolChildMessage) {
  return trustedJson({ schema: GENERATED_TOOL_FRAME, counter, payload }).bytes;
}

function hmac(secret: string, body: string): string {
  return new Bun.CryptoHasher("sha256", secret).update(body).digest("hex");
}

/** Null for a payload that is not plain finite JSON or exceeds the frame ceiling; the caller
 *  decides whether that fails one call or the session. */
export function trySignGeneratedToolFrame(
  secret: string,
  counter: number,
  payload: GeneratedToolChildMessage,
): string | null {
  if (!/^[0-9a-f]{64}$/.test(secret) || !Number.isSafeInteger(counter) || counter < 1) {
    throw new Error("generated-tool worker frame signer received an invalid identity");
  }
  try {
    // SAFETY: canonicalJsonCopy returns the same value re-read from its canonical bytes, so the
    // copy carries the type its argument was declared with.
    const safePayload = trustedJson(payload).value as GeneratedToolChildMessage;
    const frame = trustedJson({
      schema: GENERATED_TOOL_FRAME,
      counter,
      payload: safePayload,
      attestation: hmac(secret, frameBody(counter, safePayload)),
    }).bytes;
    return utf8Bytes(frame) > GENERATED_TOOL_FRAME_MAX_BYTES ? null : frame;
  } catch {
    return null;
  }
}

/** Signs the payload, falling back to a constant protocol non-result when it would not serialise. */
export function signGeneratedToolFrame(
  secret: string,
  counter: number,
  payload: GeneratedToolChildMessage,
): string {
  const frame =
    trySignGeneratedToolFrame(secret, counter, payload) ??
    trySignGeneratedToolFrame(secret, counter, {
      type: "non_result",
      kind: "protocol",
      error: "generated-tool worker could not serialise a trusted frame",
    });
  if (frame === null) throw new Error("generated-tool worker cannot serialise any frame");
  return frame;
}

export function serializeGeneratedToolParentFrame(message: GeneratedToolParentMessage): string {
  const frame = trustedJson(message).bytes;
  if (utf8Bytes(frame) > GENERATED_TOOL_FRAME_MAX_BYTES) {
    throw new GeneratedToolWorkerNonResult(
      "protocol",
      "generated-tool worker parent frame exceeded byte limit",
    );
  }
  return `${frame}\n`;
}

export function parseGeneratedToolParentFrame(line: string): GeneratedToolParentMessage {
  const parsed = readCanonicalLine(line, "parent frame", (message) => new Error(message));
  if (!validParentMessage(parsed)) throw new Error("generated-tool worker received an invalid frame");
  return parsed;
}

const signedFrame = strict({
  schema: Type.Literal(GENERATED_TOOL_FRAME),
  counter: integer(1),
  payload: Type.Unknown(),
  attestation: digest,
});

export function verifyGeneratedToolFrame(
  line: string,
  secret: string,
  expectedCounter: number,
): GeneratedToolChildMessage {
  const parsed = readCanonicalLine(
    line,
    "frame",
    (message) => new GeneratedToolWorkerNonResult("protocol", message),
  );
  if (!valueCheck(signedFrame, parsed)) {
    throw new GeneratedToolWorkerNonResult("protocol", "generated-tool worker frame identity is invalid");
  }
  // SAFETY: the line above returned unless `parsed` matched signedFrame.
  const frame = parsed as { counter: number; payload: JsonValue; attestation: string };
  if (frame.counter !== expectedCounter) {
    throw new GeneratedToolWorkerNonResult("protocol", "generated-tool worker frame identity is invalid");
  }
  const left = Uint8Array.fromHex(frame.attestation);
  const right = Uint8Array.fromHex(hmac(secret, frameBody(expectedCounter, frame.payload)));
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    throw new GeneratedToolWorkerNonResult("protocol", "generated-tool worker frame attestation is invalid");
  }
  if (!validChildMessage(frame.payload)) {
    throw new GeneratedToolWorkerNonResult("protocol", "generated-tool worker payload is invalid");
  }
  return frame.payload;
}

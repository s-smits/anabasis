/** Trusted entry for one generated Built toolset. Generated source is bundled into this process. */

import { readFileSync, writeFileSync } from "../meta/filesystem.ts";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { attachJsonlLineReader } from "../../vendor/pi-built/jsonl.ts";
import { lockJsonGlobals } from "../meta/json-runtime.ts";
import {
  type BuiltStarter,
  type DomainHarnessFactory,
  type GeneratedToolBoundaryProbe,
  type GeneratedToolProbeOutcome,
  PROBE_KEYS,
  createBuiltStarter,
} from "./built-starter.ts";
import { createDraftFileTools } from "./draft-files.ts";
import type { DraftStore } from "./draft-store.ts";
import { fileMapIssues } from "./file-map.ts";
import {
  GENERATED_TOOL_FRAME_MAX_BYTES,
  type GeneratedToolChildMessage,
  type GeneratedToolParentMessage,
  type GeneratedToolStart,
  generatedToolInterface,
  signGeneratedToolFrame,
  trySignGeneratedToolFrame,
} from "./generated-tool-worker-protocol.ts";
import { type SessionPhase, decideParentFrame } from "./generated-tool-frame-dispatch.ts";
import { type GeneratedTaskAccess, tracePublicTask } from "./task-access-trace.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { isObject, isRecord, isString } from "../meta/json-shape.ts";
import { runtimeProcess } from "../meta/process.ts";
import { denyProcessExecution, type ExecWall } from "./generated-tool-exec-wall.ts";
import { errorMessage } from "../meta/runtime-values.ts";

const nativeWrite = runtimeProcess.stdout.write.bind(runtimeProcess.stdout);
const nativeStdin = Bun.stdin.stream();
const nativeExit = runtimeProcess.exit.bind(runtimeProcess);
const nativePid = runtimeProcess.pid;
const nativeEnvironment = Bun.env;
const nativeReadFile = readFileSync;
const nativeWriteFile = writeFileSync;
const CREDENTIAL_ENVIRONMENT =
  /(?:api[_-]?key|token|auth|credential|secret|password|codex|claude|anthropic|openrouter|aws|ssh)/i;

/** Values installed by hideAmbientProcess: a silent console, a minimal process object and
 *  absent module hooks. Listing the console methods in the type keeps it aligned with the
 *  installed object; changing only one side produces a type error. */
type HiddenGlobalValue =
  | Readonly<Record<"log" | "info" | "warn" | "error" | "debug" | "dir" | "trace", () => undefined>>
  | Readonly<{
      env: Readonly<Record<string, string | undefined>>;
      pid: number;
      nextTick: typeof nativeNextTick;
    }>
  | undefined;

/** The kernel/OS error names that mean a sandbox refused the operation. Anything else — a missing
 *  path, a socket nobody listens on, an unrelated runtime failure — proves nothing about isolation
 *  and must arrive as a typed non-result rather than as refusal evidence. */
const REFUSAL_CODES = new Set(["EPERM", "EACCES", "EROFS"]);

/** The message `lockRuntimeLaunchMembers` installs. It is this worker's own refusal rather than the
 *  kernel's, so it is recognised only for the one route the kernel is required to leave open. */
const LOCKED_LAUNCH_MEMBER = /process execution is denied inside the generated-tool worker/;

const nativeNextTick = (callback: (...args: unknown[]) => void, ...args: unknown[]): void =>
  queueMicrotask(() => callback(...args));
const nativeSpawnSync = Bun.spawnSync;
const nativeExecutable = Bun.argv[0] ?? "";
const nativeConnect = Bun.connect;
const nativeSleep = Bun.sleep;
const nativeObjectKeys = Object.keys.bind(Object);
lockJsonGlobals();
for (const value of [Number, Set, Set.prototype, WeakMap, WeakMap.prototype]) Object.freeze(value);
for (const name of ["Number", "Set", "WeakMap"] as const) {
  Object.defineProperty(globalThis, name, { value: globalThis[name], writable: false, configurable: false });
}
let starter: BuiltStarter | null = null;
/** The one DraftStore behind the files preset, captured where the preset factory is handed it.
 *  The shell runs controller-side and exchanges the whole file map over the protocol, so the
 *  child needs a named handle to the same store the file tools write through. It stays null
 *  whenever the files preset is not selected, which is what refuses the exchange. */
let draftFiles: DraftStore | null = null;
let tools = new Map<string, AgentTool>();
let protocolSecret: string | null = null;
/** What the session has finished, and so what the next inbound line may ask for. */
let phase: SessionPhase = "new";
let frameCounter = 0;
let taskAccessSnapshot = (): GeneratedTaskAccess | undefined => undefined;
let materializeTaskData: ReturnType<typeof tracePublicTask>["materialize"] | null = null;

/** Null when the payload cannot be framed; the counter only advances on a frame that was written,
 *  because the parent verifies that the frames it receives are consecutive. */
function writeFrame(secret: string, message: GeneratedToolChildMessage): string | null {
  const counter = frameCounter + 1;
  let frame: string | null;
  try {
    // SAFETY: materialize removes our trace wrappers from JSON data without changing its fields.
    const payload =
      materializeTaskData === null ? message : (materializeTaskData(message) as GeneratedToolChildMessage);
    frame = trySignGeneratedToolFrame(secret, counter, payload);
  } catch (cause) {
    return errorText(cause);
  }
  if (frame === null) return "the result is not plain finite JSON, or it exceeded the frame limit";
  frameCounter = counter;
  nativeWrite(`${frame}\n`);
  return null;
}

/**
 * A tool's own result the protocol cannot carry is that call's failure, not the session's: the
 * solver is told and can ask for a smaller or finite value. Truss 2026-09-17 lost whole paid cases
 * to a utilisation of 1/0 in one tool's details, which arrived as a protocol non-result.
 * Everything else the worker sends is its own frame, and an unsendable one ends the session.
 */
function send(message: GeneratedToolChildMessage): void {
  if (protocolSecret === null) return;
  const refusal = writeFrame(protocolSecret, message);
  if (refusal === null) return;
  if (message.type === "tool_result") {
    send({
      type: "request_error",
      requestId: message.requestId,
      error: `the tool's result could not be returned: ${refusal}`,
      checkpoint: message.checkpoint,
      ...keyIfDefined("taskAccess", message.taskAccess),
    });
    return;
  }
  nativeWrite(
    `${signGeneratedToolFrame(protocolSecret, frameCounter + 1, {
      type: "non_result",
      kind: "protocol",
      error: "generated-tool worker could not serialise a trusted frame",
    })}\n`,
  );
  nativeExit(0);
}

/** The frame every failed path out of this worker sends. The kinds are the protocol's; a
 *  fourth one fails at `send` rather than reaching the parent as an unknown word. */
function nonResult(kind: "runtime" | "protocol" | "sandbox", error: string): void {
  send({ type: "non_result", kind, error });
}

function errorText(cause: unknown): string {
  return errorMessage(cause).slice(0, 800);
}

function refusalCode(error: unknown): string | null {
  // SAFETY: runtime error objects carry an optional string `code`; anything else falls through
  // to the message-shape checks below.
  const code = (error as { code?: unknown } | null)?.code;
  if (isString(code) && REFUSAL_CODES.has(code)) return code;
  const text = errorMessage(error);
  // Bun's TCP socket wrapper does not surface the kernel errno: the launch-time sandbox's
  // connect denial arrives as a bare "Failed to connect". With the controller canary listening
  // on that exact port, a bare connect failure is the denial shape, not a missing listener.
  if (/failed to connect/i.test(text)) return "EACCES";
  if (/operation not permitted/i.test(text)) return "EPERM";
  if (/permission denied/i.test(text)) return "EACCES";
  if (/read-only file system/i.test(text)) return "EROFS";
  return null;
}

function probeOutcome(operation: () => void): GeneratedToolProbeOutcome {
  try {
    operation();
    return { status: "violated", detail: "the operation succeeded inside the boundary" };
  } catch (error) {
    const code = refusalCode(error);
    if (code !== null) return { status: "proved", code };
    return {
      status: "non-result",
      detail: `unclassified failure: ${errorText(error)}`,
    };
  }
}

/** What an absent probed path proves. Seatbelt leaves the path visible and refuses the open, so
 *  ENOENT there says nothing about the wall. Bubblewrap's deny-default namespace never mounts the
 *  path at all, so ENOENT is its refusal shape, the same reading `observedRefusal` in
 *  `solve-sandbox.ts` applies to the session probe. */
function missingPathOutcome(operation: GeneratedToolProbeOutcome): GeneratedToolProbeOutcome {
  if (operation.status !== "non-result" || !operation.detail.includes("ENOENT")) return operation;
  if (runtimeProcess.platform === "linux") return { status: "proved", code: "ENOENT" };
  return { status: "non-result", detail: "ENOENT: the probed path does not exist, so refusal is unproven" };
}

async function networkProbe(port: number): Promise<GeneratedToolProbeOutcome> {
  try {
    const connecting = nativeConnect({ hostname: "127.0.0.1", port, socket: { data() {} } });
    const socket = await Promise.race([connecting, nativeSleep(500).then(() => null)]);
    if (socket === null) {
      void connecting.then(
        (late) => late.terminate(),
        () => undefined,
      );
      return { status: "non-result", detail: "connect neither completed nor failed within 500ms" };
    }
    socket.end();
    return { status: "violated", detail: "connected to the controller network canary" };
  } catch (error) {
    const code = refusalCode(error);
    if (code !== null) return { status: "proved", code };
    const text = errorMessage(error);
    // A canary is listening on this port, so ECONNREFUSED means something else consumed the
    // connection attempt; it is not proof that the sandbox denied network access.
    return {
      status: "non-result",
      detail: `unclassified connect failure (${text.slice(0, 200)})`,
    };
  }
}

/** The route the OS wall cannot close on macOS: `sandbox-exec` compiles the Seatbelt profile and
 *  then execs the pinned interpreter, so that one literal has to stay executable for this worker
 *  to start. `generated-tool-exec-wall.ts` removes it from the reachable namespace instead, and
 *  this probe goes through that namespace — a captured handle would measure the kernel, which
 *  still allows the exec, rather than what generated code can do. */
function runtimeReExecProbe(): GeneratedToolProbeOutcome {
  try {
    const child = Bun.spawnSync({ cmd: [nativeExecutable, "--version"], stdout: "pipe", stderr: "pipe" });
    if (child.success || child.exitCode !== null) {
      return { status: "violated", detail: "the pinned interpreter re-executed inside the boundary" };
    }
    return { status: "non-result", detail: "the interpreter spawn failed without a system error" };
  } catch (error) {
    const code = refusalCode(error);
    if (code !== null) return { status: "proved", code };
    if (LOCKED_LAUNCH_MEMBER.test(errorText(error))) return { status: "proved", code: "namespace-locked" };
    return { status: "non-result", detail: `unclassified failure: ${errorText(error)}` };
  }
}

async function boundaryProbe(start: GeneratedToolStart): Promise<GeneratedToolBoundaryProbe> {
  const subprocess = probeOutcome(() => {
    const child = nativeSpawnSync({ cmd: ["/usr/bin/true"], stdout: "pipe", stderr: "pipe" });
    if (child.success || child.exitCode !== null) throw new Error("spawn completed");
    throw new Error("subprocess spawn failed without a system error");
  });
  const outsideRead = probeOutcome(() => nativeReadFile(start.deniedReadPath));
  const outsideWrite = probeOutcome(() => nativeWriteFile(start.deniedWritePath, "denied-write-probe"));
  const credentialNames = nativeObjectKeys(nativeEnvironment).filter((name) =>
    CREDENTIAL_ENVIRONMENT.test(name),
  );
  return {
    outsideReadRefused: missingPathOutcome(outsideRead),
    outsideWriteRefused: missingPathOutcome(outsideWrite),
    credentialEnvironmentAbsent:
      credentialNames.length === 0
        ? { status: "proved", code: "no credential-shaped environment name" }
        : { status: "violated", detail: `credential-shaped names present: ${credentialNames.join(",")}` },
    networkRefused: await networkProbe(start.networkProbePort),
    subprocessRefused: subprocess,
    runtimeReExecRefused: runtimeReExecProbe(),
  };
}

function toolResult(value: unknown): AgentToolResult<unknown> {
  if (!isRecord(value)) {
    throw new Error("generated tool returned a malformed result");
  }
  const candidate = /* SAFETY: the check above returned when `!isRecord(value)`. */ value as Partial<
    AgentToolResult<unknown>
  >;
  if (
    !Array.isArray(candidate.content) ||
    candidate.content.some(
      (part) =>
        !isObject(part) ||
        /* SAFETY: reached only when `isObject(part)` held. */ (part as { type?: unknown }).type !== "text" ||
        !isString(/* SAFETY: reached only when `isObject(part)` held. */ (part as { text?: unknown }).text),
    )
  ) {
    throw new Error("generated tool result must contain text content");
  }
  return {
    content: candidate.content,
    details: candidate.details ?? null,
    // A generated callback cannot stop the Pi loop. Only the host-side submit proxy may return
    // terminate after its retained SubmissionAuthority accepted exact bytes.
  };
}

async function handle(message: GeneratedToolParentMessage): Promise<void> {
  if (message.type === "start") throw new Error("generated-tool worker initialized twice");
  if (message.type === "close") {
    nativeExit(0);
    return;
  }
  const active = starter;
  if (active === null) throw new Error("generated-tool worker is not initialized");
  try {
    if (message.type === "materialization") {
      send({
        type: "materialization_result",
        requestId: message.requestId,
        checkpoint: active.checkpoint(1),
      });
      return;
    }
    if (message.type === "files" || message.type === "apply_files") {
      const draft = draftFiles;
      if (draft === null) throw new Error("the files preset is not selected");
      if (message.type === "files") {
        send({
          type: "files_result",
          requestId: message.requestId,
          files: draft.fileSnapshot(),
          checkpoint: active.checkpoint(1),
        });
        return;
      }
      // Whole-batch or nothing: a partial apply would leave the draft in a state neither the
      // command nor the file tools authored. `fileMapIssues` is the public artifact's own key
      // rule, so what a command may hand back is what the answer would accept.
      const issues = fileMapIssues(message.files, "files", (base, key) => `${base}[${key}]`);
      if (issues.length > 0) {
        const detail = issues
          .slice(0, 8)
          .map((issue) => `${issue.path}: expected ${issue.expected}, got ${issue.actual}`)
          .join("; ");
        throw new Error(`the command returned files the draft refuses — ${detail}`);
      }
      const before = draft.seq;
      draft.replaceFiles(message.files);
      // The file tools record the answer whenever they change the draft (`draft-files.ts` binds
      // that rule to every writer). A shell command that changed the files is the same event, so
      // it records through the same owner instead of leaving a stale answer behind.
      const materialize = tools.get("materialize_files");
      if (draft.seq !== before && materialize !== undefined) {
        await materialize.execute(`apply-files-${message.requestId}`, {});
      }
      send({ type: "apply_files_result", requestId: message.requestId, checkpoint: active.checkpoint(1) });
      return;
    }
    if (message.name === "submit") {
      throw new Error("submit is controller-owned");
    }
    const tool = tools.get(message.name);
    if (tool === undefined) throw new Error(`unknown generated tool "${message.name}"`);
    const returned = await tool.execute(message.callId, message.arguments);
    const result = toolResult(materializeTaskData === null ? returned : materializeTaskData(returned));
    const taskAccess = taskAccessSnapshot();
    send({
      type: "tool_result",
      requestId: message.requestId,
      result,
      checkpoint: active.checkpoint(1),
      ...keyIfDefined("taskAccess", taskAccess),
    });
  } catch (error) {
    const taskAccess = taskAccessSnapshot();
    send({
      type: "request_error",
      requestId: message.requestId,
      error: errorText(error),
      checkpoint: active.checkpoint(1),
      ...keyIfDefined("taskAccess", taskAccess),
    });
  }
}

function hide(name: string, value: HiddenGlobalValue): void {
  Object.defineProperty(globalThis, name, { value, configurable: false, enumerable: false, writable: false });
}

function hideAmbientProcess(): void {
  const inert = () => undefined;
  hide(
    "console",
    Object.freeze({
      log: inert,
      info: inert,
      warn: inert,
      error: inert,
      debug: inert,
      dir: inert,
      trace: inert,
    }),
  );
  hide("process", Object.freeze({ env: Object.freeze({}), pid: nativePid, nextTick: nativeNextTick }));
  for (const name of ["require", "module"]) hide(name, undefined);
  // The runtime global itself cannot be hidden: JavaScriptCore pins it as a non-configurable,
  // non-writable global, so a computed lookup always recovers the namespace object. What that
  // handle can do is bounded elsewhere — the OS wall refuses its reads, writes and egress, and
  // `denyProcessExecution` has already replaced its launch members with permanent refusals.
}

/** Require every isolation probe to pass before loading generated code. A violated or
 *  inconclusive probe ends the worker with a sandbox non-result, so tool execution cannot
 *  proceed under unproved isolation. */
function unprovenProbeDetail(probe: GeneratedToolBoundaryProbe): string | null {
  for (const name of PROBE_KEYS) {
    const outcome = probe[name];
    if (outcome.status === "proved") continue;
    return `${name}: ${outcome.status === "violated" ? "capability observed" : "non-result"} (${
      "detail" in outcome ? outcome.detail : ""
    })`;
  }
  return null;
}

/** The session start: the execution wall, the boundary probes, then candidate code. Nothing
 *  generated loads until the probes have proved the walls, and the tool map is the last thing
 *  set, so the phase the caller advances to on return is true of everything behind it. */
async function startSession(
  message: GeneratedToolStart,
  loadFactory: () => Promise<DomainHarnessFactory>,
): Promise<void> {
  // Install process-execution restrictions first so the isolation probe checks them.
  const wall: ExecWall = await denyProcessExecution(runtimeProcess.platform);
  if (wall.status === "unavailable") {
    nonResult("sandbox", `process-execution wall unavailable: ${wall.detail}`);
    nativeExit(0);
    return;
  }
  const probe = await boundaryProbe(message);
  const unproven = unprovenProbeDetail(probe);
  if (unproven !== null) {
    nonResult("sandbox", `boundary unproven — ${unproven}`);
    nativeExit(0);
    return;
  }
  hideAmbientProcess();
  // The isolation probes passed; candidate code may now load through the trusted factory.
  send({ type: "wall_ready", workerInstanceId: message.workerInstanceId });
  const factory = await loadFactory();
  const traced = tracePublicTask(message.task, message.traceTaskAccess === true ? "traced" : "untraced");
  taskAccessSnapshot = traced.snapshot;
  materializeTaskData = traced.materialize;
  starter = createBuiltStarter(traced.task, factory, null, {
    draftToolFactories: message.presets.includes("files")
      ? [
          (draft) => {
            draftFiles = draft;
            return createDraftFileTools(draft, message.publicArtifactSchema);
          },
        ]
      : [],
    domainToolAuthorities: message.domainToolAuthorities,
    publicArtifactSchema: message.publicArtifactSchema,
    publishedMargins: message.publishedMargins,
  });
  tools = new Map(starter.tools.map((tool) => [tool.name, tool]));
  phase = "ready";
  const taskAccess = taskAccessSnapshot();
  send({
    type: "ready",
    pid: nativePid,
    workerInstanceId: message.workerInstanceId,
    bundleDigest: message.bundleDigest,
    tools: starter.tools.map(generatedToolInterface),
    registration: starter.registration,
    checkpoint: starter.checkpoint(1),
    probe,
    ...keyIfDefined("taskAccess", taskAccess),
    execWall: wall.mechanism,
  });
}

export function runGeneratedToolWorker(loadFactory: () => Promise<DomainHarnessFactory>): void {
  void attachJsonlLineReader(
    nativeStdin,
    (line) => {
      const decision = decideParentFrame(line, phase);
      if (decision.act === "refuse") {
        nonResult(decision.kind, decision.error);
        return;
      }
      if (decision.act === "start") {
        phase = "starting";
        protocolSecret = decision.message.protocolSecret;
        void startSession(decision.message, loadFactory).catch((error) =>
          nonResult("runtime", errorText(error)),
        );
        return;
      }
      void handle(decision.message).catch((error) => nonResult("runtime", errorText(error)));
    },
    GENERATED_TOOL_FRAME_MAX_BYTES,
  ).catch((error) => nonResult("protocol", errorText(error)));
}

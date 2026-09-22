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
 *  absent module hooks. */
type HiddenGlobalValue =
  | Readonly<Record<"log" | "info" | "warn" | "error" | "debug" | "dir" | "trace", () => undefined>>
  | Readonly<{
      env: Readonly<Record<string, string | undefined>>;
      pid: number;
      nextTick: typeof nativeNextTick;
    }>
  | undefined;

/** The error codes that mean a sandbox refused the operation; any other failure proves nothing. */
const REFUSAL_CODES = new Set(["EPERM", "EACCES", "EROFS"]);

/** The refusal `lockRuntimeLaunchMembers` installs, recognised only for the interpreter re-exec
 *  route the kernel must leave open. */
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
/** The DraftStore behind the files preset, for the shell's file exchange; null, and so refusing
 *  the exchange, when that preset is not selected. */
let draftFiles: DraftStore | null = null;
let tools = new Map<string, AgentTool>();
let protocolSecret: string | null = null;
/** What the session has finished, and so what the next inbound line may ask for. */
let phase: SessionPhase = "new";
let frameCounter = 0;
let taskAccessSnapshot = (): GeneratedTaskAccess | undefined => undefined;
let materializeTaskData: ReturnType<typeof tracePublicTask>["materialize"] | null = null;

/** Returns the refusal text, or null once written. The counter advances only on a written frame,
 *  because the parent requires consecutive counters. */
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

/** A tool result the protocol cannot carry fails that call only, so the solver can retry with a
 *  smaller or finite value. Any other unsendable frame ends the session. */
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

/** The frame every failed path out of this worker sends. */
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
  // Bun reports a sandbox connect denial as a bare "Failed to connect". The controller canary
  // listens on that port, so this is a denial, not a missing listener.
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

/** ENOENT proves refusal only under Bubblewrap, whose namespace never mounts the path; Seatbelt
 *  leaves the path visible, so there it proves nothing. */
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
    // With the canary listening, ECONNREFUSED does not prove a sandbox denial.
    return {
      status: "non-result",
      detail: `unclassified connect failure (${text.slice(0, 200)})`,
    };
  }
}

/** Re-executing the pinned interpreter, which Seatbelt must allow. The exec wall removes it from
 *  the reachable namespace, so this probe goes through that namespace rather than a captured
 *  handle. */
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
    // `terminate` is dropped: only the host-side submit may stop the loop.
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
      // The whole batch or nothing, under the artifact's own file-map rule.
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
      // A command that changed the files prepares the answer again, as the file tools do.
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
  // The `Bun` global cannot be hidden; the OS wall and `denyProcessExecution` bound what it can do.
}

/** The first probe that did not prove its boundary, or null when all did. */
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
 *  generated loads until the probes prove the walls. */
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

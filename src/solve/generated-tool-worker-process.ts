import type { JsonValue } from "../meta/json-shape.ts";
import { mkdtempSync, realpathSync, rmSync } from "../meta/filesystem.ts";
import { tmpdir } from "../meta/os.ts";
import { dirname, join } from "../meta/path.ts";
import { attachJsonlLineReader } from "../../vendor/pi-built/jsonl.ts";
import { hashBundle } from "../claim/bundle-hash.ts";
import { boundText } from "../meta/bounded-text.ts";
import { cancellableByteStream } from "../meta/cancellable-stream.ts";
import { sha256, sha256OfFile } from "../meta/digest.ts";
import { capturedStructuredClone, capturedJsonStringify, capturedJsonParse } from "../meta/json-runtime.ts";
import type { RuntimeSignal } from "../meta/runtime-values.ts";
import { canonicalJsonCopy as trustedJson, sameJsonValue } from "../meta/stable-json.ts";
import { LINUX_BWRAP_ID, bwrapWrappedSignal } from "../verify/linux-bwrap.ts";
import { type OsIsolationSupport, witnessConfinedChild } from "../verify/os-isolation.ts";
import type {
  BuiltStarterCheckpoint,
  BuiltStarterNonResult,
  GeneratedToolWorkerEvidence,
} from "./built-starter.ts";
import { rehydrateDraftContractError } from "./draft-authority.ts";
import { type AcceptedResult, admitResult } from "./generated-tool-result-routing.ts";
import {
  closeRefusal,
  exitOwner,
  exitTermination,
  readyTimeoutCause,
} from "./generated-tool-worker-termination.ts";
import {
  type GeneratedWorkerPolicy,
  assertGeneratedSourceLoaders,
  assertGeneratedWorkerPolicyUnchanged,
  generatedBuiltinRefusal,
  generatedWorkerPolicy,
} from "./generated-tool-source-policy.ts";
import { probeProvesBoundary } from "./built-starter.ts";
import {
  GENERATED_TOOL_FRAME_MAX_BYTES,
  type GeneratedToolChildMessage,
  type GeneratedToolParentMessage,
  type GeneratedToolStart,
  GeneratedToolWorkerNonResult,
  serializeGeneratedToolParentFrame,
  verifyGeneratedToolFrame,
} from "./generated-tool-worker-protocol.ts";
import { runtimeProcess } from "../meta/process.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { buildWorkerBundle, killProcessGroup } from "../meta/subprocess.ts";
export type WorkerBundle = { dir: string; file: string; digest: string; sourceDigest: string };

type ReadyMessage = Extract<GeneratedToolChildMessage, { type: "ready" }>;
export type WorkerReady = ReadyMessage & { policyHash: string; policyIdentity: string };

const REQUEST_REPLY = {
  execute: "tool_result",
  materialization: "materialization_result",
  files: "files_result",
  apply_files: "apply_files_result",
} as const satisfies Record<string, AcceptedResult["type"]>;
type Termination = GeneratedToolWorkerEvidence["termination"];

const TIMEOUT_MS = 30_000;
const CLOSE_TIMEOUT_MS = 1_000;
const STDERR_MAX = 64 * 1024;
const bundleDirs = new Set<string>();
const bundleCache = new Map<string, Promise<WorkerBundle>>();

/** A cause the termination module named, as the error this client latches and throws. */
function raise(cause: BuiltStarterNonResult): GeneratedToolWorkerNonResult {
  return new GeneratedToolWorkerNonResult(cause.kind, cause.message, cause.deadline ?? false);
}

/** Preserve the failure's typed evidence in the terminal result, wherever the failure arose. */
function terminationOf(
  failure: GeneratedToolWorkerNonResult,
): Extract<Termination, { status: "non-result" }> {
  return { status: "non-result", ...failure.nonResult() };
}

runtimeProcess.once("exit", () => {
  for (const dir of bundleDirs) rmSync(dir, { recursive: true, force: true });
});

export async function bundleGeneratedWorker(slugDir: string): Promise<WorkerBundle> {
  const agentDir = join(slugDir, "agent");
  const toolsFile = join(agentDir, "tools.ts");
  const agentBundle = hashBundle(agentDir);
  const cached = bundleCache.get(agentBundle.hash);
  if (cached) return await cached;
  assertGeneratedSourceLoaders(agentDir, agentBundle.files);
  const pending = (async () => {
    const temporaryDir = mkdtempSync(join(tmpdir(), "ana-generated-tools-"));
    const entry = join(temporaryDir, "entry.ts");
    const childEntry = Bun.fileURLToPath(new URL("./generated-tool-worker-child.ts", import.meta.url));
    try {
      await Bun.write(
        entry,
        `import { runGeneratedToolWorker } from ${capturedJsonStringify(childEntry)};\n` +
          `runGeneratedToolWorker(async () => (await import(${capturedJsonStringify(toolsFile)})).createDomainHarness);`,
      );
      const output = await buildWorkerBundle("generated worker bundle failed", entry, temporaryDir, [
        generatedBuiltinRefusal(agentDir),
      ]);
      rmSync(entry, { force: true });
      const file = realpathSync(output);
      const bundle = {
        dir: dirname(file),
        file,
        digest: sha256OfFile(file),
        sourceDigest: agentBundle.hash,
      };
      bundleDirs.add(bundle.dir);
      return bundle;
    } catch (error) {
      rmSync(temporaryDir, { recursive: true, force: true });
      bundleCache.delete(agentBundle.hash);
      throw error;
    }
  })();
  bundleCache.set(agentBundle.hash, pending);
  return await pending;
}

export class WorkerClient {
  private readonly child: Bun.Subprocess<"pipe", "pipe", "pipe">;
  private readonly networkCanary: Bun.TCPSocketListener<undefined>;
  private readonly policy: GeneratedWorkerPolicy;
  private readonly processExited: Promise<{ code: number | null; signal: RuntimeSignal | null }>;
  private readonly exited: Promise<{ code: number | null; signal: RuntimeSignal | null }>;
  private readonly endInput: () => number | Promise<number>;
  private readonly cancelOutput: (reason: Error) => void;
  private readonly pending = new Map<
    string,
    {
      expected: AcceptedResult["type"];
      resolve(value: AcceptedResult): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly readyTimer: ReturnType<typeof setTimeout>;
  private readonly readyState = Promise.withResolvers<WorkerReady>();
  /** Whether the child reported its isolation installed. Before that frame, startup belongs to the
   *  host and a ready timeout is the host's own wait; afterwards the worker is loading the
   *  candidate's code, which no environment reader may claim. `readyTimeoutCause` reads the field
   *  to make exactly that distinction. */
  private walls: "installed" | "pending" = "pending";
  private expectedClose = false;
  private failed: GeneratedToolWorkerNonResult | null = null;
  private checkpointValue: BuiltStarterCheckpoint | null = null;
  /** The handshake is what the checkpoint records: the worker holds one only once its `ready` frame
   *  was admitted, so the stored checkpoint is the phase. Five readers here ask for the phase rather
   *  than for the field, because what each of them decides — who owns an exit, whether a second
   *  ready is a protocol defect, whether the ready promise still needs rejecting, how an ending is
   *  classified and whether a close may proceed — turns on the handshake and not on a checkpoint's
   *  contents. */
  private get handshake(): "done" | "pending" {
    return this.checkpointValue === null ? "pending" : "done";
  }
  private taskAccessValue: WorkerReady["taskAccess"];
  private closePromise: Promise<Termination> | null = null;
  private activeRequests = 0;
  private writeTail: Promise<void> = Promise.resolve();
  private resourcesReleased = false;
  private readonly protocolSecret = crypto.getRandomValues(new Uint8Array(32)).toHex();
  private expectedFrameCounter = 1;
  readonly ready = this.readyState.promise;

  constructor(
    bundle: WorkerBundle,
    start: Omit<GeneratedToolStart, "protocolSecret" | "networkProbePort">,
    support?: OsIsolationSupport,
    private readonly requestTimeoutMs = TIMEOUT_MS,
    private readonly readyTimeoutMs = TIMEOUT_MS,
  ) {
    // The real child proves the boundary: it installs the execution wall, runs the isolation probes
    // and only then loads generated code, and its `ready` frame carries the probe this client checks.
    this.policy = generatedWorkerPolicy(bundle, support);
    this.networkCanary = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open: (socket) => {
          socket.end();
          this.fail(this.nonResult("sandbox", "reached the controller network canary"));
        },
        data() {},
        error() {},
      },
    });
    let startFrame: string;
    let child: Bun.Subprocess<"pipe", "pipe", "pipe">;
    try {
      startFrame = serializeGeneratedToolParentFrame({
        ...start,
        networkProbePort: this.networkCanary.port,
        protocolSecret: this.protocolSecret,
      });
      child = Bun.spawn({
        cmd: [this.policy.executable, ...this.policy.launchArgs, bundle.file],
        cwd: bundle.dir,
        env: this.policy.runtimeEnvironment,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (error) {
      this.networkCanary.stop(true);
      throw error;
    }
    this.child = child;
    this.endInput = child.stdin.end.bind(child.stdin);
    const stdoutPipe = cancellableByteStream(child.stdout);
    const stderrPipe = cancellableByteStream(child.stderr);
    this.cancelOutput = (reason) => {
      stdoutPipe.cancel(reason);
      stderrPipe.cancel(reason);
    };
    this.readyTimer = setTimeout(
      () => this.fail(raise(readyTimeoutCause(this.walls, this.readyTimeoutMs))),
      this.readyTimeoutMs,
    );
    let stderr = "";
    const stderrDecoder = new TextDecoder();
    const stderrDone = (async () => {
      for await (const chunk of stderrPipe.stream) {
        if (stderr.length < STDERR_MAX) {
          stderr += stderrDecoder.decode(chunk.subarray(0, STDERR_MAX - stderr.length), { stream: true });
        }
      }
      stderr += stderrDecoder.decode();
    })();
    const stdoutDone = attachJsonlLineReader(
      stdoutPipe.stream,
      (line) => this.receive(line, start, this.policy.hash, this.policy.identity),
      GENERATED_TOOL_FRAME_MAX_BYTES,
    );
    this.processExited = child.exited.then((code) => this.exitOf(code));
    this.exited = Promise.all([this.processExited, stdoutDone, stderrDone])
      .then(([result]) => {
        if (!this.expectedClose) {
          const detail = stderr.trim() === "" ? "" : `: ${boundText(stderr, 800).shown}`;
          this.fail(
            this.nonResult(
              exitOwner(this.handshake, result),
              `exited before close (${String(result.code ?? result.signal)})${detail}`,
            ),
          );
        }
        return result;
      })
      .catch(async (error) => {
        this.fail(this.nonResult("runtime", `stream failed: ${errorMessage(error)}`));
        return await this.processExited;
      });
    // oxlint-disable-next-line typescript/no-floating-promises -- writeFrame records stdin failures through this.fail.
    void this.writeFrame(startFrame);
  }

  private nonResult(
    kind: BuiltStarterNonResult["kind"],
    message: string,
    deadline = false,
  ): GeneratedToolWorkerNonResult {
    return new GeneratedToolWorkerNonResult(kind, `generated-tool worker ${message}`, deadline);
  }

  private writeFrame(frame: string): Promise<void> {
    const write = this.writeTail.then(async () => {
      await this.child.stdin.write(frame);
    });
    this.writeTail = write.catch((error) => {
      this.fail(this.nonResult("runtime", `stdin failed: ${errorMessage(error)}`));
    });
    return this.writeTail;
  }

  private refuseProtocol(message: string): never {
    const error = this.nonResult("protocol", message);
    this.fail(error);
    throw error;
  }

  private admitReady(
    message: ReadyMessage,
    start: Omit<GeneratedToolStart, "protocolSecret" | "networkProbePort">,
    policyHash: string,
    policyIdentity: string,
  ): void {
    const confinedPid = witnessConfinedChild(message.pid, this.child.pid, this.policy.mechanismId);
    if (
      confinedPid === null ||
      message.workerInstanceId !== start.workerInstanceId ||
      message.bundleDigest !== start.bundleDigest ||
      !sameJsonValue(message.registration.artifactWriterNames, message.checkpoint.artifactWriterNames) ||
      message.checkpoint.materialization.state !== "absent"
    ) {
      this.fail(this.nonResult("protocol", "ready identities do not match the controller start"));
      return;
    }
    if (!probeProvesBoundary(message.probe)) {
      this.fail(this.nonResult("sandbox", "did not prove the exact production boundary"));
      return;
    }
    if (this.handshake === "done") {
      this.fail(this.nonResult("protocol", "repeated ready"));
      return;
    }
    clearTimeout(this.readyTimer);
    this.checkpointValue = message.checkpoint;
    this.taskAccessValue = message.taskAccess;
    // The host pid the witness matched, so evidence and signals name a process this host can address.
    this.readyState.resolve({ ...message, pid: confinedPid, policyHash, policyIdentity });
  }

  private receive(
    line: string,
    start: Omit<GeneratedToolStart, "protocolSecret" | "networkProbePort">,
    policyHash: string,
    policyIdentity: string,
  ): void {
    if (this.failed) return;
    let message: GeneratedToolChildMessage;
    try {
      message = verifyGeneratedToolFrame(line, this.protocolSecret, this.expectedFrameCounter);
      this.expectedFrameCounter += 1;
    } catch (error) {
      this.fail(
        error instanceof GeneratedToolWorkerNonResult
          ? error
          : this.nonResult("protocol", "emitted an invalid frame"),
      );
      return;
    }
    if (message.type === "non_result") {
      this.fail(this.nonResult(message.kind, `reported ${message.error}`));
      return;
    }
    // One `wall_ready`, from this worker, before its `ready`: the phase it declares decides who
    // owns a later failure, so it is admitted on the same terms as the ready handshake and a
    // repeat or a foreign instance id is a protocol defect rather than a free phase change.
    if (message.type === "wall_ready") {
      const admitted = message.workerInstanceId === start.workerInstanceId && this.walls === "pending";
      if (admitted) this.walls = "installed";
      else this.fail(this.nonResult("protocol", "wall_ready identities do not match the controller start"));
      return;
    }
    if (message.type === "ready") {
      this.admitReady(message, start, policyHash, policyIdentity);
      return;
    }
    const request = this.pending.get(message.requestId);
    if (request !== undefined) {
      this.pending.delete(message.requestId);
      clearTimeout(request.timer);
    }
    const verdict = admitResult(message, request?.expected ?? null, this.checkpointValue);
    if (verdict.act === "refuse") {
      const error = this.nonResult("protocol", verdict.error);
      request?.reject(error);
      this.fail(error);
      return;
    }
    // Only the lookup above can make `expected` non-null, and `admitResult` refuses a null one as
    // an unknown request id, so a verdict that got past the refusal has a request behind it.
    if (request === undefined) return;
    // Recorded before the branch below, because this state belongs to the worker rather than to the
    // call that failed: a refused tool call still leaves a draft the next call continues from, and
    // the checkpoint is what a long turn's liveness is read through. Dropping it on a failed call
    // would make the worker look stalled. `admitResult` has already checked this frame's checkpoint
    // against the accepted one, so what is stored here cannot have drifted or regressed.
    this.checkpointValue = verdict.retained.checkpoint;
    this.taskAccessValue = verdict.retained.taskAccess ?? this.taskAccessValue;
    if (verdict.act === "fail-call") {
      request.reject(rehydrateDraftContractError(verdict.error));
      return;
    }
    request.resolve(verdict.result);
  }

  private fail(error: GeneratedToolWorkerNonResult): void {
    if (this.failed) return;
    this.failed = error;
    clearTimeout(this.readyTimer);
    if (this.handshake === "pending") this.readyState.reject(error);
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    this.networkCanary.stop(true);
    if (!this.child.killed) killProcessGroup(this.child, "SIGTERM");
  }

  private async waitForExit(milliseconds: number): Promise<boolean> {
    const timeout = Promise.withResolvers<boolean>();
    const timer = setTimeout(() => timeout.resolve(false), milliseconds);
    try {
      return await Promise.race([this.processExited.then(() => true), timeout.promise]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async terminateAndWait(): Promise<void> {
    if (await this.waitForExit(0)) return;
    killProcessGroup(this.child, "SIGTERM");
    if (await this.waitForExit(CLOSE_TIMEOUT_MS)) return;
    killProcessGroup(this.child, "SIGKILL");
    await this.waitForExit(CLOSE_TIMEOUT_MS);
  }

  private async request(
    message:
      | Omit<Extract<GeneratedToolParentMessage, { type: "execute" }>, "requestId">
      | { type: "materialization" }
      | { type: "files" }
      | Omit<Extract<GeneratedToolParentMessage, { type: "apply_files" }>, "requestId">,
  ): Promise<AcceptedResult> {
    this.activeRequests += 1;
    try {
      await this.ready;
      if (this.child.killed) this.fail(this.nonResult("runtime", "exited before request dispatch"));
      if (this.failed) throw this.failed;
      const requestId = crypto.randomUUID();
      const frame = serializeGeneratedToolParentFrame({ ...message, requestId });
      const result = Promise.withResolvers<AcceptedResult>();
      const timer = setTimeout(
        () => this.fail(this.nonResult("protocol", "request timed out")),
        this.requestTimeoutMs,
      );
      this.pending.set(requestId, { expected: REQUEST_REPLY[message.type], timer, ...result });
      // oxlint-disable-next-line typescript/no-floating-promises -- writeFrame records stdin failures through this.fail.
      void this.writeFrame(frame);
      return await result.promise;
    } finally {
      this.activeRequests -= 1;
    }
  }

  /** A reply that arrived where the protocol pairs this request with exactly one type. `admitResult`
   *  already refuses a crossed result, so this is the narrowing behind that refusal rather than a
   *  second check; it names what actually crossed, so a protocol change reads as itself instead of
   *  as one shared phrase. */
  private crossed(type: string): Error {
    return new Error(`unreachable crossed result: ${type}`);
  }

  async execute(callId: string, name: string, args: Record<string, JsonValue>) {
    const response = await this.request({ type: "execute", callId, name, arguments: args });
    if (response.type !== "tool_result") throw this.crossed(response.type);
    return response.result;
  }

  /** The draft's current file map, for a controller-side command to work on. */
  async files(): Promise<Record<string, string>> {
    const response = await this.request({ type: "files" });
    if (response.type !== "files_result") throw this.crossed(response.type);
    return capturedStructuredClone(response.files);
  }

  /** Replace the draft's file map with what a command left behind. The child validates the batch
   *  against the draft's own key and content rules and refuses it whole, so a rejected apply leaves
   *  the draft exactly as it was rather than half-written from a command that half-succeeded. */
  async applyFiles(files: Record<string, string>): Promise<void> {
    const response = await this.request({ type: "apply_files", files });
    if (response.type !== "apply_files_result") throw this.crossed(response.type);
  }

  async materialization() {
    const response = await this.request({ type: "materialization" });
    if (response.type !== "materialization_result") throw this.crossed(response.type);
    const { materialization } = response.checkpoint;
    if (materialization.state !== "absent") {
      const { record } = materialization;
      if (sha256(record.artifactJson) !== record.artifactDigest) {
        this.refuseProtocol("returned a falsified artifact digest");
      }
      if (this.checkpointValue?.artifactWriterNames.includes(record.writerName) !== true) {
        this.refuseProtocol("returned an undeclared artifact writer identity");
      }
      let parsed: unknown;
      try {
        parsed = capturedJsonParse(record.artifactJson);
      } catch {
        this.refuseProtocol("returned malformed artifact bytes");
      }
      if (trustedJson(parsed).bytes !== record.artifactJson) {
        this.refuseProtocol("returned non-canonical artifact bytes");
      }
    }
    return capturedStructuredClone(materialization);
  }

  checkpoint(turn: number): BuiltStarterCheckpoint {
    if (!this.checkpointValue) throw new Error("generated-tool worker has no checkpoint");
    return { ...capturedStructuredClone(this.checkpointValue), turn };
  }

  taskAccess() {
    return this.taskAccessValue ? capturedStructuredClone(this.taskAccessValue) : null;
  }

  private attestedTermination(termination: Termination): Termination {
    try {
      assertGeneratedWorkerPolicyUnchanged(this.policy);
      return termination;
    } catch (error) {
      if (!(error instanceof GeneratedToolWorkerNonResult)) throw error;
      return terminationOf(error);
    }
  }

  /** The child's exit as code or signal, never both. Under Bubblewrap the signal arrives wrapped in
   *  the exit code and is read back as a signal. */
  private exitOf(code: number | null) {
    const signal =
      this.child.signalCode ?? (this.policy.mechanismId === LINUX_BWRAP_ID ? bwrapWrappedSignal(code) : null);
    return { code: signal === null ? code : null, signal };
  }

  private ended(prefix: string, exit: { code: number | null; signal: RuntimeSignal | null }): Termination {
    return exitTermination(prefix, exit, this.handshake);
  }

  private releaseResources(): void {
    if (this.resourcesReleased) return;
    this.resourcesReleased = true;
    this.cancelOutput(new Error("generated-tool worker reached terminal settlement"));
    try {
      void Promise.resolve(this.endInput()).catch(() => {});
    } catch {
      // stdin may already be closed
    }
    try {
      this.child.stdin.unref();
    } catch {
      // stdin may already be closed
    }
    try {
      this.child.unref();
    } catch {
      // the child may already have exited
    }
    this.writeTail = Promise.resolve();
  }

  private async closeInput(): Promise<void> {
    await this.writeFrame(serializeGeneratedToolParentFrame({ type: "close" }));
    if (this.failed) return;
    try {
      await this.child.stdin.end();
    } catch (error) {
      this.fail(this.nonResult("runtime", `stdin failed: ${errorMessage(error)}`));
    }
  }

  private async settleClose(): Promise<Termination> {
    try {
      this.expectedClose = true;
      // This aggregate already carries its own rejection into `this.failed`, so nothing is lost by
      // ignoring it here. It may finish draining after the child exits, and it must not extend the
      // bounded close handshake or surface a late unhandled rejection once the run has settled.
      void this.exited.catch(() => {});
      this.networkCanary.stop(true);
      const refusal = closeRefusal(this.handshake, this.activeRequests);
      if (refusal !== null) this.fail(raise(refusal));
      const initialFailure = this.failed;
      if (initialFailure) {
        await this.terminateAndWait();
        return terminationOf(initialFailure);
      }
      if (this.child.killed) return this.ended("had already exited", this.exitOf(this.child.exitCode));
      const timeout = Promise.withResolvers<boolean>();
      const timer = setTimeout(() => timeout.resolve(false), CLOSE_TIMEOUT_MS);
      const handshake = Promise.all([this.closeInput(), this.processExited]).then(
        () => true,
        (error) => {
          this.fail(this.nonResult("runtime", `close failed: ${errorMessage(error)}`));
          return true;
        },
      );
      const closedInTime = await Promise.race([handshake, timeout.promise]);
      clearTimeout(timer);
      const closeFailure = this.failed;
      if (closeFailure) {
        await this.terminateAndWait();
        return terminationOf(closeFailure);
      }
      if (closedInTime) return this.ended("closed", await this.processExited);
      const timeoutFailure = this.nonResult("runtime", `did not close within ${CLOSE_TIMEOUT_MS}ms`, true);
      this.fail(timeoutFailure);
      await this.terminateAndWait();
      return { ...terminationOf(timeoutFailure), closeHandshakeTimeout: true };
    } finally {
      this.releaseResources();
    }
  }

  async close(): Promise<Termination> {
    this.closePromise ??= this.settleClose().then((result) => this.attestedTermination(result));
    return await this.closePromise;
  }
}

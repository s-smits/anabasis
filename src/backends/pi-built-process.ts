/** Exact process lifecycle for the confined Pi model worker. */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { attachJsonlLineReader, serializeJsonLine } from "../../vendor/pi-built/jsonl.ts";
import { DEFAULT_HARNESS_SETTINGS } from "../correctness-bundle/harness-config.ts";
import { GeneratedToolWorkerNonResult } from "../solve/generated-tool-worker.ts";
import type { BuiltRuntimeBoundaryEvidence, SolverNonResult } from "../correctness-bundle/solve.ts";
import { witnessConfinedChild } from "../verify/os-isolation.ts";
import { spawnUnderSolveIsolation } from "../verify/solve-sandbox.ts";
import { MODEL_CATALOGUE_SOURCES } from "./model-selection.ts";
import type * as PiWire from "./pi-built-child.ts";
import type { PiBuiltRuntime } from "./pi-built.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import { runtimeProcess } from "../meta/process.ts";
import { cancellableByteStream } from "../meta/cancellable-stream.ts";
import type { RuntimeSignal } from "../meta/runtime-values.ts";
import type { ProviderTurnReservation } from "../run/provider-resource-budget.ts";
import {
  killProcessGroup,
  killProcessGroupId,
  terminateAndReapProcessGroup,
  terminateAndReapProcessGroupId,
} from "../meta/subprocess.ts";
import { asError, errorMessage } from "../meta/runtime-values.ts";
import { boundText } from "../meta/bounded-text.ts";

type PiChild = ReturnType<typeof spawnUnderSolveIsolation>;
type Done = Extract<PiWire.PiBuiltChildMessage, { type: "done" }>;
type Forwarded = Exclude<PiWire.PiBuiltChildMessage, { type: "ready" | "tool_call" | "done" | "closing" }>;
type Ready = Extract<PiWire.PiBuiltChildMessage, { type: "ready" }>;
type PermitRequest = Extract<PiWire.PiBuiltChildMessage, { type: "turn_permit_request" }>;
type ModelSelection = Ready["modelSelection"];
type Phase = "opening" | "running" | "closing";

export interface PiBuiltWorkerBundle {
  file: string;
  dir: string;
  digest: string;
}

interface PiBuiltWorkerResult {
  done: Done;
  modelWorker: BuiltRuntimeBoundaryEvidence["modelWorker"];
}

const READY_TIMEOUT_MS = 30_000;
const CLOSE_TIMEOUT_MS = 2_000;
const TURN_TIMEOUT_MS = 300_000;
const SOLVE_WALL_MESSAGE = "Pi Built worker exceeded its bounded solve time";
/** A stopped worker's aborted tool calls settle within this; the shell kills its process tree on abort. */
const DISPATCH_SETTLE_MS = 10_000;

interface WorkerState {
  phase: Phase;
  pid: number | null;
  modelSelection: ModelSelection | null;
  done: Done | null;
  closeAcknowledged: boolean;
  failure: SolverNonResult | null;
  failureNotified(): void;
  timer: ReturnType<typeof setTimeout> | null;
  /** The silence wall of the active turn: armed with each permit, restarted by every message of
   *  that turn and cleared at its end. It runs independently of the whole-solve timer, because a
   *  worker can be silent without being out of time and out of time without being silent. */
  turnTimer: ReturnType<typeof setTimeout> | null;
  /** A worker the whole-solve wall stopped after it had called a tool was still answering, since
   *  the silence wall had not fired, so its case is an unaccepted attempt with its traced calls.
   *  One that never reached the tool loop stays a non-result. */
  calledTool: boolean;
  /** Tool calls run in this process rather than in the worker's group, so a stop aborts them and
   *  settlement waits for them: the wall's submit and the generated worker's close therefore follow
   *  the last call that could still write. */
  dispatches: Set<Promise<void>>;
  toolAbort: AbortController;
  turnWallMs: number;
  readyWallMs: number;
  solveWallMs: number | null;
  /** The OS isolation mechanism, which is what tells the confined-pid witness how the spawned pid
   *  relates to the pid the worker reports for itself: identical under Seatbelt, which exec-replaces
   *  the process, and a private pid namespace beneath the wrapper under bubblewrap. */
  mechanismId: string;
  turnReservations: Map<number, ProviderTurnReservation>;
  nextPermitTurn: number;
  activeTurn: number | null;
}

interface WorkerResources {
  stdoutDone: Promise<void>;
  stderrDone: Promise<void>;
  releaseResources(reason: Error): void;
}

/** Everything a worker's line is read against. It is fixed for the worker's whole life, so the
 *  reader takes it once and each line then supplies only itself. */
type WorkerBinding = {
  readonly child: PiChild;
  readonly write: (message: PiWire.PiBuiltParentMessage, end?: boolean) => void;
  readonly state: WorkerState;
  readonly request: PiWire.PiBuiltStart;
  readonly tools: ReadonlyMap<string, AgentTool>;
  readonly onMessage: (message: Forwarded) => void;
  readonly reserveTurn: ((turn: number) => ProviderTurnReservation) | undefined;
};

interface WorkerCompletion {
  child: PiChild;
  state: WorkerState;
  runtime: PiBuiltRuntime;
  bundle: PiBuiltWorkerBundle;
  workerInstanceId: string;
  conditionDigest: string;
  stdoutDone: Promise<void>;
  stderrDone: Promise<void>;
  failure: Promise<void>;
  releaseResources(reason: Error): void;
  resolve: (value: PiBuiltWorkerResult) => void;
  reject: (reason: Error) => void;
}

/** One worker opening: the confined runtime, the bundle it runs, the start request and the
 *  controller's three hooks into its life. */
type PiBuiltWorkerOpening = {
  readonly runtime: PiBuiltRuntime;
  readonly bundle: PiBuiltWorkerBundle;
  readonly start: Omit<PiWire.PiBuiltStart, "workerInstanceId">;
  readonly conditionDigest: string;
  readonly tools: ReadonlyMap<string, AgentTool>;
  readonly onMessage: (message: Forwarded) => void;
  // Absent and `undefined` mean the same thing for a call record, so both spellings are accepted
  // rather than making every caller reach for `keyIfDefined`.
  readonly reserveTurn?: ((turn: number) => ProviderTurnReservation) | undefined;
  readonly signal?: AbortSignal | undefined;
};

export class PiBuiltWorkerNonResult extends Error {
  constructor(
    readonly kind: SolverNonResult["kind"],
    message: string,
    readonly modelWorker: BuiltRuntimeBoundaryEvidence["modelWorker"],
    /** The whole-solve wall ended a worker that was still answering inside its silence wall. */
    readonly solveTimeExhausted = false,
  ) {
    super(message);
  }
}

/** The longest a permitted turn may stay silent: one model call plus one shell command at its
 *  ceiling. Every worker message restarts it, so it catches a stalled provider or worker, not a
 *  solver still working. Without it a provider stall on turn one holds the case for the whole solve
 *  wall and records an hour of nothing. Measuring silence rather than the turn is the other half:
 *  a wall on the whole turn cuts a solver that has made a dozen traced tool calls inside one native
 *  turn and records it as a runtime non-result, which calls a working solver an environment
 *  failure. */
export const builtTurnWallMs = (shellMaxSeconds: number): number => TURN_TIMEOUT_MS + shellMaxSeconds * 1000;

function dispatchTool(
  write: (message: PiWire.PiBuiltParentMessage, end?: boolean) => void,
  tools: ReadonlyMap<string, AgentTool>,
  message: Extract<PiWire.PiBuiltChildMessage, { type: "tool_call" }>,
  signal: AbortSignal,
): Promise<void> {
  return Promise.resolve()
    .then(async () => {
      const tool = tools.get(message.name);
      if (!tool) throw new Error("unknown tool");
      const result = await tool.execute(message.id, message.arguments, signal);
      write({ type: "tool_result", id: message.id, ok: true, result });
    })
    .catch((error) => {
      if (error instanceof GeneratedToolWorkerNonResult) throw error;
      write({
        type: "tool_result",
        id: message.id,
        ok: false,
        error: boundText(errorMessage(error), 800).shown,
      });
    });
}

function modelSelectionMatches(
  start: PiWire.PiBuiltStart,
  selection: Extract<PiWire.PiBuiltChildMessage, { type: "ready" }>["modelSelection"],
): boolean {
  // The source proves which path the child took, not how complete a catalogue was: a live turn
  // may resolve a slug the Pi catalogue does not list, but it may never come from the faux
  // provider, and a faked turn may never come from a live one.
  const live: readonly string[] =
    start.profile.provider === "openrouter"
      ? [MODEL_CATALOGUE_SOURCES.pi, MODEL_CATALOGUE_SOURCES.piUnlisted]
      : [MODEL_CATALOGUE_SOURCES.pi];
  const requestedPin = start.profile.providerPin;
  const receivedPin = selection.providerPin;
  const providerMatches =
    requestedPin === undefined
      ? receivedPin === undefined
      : receivedPin !== undefined &&
        requestedPin.length === receivedPin.length &&
        requestedPin.every((slug, index) => slug === receivedPin[index]);
  return (
    (start.fakeResponses === undefined
      ? live.includes(selection.source)
      : selection.source === MODEL_CATALOGUE_SOURCES.faux) &&
    selection.resolvedModel === start.profile.model &&
    selection.effort === start.profile.thinkingLevel &&
    providerMatches &&
    selection.resolvedModel.length > 0
  );
}

function killWorkerProcesses(child: PiChild, state: WorkerState, signal: RuntimeSignal): void {
  killProcessGroup(child, signal);
  // Bubblewrap's --new-session puts its witnessed direct worker below the detached wrapper group,
  // so the wrapper's group alone would leave it running. That ready pid is controller-admitted, so
  // this is a second exact group identity rather than a search for processes that look related.
  if (state.pid !== null && state.pid !== child.pid) killProcessGroupId(state.pid, signal);
}

function stopWorker(
  child: PiChild,
  state: WorkerState,
  kind: SolverNonResult["kind"],
  message: string,
): void {
  if (state.failure === null) {
    state.failure = { kind, message };
    state.failureNotified();
  }
  state.toolAbort.abort();
  killWorkerProcesses(child, state, "SIGTERM");
}

async function settlesWithin(work: Promise<unknown>, milliseconds: number): Promise<boolean> {
  const timeout = Promise.withResolvers<boolean>();
  const timer = setTimeout(() => timeout.resolve(false), milliseconds);
  const observed = work.then(
    () => true,
    () => true,
  );
  try {
    return await Promise.race([observed, timeout.promise]);
  } finally {
    clearTimeout(timer);
  }
}

function ownWorkerResources(child: PiChild, onLine: (line: string) => void): WorkerResources {
  const stdout = cancellableByteStream(child.stdout);
  const stderr = cancellableByteStream(child.stderr);
  const endInput = child.stdin.end.bind(child.stdin);
  let released = false;
  const releaseResources = (reason: Error): void => {
    if (released) return;
    released = true;
    stdout.cancel(reason);
    stderr.cancel(reason);
    try {
      void Promise.resolve(endInput()).catch(() => {});
    } catch {
      // stdin may already be closed
    }
    try {
      child.stdin.unref();
    } catch {
      // stdin may already be closed
    }
    try {
      child.unref();
    } catch {
      // the child may already have exited
    }
  };
  const stdoutDone = attachJsonlLineReader(stdout.stream, onLine);
  const stderrWriter = Bun.stderr.writer();
  const stderrDone = (async () => {
    for await (const chunk of stderr.stream) await stderrWriter.write(chunk);
    await stderrWriter.flush();
  })();
  return { stdoutDone, stderrDone, releaseResources };
}

function clearTurnTimer(state: WorkerState): void {
  if (state.turnTimer !== null) clearTimeout(state.turnTimer);
  state.turnTimer = null;
}

function variantTimer(child: PiChild, state: WorkerState, milliseconds: number, message: string): void {
  if (state.timer !== null) clearTimeout(state.timer);
  state.timer = setTimeout(() => stopWorker(child, state, "runtime", message), milliseconds);
}

/** Any message of the active turn shows the worker is still answering, so the silence wall starts
 *  over. Both halves of the guard matter: without an active turn there is no wall to restart, and
 *  without a live timer the turn has already ended. */
function restartTurnSilence(child: PiChild, state: WorkerState): void {
  if (state.activeTurn !== null && state.turnTimer !== null) armTurnTimer(child, state, state.activeTurn);
}

function armTurnTimer(child: PiChild, state: WorkerState, turn: number): void {
  clearTurnTimer(state);
  state.turnTimer = setTimeout(
    () =>
      stopWorker(
        child,
        state,
        "runtime",
        `Pi Built worker was silent past its bounded turn time on turn ${turn}`,
      ),
    state.turnWallMs,
  );
}

/** The worker's ready evidence must name this start's identity, prompt and tool contract and
 *  the selected model; a mismatch stops the worker before any solve data is accepted. */
function acceptReady(child: PiChild, state: WorkerState, request: PiWire.PiBuiltStart, message: Ready): void {
  const confinedPid = witnessConfinedChild(message.pid, child.pid, state.mechanismId);
  const identityMatches =
    state.phase === "opening" &&
    message.workerInstanceId === request.workerInstanceId &&
    confinedPid !== null;
  const contractMatches =
    message.promptDigest === request.contract.promptDigest &&
    message.toolSchemaDigest === request.contract.toolSchemaDigest;
  if (!identityMatches || !contractMatches || !modelSelectionMatches(request, message.modelSelection)) {
    stopWorker(
      child,
      state,
      identityMatches ? "protocol" : "sandbox",
      "Pi Built worker ready evidence did not match",
    );
    return;
  }
  state.phase = "running";
  state.pid = confinedPid;
  state.modelSelection = message.modelSelection;
  variantTimer(
    child,
    state,
    state.solveWallMs ?? (request.maxTurns === 0 ? state.readyWallMs : DEFAULT_HARNESS_SETTINGS.solveMs),
    SOLVE_WALL_MESSAGE,
  );
}

/** Permits are granted in order, one active turn at a time; a provider reservation, when the
 *  host asked for one, is opened before the permit is written. */
function grantTurnPermit(
  child: PiChild,
  write: (message: PiWire.PiBuiltParentMessage, end?: boolean) => void,
  state: WorkerState,
  reserveTurn: ((turn: number) => ProviderTurnReservation) | undefined,
  message: PermitRequest,
): void {
  if (state.phase !== "running" || state.activeTurn !== null || message.turn !== state.nextPermitTurn) {
    stopWorker(child, state, "protocol", "Pi Built worker requested an unordered turn permit");
    return;
  }
  try {
    const reservation = reserveTurn?.(message.turn);
    if (reservation !== undefined) {
      reservation.beginProviderTurn();
      state.turnReservations.set(message.turn, reservation);
    }
    state.activeTurn = message.turn;
    state.nextPermitTurn += 1;
    write({ type: "turn_permit", turn: message.turn });
    armTurnTimer(child, state, message.turn);
  } catch (error) {
    stopWorker(child, state, "provider", errorMessage(error));
  }
}

function receiveWorkerMessage(binding: WorkerBinding, message: PiWire.PiBuiltChildMessage): void {
  const { child, write, state, request, tools, onMessage, reserveTurn } = binding;
  if (message.type === "ready") {
    acceptReady(child, state, request, message);
    return;
  }
  restartTurnSilence(child, state);
  if (message.type === "tool_call") {
    if (state.phase !== "running") {
      stopWorker(child, state, "protocol", "Pi Built worker called a tool outside solve");
      return;
    }
    state.calledTool = true;
    const dispatch = dispatchTool(write, tools, message, state.toolAbort.signal)
      .catch((error) =>
        stopWorker(
          child,
          state,
          error instanceof GeneratedToolWorkerNonResult ? error.kind : "runtime",
          errorMessage(error),
        ),
      )
      .finally(() => state.dispatches.delete(dispatch));
    state.dispatches.add(dispatch);
    return;
  }
  if (message.type === "turn_permit_request") {
    grantTurnPermit(child, write, state, reserveTurn, message);
    return;
  }
  if (message.type === "done") {
    if (state.phase !== "running" || state.done !== null || state.activeTurn !== null) {
      stopWorker(child, state, "protocol", "Pi Built worker finished without one ordered ready");
      return;
    }
    state.done = message;
    state.phase = "closing";
    variantTimer(child, state, CLOSE_TIMEOUT_MS, "Pi Built worker did not close after completion");
    write({ type: "close" }, true);
    return;
  }
  if (message.type === "closing") {
    if (state.phase !== "closing" || state.closeAcknowledged) {
      stopWorker(child, state, "protocol", "Pi Built worker emitted an unordered close acknowledgement");
      return;
    }
    state.closeAcknowledged = true;
    return;
  }
  if (message.type === "fatal") {
    stopWorker(child, state, message.kind, `Pi Built worker failed: ${message.error}`);
    return;
  }
  if (state.phase !== "running") {
    stopWorker(child, state, "protocol", "Pi Built worker emitted solve data before ready");
    return;
  }
  if (message.type === "turn_start" && state.activeTurn !== message.turn) {
    stopWorker(child, state, "protocol", "Pi Built worker started a turn without its host permit");
    return;
  }
  if (message.type === "turn_end") {
    const reservation = state.turnReservations.get(message.turn);
    if (state.activeTurn !== message.turn || (reserveTurn !== undefined && reservation === undefined)) {
      stopWorker(child, state, "protocol", "Pi Built worker ended a turn without a host permit");
      return;
    }
    reservation?.complete(message.usage);
    state.turnReservations.delete(message.turn);
    state.activeTurn = null;
    clearTurnTimer(state);
  }
  onMessage(message);
}

function settleWorker(input: WorkerCompletion, code: number | null): void {
  const { child, state, runtime, bundle, workerInstanceId, conditionDigest, resolve, reject } = input;
  if (state.timer !== null) clearTimeout(state.timer);
  clearTurnTimer(state);
  for (const reservation of state.turnReservations.values()) reservation.complete();
  state.turnReservations.clear();
  state.activeTurn = null;
  const finalFailure =
    state.failure ??
    (state.phase !== "closing" || !state.closeAcknowledged || state.done === null || code !== 0
      ? {
          kind: "runtime" as const,
          message: `Pi Built worker exited before normal settlement (${String(code)})`,
        }
      : null);
  const exhausted = state.calledTool && state.failure?.message === SOLVE_WALL_MESSAGE;
  const modelWorker: BuiltRuntimeBoundaryEvidence["modelWorker"] = {
    workerInstanceId,
    conditionDigest,
    confinedPid: state.pid ?? child.pid,
    controllerPid: runtimeProcess.pid,
    workingDirectory: bundle.dir,
    policyHash: runtime.policy.policyHash,
    bundleDigest: bundle.digest,
    modelSelection: state.modelSelection,
    termination:
      finalFailure === null
        ? { status: "normal" }
        : exhausted
          ? { status: "solve-wall", message: finalFailure.message }
          : { status: "non-result", kind: finalFailure.kind, message: finalFailure.message },
  };
  if (finalFailure === null && state.done !== null) resolve({ done: state.done, modelWorker });
  else {
    const failed = finalFailure ?? { kind: "runtime" as const, message: "Pi Built worker failed" };
    reject(new PiBuiltWorkerNonResult(failed.kind, failed.message, modelWorker, exhausted));
  }
}

async function reapAndSettle(input: WorkerCompletion, code: number | null): Promise<void> {
  input.releaseResources(new Error("Pi Built worker reached terminal settlement"));
  input.state.toolAbort.abort();
  await settlesWithin(Promise.allSettled(input.state.dispatches), DISPATCH_SETTLE_MS);
  const workerGroup =
    input.state.pid === null || input.state.pid === input.child.pid
      ? Promise.resolve(true)
      : terminateAndReapProcessGroupId(input.state.pid);
  const reaped = await Promise.all([terminateAndReapProcessGroup(input.child), workerGroup])
    .then((results) => results.every(Boolean))
    .catch(() => false);
  if (!reaped && input.state.failure === null) {
    input.state.failure = {
      kind: "runtime",
      message: "Pi Built worker process group could not be reaped",
    };
  }
  settleWorker(input, code);
}

function bindWorkerCompletion(input: WorkerCompletion): void {
  const { child, state } = input;
  const completion = Promise.all([child.exited, input.stdoutDone, input.stderrDone]).then(
    ([code]) => ({ status: "settled" as const, code }),
    (error) => ({ status: "stream-error" as const, error: asError(error) }),
  );
  let finished = false;
  const finish = (code: number | null): void => {
    if (finished) return;
    finished = true;
    void reapAndSettle(input, code).catch((error) =>
      input.reject(new Error("Pi Built worker settlement failed", { cause: error })),
    );
  };
  void completion
    .then((result) => {
      if (result.status === "settled") return finish(result.code);
      stopWorker(child, state, "runtime", `Pi Built worker stream failed: ${errorMessage(result.error)}`);
    })
    .catch(() => finish(child.exitCode));
  void child.exited
    .then(async (code) => {
      if (state.timer !== null) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      if ((await settlesWithin(completion, CLOSE_TIMEOUT_MS)) || finished) return;
      stopWorker(child, state, "runtime", "Pi Built worker streams did not settle after exit");
      finish(code);
    })
    .catch((error) => {
      stopWorker(child, state, "runtime", `Pi Built worker exit failed: ${errorMessage(error)}`);
    });
  void input.failure
    .then(async () => {
      if (finished) return;
      if (await settlesWithin(child.exited, CLOSE_TIMEOUT_MS)) return finish(child.exitCode);
      killWorkerProcesses(child, state, "SIGKILL");
      await settlesWithin(child.exited, CLOSE_TIMEOUT_MS);
      finish(child.exitCode);
    })
    .catch(() => finish(child.exitCode));
}

export function startPiBuiltWorker(opening: PiBuiltWorkerOpening): Promise<PiBuiltWorkerResult> {
  const { runtime, bundle, start, conditionDigest, tools, onMessage, reserveTurn, signal } = opening;
  signal?.throwIfAborted();
  const workerInstanceId = crypto.randomUUID();
  const request: PiWire.PiBuiltStart = { ...start, workerInstanceId };
  const child = spawnUnderSolveIsolation(runtime.policy, {
    command: runtimeProcess.execPath,
    args: [bundle.file],
    cwd: bundle.dir,
    env: {},
  });
  let onAbort: (() => void) | undefined;
  return new Promise<PiBuiltWorkerResult>((resolve, reject) => {
    const failureSignal = Promise.withResolvers<void>();
    const state: WorkerState = {
      phase: "opening",
      pid: null,
      modelSelection: null,
      done: null,
      closeAcknowledged: false,
      failure: null,
      failureNotified: () => failureSignal.resolve(),
      timer: null,
      turnTimer: null,
      calledTool: false,
      dispatches: new Set(),
      toolAbort: new AbortController(),
      turnWallMs: runtime.turnWallMs ?? builtTurnWallMs(DEFAULT_HARNESS_SETTINGS.shellMaxSeconds),
      readyWallMs: runtime.readyWallMs ?? READY_TIMEOUT_MS,
      solveWallMs: runtime.solveWallMs ?? null,
      mechanismId: runtime.policy.mechanismId,
      turnReservations: new Map(),
      nextPermitTurn: 1,
      activeTurn: null,
    };
    let writeTail: Promise<void> = Promise.resolve();
    const write = (message: PiWire.PiBuiltParentMessage, end = false): void => {
      const pending = writeTail.then(async () => {
        await child.stdin.write(serializeJsonLine(message));
        if (end) await child.stdin.end();
      });
      writeTail = pending.catch((error) =>
        stopWorker(child, state, "runtime", `Pi Built worker stdin failed: ${errorMessage(error)}`),
      );
    };
    variantTimer(child, state, state.readyWallMs, "Pi Built worker timed out before its ready handshake");
    const resources = ownWorkerResources(child, (line) => {
      try {
        receiveWorkerMessage(
          { child, write, state, request, tools, onMessage, reserveTurn },
          parseJsonAs<PiWire.PiBuiltChildMessage>(line),
        );
      } catch {
        stopWorker(child, state, "protocol", "Pi Built worker emitted malformed JSONL");
      }
    });
    bindWorkerCompletion({
      child,
      state,
      runtime,
      bundle,
      workerInstanceId,
      conditionDigest,
      ...resources,
      failure: failureSignal.promise,
      resolve,
      reject,
    });
    onAbort = () => stopWorker(child, state, "runtime", "controller cancelled the Built worker");
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted === true) onAbort();
    write(request);
  }).finally(() => {
    if (onAbort !== undefined) signal?.removeEventListener("abort", onAbort);
  });
}

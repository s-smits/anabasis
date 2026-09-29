/** Generated evaluation never shares the controller event loop, globals or filesystem grants. */
import { keyIfDefined } from "../meta/optional-key.ts";
import { attachJsonlLineReader } from "../../vendor/pi-built/jsonl.ts";
import { capturedJsonParse, capturedJsonStringify, hashJsonBytes } from "../meta/json-runtime.ts";
import { isNumber, isRecord, isString, type JsonValue } from "../meta/json-shape.ts";
import { sha256OfFile } from "../meta/digest.ts";
import { runtimeProcess } from "../meta/process.ts";
import { killProcessGroup } from "../meta/subprocess.ts";
import { witnessConfinedChild } from "../verify/os-isolation.ts";
import {
  assertGeneratedWorkerPolicyUnchanged,
  generatedWorkerPolicy,
} from "../solve/generated-tool-source-policy.ts";
import type { ToolRunRequest, VerifierRuntime } from "../verify/verifier-port.ts";
import { TOOL_TIMEOUT_CEILING_MS } from "../verify/host.ts";
import { VerifierContractError } from "../../vendor/correctness-model-bundle/contract-error.ts";
import type { EvaluationRequest } from "./correctness-model-contract.ts";
import { bundleEvaluator, retainEvaluatorBundle, type EvaluatorBundle } from "./evaluator-process-bundle.ts";
import {
  EVALUATOR_DETAIL_MAX_BYTES,
  EVALUATOR_FRAME_MAX_BYTES as FRAME_MAX_BYTES,
  type EvaluatorParentMessage,
} from "./evaluator-process-wire.ts";
import {
  superviseVerifierProcess,
  VerifierOperationalStop,
  type VerifierLifetime,
} from "../verify/verifier-lifetime.ts";
import { launchConfinedChild } from "../verify/verifier-lifetime-process.ts";
import { boundText } from "../meta/bounded-text.ts";

type Request =
  | { mode: "probe"; checkIds: readonly string[] }
  | { mode: "evaluate"; checkId: string; request: EvaluationRequest; runtime: boolean };
type Response = { missing: readonly string[] } | { result: boolean };
type Child = Bun.Subprocess<"pipe", "pipe", "pipe">;
/** Time limit for one complete check, including its tool runs. It exceeds the tool limit because
 *  at `TOOL_TIMEOUT_CEILING_MS` for both, a check that ran one tool at the published maximum could
 *  never complete — its own wall expires at the instant the tool is still entitled to run.
 *  starter-pack/contract.md publishes both numbers together, so the agent can see that the second
 *  leaves room for the first. */
export const EVALUATOR_WALL_MS = 2 * TOOL_TIMEOUT_CEILING_MS;

/** The host side of one check: the tool port it may call, its wall, the lifetime that owns its
 *  children and the controller's cancellation. Each has a standing default. */
type EvaluatorHost = {
  readonly runtime?: VerifierRuntime | undefined;
  readonly timeoutMs?: number | undefined;
  readonly lifetime?: VerifierLifetime | undefined;
  readonly signal?: AbortSignal | undefined;
};

/** How one evaluator child is wired to its parent: the mechanism it was opened under, the tool
 *  port it may call and the two ends of the parent's channel. */
type ReceiverWiring = {
  readonly mechanism: string;
  readonly runtime: VerifierRuntime | undefined;
  readonly send: (row: EvaluatorParentMessage) => void;
  readonly finish: (value: Response | Error) => void;
};

/** The host controls one invocation actually runs under: `EvaluatorHost` once its wall default
 *  has been applied. */
type EvaluatorInvocation = EvaluatorHost & { readonly timeoutMs: number };

const children = new Set<Child>();

export class EvaluatorProcessFailure extends Error {
  constructor(
    readonly kind: "timeout" | "crash" | "protocol" | "sandbox" | "generated" | "pending",
    detail: string,
  ) {
    super(`generated evaluator ${kind}: ${detail}`);
    this.name = "EvaluatorProcessFailure";
  }
}

/** Whether a caught cause is the environment refusing rather than the generated module answering.
 *  The lifetime's own stop and a sandbox failure both say the host could not run the check, so a
 *  caller that turns a throw into a typed finding has to let these two past first or it records a
 *  load verdict for a check that never ran. */
export function evaluatorEnvironmentStop(cause: unknown): boolean {
  return (
    cause instanceof VerifierOperationalStop ||
    (cause instanceof EvaluatorProcessFailure && cause.kind === "sandbox")
  );
}

/** Only trusted refusals and observed abandoned calls override a recorded host outage.
 *  A generic child error can be a consequence of that outage. */
export function isAuthoredEvaluatorFailure(error: unknown): boolean {
  return (
    error instanceof VerifierContractError ||
    (error instanceof EvaluatorProcessFailure && error.kind === "pending")
  );
}

runtimeProcess.once("exit", () => {
  for (const child of children) killProcessGroup(child, "SIGKILL");
});

/** Parse the wire shape once. The existing host still owns ids, paths, bytes and timeout policy. */
function toolRequest(value: unknown): ToolRunRequest {
  if (
    !isRecord(value) ||
    !isString(value.toolId) ||
    !isString(value.checkId) ||
    (value.args !== undefined && (!Array.isArray(value.args) || !value.args.every(isString))) ||
    (value.files !== undefined && (!isRecord(value.files) || !Object.values(value.files).every(isString))) ||
    (value.stdin !== undefined && !isString(value.stdin)) ||
    (value.timeoutMs !== undefined && !isNumber(value.timeoutMs))
  ) {
    throw new VerifierContractError("verifier-tool-request", "malformed tool request");
  }
  const request: ToolRunRequest = {
    toolId: value.toolId,
    checkId: value.checkId,
    ...keyIfDefined("args", value.args),
  };
  if (value.files !== undefined) {
    // SAFETY: the files record and every string value were checked above.
    request.files = value.files as Record<string, string>;
  }
  if (value.stdin !== undefined) request.stdin = value.stdin;
  if (value.timeoutMs !== undefined) request.timeoutMs = value.timeoutMs;
  return request;
}

export async function probeEvaluatorProcess(
  slugDir: string,
  checkIds: readonly string[],
  timeoutMs = 30_000,
  lifetime?: VerifierLifetime,
): Promise<readonly string[]> {
  const response = await invoke(
    await bundleEvaluator(slugDir),
    { mode: "probe", checkIds },
    {
      timeoutMs,
      lifetime,
    },
  );
  if (!("missing" in response)) throw new EvaluatorProcessFailure("protocol", "probe returned an evaluation");
  return response.missing;
}

export async function evaluateIsolated(
  bundle: EvaluatorBundle,
  checkId: string,
  request: EvaluationRequest,
  host: EvaluatorHost = {},
): Promise<boolean> {
  const { runtime, lifetime, signal } = host;
  const timeoutMs = host.timeoutMs ?? EVALUATOR_WALL_MS;
  const response = await invoke(
    bundle,
    { mode: "evaluate", checkId, request, runtime: runtime !== undefined },
    { runtime, timeoutMs, lifetime, signal },
  );
  if (!("result" in response)) {
    throw new EvaluatorProcessFailure("generated", `missing exports: ${response.missing.join(", ")}`);
  }
  return response.result;
}

/** The child proves its confined pid before the parent trusts a single message from it. This lives
 *  apart from its one caller because inlining the guard would put three more branches into the
 *  message handler below, which already measures 21 against the `CYCLOMATIC_CEILING` of 21 in
 *  `tools/loc/complexity-policy.ts`. */
function proveReady(kind: JsonValue | undefined, pid: unknown, child: Child, mechanism: string): void {
  if (kind !== "ready" || !isNumber(pid) || witnessConfinedChild(pid, child.pid, mechanism) === null) {
    throw new EvaluatorProcessFailure("sandbox", "child did not prove its confined pid");
  }
}

/** A throw with a tool still outstanding is the same abandonment as a return with one, and the
 *  parent's counter decides that, not the child's text, which may say anything. Reporting it as
 *  `pending` is what keeps an unawaited call attributed to its author: `isAuthoredEvaluatorFailure`
 *  admits exactly the contract errors and this kind, so every other child error yields to the
 *  host-outage precedence in control settlement and this one does not. */
function childErrorFailure(detail: unknown, pendingTools: number, request: Request): EvaluatorProcessFailure {
  if (pendingTools > 0) return new EvaluatorProcessFailure("pending", "threw with pending tool invocations");
  const check = request.mode === "evaluate" ? `check "${request.checkId}" ` : "";
  return new EvaluatorProcessFailure(
    "generated",
    check + (isString(detail) ? boundText(detail, EVALUATOR_DETAIL_MAX_BYTES).shown : "child refused"),
  );
}

function receiver(child: Child, request: Request, wiring: ReceiverWiring): (line: string) => void {
  const { mechanism, runtime, send, finish } = wiring;
  let ready = false;
  let nextToolId = 1;
  let pendingTools = 0;
  return (line: string): void => {
    try {
      const row: unknown = capturedJsonParse(line);
      if (!isRecord(row)) throw new Error("frame is not an object");
      if (!ready) {
        proveReady(row.type, row.pid, child, mechanism);
        ready = true;
        send({ type: "begin" });
        return;
      }
      // Every post-load frame is untrusted. Only the parent's host creates tool evidence;
      // fabricated stdout cannot establish a tool execution or erase a pending invocation.
      if (row.type === "error") {
        finish(childErrorFailure(row.detail, pendingTools, request));
        return;
      }
      if (row.type === "exports" && Array.isArray(row.missing) && row.missing.every(isString)) {
        finish({ missing: row.missing });
      } else if (row.type === "result" && request.mode === "evaluate") {
        if (pendingTools > 0) {
          // Close the scope before the fast tool finishes, so the detached run cannot bind.
          runtime?.tools.abandon();
          throw new EvaluatorProcessFailure("pending", "returned with pending tool invocations");
        }
        if (row.result !== true && row.result !== false) {
          throw new EvaluatorProcessFailure("protocol", "check returned a non-boolean result");
        }
        finish({ result: row.result });
      } else if (
        row.type === "tool" &&
        request.mode === "evaluate" &&
        row.id === nextToolId++ &&
        runtime !== undefined
      ) {
        const { id } = row;
        const call = toolRequest(row.request);
        if (call.checkId !== request.checkId) {
          throw new VerifierContractError("verifier-tool-binding", "tool request crossed check identity");
        }
        pendingTools += 1;
        void runtime.tools
          .run(call)
          .then(
            (value) => {
              pendingTools -= 1;
              send({ type: "tool-result", id, result: value });
            },
            (error) => {
              pendingTools -= 1;
              // Preserve the parent's trusted type without a round trip through generated code.
              // A candidate cannot catch, forge or relabel this contract refusal.
              if (error instanceof VerifierContractError) {
                finish(error);
                return;
              }
              send({
                type: "tool-result",
                id,
                error: error instanceof Error ? error.message : "host refused the tool request",
              });
            },
          )
          .catch(finish);
      } else throw new Error("unexpected frame");
    } catch (error) {
      finish(
        error instanceof EvaluatorProcessFailure || error instanceof VerifierContractError
          ? error
          : new EvaluatorProcessFailure("protocol", "malformed child frame"),
      );
    }
  };
}

function openEvaluator(bundle: EvaluatorBundle, request: Request, lifetime: VerifierLifetime | undefined) {
  if (lifetime === undefined) throw new VerifierOperationalStop("no-lifetime", []);
  lifetime.assertUsable();
  if (sha256OfFile(bundle.file) !== bundle.digest) {
    throw new EvaluatorProcessFailure("sandbox", "bundle bytes changed");
  }
  const policy = generatedWorkerPolicy(bundle);
  const lease = lifetime.begin({
    role: "evaluator",
    cell: bundle.dir,
    requestDigest: hashJsonBytes(request),
  });
  // The host could not start the child: an environment non-result, never a module-load verdict.
  const launched = launchConfinedChild(
    lease,
    policy,
    bundle,
    (message) => new EvaluatorProcessFailure("sandbox", `could not start: ${message}`),
  );
  children.add(launched.child);
  return { ...launched, policy, lease };
}

async function invoke(
  bundle: EvaluatorBundle,
  request: Request,
  host: EvaluatorInvocation,
): Promise<Response> {
  const { runtime, timeoutMs, lifetime, signal } = host;
  signal?.throwIfAborted();
  const { child, output, errors, policy, lease } = openEvaluator(bundle, request, lifetime);
  const result = Promise.withResolvers<Response>();
  void result.promise.catch(() => {});
  let settled = false;
  const finish = (value: Response | Error): void => {
    if (settled) return;
    settled = true;
    void supervision.stop().catch(() => {});
    if (value instanceof Error) result.reject(value);
    else result.resolve(value);
  };
  const send = (row: EvaluatorParentMessage): void => {
    if (settled) return;
    const line = capturedJsonStringify(row) + "\n";
    if (Buffer.byteLength(line) > FRAME_MAX_BYTES) {
      finish(new EvaluatorProcessFailure("protocol", "parent frame exceeded byte limit"));
      return;
    }
    try {
      void Promise.resolve(child.stdin.write(line)).catch(finish);
      void Promise.resolve(child.stdin.flush()).catch(finish);
    } catch {
      finish(new EvaluatorProcessFailure("protocol", "child input closed"));
    }
  };
  const receive = receiver(child, request, { mechanism: policy.mechanismId, runtime, send, finish });
  const stdout = attachJsonlLineReader(
    output.stream,
    (line) => {
      if (!settled) receive(line);
    },
    FRAME_MAX_BYTES,
  );
  const stderr = (async () => {
    let bytes = 0;
    for await (const chunk of errors.stream) {
      bytes += chunk.byteLength;
      if (bytes > FRAME_MAX_BYTES) {
        throw new EvaluatorProcessFailure("protocol", "diagnostic output exceeded byte limit");
      }
    }
  })();
  const supervision = superviseVerifierProcess(
    child,
    lease,
    {
      drained: Promise.all([stdout, stderr]),
      cancel: () => {
        output.cancel();
        errors.cancel();
      },
    },
    timeoutMs,
    () => finish(new EvaluatorProcessFailure("timeout", "exceeded " + timeoutMs + "ms")),
  );
  const abort = () => finish(new EvaluatorProcessFailure("timeout", "evaluation cancelled"));
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted === true) abort();
  void stdout.catch(finish);
  void stderr.catch(finish);
  void supervision.done
    .then(() => {
      if (!settled) finish(new EvaluatorProcessFailure("crash", "child exited without a complete response"));
    })
    .catch(finish);
  try {
    lease.spawned(child.pid);
    send({ type: "start", ...request });
    const response = await result.promise;
    assertGeneratedWorkerPolicyUnchanged(policy);
    return response;
  } finally {
    signal?.removeEventListener("abort", abort);
    const observed = await supervision.stop().catch((error) => {
      retainEvaluatorBundle(bundle.dir);
      throw error;
    });
    if (!observed.groupReaped) {
      retainEvaluatorBundle(bundle.dir);
      // Cleanup uncertainty must override even a valid response or a candidate failure.
      // eslint-disable-next-line no-unsafe-finally
      throw new VerifierOperationalStop("unsettled-children", [lease.id]);
    }
    children.delete(child);
  }
}

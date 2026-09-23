/**
 * The F2 reference-solve stage: run the generated public reference package for one public task under
 * the generated-worker wall and report what it produced. The stage reads exactly the portable
 * reference bundle digest, the confined runtime identity, the canonical public request and the wall
 * and output constants below, and its settled product outcomes are remembered under that key
 * (solvability-stages.ts) — so a repeated gate call reuses a solve only when every one of those
 * inputs is the same. Reference artifacts remain protected evidence throughout.
 */

import { errorCode, errorMessage } from "../meta/runtime-values.ts";
import { harnessSettings } from "./harness-config.ts";
import { cancellableByteStream } from "../meta/cancellable-stream.ts";
import { sha256, sha256OfFile } from "../meta/digest.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { isObject, type JsonValue } from "../meta/json-shape.ts";
import { witnessConfinedChild } from "../verify/os-isolation.ts";
import {
  assertGeneratedWorkerPolicyUnchanged,
  generatedWorkerPolicy,
  type GeneratedWorkerPolicy,
} from "../solve/generated-tool-source-policy.ts";
import {
  type VerifierLifetime,
  type VerifierProcessLease,
  VerifierOperationalStop,
  settleUnspawned,
  superviseVerifierProcess,
} from "../verify/verifier-lifetime.ts";
import {
  bundleReferenceSolve,
  retainEvaluatorBundle,
  type EvaluatorBundle,
} from "./evaluator-process-bundle.ts";
import {
  type SolvabilityStageMemory,
  type SolvabilityStageReceipt,
  throughStage,
} from "./solvability-stages.ts";
import type { GeneratedSolveFailureKind } from "./brief.ts";
import type { PublicTask } from "./task-split.ts";
import {
  trustedExecPath,
  trustedJsonParse,
  trustedJsonStringify,
  trustedSpawn as spawn,
  trustedStructuredClone,
} from "./trusted-runtime.ts";
import { REFERENCE_SOLVE_PROTOCOL, REFERENCE_SOLVE_READY } from "./reference-solve-wire.ts";

const REFERENCE_SOLVE_STDOUT_MAX = 1_048_576;
const REFERENCE_SOLVE_STDERR_MAX = 65_536;
/** Bump when the stage's reading of a child changes, so no earlier result answers the new rule. */
const REFERENCE_SOLVE_STAGE = "reference-solve-stage/v1";
const REFERENCE_SOLVE_TIMEOUT_ERROR = /^reference solve child exceeded \d+ms$/;

/** The generated-solve kinds plus the one the host owns. A controller deadline reached before the
 *  worker was ready or closed is the host's, because the clock says nothing about the bytes, while a
 *  worker that answered and then broke its protocol is the candidate's. */
type ReferenceSolveFailureKind = GeneratedSolveFailureKind | "reference-solve-host";

/** One bounded stream read: the bytes kept, and whether the child wrote past its cap. */
interface CappedRead {
  bytes: ArrayBuffer;
  overflow: boolean;
}

/** Everything the host observed about one finished reference-solve child, kept separate from the
 *  reading of it, so that classification works from the observations rather than re-deriving them. */
interface ReferenceSolveChildOutput {
  ready: boolean;
  timedOut: boolean;
  timeoutMs: number;
  exitCode: number;
  signal: string | null;
  stdout: CappedRead;
  stderr: CappedRead;
}

type ReferenceChild = Bun.Subprocess<"pipe", "pipe", "pipe">;

/** Everything one reference solve reads, resolved before any child starts. */
interface PreparedReferenceSolve {
  bundle: EvaluatorBundle;
  policy: GeneratedWorkerPolicy;
  request: string;
  timeoutMs: number;
  lifetime: VerifierLifetime;
}

const PATH_ERROR = /ENOENT|EACCES|EPERM|no such file/i;

/** A reference solve's remembered outcome, as plain data so a reuse cannot share mutable objects. */
export type ReferenceSolveOutcome =
  | { kind: "artifact"; artifact: unknown }
  | {
      kind: "failure";
      failure: { kind: ReferenceSolveFailureKind; owner: "environment" | "product"; detail: string };
    };

const REMEMBERED_FAILURES: ReadonlySet<ReferenceSolveFailureKind> = new Set([
  "generated-solve-throw",
  "generated-solve-result",
  "generated-solve-protocol",
]);

interface ReferenceSolveStageInput {
  slugDir: string;
  task: PublicTask<JsonValue>;
  timeoutMs: number | undefined;
  executable: string | undefined;
  verifierLifetime: VerifierLifetime | undefined;
  /** The bundle snapshot whose census runs this stage, recorded on an executed receipt. */
  producedUnder: string;
  memory: SolvabilityStageMemory<ReferenceSolveOutcome> | undefined;
}

/** Whether the per-task wall stopped this reference solve. The controller wrote this error, not the
 *  candidate, which is why its count is public to the author while the task identities behind it
 *  stay protected. */
export function referenceSolveTimedOut(row: { error: string | null }): boolean {
  return row.error !== null && REFERENCE_SOLVE_TIMEOUT_ERROR.test(row.error);
}

export class ReferenceSolveProcessFailure extends Error {
  constructor(
    readonly kind: ReferenceSolveFailureKind,
    readonly owner: "environment" | "product",
    readonly operatorDetail: string,
  ) {
    super(operatorDetail);
    this.name = "ReferenceSolveProcessFailure";
  }
}

/** Decide what the child produced. The controller's ready marker is the whole owner rule: a child
 *  that never reached it failed before any generated solve code ran, so the host owns that failure,
 *  and after it every remaining refusal is the generated correctness model's. */
function classifyReferenceSolveOutcome(output: ReferenceSolveChildOutput) {
  const stdoutText = new TextDecoder().decode(output.stdout.bytes);
  const { ready } = output;
  const responseText = ready ? stdoutText.slice(stdoutText.indexOf("\n") + 1) : stdoutText;
  const stderrText = `${new TextDecoder().decode(output.stderr.bytes)}${output.stderr.overflow ? "\n[stderr truncated]" : ""}`;
  const owner = ready ? "product" : "environment";
  const hostOr = (
    productKind: "generated-solve-crash" | "generated-solve-protocol" | "generated-solve-timeout",
  ): ReferenceSolveFailureKind => (ready ? productKind : "reference-solve-host");
  if (output.timedOut) {
    throw new ReferenceSolveProcessFailure(
      hostOr("generated-solve-timeout"),
      owner,
      `reference solve child exceeded ${output.timeoutMs}ms`,
    );
  }
  if (output.stdout.overflow) {
    throw new ReferenceSolveProcessFailure(
      hostOr("generated-solve-protocol"),
      owner,
      `reference solve child exceeded the stdout cap; stderr=${stderrText}`,
    );
  }
  const normalizedCode = output.signal === null ? output.exitCode : null;
  if (normalizedCode !== 0) {
    throw new ReferenceSolveProcessFailure(
      hostOr("generated-solve-crash"),
      owner,
      `reference solve child exited code=${String(normalizedCode)} signal=${String(output.signal)}; stderr=${stderrText}`,
    );
  }
  if (!ready) {
    throw new ReferenceSolveProcessFailure(
      "reference-solve-host",
      "environment",
      `reference solve child exited before the controller ready marker; stdout=${stdoutText}; stderr=${stderrText}`,
    );
  }
  let response: unknown;
  try {
    response = trustedJsonParse(responseText);
  } catch {
    throw new ReferenceSolveProcessFailure(
      "generated-solve-protocol",
      "product",
      `reference solve child emitted invalid JSON after ready; stdout=${responseText}; stderr=${stderrText}`,
    );
  }
  if (
    response === null ||
    !isObject(response) ||
    /* SAFETY: reached only when `isObject(response)` held. */ (response as { protocol?: unknown })
      .protocol !== REFERENCE_SOLVE_PROTOCOL
  ) {
    throw new ReferenceSolveProcessFailure(
      "generated-solve-protocol",
      "product",
      `reference solve child response did not match ${REFERENCE_SOLVE_PROTOCOL}; stdout=${responseText}`,
    );
  }
  const wire =
    /* SAFETY: the check above returned unless `response` is an object whose `protocol` matches; every field below stays `unknown`. */ response as {
      outcome?: unknown;
      artifact?: unknown;
      classification?: unknown;
    };
  if (wire.outcome === "artifact") return { artifact: wire.artifact };
  if (
    wire.outcome === "non-result" &&
    (wire.classification === "generated-solve-throw" || wire.classification === "generated-solve-result")
  ) {
    throw new ReferenceSolveProcessFailure(wire.classification, "product", stderrText || wire.classification);
  }
  throw new ReferenceSolveProcessFailure(
    "generated-solve-protocol",
    "product",
    `reference solve child response had an unknown outcome; stdout=${responseText}`,
  );
}

async function readCapped(
  stream: AsyncIterable<Uint8Array>,
  cap: number,
  observe?: (chunk: Uint8Array, overflow: boolean) => Promise<void>,
): Promise<CappedRead> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const remaining = cap - size;
    size += chunk.length;
    if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
    await observe?.(chunk, size > cap);
  }
  return { bytes: Bun.concatArrayBuffers(chunks), overflow: size > cap };
}

/** A trusted pid handshake precedes public task delivery and generated module loading. */
function referenceHandshake(
  child: ReferenceChild,
  policy: GeneratedWorkerPolicy,
  request: string,
  stop: () => void,
) {
  let prefix = "";
  let ready = false;
  let error: Error | null = null;
  return {
    ready: () => ready,
    error: () => error,
    observe: async (chunk: Uint8Array, overflow: boolean) => {
      if (overflow) {
        stop();
        return;
      }
      if (ready || error !== null) return;
      prefix += new TextDecoder().decode(chunk);
      const newline = prefix.indexOf("\n");
      if (newline < 0 && prefix.length <= 256) return;
      const line = prefix.slice(0, newline);
      const pid = line.startsWith(REFERENCE_SOLVE_READY)
        ? Number(line.slice(REFERENCE_SOLVE_READY.length))
        : NaN;
      if (newline < 0 || witnessConfinedChild(pid, child.pid, policy.mechanismId) === null) {
        error = new Error("reference solve child did not prove its confined pid");
        stop();
        return;
      }
      ready = true;
      await child.stdin.write(request);
      await child.stdin.end();
    },
  };
}

async function runReferenceChild({ bundle, policy, request, timeoutMs, lifetime }: PreparedReferenceSolve) {
  const lease: VerifierProcessLease = lifetime.begin({
    role: "reference",
    cell: bundle.dir,
    requestDigest: sha256(request),
  });
  let child: ReferenceChild;
  try {
    child = spawn({
      cmd: [policy.executable, ...policy.launchArgs, bundle.file],
      cwd: bundle.dir,
      env: policy.runtimeEnvironment,
      detached: true,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    settleUnspawned(lease);
    throw new ReferenceSolveProcessFailure("reference-solve-host", "environment", errorMessage(error));
  }
  const output = cancellableByteStream(child.stdout),
    errors = cancellableByteStream(child.stderr);
  const handshake = referenceHandshake(child, policy, request, () => {
    void supervision.stop().catch(() => {});
  });
  const stdout = readCapped(output.stream, REFERENCE_SOLVE_STDOUT_MAX, handshake.observe);
  const stderr = readCapped(errors.stream, REFERENCE_SOLVE_STDERR_MAX);
  const drained = Promise.all([stdout, stderr]);
  const supervision = superviseVerifierProcess(
    child,
    lease,
    {
      drained,
      cancel: () => {
        output.cancel();
        errors.cancel();
      },
    },
    timeoutMs,
  );
  try {
    lease.spawned(child.pid);
    const settled = await supervision.done;
    if (!settled.groupReaped) {
      retainEvaluatorBundle(bundle.dir);
      throw new VerifierOperationalStop("unsettled-children", [settled.receiptId]);
    }
    if (handshake.error() !== null) {
      throw new ReferenceSolveProcessFailure(
        "reference-solve-host",
        "environment",
        errorMessage(handshake.error()),
      );
    }
    if (!settled.outputComplete) {
      throw new ReferenceSolveProcessFailure(
        handshake.ready() ? "generated-solve-protocol" : "reference-solve-host",
        handshake.ready() ? "product" : "environment",
        "reference solve output did not drain before bounded settlement",
      );
    }
    assertGeneratedWorkerPolicyUnchanged(policy);
    if (sha256OfFile(bundle.file) !== bundle.digest) {
      throw new ReferenceSolveProcessFailure(
        "reference-solve-host",
        "environment",
        "reference bundle bytes changed",
      );
    }
    const [stdoutResult, stderrResult] = await drained;
    return classifyReferenceSolveOutcome({
      ready: handshake.ready(),
      timedOut: settled.timedOut,
      timeoutMs,
      exitCode: settled.exit?.code ?? -1,
      signal: settled.exit?.signal ?? null,
      stdout: stdoutResult,
      stderr: stderrResult,
    });
  } catch (error) {
    const settled = await supervision.stop();
    if (!settled.groupReaped) {
      retainEvaluatorBundle(bundle.dir);
      throw new VerifierOperationalStop("unsettled-children", [settled.receiptId]);
    }
    throw error;
  }
}

/** Bundle the public reference closure and fix the confined runtime. Everything here happens before
 *  any generated code runs, so a failure at this point is the host's. */
async function prepareReferenceSolve(
  slugDir: string,
  task: PublicTask<JsonValue>,
  timeoutMs: number,
  executable: string,
  verifierLifetime: VerifierLifetime | undefined,
): Promise<PreparedReferenceSolve> {
  if (verifierLifetime === undefined) {
    throw new ReferenceSolveProcessFailure(
      "reference-solve-host",
      "environment",
      "reference solve requires a protected verifier lifetime owner",
    );
  }
  verifierLifetime.assertUsable();
  const bundle = await bundleReferenceSolve(slugDir);
  let policy: GeneratedWorkerPolicy;
  try {
    policy = generatedWorkerPolicy(bundle, undefined, executable);
    assertGeneratedWorkerPolicyUnchanged(policy);
  } catch (cause) {
    throw new ReferenceSolveProcessFailure("reference-solve-host", "environment", errorMessage(cause));
  }
  const request = trustedJsonStringify({
    protocol: REFERENCE_SOLVE_PROTOCOL,
    task: trustedStructuredClone(task),
  });
  return { bundle, policy, request, timeoutMs, lifetime: verifierLifetime };
}

/** Run only the public reference dependency closure, and run it under the real generated-worker
 *  wall rather than a lighter one, so the witness is produced under the conditions it attests. */
export async function executeIsolatedReferenceSolve(
  slugDir: string,
  task: PublicTask<JsonValue>,
  timeoutMs = harnessSettings(slugDir).referenceSolveMs,
  executable = trustedExecPath,
  verifierLifetime?: VerifierLifetime,
): Promise<{ artifact: unknown }> {
  return runReferenceChild(
    await prepareReferenceSolve(slugDir, task, timeoutMs, executable, verifierLifetime),
  );
}

/** A path or permission error names the wall, not the generated solve. */
export function isReferenceSolveIsolationFailure(cause: unknown): boolean {
  const code = errorCode(cause);
  return (
    code === "ENOENT" ||
    code === "EACCES" ||
    code === "EPERM" ||
    (cause instanceof ReferenceSolveProcessFailure &&
      cause.owner === "product" &&
      PATH_ERROR.test(cause.operatorDetail))
  );
}

/** Settled and product-owned: an artifact, or a refusal the generated solve itself reported. A
 *  crash can be a host kill, a timeout is the wall's cut, and a path error names the wall — none of
 *  those is a verdict on these bytes, so none of them may be remembered as one. */
function rememberable(outcome: ReferenceSolveOutcome): boolean {
  if (outcome.kind === "artifact") return true;
  const { kind, owner, detail } = outcome.failure;
  return owner === "product" && REMEMBERED_FAILURES.has(kind) && !PATH_ERROR.test(detail);
}

/** The reference-solve stage key: the bundle bytes modulo location, the confined runtime, the exact
 *  request bytes (protocol and public task), the wall and the output caps. */
function referenceSolveStageKey(
  prepared: Pick<PreparedReferenceSolve, "bundle" | "policy" | "request" | "timeoutMs">,
): string {
  return hashJsonValue({
    stage: REFERENCE_SOLVE_STAGE,
    bundle: prepared.bundle.portableDigest,
    runtime: prepared.policy.identity,
    request: sha256(prepared.request),
    wallMs: prepared.timeoutMs,
    stdoutMax: REFERENCE_SOLVE_STDOUT_MAX,
    stderrMax: REFERENCE_SOLVE_STDERR_MAX,
  });
}

/** Solve one public task, or reuse a settled outcome recorded under the same key. Preparation
 *  failures and untyped throws propagate with no receipt, because nothing keyed was read to
 *  completion and a receipt would claim otherwise. */
export async function referenceSolveStage(
  input: ReferenceSolveStageInput,
): Promise<{ outcome: ReferenceSolveOutcome; receipt: SolvabilityStageReceipt }> {
  const prepared = await prepareReferenceSolve(
    input.slugDir,
    input.task,
    input.timeoutMs ?? harnessSettings(input.slugDir).referenceSolveMs,
    input.executable ?? trustedExecPath,
    input.verifierLifetime,
  );
  const { value, receipt } = await throughStage(
    input.memory,
    referenceSolveStageKey(prepared),
    input.producedUnder,
    async () => {
      let outcome: ReferenceSolveOutcome;
      try {
        outcome = { kind: "artifact", artifact: (await runReferenceChild(prepared)).artifact };
      } catch (caught) {
        if (!(caught instanceof ReferenceSolveProcessFailure)) throw caught;
        outcome = {
          kind: "failure",
          failure: { kind: caught.kind, owner: caught.owner, detail: caught.operatorDetail },
        };
      }
      return { value: outcome, settled: rememberable(outcome) };
    },
  );
  return { outcome: value, receipt };
}

/** The typed failure a remembered or fresh outcome stands for. */
export function referenceSolveFailure(
  failure: Extract<ReferenceSolveOutcome, { kind: "failure" }>["failure"],
): ReferenceSolveProcessFailure {
  return new ReferenceSolveProcessFailure(failure.kind, failure.owner, failure.detail);
}

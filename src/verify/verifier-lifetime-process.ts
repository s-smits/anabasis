/** Bounded settlement for the verifier's tool, evaluator and reference children only. */
import { cancellableByteStream } from "../meta/cancellable-stream.ts";
import { capturedSpawn } from "../meta/process.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { terminateAndReapProcessGroup } from "../meta/subprocess.ts";
import type { GeneratedWorkerPolicy } from "../solve/generated-tool-source-policy.ts";
import type { VerifierProcessLease, VerifierProcessSettlement } from "./verifier-lifetime.ts";

const SETTLEMENT_GRACE_MS = 2_000;

async function boundedDrain(done: Promise<unknown>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      done.then(
        () => true,
        () => false,
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), SETTLEMENT_GRACE_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function superviseVerifierProcess(
  child: Bun.Subprocess,
  lease: VerifierProcessLease,
  streams: { drained: Promise<unknown>; cancel(): void },
  timeoutMs: number,
  onTimeout?: () => void,
) {
  let exit: VerifierProcessSettlement["exit"] = null;
  let timedOut = false;
  let outputComplete = false;
  let closing: Promise<VerifierProcessSettlement> | null = null;
  const result = Promise.withResolvers<VerifierProcessSettlement>();
  void result.promise.catch(() => {});
  const drained = streams.drained.then(
    () => {
      outputComplete = true;
    },
    () => {},
  );
  const exited = child.exited.then(
    (code) => {
      const signal = child.signalCode ?? null;
      exit = { code: signal === null ? code : null, signal };
    },
    () => {},
  );
  const close = (): Promise<VerifierProcessSettlement> => {
    if (closing !== null) return closing;
    clearTimeout(timer);
    closing = (async () => {
      const groupReaped = await terminateAndReapProcessGroup(child).catch(() => false);
      await boundedDrain(Promise.all([exited, drained]));
      streams.cancel();
      const observation = { receiptId: lease.id, exit, groupReaped, outputComplete, timedOut };
      try {
        lease.settle(observation);
      } finally {
        // The durable intent retains uncertain ownership even if the settlement write failed.
        if (exit === null) child.unref();
      }
      return observation;
    })();
    void closing.then(result.resolve, result.reject);
    return closing;
  };
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      onTimeout?.();
    } finally {
      void close().catch(() => {});
    }
  }, timeoutMs);
  lease.registerStop(close);
  void exited.then(close).catch(() => {});
  return { done: result.promise, stop: close };
}

/**
 * Settle a lease whose child never started. Nothing was reaped because no group exists, no output
 * was opened so collection is complete, and no deadline ran. The tool host and
 * `launchConfinedChild` settle this way, and a receipt that disagrees with the
 * others about a child that never existed is a cleanup fact the terminal reader cannot resolve.
 */
export function settleUnspawned(lease: VerifierProcessLease): void {
  lease.settle({
    receiptId: lease.id,
    exit: null,
    groupReaped: true,
    outputComplete: true,
    timedOut: false,
  });
}

/**
 * Start one generated bundle under its confinement policy, as the evaluator and the reference solve
 * both do: detached into its own process group, with piped input and cancellable output.
 *
 * A launch that throws never produced a child, so the lease settles as unspawned and `refused`
 * types the failure; both callers make it an environment non-result, because no candidate byte ran.
 * Whatever happens after this returns is the caller's to classify, and each one does it by whether
 * the child proved its confined pid first.
 */
export function launchConfinedChild(
  lease: VerifierProcessLease,
  policy: Pick<GeneratedWorkerPolicy, "executable" | "launchArgs" | "runtimeEnvironment">,
  bundle: { dir: string; file: string },
  refused: (message: string) => Error,
) {
  let child: Bun.Subprocess<"pipe", "pipe", "pipe">;
  try {
    child = capturedSpawn({
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
    throw refused(errorMessage(error));
  }
  return { child, output: cancellableByteStream(child.stdout), errors: cancellableByteStream(child.stderr) };
}

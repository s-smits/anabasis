/** Bounded settlement for the verifier's tool, evaluator and reference children only. */
import { terminateAndReapProcessGroup } from "../meta/subprocess.ts";
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

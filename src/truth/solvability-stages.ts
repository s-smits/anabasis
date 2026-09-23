/**
 * F2 stage results remembered across the validation sequences of one authoring session. Each
 * stage names a key over exactly the bytes and constants it read; a later census reuses a result
 * only when that key matches, and records the reuse with the snapshot that produced it. Only
 * settled, product-owned outcomes are remembered: a host non-result, a cleanup-pending stop or a
 * cut by the wall never is, so the same bytes pay for a fresh execution after recovery.
 *
 * Keying each stage over what it actually read is what makes an edit affordable. Keyed over the
 * whole candidate instead, changing correctness-model/evaluator.ts alone between two checks re-runs
 * every reference solve — a quarter of an hour on a full battery — though no byte the reference
 * solve reads has moved.
 */
import type { ContractFinding } from "./brief.ts";
import type { ReferenceSolveOutcome } from "./reference-solve.ts";
import { trustedStructuredClone } from "./trusted-runtime.ts";

/** How one stage's result entered this census. */
export interface SolvabilityStageReceipt {
  /** Digest of every byte and constant the stage read. */
  key: string;
  /** Executed by this census, or reused from a census that recorded the same key. */
  source: "executed" | "reused";
  /** The bundle snapshot whose census executed the stage. */
  producedUnder: string;
}

interface Remembered<T> {
  value: T;
  producedUnder: string;
}

export type SolvabilityStageMemory<T> = Map<string, Remembered<T>>;

/** Session-owned memory, one map per stage; the stage modules own the value shapes. */
export interface SolvabilityStageCache {
  referenceSolves: SolvabilityStageMemory<ReferenceSolveOutcome>;
  familyBindings: SolvabilityStageMemory<ContractFinding[]>;
}

export function createSolvabilityStageCache(): SolvabilityStageCache {
  return { referenceSolves: new Map(), familyBindings: new Map() };
}

/** Reuse the result recorded under `key`, or execute and remember it when the stage settled. Values
 *  are cloned on the way in and out, so no census can mutate another census's rows. A throw
 *  propagates and remembers nothing. */
export async function throughStage<T>(
  memory: SolvabilityStageMemory<T> | undefined,
  key: string,
  producedUnder: string,
  execute: () => Promise<{ value: T; settled: boolean }>,
): Promise<{ value: T; receipt: SolvabilityStageReceipt }> {
  const hit = memory?.get(key);
  if (hit !== undefined) {
    return {
      value: trustedStructuredClone(hit.value),
      receipt: { key, source: "reused", producedUnder: hit.producedUnder },
    };
  }
  const { value, settled } = await execute();
  if (settled) memory?.set(key, { value: trustedStructuredClone(value), producedUnder });
  return { value, receipt: { key, source: "executed", producedUnder } };
}

/**
 * A condition: everything that could change a solve's result, as one content-addressed record. Two
 * solves are comparable only when their conditions differ in the one thing being compared.
 *
 * The host sets every field; the Builder sets none. The model, its effort and every limit are the
 * host's, which a Built Harness used to declare for itself: on 7 October each harness state carried
 * its own `config.yaml` naming its wall, turn cap, shell timeouts and concurrency.
 */
import { hashJsonValue } from "../meta/stable-json.ts";
import type { PriceTable } from "./meter.ts";

/**
 * What the host holds every solve to. A harness never sets one: a file or a prompt that asks for a
 * longer wall, more turns, more concurrency or more disk changes nothing.
 */
export interface Limits {
  readonly wallSeconds: number;
  /** The prompts a solver is given, the opening one and each nudge after a turn that ended without a
   *  submit, before the solve stops without an answer of its own: v1's `maxTurns`. */
  readonly turns: number;
  /** How long one shell command runs when the solver names no timeout. A timeout it names only
   *  raises this, up to `shellMaxSeconds`, as v1's Built shell clamped it (built-bash.ts:316-321). */
  readonly shellDefaultSeconds: number;
  /** The longest one shell command may run. */
  readonly shellMaxSeconds: number;
  /** Solves the host runs at once, which moves wall time through the load they put on one another. */
  readonly concurrency: number;
  /**
   * The most bytes one solve's writable roots may hold together, enforced as the size of the volume
   * they sit on (`src/verify/disk-cap.ts`). Neither v1 nor the sweep this plan targets capped disk,
   * so one solve could fill the host's disk under every other. The runner hands the same number to
   * `solveIsolationPolicy`, so a change here moves `sandbox` too.
   */
  readonly diskBytes: number;
}

export interface Condition {
  /** The contract frozen in round 0. */
  readonly contract: string;
  /** The harness version a Builder session ended on. */
  readonly harness: string;
  /** The task version: statement, inputs and check. */
  readonly task: string;
  /**
   * `provider/model`, a key of `prices`, exactly as the backend is asked for it. A provider may serve
   * an alias from a snapshot of its choosing, so each turn's trace names the snapshot that served it.
   */
  readonly model: string;
  readonly effort: string;
  readonly prices: PriceTable;
  /** The agent runtime's packages by version: pi's, and the backend's own, such as the Agent SDK. */
  readonly runtime: Readonly<Record<string, string>>;
  /** How a full context is made to fit, as the runtime names it; `off` when it never is. */
  readonly compaction: string;
  readonly solverTools: string;
  readonly verifierTools: string;
  /** The digest of the sandbox's policy: what a solve may read, write, run and fill on disk. */
  readonly sandbox: string;
  readonly limits: Limits;
  /** The host's own code version. */
  readonly host: string;
  /** Which side of the pair: the test condition, or the stronger one. */
  readonly side: "test" | "strong";
}

/** The condition's identity: the hash of its canonical JSON, so field order does not move it. */
export function conditionId(condition: Condition): string {
  if (condition.prices[condition.model] === undefined) {
    throw new Error(`the condition runs ${condition.model} but prices no such model`);
  }
  return hashJsonValue(condition);
}

/**
 * A condition: everything that could change a solve's result, as one content-addressed record. Two
 * solves are comparable only when their conditions differ in the one thing being compared.
 *
 * The host sets every field; the Builder sets none. The model and its effort are the host's, and so
 * is the wall, which a Built Harness used to declare for itself.
 */
import { hashJsonValue } from "../meta/stable-json.ts";
import type { PriceTable } from "./meter.ts";

export interface Condition {
  /** The contract frozen in round 0. */
  readonly contract: string;
  /** The harness version a Builder session ended on. */
  readonly harness: string;
  /** The task version: statement, inputs, check and controls. */
  readonly task: string;
  /** `provider/model`, a key of `prices`. */
  readonly model: string;
  readonly effort: string;
  /** B dollars and C CPU seconds, set in round 0. */
  readonly budget: { readonly dollars: number; readonly cpuSeconds: number };
  readonly prices: PriceTable;
  readonly wallSeconds: number;
  readonly solverTools: string;
  readonly verifierTools: string;
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

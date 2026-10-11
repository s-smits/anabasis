/**
 * The domain contract: the one public document the Builder and the Examiner both work against. It is
 * frozen once the first exam is admitted, and its hash enters every condition. A frozen contract
 * changes only through the operator, and a change opens a new condition.
 *
 * Every check cites the rule ids it enforces, and the host confirms those ids exist here. Whether a
 * rule's statement says enough is not the host's to decide: it surfaces as a Referee dispute.
 */
import { validateToolArguments } from "@earendil-works/pi-ai/utils/validation";
import type { TSchema } from "typebox";
import { asRecord, isString, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hashJsonValue, sameJsonValue } from "../meta/stable-json.ts";

export interface Rule {
  readonly id: string;
  readonly statement: string;
}

/** The objective a check program may declare beside its checks: a quantity its evaluator computes
 *  from a valid answer, and which way is better. Two valid answers on one task are compared by it
 *  (`src/kernel/compare.ts`, `ObjectiveRule`), so it is public: a solver and a Builder read it
 *  with the rules. Added 10 October (`docs/plan.md`, the climb). */
export interface Objective {
  readonly quantity: string;
  readonly direction: "lower" | "higher";
}

export interface Contract {
  /** The schema every answer must follow. */
  readonly answerFormat: JsonValue;
  /** The objective, where the check program declares one. */
  readonly objective?: Objective;
  /** Whatever a practitioner would take as given. */
  readonly conventions: string;
  /** The requirements a task may cite. */
  readonly rules: readonly Rule[];
  /** What a task in this domain may ask. */
  readonly scope: string;
}

/** The objective in a sentence, for the prompts and the public resource that state it. */
export function objectiveLine({ quantity, direction }: Objective): string {
  return `Of two valid answers to one task, the one with the ${direction} ${quantity} is the better, by more than a small margin; a valid answer beats any invalid one, whatever its ${quantity}.`;
}

/** The contract's identity: the hash of its canonical JSON. A rule id named twice would let a
 *  citation mean two requirements, so such a contract has none. */
export function contractHash(contract: Contract): string {
  answerSchema(contract);
  const ids = contract.rules.map((rule) => rule.id);
  const twice = ids.find((id, index) => ids.indexOf(id) !== index);
  if (twice !== undefined) throw new Error(`the contract names rule ${twice} twice`);
  return hashJsonValue(contract);
}

/**
 * Why an answer does not follow the contract's answer format, or null when it does. `submit` asks
 * it of a solver's answer file and refuses the file with what this returns, and the runner asks it
 * again of what was submitted (`src/solve/answer.ts`, `src/solve/run.ts`). The validator is pi-ai's
 * own, the one pi runs on a tool's arguments. That validator coerces: it reads `"1"` as `1` where
 * the format wants a number and drops a null the format does not allow. It coerces a clone, never
 * the caller's value, and an answer that follows only once coerced does not follow here, since what
 * a check would read is the answer as given.
 */
export function answerFormatFault(contract: Contract, answer: JsonValue): string | null {
  const tool = { name: "answer", description: "", parameters: answerSchema(contract) };
  let validated: unknown;
  try {
    // SAFETY: the validator reads any JSON value; only its type names the arguments an object.
    const call = { type: "toolCall", id: "answer", name: "answer", arguments: answer as JsonObject } as const;
    validated = validateToolArguments(tool, call);
  } catch (error) {
    // The validator ends its message with the whole answer, which the caller already holds.
    return errorMessage(error).split("\n\nReceived arguments")[0] ?? "";
  }
  return sameJsonValue(validated, answer) ? null : "the answer follows the format only once coerced";
}

/**
 * The answer format as the schema pi-ai's validator takes. A format
 * that is not a JSON Schema object is refused: the validator reads one as no constraint at all, so
 * the M1 stand-in contract, which carried v1's prose `artifactSchema` rows, passed every answer.
 */
function answerSchema(contract: Contract): TSchema {
  if (!isString(asRecord(contract.answerFormat)?.type)) {
    throw new Error("the contract's answer format is not a JSON Schema with a type");
  }
  // SAFETY: a JSON Schema, which pi-ai's validator compiles as TypeBox does its own.
  return contract.answerFormat as TSchema;
}

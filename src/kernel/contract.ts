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

export interface Contract {
  /** The schema every answer must follow. */
  readonly answerFormat: JsonValue;
  /** Whatever a practitioner would take as given. */
  readonly conventions: string;
  /** The requirements a task may cite. */
  readonly rules: readonly Rule[];
  /** What a task in this domain may ask. */
  readonly scope: string;
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
 * Why an answer does not follow the contract's answer format, or null when it does. The validator is
 * pi-ai's own, the one a solver's record tool runs on its arguments, so the kernel and the tool agree
 * on every answer. That validator coerces: it reads `"1"` as `1` where the format wants a number and
 * drops a null the format does not allow. It coerces a clone, never the caller's value, and an
 * answer that follows only once coerced does not follow here, since what a check would read is the
 * answer as given. Coercion is idempotent, so what the record tool hands on always follows.
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
 * The answer format as the schema pi-ai's validator and a record tool's parameters take. A format
 * that is not a JSON Schema object is refused: the validator reads one as no constraint at all, so
 * the M1 stand-in contract, which carried v1's prose `artifactSchema` rows, passed every answer.
 */
export function answerSchema(contract: Contract): TSchema {
  if (!isString(asRecord(contract.answerFormat)?.type)) {
    throw new Error("the contract's answer format is not a JSON Schema with a type");
  }
  // SAFETY: a JSON Schema, which pi-ai's validator compiles as TypeBox does its own.
  return contract.answerFormat as TSchema;
}

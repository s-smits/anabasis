/**
 * The domain contract: the one public document the Builder and the Examiner both work against. It is
 * frozen once the first exam is admitted, and its hash enters every condition. A frozen contract
 * changes only through the operator, and a change opens a new condition.
 *
 * Every check cites the rule ids it enforces, and the host confirms those ids exist here. Whether a
 * rule's statement says enough is not the host's to decide: it surfaces as a Referee dispute.
 */
import type { TSchema } from "typebox";
import { Compile } from "typebox/compile";
import { asRecord, isString, type JsonValue } from "../meta/json-shape.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hashJsonValue } from "../meta/stable-json.ts";

export interface Rule {
  readonly id: string;
  readonly statement: string;
}

/** The objective a check program may declare beside its checks: a quantity its evaluator computes
 *  from a valid answer, and which way is better. Two valid answers on one task are compared by it
 *  (`src/kernel/compare.ts`, `ObjectiveRule`), so it is public: a solver and a Builder read it
 *  with the rules (`7f0add79:docs/plan.md`, the climb). */
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
  return `Of two valid answers to one task, the one with the ${direction} ${quantity} is the better; a valid answer beats any invalid one, whatever its measure.`;
}

/** The contract's identity: the hash of its canonical JSON. A rule id named twice would let a
 *  citation mean two requirements, so such a contract has none. */
export function contractHash(contract: Contract): string {
  answerSchema(contract.answerFormat);
  const ids = contract.rules.map((rule) => rule.id);
  const twice = ids.find((id, index) => ids.indexOf(id) !== index);
  if (twice !== undefined) throw new Error(`the contract names rule ${twice} twice`);
  return hashJsonValue(contract);
}

/**
 * Why an answer does not follow a contract's answer format, or null when it does. `submit` asks
 * it of a solver's answer file and refuses the file with what this returns, and the runner asks it
 * again of what was submitted (`src/tools/answer.ts`, `src/solver/run.ts`). The checker is
 * TypeBox's compiled one, which pi-ai 1.4.0's validator ran. It coerces nothing, so an
 * answer follows as given or not at all, and which answers follow does not move with pi's
 * packages. A format that refers to itself without reading a value has no verdict: the checker
 * runs out of stack and the fault says so, where pi-schema 1.5.2 under Bun never returns (its
 * check of a reference is a call in tail position, which the engine turns into a jump) and
 * TypeBox's interpreted `Value.Check` never returns from a name that is its own reference.
 */
export function answerFormatFault(answerFormat: Contract["answerFormat"], answer: JsonValue): string | null {
  const schema = answerSchema(answerFormat);
  try {
    const format = Compile(schema);
    if (format.Check(answer)) return null;
    return format
      .Errors(answer)
      .map((fault) => `${fault.instancePath || "/"}: ${fault.message}`)
      .join("; ");
  } catch (error) {
    return errorMessage(error);
  }
}

/**
 * The answer format as the schema TypeBox's checker takes. A format
 * that is not a JSON Schema object is refused: the checker reads one as no constraint at all, so
 * the M1 stand-in contract, which carried v1's prose `artifactSchema` rows, passed every answer.
 */
function answerSchema(answerFormat: Contract["answerFormat"]): TSchema {
  if (!isString(asRecord(answerFormat)?.type)) {
    throw new Error("the contract's answer format is not a JSON Schema with a type");
  }
  // SAFETY: a JSON Schema, which TypeBox's checker reads as it does its own.
  return answerFormat as TSchema;
}

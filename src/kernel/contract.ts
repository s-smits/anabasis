import type { TSchema } from "typebox";
import { Compile } from "typebox/compile";
import { asRecord, isString, type JsonValue } from "../meta/json-shape.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hashJsonValue } from "../meta/stable-json.ts";

export interface Rule {
  readonly id: string;
  readonly statement: string;
}

export interface Objective {
  readonly quantity: string;
  readonly direction: "lower" | "higher";
}

export interface Contract {
  readonly answerFormat: JsonValue;
  readonly objective?: Objective;
  readonly conventions: string;
  readonly rules: readonly Rule[];
  readonly scope: string;
}

export function objectiveLine({ quantity, direction }: Objective): string {
  return `Of two valid answers to one task, the one with the ${direction} ${quantity} is the better; a valid answer beats any invalid one, whatever its measure.`;
}

export function contractHash(contract: Contract): string {
  answerSchema(contract.answerFormat);
  const ids = contract.rules.map((rule) => rule.id);
  const twice = ids.find((id, index) => ids.indexOf(id) !== index);
  if (twice !== undefined) throw new Error(`the contract names rule ${twice} twice`);
  return hashJsonValue(contract);
}

const COMPILED = new WeakMap<object, ReturnType<typeof Compile>>();

export function answerFormatFault(answerFormat: Contract["answerFormat"], answer: JsonValue): string | null {
  const schema = answerSchema(answerFormat);
  try {
    let format = COMPILED.get(schema);
    if (format === undefined) {
      format = Compile(schema);
      COMPILED.set(schema, format);
    }
    if (format.Check(answer)) return null;
    return format
      .Errors(answer)
      .map((fault) => `${fault.instancePath || "/"}: ${fault.message}`)
      .join("; ");
  } catch (error) {
    return errorMessage(error);
  }
}

function answerSchema(answerFormat: Contract["answerFormat"]): TSchema {
  if (!isString(asRecord(answerFormat)?.type)) {
    throw new Error("the contract's answer format is not a JSON Schema with a type");
  }
  // SAFETY: a JSON Schema, which TypeBox's checker reads as it does its own.
  return answerFormat as TSchema;
}

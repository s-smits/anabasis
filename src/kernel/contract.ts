import type { TSchema } from "typebox";
import { Compile } from "typebox/compile";
import { asRecord, isNumber, isString, type JsonValue } from "../meta/json-shape.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hashJsonValue } from "../meta/stable-json.ts";

const RUBRIC_ITEM_ID = /^[a-z][a-z0-9-]*$/u;

interface Rule {
  readonly id: string;
  readonly statement: string;
}

// oxlint-disable-next-line typescript/consistent-type-definitions -- type alias stays assignable to `JsonValue`
export type RubricItem = {
  readonly id: string;
  readonly weight: number;
};

export interface Objective {
  readonly quantity: string;
  readonly direction: "lower" | "higher";
  readonly scale?: "unit";
  readonly items?: readonly RubricItem[];
}

export interface Contract {
  readonly answerFormat: JsonValue;
  readonly objective?: Objective;
  readonly conventions: string;
  readonly rules: readonly Rule[];
  readonly scope: string;
}

const WEIGHT_RATIO = 1e12;

export function rubricFaults(objective: Objective | undefined, checkIds: readonly string[] = []): string[] {
  const items = objective?.items;
  if (items === undefined) return [];
  if (items.length === 0) return ["objective.items must contain at least one item when declared"];
  const faults: string[] = [];
  if (objective?.direction !== "higher") faults.push('objective.items requires direction "higher"');
  if (objective?.scale !== "unit") faults.push('objective.items requires scale "unit"');
  const seen = new Set<string>();
  for (const item of items) {
    if (!isString(item.id) || !RUBRIC_ITEM_ID.test(item.id) || Object.hasOwn(Object.prototype, item.id)) {
      faults.push(`objective.items names an invalid item ${isString(item.id) ? item.id : ""}`);
      continue;
    }
    if (seen.has(item.id)) faults.push(`objective.items names ${item.id} twice`);
    if (checkIds.includes(item.id)) faults.push(`objective.items.${item.id} shares its id with a check`);
    seen.add(item.id);
    if (!isNumber(item.weight) || !Number.isFinite(item.weight) || item.weight <= 0) {
      faults.push(`objective.items.${item.id} requires a positive finite weight`);
    }
  }
  const weights = items.map(({ weight }) => weight).filter((weight) => isNumber(weight) && weight > 0);
  if (weights.length > 1 && Math.max(...weights) / Math.min(...weights) > WEIGHT_RATIO) {
    faults.push(`objective.items weights span more than ${String(WEIGHT_RATIO)} to 1`);
  }
  return faults;
}

export function objectiveLine({ quantity, direction, items }: Objective): string {
  const base = `Of two valid answers to one task, the one with the ${direction} ${quantity} is the better; a valid answer beats any invalid one, whatever its measure.`;
  if (items === undefined || items.length === 0) return base;
  const listed = items.map(({ id, weight }) => `${id} (${String(weight)})`).join(", ");
  return `${base} Weighted rubric on [0, 1]: ${listed}.`;
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

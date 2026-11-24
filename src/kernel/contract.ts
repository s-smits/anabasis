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

export type RubricItem =
  | { readonly id: string; readonly weight: number; readonly kind?: "code" }
  | { readonly id: string; readonly weight: number; readonly kind: "judge"; readonly criterion: string };

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
export const CRITERION = { least: 20, most: 220, perTask: 4 };

export interface TaskCriterion {
  readonly id: string;
  readonly criterion: string;
}

export const hasJudge = (objective: Objective | undefined): boolean =>
  (objective?.items ?? []).some(({ kind }) => kind === "judge");

export function codeObjective(objective: Objective | undefined): Objective | undefined {
  if (objective?.items === undefined) return objective;
  const { items } = objective;
  const code = items.filter(({ kind }) => kind !== "judge");
  if (code.length === 0) return undefined;
  return code.length === items.length ? objective : { ...objective, items: code };
}

export function rubricOf(value: unknown): TaskCriterion[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((row) => {
    const { id, criterion } = asRecord(row) ?? {};
    return isString(id) && isString(criterion) ? [{ id, criterion }] : [];
  });
}

export function taskRubricFaults(
  objective: Objective | undefined,
  rubric: readonly TaskCriterion[] | undefined,
  checkIds: readonly string[],
): string[] {
  if (rubric === undefined) return [];
  if (!hasJudge(objective)) {
    return ["the task carries rubric criteria, and the contract declares no judged item"];
  }
  if (rubric.length === 0 || rubric.length > CRITERION.perTask) {
    return [`the task's rubric holds 1 to ${String(CRITERION.perTask)} criteria`];
  }
  const taken = new Set([...checkIds, ...(objective?.items ?? []).map(({ id }) => id)]);
  return rubric.flatMap(({ id, criterion }, index) => {
    const named =
      isString(id) &&
      RUBRIC_ITEM_ID.test(id) &&
      !taken.has(id) &&
      rubric.findIndex((one) => one.id === id) === index;
    const fault = criterionFault(criterion);
    return [
      ...(named
        ? []
        : [`rubric criterion ${String(index + 1)} needs an id of its own, unlike any check or item`]),
      ...(fault === null ? [] : [`rubric criterion ${isString(id) ? id : String(index + 1)} ${fault}`]),
    ];
  });
}

function criterionFault(text: unknown): string | null {
  if (!isString(text)) return "requires a criterion";
  if (text.includes("\n")) return "states its criterion on one line";
  const { length } = text.trim();
  return length < CRITERION.least || length > CRITERION.most
    ? `states its criterion in ${String(CRITERION.least)} to ${String(CRITERION.most)} characters`
    : null;
}

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
    const kind: unknown = item.kind;
    if (kind !== undefined && kind !== "code" && kind !== "judge") {
      faults.push(`objective.items.${item.id} is of kind code or judge`);
    }
    const criterion = item.kind === "judge" ? criterionFault(item.criterion) : null;
    if (criterion !== null) faults.push(`objective.items.${item.id} ${criterion}`);
  }
  const weights = items.map(({ weight }) => weight).filter((weight) => isNumber(weight) && weight > 0);
  if (weights.length > 1 && Math.max(...weights) / Math.min(...weights) > WEIGHT_RATIO) {
    faults.push(`objective.items weights span more than ${String(WEIGHT_RATIO)} to 1`);
  }
  return faults;
}

export function objectiveLine(
  { quantity, direction, items }: Objective,
  reader: "exam" | "build" = "build",
): string {
  const base = `Of two valid answers to one task, the one with the ${direction} ${quantity} is the better; a valid answer beats any invalid one, whatever its measure.`;
  if (items === undefined || items.length === 0) return base;
  const listed = items
    .map((item) =>
      item.kind === "judge"
        ? `${item.id} (${String(item.weight)}, judged by a model${reader === "exam" ? ` on: ${item.criterion}` : ""})`
        : `${item.id} (${String(item.weight)})`,
    )
    .join(", ");
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

/**
 * The domain contract: the one public document the Builder and the Examiner both work against. It is
 * frozen once the first exam is admitted, and its hash enters every condition. A frozen contract
 * changes only through the operator, and a change opens a new condition.
 *
 * Every check cites the rule ids it enforces, and the host confirms those ids exist here. Whether a
 * rule's statement says enough is not the host's to decide: it surfaces as a Referee dispute.
 *
 * A contract may state an objective: the quantity a task asks its solver to optimise, such as mass
 * (`docs/plan.md`, Phase 2). The checks say whether an answer is valid, and the objective says
 * which of two valid answers is the better one. v1 had no such thing and could seldom tell two
 * harnesses apart: 265 of 299 batteries passed every case (`docs/v1.md`). A check returns pass or
 * reject and no number (`check-child.ts`), so the value is the one a valid answer reports at
 * `path`, and it counts because a check, `verifiedBy`, recomputes it and rejects an answer that
 * misreports it. A solver that is not asked for the lightest design does not look for one, so the
 * objective is public and every role is told it in the same words (`objectiveLine`).
 */
import { validateToolArguments } from "@earendil-works/pi-ai/utils/validation";
import type { TSchema } from "typebox";
import { jsonPathTokens, resolveJsonPath } from "../meta/json-evidence.ts";
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { hashJsonValue, sameJsonValue } from "../meta/stable-json.ts";

export interface Rule {
  readonly id: string;
  readonly statement: string;
}

/** What the domain's tasks ask a solver to optimise, and when one valid answer beats another on it. */
export interface Objective {
  /** The quantity as a solver is told it: `mass`. */
  readonly quantity: string;
  readonly direction: "minimise" | "maximise";
  /** Where a valid answer reports the value, as a rooted path into the answer: `$.mass`. */
  readonly path: string;
  /** The id of the check that recomputes the reported value and rejects an answer that misreports
   *  it. Without one the value would be the solver's word. */
  readonly verifiedBy: string;
  /** The least difference that counts as better: the larger of an absolute amount and a share of
   *  the larger of the two values. The plan proposes the instruments' own tolerance until a scored
   *  round has measured how much repeated solves of one harness vary. */
  readonly margin: { readonly absolute: number; readonly relative: number };
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
  /** The stated objective, where the domain has one. Absent, two valid answers are equal. */
  readonly objective?: Objective;
}

const DIRECTIONS: ReadonlySet<string> = new Set(["minimise", "maximise"]);

/** The contract's identity: the hash of its canonical JSON. A rule id named twice would let a
 *  citation mean two requirements, so such a contract has none. */
export function contractHash(contract: Contract): string {
  answerSchema(contract);
  const unfit = contract.objective === undefined ? null : objectiveFault(contract.objective);
  if (unfit !== null) throw new Error(`the contract's objective ${unfit}`);
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

/** Why an objective cannot decide between two answers, or null when it can. */
function objectiveFault(objective: Objective): string | null {
  const { quantity, direction, path, verifiedBy, margin } = objective;
  if (quantity.trim() === "") return "names no quantity";
  if (!DIRECTIONS.has(direction)) {
    return `has the direction ${direction}, and one is minimise or maximise`;
  }
  if (jsonPathTokens(path) === null) return `reads ${path}, which is no rooted path into an answer`;
  if (verifiedBy.trim() === "") return "names no check that verifies the reported value";
  const sized = [margin.absolute, margin.relative].every((part) => Number.isFinite(part) && part >= 0);
  return sized ? null : "has a margin that is not two amounts of zero or more";
}

/** The objective as a solver, a Builder and an Examiner are each told it, in one sentence. */
export function objectiveLine({ quantity, direction, path }: Objective): string {
  const better = direction === "minimise" ? "lower" : "higher";
  return `Objective: ${direction} ${quantity}. Among answers that meet every rule, a ${better} ${quantity} is the better answer. An answer reports it at ${path}.`;
}

/** The objective value a valid answer reports, or null where it reports no finite number there. */
export function objectiveValue(objective: Objective, answer: JsonValue | undefined): number | null {
  const { found, value } = resolveJsonPath(answer, objective.path);
  return found && isNumber(value) && Number.isFinite(value) ? value : null;
}

/**
 * Whether value `a` beats value `b` on the objective: 1 when it does, -1 when `b` beats it, 0 when
 * neither is better by the margin. A value an answer did not report beats nothing and is beaten by
 * nothing: its answer is valid, and nobody can say how good.
 */
export function beats(objective: Objective, a: number | null, b: number | null): -1 | 0 | 1 {
  if (a === null || b === null) return 0;
  const least = Math.max(
    objective.margin.absolute,
    objective.margin.relative * Math.max(Math.abs(a), Math.abs(b)),
  );
  if (Math.abs(a - b) <= least) return 0;
  return a < b === (objective.direction === "minimise") ? 1 : -1;
}

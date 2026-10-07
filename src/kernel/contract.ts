/**
 * The domain contract: the one public document the Builder and the Examiner both work against. It is
 * frozen once the first exam is admitted, and its hash enters every condition. A frozen contract
 * changes only through the operator, and a change opens a new condition.
 *
 * Every check cites the rule ids it enforces, and the host confirms those ids exist here. Whether a
 * rule's statement says enough is not the host's to decide: it surfaces as a Referee dispute.
 */
import type { JsonValue } from "../meta/json-shape.ts";
import { hashJsonValue } from "../meta/stable-json.ts";

export interface Rule {
  readonly id: string;
  readonly statement: string;
}

export interface Contract {
  /** The schema every answer must follow. */
  readonly answerFormat: JsonValue;
  /** The practitioner's tools by name and version, and the script that installs them on both trees. */
  readonly tools: readonly { readonly name: string; readonly version: string }[];
  readonly install: string;
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
  const ids = contract.rules.map((rule) => rule.id);
  const twice = ids.find((id, index) => ids.indexOf(id) !== index);
  if (twice !== undefined) throw new Error(`the contract names rule ${twice} twice`);
  return hashJsonValue(contract);
}

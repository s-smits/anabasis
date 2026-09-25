/**
 * Named decisions in the brief and their field requirements, held beside the schema the way
 * `numeric-boundary.ts` holds its declaration: `brief.ts` names the field, this file owns what a
 * well-formed row is, and `published-rules.ts` owns what citing one means.
 *
 * A public rule had nowhere to go before this field existed. `decisions` is the coverage map and
 * reaches no reader, so a family's frame, ordering, threshold and bit-order rules could be stated
 * there and read by nobody, while the operating guide named them without defining them and every
 * submission failed. The split here makes a public correctness rule explicit and makes a private
 * decision declare that it is private: `public` rows are projected to the Built Harness and the
 * Judge through `briefPublicResources`, while `private` rows — search order, allocation recipe,
 * fallback chain, internal tie-breaks that do not determine correctness — reach neither model, and
 * no check may cite one.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { type ContractFinding, fieldFinding, finding } from "./brief.ts";
import { isRecord, isString, type JsonValue } from "../meta/json-shape.ts";

export type BriefRuleDecision = {
  id: string;
  /** Whether the public projection carries this statement. Only `public` may be cited. */
  visibility: "public" | "private";
  /** The rule exactly as a solver must read it; no protected truth or stored task answers. */
  statement: string;
  /** The exact public task paths the statement is about. A citing check must declare each one. */
  publicInputPaths?: string[];
  /** Families governed by this public rule, independently of any check's execution scope.
   * Missing only in historical briefs; fresh authoring requires an explicit non-empty list. */
  families?: string[];
};

const RULE_DECISION_VISIBILITIES = [
  "public",
  "private",
] as const satisfies readonly BriefRuleDecision["visibility"][];

const REQUIRED_DECISION_FIELDS = `{"id": non-empty string, "visibility": ${RULE_DECISION_VISIBILITIES.map((visibility) => capturedJsonStringify(visibility)).join(" or ")}, "statement": non-empty string}`;

/** The complete key set of BriefRuleDecision. A public row reaches the Built Harness and the Judge
 *  through the public projection, so an undeclared key could become a disclosure path and is
 *  not harmless extra text: a row carrying nested reference-artifact or verifier bytes satisfied
 *  every required-field test and then reached both models. The exact-key check
 *  is control-receipts.ts's, applied here at the earliest typed owner of these rows. */
const DECISION_KEYS: readonly string[] = ["id", "visibility", "statement", "publicInputPaths", "families"];

function wellFormedRow(row: JsonValue): boolean {
  return (
    isRecord(row) &&
    isString(row.id) &&
    row.id.trim() !== "" &&
    isString(row.statement) &&
    row.statement.trim() !== "" &&
    RULE_DECISION_VISIBILITIES.some((visibility) => visibility === row.visibility)
  );
}

/** The visibility word is the whole split, so it is checked against the closed pair rather than
 *  for truthiness: a row spelling it "Public" or `true` would otherwise read as private and
 *  silently withhold the rule it was written to publish. A citation resolves by id, so a repeated
 *  id — which would let one statement stand for two rules — is a finding of the same pass. */
export function ruleDecisionFieldFindings(rows: JsonValue[]): ContractFinding[] {
  const seen = new Set<string>();
  return rows.flatMap((row, i) => {
    const base = `ruleDecisions[${i}]`;
    if (!wellFormedRow(row)) return [fieldFinding(base, REQUIRED_DECISION_FIELDS, row)];
    // SAFETY: `wellFormedRow` returned true, which it does only for a record.
    const decision = row as Record<string, JsonValue>;
    const rowFindings: ContractFinding[] = [];
    const { id } = decision;
    if (isString(id)) {
      if (seen.has(id)) {
        rowFindings.push(finding("brief-duplicate-decision-id", `${base}.id`, `"${id}" declared twice`));
      }
      seen.add(id);
    }
    const undeclared = Object.keys(decision).filter((key) => !DECISION_KEYS.includes(key));
    if (undeclared.length > 0) {
      rowFindings.push(
        finding(
          "brief-decision-undeclared-field",
          base,
          `carries ${undeclared.map((key) => capturedJsonStringify(key)).join(", ")} beyond ${DECISION_KEYS.join(", ")}; a rule-decision row is published to the solver and the Judge exactly as written, so it may hold no other field`,
        ),
      );
    }
    const paths = decision.publicInputPaths;
    const { families } = decision;
    if (
      families !== undefined &&
      !(
        Array.isArray(families) &&
        families.length > 0 &&
        families.every((family) => isString(family) && family.trim() !== "") &&
        new Set(families).size === families.length
      )
    ) {
      rowFindings.push(
        fieldFinding(`${base}.families`, "a non-empty array of distinct family names", families),
      );
    }
    if (
      paths !== undefined &&
      !(Array.isArray(paths) && paths.every((path) => isString(path) && path.trim() !== ""))
    ) {
      rowFindings.push(
        fieldFinding(`${base}.publicInputPaths`, "an optional array of rooted public-input paths", paths),
      );
    }
    return rowFindings;
  });
}

/** Shape of one check's citation list. Semantics — is the cited row public, does this check read
 *  the paths it names — belong to published-rules.ts, which reads the projection. */
export function citedDecisionIdFindings(check: unknown, checkIndex: number): ContractFinding[] {
  if (!isRecord(check)) return [];
  const ids = check.citedDecisionIds;
  return ids === undefined ||
    (Array.isArray(ids) &&
      ids.length > 0 &&
      ids.every((id) => isString(id) && id.trim() !== "") &&
      new Set(ids).size === ids.length)
    ? []
    : [
        fieldFinding(
          `truthChecks[${checkIndex}].citedDecisionIds`,
          "an optional non-empty array of distinct ruleDecisions ids",
          ids,
        ),
      ];
}

// Gate audit 2026-09-25 (docs/gate-audit.md, published-rules): commented out (unsure): every truth check must
// cite a published rule decision; unsure the citation earns a refusal, since it cannot show the cited prose
// states what the check enforces.
// /**
//  * Check that each truth check cites a public rule the Built Harness can read. This validation
//  * runs while recording the candidate, before paid battery measurement.
//  *
//  * The defect it exists to refuse is a Builder keeping a correctness requirement private beside the
//  * implementation that enforces it. A frame format, an ordering constraint, a threshold, a bit order
//  * or a required join between two public fields gets stated in `correctness-model/brief.json` under
//  * `decisions`, which the public-resources projection withholds, while the operating guide names the
//  * thing without defining it. The check then rejects every submission in the family, and the solver
//  * had no way to read the rule it was failing.
//  *
//  * Two structural requirements connect each citation to the public projection:
//  *
//  *   - a cited decision the projection does not carry is refused, so marking a rule-carrying row
//  *     private and citing it anyway is a stated defect rather than a silent one;
//  *   - every check must cite at least one public decision. The implementation is private, so
//  *     a solver cannot recover the requirement by reading the program. The public assertion and
//  *     paths alone may also omit essential detail such as a frame format, ordering constraint
//  *     or required join. A cited decision provides a place to state that detail.
//  *
//  * Earlier contracts exempted some closed predicates, on the grounds that their declarations already
//  * exposed the operation. The current check-program contract requires a citation for every authored
//  * check instead, because which predicates are self-exposing was itself a judgement the author made.
//  *
//  * The requirement publishes the correctness statement while leaving the implementation private.
//  * Private decisions stay private. These structural checks establish citation availability; they
//  * do not establish that the prose fully describes the program's behaviour.
//  */
// import { type Brief, type BriefTruthCheck, type ContractFinding, finding } from "./brief.ts";
// import { publicRuleDecisions } from "./public-resources.ts";
//
// /** Resolve each citation to a public decision, without interpreting the rule's prose. */
// function citationFindings(
//   check: BriefTruthCheck,
//   index: number,
//   published: ReadonlySet<string>,
// ): ContractFinding[] {
//   return (check.citedDecisionIds ?? [])
//     .filter((decisionId) => !published.has(decisionId))
//     .map((decisionId) =>
//       finding(
//         "brief-cited-decision-withheld",
//         `truthChecks[${index}].citedDecisionIds`,
//         `truth check "${check.id}" cites decision "${decisionId}", which the public projection does not carry: either no ruleDecisions row declares that id, or the row declares "visibility": "private". A check may only enforce a rule the Built Harness can read, so publish the row or stop citing it`,
//       ),
//     );
// }
//
// /** Check that every citation resolves to a published decision and every check cites one.
//  *
//  *  A public rule's `families` stays optional public metadata, and nothing compares it with check
//  *  applicability. The reverse coverage rule that did, `brief-public-rule-family-uncovered`, is gone:
//  *  the Builder could satisfy it either by narrowing the list or by adding a citation, and it refused
//  *  a rule that governs a family whose checks legitimately cite a different rule. The census still
//  *  requires a failing reject for every applicable check in every family, which is the obligation
//  *  that actually bites. */
// export function publishedRuleFindings(brief: Brief): ContractFinding[] {
//   const published = new Set(publicRuleDecisions(brief).map((decision) => decision.id));
//   return brief.truthChecks.flatMap((check, index) => [
//     ...citationFindings(check, index, published),
//     ...((check.citedDecisionIds ?? []).length === 0
//       ? [
//           finding(
//             "brief-rule-unpublished",
//             `truthChecks[${index}].citedDecisionIds`,
//             `truth check "${check.id}" is an authored program. Cite at least one public ruleDecisions row stating the validity rule it enforces; the implementation stays private`,
//           ),
//         ]
//       : []),
//   ]);
// }

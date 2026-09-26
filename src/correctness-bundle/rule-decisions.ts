/**
 * Named decisions in the brief and their field requirements, held beside the schema the way
 * `numeric-boundary.ts` holds its declaration: `brief.ts` names the field, and this file owns both
 * what a well-formed row is and what citing one means.
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
import { type Brief, type ContractFinding, fieldFinding, finding } from "./brief.ts";
import { isRecord, isString, type JsonValue } from "../meta/json-shape.ts";

export type BriefRuleDecision = {
  id: string;
  /** Whether the public projection carries this statement. Only `public` may be cited. */
  visibility: "public" | "private";
  /** The rule exactly as a solver must read it; no protected truth or stored task answers. */
  statement: string;
  /** The exact public task paths the statement is about. Carried to the public projection as
   *  written; nothing requires a citing check to declare them. */
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

const BRIEF_ARTIFACT_ROOT_UNREAD = "brief-artifact-root-unread";
const BRIEF_CITED_DECISION_WITHHELD = "brief-cited-decision-withheld";

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

/** Shape of one check's citation list. Whether a cited row is declared and public is
 *  `withheldCitationFindings`'s. */
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

/**
 * R3, declared means graded. What the brief declares is what the Built Harness is told it will be
 * measured on, so two declarations have to reach a check. An artifact root no check reads can be
 * filled with anything, or left out, and every check still passes, so the solver is asked to write
 * a field that measures nothing. And a check citing only rules the public projection withholds, or
 * a rule no row declares, enforces something the solver never reads. A private row cited beside a
 * public one is a note on how the reference was built, and passes.
 *
 * Both compare the brief with itself, before any tool runs, and hold for a fresh build and a
 * continuation alike. A declared path does not prove a check uses what it reads; that stronger
 * question is the Epoch Reviewer's, which can probe a root and see whether any check moves.
 */

/** The one owner of which rule rows leave the brief: the projection and the citation rule both read
 *  it, so a candidate is never refused for withholding a statement the solver would have received. */
export function isPublicRule(decision: BriefRuleDecision): boolean {
  return decision.visibility === "public";
}

/** Roots no check reads, given the roots the checks declared, where "$" reads every root. Where no
 *  check exists, `brief-no-truth-checks` already reports it. */
export function unreadRootFindings(brief: Brief, readRoots: ReadonlySet<string>): ContractFinding[] {
  if (brief.truthChecks.length === 0 || readRoots.has("$")) return [];
  return brief.artifactSchema.flatMap((field, i) =>
    readRoots.has(field.name)
      ? []
      : [
          finding(
            BRIEF_ARTIFACT_ROOT_UNREAD,
            `artifactSchema[${i}].name`,
            `no truth check reads any path under artifactSchema field "${field.name}", so an agent may write anything there, or omit it, and still pass every check; declare a check over it or drop it from the artifact schema`,
          ),
        ],
  );
}

/** Citations of an undeclared row, and checks whose every citation is private, naming identities
 *  and never the statement. */
export function withheldCitationFindings(brief: Brief): ContractFinding[] {
  const rows = brief.ruleDecisions ?? [];
  const declared = new Set(rows.map((row) => row.id));
  const published = new Set(rows.filter(isPublicRule).map((row) => row.id));
  return brief.truthChecks.flatMap((check, i) => {
    const cited = check.citedDecisionIds ?? [];
    const path = `truthChecks[${i}].citedDecisionIds`;
    const undeclared = cited
      .filter((id) => !declared.has(id))
      .map((id) =>
        finding(
          BRIEF_CITED_DECISION_WITHHELD,
          path,
          `truth check "${check.id}" cites decision "${id}", which no ruleDecisions row declares; declare it as a public row or stop citing it`,
        ),
      );
    const allPrivate = cited.length > 0 && undeclared.length === 0 && !cited.some((id) => published.has(id));
    return allPrivate
      ? [
          finding(
            BRIEF_CITED_DECISION_WITHHELD,
            path,
            `truth check "${check.id}" cites only private decisions (${cited.join(", ")}), so the solver reads none of the rules it enforces; publish one or cite a public row`,
          ),
        ]
      : undeclared;
  });
}

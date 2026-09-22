/**
 * Check that each truth check cites a public rule the Built Harness can read. This validation
 * runs while recording the candidate, before paid battery measurement.
 *
 * Without this, a Builder can keep a correctness requirement private beside its implementation,
 * for example in `decisions`, which the public-resources projection withholds, and the solver
 * fails a rule it was never shown.
 *
 * Two structural requirements connect each citation to the public projection:
 *
 *   - a cited decision the projection does not carry is refused, so marking a rule-carrying row
 *     private and citing it anyway is a stated defect rather than a silent one;
 *   - every check must cite at least one public decision. The implementation is private, so
 *     a solver cannot recover the requirement by reading the program. The public assertion and
 *     paths alone may also omit essential detail such as a frame format, ordering constraint
 *     or required join. A cited decision provides a place to state that detail.
 *
 * The check-program contract requires a citation for every authored check.
 *
 * The requirement publishes the correctness statement while leaving the implementation private.
 * Private decisions stay private. These structural checks establish citation availability; they
 * do not establish that the prose fully describes the program's behaviour.
 */
import { type Brief, type BriefTruthCheck, type ContractFinding, finding } from "./brief.ts";
import { publicRuleDecisions } from "./public-resources.ts";

/** Resolve each citation to a public decision, without interpreting the rule's prose. */
function citationFindings(
  check: BriefTruthCheck,
  index: number,
  published: ReadonlySet<string>,
): ContractFinding[] {
  return (check.citedDecisionIds ?? [])
    .filter((decisionId) => !published.has(decisionId))
    .map((decisionId) =>
      finding(
        "brief-cited-decision-withheld",
        `truthChecks[${index}].citedDecisionIds`,
        `truth check "${check.id}" cites decision "${decisionId}", which the public projection does not carry: either no ruleDecisions row declares that id, or the row declares "visibility": "private". A check may only enforce a rule the Built Harness can read, so publish the row or stop citing it`,
      ),
    );
}

/** Check that every citation resolves to a published decision and every check cites one.
 *  A public rule's `families` stays optional public metadata and is not compared with check
 *  applicability; the census still needs a failing reject for every applicable check in every
 *  family. */
export function publishedRuleFindings(brief: Brief): ContractFinding[] {
  const published = new Set(publicRuleDecisions(brief).map((decision) => decision.id));
  return brief.truthChecks.flatMap((check, index) => [
    ...citationFindings(check, index, published),
    ...((check.citedDecisionIds ?? []).length === 0
      ? [
          finding(
            "brief-rule-unpublished",
            `truthChecks[${index}].citedDecisionIds`,
            `truth check "${check.id}" is an authored program. Cite at least one public ruleDecisions row stating the validity rule it enforces; the implementation stays private`,
          ),
        ]
      : []),
  ]);
}

/**
 * Check that each truth check cites a public rule the Built Harness can read. This validation
 * runs while recording the candidate, before paid battery measurement.
 *
 * Two runs paid for the same defect from opposite sides. run23's `panel-node` family scored
 * 0 of 35: its panel frame rules (first frame, change-only, ordering, fast setup) and its bargraph
 * threshold, bit-order and latch rules were stated in `correctness-model/brief.json` under
 * `decisions`, which the public-resources projection withholds, while the operating guide asked
 * for "change-only frames" without defining them; `panel-command-behaviour` then rejected 28 of
 * 28. The truss run enforced a member `areaId` to `usedAreas` join the brief states nowhere. In
 * both runs, the Builder kept a correctness requirement private alongside its implementation,
 * and validation did not refuse the missing public rule.
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
 * Earlier contracts exempted some closed predicates because their declarations exposed the
 * operation. The current check-program contract requires a citation for every authored check.
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
 *  A public rule's `families` stays optional public metadata. Its reverse coverage rule
 *  (`brief-public-rule-family-uncovered`, with the scope requirement feeding it) compared that
 *  list with check applicability: the Builder could satisfy it by narrowing the list or adding a
 *  citation, and it refused a rule governing a family whose checks cite a different rule (truss
 *  eaf98f, "model-resolution-rule" in "design-audit"). Removed 2026-09-15; the census still needs
 *  a failing reject for every applicable check in every family. */
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

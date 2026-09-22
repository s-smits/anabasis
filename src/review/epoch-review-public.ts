/** Authoring receives typed findings and the reviewed public obligations, never review prose. */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import type { AnalysisFinding, AnalysisFindingKind } from "../analyse/iteration-analysis.ts";
import type { ContestedCase } from "../analyse/judge-contested.ts";
import type { Brief } from "../truth/brief.ts";
import { publicRuleDecisions } from "../truth/public-resources.ts";
import type { EpochReviewEvidence } from "./epoch-review-findings.ts";
import { EVALUATION_SERVED, ownerWritableFiles, routableOwner } from "../author/feedback-routing.ts";

/** What the reviewed candidate supplies: the public contract, and the contested rows the review
 *  settled against it. */
type ReviewContract = {
  brief: Brief | null;
  vetoed?: readonly ContestedCase[];
  disputed?: readonly ContestedCase[];
  deferAdvisory?: boolean;
};

/** Hardness and an uncertain diagnosis describe what the review observed; neither demonstrates a
 *  defect, so neither may read as an order to edit the product. */
const isObservation = (kind: AnalysisFindingKind): boolean =>
  kind === "hardness" || kind === "diagnosis-uncertain";

/** What the finding asks of its owner. A demonstrated defect is repaired; a curriculum concern
 *  names the public input to move in the fresh battery, not an enforcement the tasks do not own;
 *  an observation asks for nothing. The curriculum sentence asks for variation across the
 *  battery's tasks, not for a published limit to move between batteries, which recorded runs show
 *  does not make a battery harder. */
function publicAct(kind: AnalysisFindingKind, deferred: boolean): string {
  if (deferred) return "this is advisory and asks for no change before submit";
  if (kind === "curriculum-defect") {
    return "let this input differ between the fresh battery's tasks; it does not ask for a published limit to move between batteries";
  }
  if (kind === "hardness") return "this records the measured difficulty there and asks for no repair";
  if (kind === "diagnosis-uncertain") {
    return "the review could not decide from its evidence whether that contract is met, which is an observation and not a demonstrated defect, and asks for no repair";
  }
  return "inspect and repair that contract";
}

/** Where the Builder acts, from the identity the finding names; owner and kind stay controller
 *  fields, since Builders act on the named check, input path or file rather than an owner label. */
function publicGroup(finding: AnalysisFinding): string {
  const owner = finding.proposedOwner;
  if (finding.kind === "curriculum-defect" || owner === "tests") return "tasks";
  if (finding.checkId !== undefined || finding.unobserved === true) return "evaluator";
  if (finding.publicInputPath !== undefined && finding.artifactSchemaPath === undefined) return "tasks";
  if (!routableOwner(owner)) return "unplaced";
  return EVALUATION_SERVED.has(owner) ? "evaluator" : "solver surface";
}

/** The public sentence for one finding, composed from typed identities alone; the reviewer's
 *  claim text never enters it. */
function publicFindingClaim(finding: AnalysisFinding, deferred: boolean, brief: Brief | null): string {
  const heading = `Epoch review (${publicGroup(finding)})`;
  const files = routableOwner(finding.proposedOwner) ? ownerWritableFiles(finding.proposedOwner) : [];
  const named = [
    ...(finding.checkId === undefined ? [] : [`check \`${finding.checkId}\``]),
    ...(finding.artifactSchemaPath === undefined ? [] : [`artifact path \`${finding.artifactSchemaPath}\``]),
  ].join(" at ");
  const inputPath =
    finding.publicInputPath === undefined ? null : `public input \`${finding.publicInputPath}\``;
  const input = inputPath === null ? "" : ` (${inputPath})`;
  if (finding.unobserved === true && !deferred) {
    // The obligation is unobserved, not the path, which declared checks may well read. The
    // readers are counted, never quoted.
    const path = finding.artifactSchemaPath;
    const readers = (brief?.truthChecks ?? []).filter((check) =>
      check.execution.artifactPaths.some((declared) => {
        const read = declared.replace(/^\$\.?/, "");
        return (
          path !== undefined && (read === path || path.startsWith(`${read}.`) || read.startsWith(`${path}.`))
        );
      }),
    ).length;
    const where = path === undefined ? "" : ` at artifact path \`${path}\``;
    const gap =
      readers === 0
        ? `no declared check observes the obligation the review traced${where}`
        : `none of the ${String(readers)} declared checks reading artifact path \`${path ?? ""}\` observes the obligation the review traced there`;
    return `${heading}: ${gap}${input}; add a check that observes what the delivered artifact does there.`;
  }
  if (named === "" && inputPath === null) {
    return `${heading}: ${files.length === 0 ? "no check, path or file named" : files.join(", ")}; ${isObservation(finding.kind) ? "it is an observation and asks for no repair" : deferred ? "it is advisory and asks for no change before submit" : "inspect that contract for a mismatch"}.`;
  }
  return `${heading}: ${named === "" ? (inputPath ?? "the contract") : `${named}${input}`}; ${publicAct(finding.kind, deferred)}.`;
}

/** The contested rows a finding settles: a harness-defect on a check the row names, over an
 *  artifact the reviewer opened. A second case naming the same check is not settled by reading
 *  the first, so the public counts and families come from the opened cases alone. */
function settledRows(
  finding: AnalysisFinding,
  rows: readonly ContestedCase[],
  opened: readonly string[],
): ContestedCase[] {
  if (finding.kind !== "harness-defect" || finding.checkId === undefined) return [];
  return rows.filter(
    (row) =>
      row.checkIds.includes(finding.checkId ?? "") && row.artifact !== null && opened.includes(row.artifact),
  );
}

function familiesOf(rows: readonly ContestedCase[]): string {
  return [...new Set(rows.map((row) => row.family))].sort().join(", ");
}

/** One finding's public sentence: the claim, then whatever typed context the reviewed contract
 *  and the settled contested rows supply. Every branch decides what may cross, so it stays one
 *  function. */
function publicFinding(
  finding: AnalysisFinding,
  contract: ReviewContract,
  vetoed: readonly ContestedCase[],
  disputed: readonly ContestedCase[],
  opened: readonly string[],
) {
  const deferred = contract.deferAdvisory === true && finding.severity === "advisory";
  const repairable = !deferred && !isObservation(finding.kind) && finding.kind !== "curriculum-defect";
  const check = contract.brief?.truthChecks.find((candidate) => candidate.id === finding.checkId);
  const rules =
    contract.brief === null || check === undefined
      ? []
      : publicRuleDecisions(contract.brief).filter(
          (rule) => check.citedDecisionIds?.includes(rule.id) === true,
        );
  // Only the reviewed public contract supplies these bytes; private review prose never does.
  // The obligation is quoted only beside a repair, since a finding that asks for none needs no
  // more than its check id.
  const obligation =
    check === undefined || !repairable
      ? []
      : [
          `Declared public obligation: ${capturedJsonStringify({
            assertion: check.assertion,
            rules: rules.map((rule) => ({ id: rule.id, statement: rule.statement })),
          })}`,
        ];
  // A settled veto crosses as its public shape alone: how many verified passes, in which
  // families. The Judge's reason and the review's demonstration stay private.
  const vetoes = settledRows(finding, vetoed, opened);
  const veto =
    vetoes.length === 0
      ? []
      : [
          `The Judge failed ${String(vetoes.length)} verified pass(es) in ${familiesOf(vetoes)} citing this obligation, and the review settled them against the check: it passes an artifact the obligation refuses.`,
        ];
  const disputes = settledRows(finding, disputed, opened);
  const dispute =
    disputes.length === 0
      ? []
      : [
          `The Judge passed ${String(disputes.length)} verified fail(s) in ${familiesOf(disputes)} holding this obligation satisfied, and the review settled them against the check: it refuses an artifact the obligation admits.`,
        ];
  // What the probes executed, in public identities only: the accept control, the path and the
  // declared checks that moved. It rides with advisory findings too, so a probe-backed finding
  // held at advice still shows the author more than a check name.
  const probed =
    isObservation(finding.kind) || (finding.probes ?? []).length === 0
      ? []
      : [
          `Executed against this candidate's own declared checks: ${(finding.probes ?? [])
            .map(
              (probe) =>
                `changing ${probe.path} on accept control ${probe.controlId} ${
                  probe.movedCheckIds.length === 0
                    ? "moved no declared check"
                    : `moved ${[...probe.movedCheckIds].sort().join(", ")}`
                }`,
            )
            .join("; ")}.`,
        ];
  // The request is not repeated here; every prompt that renders these rows states it once.
  const context = [...obligation, ...veto, ...dispute];
  // The repair instruction rides only with a demonstrated defect.
  const repair =
    !repairable || (context.length === 0 && contract.deferAdvisory !== true)
      ? []
      : [
          "Repair the complete public obligation. Retain a valid alternative and a plausible counterexample that distinguish the repair; a neighbouring correction does not establish closure.",
        ];
  return {
    ...finding,
    claim: [publicFindingClaim(finding, deferred, contract.brief), ...context, ...probed, ...repair].join(
      "\n",
    ),
  };
}

/** Private review prose stays in its recorded evidence; only typed routing reaches authoring.
 *  With `deferAdvisory`, an advisory finding asks for no change before submit and carries no
 *  repair order, because Builders otherwise repair it at once and pay a fresh full check. */
export function publicEpochReview(
  review: Pick<EpochReviewEvidence, "status" | "findings" | "disputes"> & {
    contestedReads?: readonly string[];
  },
  contract: ReviewContract = { brief: null },
) {
  const vetoed = contract.vetoed ?? [];
  const disputed = contract.disputed ?? [];
  const opened = review.contestedReads ?? [];
  // An unfinished review has not weighed the whole contract, so its findings stay private. The
  // exception is a contested case settled after opening its artifact, which crosses as advice
  // only, since the tools that review could not read may own the check.
  const settled =
    review.status === "completed"
      ? review.findings
      : review.findings.flatMap((finding) => {
          const read = settledRows(finding, [...vetoed, ...disputed], opened).length > 0;
          return read ? [{ ...finding, severity: "advisory" as const }] : [];
        });
  return {
    findings: settled.map((finding) => publicFinding(finding, contract, vetoed, disputed, opened)),
    disputes:
      review.status === "completed"
        ? review.disputes.map(({ issueId }) => ({
            issueId,
            reason: "The epoch review disputes this issue as an evaluation defect.",
          }))
        : [],
  };
}

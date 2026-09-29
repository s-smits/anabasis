/** Authoring receives typed findings and the reviewed public obligations, never review prose. */
import { jsonPathTokens } from "../meta/json-evidence.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import type { AnalysisFinding, DemandGap, ProbeDirection } from "../analyse/iteration-analysis.ts";
import type { Brief } from "../correctness-bundle/brief.ts";
import { publicRuleDecisions } from "../correctness-bundle/public-resources.ts";
import type { CaseDisposition, EpochReviewEvidence } from "./epoch-review-findings.ts";
import { adviceIssueId } from "../author/rebuild-advice.ts";

/** What the reviewed candidate supplies: the public contract its findings are read against. */
type ReviewContract = { brief: Brief | null };

/** Said of every finding an unfinished review recorded, which is advice whatever severity the
 *  review asked for: it had not read everything it was held to, so it may be missing what decides. */
const UNFINISHED_REVIEW =
  "The review that recorded this did not finish reading the source, so it is advice and settles no Judge disagreement.";

/** Each recognised shape as the sentence the author reads. The shape is a typed choice from a closed
 *  set, so its sentence is fixed text and crosses where the reviewer's own claim does not. */
const DEMAND_GAP_SENTENCES: Record<DemandGap, string> = {
  "capability-unexercised": "The request names a capability no task in the battery exercises.",
  "sibling-values-only": "Sibling tasks differ only in the values they publish.",
  "limit-cleared-widely": "The first reasonable candidate clears a published limit widely.",
  "rule-outside-request": "A rule stands that no practitioner of the request would hold.",
  "published-scenario-only":
    "The checks observe only the inputs the task publishes, so an answer that reproduces the published outputs without reading its inputs passes.",
};

/** Which way a probe-backed check is wrong, as the author reads it, or that the cited probes do not
 *  say. The moved checks read the same either way, so the direction crosses as fixed text keyed by
 *  the typed field; the probe's value, its edit and the reviewer's reading of it stay private. The
 *  repair each direction calls for is the author's to choose. */
const PROBE_DIRECTION_SENTENCES: Record<ProbeDirection | "unresolved", string> = {
  "rejects-valid":
    "The review's probe wrote an answer the published rule allows, and the check refused it: a false rejection.",
  "accepts-invalid":
    "The review's probe wrote an answer the published rule forbids, and the check let it through: a false acceptance.",
  unresolved:
    "The cited probes do not establish whether a check refused a valid answer or let an invalid one through.",
};

/** The public sentence for one finding, composed from typed identities alone: the file the review
 *  named, what in it the finding is about, and whether it is a defect. It names no repair, because
 *  the author chooses the repair. The check id, schema path and public input paths are public
 *  authoring identities, so they cross; the reviewer's claim is not one and never enters this
 *  sentence. */
function publicFindingClaim(finding: AnalysisFinding, brief: Brief | null): string {
  const heading = `Epoch review (${finding.owner ?? "no file named"})`;
  const kind = finding.defect ? "a defect" : "an observation, not a demonstrated defect";
  const named = [
    ...(finding.checkId === undefined ? [] : [`check \`${finding.checkId}\``]),
    ...(finding.artifactSchemaPath === undefined ? [] : [`artifact path \`${finding.artifactSchemaPath}\``]),
  ].join(" at ");
  const inputPath =
    finding.publicInputPath === undefined
      ? null
      : finding.secondPublicInputPath === undefined
        ? `public input \`${finding.publicInputPath}\``
        : `public inputs \`${finding.publicInputPath}\` and \`${finding.secondPublicInputPath}\``;
  const input = inputPath === null ? "" : ` (${inputPath})`;
  if (finding.unobserved === true) {
    // The obligation is unobserved, not the path. "No declared check observes artifact path `x`"
    // is plainly false to an author whose checks all read `x`, and a finding that reads as nonsense
    // is a finding acted on by nobody. So the readers are counted here, which contradicts the bare
    // sentence, and never quoted, which would carry verifier detail across.
    const path = finding.artifactSchemaPath;
    const readers = (brief?.truthChecks ?? []).filter((check) =>
      check.execution.artifactPaths.some((declared) => {
        // Through the validator's own tokeniser, so `$['pins']` reads as `pins` does.
        const read = (jsonPathTokens(declared) ?? []).join("").replace(/^\./, "");
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
    return `${heading}: ${gap}${input}; ${kind}.`;
  }
  return `${heading}: ${named === "" ? (inputPath ?? "no check or path named") : `${named}${input}`}; ${kind}.`;
}

function familiesOf(rows: readonly CaseDisposition[]): string {
  return [...new Set(rows.map((row) => row.family))].sort().join(", ");
}

/** What one finding settled, as the author reads it: how many cases in which families, and which
 *  way. The Judge's reason, the case identities and the probe's values stay private. */
function settlementLines(settled: readonly CaseDisposition[]): string[] {
  const of = (disposition: CaseDisposition["disposition"], veto?: boolean) =>
    settled.filter(
      (row) => row.disposition === disposition && (veto === undefined || (row.kind === "veto") === veto),
    );
  const [stands, vetoes, disputes] = [
    of("check-stands"),
    of("against-check", true),
    of("against-check", false),
  ];
  return [
    ...(stands.length === 0
      ? []
      : [
          `The review settled the Judge's disagreement on ${String(stands.length)} case(s) in ${familiesOf(stands)} in the check's favour: the check stands as declared.`,
        ]),
    ...(vetoes.length === 0
      ? []
      : [
          `The Judge failed ${String(vetoes.length)} verified pass(es) in ${familiesOf(vetoes)} citing this obligation, and the review settled them against the check: it passes an artifact the obligation refuses.`,
        ]),
    ...(disputes.length === 0
      ? []
      : [
          `The Judge did not fail ${String(disputes.length)} verified fail(s) in ${familiesOf(disputes)} on this obligation, and the review settled them against the check: it refuses an artifact the obligation admits.`,
        ]),
  ];
}

/** One finding's public sentence: the claim, then whatever typed context the reviewed contract and
 *  the settled contested rows supply. Every branch here decides what may cross to an authoring
 *  prompt, so it stays one function rather than five that each answer part of that question. */
function publicFinding(
  finding: AnalysisFinding,
  contract: ReviewContract,
  settled: readonly CaseDisposition[],
) {
  const check = contract.brief?.truthChecks.find((candidate) => candidate.id === finding.checkId);
  const rules =
    contract.brief === null || check === undefined
      ? []
      : publicRuleDecisions(contract.brief).filter(
          (rule) => check.citedDecisionIds?.includes(rule.id) === true,
        );
  // Only the reviewed public contract supplies these bytes. Private review prose cannot supply an
  // obligation or a counterexample.
  //
  // A defect naming a declared check carries that check's public obligation, which is the scope
  // of what the review found. An observation carries none: quoting the check back at the author
  // who wrote it, beside a reading that demonstrated nothing, repeats on every round and crowds
  // out everything else the rebuild author reads.
  const obligation =
    check === undefined || !finding.defect
      ? []
      : [
          `Declared public obligation: ${capturedJsonStringify({
            assertion: check.assertion,
            rules: rules.map((rule) => ({ id: rule.id, statement: rule.statement })),
          })}`,
        ];
  // What the probes executed, and which way they show the check wrong, or that they do not say. The
  // three identities here are the class the check id already crosses by — an accept control the
  // Builder wrote, a dotted path under its own artifactSchema root, and its own declared check ids.
  // It rides with an advisory defect too: a probe is the review's strongest evidence, and without
  // this line the author reads a check name with nothing behind it.
  const probed =
    !finding.defect || (finding.probes ?? []).length === 0
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
          PROBE_DIRECTION_SENTENCES[finding.probeDirection ?? "unresolved"],
        ];
  // The request is not repeated here. Every prompt that renders these rows states it once under its
  // own heading, and a copy per finding puts it several times into one authoring prompt, in front
  // of each sentence the author has to act on. One duty, one owner (rule 14).
  return {
    ...finding,
    claim: [
      publicFindingClaim(finding, contract.brief),
      ...(finding.demandGap === undefined ? [] : [DEMAND_GAP_SENTENCES[finding.demandGap]]),
      ...obligation,
      ...settlementLines(settled),
      ...probed,
    ].join("\n"),
  };
}

/** Private review prose stays in its recorded evidence; only typed findings reach authoring. Each
 *  crosses as what the review supported and where — the file, the identity, the public obligation,
 *  the probes' direction, the families and counts of the cases it settled — and never as a repair to
 *  make: the author reads the evidence and chooses what to change.
 *
 *  A review that finished its reading routes what it recorded. One that did not still hands every
 *  admitted finding across, since each passed the same admission, but as advice, with no settlement
 *  and no dispute: whatever it did not read may be what decides. */
export function publicEpochReview(
  review: Pick<EpochReviewEvidence, "status" | "findings" | "disputes"> & {
    dispositions?: readonly CaseDisposition[];
  },
  contract: ReviewContract = { brief: null },
) {
  const finished = review.status === "completed";
  const settled = finished ? (review.dispositions ?? []) : [];
  return {
    findings: review.findings.map((finding, index) => {
      const projected = publicFinding(
        finding,
        contract,
        settled.filter((row) => row.finding === index),
      );
      return finished
        ? projected
        : { ...projected, severity: "advisory" as const, claim: `${projected.claim}\n${UNFINISHED_REVIEW}` };
    }),
    disputes: finished
      ? review.disputes.map(({ issueId }) => ({
          issueId,
          reason: "The epoch review disputes this issue as an evaluation defect.",
        }))
      : [],
    settledJudge: settledJudgeIssues(settled),
  };
}

/** The Judge issue each settled kind counts towards. An undecided dispute counts towards none: the
 *  advice raises no issue on an undecided, so settling one must not settle a Judge pass beside it. */
const JUDGE_ISSUE = {
  veto: "judge-failed-verifier-passed",
  "disputed-pass": "judge-passed-verifier-failed",
  "disputed-undecided": null,
} as const;

/** The Judge issue ids a completed review settled in the check's favour, one per settled case, in
 *  the id form the rebuild advice keys its Judge issues by: one per family and the side the Judge
 *  took. A case is settled at most once (`caseSettlement`), so the advice settles an issue once
 *  every case it counts appears here. */
function settledJudgeIssues(settled: readonly CaseDisposition[]) {
  return settled
    .flatMap((row) => {
      const kind = JUDGE_ISSUE[row.kind];
      return row.disposition === "check-stands" && kind !== null
        ? [adviceIssueId(kind, row.family, null)]
        : [];
    })
    .sort();
}

/** Earlier task-set findings over the task set now under review, each in the public form its round's
 *  Builder read. Shown to the reviewer rather than to the author: the author already received them,
 *  and the reviewer is the one reading whether an unchanged battery left them standing. */
export function earlierTaskFindingLines(
  rows: ReadonlyArray<{ runId: string; findings: AnalysisFinding[] }>,
): string[] {
  if (rows.length === 0) return [];
  return [
    "Earlier reviews of this same task set (its taskSetHash is unchanged) recorded these correctness-model/tasks.json findings, as the Builder read them. The tasks did not change since, so read whether each still stands before recording it again:",
    ...rows.flatMap(({ runId, findings }) =>
      publicEpochReview({ status: "completed", findings, disputes: [] }).findings.map(
        (finding) => `- ${runId}: ${finding.claim.replaceAll("\n", " ")}`,
      ),
    ),
  ];
}

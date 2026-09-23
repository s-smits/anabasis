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
 *  defect, so neither may read as an order to edit the product. Under the ordinary sentence a
 *  diagnosis-uncertain finding reaches the Builder as "inspect and repair that contract" followed
 *  by the blanket repair instruction, which is an order built out of an admitted uncertainty. */
const isObservation = (kind: AnalysisFindingKind): boolean =>
  kind === "hardness" || kind === "diagnosis-uncertain";

/** What the finding asks of its owner. A demonstrated defect is repaired; a curriculum concern
 *  names the public input to move in the fresh battery, not an enforcement the tasks do not own;
 *  an observation asks for nothing.
 *
 *  The curriculum sentence says which way to vary, because the vague form does harm. "Vary this in
 *  the fresh battery", read against a published limit, invites the author to move that limit from
 *  one battery to the next, which changes the published magnitudes over a task set that has not
 *  moved and leaves the battery exactly as easy as it was. The variation this finding is about is
 *  across the battery's own tasks, which authoring validation already requires of a shared public
 *  input. */
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
 *  fields. The owner label decides nothing on its own — one finding can move from brief to
 *  correctness-model and back between rounds — and a Builder acts on the check id, input path or
 *  file beside the label rather than on the label itself. */
function publicGroup(finding: AnalysisFinding): string {
  const owner = finding.proposedOwner;
  if (finding.kind === "curriculum-defect" || owner === "tests") return "tasks";
  if (finding.checkId !== undefined || finding.unobserved === true) return "evaluator";
  if (finding.publicInputPath !== undefined && finding.artifactSchemaPath === undefined) return "tasks";
  if (!routableOwner(owner)) return "unplaced";
  return EVALUATION_SERVED.has(owner) ? "evaluator" : "solver surface";
}

/** The public sentence for one finding, composed from typed identities alone. A template sentence
 *  that names none of them tells the Builder nothing, and an author with nothing to act on
 *  resubmits unchanged bytes as a probe. The check id, schema path and public input path are public
 *  authoring identities, so they cross; the reviewer's claim is not one and never enters this
 *  sentence. */
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
    // The obligation is unobserved, not the path. "No declared check observes artifact path `x`"
    // is plainly false to an author whose checks all read `x`, and a finding that reads as nonsense
    // is a finding acted on by nobody. So the readers are counted here, which contradicts the bare
    // sentence, and never quoted, which would carry verifier detail across.
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

/** One finding's public sentence: the claim, then whatever typed context the reviewed contract and
 *  the settled contested rows supply. Every branch here decides what may cross to an authoring
 *  prompt, so it stays one function rather than five that each answer part of that question. */
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
  // Only the reviewed public contract supplies these bytes. Private review prose cannot supply an
  // obligation, a counterexample or a repair instruction.
  //
  // The obligation rides with the repair it was added to bind. A finding that asks for no repair
  // has nothing to bind it to, and quoting the check back at the author who wrote it fills the
  // packet instead: a long assertion beside "asks for no repair" can be most of what the rebuild
  // author reads, and it points at the evaluator in rounds where the tasks were the thing to move.
  // The check id already names the file the author owns.
  const obligation =
    check === undefined || !repairable
      ? []
      : [
          `Declared public obligation: ${capturedJsonStringify({
            assertion: check.assertion,
            rules: rules.map((rule) => ({ id: rule.id, statement: rule.statement })),
          })}`,
        ];
  // A defect the reviewer recorded on a check the Judge had vetoed carries the veto's public
  // shape: how many verified passes, in which families. The Judge's reason and the review's
  // demonstration stay private; the count and the family are what the Builder needs to know which
  // artifacts the check let through.
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
  // What the probes executed, for a defect the author is being asked to look at. A defect survives
  // the two-occurrence ceiling on forced blocking when the public projection supplies only its
  // check name: the review has run the checks over its own changed field and the author reads a
  // check id. The three identities here are the class the check id already crosses by — an accept
  // control the Builder wrote, a dotted path under its own artifactSchema root, and its own
  // declared check ids.
  //
  // It rides with an advisory finding too, deferred or not, and that is the case it is for: a
  // probe-backed finding held at advice because the same check has been named twice already.
  // Without this line the round projects that check name a third time, which is the repetition the
  // ceiling exists to stop.
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
  // The request is not repeated here. Every prompt that renders these rows states it once under its
  // own heading, and a copy per finding puts it several times into one authoring prompt, in front
  // of each sentence the author has to act on. One duty, one owner (rule 14).
  const context = [...obligation, ...veto, ...dispute];
  // The repair instruction rides only with a demonstrated defect — which, until the request left
  // this list, was every repairable finding, since `context` could not then be empty.
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
 *  `deferAdvisory` is the authoring review's reading: an advisory finding asks for no change before
 *  submit and carries no repair order, because a Builder that meets one mid-session repairs it at
 *  once and pays a fresh full check for it, spending gate time on advice that was never asked to be
 *  acted on before submit. */
export function publicEpochReview(
  review: Pick<EpochReviewEvidence, "status" | "findings" | "disputes"> & {
    contestedReads?: readonly string[];
  },
  contract: ReviewContract = { brief: null },
) {
  const vetoed = contract.vetoed ?? [];
  const disputed = contract.disputed ?? [];
  const opened = review.contestedReads ?? [];
  // An unfinished review has not weighed the complete contract, so its observations stay private:
  // neither an owner reopen nor a suspended diagnosis may come from a partial reading. One reading
  // is complete on its own, and that is a vetoed case the reviewer settled against the check after
  // opening the vetoed artifact — a review cut short by a vanished `.toolchain` can still have done
  // that much. The settlement crosses as advice rather than as a reopen, since whatever the review
  // could not read may be what owns the check.
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

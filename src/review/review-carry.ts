/**
 * What one review hands the next, and what the next records of it.
 *
 * An authoring review hands the next review of its round the probes its findings rested on and the
 * checks those findings named, which the next orientation renders. Every completed review also
 * leaves its advisory defects for the next review to dispose of. An advisory defect reopens
 * nothing, and one the next review did not name again used to leave no trace at all, so a defect
 * the reviewer stopped mentioning read the same as one that had been repaired. The next completed
 * review's record now says which it was, host-side and from public identities alone, and nothing
 * here reaches a prompt.
 *
 * Absent is not fixed. A review that did not name a defect measured nothing about it, and only a
 * battery run under the condition that observed a failure can settle one. Nor does anything here
 * change a severity, which reads each finding's own evidence alone (`record_finding`), and this
 * record is what an operator reads to decide whether an advisory defect that keeps standing matters.
 */
import { findingSeverity } from "../analyse/finding-owner.ts";
import { type AnalysisFinding, namedSubject } from "../analyse/iteration-analysis.ts";
import type { ReviewProbeRow } from "./review-probe.ts";

type Severity = "blocking" | "advisory";

/** The part of a recorded review that the next one reads. */
type CarriedReview = {
  runId: string;
  status: string;
  probes?: readonly ReviewProbeRow[] | undefined;
  findings: readonly AnalysisFinding[];
};

/** An advisory defect a completed review recorded: the review, the file it named, and what it
 *  named in that file — its check, a path below a declared root, or the public input it named — or
 *  null when it named none of them. */
export type AdvisoryDefect = { runId: string; owner: string; subject: string | null };

/** One earlier advisory defect as the next completed review left it. `standing`: the review named
 *  the same subject as a defect again, admitted at `severity`. `observation`: it named the subject,
 *  but not as a defect. `unmatched`: the defect named no subject and the review named its file
 *  again, so whether the two are one defect cannot be read. `absent`: it named nothing the defect
 *  could be. */
export type AdvisoryDisposition = AdvisoryDefect & {
  disposition: "standing" | "observation" | "unmatched" | "absent";
  severity?: Severity;
};

/** What a completed review records of the earlier review's advisory defects. */
type AdvisoryRecord = { earlierAdvisory?: AdvisoryDisposition[] };

/** What an authoring review hands the next one of its round: the probes its recorded findings
 *  rested on, the declared check each finding named with the severity it was admitted at, and its
 *  advisory defects. */
export interface Demonstrations {
  probes: readonly ReviewProbeRow[];
  named: ReadonlyArray<{ checkId: string; severity: Severity }>;
  advisory: readonly AdvisoryDefect[];
}

/** What the first review of a round is handed. */
export const NOTHING_CARRIED: Demonstrations = { probes: [], named: [], advisory: [] };

const subjectOf = (finding: AnalysisFinding) => namedSubject(finding) ?? finding.publicInputPath ?? null;

/** A completed review's advisory defects, one per file and subject. An unfinished review's findings
 *  never reached the Builder, so it leaves none. */
export function advisoryDefects(review: CarriedReview): AdvisoryDefect[] {
  if (review.status !== "completed") return [];
  const keyed = new Map<string, AdvisoryDefect>();
  for (const finding of review.findings) {
    if (!finding.defect || finding.owner === null || findingSeverity(finding) !== "advisory") continue;
    const subject = subjectOf(finding);
    keyed.set(`${finding.owner} ${subject ?? ""}`, { runId: review.runId, owner: finding.owner, subject });
  }
  return [...keyed.values()];
}

/**
 * What an authoring review hands the next one of its round, or null when it neither finished nor
 * admitted a finding: it weighed nothing, so the set the one before it carried still stands. A
 * failed turn's admitted findings carry as an incomplete review's do, and a finished review that
 * rested nothing on a probe and named no check carries empty sets, which ends the chain.
 */
export function carriedDemonstrations(review: CarriedReview): Demonstrations | null {
  const finished = review.status === "completed" || review.status === "incomplete";
  if (!finished && review.findings.length === 0) return null;
  return {
    probes: (review.probes ?? []).filter((row) => row.cited === true),
    named: review.findings.flatMap((finding) =>
      finding.checkId === undefined ? [] : [{ checkId: finding.checkId, severity: findingSeverity(finding) }],
    ),
    advisory: advisoryDefects(review),
  };
}

function disposed(defect: AdvisoryDefect, findings: readonly AnalysisFinding[]): AdvisoryDisposition {
  const same = findings.filter((finding) =>
    defect.subject === null ? finding.owner === defect.owner : subjectOf(finding) === defect.subject,
  );
  const defects = same.filter((finding) => finding.defect);
  if (same.length === 0) return { ...defect, disposition: "absent" };
  if (defect.subject === null) return { ...defect, disposition: "unmatched" };
  if (defects.length === 0) return { ...defect, disposition: "observation" };
  const blocking = defects.some((finding) => findingSeverity(finding) === "blocking");
  return { ...defect, disposition: "standing", severity: blocking ? "blocking" : "advisory" };
}

/** The record a review adds for the earlier review's advisory defects: nothing unless this review
 *  completed, since an unfinished one has weighed nothing it could leave absent. */
export function advisoryRecord(
  review: Pick<CarriedReview, "status" | "findings">,
  earlier: readonly AdvisoryDefect[],
): AdvisoryRecord {
  if (review.status !== "completed" || earlier.length === 0) return {};
  return { earlierAdvisory: earlier.map((defect) => disposed(defect, review.findings)) };
}

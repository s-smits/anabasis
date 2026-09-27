/**
 * The one duty a battery above the aim puts on its review, and whether the review met it.
 *
 * The standing prompt already says that at or above the aim "nothing demonstrated" is no answer: the
 * reviewer either records one advisory defect owned by the task set naming what the request demands
 * and the tasks leave undemanded, or accounts in its closing message, family by family, for what each
 * family demands. A sentence in a long system prompt is easy to finish past, and a review that ends
 * with neither leaves the campaign with no reading of the one question its placement opened. So the
 * host checks the ending it can observe — a task-set defect on record, or a closing message naming
 * every family of the battery — and asks once more when neither is there. It asks once: a second
 * refusal is the reviewer's answer, and it is recorded as undischarged rather than argued with.
 */
import { TASKS_FILE } from "../meta/bundle-layout.ts";
import type { AnalysisFinding } from "../analyse/iteration-analysis.ts";

export type AboveAimDuty = "finding" | "accounted" | "undischarged";

/** How the review ended against the duty: a task-set defect recorded, every battery family named in
 *  the closing message, or neither. Naming a family is what the host can check; whether the account
 *  given for it holds is the next reader's to weigh. */
export function aboveAimDuty(
  findings: readonly AnalysisFinding[],
  families: readonly string[],
  text: string,
): AboveAimDuty {
  if (findings.some((finding) => finding.defect && finding.owner === TASKS_FILE)) return "finding";
  return families.length > 0 && families.every((family) => text.includes(family))
    ? "accounted"
    : "undischarged";
}

/** The continuation that restates the duty, once, to a review above the aim that ended with neither
 *  a task-set defect nor a per-family account. Null for a review not above the aim. */
export function aboveAimContinuation(
  findings: readonly AnalysisFinding[],
  families: readonly string[],
): ((text: string) => string | null) | null {
  let asked = false;
  return (text) => {
    if (asked || aboveAimDuty(findings, families, text) !== "undischarged") return null;
    asked = true;
    return `This battery placed above the aim, and the review has not yet said what the original request demands that the tasks do not. Either record one advisory defect owned by ${TASKS_FILE} naming that obligation, or reply with your complete closing message and include, for each family (${families.join(", ")}), the obligation of the request it demands and why none is left. Your reply replaces the earlier closing message as the review's report.`;
  };
}

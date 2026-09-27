/**
 * The duties a review owes beyond its findings, and whether its closing message met them.
 *
 * Two duties are checked by the host rather than left to a sentence in a long system prompt, which
 * is easy to finish past. Above the aim, "nothing demonstrated" is no answer: the reviewer either
 * records one advisory defect owned by the task set naming what the request demands and the tasks
 * leave undemanded, or accounts in its closing message, family by family, for what each family
 * demands. And at every placement, each clause of the one-line request is disposed of: the declared
 * check that enforces it, or `unchecked`, and whether some task makes the clause decide a verdict. A
 * clause mapped to a check can still decide nothing — a nonlinear check over deflections too small
 * for the nonlinear terms to matter, a reversing load that never flips a member's force — so the
 * mapping alone is not the answer.
 *
 * The host checks the ending it can observe and asks once more, for every duty left undischarged in
 * one message. It asks once: a second refusal is the reviewer's answer, and it is recorded rather
 * than argued with. Everything here is built from public text — the request, the family names and
 * the declared check ids.
 */
import { EVALUATOR_FILE, TASKS_FILE } from "../meta/bundle-layout.ts";
import type { AnalysisFinding } from "../analyse/iteration-analysis.ts";

export type AboveAimDuty = "finding" | "accounted" | "undischarged";

type ClauseVerdict = "yes" | "no" | "unknown";

/** One request clause as the closing message disposed of it: the declared check or `unchecked`, and
 *  whether a task makes it decide a verdict. Null where the message gave no valid disposal. */
export type ClauseDisposal = {
  clause: string;
  check: string | null;
  decides: ClauseVerdict | null;
};

/** One duty's reading of a closing message: the sentence restating what is still owed, or null. */
type DutyAsk = (text: string) => string | null;

const MAX_CLAUSES = 12;
const DISPOSAL_LINE =
  /^[\s>*-]*clause\s+(\d+)\s*:\s*`?([^\s`;,]+)`?\s*[;,]\s*decides\s*:?\s*(yes|no|unknown)\b/gim;

/** How the review ended against the above-aim duty: a task-set defect recorded, every battery family
 *  named in the closing message, or neither. Naming a family is what the host can check; whether
 *  the account given for it holds is the next reader's to weigh. */
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

/** The above-aim duty's restatement, while it is undischarged. */
export function aboveAimAsk(findings: readonly AnalysisFinding[], families: readonly string[]): DutyAsk {
  return (text) =>
    aboveAimDuty(findings, families, text) === "undischarged"
      ? `This battery placed above the aim, and the review has not yet said what the original request demands that the tasks do not. Either record one advisory defect owned by ${TASKS_FILE} naming that obligation, or include, for each family (${families.join(", ")}), the obligation of the request it demands and why none is left.`
      : null;
}

/** The clauses of the one-line request, split at its commas, semicolons and the word "and". The
 *  request carries no decomposition of its own and neither does the brief, so this is the split a
 *  reader of the sentence would make; a clause the split cuts badly is still one the reviewer can
 *  dispose of, and at most twelve are asked for. */
export function requestClauses(request: string | null): string[] {
  if (request === null) return [];
  return request
    .split(/[,;]|\band\b/i)
    .map((clause) => clause.trim().replace(/\.$/, ""))
    .filter((clause) => clause.length >= 3)
    .slice(0, MAX_CLAUSES);
}

/** Each clause as the closing message disposed of it. A disposal naming neither a declared check id
 *  nor `unchecked` is no disposal, and the last line naming a clause wins. */
function clauseDispositions(
  clauses: readonly string[],
  text: string,
  checkIds: readonly string[],
): ClauseDisposal[] {
  const found = new Map<number, { check: string; decides: ClauseVerdict }>();
  for (const [, number, check, decides] of text.matchAll(DISPOSAL_LINE)) {
    const verdict = decides?.toLowerCase();
    if (check === undefined || (check !== "unchecked" && !checkIds.includes(check))) continue;
    if (verdict === "yes" || verdict === "no" || verdict === "unknown") {
      found.set(Number(number), { check, decides: verdict });
    }
  }
  return clauses.map((clause, index) => {
    const row = found.get(index + 1);
    return { clause, check: row?.check ?? null, decides: row?.decides ?? null };
  });
}

/** The clauses still owed: undisposed, or read as deciding no verdict with no task-set defect on
 *  record to carry that reading to the task author. */
function owedClauses(
  clauses: readonly string[],
  findings: readonly AnalysisFinding[],
  checkIds: readonly string[],
  text: string,
): number[] {
  const tasksDefect = findings.some((finding) => finding.defect && finding.owner === TASKS_FILE);
  return clauseDispositions(clauses, text, checkIds).flatMap((row, index) =>
    row.check === null || row.decides === null || (row.decides === "no" && !tasksDefect) ? [index + 1] : [],
  );
}

/** The request-clause duty's restatement, while a clause is owed. */
function clauseAsk(
  clauses: readonly string[],
  checkIds: readonly string[],
  findings: readonly AnalysisFinding[],
): DutyAsk {
  return (text) => {
    const owed = owedClauses(clauses, findings, checkIds, text);
    return owed.length === 0
      ? null
      : `Request clause${owed.length === 1 ? "" : "s"} ${owed.join(", ")} ${owed.length === 1 ? "is" : "are"} not yet disposed of. Give each as \`Clause N: <declared check id or unchecked>; decides: yes|no|unknown\`, and record a clause no task decides as an advisory defect owned by ${TASKS_FILE}.`;
  };
}

/** The request-clause duty of one review: its clauses, the restatement while one is owed, and how a
 *  finished closing message disposed of each. A review with no request owes nothing. */
export function requestDuty(
  request: string | null,
  checkIds: readonly string[],
  findings: readonly AnalysisFinding[],
) {
  const clauses = requestClauses(request);
  return {
    clauses,
    ask: clauses.length === 0 ? null : clauseAsk(clauses, checkIds, findings),
    settle: (turn: { text: string; error: unknown }) =>
      clauses.length > 0 && turn.error === null
        ? { requestClauses: clauseDispositions(clauses, turn.text, checkIds) }
        : {},
  };
}

/** The orientation lines that state the request-clause duty and list the clauses. */
export function clauseLines(clauses: readonly string[]): string[] {
  if (clauses.length === 0) return [];
  return [
    `The request's clauses, split at its commas and at "and". This duty is about correctness and is owed at every placement. Dispose of every clause in your closing message, one line each, as \`Clause N: <declared check id or unchecked>; decides: yes|no|unknown\`. Name the declared check that enforces the clause, or \`unchecked\`. \`decides\` answers whether some task makes the clause decide a verdict: a solve that ignored the clause — a linear analysis where it asks for a nonlinear one, a load whose reversal never flips a member's force, a pattern case that never governs — would fail that task. Say yes and name the task, no, or unknown; probe_check can answer it. A clause no task decides is an advisory defect owned by ${TASKS_FILE}. An unchecked clause is an advisory finding owned by ${TASKS_FILE} or ${EVALUATOR_FILE}, or is answered in the closing message with why the field does not demand it.`,
    ...clauses.map((clause, index) => `${String(index + 1)}. ${clause}`),
  ];
}

/** Every undischarged duty in one continuation, asked once. */
export function askOnce(asks: ReadonlyArray<DutyAsk | null>): DutyAsk {
  let asked = false;
  return (text) => {
    if (asked) return null;
    const owed = asks.flatMap((ask) => {
      const sentence = ask?.(text) ?? null;
      return sentence === null ? [] : [sentence];
    });
    if (owed.length === 0) return null;
    asked = true;
    return `${owed.join("\n\n")}\n\nReply with your complete closing message; it replaces the earlier one as the review's report.`;
  };
}

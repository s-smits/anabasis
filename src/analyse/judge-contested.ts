/**
 * Census-to-rows projection over the battery's per-case judge evidence, split from judge-reviews.ts
 * at its size ceiling. The projection names every complete judge/verifier contradiction on the
 * analysis artifact, with no materiality threshold applied, because these rows are the immutable
 * operator dispute source rather than findings. They enter no admission path and reach no model
 * prompt: a named held-out case in an authoring prompt is exactly the per-task localisation the
 * no-hints boundary protects. Without the projection, the disagreements that sit below a battery's
 * materiality threshold can be found only by opening every judge evidence file by hand. The count
 * of these rows is what the Judge exit in judge-reviews.ts reads.
 */
import { type JudgeCaseKind, type JudgeSubjectEvidence, judgeCaseKind } from "../review/judge.ts";

/** The ways a Judge answer can contradict the verifier: every `JudgeCaseKind` but agreement. */
export type ContestedKind = Exclude<JudgeCaseKind, "agree">;

/** One judge/verifier contradiction with the per-case evidence it was read from: a Judge fail of a
 *  verifier pass, or a Judge pass of a verifier fail. */
export type ContestedCase = {
  taskId: string;
  family: string;
  /** Which way the Judge contradicted the verifier, from `judgeCaseKind`: the one field every reader
   *  of this row switches on. */
  kind: ContestedKind;
  /** The shown rules a Judge fail cited; empty for a pass. */
  rules: string[];
  /** The Judge's recorded reason, private review evidence for the epoch reviewer to weigh. */
  rationale: string | null;
  /** For a Judge fail: the declared checks whose assertions the citations quote, joined
   *  controller-side; a citation of the schema, the public input, or an assertion no check declares
   *  joins nothing. Otherwise: the checks the verifier recorded as failing the artifact. */
  checkIds: string[];
  /** The per-case judge evidence path: a reviewer opens evidence instead of trusting a row. */
  evidence: string;
  /** The recorded artifact path, present only when the recorded-run reader returned its bytes. Null
   *  states the artifact could not be verified; the row never guesses from a directory layout. */
  artifact: string | null;
};

/** The subject contract the projection reads; judge-reviews' CaseSubject satisfies it. */
export interface ContestedSubject {
  taskId: string;
  family: string;
  truthOk: boolean | null;
  judgePath: string | null;
  /** Bytes already returned by the recorded-run reader. Raw path reads are not accepted here. */
  judgeEvidence: JudgeSubjectEvidence | null;
  /** The recorded artifact path from the same reader; null when the record refused it. */
  artifactPath: string | null;
  /** The check ids the verifier recorded as failing; empty for a pass and for records without receipts. */
  failedCheckIds: string[];
}

/** Whether the Epoch Reviewer must settle a row. A veto is settled against the rule the Judge cited.
 *  A Judge pass of a verifier fail is settled the other way round, against a check that may refuse a
 *  correct artifact, so it needs a failing check on record. A pass claims only what the Judge could
 *  read and leaves a compile or a run to the verifier, which is the reading that found host
 *  stand-ins refusing valid source. */
export function mustSettle(row: Pick<ContestedCase, "kind" | "checkIds">): boolean {
  return row.kind === "veto" || (row.kind === "disputed-pass" && row.checkIds.length > 0);
}

/** The contested rows as the Epoch Reviewer takes them: the ones it settles, and every other
 *  disagreement, which it may read and settles nothing on. */
export function reviewerContested(rows: readonly ContestedCase[]) {
  return { settle: rows.filter(mustSettle), otherContested: rows.filter((row) => !mustSettle(row)) };
}

/** Every Judge fail of a verifier pass and every Judge pass of a verifier fail. Subjects
 *  without a judge evidence, a verifier truth or an answer are skipped. `checkByAssertion` joins a
 *  cited assertion to its declared check. */
export function contestedCases(
  subjects: readonly ContestedSubject[],
  checkByAssertion: ReadonlyMap<string, string>,
): ContestedCase[] {
  const rows: ContestedCase[] = [];
  for (const subject of subjects) {
    if (subject.judgePath === null || subject.judgeEvidence === null || subject.truthOk === null) continue;
    const evidence = subject.judgeEvidence;
    const kind = judgeCaseKind(evidence, subject.truthOk ? "pass" : "fail");
    if (kind === null || kind === "agree") continue;
    const { rules } = evidence;
    rows.push({
      taskId: subject.taskId,
      family: subject.family,
      kind,
      rules,
      rationale: evidence.rationale,
      checkIds: subject.truthOk
        ? [...new Set(rules.flatMap((rule) => checkByAssertion.get(rule) ?? []))]
        : subject.failedCheckIds,
      evidence: subject.judgePath,
      artifact: subject.artifactPath,
    });
  }
  return rows;
}

/**
 * Census-to-rows projection over the battery's per-case judge evidence, split from
 * judge-reviews.ts at its size ceiling. The projection names every complete judge/verifier
 * contradiction on the analysis artifact without applying a materiality threshold. These rows are
 * the immutable operator dispute source; they are not findings. They enter no admission path and
 * reach no model prompt, because a named held-out case in an authoring prompt is the per-task
 * localisation the no-hints boundary protects. hwctrl-live-01 motivated the projection: the
 * battery had four judge/verifier disagreements below its threshold. Finding those four cases
 * otherwise meant opening every judge evidence by hand. The count of these rows is what the
 * Judge exit in judge-reviews.ts reads.
 */
import { join } from "../meta/path.ts";
import { confirmedDisagreement, type JudgeSubjectEvidence } from "../truth/judge.ts";
import { isBoolean, type JsonValue } from "../meta/json-shape.ts";
import { readJsonFile } from "../meta/completed-json.ts";

/** One judge/verifier contradiction with the per-case evidence it was read from. */
export type ContestedCase = {
  taskId: string;
  family: string;
  judge: boolean;
  verifier: boolean;
  /** The shown rules a Judge fail cited; empty for a Judge pass. */
  rules: string[];
  /** The Judge's recorded reason, private review evidence for the epoch reviewer to weigh. */
  rationale: string | null;
  /** The contradicting verdict repeated by a second fresh sample. */
  confirmed: boolean;
  /** For a Judge fail: the declared checks whose assertions the citations quote, joined
   *  controller-side; a citation of the schema, the public input, or an assertion no check declares
   *  joins nothing. For a Judge pass: the checks the verifier recorded as failing the artifact. */
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

/** Reads one repo-root-relative evidence. Lives here rather than in judge-reviews.ts because the
 *  import already points this way; judge-reviews.ts imports it back for its own subject reads. */
export function readJson(repoRoot: string, rel: string): JsonValue {
  return readJsonFile(join(repoRoot, rel));
}

/** A verifier pass the Judge failed while citing shown rules: the case the reviewer must settle. */
export function isVetoed(row: Pick<ContestedCase, "judge" | "verifier" | "rules" | "confirmed">): boolean {
  return row.verifier && !row.judge && row.rules.length > 0 && row.confirmed;
}

/** A verifier fail the Judge passed twice, with the failing checks on record: the reviewer settles
 *  it the other way round, against a check that may refuse a correct artifact. */
export function isDisputedFail(
  row: Pick<ContestedCase, "judge" | "verifier" | "checkIds" | "confirmed">,
): boolean {
  return !row.verifier && row.judge && row.confirmed && row.checkIds.length > 0;
}

/** Every case whose judge verdict contradicts verifier truth. Subjects without a judge evidence or
 *  a verifier truth are skipped. `checkByAssertion` joins a cited assertion to its declared check. */
export function contestedCases(
  subjects: readonly ContestedSubject[],
  checkByAssertion: ReadonlyMap<string, string>,
): ContestedCase[] {
  const rows: ContestedCase[] = [];
  for (const subject of subjects) {
    if (subject.judgePath === null || subject.judgeEvidence === null || subject.truthOk === null) continue;
    const evidence = subject.judgeEvidence;
    if (!isBoolean(evidence.verdict) || evidence.verdict === subject.truthOk) continue;
    const { rules } = evidence;
    rows.push({
      taskId: subject.taskId,
      family: subject.family,
      judge: evidence.verdict,
      verifier: subject.truthOk,
      rules,
      rationale: evidence.rationale,
      confirmed: confirmedDisagreement(evidence),
      checkIds: evidence.verdict
        ? subject.failedCheckIds
        : [...new Set(rules.flatMap((rule) => checkByAssertion.get(rule) ?? []))],
      evidence: subject.judgePath,
      artifact: subject.artifactPath,
    });
  }
  return rows;
}

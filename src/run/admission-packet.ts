/** One persisted admission packet and the questions asked of it: whether the evaluation that
 *  produced its rows is the adopted one, and whether its reuse is spent. Nothing here opens a ledger, so a
 *  packet's own decisions can be read without a campaign around them. */
import type { AdmittedEvidence } from "../analyse/iteration-analysis.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import type { EvaluationIdentity } from "../claim/fingerprint.ts";

/** The admitted evidence plus the keys the writer adds beside it. Both readers compare `policy`
 *  with the current feedback policy first, and every packet under that policy carries the rest. */
export type PersistedAdmission = AdmittedEvidence & {
  schema: "repair-agenda/v1";
  attempts: Array<{ policy: string; runId: string; heldInLoop: boolean }>;
  policy?: string;
  observedEvaluation: EvaluationIdentity;
};

/** Read one packet, or refuse naming what the corrupt bytes would otherwise have decided. The
 *  three callers each wrote their own sentence for this; only the consequence differed. */
export function parseAdmission(payload: string, file: string, consequence: string): PersistedAdmission {
  try {
    return parseJsonAs<PersistedAdmission>(payload);
  } catch (error) {
    throw new Error(`${file} is unreadable (${errorMessage(error)}) — ${consequence}`, { cause: error });
  }
}

/** One in-loop hold permits one retry; a completed attempt or a second hold spends reuse. */
export function attemptsConsumed(admission: PersistedAdmission): boolean {
  const { attempts } = admission;
  return attempts.some((row) => !row.heldInLoop) || attempts.length >= 2;
}

/** The half of the evaluation identity that positively moved, or `null` when neither did. Each
 *  half is compared only where both sides recorded it: `null` on either side is "this identity
 *  could not be recorded", which proves no mismatch. */
export function movedIdentity(
  observed: EvaluationIdentity,
  adopted: EvaluationIdentity,
): keyof EvaluationIdentity | null {
  for (const half of ["scoringHash", "taskSetHash"] as const) {
    const seen = observed[half];
    if (seen !== null && adopted[half] !== null && seen !== adopted[half]) return half;
  }
  return null;
}

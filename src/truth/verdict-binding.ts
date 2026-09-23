/**
 * How a returned verdict is read: which issues block, which check ids they name, and a bounded
 * summary of why an accept was rejected. One owner, used by controls and measured cases alike.
 */
import type { CorrectnessModelResult } from "../verify/correctness-model-result.ts";

/**
 * The public reading of one graded task: what the verifier decided and which declared checks it
 * named. `failedCheckIds` is sorted, so two gradings of the same bytes compare; an ungraded case
 * names no check at all rather than an empty verdict.
 *
 * `nonResultKind` is `string` rather than the closed `NonResultKind` because the replay CLI also
 * reports three refusals of its own — `task-missing`, `public-task-drift` and `not-replayed` —
 * which are replay-owned readings, not environment kinds a battery could record.
 */
export interface PublicTaskVerdict {
  taskId: string;
  truthOk: boolean | null;
  pass: boolean | null;
  nonResultKind: string | null;
  failedCheckIds: string[];
}

export function blockingTruthFailure(result: CorrectnessModelResult): boolean {
  return result.issues.length > 0;
}

/** The declared checks a result failed on — the contract finding-1 attributes a reject's failure
 *  through. */
export function blockingFailedCheckIds(result: CorrectnessModelResult): Set<string> {
  return new Set(result.issues.map((issue) => issue.checkId));
}

/**
 * Project a graded case into that reading. The bundle's `check` entry and the replay CLI both
 * publish it and each wrote it out, which is a comparison waiting to go wrong: a replay is read
 * against the bundle's own output, and those two readings have to be the same five fields.
 *
 * What each adds on top stays its own. The bundle names the tools that ran and where the complete
 * verdict was written; the replay carries `nonResult`, the message, which the bundle withholds
 * because its output is a public surface and a non-result message is not.
 */
export function publicTaskVerdict(
  taskId: string,
  record: { truthOk: boolean | null; pass: boolean | null; runtimeNonResultKind: string | null },
  verdict: CorrectnessModelResult | null,
): PublicTaskVerdict {
  return {
    taskId,
    truthOk: record.truthOk,
    pass: record.pass,
    nonResultKind: record.runtimeNonResultKind,
    failedCheckIds: verdict === null ? [] : [...blockingFailedCheckIds(verdict)].sort(),
  };
}

/**
 * Bounded operator detail for an accept rejection: check ids and the first blocking messages.
 * Without the issue text a rejection says only that the accept failed, so a repair aims at whatever
 * the author guesses and the next attempt guesses again; keeping the diagnostic in evidence is what
 * lets the investigation start from what the verifier actually said.
 *
 * An accept uses its own task's hidden data, so these messages may carry protected detail, and that
 * is why they stay in evidence: author feedback receives only the permitted public projection.
 */
export function blockingIssueSummary(result: CorrectnessModelResult, cap = 3): string {
  const blocking = result.issues;
  if (blocking.length === 0) return "no blocking issue recorded (ok:false without one is itself a defect)";
  const parts = blocking.slice(0, cap).map((i) => `[${i.checkId}] ${i.message.slice(0, 180)}`);
  const more = blocking.length > cap ? ` (+${blocking.length - cap} more)` : "";
  return `${parts.join("; ")}${more}`;
}

/**
 * Reading the verifier host's tool-run evidence for one evaluate. The runner decides from these
 * rows, never from what the generated evaluator says about them: a host non-result outranks any
 * returned result, an executed run is the only thing that grounds an external check, and a
 * runtimeNonResult without host evidence cannot establish an environment failure.
 */
import { keyIfDefined } from "../meta/optional-key.ts";
import { compareCodeUnits } from "../meta/stable-json.ts";
import type { CorrectnessModelResult } from "../verify/correctness-model-result.ts";
import type {
  ExecutedCheckBinding,
  VerifierExecutionEvidence,
  VerifierHostHandle,
} from "../verify/verifier-port.ts";
import type { VerifierExecutionEvidence as ExternalExecutionEvidence } from "./grounding.ts";
import { blockingTruthFailure } from "./verdict-binding.ts";
import { verifierEnvironmentHashOfTools } from "./verifier-environment.ts";

interface SubjectKey {
  phase: VerifierExecutionEvidence["phase"];
  subjectId: string;
  attempt: number;
}

export const EXTERNAL_VERDICT_UNGROUNDED = "EXTERNAL_VERDICT_UNGROUNDED";

/** A check that passed without a completed run of one or more of its required tools. */
export interface UngroundedCheck {
  checkId: string;
  toolIds: string[];
}

function ofSubject(row: SubjectKey, key: SubjectKey): boolean {
  return row.phase === key.phase && row.subjectId === key.subjectId && row.attempt === key.attempt;
}

/** Every run row this evaluate produced, in run order. */
export function subjectRuns(verifier: VerifierHostHandle, key: SubjectKey): VerifierExecutionEvidence[] {
  return verifier.evidence().filter((row) => ofSubject(row, key));
}

/** The first run of this evaluate that reached no completed run, or null when every run executed. */
export function hostNonResult(
  verifier: VerifierHostHandle,
  key: SubjectKey,
): VerifierExecutionEvidence | null {
  return subjectRuns(verifier, key).find((row) => row.outcome !== "executed") ?? null;
}

/**
 * R1, a grounded pass: every check that decided a pass and declares required tools ran each of
 * them to completion on this subject. Only a pass is read. A check may return false before it
 * reaches its tool, on a precondition the artifact already breaks, and that fail is a real verdict;
 * a skipped run can withhold a pass but never create a fail. Timeouts and crashes are the host's
 * non-result and stay with `hostNonResult`. `decidingIds` are the checks the evaluation ran: every
 * applicable check for a case or an accept, the named check alone for a reject.
 */
export function ungroundedPassChecks(
  verdict: CorrectnessModelResult | null,
  decidingIds: readonly string[],
  checkTools: ReadonlyArray<{ checkId: string; adapterId: string }>,
  bindings: readonly ExecutedCheckBinding[],
  subject: SubjectKey,
): UngroundedCheck[] {
  if (verdict === null || blockingTruthFailure(verdict)) return [];
  const deciding = new Set(decidingIds);
  const missing = new Map<string, string[]>();
  for (const pair of checkTools) {
    const ran = bindings.some(
      (binding) =>
        ofSubject(binding, subject) &&
        binding.checkId === pair.checkId &&
        binding.adapterId === pair.adapterId,
    );
    if (deciding.has(pair.checkId) && !ran) {
      missing.set(pair.checkId, [...(missing.get(pair.checkId) ?? []), pair.adapterId]);
    }
  }
  return [...missing.entries()]
    .sort((a, b) => compareCodeUnits(a[0], b[0]))
    .map(([checkId, toolIds]) => ({ checkId, toolIds: toolIds.toSorted(compareCodeUnits) }));
}

/** The one public sentence; check and tool ids are public authoring identities. */
export function ungroundedSentence(checks: readonly UngroundedCheck[]): string {
  const clauses = checks.map(
    (check) =>
      `check "${check.checkId}" passed without a completed run of its required ${check.toolIds.length === 1 ? "tool" : "tools"} ${check.toolIds.map((id) => `"${id}"`).join(", ")}`,
  );
  return `${EXTERNAL_VERDICT_UNGROUNDED}: ${clauses.join("; ")}`;
}

/**
 * The battery-level execution fact set, read once from the host handle when the battery closes.
 *
 * The environment hash uses the projected map, the same `{digest, source}` per toolId
 * the evidence carries. The host's own entries also hold each tool's absolute path, and hashing
 * those made the identity of a compiler depend on which checkout resolved it: the same bytes in
 * two worktrees produced two environment hashes, so a claim comparison across checkouts read as
 * a moved environment when nothing about the tool had moved.
 */
export function executionEvidence(verifier: VerifierHostHandle): ExternalExecutionEvidence {
  const found = verifier.tools();
  const tools: ExternalExecutionEvidence["tools"] = Object.fromEntries(
    Object.keys(found)
      .sort(compareCodeUnits)
      .map((id) => {
        const entry = /* SAFETY: `id` is one of this object's own keys. */ found[id] as NonNullable<
          (typeof found)[string]
        >;
        const interpreter =
          entry.interpreterDigest === undefined ? {} : { interpreterDigest: entry.interpreterDigest };
        return [
          id,
          {
            digest: entry.digest,
            source: entry.source,
            kind: entry.kind,
            interpreter: entry.interpreter,
            ...interpreter,
            ...keyIfDefined("packages", entry.packages === undefined ? undefined : [...entry.packages]),
          },
        ];
      }),
  );
  return {
    executed: verifier.executedBindings(),
    verifierEnvironmentHash: verifierEnvironmentHashOfTools(tools),
    tools,
  };
}

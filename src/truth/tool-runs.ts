/**
 * Reading the verifier host's tool-run evidence for one evaluate. The runner decides from these
 * rows, never from what the generated evaluator says about them: a host non-result outranks any
 * returned result, an executed run is the only thing that grounds an external check, and a
 * runtimeNonResult without host evidence cannot establish an environment failure.
 */
import { compareCodeUnits } from "../meta/stable-json.ts";
import type {
  ExecutedCheckBinding,
  VerifierExecutionEvidence,
  VerifierHostHandle,
} from "../verify/verifier-port.ts";
import type { VerifierExecutionEvidence as ExternalExecutionEvidence } from "./grounding.ts";
import { verifierEnvironmentHashOfTools } from "./verifier-environment.ts";

interface SubjectKey {
  phase: VerifierExecutionEvidence["phase"];
  subjectId: string;
  attempt: number;
}

/** Every run row this evaluate produced, in run order. */
export function subjectRuns(verifier: VerifierHostHandle, key: SubjectKey): VerifierExecutionEvidence[] {
  return verifier
    .evidence()
    .filter(
      (row) => row.phase === key.phase && row.subjectId === key.subjectId && row.attempt === key.attempt,
    );
}

/** The first run of this evaluate that reached no completed run, or null when every run executed. */
export function hostNonResult(
  verifier: VerifierHostHandle,
  key: SubjectKey,
): VerifierExecutionEvidence | null {
  return subjectRuns(verifier, key).find((row) => row.outcome !== "executed") ?? null;
}

/** Applicable externally grounded checks with no completed tool run for this subject. */
export function uncoveredExternalCheckIds(
  applicableIds: readonly string[],
  externalChecks: ReadonlyArray<{ checkId: string; adapterId: string }>,
  bindings: readonly ExecutedCheckBinding[],
  subject: SubjectKey,
): string[] {
  const applicable = new Set(applicableIds);
  return externalChecks
    .values()
    .filter(
      (check) =>
        applicable.has(check.checkId) &&
        !bindings.some(
          (binding) =>
            binding.phase === subject.phase &&
            binding.subjectId === subject.subjectId &&
            binding.attempt === subject.attempt &&
            binding.checkId === check.checkId &&
            binding.adapterId === check.adapterId,
        ),
    )
    .map((check) => check.checkId)
    .toArray()
    .sort(compareCodeUnits);
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

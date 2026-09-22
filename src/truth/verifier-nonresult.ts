import type { VerifierExecutionNonResultKind } from "../verify/correctness-model-result.ts";
import type { VerifierExecutionEvidence } from "../verify/verifier-port.ts";

/**
 * A tool run the host authorised produced no completed run. The host alone writes the kind: a
 * tool has no wire on which to report its own outcome, so the kind is a host measurement and can
 * be read for ownership directly. Two kinds are the environment's — the OS wall was unavailable or
 * refused, or the installed tool could not be read — and every other kind (timeout, crash) is the
 * run of a tool the author chose over an input the artifact produced, which the author can act on.
 *
 * A control (`discrimination`) and a reference solve (`solvability`) meet the same event, so one
 * class carries both and the census gate settles them in one place. It carries the exact host
 * evidence rather than a copied kind string, so the settlement records typed evidence.
 */
export const ENVIRONMENT_OWNED_TOOL_NON_RESULT_KINDS: ReadonlySet<string> = new Set<string>([
  "sandbox",
  "verifierUnavailable",
] satisfies VerifierExecutionNonResultKind[]);

/** Pause before the one retry allowed for an environment-owned kind. A short delay gives a
 *  temporary filesystem or sandbox problem time to clear; retrying immediately may reproduce
 *  the same failure before the host has recovered. */
export const TOOL_RETRY_DELAY_MS = 3000;

export function environmentOwnedToolNonResult(kind: string): boolean {
  return ENVIRONMENT_OWNED_TOOL_NON_RESULT_KINDS.has(kind);
}

export function toolRetryDelay(waitMs: number = TOOL_RETRY_DELAY_MS): Promise<void> {
  return Bun.sleep(waitMs);
}

export class VerifierExecutionNonResult extends Error {
  constructor(readonly evidence: VerifierExecutionEvidence) {
    super(
      `${evidence.phase} evaluate of "${evidence.subjectId}" could not run: tool "${evidence.toolId}" for check "${evidence.checkId}" ended as ${evidence.outcome}`,
    );
    this.name = "VerifierExecutionNonResult";
  }
}

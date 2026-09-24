/**
 * A verifier host with some of its methods replaced and the rest delegated to a real one.
 *
 * `createVerifierHost` returns a class instance, so spreading it copies none of its methods. Tests
 * that need one scripted method, a subject hook or a fixed evidence record, would otherwise write
 * out all four delegates by hand. This writes them out once.
 */
import { createVerifierHost } from "../../src/verify/host.ts";
import type { VerifierHostHandle } from "../../src/verify/verifier-port.ts";

export function overrideHost(
  overrides: Partial<VerifierHostHandle>,
  host: VerifierHostHandle = createVerifierHost(),
): VerifierHostHandle {
  return {
    openSubject: (subject) => host.openSubject(subject),
    executedBindings: () => host.executedBindings(),
    tools: () => host.tools(),
    evidence: () => host.evidence(),
    ...overrides,
  };
}

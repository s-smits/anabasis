/** Resolve a verifier host from the tools declared by its caller's immutable candidate. */
import { createVerifierHost } from "../verify/host.ts";
import { harnessSettings } from "./harness-config.ts";
import { resolveToolInventory } from "../verify/tool-inventory.ts";
import type { VerifierHostHandle } from "../verify/verifier-port.ts";
import type { VerifierLifetime } from "../verify/verifier-lifetime.ts";
import { keyIfDefined } from "../meta/optional-key.ts";

export function resolveVerifier(input: {
  toolTree: string | null;
  /** The candidate snapshot whose agent/config.yaml sets the tool-run wall. */
  bundleDir: string;
  toolIds: readonly string[];
  createVerifier?: () => VerifierHostHandle;
  verifierLifetime?: VerifierLifetime;
}) {
  const resolved = resolveToolInventory(input);
  const verifier =
    input.createVerifier === undefined
      ? createVerifierHost({
          inventory: resolved.inventory,
          toolTree: input.toolTree,
          toolRunMs: harnessSettings(input.bundleDir).toolRunMs,
          ...keyIfDefined("lifetime", input.verifierLifetime),
        })
      : input.createVerifier();
  return { verifier, missingTools: [...resolved.missing, ...resolved.invalid] };
}

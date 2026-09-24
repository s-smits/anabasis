/**
 * Control corpus floors and Judge independence. The floors set how many known-correct and
 * deliberately incorrect controls an authored corpus must carry; authoring states and checks the
 * same numbers. The Main Judge no longer runs a control census over that corpus (operator
 * decision), so no validity rule, bait corpus or calibration rate lives here — a rate computed
 * from a census nobody runs would be read as calibration evidence the system does not have.
 */
import { policyRow, posInt } from "../critic/manifest.ts";

/** The registered control corpus floors, read from the frozen manifest's `evaluatorCalibration` row.
 *  A missing or invalid field takes the pilot default of five. The row is read here rather than in
 *  the numeric policy table because reading a manifest row belongs at the consumer that acts on
 *  it; src/critic/policy.ts names this file as the reader and keeps its own values code-only. */
export const EVALUATOR_CALIBRATION_POLICY = policyRow("evaluatorCalibration", {
  minimumKnownPasses: { bound: posInt, fallback: 5 },
  minimumKnownFailures: { bound: posInt, fallback: 5 },
})();

/**
 * How independent the Judge is from the model being evaluated. Classification uses the two
 * `backendKind/modelId` pins, for example `claude/claude-opus-4-8`.
 */
export type EvaluatorIndependence = "same-model" | "same-family" | "different-family";

/** Model family follows the vendor. A pin is `backendKind/modelId`, and the model id may have
 *  a vendor prefix (`openrouter/anthropic/claude-opus-4-8`). Classifying on the backend kind would
 *  call the same vendor's model independent of itself whenever the two slots reached it through
 *  different transports, such as the Claude keychain and OpenRouter, so the vendor is taken from
 *  the model id's prefix when it has one and from its leading letters otherwise: `claude-opus-4-8`
 *  and `claude-sonnet-5` share a family. The alias table exists because one vendor is named
 *  differently on different transports, `anthropic` on one and `claude` on another. An unparseable
 *  pin and the broker's `unresolved` value both receive the least independent classification,
 *  `same-model`, because an unknown model identity cannot establish that the reviewer is
 *  independent of what it reviews. */
const VENDOR_ALIASES = new Map([
  ["anthropic", "claude"],
  ["openai", "gpt"],
]);

function familyOf(pin: string): string | null {
  const slash = pin.indexOf("/");
  if (slash <= 0 || slash === pin.length - 1) return null;
  const model = pin.slice(slash + 1);
  if (model === "unresolved") return null;
  const vendorSlash = model.indexOf("/");
  const vendor =
    vendorSlash > 0
      ? model.slice(0, vendorSlash).toLowerCase()
      : (model.match(/^[a-zA-Z]+/)?.[0]?.toLowerCase() ?? null);
  if (vendor === null || vendor === "unresolved") return null;
  return VENDOR_ALIASES.get(vendor) ?? vendor;
}

export function evaluatorIndependence(evaluatorPin: string, evaluatedPin: string): EvaluatorIndependence {
  if (evaluatorPin === evaluatedPin) return "same-model";
  const evaluatorFamily = familyOf(evaluatorPin);
  const evaluatedFamily = familyOf(evaluatedPin);
  if (evaluatorFamily === null || evaluatedFamily === null) return "same-model";
  return evaluatorFamily === evaluatedFamily ? "same-family" : "different-family";
}
